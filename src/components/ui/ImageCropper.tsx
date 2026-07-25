import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { css } from '@/lib/css';

/**
 * Crop-to-fit for every photo the app accepts.
 *
 * Each surface renders its uploads at one fixed aspect (product cards are 3:4,
 * collection tiles 4:5, and so on) with `object-fit: cover`, so an off-ratio
 * photo silently lost whatever fell outside the box — usually the top of a
 * garment or half a logo. Rather than leave that to chance, the uploader now
 * hands the picker the same frame the app will render in and lets them place
 * the shot inside it. What they confirm is exactly what buyers see.
 *
 * Cropping also re-encodes, which caps a 12 MP phone photo at a sane edge
 * length before it ever reaches Storage.
 */

export type CropPreset = { aspect: number; title: string; hint: string };

/** The aspects the app actually renders uploads at — keep in step with index.css. */
export const CROP: Record<'product' | 'logo' | 'cover' | 'tile', CropPreset> = {
  // .agx-prod-media / .agx-thumb-media — cards, PDP, cart and order lines.
  product: {
    aspect: 3 / 4,
    title: 'Frame your product photo',
    hint: 'Product cards are 3:4. Whatever sits inside this frame is what buyers see.',
  },
  logo: {
    aspect: 1,
    title: 'Frame your logo',
    hint: 'Your logo shows as a square badge on your profile and beside your name.',
  },
  cover: {
    aspect: 16 / 9,
    title: 'Frame your cover',
    hint: 'The cover runs full width across the top of your boutique page.',
  },
  tile: {
    aspect: 4 / 5,
    title: 'Frame the tile picture',
    hint: 'Collection tiles are 4:5, and the Home rail crops this same shot to a circle.',
  },
};

/** Longest edge of the written-out crop. Plenty for a full-bleed cover on a
 *  desktop screen, and a fraction of the megapixels a phone camera hands over. */
const MAX_EDGE = 1600;
const MAX_ZOOM = 4;

type Request = { file: File; preset: CropPreset };

/**
 * `cropImage` opens the frame and resolves with the cropped file, or null if the
 * picker backed out. Render `cropper` anywhere in the component that owns the
 * file input.
 *
 * It lives here rather than in a root provider so the cropper ships inside the
 * seller/admin chunks that upload photos, and never in the buyer bundle.
 */
export function useImageCropper(): {
  cropImage: (file: File | undefined | null, preset: CropPreset) => Promise<File | null>;
  cropper: ReactNode;
} {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<((file: File | null) => void) | null>(null);

  const cropImage = useCallback(
    (file: File | undefined | null, preset: CropPreset) =>
      new Promise<File | null>((resolve) => {
        // Nothing chosen, or something that isn't an image: hand it straight
        // back so the upload path raises its own (better) error.
        if (!file) return resolve(null);
        if (!file.type.startsWith('image/')) return resolve(file);
        pending.current?.(null); // a second pick supersedes the one on screen
        pending.current = resolve;
        setRequest({ file, preset });
      }),
    [],
  );

  const finish = useCallback((result: File | null) => {
    const resolve = pending.current;
    pending.current = null;
    setRequest(null);
    resolve?.(result);
  }, []);

  // A form unmounting mid-crop must not leave its caller awaiting forever.
  useEffect(() => () => {
    pending.current?.(null);
    pending.current = null;
  }, []);

  return {
    cropImage,
    cropper: request ? <CropperModal key={request.file.name + request.file.lastModified} request={request} onDone={finish} /> : null,
  };
}

/** Frame size in CSS px: as large as the viewport allows at the target aspect. */
function frameSize(aspect: number) {
  const maxW = Math.min(window.innerWidth - 52, 400);
  const maxH = Math.min(window.innerHeight - 320, 460);
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w: Math.round(w), h: Math.round(h) };
}

function CropperModal({ request, onDone }: { request: Request; onDone: (file: File | null) => void }) {
  const { file, preset } = request;
  // The blob URL is created in an effect, not in state: StrictMode runs an
  // effect's cleanup once on mount, which would revoke a URL held in state
  // while the <img> was still pointing at it.
  const [url, setUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [frame, setFrame] = useState(() => frameSize(preset.aspect));
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);

  useEffect(() => {
    if (!url) return;
    const img = new Image();
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setFailed(true);
    img.src = url;
  }, [url]);

  useEffect(() => {
    const onResize = () => setFrame(frameSize(preset.aspect));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [preset.aspect]);

  // Scale that just covers the frame; zoom multiplies it, so zoom 1 is always
  // "the whole frame is filled" and the photo can never be panned off it.
  const base = natural ? Math.max(frame.w / natural.w, frame.h / natural.h) : 1;
  const scale = base * zoom;
  const shown = natural ? { w: natural.w * scale, h: natural.h * scale } : { w: 0, h: 0 };

  const clamp = useCallback(
    (o: { x: number; y: number }, s: { w: number; h: number }) => {
      const mx = Math.max(0, (s.w - frame.w) / 2);
      const my = Math.max(0, (s.h - frame.h) / 2);
      return {
        x: Math.min(mx, Math.max(-mx, o.x)),
        y: Math.min(my, Math.max(-my, o.y)),
      };
    },
    [frame],
  );

  // Re-clamp whenever the geometry changes under the current offset.
  useEffect(() => {
    if (!natural) return;
    setOffset((o) => clamp(o, { w: natural.w * base * zoom, h: natural.h * base * zoom }));
  }, [natural, base, zoom, clamp]);

  // ---- drag to pan, pinch to zoom -----------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; zoom: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = null;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];

    if (pts.length >= 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (!gesture.current) gesture.current = { dist, zoom };
      else if (gesture.current.dist > 0) {
        const next = (gesture.current.zoom * dist) / gesture.current.dist;
        setZoom(Math.min(MAX_ZOOM, Math.max(1, next)));
      }
      return;
    }

    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    setOffset((o) => clamp({ x: o.x + dx, y: o.y + dy }, shown));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
  };

  // ---- write the crop out --------------------------------------------------
  const confirm = async () => {
    if (!natural || !url) return;
    setSaving(true);
    try {
      // Frame → source pixels. The photo is centred, then nudged by `offset`,
      // so the visible window starts half a frame either side of that centre.
      const sw = frame.w / scale;
      const sh = frame.h / scale;
      const sx = natural.w / 2 - offset.x / scale - sw / 2;
      const sy = natural.h / 2 - offset.y / scale - sh / 2;

      // Cap the long edge, and never upscale past what was actually selected.
      const widthCap = preset.aspect >= 1 ? MAX_EDGE : MAX_EDGE * preset.aspect;
      const outW = Math.round(Math.min(sw, widthCap));
      const outH = Math.round(outW / preset.aspect);

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, outW);
      canvas.height = Math.max(1, outH);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas');
      ctx.imageSmoothingQuality = 'high';

      const img = new Image();
      img.src = url;
      await img.decode();
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      // PNG sources keep their alpha (logos are usually cut-outs); everything
      // else becomes JPEG, which is what keeps the file small.
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, 0.9));
      if (!blob) throw new Error('no blob');

      const stem = file.name.replace(/\.[^.]+$/, '') || 'photo';
      onDone(new File([blob], `${stem}.${type === 'image/png' ? 'png' : 'jpg'}`, { type }));
    } catch {
      // Canvas is tainted or out of memory — send the original through rather
      // than losing the upload entirely.
      onDone(file);
    }
  };

  const btn = 'height:48px;border-radius:14px;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;flex:1;';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={preset.title}
      style={css('position:fixed;inset:0;z-index:120;background:rgba(24,8,15,.72);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:16px;')}
    >
      <div style={css('width:100%;max-width:440px;background:var(--ag-bg);border-radius:24px;padding:20px;box-shadow:0 30px 70px -30px rgba(0,0,0,.7);max-height:100%;overflow:auto;')}>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:21px;")}>{preset.title}</div>
        <div style={css('color:var(--ag-muted);font-size:12.5px;line-height:1.55;margin-top:4px;')}>{preset.hint}</div>

        {failed ? (
          <div style={css('margin-top:16px;background:var(--ag-bad-bg);border:1px solid #F2C9D2;border-radius:14px;padding:14px;font-size:13px;color:#7A4652;line-height:1.55;')}>
            We couldn’t open that file. Please choose a JPG or PNG photo.
          </div>
        ) : (
          <>
            <div style={css('display:flex;justify-content:center;margin-top:16px;')}>
              <div
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                style={css(`position:relative;width:${frame.w}px;height:${frame.h}px;border-radius:16px;overflow:hidden;background:#241019;touch-action:none;cursor:grab;user-select:none;`)}
              >
                {natural && url && (
                  <img
                    src={url}
                    alt=""
                    draggable={false}
                    style={css(`position:absolute;left:50%;top:50%;width:${shown.w}px;height:${shown.h}px;max-width:none;transform:translate(calc(-50% + ${offset.x}px),calc(-50% + ${offset.y}px));pointer-events:none;`)}
                  />
                )}
                {/* Rule-of-thirds guides, so the frame reads as a viewfinder. */}
                <div style={css('position:absolute;inset:0;pointer-events:none;border:1.5px solid rgba(255,255,255,.55);border-radius:16px;background:linear-gradient(to right,transparent 33.3%,rgba(255,255,255,.22) 33.3% calc(33.3% + 1px),transparent calc(33.3% + 1px) 66.6%,rgba(255,255,255,.22) 66.6% calc(66.6% + 1px),transparent calc(66.6% + 1px)),linear-gradient(to bottom,transparent 33.3%,rgba(255,255,255,.22) 33.3% calc(33.3% + 1px),transparent calc(33.3% + 1px) 66.6%,rgba(255,255,255,.22) 66.6% calc(66.6% + 1px),transparent calc(66.6% + 1px));')} />
              </div>
            </div>

            <div style={css('display:flex;align-items:center;gap:12px;margin-top:14px;')}>
              <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);font-size:19px;")}>image</span>
              <input
                type="range"
                min={1}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                aria-label="Zoom"
                onChange={(e) => setZoom(Number(e.target.value))}
                style={css('flex:1;accent-color:#D6336C;height:24px;')}
              />
              <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:23px;")}>image</span>
            </div>
            <div style={css('text-align:center;color:var(--ag-muted-soft);font-size:11.5px;font-weight:700;margin-top:2px;')}>
              Drag to reposition · pinch or slide to zoom
            </div>
          </>
        )}

        <div style={css('display:flex;gap:10px;margin-top:16px;')}>
          <button type="button" onClick={() => onDone(null)} style={css(`${btn}border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-ink-2);`)}>
            Cancel
          </button>
          {!failed && (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={!natural || saving}
              style={css(`${btn}border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;opacity:${!natural || saving ? 0.6 : 1};`)}
            >
              {saving ? 'Preparing…' : 'Use photo'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
