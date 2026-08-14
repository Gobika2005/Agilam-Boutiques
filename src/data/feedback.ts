/**
 * Post-delivery feedback (migration 0071).
 *
 * Two separate things, deliberately not merged:
 *
 *   • Product reviews live in `src/data/reviews.ts` and are PUBLIC. They are
 *     also what rates the boutique — 0014's trigger recomputes
 *     `boutiques.rating` from them — so there is no separate shop review.
 *   • Platform feedback lives here and is PRIVATE BY DEFAULT. No seller can see
 *     it. Migration 0084 adds one narrow exception: a buyer may tick a box to
 *     let their words be quoted on the Home page, and an admin must then approve
 *     it. Both flags, or it stays private — see `submitPlatformFeedback`.
 *
 * Everything degrades quietly if 0071 has not been applied: the prompt simply
 * never appears, rather than an order screen breaking. Same for 0084 — consent
 * is dropped from the write and the Home section hides itself.
 */
import { supabase } from '@/lib/supabase';

export type PlatformFeedbackRow = {
  id: string;
  buyer_id: string;
  order_id: string | null;
  rating: number;
  body: string;
  created_at: string;
  /** The buyer agreed to be quoted publicly (0084). */
  publish_consent: boolean;
  /** An admin approved the quote for the Home page (0084). */
  published: boolean;
  published_at: string | null;
  /** Display name snapshotted when consent was given (0084). */
  author_name: string | null;
};

/** Postgres/PostgREST codes that mean "0084 hasn't been applied yet". */
function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST204' || /column .*(publish_consent|published|author_name)/i.test(error.message ?? '');
}

/**
 * Record how the buyer found MangaiMart itself.
 *
 * Upserted on (buyer_id, order_id) so a buyer who reopens the sheet edits their
 * answer instead of stacking a second row — which also means un-ticking the
 * consent box on a second pass withdraws it, and 0084's trigger unpublishes.
 *
 * `published` is never written from here. Consent is the buyer's to give;
 * approval is the operator's, and the trigger enforces that split.
 */
export async function submitPlatformFeedback(input: {
  buyerId: string;
  orderId: string;
  rating: number;
  body: string;
  /** Tick-box: may we quote this publicly? Defaults to no. */
  publishConsent?: boolean;
  /** Name to show if it is ever published. */
  authorName?: string | null;
}): Promise<void> {
  const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
  const base = {
    buyer_id: input.buyerId,
    order_id: input.orderId,
    rating,
    body: input.body.trim(),
  };
  const { error } = await supabase.from('platform_feedback').upsert(
    { ...base, publish_consent: !!input.publishConsent, author_name: input.authorName ?? null },
    { onConflict: 'buyer_id,order_id' },
  );
  if (!error) return;
  // 0084 not applied yet: keep the feedback, drop the consent. Losing the
  // opt-in is far better than losing what the buyer took the time to write.
  if (!isMissingColumn(error)) throw error;
  const retry = await supabase.from('platform_feedback').upsert(base, { onConflict: 'buyer_id,order_id' });
  if (retry.error) throw retry.error;
}

/* ── The Home page testimonials ────────────────────────────────────────────── */

export type PublicPlatformReview = {
  id: string;
  rating: number;
  body: string;
  author_name: string;
  city: string | null;
  verified: boolean;
  created_at: string;
};

/**
 * Consented, admin-approved quotes about MangaiMart — the Home page section.
 *
 * Goes through the `public_platform_reviews` definer RPC (0084) rather than
 * reading the table: a select policy would hand an anonymous visitor the whole
 * row, `buyer_id` and `order_id` included. The RPC returns only what a
 * testimonial needs.
 *
 * Empty list on any failure, including 0084 not being applied, so Home hides the
 * section rather than falling back to product reviews or invented quotes.
 */
export async function fetchPublicPlatformReviews(limit = 3): Promise<PublicPlatformReview[]> {
  const { data, error } = await supabase.rpc('public_platform_reviews', { p_limit: limit });
  if (error) {
    if (!/function .*public_platform_reviews.* does not exist/i.test(error.message)) {
      console.error('fetchPublicPlatformReviews failed:', error.message);
    }
    return [];
  }
  return (data ?? []) as PublicPlatformReview[];
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

const BUYER_JOIN = 'buyer:profiles!platform_feedback_buyer_id_fkey(full_name, city)';
const BASE_COLS = `id, buyer_id, order_id, rating, body, created_at, ${BUYER_JOIN}`;

/** Everything buyers have said about MangaiMart, newest first. Admin-only by RLS. */
export async function fetchPlatformFeedback(): Promise<AdminFeedbackRow[]> {
  const query = (cols: string) =>
    supabase.from('platform_feedback').select(cols).order('created_at', { ascending: false }).limit(500);

  const { data, error } = await query(`${BASE_COLS}, publish_consent, published, published_at, author_name`);
  if (!error) return (data ?? []) as unknown as AdminFeedbackRow[];
  // Before 0084 the console still works — every row simply reads as un-consented
  // and the publish control refuses, rather than the page failing to load.
  if (!isMissingColumn(error)) throw error;
  const retry = await query(BASE_COLS);
  if (retry.error) throw retry.error;
  return (retry.data ?? []).map((r) => ({
    ...(r as unknown as AdminFeedbackRow),
    publish_consent: false,
    published: false,
    published_at: null,
    author_name: null,
  }));
}

/**
 * Approve (or withdraw) a quote for the Home page.
 *
 * A plain UPDATE — 0071 already gives admins `for all using (is_admin())`, and
 * 0084's trigger is what stops anyone else doing this. It also refuses to
 * publish a row the buyer never consented to, so a stale admin table that still
 * shows an old consent value fails loudly instead of publishing in error.
 */
export async function setPlatformFeedbackPublished(id: string, published: boolean): Promise<void> {
  const { error } = await supabase.from('platform_feedback').update({ published }).eq('id', id);
  if (error) {
    if (isMissingColumn(error)) throw new Error('Publishing needs migration 0084 to be applied first.');
    if (/publish_needs_consent/i.test(error.message)) {
      throw new Error('This buyer has not agreed to their feedback being published.');
    }
    throw error;
  }
}
