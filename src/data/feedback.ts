/**
 * Post-delivery feedback (migration 0071).
 *
 * Two separate things, deliberately not merged:
 *
 *   • Product reviews live in `src/data/reviews.ts` and are PUBLIC. They are
 *     also what rates the boutique — 0014's trigger recomputes
 *     `boutiques.rating` from them — so there is no separate shop review.
 *   • Platform feedback lives here and is PRIVATE. No public read policy
 *     exists, and no seller can see it.
 *
 * Everything degrades quietly if 0071 has not been applied: the prompt simply
 * never appears, rather than an order screen breaking.
 */
import { supabase } from '@/lib/supabase';

export type PlatformFeedbackRow = {
  id: string;
  buyer_id: string;
  order_id: string | null;
  rating: number;
  body: string;
  created_at: string;
};

/**
 * Record how the buyer found MangaiMart itself.
 *
 * Upserted on (buyer_id, order_id) so a buyer who reopens the sheet edits their
 * answer instead of stacking a second row.
 */
export async function submitPlatformFeedback(input: {
  buyerId: string;
  orderId: string;
  rating: number;
  body: string;
}): Promise<void> {
  const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
  const { error } = await supabase.from('platform_feedback').upsert(
    {
      buyer_id: input.buyerId,
      order_id: input.orderId,
      rating,
      body: input.body.trim(),
    },
    { onConflict: 'buyer_id,order_id' },
  );
  if (error) throw error;
}

/**
 * Stop asking about this order.
 *
 * Through an RPC because `orders` has no buyer update policy and must not get
 * one. Never throws: failing to record a dismissal must not block the sheet
 * from closing — the worst case is being asked again, which beats being stuck.
 */
export async function dismissOrderReview(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('dismiss_order_review', { p_order_id: orderId });
  if (error) console.error('dismissOrderReview failed:', error.message);
}

/**
 * Product ids this buyer has already reviewed, out of the ones passed in.
 *
 * Drives both the "already rated" ticks in the sheet and whether an order still
 * needs prompting at all.
 */
export async function fetchReviewedProductIds(buyerId: string, productIds: string[]): Promise<Set<string>> {
  if (!buyerId || productIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('reviews')
    .select('product_id')
    .eq('buyer_id', buyerId)
    .in('product_id', productIds);
  if (error) {
    console.error('fetchReviewedProductIds failed:', error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => (r as { product_id: string }).product_id));
}

/** Order ids this buyer has already given platform feedback on. */
export async function fetchFeedbackGivenOrderIds(buyerId: string): Promise<Set<string>> {
  if (!buyerId) return new Set();
  const { data, error } = await supabase
    .from('platform_feedback')
    .select('order_id')
    .eq('buyer_id', buyerId);
  if (error) {
    // Missing table (0071 not applied) is not worth surfacing — the prompt just
    // treats every order as un-reviewed and the sheet's own writes will fail
    // loudly if the buyer actually tries.
    console.error('fetchFeedbackGivenOrderIds failed:', error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => (r as { order_id: string | null }).order_id).filter(Boolean) as string[]);
}

/**
 * Orders this buyer has told us to stop asking about.
 *
 * Read on its own rather than added to the orders SELECT: that list already
 * carries a fallback group for 0063's columns, and folding 0071's in would mean
 * an un-applied 0071 silently dropped the tracking columns too. A missing
 * column here just means nothing is dismissed yet.
 */
export async function fetchDismissedOrderIds(buyerId: string): Promise<Set<string>> {
  if (!buyerId) return new Set();
  const { data, error } = await supabase
    .from('orders')
    .select('id')
    .eq('buyer_id', buyerId)
    .not('review_dismissed_at', 'is', null);
  if (error) {
    console.error('fetchDismissedOrderIds failed:', error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => (r as { id: string }).id));
}

/* ── Admin ─────────────────────────────────────────────────────────────────── */

export type AdminFeedbackRow = PlatformFeedbackRow & {
  buyer: { full_name: string | null; city: string | null } | null;
};

/** Everything buyers have said about MangaiMart, newest first. Admin-only by RLS. */
export async function fetchPlatformFeedback(): Promise<AdminFeedbackRow[]> {
  const { data, error } = await supabase
    .from('platform_feedback')
    .select('id, buyer_id, order_id, rating, body, created_at, buyer:profiles!platform_feedback_buyer_id_fkey(full_name, city)')
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as AdminFeedbackRow[];
}
