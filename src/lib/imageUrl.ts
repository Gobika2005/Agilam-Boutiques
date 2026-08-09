/**
 * Responsive delivery for Supabase Storage photos.
 *
 * Every product and boutique photo was being served as the raw upload from
 * `/storage/v1/object/public/…` — the exact file the seller's phone produced. On
 * the live catalogue that meant a 2.1 MB PNG behind a 390 px-wide hero slot, and
 * roughly 6.7 MB of images on the home screen alone. Measured on a throttled 4G
 * profile that put the home LCP at 5.9 s and the shop grid at 12.9 s.
 *
 * Supabase serves the same objects through an image transformer at
 * `/storage/v1/render/image/public/…`, which resizes on the fly and negotiates
 * WebP from the browser's `Accept` header. The same hero measures:
 *
 *   original      2,116 KB   png
 *   ?width=400       25 KB   webp
 *   ?width=800       64 KB   webp
 *   ?width=1200      94 KB   webp
 *
 * so the rewrite alone is a ~22× saving on the largest asset, with no upload
 * step, no build step and no change to what sellers do.
 *
 * Nothing here is Supabase-specific to the *caller*: a URL we don't recognise
 * (a seller's external link, a data: URI, one of our own /public assets) is
 * handed back untouched, so this is always safe to wrap around a `src`.
 */

/** Marks a public Storage object URL — the only shape the transformer accepts. */
const PUBLIC_OBJECT = '/storage/v1/object/public/';
const RENDER_IMAGE = '/storage/v1/render/image/public/';

/**
 * Widths we offer the browser, in CSS pixels.
 *
 * Deliberately short. Every distinct width is a separate transform Supabase has
 * to compute and cache, and a device-pixel-ratio of 2 or 3 already multiplies
 * each entry — offering ten widths mostly buys cache misses. These cover a
 * 3-across phone grid (≈120 px), a single-column phone card (≈390 px), a
 * desktop grid tile (≈640 px) and a full-bleed hero or PDP frame.
 *
 * 1600 exists for the one case the other four cannot serve: a photo painted at
 * the full width of the viewport. A 430 px phone at DPR 3 asks for 1290 device
 * pixels and a 620 px PDP column at DPR 2 asks for 1240 — both land on 1280 and
 * fit, but a desktop hero or a tablet at DPR 2 wants more, and without a
 * candidate above it the browser upscales 1280 and the photo goes soft.
 */
const WIDTHS = [240, 480, 800, 1280, 1600] as const;

/**
 * 70 is where WebP stops being visibly lossy on fabric texture, which is the
 * one thing this catalogue's photos have to hold up. Going to 60 saves another
 * ~15% and starts to mottle embroidery; 80 costs ~40% for no visible gain.
 */
const QUALITY = 70;

/**
 * The quality for a photo the buyer is *looking at* rather than scanning past —
 * the PDP frame, a story, an Inspire card. At thumbnail size 70 is invisible;
 * at 390 px and up the embroidery and zari on these shots start to show WebP's
 * ringing, and the buyer is deciding whether to spend ₹3,000 on that texture.
 * The extra bytes buy the one thing the page is selling.
 */
export const QUALITY_DETAIL = 82;

function isTransformable(src: string): boolean {
  return src.includes(PUBLIC_OBJECT);
}

/**
 * One transformed URL at a given width.
 *
 * `resize=contain` keeps the whole frame — the transformer's default would crop
 * to fill the requested box, which on a 4:5 catalogue shot silently guillotines
 * hems and dupatta ends. The CSS `object-fit:cover` on the element still decides
 * the visible crop, and it can only do that correctly if it is handed the whole
 * picture.
 */
export function imageUrl(src: string, width: number, quality: number = QUALITY): string {
  if (!src || !isTransformable(src)) return src;
  return `${src.replace(PUBLIC_OBJECT, RENDER_IMAGE)}?width=${width}&quality=${quality}&resize=contain`;
}

/**
 * A `srcset` across {@link WIDTHS}, or `undefined` when the URL isn't ours to
 * transform (returning an empty string would override the browser's own
 * handling with nothing).
 *
 * Widths larger than `max` are dropped: a 120 px thumbnail has no use for a
 * 1280 px candidate even at DPR 3, and leaving them in invites a retina browser
 * to pick one.
 */
export function imageSrcSet(
  src: string,
  max: number = WIDTHS[WIDTHS.length - 1],
  quality: number = QUALITY,
): string | undefined {
  if (!src || !isTransformable(src)) return undefined;
  const widths = WIDTHS.filter((w) => w <= max);
  if (!widths.length) return undefined;
  return widths.map((w) => `${imageUrl(src, w, quality)} ${w}w`).join(', ');
}

/**
 * The `src` a non-`srcset` browser (or one that ignores our candidates) falls
 * back to. 800 px is the middle of the set: sharp on a phone at DPR 2, and still
 * a twentieth of the original byte count.
 */
export function imageFallback(src: string, quality: number = QUALITY): string {
  return imageUrl(src, 800, quality);
}
