import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { nativeImage } from "electron";

const CACHE_LIMIT_BYTES = 512 * 1024 * 1024;
const MAX_MEMORY_BYTES = 32 * 1024 * 1024;
const MAX_CONCURRENT_READS = 4;

interface CacheEntry {
  bytes: Buffer;
  mimeType: string;
  lastUsed: number;
}
/** Main-owned artwork cache. Renderer receives only a data URL, never a path. */
export class LocalArtworkCache {
  private readonly memory = new Map<string, CacheEntry>();
  private memoryBytes = 0;
  private diskBytes = 0;
  private readonly pending: Array<() => void> = [];
  private activeReads = 0;
  private initialized: Promise<void> | undefined;

  constructor(private readonly directory: string, private readonly limitBytes = CACHE_LIMIT_BYTES) {}

  async load(cacheKey: string, sourcePath: string): Promise<{ dataUrl: string; mimeType: string } | undefined> {
    if (!/^artwork_[a-f0-9]{64}$/i.test(cacheKey)) return undefined;
    await this.ensureInitialized();
    return this.withReadSlot(async () => {
      const mimeType = mimeTypeFor(sourcePath);
      const cached = this.memory.get(cacheKey);
      if (cached) {
        cached.lastUsed = Date.now();
        return { dataUrl: toDataUrl(cached.bytes, cached.mimeType), mimeType: cached.mimeType };
      }
      const cachePath = this.cachePath(cacheKey);
      let bytes: Buffer | undefined;
      try {
        bytes = await readFile(cachePath);
      } catch {
        try {
          bytes = await readFile(sourcePath);
        } catch {
          return undefined;
        }
        const derivative = downscale(bytes, mimeType);
        bytes = derivative.bytes;
        await this.writeDisk(cachePath, bytes);
        this.putMemory(cacheKey, bytes, derivative.mimeType);
        return { dataUrl: toDataUrl(bytes, derivative.mimeType), mimeType: derivative.mimeType };
      }
      this.putMemory(cacheKey, bytes, mimeType);
      return { dataUrl: toDataUrl(bytes, mimeType), mimeType };
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      this.initialized = (async () => {
        await mkdir(this.directory, { recursive: true });
        const entries = await readdir(this.directory, { withFileTypes: true }).catch(() => []);
        let total = 0;
        for (const entry of entries) {
          if (!entry.isFile() || !/^artwork_[a-f0-9]{64}\.bin$/i.test(entry.name)) continue;
          total += Number((await stat(join(this.directory, entry.name)).catch(() => ({ size: 0 }))).size);
        }
        this.diskBytes = total;
        await this.evictDisk();
      })();
    }
    await this.initialized;
  }

  private withReadSlot<T>(work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.activeReads += 1;
        void work().then(resolve, reject).finally(() => {
          this.activeReads -= 1;
          const next = this.pending.shift();
          next?.();
        });
      };
      if (this.activeReads < MAX_CONCURRENT_READS) run();
      else this.pending.push(run);
    });
  }

  private cachePath(cacheKey: string): string {
    return join(this.directory, `${cacheKey}.bin`);
  }

  private putMemory(cacheKey: string, bytes: Buffer, mimeType: string): void {
    const previous = this.memory.get(cacheKey);
    if (previous) this.memoryBytes -= previous.bytes.byteLength;
    this.memory.set(cacheKey, { bytes, mimeType, lastUsed: Date.now() });
    this.memoryBytes += bytes.byteLength;
    while (this.memoryBytes > MAX_MEMORY_BYTES && this.memory.size > 0) {
      const oldest = [...this.memory.entries()].sort((left, right) => left[1].lastUsed - right[1].lastUsed)[0];
      if (!oldest) break;
      this.memory.delete(oldest[0]);
      this.memoryBytes -= oldest[1].bytes.byteLength;
    }
  }

  private async writeDisk(cachePath: string, bytes: Buffer): Promise<void> {
    if (bytes.byteLength > this.limitBytes) return;
    try {
      const previous = await stat(cachePath);
      this.diskBytes -= Number(previous.size);
    } catch {
      // New derivative.
    }
    await writeFile(cachePath, bytes);
    this.diskBytes += bytes.byteLength;
    await this.evictDisk();
  }

  private async evictDisk(): Promise<void> {
    if (this.diskBytes <= this.limitBytes) return;
    const entries = await readdir(this.directory, { withFileTypes: true }).catch(() => []);
    const candidates: Array<{ path: string; size: number; atime: number }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^artwork_[a-f0-9]{64}\.bin$/i.test(entry.name)) continue;
      const path = join(this.directory, entry.name);
      const metadata = await stat(path).catch(() => undefined);
      if (metadata) candidates.push({ path, size: Number(metadata.size), atime: Number(metadata.atimeMs) });
    }
    candidates.sort((left, right) => left.atime - right.atime);
    for (const candidate of candidates) {
      if (this.diskBytes <= this.limitBytes) break;
      await unlink(candidate.path).catch(() => undefined);
      this.diskBytes -= candidate.size;
      this.memory.delete(candidate.path.slice(this.directory.length + 1, -4));
    }
  }
}

function mimeTypeFor(sourcePath: string): string {
  switch (extname(sourcePath).toLowerCase()) {
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".avif": return "image/avif";
    case ".gif": return "image/gif";
    default: return "image/jpeg";
  }
}

function toDataUrl(bytes: Buffer, mimeType: string): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function downscale(bytes: Buffer, mimeType: string): { bytes: Buffer; mimeType: string } {
  try {
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return { bytes, mimeType };
    const size = image.getSize();
    if (size.width <= 480 && size.height <= 720) return { bytes, mimeType };
    const ratio = Math.min(480 / Math.max(1, size.width), 720 / Math.max(1, size.height));
    const resized = image.resize({ width: Math.max(1, Math.round(size.width * ratio)), height: Math.max(1, Math.round(size.height * ratio)) });
    if (mimeType === "image/png") return { bytes: resized.toPNG(), mimeType };
    return { bytes: resized.toJPEG(82), mimeType: "image/jpeg" };
  } catch {
    // Broken/unsupported art remains a placeholder and is never a scan failure.
    return { bytes, mimeType };
  }
}

