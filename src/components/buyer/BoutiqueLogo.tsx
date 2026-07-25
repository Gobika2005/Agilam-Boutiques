import { css } from '@/lib/css';

/**
 * A boutique's shop logo, with a graceful monogram fallback.
 *
 * Sellers upload a logo from their boutique profile (`boutiques.logo_url`), but
 * it is optional — so every buyer-facing surface that shows a boutique needs the
 * same "logo if there is one, initials on the brand gradient if not" treatment.
 * Rendering that in one place keeps the directory, the profile header and the
 * product page identical.
 */
export function BoutiqueLogo({
  name,
  src,
  size = 44,
  radius,
  ring,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  /** Corner radius in px; defaults to a circle. */
  radius?: number;
  /** Optional white ring, e.g. where the logo overlaps a cover photo. */
  ring?: number;
  className?: string;
}) {
  const r = radius ?? size / 2;
  return (
    <div
      className={className}
      style={css(
        `position:relative;width:${size}px;height:${size}px;flex:none;border-radius:${r}px;overflow:hidden;` +
          'display:flex;align-items:center;justify-content:center;' +
          'background:linear-gradient(135deg,#E14A7E,#B02454 70%,#8E1E43);' +
          (ring ? `border:${ring}px solid #fff;` : '') +
          `box-shadow:0 ${Math.round(size / 4)}px ${Math.round(size / 2)}px -${Math.round(size / 3)}px rgba(176,36,84,.85);`,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={`${name} logo`}
          loading="lazy"
          style={css('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;background:var(--ag-surface);')}
        />
      ) : (
        <span style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:${Math.round(size * 0.38)}px;color:#fff;letter-spacing:.02em;`)}>
          {monogram(name)}
        </span>
      )}
    </div>
  );
}

/** "Elegance Boutique" -> "EB". */
export function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((w) => w[0]).join('');
  return (initials || name.slice(0, 2)).toUpperCase();
}
