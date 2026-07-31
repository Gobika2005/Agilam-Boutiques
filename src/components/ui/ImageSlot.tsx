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

export function ImageSlot({
  placeholder,
  src,
  alt,
  style,
  className = '',
  fallback = 'icon',
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
          loading="lazy"
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
