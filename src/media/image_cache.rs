use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use slint::{Image, Rgba8Pixel, SharedPixelBuffer};

const DISK_MAGIC: &[u8; 8] = b"ZVIDIMG1";
const DISK_HEADER_LEN: usize = DISK_MAGIC.len() + std::mem::size_of::<u64>();

/// A small request-generation gate used by image workers.
///
/// Canceling rejects a result; it does not interrupt an already in-flight
/// synchronous request. Callers must check the generation before applying it.
#[derive(Clone, Default)]
pub struct ImageRequestGate {
    current: Arc<AtomicU64>,
}

impl ImageRequestGate {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn begin(&self) -> u64 {
        self.current.fetch_add(1, Ordering::AcqRel) + 1
    }

    pub fn cancel(&self) {
        self.current.fetch_add(1, Ordering::AcqRel);
    }

    pub fn is_current(&self, request_id: u64) -> bool {
        self.current.load(Ordering::Acquire) == request_id
    }
}

/// In-memory LRU plus an optional bounded, restartable disk cache for raw image bytes.
#[derive(Clone)]
pub struct ImageCache {
    inner: Arc<Mutex<CacheInner>>,
}

struct CacheInner {
    capacity: usize,
    entries: HashMap<String, Vec<u8>>,
    order: Vec<String>,
    disk_dir: Option<PathBuf>,
    disk_capacity_bytes: u64,
    next_disk_sequence: u64,
}

impl ImageCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(CacheInner {
                capacity,
                entries: HashMap::new(),
                order: Vec::new(),
                disk_dir: None,
                disk_capacity_bytes: 0,
                next_disk_sequence: 1,
            })),
        }
    }

    /// Creates a cache with a dedicated disk-cache directory and byte limit.
    /// Only files owned by this cache (`zvideo-image-*.bin`) are ever removed.
    pub fn with_disk_cache(
        disk_dir: impl AsRef<Path>,
        memory_capacity: usize,
        disk_capacity_bytes: u64,
    ) -> Self {
        let disk_dir = disk_dir.as_ref().to_path_buf();
        let next_disk_sequence = next_disk_sequence(&disk_dir);
        let _ = fs::create_dir_all(&disk_dir);

        Self {
            inner: Arc::new(Mutex::new(CacheInner {
                capacity: memory_capacity,
                entries: HashMap::new(),
                order: Vec::new(),
                disk_dir: Some(disk_dir),
                disk_capacity_bytes,
                next_disk_sequence,
            })),
        }
    }

    pub fn get(&self, key: &str) -> Option<Vec<u8>> {
        let mut inner = self.inner.lock().unwrap();
        if let Some(bytes) = inner.entries.get(key).cloned() {
            touch_memory(&mut inner, key);
            return Some(bytes);
        }

        let disk_dir = inner.disk_dir.clone()?;
        let path = disk_path(&disk_dir, key);
        let record = read_disk_record(&path)?;
        if inner.disk_capacity_bytes == 0 || record.bytes.len() as u64 > inner.disk_capacity_bytes {
            let _ = fs::remove_file(path);
            return None;
        }

        let sequence = take_disk_sequence(&mut inner);
        let _ = write_disk_record(&path, sequence, &record.bytes);
        insert_memory(&mut inner, key.to_string(), record.bytes.clone());
        Some(record.bytes)
    }

    pub fn insert(&self, key: String, bytes: Vec<u8>) {
        let mut inner = self.inner.lock().unwrap();
        insert_memory(&mut inner, key.clone(), bytes.clone());

        let Some(disk_dir) = inner.disk_dir.clone() else {
            return;
        };
        if bytes.len() as u64 > inner.disk_capacity_bytes || inner.disk_capacity_bytes == 0 {
            let _ = fs::remove_file(disk_path(&disk_dir, &key));
            return;
        }

        if fs::create_dir_all(&disk_dir).is_err() {
            return;
        }

        let sequence = take_disk_sequence(&mut inner);
        let path = disk_path(&disk_dir, &key);
        let _ = write_disk_record(&path, sequence, &bytes);
        evict_disk_entries(&disk_dir, inner.disk_capacity_bytes);
    }

    pub fn contains(&self, key: &str) -> bool {
        let inner = self.inner.lock().unwrap();
        if inner.entries.contains_key(key) {
            return true;
        }
        inner
            .disk_dir
            .as_ref()
            .is_some_and(|dir| read_disk_record(&disk_path(dir, key)).is_some())
    }

    pub fn len(&self) -> usize {
        self.inner.lock().unwrap().entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.lock().unwrap().entries.is_empty()
    }

    pub fn disk_usage_bytes(&self) -> u64 {
        let inner = self.inner.lock().unwrap();
        inner
            .disk_dir
            .as_ref()
            .map(|dir| {
                disk_entries(dir)
                    .into_iter()
                    .map(|entry| entry.bytes as u64)
                    .sum()
            })
            .unwrap_or(0)
    }

    pub fn clear(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.entries.clear();
        inner.order.clear();
        if let Some(dir) = &inner.disk_dir {
            for entry in disk_entries(dir) {
                let _ = fs::remove_file(entry.path);
            }
        }
    }
}

impl Default for ImageCache {
    fn default() -> Self {
        Self::new(100)
    }
}

fn insert_memory(inner: &mut CacheInner, key: String, bytes: Vec<u8>) {
    if inner.capacity == 0 {
        return;
    }
    if inner.entries.contains_key(&key) {
        inner.entries.insert(key.clone(), bytes);
        touch_memory(inner, &key);
        return;
    }
    while inner.entries.len() >= inner.capacity {
        let Some(oldest) = inner.order.first().cloned() else {
            break;
        };
        inner.order.remove(0);
        inner.entries.remove(&oldest);
    }
    inner.entries.insert(key.clone(), bytes);
    inner.order.push(key);
}

fn touch_memory(inner: &mut CacheInner, key: &str) {
    if let Some(pos) = inner.order.iter().position(|item| item == key) {
        inner.order.remove(pos);
    }
    inner.order.push(key.to_string());
}

struct DiskEntry {
    path: PathBuf,
    sequence: u64,
    bytes: usize,
}

struct DiskRecord {
    bytes: Vec<u8>,
}

fn take_disk_sequence(inner: &mut CacheInner) -> u64 {
    let sequence = inner.next_disk_sequence.max(1);
    inner.next_disk_sequence = sequence.saturating_add(1).max(1);
    sequence
}

fn next_disk_sequence(dir: &Path) -> u64 {
    disk_entries(dir)
        .into_iter()
        .map(|entry| entry.sequence)
        .max()
        .unwrap_or(0)
        .saturating_add(1)
        .max(1)
}

fn disk_path(dir: &Path, key: &str) -> PathBuf {
    dir.join(format!("zvideo-image-{:016x}.bin", stable_key_hash(key)))
}

fn stable_key_hash(key: &str) -> u64 {
    // FNV-1a is deterministic across process restarts and produces a safe filename.
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in key.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3_u64);
    }
    hash
}

fn is_owned_cache_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let Some(hash) = name
        .strip_prefix("zvideo-image-")
        .and_then(|name| name.strip_suffix(".bin"))
    else {
        return false;
    };
    hash.len() == 16 && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn encode_disk_record(sequence: u64, bytes: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(DISK_HEADER_LEN + bytes.len());
    encoded.extend_from_slice(DISK_MAGIC);
    encoded.extend_from_slice(&sequence.to_le_bytes());
    encoded.extend_from_slice(bytes);
    encoded
}

fn decode_disk_record(encoded: &[u8]) -> Option<DiskRecord> {
    if encoded.len() < DISK_HEADER_LEN || &encoded[..DISK_MAGIC.len()] != DISK_MAGIC {
        return None;
    }
    Some(DiskRecord {
        bytes: encoded[DISK_HEADER_LEN..].to_vec(),
    })
}

fn read_disk_record(path: &Path) -> Option<DiskRecord> {
    let encoded = fs::read(path).ok()?;
    decode_disk_record(&encoded)
}

fn read_disk_sequence(path: &Path) -> Option<u64> {
    let encoded = fs::read(path).ok()?;
    if encoded.len() < DISK_HEADER_LEN || &encoded[..DISK_MAGIC.len()] != DISK_MAGIC {
        return None;
    }
    Some(u64::from_le_bytes(
        encoded[DISK_MAGIC.len()..DISK_HEADER_LEN].try_into().ok()?,
    ))
}

fn write_disk_record(path: &Path, sequence: u64, bytes: &[u8]) -> std::io::Result<()> {
    let temp_path = path.with_extension("tmp");
    fs::write(&temp_path, encode_disk_record(sequence, bytes))?;
    let _ = fs::remove_file(path);
    match fs::rename(&temp_path, path) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temp_path);
            Err(error)
        }
    }
}

fn disk_entries(dir: &Path) -> Vec<DiskEntry> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| is_owned_cache_file(path))
        .filter_map(|path| {
            let record = read_disk_record(&path)?;
            Some(DiskEntry {
                sequence: read_disk_sequence(&path)?,
                bytes: record.bytes.len(),
                path,
            })
        })
        .collect()
}

fn evict_disk_entries(dir: &Path, capacity_bytes: u64) {
    let mut entries = disk_entries(dir);
    let mut total = entries.iter().map(|entry| entry.bytes as u64).sum::<u64>();
    entries.sort_by_key(|entry| entry.sequence);
    for entry in entries {
        if total <= capacity_bytes {
            break;
        }
        if fs::remove_file(entry.path).is_ok() {
            total = total.saturating_sub(entry.bytes as u64);
        }
    }
}

/// CPU-decoded image data that can cross from a worker to the UI event loop.
#[derive(Debug, Clone)]
pub struct DecodedImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Decodes raw image bytes (JPEG, PNG, etc.) without creating a Slint object.
pub fn decode_image_pixels(bytes: &[u8]) -> Result<DecodedImage, String> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("Failed to decode image from bytes: {}", e))?;

    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    Ok(DecodedImage {
        width,
        height,
        rgba: rgba.into_raw(),
    })
}

/// Creates the Slint image object at the UI boundary after worker decoding.
pub fn slint_image_from_decoded(decoded: DecodedImage) -> Image {
    let mut pixel_buffer = SharedPixelBuffer::<Rgba8Pixel>::new(decoded.width, decoded.height);
    let buffer_slice = pixel_buffer.make_mut_bytes();
    buffer_slice.copy_from_slice(&decoded.rgba);

    Image::from_rgba8(pixel_buffer)
}

/// Compatibility helper retained for callers that own the UI boundary.
pub fn decode_to_slint_image(bytes: &[u8]) -> Result<Image, String> {
    Ok(slint_image_from_decoded(decode_image_pixels(bytes)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_image_cache_eviction() {
        let cache = ImageCache::new(2);
        assert_eq!(cache.len(), 0);

        cache.insert("img_1".to_string(), vec![1, 2, 3]);
        cache.insert("img_2".to_string(), vec![4, 5, 6]);
        assert_eq!(cache.len(), 2);
        assert!(cache.contains("img_1"));
        assert!(cache.contains("img_2"));

        cache.insert("img_3".to_string(), vec![7, 8, 9]);
        assert_eq!(cache.len(), 2);
        assert!(!cache.contains("img_1"));
        assert!(cache.contains("img_2"));
        assert!(cache.contains("img_3"));
    }

    #[test]
    fn test_decode_valid_png() {
        let valid_png = vec![
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04, 0x00, 0x00,
            0x00, 0xb5, 0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41, 0x54, 0x78,
            0xda, 0x63, 0x64, 0x60, 0x00, 0x00, 0x00, 0x06, 0x00, 0x02, 0x30, 0x81, 0xd0, 0x2f,
            0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ];

        let img_res = decode_to_slint_image(&valid_png);
        assert!(
            img_res.is_ok(),
            "Decoding minimal 1x1 PNG should succeed: {:?}",
            img_res.err()
        );
    }
}
