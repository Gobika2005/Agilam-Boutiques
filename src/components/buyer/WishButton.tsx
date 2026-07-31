import { css } from '@/lib/css';

/**
 * The heart every product surface uses to save a piece.
 *
 * Two things this centralises:
 *
 *  1. **The fill.** The app loads *Material Symbols* (`FILL` is a variable axis,
 *     `0..1`), not the older *Material Icons* set. `favorite_border` is not a
 *     Symbols ligature at all, so the old markup could never render a filled
 *     heart — the saved state has to come from `font-variation-settings:'FILL' 1`
 *     on the `favorite` glyph, which is what `.agx-heart` / `.agx-heart-on` do.
 *  2. **The colour.** Saved is a solid red; unsaved is a muted outline.
 */

export const WISH_RED = '#E11D48';
const WISH_IDLE = 'var(--ag-muted)';

export function WishButton({
  wished,
  onToggle,
  title,
  size = 36,
  className,
}: {
  wished: boolean;
  onToggle: (e: React.MouseEvent) => void;
  /** Product name, used for the accessible label. */
  title?: string;
  /** Button edge length in px. The glyph scales with it. */
  size?: number;
  className?: string;
}) {
  const label = title
    ? wished ? `Remove ${title} from wishlist` : `Add ${title} to wishlist`
    : wished ? 'Remove from wishlist' : 'Add to wishlist';

  return (
    <button
      type="button"
      // The heart sits inside the card's link (see `CardLink`), so it has to
      // stop the click reaching the anchor as well as the parent — otherwise
      // saving a piece also opened it.
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(e); }}
      aria-label={label}
      aria-pressed={wished}
      title={label}
      className={className}
      style={css(
        `width:${size}px;height:${size}px;flex:none;padding:0;border-radius:${Math.round(size / 3)}px;border:none;` +
          `background:${wished ? 'rgba(255,255,255,.96)' : 'rgba(255,255,255,.9)'};cursor:pointer;` +
          'display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px -6px rgba(0,0,0,.3);' +
          'transition:background .2s ease,transform .2s ease;',
      )}
    >
      <span
        key={wished ? 'on' : 'off'}
        className={`agx-heart${wished ? ' agx-heart-on' : ''}`}
        style={css(`font-size:${Math.round(size * 0.53)}px;color:${wished ? WISH_RED : WISH_IDLE};`)}
      >
        favorite
      </span>
    </button>
  );
}

/**
 * Bare heart glyph — for surfaces that supply their own button chrome (the
 * product page's action rail, the empty-wishlist illustration).
 */
export function WishHeart({ wished, size = 22 }: { wished: boolean; size?: number }) {
  return (
    <span
      key={wished ? 'on' : 'off'}
      className={`agx-heart${wished ? ' agx-heart-on' : ''}`}
      style={css(`font-size:${size}px;color:${wished ? WISH_RED : WISH_IDLE};`)}
    >
      favorite
    </span>
  );
}
