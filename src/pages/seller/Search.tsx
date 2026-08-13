import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { GlobalSearchBox } from '@/components/search/GlobalSearchBox';
import { SearchResultsView } from '@/components/search/SearchResultsView';
import { SELLER_SOURCES } from '@/lib/search/sellerSources';

/**
 * `/seller/search?q=…` — the seller console's full results page.
 *
 * It used to be the *only* seller search: an icon in the header navigated here,
 * and the page then pulled the boutique's entire products, orders and
 * conversations into memory and filtered the arrays. That was fine at a few
 * dozen rows and quietly wrong past a few hundred, it could not be linked to,
 * and it covered four things — coupons, reviews and ad campaigns were
 * unreachable.
 *
 * The header now searches inline; this page is where "see everything" lands,
 * over the same eight sources, straight against the database.
 */
export function Search() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { profile } = useAuth();
  const ctx = useMemo(() => ({ ownerId: profile?.id ?? null }), [profile?.id]);
  const term = params.get('q') ?? '';

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('padding:6px 20px 8px;display:flex;align-items:center;gap:10px;')}>
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          style={css(
            'width:42px;height:42px;flex:none;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;',
          )}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
        </button>
        <div style={css('flex:1;min-width:0;')}>
          <GlobalSearchBox
            sources={SELLER_SOURCES}
            ctx={ctx}
            resultsPath="/seller/search"
            recentKey="seller"
            placeholder="Search products, orders, customers…"
            ariaLabel="Search your boutique"
            initialTerm={term}
          />
        </div>
      </div>

      <div style={css('padding:0 20px;')}>
        <SearchResultsView
          sources={SELLER_SOURCES}
          ctx={ctx}
          emptyHint="Search across your products, orders, customers, chats, coupons, reviews and ad campaigns — or type a screen name like “earnings” to jump there."
        />
      </div>
    </div>
  );
}
