export const toneNames = ["pink", "blue", "orange", "mint", "lavender"] as const;
export type ToneName = typeof toneNames[number];
const tones: Record<ToneName, [string, string, string, number]> = {
  pink: ["#f6a5c0", "#4a0f26", "#2a1520", 340], blue: ["#a9cdf5", "#0b1d5c", "#121c33", 210], orange: ["#f4a07c", "#3a1406", "#2b1a10", 20], mint: ["#9fe0d0", "#0f3b33", "#10261f", 165], lavender: ["#c9b8ff", "#1b1035", "#19191d", 255],
};
const cache = new Map<string, ToneName>();
export function applyTone(element: HTMLElement, tone: ToneName): void {
  const [container, on, deep] = tones[tone];
  element.style.setProperty("--tone-container", container);
  element.style.setProperty("--tone-on", on);
  element.style.setProperty("--tone-deep", deep);
}
export function toneFromPixels(pixels: Uint8ClampedArray, fallback: ToneName): ToneName {
  const buckets = Array<number>(12).fill(0);
  let count = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i] / 255, g = pixels[i + 1] / 255, b = pixels[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min, light = (max + min) / 2;
    if (pixels[i + 3] < 128 || light < .15 || light > .85 || delta === 0 || delta / (1 - Math.abs(2 * light - 1)) < .25) continue;
    const hue = ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60 + 360) % 360;
    buckets[Math.floor(hue / 30)]++;
    count++;
  }
  const best = Math.max(...buckets);
  if (count < pixels.length / 4 * .1 || best / count < .4) return fallback;
  const hue = buckets.indexOf(best) * 30 + 15;
  return toneNames.reduce((a, b) => Math.min(Math.abs(tones[a][3] - hue), 360 - Math.abs(tones[a][3] - hue)) <= Math.min(Math.abs(tones[b][3] - hue), 360 - Math.abs(tones[b][3] - hue)) ? a : b);
}
export function posterTone(mediaId: string, image: HTMLImageElement, fallback: ToneName): ToneName {
  const cached = cache.get(mediaId);
  if (cached) return cached;
  let tone = fallback;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d");
    if (context) { context.drawImage(image, 0, 0, 32, 32); tone = toneFromPixels(context.getImageData(0, 0, 32, 32).data, fallback); }
  } catch { /* An unreadable image keeps its generated-cover tone. */ }
  cache.set(mediaId, tone);
  return tone;
}
