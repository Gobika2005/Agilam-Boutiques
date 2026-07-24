import type { CSSProperties } from 'react';
import { css } from '@/lib/css';

const BASE = css(
  'display:inline-flex;align-items:center;gap:4px;background:rgba(42,26,32,.72);color:#fff;border-radius:8px;padding:3px 8px;font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;',
);

/**
 * The small "Sponsored" / "Promoted" pill that labels paid placements, so a buyer
 * always knows an ad is an ad. Kept in one place so the wording and look stay
 * consistent across the product rails, hero and boutiques list.
 */
export function PromotedBadge({ label = 'Sponsored', style }: { label?: string; style?: CSSProperties }) {
  return (
    <span style={{ ...BASE, ...style }}>
      <span style={css("font-family:'Material Symbols Outlined';font-size:12px;")}>bolt</span>
      {label}
    </span>
  );
}
