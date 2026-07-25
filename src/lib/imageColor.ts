/**
 * Client-side dominant-colour detection for the seller's product photo.
 *
 * Reads the cropped cover File the seller just picked, finds the garment's
 * dominant colour, and maps it to the nearest colour in the managed taxonomy —
 * so the form can *suggest* a colour without a server round-trip or an API bill.
 * It only ever suggests: the seller taps to accept, and an empty result (a
 * white-on-white shot, a decode failure) simply offers nothing.
 *
 * Extraction runs on the local File rather than the uploaded Supabase URL on
 * purpose: a same-origin canvas stays untainted, so getImageData works; a
 * cross-origin storage URL would taint the canvas and throw.
 */

type Rgb = { r: number; g: number; b: number };

const hexToRgb = (hex: string): Rgb | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

const rgbToHex = ({ r, g, b }: Rgb) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * Perceptual-ish colour distance (the "redmean" weighting), in intuitive units
 * (√ of the weighted sum). Cheap, and far closer to how the eye reads difference
 * than a plain RGB euclidean — which matters both for snapping a photographed
 * maroon onto the nearest swatch and for deciding two palette colours are
 * genuinely different rather than two shades of one.
 */
const distance = (a: Rgb, b: Rgb): number => {
  const rbar = (a.r + b.r) / 2;
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt((2 + rbar / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rbar) / 256) * db * db);
};

type Bucket = { r: number; g: number; b: number; w: number };

/**
 * Weighted colour buckets of a product photo, heaviest first, or [] on failure.
 *
 * Downscales to a small grid, then buckets pixels by a coarse RGB quantisation.
 * Two deliberate biases keep the *garment* — not its backdrop — winning:
 * near-white and near-black pixels are dropped (the white studio backdrop most
 * boutique shots use), and saturated pixels carry more weight than washed-out
 * ones, so a small vivid saree outvotes a large pale background.
 */
async function paletteBuckets(file: File): Promise<Bucket[]> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return [];
  }
  const S = 48;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close?.();
    return [];
  }
  ctx.drawImage(bitmap, 0, 0, S, S);
  bitmap.close?.();

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, S, S).data;
  } catch {
    return [];
  }

  const buckets = new Map<number, Bucket>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 125) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (max + min) / 2;
    if (lum > 238 && sat < 0.12) continue; // white/paper backdrop
    if (lum < 14) continue; // near-black shadow
    const w = 0.25 + sat; // neutrals still count, saturated colours count more
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5); // 8 levels/channel
    const bkt = buckets.get(key) ?? { r: 0, g: 0, b: 0, w: 0 };
    bkt.r += r * w;
    bkt.g += g * w;
    bkt.b += b * w;
    bkt.w += w;
    buckets.set(key, bkt);
  }
  return [...buckets.values()].sort((x, y) => y.w - x.w);
}

/**
 * The main colours of a product photo, heaviest first, as hex strings.
 *
 * Walks the weighted buckets and greedily keeps ones that are both substantial
 * (a real share of the photo, not a stray speck) and perceptually distinct from
 * the colours already kept — so a two-tone saree returns both its body and its
 * border, while a hundred shades of one maroon collapse to a single entry. A
 * genuinely cream/white piece may yield []; that is fine — no suggestion is
 * better than a wrong one.
 */
export async function dominantColorsHex(file: File, maxColors = 4): Promise<string[]> {
  const buckets = await paletteBuckets(file);
  if (buckets.length === 0) return [];
  const totalW = buckets.reduce((s, b) => s + b.w, 0);

  const picked: Rgb[] = [];
  for (const b of buckets) {
    if (b.w < totalW * 0.04) break; // heaviest-first, so once we're under 4% we're done
    const rgb = { r: Math.round(b.r / b.w), g: Math.round(b.g / b.w), b: Math.round(b.b / b.w) };
    if (picked.some((p) => distance(p, rgb) < 40)) continue; // a shade of one we already have
    picked.push(rgb);
    if (picked.length >= maxColors) break;
  }
  return picked.map(rgbToHex);
}

/** Name of the taxonomy colour nearest to `hex`, or null if none have swatches. */
export function nearestColorName(hex: string, colors: { name: string; hex: string }[]): string | null {
  const target = hexToRgb(hex);
  if (!target) return null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const opt of colors) {
    const rgb = hexToRgb(opt.hex);
    if (!rgb) continue;
    const d = distance(target, rgb);
    if (d < bestD) {
      bestD = d;
      best = opt.name;
    }
  }
  return best;
}
