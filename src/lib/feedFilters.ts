/**
 * The Inspire feed's filters.
 *
 * Deliberately its own state rather than the shop grid's (`ShopContext.filters`):
 * narrowing the feed to "silk, under ₹3,000" is a momentary thing, and sharing
 * one filter object between two screens means changing it here silently changes
 * what /shop shows. Inspire's copy lives in the screen and dies with it, so
 * coming back to the feed always gives you the whole market again.
 *
 * Where each filter is actually applied matters, and the split is not arbitrary:
 *
 *   • Product-level filters (category, occasion, fabric, colour, size, price,
 *     stock, age) go into the QUERY — see `feedQueryFor`. They have to: a fabric
 *     filter can exclude 95% of the catalogue, and filtering a fetched batch
 *     instead would leave the buyer looking at two cards with no way to know
 *     more exist further down.
 *   • Shop-level filters (verified, cash on delivery) are applied to the fetched
 *     rows against the boutique list the app already holds in memory — see
 *     `matchesShopFilters`. They remove a small fraction at most, and doing it
 *     this way needs no join and no extra granted column.
 *   • City is both: it resolves to the ids of the boutiques in that city
 *     (`boutiqueIdsForCity`), which is a naturally small list, and goes into the
 *     query as those ids. Filtering on `boutiques.city` directly would depend on
 *     every row already being canonicalised by migration 0075; the in-memory
 *     list is normalised on read either way, so this works regardless.
 */

import type { Boutique, Product } from '@/data/demo';
import { cityKey } from '@/lib/cities';
import { hasTerm } from '@/lib/vocabulary';
import { NEW_ARRIVAL_DAYS, isNewArrival } from '@/lib/ranking';

export type FeedFilters = {
  categories: string[];
  occasions: string[];
  fabrics: string[];
  colors: string[];
  sizes: string[];
  /** Upper bound in rupees. `FEED_MAX_PRICE` means "no cap". */
  maxPrice: number;
  inStockOnly: boolean;
  newOnly: boolean;
  codOnly: boolean;
  city: string | null;
  verifiedOnly: boolean;
};

/**
 * Top of the price slider, and the value that means "unlimited" — the same
 * ₹10,000 ceiling the shop grid's sheet uses, so the two controls read the same.
 */
export const FEED_MAX_PRICE = 10_000;

export const NO_FEED_FILTERS: FeedFilters = {
  categories: [],
  occasions: [],
  fabrics: [],
  colors: [],
  sizes: [],
  maxPrice: FEED_MAX_PRICE,
  inStockOnly: false,
  newOnly: false,
  codOnly: false,
  city: null,
  verifiedOnly: false,
};

/** How many filters are on — the number on the filter button's badge. */
export function feedFilterCount(f: FeedFilters): number {
  return (
    (f.categories.length ? 1 : 0) +
    (f.occasions.length ? 1 : 0) +
    (f.fabrics.length ? 1 : 0) +
    (f.colors.length ? 1 : 0) +
    (f.sizes.length ? 1 : 0) +
    (f.maxPrice < FEED_MAX_PRICE ? 1 : 0) +
    (f.inStockOnly ? 1 : 0) +
    (f.newOnly ? 1 : 0) +
    (f.codOnly ? 1 : 0) +
    (f.city ? 1 : 0) +
    (f.verifiedOnly ? 1 : 0)
  );
}

/**
 * A stable string identity for a filter set, so the feed reloads when a filter
 * changes and not when an unrelated render produces an equal-but-new object.
 */
export function feedFilterKey(f: FeedFilters): string {
  return JSON.stringify([
    [...f.categories].sort(),
    [...f.occasions].sort(),
    [...f.fabrics].sort(),
    [...f.colors].sort(),
    [...f.sizes].sort(),
    f.maxPrice,
    f.inStockOnly,
    f.newOnly,
    f.codOnly,
    f.city,
    f.verifiedOnly,
  ]);
}

/** The product-level half, as `fetchFeed` wants it. */
export type FeedQuery = {
  categories?: string[];
  occasions?: string[];
  fabrics?: string[];
  colors?: string[];
  sizes?: string[];
  maxPrice?: number;
  inStockOnly?: boolean;
  /** ISO timestamp; rows older than this are excluded. */
  newerThan?: string;
};

/**
 * Every spelling of a chosen term that the catalogue actually contains.
 *
 * `in.(Kurta Set)` is an exact match in Postgres, and the chip carries the
 * admin's spelling while the row carries the seller's — so a filter the sheet
 * counted 12 pieces for came back with none. The app already holds the whole
 * active catalogue, so the term is expanded here into the raw values behind it
 * and the query stays a plain, indexable `in`.
 *
 * Falling back to the chosen terms when nothing matches is deliberate: it asks
 * for a spelling no row has, i.e. returns nothing, which is the honest answer.
 */
function spellings(
  products: Product[],
  pick: (p: Product) => string | string[] | undefined | null,
  chosen: string[],
): string[] {
  const found = new Set<string>();
  for (const p of products) {
    const v = pick(p);
    for (const one of Array.isArray(v) ? v : [v]) {
      if (one && hasTerm(chosen, one)) found.add(one);
    }
  }
  return found.size ? [...found] : chosen;
}

/**
 * "New this month" is the same window as the New badge and the New arrivals
 * rail — the constant is imported rather than repeated, because the query below
 * and `matchesFeedFilters` (which counts the button) must agree exactly or the
 * sheet promises a number the feed does not deliver.
 */
export function feedQueryFor(f: FeedFilters, products: Product[] = []): FeedQuery {
  return {
    categories: f.categories.length ? spellings(products, (p) => p.cat, f.categories) : undefined,
    occasions: f.occasions.length ? spellings(products, (p) => p.occasion, f.occasions) : undefined,
    fabrics: f.fabrics.length ? spellings(products, (p) => p.fabric, f.fabrics) : undefined,
    colors: f.colors.length ? spellings(products, (p) => p.color, f.colors) : undefined,
    sizes: f.sizes.length ? spellings(products, (p) => p.sizes ?? [], f.sizes) : undefined,
    maxPrice: f.maxPrice < FEED_MAX_PRICE ? f.maxPrice : undefined,
    inStockOnly: f.inStockOnly || undefined,
    newerThan: f.newOnly
      ? new Date(Date.now() - NEW_ARRIVAL_DAYS * 86_400_000).toISOString()
      : undefined,
  };
}

/** The boutiques in the filtered city, or `null` when no city is chosen. */
export function boutiqueIdsForCity(boutiques: Boutique[], city: string | null): string[] | null {
  if (!city) return null;
  const want = cityKey(city);
  return boutiques.filter((b) => cityKey(b.city) === want).map((b) => b.id);
}

/**
 * The shop-level half. `undefined` boutique means "not in the catalogue we hold"
 * — which can only happen mid-load, and is treated as a pass so the feed does
 * not blink empty while the boutique list resolves.
 *
 * `codEnabled` undefined is treated as accepting COD, matching the field's
 * documented meaning (older rows predate the setting).
 */
export function matchesShopFilters(b: Boutique | undefined, f: FeedFilters): boolean {
  if (!b) return true;
  if (f.verifiedOnly && !b.verified) return false;
  if (f.codOnly && b.codEnabled === false) return false;
  return true;
}

/**
 * The whole predicate, over the in-memory catalogue. This is what counts the
 * "Show N pieces" button — the app already holds every active product, so the
 * number is exact and costs no round trip.
 */
export function matchesFeedFilters(p: Product, b: Boutique | undefined, f: FeedFilters): boolean {
  // `hasTerm`, not `includes` — the chip carries the admin's spelling and the
  // product carries the seller's. See @/lib/vocabulary.
  if (f.categories.length && !hasTerm(f.categories, p.cat)) return false;
  if (f.occasions.length && !hasTerm(f.occasions, p.occasion)) return false;
  if (f.fabrics.length && !hasTerm(f.fabrics, p.fabric)) return false;
  if (f.colors.length && !hasTerm(f.colors, p.color)) return false;
  if (f.sizes.length && !(p.sizes ?? []).some((s) => hasTerm(f.sizes, s))) return false;
  // At the top of the slider the filter is off, not a ₹10,000 ceiling — a
  // ₹14,000 bridal lehenga is in the feed, so it has to be in the count too.
  if (f.maxPrice < FEED_MAX_PRICE && p.price > f.maxPrice) return false;
  if (f.inStockOnly && p.stock <= 0) return false;
  if (f.newOnly && !isNewArrival(p)) return false;
  if (f.city && cityKey(p.city) !== cityKey(f.city)) return false;
  return matchesShopFilters(b, f);
}
