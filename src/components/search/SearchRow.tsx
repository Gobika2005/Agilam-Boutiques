import { css } from '@/lib/css';
import { initial } from '@/lib/tokens';
import { TONES } from '@/data/demo';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import type { SearchHit } from '@/lib/search/types';

/**
 * One result row, identical in the dropdown, the mobile sheet and the full
 * results page — the same hit should not look like a different thing depending
 * on where it was found.
 *
 * The leading square is chosen from `kind`: a product shows its photo on its
 * tone, a boutique its logo, a person their initial, anything else a glyph.
 */
export function SearchRow({
  hit,
  active,
  onHover,
  onPick,
  size = 38,
}: {
  hit: SearchHit;
  active?: boolean;
  onHover?: () => void;
  onPick: () => void;
  size?: number;
}) {
  const tone = TONES[(hit.tone ?? 0) % TONES.length];

  return (
    <button
      type="button"
      onMouseEnter={onHover}
      onClick={onPick}
      // `data-active` rather than a background literal so the highlight can be a
      // theme token — a hardcoded pink read as a white bar in dark mode.
      data-active={active ? 'true' : undefined}
      className="agx-search-row"
      style={css(
        `width:100%;display:flex;align-items:center;gap:11px;padding:9px 10px;border:none;border-radius:12px;cursor:pointer;text-align:left;font-family:inherit;background:${active ? 'var(--ag-surface-2)' : 'transparent'};`,
      )}
    >
      {hit.kind === 'product' ? (
        <span
          className="agx-thumb-media"
          style={css(`width:${size}px;height:${size}px;flex:none;border-radius:12px;overflow:hidden;position:relative;background:${tone};`)}
        >
          <ImageSlot src={hit.image ?? undefined} placeholder={hit.title} style={css('position:absolute;inset:0;')} sizes={`${size}px`} />
        </span>
      ) : hit.kind === 'boutique' ? (
        <BoutiqueLogo name={hit.title} src={hit.logo ?? undefined} size={size} radius={12} />
      ) : hit.kind === 'person' ? (
        <span
          aria-hidden="true"
          style={css(
            `width:${size}px;height:${size}px;flex:none;border-radius:12px;background:var(--ag-surface-3);color:var(--ag-crimson);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:${Math.round(size * 0.4)}px;`,
          )}
        >
          {initial(hit.title)}
        </span>
      ) : (
        <span
          style={css(
            `width:${size}px;height:${size}px;flex:none;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;`,
          )}
        >
          <span
            aria-hidden="true"
            style={css(`font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:${Math.round(size * 0.53)}px;`)}
          >
            {hit.icon ?? 'search'}
          </span>
        </span>
      )}

      <span style={css('flex:1;min-width:0;')}>
        <span style={css('display:block;font-size:13.5px;font-weight:800;color:var(--ag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>
          {hit.title}
        </span>
        <span style={css('display:block;font-size:11.5px;color:var(--ag-muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>
          {hit.sub}
        </span>
      </span>

      {hit.right && (
        <span style={css('flex:none;font-weight:800;color:var(--ag-crimson);font-size:13px;white-space:nowrap;')}>{hit.right}</span>
      )}
    </button>
  );
}

/** The small caps heading above each group. */
export function SearchGroupLabel({ label, icon, count }: { label: string; icon?: string; count?: number }) {
  return (
    <div style={css('display:flex;align-items:center;gap:6px;padding:10px 10px 4px;')}>
      {icon && (
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-muted-soft);")}>
          {icon}
        </span>
      )}
      <span className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-muted);letter-spacing:.08em;text-transform:uppercase;font-weight:800;')}>
        {label}
      </span>
      {count != null && <span style={css('font-size:10.5px;color:var(--ag-muted-soft);font-weight:700;')}>{count}</span>}
    </div>
  );
}
