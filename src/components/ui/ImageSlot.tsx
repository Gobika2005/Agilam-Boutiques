import { useState, type CSSProperties } from 'react';
import { css } from '@/lib/css';

/**
 * Stand-in for the design's `<x-import component="image-slot">` elements.
 *
 * When a `src` is supplied (demo imagery), it renders a cover-fit photo over
 * the parent's tone colour and falls back to the tinted placeholder if the
 * image fails to load. Without a `src` it behaves as before: an empty tinted
 * placeholder that occupies the same box so surrounding layout is unchanged.
 */
/**
 * Hosts that serve photos but refuse to be embedded cross-origin, so the
 * browser blocks the request (Chrome's Opaque Response Blocking) and paints a
 * broken image no matter what we do. Google Places / Maps photo URLs are the
 * one that turns up in real data — a seller pastes their shop's Google listing
 * photo into the cover field. There is no client-side way to load these, so go
 * straight to the styled fallback rather than flashing a broken box first.
 *
 * The real fix is re-uploading the photo to our own storage; this only stops a
 * bad URL looking like a bug in the page.
 */
const UNEMBEDDABLE_HOSTS = ['googleusercontent.com', 'lh3.google.com', 'maps.gstatic.com'];

function isEmbeddable(src: string): boolean {
  if (!/^https?:/i.test(src)) return true; // relative / data: — ours to serve
  try {
    const { hostname } = new URL(src);
    return !UNEMBEDDABLE_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return true;
  }
}

/**
 * Intrinsic dimensions declared on every photo.
 *
 * No `<img>` in the app carried `width`/`height`, so the browser could not
 * reserve space before the file arrived and every grid reflowed as photos
 * loaded — measured as a Cumulative Layout Shift of roughly 0.15–0.30, well
 * past Google's 0.1 "good" threshold and a direct ranking factor.
 *
 * The catalogue is shot 4:5, and the attributes only need to state the *ratio*:
 * CSS still sizes the element (`width:100%;height:100%`), while the attributes
 * tell the browser what shape to hold open in the meantime.
 */
const INTRINSIC_WIDTH = 800;
const INTRINSIC_HEIGHT = 1000;

export function ImageSlot({
  placeholder,
  src,
  alt,
  style,
  className = '',
  fallback = 'icon',
  priority = false,
  width,
  height,
}: {
  placeholder?: string;
  src?: string;
  alt?: string;
  style?: CSSProperties;
  className?: string;
  /**
   * What to show when there is no usable photo. `icon` is the tinted glyph used
   * inside product tiles; `brand` is a soft MangaiMart wash for large surfaces
   * like a boutique cover, where a grey box with a generic icon reads as
   * breakage rather than "no photo yet".
   */
  fallback?: 'icon' | 'brand';
  /**
   * This photo is (or is likely to be) the Largest Contentful Paint — the hero,
   * or the main frame of a product gallery. Lazy-loading the LCP image is a
   * self-inflicted delay: it tells the browser to wait before fetching the one
   * thing the score is measured against. Setting this eager-loads it and marks
   * it high priority instead.
   */
  priority?: boolean;
  /** Override the 4:5 default where a surface is a different shape (a cover). */
  width?: number;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);
  const showImage = !!src && !failed && isEmbeddable(src);

  return (
    <div
      className={className}
      style={{
        ...css('display:flex;align-items:center;justify-content:center;overflow:hidden;'),
        ...(showImage || fallback === 'icon'
          ? null
          : css('background:linear-gradient(135deg,var(--ag-surface-2),var(--ag-surface-3));')),
        ...style,
      }}
      aria-label={alt ?? placeholder}
    >
      {showImage ? (
        <img
          src={src}
          alt={alt ?? placeholder ?? ''}
          width={width ?? INTRINSIC_WIDTH}
          height={height ?? INTRINSIC_HEIGHT}
          loading={priority ? 'eager' : 'lazy'}
          // `async` lets the browser decode off the main thread, so a long grid
          // of photos can't block scrolling while they paint.
          decoding={priority ? 'sync' : 'async'}
          // Lowercase on purpose. React only maps the camelCase `fetchPriority`
          // from 19 onwards; on the 18.3 this app is pinned to it is treated as
          // an unknown prop, which logs a warning and drops the attribute — so
          // the hint would never reach the browser at all.
          {...{ fetchpriority: priority ? 'high' : 'auto' }}
          onError={() => setFailed(true)}
          style={css('width:100%;height:100%;object-fit:cover;display:block;')}
        />
      ) : fallback === 'brand' ? (
        <span
          className="agx-eyebrow"
          style={css('font-size:11px;color:var(--ag-muted);padding:0 16px;text-align:center;')}
        >
          {placeholder ?? 'MangaiMart'}
        </span>
      ) : (
        <span
          style={css(
            "font-family:'Material Symbols Outlined';font-size:34px;color:rgba(107,20,54,.16);",
          )}
        >
          image
        </span>
      )}
    </div>
  );
}
