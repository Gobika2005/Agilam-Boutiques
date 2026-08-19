/**
 * The search term and filter set, expressed as a query string.
 *
 * These used to live only in React state on `ShopContext`, which meant the grid
 * was correct but the address bar never moved: searching "saree" from the header
 * landed on a bare `/shop`, so a reload, a Back, a bookmark or a link shared with
 * a friend all silently dropped the search and showed the full catalogue. The
 * reverse was broken too — `/search?q=saree` typed in directly ignored `q`
 * entirely, and that is the exact URL template our own `WebSite` JSON-LD
 * advertises to Google as this site's search endpoint.
 *
 * Both directions now go through this module, so the URL is the record of what
 * the buyer asked for and the state is derived from it.
 *
 * Parameter names are the short, guessable ones a person might type by hand
 * (`q`, `cat`, `color`, `size`) rather than the internal field names. Multi-select
 * groups repeat the key — `?cat=Sarees&cat=Kurtis` — which is what a browser's
 * own form serialisation produces and what `URLSearchParams.getAll` reads back.
 */
import { DEFAULT_FILTERS, type Filters } from '@/state/ShopContext';

/** Query-string key ⇄ the `Filters` array it drives. */
const GROUPS = {
  cat: 'cats',
  color: 'colors',
  occasion: 'occasions',
  size: 'sizes',
} as const satisfies Record<string, keyof Filters>;

export type SearchState = { query: string; filters: Filters };

/**
 * Read a URL's query string into a search + filter state.
 *
 * Anything unparseable is dropped rather than throwing: a hand-typed or
 * truncated link should still land on a working grid, just a less specific one.
 * `maxPrice` in particular is clamped to the slider's own range so a
 * `?maxPrice=-5` can't produce a permanently empty page.
 */
export function readSearchParams(search: string): SearchState {
  const p = new URLSearchParams(search);
  const filters: Filters = { ...DEFAULT_FILTERS };

  for (const [key, field] of Object.entries(GROUPS) as [keyof typeof GROUPS, 'cats' | 'colors' | 'occasions' | 'sizes'][]) {
    const values = p.getAll(key).filter(Boolean);
    if (values.length) filters[field] = values;
  }

  const max = Number(p.get('maxPrice'));
  if (Number.isFinite(max) && max > 0) filters.maxPrice = Math.min(max, DEFAULT_FILTERS.maxPrice);

  const sort = p.get('sort');
  if (sort) filters.sort = sort;

  return { query: (p.get('q') ?? '').trim(), filters };
}

/**
 * The query string for a state — omitting everything still at its default, so
 * an unfiltered `/shop` stays a clean `/shop` and keeps its canonical identity
 * instead of becoming `/shop?maxPrice=10000&sort=Latest`.
 */
export function writeSearchParams({ query, filters }: SearchState): string {
  const p = new URLSearchParams();
  if (query.trim()) p.set('q', query.trim());
  for (const [key, field] of Object.entries(GROUPS) as [keyof typeof GROUPS, 'cats' | 'colors' | 'occasions' | 'sizes'][]) {
    for (const v of filters[field]) p.append(key, v);
  }
  if (filters.maxPrice !== DEFAULT_FILTERS.maxPrice) p.set('maxPrice', String(filters.maxPrice));
  if (filters.sort !== DEFAULT_FILTERS.sort) p.set('sort', filters.sort);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** True when two states would serialise identically — the guard that stops the
 *  URL→state→URL round trip from pushing a history entry on every render. */
export function sameSearchState(a: SearchState, b: SearchState): boolean {
  return writeSearchParams(a) === writeSearchParams(b);
}

/**
 * The address of the results grid showing this state — `/shop?cat=Kurta+Sets`.
 *
 * **Anything that sends a buyer to the grid with a filter already on must
 * navigate here, not to a bare `/shop`.** Setting `ShopContext.filters` and then
 * navigating looks like it works and does not: `Results` adopts the URL on
 * mount, and a bare `/shop` says "no filters", so it immediately overwrites
 * whatever was just set. That is why tapping a collection circle on the home
 * page opened the entire catalogue — the filter was set, then wiped a
 * millisecond later by the page it was set for.
 *
 * Putting it in the URL fixes the race and is what the buyer wants anyway: the
 * filtered grid becomes a page that can be reloaded, bookmarked and shared.
 */
export function shopPath(state: Partial<SearchState> = {}): string {
  return `/shop${writeSearchParams({
    query: state.query ?? '',
    filters: state.filters ?? DEFAULT_FILTERS,
  })}`;
}
