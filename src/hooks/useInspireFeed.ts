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
} from '@/data/feed';
import { rankFeed } from '@/lib/ranking';
import { readLocalLikes, writeLocalLikes } from '@/lib/feedLocal';

/** Cards revealed per step of the infinite scroll. */
const PAGE = 6;

/**
 * Rows pulled from the database per round trip.
 *
 * The feed's order is decided on the client (see `rankFeed`), so it has to hold
 * a batch of the catalogue to rank rather than asking the database for six rows
 * in the order it wants them — no `order by` expresses "recency and likes and
 * views and orders and a per-visit shuffle". Ten pages' worth per trip: enough
 * that a whole session usually costs one query, small enough not to ship the
 * catalogue to a phone on a slow connection.
 */
const BATCH = PAGE * 10;

export type FeedItem = FeedProduct;

/**
 * The Inspire feed.
 *
 * The feed reads straight from the catalogue — a boutique lists a piece and it
 * appears here, with no separate posting step. Two tabs, and they are genuinely
 * different feeds rather than two orderings of one:
 *
 *   • For You (`followingOnly: false`) is the whole approved market, ordered by
 *     `rankFeed`: recency, likes, views and orders, blended with a per-visit
 *     random term, and the same shop's pieces pulled apart so no boutique holds
 *     a run of the feed. It used to run the followed shops first and hand over
 *     to everyone else at a divider, which meant a buyer who follows three
 *     boutiques saw those three boutiques and little else — the opposite of
 *     what a discovery feed is for. Following now has its own tab, so For You
 *     is free to be discovery.
 *   • Following (`followingOnly: true`) is strictly the shops the buyer follows,
 *     newest first, never reordered and never widened. It answers "what have my
 *     shops posted", and a shuffle would make that unanswerable.
 *
 * Likes are local-first (buyers browse anonymously) and reconciled with the
 * account when there is one.
 */
export function useInspireFeed(opts: { category?: string; followingOnly?: boolean } = {}) {
  const { category, followingOnly = false } = opts;
  const { follows, showToast } = useShop();
  const { boutiques, loading: catalogLoading } = useCatalog();

  /**
   * Everything fetched so far, already in feed order, and how much of it the
   * buyer has scrolled into view.
   *
   * The two are separate because ranking and paging are no longer the same
   * thing: a batch is fetched and ordered once, then revealed a page at a time.
   * Most "load more" steps are therefore a state update with no network at all.
   */
  const [ranked, setRanked] = useState<FeedItem[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  /** Whether the database has older rows left, as opposed to the screen. */
  const [batchesLeft, setBatchesLeft] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [likes, setLikes] = useState<Record<string, boolean>>(() => readLocalLikes());

  /**
   * The shuffle's seed, fixed for this visit to Inspire.
   *
   * Fixed matters: it is what keeps the order steady while the buyer scrolls, so
   * a card can't move out from under a thumb mid-tap and page two can't repeat
   * page one. It is drawn once when the screen mounts, so leaving Inspire and
   * coming back deals a different feed — which is the point of shuffling at all.
   */
  const seedRef = useRef<number>(Math.floor(Math.random() * 0xffffffff));

  /** `created_at` of the oldest row fetched — the keyset cursor for the next batch. */
  const cursorRef = useRef<string | undefined>(undefined);

  const items = useMemo(() => ranked.slice(0, shown), [ranked, shown]);

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

  /**
   * Put a freshly fetched batch into feed order.
   *
   * For You is ranked and spread; Following is left exactly as the database
   * returned it, newest first. `after` carries the last boutique of what is
   * already on screen, so the "no two cards from one shop in a row" rule holds
   * across the seam between batches too.
   */
  const order = useCallback(
    (rows: FeedProduct[], after?: string) =>
      followingOnly ? rows : rankFeed(rows, seedRef.current, after),
    [followingOnly],
  );

  // First batch (and a reload whenever the tab or the followed set changes).
  useEffect(() => {
    // Nothing to ask for until the catalogue has resolved which shops exist.
    if (catalogLoading && boutiques.length === 0) return;
    let active = true;
    setLoading(true);
    setError(null);
    setBatchesLeft(true);
    setShown(PAGE);

    fetchFeed({ ...scope, limit: BATCH, category })
      .then((first) => {
        if (!active) return;
        cursorRef.current = first[first.length - 1]?.created_at;
        setRanked(order(first));
        setBatchesLeft(first.length === BATCH);
      })
      .catch((e: unknown) => {
        if (!active) return;
        setRanked([]);
        setError(describeError(e));
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, catalogLoading, category, followingOnly]);

  /** Nothing on screen, nothing left to fetch. */
  const exhausted = shown >= ranked.length && !batchesLeft;

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || exhausted || ranked.length === 0) return;

    // The common step: the batch already holds more than is on screen, so the
    // next page is a reveal, not a round trip.
    if (shown < ranked.length) {
      setShown((n) => n + PAGE);
      return;
    }

    setLoadingMore(true);
    try {
      const rows = await fetchFeed({
        boutiqueIds: followingOnly ? idsRef.current : [],
        exclude: !followingOnly,
        limit: BATCH,
        before: cursorRef.current,
        category,
      });
      cursorRef.current = rows[rows.length - 1]?.created_at ?? cursorRef.current;

      // A boutique listing something mid-scroll can push a row across the
      // cursor, so a batch can overlap the one before it — and React throws on
      // a duplicate key.
      const seen = new Set(ranked.map((p) => p.id));
      const fresh = rows.filter((r) => !seen.has(r.id));

      setRanked((prev) => [...prev, ...order(fresh, prev[prev.length - 1]?.boutique_id)]);
      setShown((n) => n + PAGE);
      setBatchesLeft(rows.length === BATCH);
    } catch {
      // Stop asking rather than retrying into a failing connection on every
      // scroll; the cards already fetched stay on screen.
      setBatchesLeft(false);
    } finally {
      setLoadingMore(false);
    }
  }, [ranked, shown, loadingMore, loading, exhausted, category, followingOnly, order]);

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

  // Keep counts honest while the feed is open. Only the number changes — the
  // order was fixed when the batch was ranked, so a like landing mid-scroll
  // never moves a card out from under the buyer.
  useEffect(() => subscribeToProductLikes((productId, likesCount) => {
    setRanked((prev) => prev.map((p) => (p.id === productId ? { ...p, likes_count: likesCount } : p)));
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
    setRanked((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, likes_count: Math.max(0, (p.likes_count ?? 0) + (next ? 1 : -1)) } : p)),
    );
    toggleProductLike(productId, next)
      .then((count) => setRanked((prev) => prev.map((p) => (p.id === productId ? { ...p, likes_count: count } : p))))
      .catch(() => {
        // Roll the tap back rather than leaving a heart that didn't register.
        setLikes((m) => {
          const copy = { ...m };
          if (next) delete copy[productId];
          else copy[productId] = true;
          return copy;
        });
        setRanked((prev) =>
          prev.map((p) => (p.id === productId ? { ...p, likes_count: Math.max(0, (p.likes_count ?? 0) + (next ? -1 : 1)) } : p)),
        );
        showToast("Couldn't register that — check your connection");
      });
  }, [likes, showToast]);

  return { items, followsAnyone, loading, loadingMore, exhausted, error, loadMore, likes, toggleLike };
}
