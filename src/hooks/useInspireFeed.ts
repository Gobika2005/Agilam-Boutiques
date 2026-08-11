import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import {
  fetchFeed,
  fetchLikedProducts,
  subscribeToProductLikes,
  toggleProductLike,
  type FeedProduct,
  type FeedSort,
} from '@/data/feed';
import { readLocalLikes, writeLocalLikes } from '@/lib/feedLocal';

const PAGE = 6;

export type FeedItem = FeedProduct;

/**
 * The Inspire feed.
 *
 * The feed reads straight from the catalogue — a boutique lists a piece and it
 * appears here, with no separate posting step. Two lenses, and they are
 * genuinely different feeds rather than two orderings of one:
 *
 *   • For You (`followingOnly: false`) is the whole approved market, ranked by
 *     the chosen `sort`. It used to run the followed shops first and hand over
 *     to everyone else at a divider, which meant a buyer who follows three
 *     boutiques saw those three boutiques and little else — the opposite of
 *     what a discovery feed is for. Following now has its own tab, so For You
 *     is free to be discovery.
 *   • Following (`followingOnly: true`) is strictly the shops the buyer follows,
 *     newest first, and never widens.
 *
 * Likes are local-first (buyers browse anonymously) and reconciled with the
 * account when there is one.
 */
export function useInspireFeed(opts: { category?: string; followingOnly?: boolean; sort?: FeedSort } = {}) {
  const { category, followingOnly = false, sort = 'new' } = opts;
  // The Following tab is a chronology by definition — "what the shops I follow
  // posted" — so its ordering is fixed regardless of the For You lens.
  const activeSort: FeedSort = followingOnly ? 'new' : sort;
  const { follows, showToast } = useShop();
  const { boutiques, loading: catalogLoading } = useCatalog();

  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [likes, setLikes] = useState<Record<string, boolean>>(() => readLocalLikes());

  // Followed ids are intersected with the live catalogue so a stale local follow
  // (a boutique since removed or unapproved) can't strand the first phase.
  const followedIds = useMemo(
    () => boutiques.filter((b) => follows[b.id]).map((b) => b.id),
    [boutiques, follows],
  );
  const followsAnyone = followedIds.length > 0;

  // A stable identity for the id set, so the loader re-runs when the buyer
  // follows or unfollows a shop but not on every unrelated catalogue render.
  // For You is the whole market either way, so the follow set is not part of its
  // identity — tapping Follow on a card there must not rebuild the feed under
  // the buyer's thumb.
  const scopeKey = followingOnly ? followedIds.join(',') : 'all';
  const idsRef = useRef(followedIds);
  idsRef.current = followedIds;

  const describeError = (e: unknown) =>
    e instanceof Error && /likes_count|product_likes|schema cache/i.test(e.message)
      ? 'The feed isn’t set up yet — apply migration 0020 in Supabase.'
      : 'Couldn’t load the feed. Check your connection and try again.';

  /**
   * The query behind whichever tab is showing.
   *
   * For You asks for everything — an empty id list with `exclude` is not a
   * filter at all — while Following asks for exactly the followed shops, and
   * gets nothing when the buyer follows nobody (which is the empty state the
   * page renders a prompt for).
   */
  const scope = followingOnly
    ? { boutiqueIds: followedIds, exclude: false }
    : { boutiqueIds: [] as string[], exclude: true };

  // First page (and a reload whenever the followed set, the lens or the sort
  // changes).
  useEffect(() => {
    // Nothing to ask for until the catalogue has resolved which shops exist.
    if (catalogLoading && boutiques.length === 0) return;
    let active = true;
    setLoading(true);
    setError(null);
    setExhausted(false);

    fetchFeed({ ...scope, limit: PAGE, category, sort: activeSort })
      .then((first) => {
        if (!active) return;
        setItems(first);
        setExhausted(first.length < PAGE);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setItems([]);
        setError(describeError(e));
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, catalogLoading, category, followingOnly, activeSort]);

  const loadMore = useCallback(async () => {
    if (loadingMore || exhausted || loading || items.length === 0) return;
    setLoadingMore(true);
    try {
      const rows = await fetchFeed({
        boutiqueIds: followingOnly ? idsRef.current : [],
        exclude: !followingOnly,
        limit: PAGE,
        // Newest-first seeks from the last card on screen; the popularity
        // lenses count from how many are already shown (see fetchFeed).
        before: activeSort === 'new' ? items[items.length - 1]?.created_at : undefined,
        offset: activeSort === 'new' ? 0 : items.length,
        category,
        sort: activeSort,
      });

      // The offset-paged lenses can repeat a card when a counter moves
      // mid-scroll, and React would throw on the duplicate key.
      const seen = new Set(items.map((p) => p.id));
      const fresh = rows.filter((r) => !seen.has(r.id));
      setItems((prev) => [...prev, ...fresh]);
      if (rows.length < PAGE) setExhausted(true);
    } catch {
      setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }, [items, loadingMore, exhausted, loading, category, followingOnly, activeSort]);

  // Pull the account's likes once signed in.
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      fetchLikedProducts(uid)
        .then((accountLikes) => {
          if (!active) return;
          // Union with local: a guest tap already moved the counter, so the heart
          // must stay filled even though no row was written for it.
          setLikes((local) => ({ ...local, ...accountLikes }));
        })
        .catch(() => { /* offline — local state still renders */ });
    });
    return () => { active = false; };
  }, []);

  useEffect(() => writeLocalLikes(likes), [likes]);

  // Keep counts honest while the feed is open.
  useEffect(() => subscribeToProductLikes((productId, likesCount) => {
    setItems((prev) => prev.map((p) => (p.id === productId ? { ...p, likes_count: likesCount } : p)));
  }), []);

  const toggleLike = useCallback((productId: string) => {
    const next = !likes[productId];
    setLikes((m) => {
      const copy = { ...m };
      if (next) copy[productId] = true;
      else delete copy[productId];
      return copy;
    });
    // Optimistic: the RPC's return value corrects the number, and realtime keeps
    // it in step with other people tapping the same piece.
    setItems((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, likes_count: Math.max(0, (p.likes_count ?? 0) + (next ? 1 : -1)) } : p)),
    );
    toggleProductLike(productId, next)
      .then((count) => setItems((prev) => prev.map((p) => (p.id === productId ? { ...p, likes_count: count } : p))))
      .catch(() => {
        // Roll the tap back rather than leaving a heart that didn't register.
        setLikes((m) => {
          const copy = { ...m };
          if (next) delete copy[productId];
          else copy[productId] = true;
          return copy;
        });
        setItems((prev) =>
          prev.map((p) => (p.id === productId ? { ...p, likes_count: Math.max(0, (p.likes_count ?? 0) + (next ? -1 : 1)) } : p)),
        );
        showToast("Couldn't register that — check your connection");
      });
  }, [likes, showToast]);

  return { items, followsAnyone, loading, loadingMore, exhausted, error, loadMore, likes, toggleLike };
}
