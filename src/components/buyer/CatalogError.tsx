import { css } from '@/lib/css';

/**
 * "We couldn't load this", as distinct from "there is nothing here".
 *
 * Every catalogue surface rendered one empty state for both cases, so when the
 * database was unreachable the shop said *"All collections · 0 pieces — No
 * matches found. Try widening your price range or clearing a filter."* A buyer
 * on a patchy connection reads that as a marketplace with no stock and leaves,
 * and there was nothing on screen to retry with — only a "Reset filters" button
 * that could not possibly help.
 *
 * `CatalogContext` has always exposed `error` and `reload` alongside the rows;
 * the surfaces simply never asked. Anywhere that renders an empty state should
 * check `error` first and render this instead.
 */
export function CatalogError({ onRetry, what = 'this page' }: { onRetry?: () => void; what?: string }) {
  return (
    <div
      role="alert"
      style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:70px 30px;')}
    >
      <div style={css('width:74px;height:74px;border-radius:24px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:38px;color:#D6336C;")}>
          cloud_off
        </span>
      </div>
      <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;margin-top:16px;")}>
        We couldn’t load {what}
      </div>
      <div style={css('color:var(--ag-muted);font-size:14px;margin-top:6px;max-width:340px;line-height:1.55;')}>
        This is us, not you — the catalogue didn’t come back. Check your connection and try again.
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          style={css('margin-top:16px;background:#B02454;color:#fff;border:none;border-radius:12px;padding:11px 20px;font-weight:700;cursor:pointer;min-height:44px;')}
        >
          Try again
        </button>
      )}
    </div>
  );
}
