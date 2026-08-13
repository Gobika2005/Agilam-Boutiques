import { useNavigate, useLocation } from 'react-router-dom';
import { css } from '@/lib/css';

/**
 * "Filtered to X · clear" — shown on a page that was opened from the global
 * search with a `?q=` term.
 *
 * Without it, a page that arrives pre-filtered looks like a page that is simply
 * missing most of its rows. Clearing drops the parameter and re-renders the
 * full list, which is also what makes the browser Back button behave.
 */
export function SeededTermChip({ term, onClear }: { term: string; onClear?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  if (!term.trim()) return null;

  const clear = () => {
    onClear?.();
    const params = new URLSearchParams(location.search);
    params.delete('q');
    const rest = params.toString();
    navigate(`${location.pathname}${rest ? `?${rest}` : ''}`, { replace: true });
  };

  return (
    <div style={css('display:flex;align-items:center;gap:8px;margin:0 0 12px;flex-wrap:wrap;')}>
      <span
        style={css(
          'display:inline-flex;align-items:center;gap:7px;background:var(--ag-surface-2);border:1px solid var(--ag-border-soft);border-radius:999px;padding:6px 8px 6px 12px;font-size:12.5px;font-weight:700;color:var(--ag-ink);',
        )}
      >
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-muted-soft);")}>
          filter_alt
        </span>
        Filtered to “{term}”
        <button
          type="button"
          onClick={clear}
          aria-label="Clear the filter"
          style={css(
            'width:22px;height:22px;border:none;border-radius:50%;background:var(--ag-surface-3);color:var(--ag-crimson);cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:inherit;',
          )}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:14px;")}>close</span>
        </button>
      </span>
    </div>
  );
}
