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

/** Mean colour of the pixels a mask accepts, or null if it accepts none. */
function regionMean(
  data: Uint8ClampedArray,
  S: number,
  keep: (x: number, y: number) => boolean,
): { mean: Rgb; spread: number } | null {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  const px: Rgb[] = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!keep(x, y)) continue;
      const i = (y * S + x) * 4;
      if (data[i + 3] < 125) continue;
      const p = { r: data[i], g: data[i + 1], b: data[i + 2] };
      px.push(p);
      sr += p.r;
      sg += p.g;
      sb += p.b;
      n++;
    }
  }
  if (n === 0) return null;
  const mean = { r: sr / n, g: sg / n, b: sb / n };
  const spread = px.reduce((s, p) => s + distance(p, mean), 0) / n;
  return { mean, spread };
}

/**
 * The backdrop colour of a product shot, estimated from its outer frame, or
 * null when there is no separable backdrop to subtract.
 *
 * Studio boutique shots sit the piece against a uniform sweep, so a tight,
 * uniform border ring looks like a backdrop. But a dress photographed close
 * enough to fill the frame *also* gives a uniform ring — of the dress itself —
 * and subtracting that is exactly the bug that made a black dress vanish and
 * left only its embroidery. So the ring only counts as backdrop when it is both
 * uniform AND clearly different from the centre of the frame (the garment). If
 * the border matches the middle, the subject fills the frame: nothing to remove.
 */
function estimateBackdrop(data: Uint8ClampedArray, S: number): Rgb | null {
  const band = Math.max(2, Math.round(S * 0.09)); // outer ~9% ring
  const inset = Math.round(S * 0.3); // central 40% square = the garment
  const border = regionMean(data, S, (x, y) => x < band || x >= S - band || y < band || y >= S - band);
  const centre = regionMean(data, S, (x, y) => x >= inset && x < S - inset && y >= inset && y < S - inset);
  if (!border) return null;
  // A loose ring (a busy edge, a patterned prop) is not a clean backdrop.
  if (border.spread >= 42) return null;
  // A border that matches the centre means the garment runs edge to edge —
  // there is no backdrop distinct from the subject, so subtract nothing.
  if (centre && distance(border.mean, centre.mean) < 45) return null;
  return border.mean;
}

/**
 * Weighted colour buckets of a product photo, heaviest first, or [] on failure.
 *
 * Downscales to a small grid, then buckets pixels by a coarse RGB quantisation.
 * Three biases keep the *garment* — not its backdrop — winning, because the old
 * "drop near-white/near-black" rule let every tinted studio sweep (grey, cream,
 * pastel) survive and outvote the dress on area alone:
 *
 *   1. the backdrop colour is read off the frame and pixels matching it are
 *      suppressed — so a grey or cream sweep is removed, not just a white one —
 *      but only when the frame differs from the centre, so a dress filling the
 *      frame is never mistaken for its own backdrop;
 *   2. pixels are centre-weighted, since the garment sits in the middle and the
 *      sweep at the edges;
 *   3. weighting is area-first: a large neutral garment (black, grey, cream)
 *      keeps a solid base weight, and saturation only nudges vivid pixels up, so
 *      a black dress is no longer outvoted by a fleck of bright embroidery.
 */
async function paletteBuckets(file: File): Promise<Bucket[]> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return [];
  }
  const S = 64;
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

  const backdrop = estimateBackdrop(data, S);
  const cx = (S - 1) / 2;
  const cy = (S - 1) / 2;
  const maxDist = Math.hypot(cx, cy);

  const buckets = new Map<number, Bucket>();
  for (let p = 0, i = 0; i < data.length; i += 4, p++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 125) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (max + min) / 2;
    if (lum > 244 && sat < 0.1) continue; // blown-out white paper only
    if (lum < 8) continue; // crushed-black shadow only — a black *garment* must survive

    // Central pixels are the garment; edge pixels are the sweep. A smooth
    // radial falloff (1.0 at centre → ~0.2 at the corners) lets the middle win.
    const x = p % S;
    const y = (p / S) | 0;
    const centreW = 1 - 0.8 * (Math.hypot(x - cx, y - cy) / maxDist);

    // Suppress — don't hard-drop — pixels that match the estimated backdrop, so
    // a shadow line on the sweep can't be mistaken for the dress, yet a garment
    // that happens to share the backdrop's family still registers faintly.
    let bgFactor = 1;
    if (backdrop && distance({ r, g, b }, backdrop) < 30) bgFactor = 0.05;

    // Area first, colourfulness second. A large black or grey garment must
    // out-total a fleck of bright embroidery, so neutrals keep a solid base
    // weight and saturation only nudges the vivid pixels up — the old formula
    // gave neutrals almost nothing, which is why a black dress lost to its trim.
    const w = (0.7 + 0.6 * sat) * centreW * bgFactor;
    if (w <= 0.001) continue;
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
