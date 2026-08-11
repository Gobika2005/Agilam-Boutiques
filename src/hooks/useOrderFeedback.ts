/**
 * Which delivered orders still deserve a "how was it?" — shared by every place
 * that asks.
 *
 * The prompt appears in four places: the order screen, the orders list, a
 * notification, and a pop-up on the next visit. Without one shared answer they
 * would each decide independently and a buyer who had already reviewed would
 * keep being asked, which is how a helpful nudge turns into nagging. So all
 * four read this.
 *
 * "Answered" is deliberately generous: rating ONE item, or leaving platform
 * feedback, counts for the whole order. Continuing to chase the rest would be
 * squeezing a buyer who has already done us a favour.
 */
import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import {
  fetchDismissedOrderIds, fetchFeedbackGivenOrderIds, fetchReviewedProductIds,
} from '@/data/feedback';
import type { PlacedOrder } from '@/lib/orderHistory';

export function useOrderFeedback(orders: PlacedOrder[]) {
  const { session } = useAuth();
  const buyerId = session?.user?.id ?? '';

  // Only a signed-in buyer's order has a DB row id, and reviews are keyed to a
  // profile — so there is nothing to ask a guest for.
  const delivered = useMemo(
    () => orders.filter((o) => o.status === 'delivered' && o.rowId),
    [orders],
  );

  const productIds = useMemo(() => {
    const set = new Set<string>();
    for (const o of delivered) for (const it of o.items) if (it.pid) set.add(it.pid);
    return [...set];
  }, [delivered]);

  // Keyed on the id lists so this refetches when a new order is delivered, not
  // on every render of a list whose contents are unchanged.
  const key = `${buyerId}|${productIds.join(',')}`;

  const { data, reload } = useAsync(
    async () => {
      if (!buyerId) return { reviewed: new Set<string>(), given: new Set<string>(), dismissed: new Set<string>() };
      const [reviewed, given, dismissed] = await Promise.all([
        fetchReviewedProductIds(buyerId, productIds),
        fetchFeedbackGivenOrderIds(buyerId),
        fetchDismissedOrderIds(buyerId),
      ]);
      return { reviewed, given, dismissed };
    },
    [key],
    // Nothing here changes underneath the buyer except by their own action, and
    // that path calls `reload` directly.
    { live: false },
  );

  const reviewedProductIds = data?.reviewed ?? new Set<string>();

  /** True while this order has had no answer of any kind and wasn't dismissed. */
  const needsFeedback = useCallback(
    (o: PlacedOrder): boolean => {
      if (!buyerId || !o.rowId || o.status !== 'delivered') return false;
      if (data?.dismissed.has(o.rowId)) return false;
      if (data?.given.has(o.rowId)) return false;
      return !o.items.some((it) => it.pid && reviewedProductIds.has(it.pid));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buyerId, data],
  );

  /** The one to interrupt for, if any — most recently delivered first. */
  const nextToAsk = useMemo(() => {
    const pending = delivered.filter(needsFeedback);
    return pending.sort(
      (a, b) => new Date(b.deliveredAt ?? b.placedAt).getTime() - new Date(a.deliveredAt ?? a.placedAt).getTime(),
    )[0];
  }, [delivered, needsFeedback]);

  // Local suppression so dismissing the pop-up doesn't re-open it on the next
  // render while the DB write is still in flight.
  const [suppressed, setSuppressed] = useState<Set<string>>(new Set());
  const suppress = useCallback((orderId: string) => {
    setSuppressed((s) => new Set(s).add(orderId));
  }, []);

  return {
    needsFeedback: (o: PlacedOrder) => needsFeedback(o) && !suppressed.has(o.rowId ?? ''),
    nextToAsk: nextToAsk && !suppressed.has(nextToAsk.rowId ?? '') ? nextToAsk : undefined,
    reviewedProductIds,
    suppress,
    reload,
  };
}
