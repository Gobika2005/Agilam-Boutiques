/**
 * One predicate for the shop grid.
 *
 * The grid (`Results`) and the filter sheet's "Show N results" button were two
 * copies of the same nine-line filter expression. Two copies is one too many:
 * the button's job is to promise exactly what the grid will show, and it can
 * only do that if it runs the same code.
 *
 * Terms are compared with `sameTerm`, not `===`. The vocabulary and the products
 * are two different people's typing — the admin approves "Kurta Set", a seller
 * lists a "kurta set" — and a filter that a tile just promised must not come
 * back empty over a capital letter. See @/lib/vocabulary for the rule and the
 * bug that produced it.
 */

import type { Filters } from '@/state/ShopContext';
import { hasTerm } from '@/lib/vocabulary';
import { productSizes } from '@/data/demo';
import type { Product } from '@/data/demo';

/** The fields the header search looks through. */
const searchable = (p: Product) => [p.title, p.cat, p.occasion, p.fabric, p.color, p.boutique];

/**
 * Whether a piece belongs in the grid under these filters and this search term.
 * `query` is the raw header search box; it is trimmed and lower-cased here so
 * callers cannot forget to.
 */
export function matchesFilters(p: Product, filters: Filters, query = ''): boolean {
  const q = query.trim().toLowerCase();
  return (
    p.price <= filters.maxPrice &&
    (filters.cats.length === 0 || hasTerm(filters.cats, p.cat)) &&
    (filters.colors.length === 0 || hasTerm(filters.colors, p.color)) &&
    (filters.occasions.length === 0 || hasTerm(filters.occasions, p.occasion)) &&
    (filters.sizes.length === 0 || productSizes(p).some((s) => hasTerm(filters.sizes, s))) &&
    // The header search narrows the same grid rather than opening a separate
    // screen, so a term and a filter compose instead of fighting.
    (q === '' || searchable(p).some((f) => f?.toLowerCase().includes(q)))
  );
}
