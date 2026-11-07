const cache = new Map<string, string>();
const number = (value: number): string => String(Math.round(value * 1000) / 1000);

function cached(key: string, create: () => string): string {
  const existing = cache.get(key);
  if (existing !== undefined) return existing;
  const result = create();
  cache.set(key, result);
  return result;
}

export function biscuitPath(radius: number, amplitude: number, lobes: number): string {
  return cached(`b:${radius}:${amplitude}:${lobes}`, () => {
    const center = radius + amplitude;
    const points: string[] = [];
    for (let i = 0; i < 128; i += 1) {
      const theta = 2 * Math.PI * i / 128;
      const r = radius + amplitude * Math.sin(lobes * theta);
      points.push(`${i === 0 ? "M" : "L"} ${number(center + r * Math.cos(theta))} ${number(center + r * Math.sin(theta))}`);
    }
    return `${points.join(" ")} Z`;
  });
}

export function wavePath(width: number, mid: number, amplitude: number, wavelength: number): string {
  return cached(`w:${width}:${mid}:${amplitude}:${wavelength}`, () => {
    const points = [`M 0 ${number(mid)}`];
    for (let x = 1; x < width; x += 1) points.push(`L ${number(x)} ${number(mid + amplitude * Math.sin(x / wavelength))}`);
    points.push(`L ${number(width)} ${number(mid + amplitude * Math.sin(width / wavelength))}`);
    return points.join(" ");
  });
}

export function waterlinePath(width: number, mid: number, amplitude: number, wavelength: number, bottom: number): string {
  return cached(`l:${width}:${mid}:${amplitude}:${wavelength}:${bottom}`, () => `${wavePath(width, mid, amplitude, wavelength)} L ${number(width)} ${number(bottom)} L 0 ${number(bottom)} Z`);
}
