import { useNavigate } from 'react-router-dom';
import { writeSearchParams } from '@/lib/searchParams';
import { useShop, DEFAULT_FILTERS } from '@/state/ShopContext';
import { GlobalSearchBox } from '@/components/search/GlobalSearchBox';
import { BUYER_SOURCES, type BuyerCtx } from '@/lib/search/buyerSources';

/**
 * The storefront header search box.
 *
 * It was previously an uncontrolled input wired to nothing; then it searched
 * whatever `CatalogContext` happened to have in memory. It now runs against the
 * database through the shared search engine, so a term finds a saree, a
 * boutique or a collection whether or not the grid has loaded it — the same
 * component and the same rows the seller and admin consoles use.
 *
 * Two shapes, same behaviour:
 *
 *  - `inline` — the always-visible field in the desktop header.
 *  - `icon` — a single button for phones. A permanent full-width field cost the
 *    mobile header an entire second row (~56px of chrome on every screen) for
 *    something used occasionally, so it collapses to an icon beside the profile
 *    avatar and opens a focused search sheet on tap.
 */

const CTX: BuyerCtx = {};

export function GlobalSearch({
  className,
  variant = 'inline',
}: {
  className?: string;
  variant?: 'inline' | 'icon';
}) {
  const navigate = useNavigate();
  const { query, setQuery, setFilters } = useShop();

  /**
   * Submitting is not just a navigation here.
   *
   * The results grid filters on `ShopContext.query`, and a fresh search must not
   * inherit filters from a previous browse or it can come back empty for a term
   * with obvious matches. The term also goes in the URL rather than only in
   * state: that is the link a buyer may reload, bookmark or send to someone,
   * and `/search?q=…` is the endpoint our `WebSite` JSON-LD advertises to search
   * engines.
   */
  const commit = (term: string) => {
    setQuery(term);
    setFilters({ ...DEFAULT_FILTERS });
    navigate(`/search${writeSearchParams({ query: term, filters: DEFAULT_FILTERS })}`);
  };

  return (
    <GlobalSearchBox
      className={className}
      variant={variant}
      sources={BUYER_SOURCES}
      ctx={CTX}
      resultsPath="/search"
      recentKey="buyer"
      placeholder="Search boutiques &amp; styles"
      hint="Search for a saree, a boutique, or an occasion like “bridal”."
      ariaLabel="Search boutiques and styles"
      initialTerm={query}
      onCommit={commit}
      // A live search stays visible as a dot on the mobile icon, so the buyer
      // can tell the grid is filtered without opening the sheet.
      badge={Boolean(query.trim())}
    />
  );
}
