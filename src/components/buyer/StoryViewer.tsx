import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { TONES, fmt } from '@/data/demo';

export type StorySlide = {
  image: string;
  productId: string;
  title: string;
  price: number;
  mrp: number | null;
  tone: number;
};

export type Story = {
  boutiqueId: string;
  name: string;
  logo?: string;
  verified: boolean;
  city: string;
  followed: boolean;
  badge?: 'NEW' | 'OFFERS' | 'TRENDING';
  slides: StorySlide[];
};

const SLIDE_MS = 4200;

/**
 * Full-screen story viewer.
 *
 * Behaves the way people already expect: slides auto-advance with a progress bar
 * each, tap the right half to skip forward and the left half to go back, press
 * and hold to pause, and running past the last slide moves to the next shop.
 * Every slide is a real piece, so the whole thing is one tap from the product.
 *
 * Portalled to the body: the app header sets `backdrop-filter`, which would make
 * it a containing block for a fixed-position descendant rendered inside it.
 */
export function StoryViewer({
  stories,
  index,
  onIndexChange,
  onClose,
}: {
  stories: Story[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const story = stories[index];
  const [slide, setSlide] = useState(0);
  const [paused, setPaused] = useState(false);
  // Progress of the current slide, 0–1. Driven by rAF so the bar stays smooth
  // and pausing is exact rather than snapping to the nearest interval tick.
  const [progress, setProgress] = useState(0);
  const holdRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => setSlide(0), [index]);

  const next = useCallback(() => {
    if (!story) return;
    if (slide < story.slides.length - 1) {
      setSlide((s) => s + 1);
    } else if (index < stories.length - 1) {
      onIndexChange(index + 1);
    } else {
      onClose();
    }
  }, [story, slide, index, stories.length, onIndexChange, onClose]);

  const previous = useCallback(() => {
    if (slide > 0) setSlide((s) => s - 1);
    else if (index > 0) onIndexChange(index - 1);
  }, [slide, index, onIndexChange]);

  // Auto-advance.
  useEffect(() => {
    setProgress(0);
    if (paused) return;
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / SLIDE_MS);
      setProgress(p);
      if (p >= 1) next();
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [slide, index, paused, next]);

  // Lock the page behind the viewer and wire the keyboard.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') previous();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, next, previous]);

  if (!story) return null;
  const current = story.slides[slide];
  const hasMrp = !!current.mrp && current.mrp > current.price;

  // Press-and-hold pauses; a quick tap advances. The 220ms threshold is long
  // enough not to fire on a normal tap and short enough to feel immediate.
  const onPressStart = () => {
    holdRef.current = setTimeout(() => setPaused(true), 220);
  };
  const onPressEnd = (advance: () => void) => {
    clearTimeout(holdRef.current);
    if (paused) setPaused(false);
    else advance();
  };

  const openProduct = () => {
    onClose();
    navigate(`/products/${current.productId}`);
  };

  return createPortal(
    <div style={css('position:fixed;inset:0;z-index:1300;background:#140810;display:flex;flex-direction:column;animation:agx-fade .18s ease;')}>
      {/* ── Photo ── */}
      <div style={css(`position:absolute;inset:0;background:${TONES[current.tone % TONES.length]};`)}>
        <ImageSlot src={current.image} placeholder={current.title} alt={current.title} className="agx-prod-fill" />
        <div style={css('position:absolute;inset:0;background:linear-gradient(180deg,rgba(20,8,16,.75) 0%,rgba(20,8,16,0) 26%,rgba(20,8,16,0) 52%,rgba(20,8,16,.85) 100%);')} />
      </div>

      {/* ── Tap zones ── */}
      <div style={css('position:absolute;inset:0;display:flex;')}>
        <div
          onPointerDown={onPressStart}
          onPointerUp={() => onPressEnd(previous)}
          onPointerLeave={() => clearTimeout(holdRef.current)}
          style={css('flex:1;')}
          aria-label="Previous"
        />
        <div
          onPointerDown={onPressStart}
          onPointerUp={() => onPressEnd(next)}
          onPointerLeave={() => clearTimeout(holdRef.current)}
          style={css('flex:2;')}
          aria-label="Next"
        />
      </div>

      {/* ── Progress + identity ── */}
      <div style={css('position:relative;padding:calc(10px + env(safe-area-inset-top)) 12px 0;pointer-events:none;')}>
        <div style={css('display:flex;gap:4px;')}>
          {story.slides.map((_, i) => (
            <span key={i} style={css('flex:1;height:2.5px;border-radius:2px;background:rgba(255,255,255,.3);overflow:hidden;')}>
              <span style={css(`display:block;height:100%;background:var(--ag-surface);width:${i < slide ? 100 : i === slide ? progress * 100 : 0}%;`)} />
            </span>
          ))}
        </div>

        <div style={css('display:flex;align-items:center;gap:11px;margin-top:13px;pointer-events:auto;')}>
          <BoutiqueLogo name={story.name} src={story.logo} size={38} ring={2} />
          <div style={css('flex:1;min-width:0;')}>
            <div style={css('display:flex;align-items:center;gap:5px;')}>
              <span style={css('font-weight:800;font-size:14px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{story.name}</span>
              {story.verified && <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:#7FC4F5;flex:none;")}>verified</span>}
              {story.badge && (
                <span className="agx-eyebrow" style={css('font-size:7.5px;color:#F4D9A6;border:1px solid rgba(244,217,166,.5);border-radius:999px;padding:2px 7px;flex:none;')}>
                  {story.badge}
                </span>
              )}
            </div>
            <div style={css('font-size:11.5px;color:rgba(255,255,255,.7);margin-top:1px;')}>
              {story.city}{paused ? ' · paused' : ''}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close stories"
            style={css('width:38px;height:38px;flex:none;border:none;border-radius:12px;background:rgba(255,255,255,.16);backdrop-filter:blur(8px);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;')}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:22px;")}>close</span>
          </button>
        </div>
      </div>

      {/* ── The piece ── */}
      <div style={css('position:relative;margin-top:auto;padding:0 14px calc(20px + env(safe-area-inset-bottom));pointer-events:none;')}>
        <button
          onClick={openProduct}
          style={css('pointer-events:auto;width:100%;display:flex;align-items:center;gap:13px;padding:12px 14px;border:none;border-radius:20px;background:rgba(255,255,255,.14);backdrop-filter:blur(18px) saturate(1.3);cursor:pointer;text-align:left;border:1px solid rgba(255,255,255,.2);')}
        >
          <span style={css('flex:1;min-width:0;')}>
            <span style={css('display:block;font-weight:800;font-size:15px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>
              {current.title}
            </span>
            <span style={css('display:flex;align-items:baseline;gap:8px;margin-top:3px;')}>
              <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:19px;color:#F4D9A6;")}>{fmt(current.price)}</span>
              {hasMrp && (
                <span style={css('font-size:12.5px;color:rgba(255,255,255,.6);text-decoration:line-through;')}>{fmt(current.mrp as number)}</span>
              )}
            </span>
          </span>
          <span style={css('flex:none;display:flex;align-items:center;gap:6px;height:42px;padding:0 16px;border-radius:14px;background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:13.5px;')}>
            View
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>arrow_forward</span>
          </span>
        </button>
      </div>
    </div>,
    document.body,
  );
}
