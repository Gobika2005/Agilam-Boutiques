import { useCallback, useEffect, useRef, useState } from 'react';
import { css } from '@/lib/css';

/**
 * Full-screen product photo viewer with zoom.
 *
 * Buyers judge fabric, zari and embroidery from the photo, so the product page
 * needs a real close-up rather than a card-sized crop. This opens over the page
 * and follows the gestures every phone gallery already trains people on:
 *
 *  - double-tap (or double-click) the photo to zoom in on the spot you tapped,
 *    double-tap again to fit it back
 *  - pinch with two fingers, the scroll wheel, the +/− buttons, or `+` / `-`
 *  - drag to pan once zoomed; swipe or use the arrows to change photo when fit
 *  - Escape, the close button, or a tap on the empty space around the photo
 *
 * A *single* tap deliberately does nothing. It used to toggle the zoom, which
 * meant a half-committed swipe or a tap on the next-photo arrow (the arrows sit
 * inside the stage, so their clicks bubbled here) threw the buyer into a random
 * 250% corner of the picture. Zoom is now only ever asked for explicitly.
 */

const MIN = 1;
const MAX = 4;
const STEP = 0.5;
/** A second tap later than this, or further than TAP_SLOP away, is a new tap. */
const DOUBLE_TAP_MS = 320;
const TAP_SLOP = 24;
/** Travel past this and the press is a drag/swipe, not a tap. */
const MOVE_SLOP = 10;
/** Horizontal travel that counts as "next photo, please". */
const SWIPE_MIN = 48;

type Pt = { x: number; y: number };

export function ImageZoom({
  images,
  index,
  title,
  onClose,
  onIndexChange,
}: {
  images: string[];
  index: number;
  title: string;
  onClose: () => void;
  onIndexChange: (i: number) => void;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState<Pt>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState(true);
  /**
   * How far the photo strip is dragged from the current slide, in px.
   *
   * The viewer used to render one `<img>` and swap its `src` on swipe, so
   * changing photo was an instant cut: nothing moved under the finger, and the
   * new picture appeared only once it had decoded. Every slide is now laid out
   * side by side in a track that this offset slides, so a swipe follows the
   * finger and the release animates the rest of the way.
   */
  const [swipeDx, setSwipeDx] = useState(0);
  const swipingRef = useRef(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const zoomed = scale > 1;

  // The gesture handlers fire faster than React re-renders, so a pinch that
  // read `scale` from the closure would compute every step off a stale value.
  // The refs are the live view; state only mirrors them for rendering.
  const scaleRef = useRef(1);
  const offsetRef = useRef<Pt>({ x: 0, y: 0 });

  /** Live pointers on the stage, so one finger pans and two pinch. */
  const pointers = useRef(new Map<number, Pt>());
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pressRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const lastTapRef = useRef<{ t: number; x: number; y: number } | null>(null);
  /** Did the press that is about to produce a `click` travel? A swipe that ends
   *  over the letterboxing beside a portrait photo still fires one, and that
   *  must not be read as "tap the backdrop to close". */
  const lastMovedRef = useRef(false);

  // Keeps a pan from dragging the photo past its own edge. The bound is built
  // from the *image's* laid-out box, not the stage: a tall portrait saree is
  // letterboxed with empty stage either side, and measuring the stage would let
  // it be dragged into that emptiness.
  const clampOffset = useCallback((off: Pt, s: number): Pt => {
    const el = stageRef.current;
    if (!el || s <= 1) return { x: 0, y: 0 };
    const iw = imgRef.current?.offsetWidth || el.clientWidth;
    const ih = imgRef.current?.offsetHeight || el.clientHeight;
    const maxX = Math.max(0, (iw * s - el.clientWidth) / 2);
    const maxY = Math.max(0, (ih * s - el.clientHeight) / 2);
    return {
      x: Math.min(maxX, Math.max(-maxX, off.x)),
      y: Math.min(maxY, Math.max(-maxY, off.y)),
    };
  }, []);

  const setView = useCallback((s: number, o: Pt) => {
    scaleRef.current = s;
    offsetRef.current = o;
    setScale(s);
    setOffset(o);
  }, []);

  const reset = useCallback(() => setView(1, { x: 0, y: 0 }), [setView]);

  /**
   * Zoom to `next`, keeping whatever is under `anchor` (a client point — the
   * tapped spot, the cursor, the middle of a pinch) pinned in place. Zooming
   * about the centre instead would slide the detail you asked about away.
   */
  const zoomTo = useCallback(
    (next: number, anchor?: Pt) => {
      const s0 = scaleRef.current;
      const s = Math.min(MAX, Math.max(MIN, next));
      const el = stageRef.current;
      if (s <= MIN || !el) return setView(s, { x: 0, y: 0 });
      const r = el.getBoundingClientRect();
      const ax = anchor ? anchor.x - (r.left + r.width / 2) : 0;
      const ay = anchor ? anchor.y - (r.top + r.height / 2) : 0;
      const k = s / s0;
      const o0 = offsetRef.current;
      setView(s, clampOffset({ x: ax - k * (ax - o0.x), y: ay - k * (ay - o0.y) }, s));
      setHint(false);
    },
    [clampOffset, setView],
  );

  // Changing photo always returns to a fit view — staying zoomed would drop the
  // buyer into a random corner of the next image.
  const go = useCallback(
    (i: number) => {
      if (i < 0 || i >= images.length) return;
      reset();
      // Dropping the drag offset in the same update as the new index is what
      // makes the slide continue from where the finger let go rather than
      // snapping back first and then animating across.
      swipingRef.current = false;
      setSwipeDx(0);
      onIndexChange(i);
    },
    [images.length, onIndexChange, reset],
  );

  /** Give up on the current swipe and let the strip settle back into place. */
  const cancelSwipe = useCallback(() => {
    swipingRef.current = false;
    setSwipeDx(0);
  }, []);

  // Lock the page behind the viewer so scrolling zooms/pans here, not there.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  // The gesture hint has done its job after a few seconds; leaving it up just
  // covers the photo the buyer came to look at.
  useEffect(() => {
    const t = window.setTimeout(() => setHint(false), 3200);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomTo(scaleRef.current + STEP);
      else if (e.key === '-' || e.key === '_') zoomTo(scaleRef.current - STEP);
      else if (e.key === '0') reset();
      else if (e.key === 'ArrowLeft' && !zoomed) go(index - 1);
      else if (e.key === 'ArrowRight' && !zoomed) go(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, zoomTo, reset, zoomed, go, index]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    // Browsers report a trackpad pinch as ctrl+wheel, with a delta proportional
    // to the pinch, so it gets a continuous factor; a notched mouse wheel gets
    // a fixed step per notch.
    const factor = e.ctrlKey
      ? Math.exp(-e.deltaY * 0.01)
      : e.deltaY < 0 ? 1.2 : 1 / 1.2;
    zoomTo(scaleRef.current * factor, { x: e.clientX, y: e.clientY });
  };

  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const twoPointers = () => Array.from(pointers.current.values()) as [Pt, Pt];

  const onPointerDown = (e: React.PointerEvent) => {
    if (pointers.current.size >= 2) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Capture on the stage, not the target: the finger routinely slides off the
    // photo onto the backdrop mid-pan, and without this the move events stop.
    stageRef.current?.setPointerCapture?.(e.pointerId);

    if (pointers.current.size === 2) {
      const [a, b] = twoPointers();
      pinchRef.current = { dist: dist(a, b) || 1, scale: scaleRef.current };
      // A pinch is neither a tap, a pan, nor a swipe.
      pressRef.current = null;
      dragRef.current = null;
      setDragging(false);
      cancelSwipe();
      return;
    }

    pressRef.current = { x: e.clientX, y: e.clientY, moved: false };
    if (!zoomed) return;
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offsetRef.current.x, oy: offsetRef.current.y };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pinch = pinchRef.current;
    if (pinch && pointers.current.size === 2) {
      const [a, b] = twoPointers();
      zoomTo(pinch.scale * (dist(a, b) / pinch.dist), mid(a, b));
      return;
    }

    const p = pressRef.current;
    if (p && (Math.abs(e.clientX - p.x) > MOVE_SLOP || Math.abs(e.clientY - p.y) > MOVE_SLOP)) p.moved = true;

    // Fit view: the drag carries the whole strip, so the next photo is already
    // sliding in under the finger before it lifts. Zoomed, the same drag pans
    // the photo (below) — there is nowhere else for it to go.
    if (p && !zoomed && images.length > 1) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      // Only commit to a swipe once it is clearly horizontal, so a vertical
      // flick doesn't drag the strip sideways on its way past.
      if (!swipingRef.current && (Math.abs(dx) <= MOVE_SLOP || Math.abs(dx) <= Math.abs(dy))) return;
      swipingRef.current = true;
      // Rubber band at the two ends: the strip still gives, so the gesture is
      // acknowledged, but it visibly resists rather than pretending there is a
      // photo there.
      const atEdge = (dx > 0 && index === 0) || (dx < 0 && index === images.length - 1);
      setSwipeDx(atEdge ? dx * 0.32 : dx);
      return;
    }

    const d = dragRef.current;
    if (!d) return;
    const next = clampOffset({ x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }, scaleRef.current);
    offsetRef.current = next;
    setOffset(next);
  };

  const endPress = (e: React.PointerEvent, cancelled: boolean) => {
    pointers.current.delete(e.pointerId);
    const wasPinching = !!pinchRef.current;

    if (wasPinching) {
      pinchRef.current = null;
      // Hand the gesture over to the finger still down so the pan continues
      // instead of freezing until they lift and press again.
      const [rest] = Array.from(pointers.current.values());
      dragRef.current = rest && zoomed
        ? { x: rest.x, y: rest.y, ox: offsetRef.current.x, oy: offsetRef.current.y }
        : null;
      setDragging(!!dragRef.current);
      pressRef.current = null;
      return;
    }

    const p = pressRef.current;
    lastMovedRef.current = !!p?.moved;
    pressRef.current = null;
    dragRef.current = null;
    setDragging(false);
    if (!p || cancelled) {
      cancelSwipe();
      return;
    }

    if (p.moved) {
      // A flick across a fit photo browses the set, the way the product page's
      // own gallery does. While zoomed the same drag is a pan, handled above.
      if (zoomed) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      const next = index + (dx < 0 ? 1 : -1);
      // Past the threshold the strip carries on to the next photo; short of it
      // (or at either end) it eases back — either way it animates, never jumps.
      if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) && next >= 0 && next < images.length) go(next);
      else cancelSwipe();
      return;
    }
    cancelSwipe();

    // A clean tap. Only the second one within the double-tap window zooms;
    // a lone tap is left alone so half-swipes and stray taps stay harmless.
    const now = Date.now();
    const last = lastTapRef.current;
    if (last && now - last.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < TAP_SLOP) {
      lastTapRef.current = null;
      if (zoomed) reset();
      else zoomTo(2.5, { x: e.clientX, y: e.clientY });
      return;
    }
    lastTapRef.current = { t: now, x: e.clientX, y: e.clientY };
  };

  const pct = Math.round(scale * 100);

  const ctlStyle = (disabled = false) =>
    css(
      `width:44px;height:44px;flex:none;border:none;border-radius:14px;background:rgba(255,255,255,.14);` +
        `color:#fff;cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? 0.35 : 1};` +
        'display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);',
    );

  // The arrows live inside the stage for positioning, so every pointer event on
  // them has to be stopped here or the stage reads them as taps on the photo —
  // two quick presses of "next" would otherwise register as a double-tap zoom.
  const swallow = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onPointerMove: (e: React.PointerEvent) => e.stopPropagation(),
    onPointerUp: (e: React.PointerEvent) => e.stopPropagation(),
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} — photo viewer`}
      onClick={onClose}
      style={css('position:fixed;inset:0;z-index:1200;background:rgba(20,8,14,.96);display:flex;flex-direction:column;animation:agx-fade .2s ease;')}
    >
      {/* Top bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={css('flex:none;display:flex;align-items:center;gap:12px;padding:14px clamp(12px,3vw,24px);color:#fff;')}
      >
        <div style={css('flex:1;min-width:0;')}>
          <div style={css('font-weight:800;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{title}</div>
          <div style={css("font-family:'IBM Plex Mono',monospace;font-size:11px;opacity:.65;margin-top:2px;")}>
            Photo {index + 1} of {images.length} · {pct}%
          </div>
        </div>
        <button onClick={onClose} aria-label="Close viewer" style={ctlStyle()}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:24px;")}>close</span>
        </button>
      </div>

      {/* Stage */}
      <div
        ref={stageRef}
        // Only the empty space around the photo closes the viewer; clicks on the
        // photo and on the arrows are theirs to handle. The strip now covers the
        // stage, so "empty space" is anything that isn't the photo itself —
        // except at the end of a swipe, which is not a tap on the backdrop.
        onClick={(e) => {
          e.stopPropagation();
          if (!lastMovedRef.current && !(e.target instanceof HTMLImageElement)) onClose();
        }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPress(e, false)}
        onPointerCancel={(e) => endPress(e, true)}
        style={css(
          `flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden;` +
            // `none`, not `pan-y`: the swipe and the pinch are ours to read, and
            // the page behind is locked anyway so there is nothing to scroll.
            `touch-action:none;cursor:${zoomed ? (dragging ? 'grabbing' : 'grab') : 'zoom-in'};`,
        )}
      >
        {/* The whole set, side by side. Rendering only the current photo meant
            every "next" was a blank beat while the new file decoded; the
            neighbours are decoded and laid out before they are ever asked for,
            which is what makes the slide read as one continuous movement. */}
        <div
          style={{
            // The moving parts stay out of `css()`: it memoises by string, and a
            // gesture that writes a new transform every frame would put a fresh
            // entry in that cache on each one.
            ...css('position:absolute;inset:0;display:flex;align-items:center;will-change:transform;'),
            transform: `translate3d(calc(${-index * 100}% + ${swipeDx}px),0,0)`,
            // No transition while the finger is down — the strip has to sit
            // exactly under it. On release the same property animates home.
            transition: swipingRef.current ? 'none' : 'transform .34s cubic-bezier(.22,.72,.2,1)',
          }}
        >
          {images.map((im, i) => {
            const active = i === index;
            return (
              <div
                key={`${im}-${i}`}
                style={css('flex:0 0 100%;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;')}
              >
                <img
                  ref={active ? imgRef : undefined}
                  src={im}
                  alt={`${title} — photo ${i + 1}`}
                  draggable={false}
                  decoding="async"
                  style={{
                    ...css('max-width:100%;max-height:100%;object-fit:contain;user-select:none;-webkit-user-drag:none;transform-origin:center center;'),
                    // Only the photo on screen carries the zoom — the others are
                    // always at rest, ready to be swiped to.
                    transform: active ? `translate(${offset.x}px,${offset.y}px) scale(${scale})` : 'none',
                    // Easing a zoom step looks good; easing a drag or a pinch
                    // makes the photo lag behind the finger, so live gestures
                    // drop the transition.
                    transition: dragging || pinchRef.current ? 'none' : 'transform .18s cubic-bezier(.2,.7,.2,1)',
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Photo stepping, only while fit — panning owns the drag when zoomed. */}
        {images.length > 1 && !zoomed && (
          <>
            {index > 0 && (
              <button {...swallow} onClick={(e) => { e.stopPropagation(); go(index - 1); }} aria-label="Previous photo" style={{ ...ctlStyle(), ...css('position:absolute;left:clamp(8px,2vw,20px);top:50%;transform:translateY(-50%);') }}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:24px;")}>chevron_left</span>
              </button>
            )}
            {index < images.length - 1 && (
              <button {...swallow} onClick={(e) => { e.stopPropagation(); go(index + 1); }} aria-label="Next photo" style={{ ...ctlStyle(), ...css('position:absolute;right:clamp(8px,2vw,20px);top:50%;transform:translateY(-50%);') }}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:24px;")}>chevron_right</span>
              </button>
            )}
          </>
        )}

        {/* Gesture hint. Nothing here is discoverable by looking at a photo, so
            it is said once and then gets out of the way. */}
        {hint && !zoomed && (
          <div
            aria-hidden="true"
            style={css(
              'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);pointer-events:none;' +
                "font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.04em;white-space:nowrap;" +
                'color:rgba(255,255,255,.82);background:rgba(0,0,0,.42);backdrop-filter:blur(6px);' +
                'padding:7px 13px;border-radius:999px;animation:agx-fade .25s ease;',
            )}
          >
            Double-tap to zoom{images.length > 1 ? ' · swipe for more photos' : ''}
          </div>
        )}
      </div>

      {/* Zoom controls */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={css('flex:none;display:flex;align-items:center;justify-content:center;gap:10px;padding:14px clamp(12px,3vw,24px) calc(18px + env(safe-area-inset-bottom));')}
      >
        <button onClick={() => zoomTo(scale - STEP)} disabled={scale <= MIN} aria-label="Zoom out" style={ctlStyle(scale <= MIN)}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:24px;")}>zoom_out</span>
        </button>
        <button
          onClick={reset}
          disabled={!zoomed}
          aria-label={zoomed ? 'Fit photo to screen' : 'Photo is fit to screen'}
          style={css(`height:44px;padding:0 18px;border:none;border-radius:14px;background:rgba(255,255,255,.14);color:#fff;font-weight:800;font-size:13px;cursor:${zoomed ? 'pointer' : 'default'};opacity:${zoomed ? 1 : 0.5};backdrop-filter:blur(8px);`)}
        >
          {pct}%
        </button>
        <button onClick={() => zoomTo(scale + STEP)} disabled={scale >= MAX} aria-label="Zoom in" style={ctlStyle(scale >= MAX)}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:24px;")}>zoom_in</span>
        </button>
      </div>
    </div>
  );
}
