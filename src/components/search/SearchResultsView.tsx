import { useNavigate, useSearchParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { MIN_TERM } from '@/lib/search/query';
import { SearchRow, SearchGroupLabel } from './SearchRow';
import type { SearchSource } from '@/lib/search/types';

/**
 * The "See all results" page, shared by the seller and admin consoles.
 *
 * Same sources and same rows as the dropdown, just a deeper `limit` and no
 * collapsing — the dropdown is for "I know what I want", this is for "show me
 * everything you have". The term lives in `?q=`, so a result set is a link an
 * operator can paste into a ticket.
 *
 * The buyer console does not use this: its results are a merchandised product
 * grid with filters and sort (`/search` → `Results.tsx`), not a row list.
 */
export function SearchResultsView<C>({
  sources,
  ctx,
  emptyHint,
  limit = 20,
}: {
  sources: SearchSource<C>[];
  ctx: C;
  /** What to suggest typing when the page is opened with no term. */
  emptyHint: string;
  limit?: number;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const term = (params.get('q') ?? '').trim();

  const { outcome, loading } = useGlobalSearch({ sources, ctx, term, limit, delay: 0 });

  if (term.length < MIN_TERM) {
    return (
      <div style={css('padding:60px 24px;text-align:center;')}>
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:44px;color:var(--ag-border);")}>
          search
        </span>
        <div style={css('color:var(--ag-muted);font-size:14px;margin-top:12px;line-height:1.6;max-width:420px;margin-left:auto;margin-right:auto;')}>
          {emptyHint}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={css('display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:6px;')}>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;color:var(--ag-ink);")}>“{term}”</div>
        <div style={css('color:var(--ag-muted);font-size:13px;')}>
          {loading ? 'Searching…' : `${outcome.total} result${outcome.total === 1 ? '' : 's'}`}
        </div>
      </div>

      {outcome.degraded.length > 0 && (
        <div
          role="status"
          style={css(
            'margin:10px 0;padding:10px 12px;border-radius:12px;background:var(--ag-gold-bg);color:var(--ag-gold-text);font-size:12.5px;font-weight:700;line-height:1.5;',
          )}
        >
          Could not search {outcome.degraded.join(', ')} — those tables may be missing a migration, or their columns are not granted to this role.
        </div>
      )}

      {!loading && outcome.total === 0 && (
        <div style={css('padding:48px 24px;text-align:center;color:var(--ag-muted);font-size:14px;')}>
          Nothing matched “{term}”.
        </div>
      )}

      {outcome.groups.map((g) => (
        <div
          key={g.key}
          style={css('margin-top:16px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:16px;padding:4px 4px 8px;')}
        >
          <SearchGroupLabel label={g.label} icon={g.icon} count={g.hits.length} />
          {g.hits.map((h) => (
            <SearchRow key={`${h.group}:${h.id}`} hit={h} onPick={() => navigate(h.to)} size={44} />
          ))}
          {g.more && (
            <div style={css('padding:8px 12px 4px;color:var(--ag-muted-soft);font-size:11.5px;font-weight:700;')}>
              Showing the first {limit} — narrow the search to see more.
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
