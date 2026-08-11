import { supabase } from '@/lib/supabase';
import type { ProductWithBoutique } from './types';

/**
 * Inspire feed data.
 *
 * The feed is the catalogue, not a second content system: a boutique lists a
 * piece once and that listing is what followers see. So there is no post table,
 * no separate upload and nothing to keep in sync — this just reads `products`
 * for a set of boutiques, newest first.
 *
 * The one thing the catalogue didn't already have is a public like, which
 * migration 0020 adds (`products.likes_count` + `toggle_product_like`). Saving a
 * piece is the wishlist, which already exists.
 */

/** Boutique fields the feed card needs on top of the usual product join. */
const SELECT =
  '*, boutique:boutiques(id, name, city, tone, logo_url, verified, slug)';

export type FeedProduct = ProductWithBoutique & {
  likes_count: number;
  boutique:
    | {
        id: string;
        name: string;
        city: string;
        tone: number;
        logo_url: string | null;
        verified: boolean;
        slug: string | null;
      }
    | null;
};

const shape = (rows: unknown): FeedProduct[] => (rows ?? []) as unknown as FeedProduct[];

/**
 * How the For You feed is ordered. `new` is the feed's own chronology; the other
 * three are the engagement counters the catalogue already maintains —
 * `likes_count` (migration 0020), `views_count` (0031) and `sold_count` (0023).
 * All three are trigger- or RPC-maintained and not app-writable, so a boutique
 * cannot sort itself to the top of the feed.
 */
export type FeedSort = 'new' | 'liked' | 'viewed' | 'ordered';

const SORT_COLUMN: Record<FeedSort, string> = {
  new: 'created_at',
  liked: 'likes_count',
  viewed: 'views_count',
  ordered: 'sold_count',
};

/**
 * Listings for the feed, either from a set of boutiques or from everything
 * except a set of boutiques. Passing `exclude` flips the id list from an
 * include-filter to a skip-filter; an empty list with `exclude` is "everything",
 * which is what the For You feed asks for.
 *
 * Two pagination modes, because the sort decides which is correct:
 *
 *   • `new` pages by keyset — `before` is the `created_at` of the last card on
 *     screen, so a boutique listing something mid-scroll can't shift the window
 *     and make the buyer see a duplicate or miss one.
 *   • the popularity sorts page by `offset`. Their columns move under the cursor
 *     (a like lands while you scroll), so there is no stable key to seek on;
 *     an offset can at worst repeat a card, which the caller de-dupes by id.
 */
export async function fetchFeed(opts: {
  boutiqueIds: string[];
  /** Treat `boutiqueIds` as shops to skip, not shops to show. */
  exclude?: boolean;
  limit?: number;
  before?: string;
  /** Rows already shown, for the offset-paged popularity sorts. */
  offset?: number;
  /** Narrow the feed to one catalogue category — the Inspire filter row. */
  category?: string;
  sort?: FeedSort;
}): Promise<FeedProduct[]> {
  const { boutiqueIds, exclude = false, limit = 6, before, offset = 0, category, sort = 'new' } = opts;
  // An include-query with nothing to include returns nothing, rather than
  // silently widening to every boutique. An exclude-query with nothing to
  // exclude is simply "everything", which is correct.
  if (!exclude && boutiqueIds.length === 0) return [];

  let q = supabase
    .from('products')
    .select(SELECT)
    // Same visibility rules as the rest of discovery: moderated-out and
    // soft-deleted pieces never reach a buyer.
    .eq('status', 'active')
    .is('deleted_at', null);

  if (exclude) {
    if (boutiqueIds.length) q = q.not('boutique_id', 'in', `(${boutiqueIds.join(',')})`);
  } else {
    q = q.in('boutique_id', boutiqueIds);
  }

  if (category) q = q.eq('category', category);

  if (sort === 'new') {
    if (before) q = q.lt('created_at', before);
    const { data, error } = await q.order('created_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return shape(data);
  }

  // `created_at` is the tie-break: without it every product on nought likes
  // comes back in whatever order Postgres feels like, which differs per page and
  // makes the same card show up twice as the buyer scrolls.
  const { data, error } = await q
    .order(SORT_COLUMN[sort], { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (!error) return shape(data);

  // The counters live in migrations 0020/0023/0031. On a deployment missing one
  // of them the lens is simply unavailable — the feed falls back to newest
  // first rather than showing the buyer an error where a feed should be.
  // 42703 = undefined_column, 42501 = column not granted.
  if (error.code !== '42703' && error.code !== '42501') throw error;
  console.warn(`[feed] cannot sort by ${SORT_COLUMN[sort]} — apply the counter migrations. Falling back to newest.`);
  return fetchFeed({ ...opts, sort: 'new', before: undefined, offset: 0 });
}

/** Toggle a like and get the authoritative new count back. */
export async function toggleProductLike(productId: string, like: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('toggle_product_like', { pid: productId, do_like: like });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/** The signed-in buyer's liked pieces, so hearts follow the account. */
export async function fetchLikedProducts(buyerId: string): Promise<Record<string, boolean>> {
  const { data, error } = await supabase.from('product_likes').select('product_id').eq('buyer_id', buyerId);
  if (error) throw error;
  const likes: Record<string, boolean> = {};
  for (const r of data ?? []) likes[r.product_id] = true;
  return likes;
}

/** Live like-count updates while the feed is open. */
export function subscribeToProductLikes(onChange: (productId: string, likes: number) => void) {
  const channel = supabase
    .channel('feed-product-likes')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'products' }, (payload) => {
      const row = payload.new as { id?: string; likes_count?: number };
      if (row.id && typeof row.likes_count === 'number') onChange(row.id, row.likes_count);
    })
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
