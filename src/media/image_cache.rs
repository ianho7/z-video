use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use slint::{Image, Rgba8Pixel, SharedPixelBuffer};

/// In-memory LRU cache for raw image bytes, safely accessible across background and UI threads.
#[derive(Clone)]
pub struct ImageCache {
    inner: Arc<Mutex<CacheInner>>,
}

struct CacheInner {
    capacity: usize,
    entries: HashMap<String, Vec<u8>>,
    order: Vec<String>,
}

impl ImageCache {
    pub fn new(capacity: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(CacheInner {
                capacity,
                entries: HashMap::new(),
                order: Vec::new(),
            })),
        }
    }

    pub fn get(&self, key: &str) -> Option<Vec<u8>> {
        let mut inner = self.inner.lock().unwrap();
        let bytes = inner.entries.get(key).cloned();
        if let Some(b) = bytes {
            if let Some(pos) = inner.order.iter().position(|k| k == key) {
                inner.order.remove(pos);
            }
            inner.order.push(key.to_string());
            Some(b)
        } else {
            None
        }
    }

    pub fn insert(&self, key: String, bytes: Vec<u8>) {
        let mut inner = self.inner.lock().unwrap();
        if inner.entries.contains_key(&key) {
            inner.entries.insert(key.clone(), bytes);
            if let Some(pos) = inner.order.iter().position(|k| k == &key) {
                inner.order.remove(pos);
            }
            inner.order.push(key);
            return;
        }

        if inner.entries.len() >= inner.capacity && !inner.order.is_empty() {
            let oldest = inner.order.remove(0);
            inner.entries.remove(&oldest);
        }

        inner.entries.insert(key.clone(), bytes);
        inner.order.push(key);
    }

    pub fn contains(&self, key: &str) -> bool {
        self.inner.lock().unwrap().entries.contains_key(key)
    }

    pub fn len(&self) -> usize {
        self.inner.lock().unwrap().entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.lock().unwrap().entries.is_empty()
    }

    pub fn clear(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.entries.clear();
        inner.order.clear();
    }
}

impl Default for ImageCache {
    fn default() -> Self {
        Self::new(100)
    }
}

/// Decodes raw image bytes (JPEG, PNG, etc.) into a Slint-compatible `slint::Image`.
pub fn decode_to_slint_image(bytes: &[u8]) -> Result<Image, String> {
    let img = image::load_from_memory(bytes)
        .map_err(|e| format!("Failed to decode image from bytes: {}", e))?;

    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    let mut pixel_buffer = SharedPixelBuffer::<Rgba8Pixel>::new(width, height);
    let buffer_slice = pixel_buffer.make_mut_bytes();
    buffer_slice.copy_from_slice(&rgba);

    Ok(Image::from_rgba8(pixel_buffer))
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
        assert!(img_res.is_ok(), "Decoding minimal 1x1 PNG should succeed: {:?}", img_res.err());
    }
}
