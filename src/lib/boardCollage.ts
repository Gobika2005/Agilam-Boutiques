/**
 * The picture a shortlist shares — all the pieces on it, not just the first.
 *
 * ── Why ─────────────────────────────────────────────────────────────────────
 * "Ask my people" sends a link into a family WhatsApp group. Web Share Level 2
 * lets us attach an image so the message arrives looking like something rather
 * than a naked URL (see `@/lib/share`), but attaching only the FIRST piece
 * misrepresents the ask: the message says "4 options" and shows one saree. The
 * relative has to open the link to learn what they are even choosing between.
 *
 * So this draws every piece into one square image. The group sees the whole
 * choice in the chat list, before anyone taps anything — which is exactly the
 * screenshot-collage people already make by hand, and the reason they make it.
 *
 * ── Numbers ─────────────────────────────────────────────────────────────────
 * Each tile is numbered, and the board pages number their pieces the same way.
 * That is what lets the conversation start in WhatsApp — "2 is the nicest" is a
 * reply someone can send from the chat without opening anything, and it still
 * means something when they do.
 *
 * ── Why fetch-then-draw, never `img.src = remoteUrl` ────────────────────────
 * Drawing a cross-origin image taints the canvas, and a tainted canvas throws
 * `SecurityError` from `toBlob()` — the export we exist to produce. Fetching
 * each photo as a blob first (the same CORS request `share.ts` already makes to
 * attach a single product photo) and drawing from a `blob:` URL keeps the
 * canvas clean, because by then the bytes are same-origin.
 *
 * ── Failure is always silent ────────────────────────────────────────────────
 * Every path returns `null` rather than throwing: a CORS-blocked CDN, an
 * offline phone, a browser without `toBlob`. The share then falls back to a
 * single photo and then to text, exactly as it did before. A collage is a nicer
 * message, never a requirement for sending one.
 */
import { imageUrl } from '@/lib/imageUrl';

/** Square: the one aspect that previews without cropping everywhere it lands. */
const SIZE = 1080;
const GUTTER = 10;

/**
 * Beyond nine tiles each piece is too small to judge, and judging them is the
 * entire point. The rest become a "+N" badge on the last cell.
 */
const MAX_TILES = 9;

/**
 * Per-tile source width. Tiles are at most 540 px on the canvas, so 800 covers
 * the largest of them with room for the device pixel ratio, and keeps a
 * nine-photo fetch to a few hundred kB rather than several megabytes.
 */
const TILE_SOURCE_WIDTH = 800;

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Where each tile sits.
 *
 * Chosen so no layout ever leaves a hole, and so the crop stays kind to a
 * garment: two pieces become columns rather than rows, because cropping a saree
 * horizontally reads far better than lopping off its top and bottom.
 */
/**
 * Rows of `cols`, where a short final row spreads its tiles across the full
 * width instead of leaving a hole.
 *
 * Deriving the widths per row is what makes that safe. The first version of
 * this special-cased each count and widened one tile to close the gap, which
 * silently drew tile 7 straight over tile 8 on an eight-piece board — the
 * widened cell grew into a neighbour whose x was still computed from the
 * uniform column pitch. Here a row's tiles only ever divide that row.
 */
function grid(count: number, cols: number): Rect[] {
  const rows = Math.ceil(count / cols);
  const rowH = (SIZE - GUTTER * (rows - 1)) / rows;
  const rects: Rect[] = [];

  for (let row = 0; row < rows; row++) {
    const start = row * cols;
    const inRow = Math.min(cols, count - start);
    const cellW = (SIZE - GUTTER * (inRow - 1)) / inRow;
    for (let col = 0; col < inRow; col++) {
      rects.push({
        x: col * (cellW + GUTTER),
        y: row * (rowH + GUTTER),
        w: cellW,
        h: rowH,
      });
    }
  }
  return rects;
}

function layout(count: number): Rect[] {
  const half = (SIZE - GUTTER) / 2;

  switch (count) {
    case 1:
      return [{ x: 0, y: 0, w: SIZE, h: SIZE }];
    case 2:
      // Columns, not rows: cropping a saree in from the sides reads far better
      // than lopping off its top and bottom.
      return [
        { x: 0, y: 0, w: half, h: SIZE },
        { x: half + GUTTER, y: 0, w: half, h: SIZE },
      ];
    case 3:
      // One hero and two beside it — usually the real shape of a three-way
      // decision ("this one, or these?").
      return [
        { x: 0, y: 0, w: half, h: SIZE },
        { x: half + GUTTER, y: 0, w: half, h: half },
        { x: half + GUTTER, y: half + GUTTER, w: half, h: half },
      ];
    case 4:
      return grid(4, 2);
    default:
      return grid(count, 3);
  }
}

/** Fetch one photo as an element that is safe to draw. Never throws. */
async function loadTile(src: string): Promise<HTMLImageElement | null> {
  if (!src) return null;
  let objectUrl: string | null = null;
  try {
    const res = await fetch(imageUrl(src, TILE_SOURCE_WIDTH), { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;

    objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    const url = objectUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('decode failed'));
      img.src = url;
    });
    return img;
  } catch {
    return null;
  } finally {
    // Safe the moment decode resolved; the bitmap is retained by the element.
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** `object-fit: cover`, in canvas terms. */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, r: Rect) {
  const scale = Math.max(r.w / img.width, r.h / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  // Anchored slightly above centre: on a garment shot the interesting half is
  // the top, and a dead-centre crop tends to cut the neckline.
  const x = r.x + (r.w - w) / 2;
  const y = r.y + (r.h - h) * 0.35;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.drawImage(img, x, y, w, h);
  ctx.restore();
}

/** The numbered disc, so the group can say "number 2" without opening the link. */
function drawBadge(ctx: CanvasRenderingContext2D, r: Rect, label: string) {
  const radius = Math.max(20, Math.min(r.w, r.h) * 0.085);
  const cx = r.x + radius + 14;
  const cy = r.y + radius + 14;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.94)';
  ctx.shadowColor = 'rgba(0,0,0,.28)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = '#B02454';
  ctx.font = `700 ${Math.round(radius * 1.15)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy + 1);
  ctx.restore();
}

/** The "+3" tile when a board holds more pieces than the grid can show. */
function drawOverflow(ctx: CanvasRenderingContext2D, r: Rect, extra: number) {
  ctx.save();
  ctx.fillStyle = '#F6E6EC';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.fillStyle = '#B02454';
  ctx.font = `700 ${Math.round(Math.min(r.w, r.h) * 0.26)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`+${extra}`, r.x + r.w / 2, r.y + r.h / 2);
  ctx.restore();
}

/**
 * Build the share image for a board.
 *
 * `urls` must be in the same order the board shows, because the numbers drawn
 * here are the numbers the buyer and her family will refer to.
 *
 * Returns `null` for anything that would make the picture wrong or impossible —
 * no photos loaded, no canvas support, an export the browser refused — so the
 * caller can fall back rather than send something broken.
 */
export async function buildBoardCollage(urls: string[], boardTitle = 'shortlist'): Promise<File | null> {
  if (typeof document === 'undefined' || urls.length === 0) return null;

  /*
   * The "+N" tile occupies a cell, so it costs a photo. Slicing to MAX_TILES
   * and then painting over the last one made the badge lie: a twelve-piece
   * board showed eight photos and claimed "+3" when four were missing. When
   * there is overflow, only MAX_TILES - 1 photos are drawn and the count covers
   * everything the grid does not show.
   */
  const overflowing = urls.length > MAX_TILES;
  const cells = overflowing ? MAX_TILES : urls.length;
  const shown = urls.slice(0, overflowing ? MAX_TILES - 1 : urls.length);
  const extra = urls.length - shown.length;

  try {
    const loaded = await Promise.all(shown.map(loadTile));
    // A hole where a photo should be is worse than no collage: the numbering
    // would no longer match the board. Fall back instead.
    if (loaded.some((img) => img === null)) return null;

    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Literal hex rather than an `--ag-*` token, deliberately: this is a
    // rasterised image that leaves the app and lands in WhatsApp, where there
    // is no theme to follow. Reading a CSS variable here would bake whichever
    // theme the sender happened to be using into a picture everyone else sees.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, SIZE, SIZE);

    const rects = layout(cells);
    loaded.forEach((img, i) => {
      if (img) drawCover(ctx, img, rects[i]);
      drawBadge(ctx, rects[i], String(i + 1));
    });
    // Its own cell, after the photos — never on top of one.
    if (overflowing) drawOverflow(ctx, rects[cells - 1], extra);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.86);
    });
    if (!blob) return null;

    const safe =
      boardTitle.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'shortlist';
    return new File([blob], `${safe}.jpg`, { type: 'image/jpeg' });
  } catch {
    return null;
  }
}
