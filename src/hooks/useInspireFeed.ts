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
import { readLocalLikes, writeLocalLikes } from '@/lib/feedLocal';

const PAGE = 6;

/**
 * Which half of the feed a card belongs to. `following` is everything from the
 * shops the buyer follows; `discover` is everyone else, appended once the first
 * half runs out.
 */
export type FeedPhase = 'following' | 'discover';

export type FeedItem = FeedProduct & { phase: FeedPhase };

/**
 * The Inspire feed: the shops you follow first, then the rest of the market.
 *
 * The feed reads straight from the catalogue — a boutique lists a piece and it
 * appears here, with no separate posting step. It pages through the followed
 * shops until they're exhausted, then keeps going with every other approved
 * boutique, so the buyer never hits a dead end at the bottom. The page marks the
 * hand-over with a divider.
 *
 * Likes are local-first (buyers browse anonymously) and reconciled with the
 * account when there is one.
 */
export function useInspireFeed(category?: string) {
  const { follows, showToast } = useShop();
  const { boutiques, loading: catalogLoading } = useCatalog();

  const [items, setItems] = useState<FeedItem[]>([]);
  const [phase, setPhase] = useState<FeedPhase>('following');
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
  const idsKey = followedIds.join(',');
  const idsRef = useRef(followedIds);
  idsRef.current = followedIds;

  const describeError = (e: unknown) =>
    e instanceof Error && /likes_count|product_likes|schema cache/i.test(e.message)
      ? 'The feed isn’t set up yet — apply migration 0020 in Supabase.'
      : 'Couldn’t load the feed. Check your connection and try again.';

  // First page (and a reload whenever the followed set changes).
  useEffect(() => {
    // Nothing to ask for until the catalogue has resolved which shops exist.
    if (catalogLoading && boutiques.length === 0) return;
    let active = true;
    setLoading(true);
    setError(null);
    setExhausted(false);

    // Someone following nobody starts straight in discover — there is no first
    // phase to run out of.
    const startPhase: FeedPhase = followsAnyone ? 'following' : 'discover';

    (async () => {
      const first = await fetchFeed({
        boutiqueIds: followedIds,
        exclude: startPhase === 'discover',
        limit: PAGE,
        category,
      });
      if (!active) return;
      setItems(first.map((p) => ({ ...p, phase: startPhase })));

      // A followed set that returns a short first page has already run dry, so
      // roll straight into discover rather than making the buyer scroll to find
      // out there's nothing more.
      if (startPhase === 'following' && first.length < PAGE) {
        const rest = await fetchFeed({ boutiqueIds: followedIds, exclude: true, limit: PAGE, category });
        if (!active) return;
        const seen = new Set(first.map((p) => p.id));
        setItems([
          ...first.map((p) => ({ ...p, phase: 'following' as FeedPhase })),
          ...rest.filter((r) => !seen.has(r.id)).map((p) => ({ ...p, phase: 'discover' as FeedPhase })),
        ]);
        setPhase('discover');
        setExhausted(rest.length < PAGE);
      } else {
        setPhase(startPhase);
        setExhausted(startPhase === 'discover' && first.length < PAGE);
      }
    })()
      .catch((e: unknown) => {
        if (!active) return;
        setItems([]);
        setError(describeError(e));
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, catalogLoading, category]);

  const loadMore = useCallback(async () => {
    if (loadingMore || exhausted || loading || items.length === 0) return;
    setLoadingMore(true);
    try {
      const followed = idsRef.current;
      // Page within the current phase from the last card *of that phase* — the
      // two halves have independent cursors.
      const lastOfPhase = [...items].reverse().find((p) => p.phase === phase);
      const rows = await fetchFeed({
        boutiqueIds: followed,
        exclude: phase === 'discover',
        limit: PAGE,
        before: lastOfPhase?.created_at,
        category,
      });

      const seen = new Set(items.map((p) => p.id));
      const fresh = rows.filter((r) => !seen.has(r.id)).map((p) => ({ ...p, phase }));

      if (rows.length < PAGE && phase === 'following') {
        // The followed shops are done. Hand over to discover in the same tick so
        // the scroll never stalls.
        const rest = await fetchFeed({ boutiqueIds: followed, exclude: true, limit: PAGE, category });
        const seenNow = new Set([...seen, ...fresh.map((p) => p.id)]);
        setItems((prev) => [
          ...prev,
          ...fresh,
          ...rest.filter((r) => !seenNow.has(r.id)).map((p) => ({ ...p, phase: 'discover' as FeedPhase })),
        ]);
        setPhase('discover');
        setExhausted(rest.length < PAGE);
      } else {
        setItems((prev) => [...prev, ...fresh]);
        if (rows.length < PAGE) setExhausted(true);
      }
    } catch {
      setExhausted(true);
    } finally {
      setLoadingMore(false);
    }
  }, [items, phase, loadingMore, exhausted, loading, category]);

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
