import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/uploadImage';

/**
 * Product reviews — reads and writes the `reviews` table added in migration
 * 0014. Reviews are public (RLS lets anyone read those on approved boutiques),
 * so this loads for anonymous buyers too; only submitting requires a signed-in
 * buyer (RLS: buyer_id = auth.uid()).
 *
 * If migration 0014 hasn't been applied yet the table is missing; reads resolve
 * to an empty list and a submit surfaces a clear "not available yet" message,
 * so the app degrades gracefully rather than throwing.
 */

export type ReviewRow = {
  id: string;
  product_id: string;
  boutique_id: string;
  buyer_id: string;
  rating: number;
  body: string;
  author_name: string | null;
  verified_purchase: boolean;
  created_at: string;
  /** Buyer-uploaded photos of the piece as delivered (migration 0041). */
  images: string[];
  /** The boutique's public reply, and when it was posted (migration 0045). */
  seller_reply: string | null;
  seller_reply_at: string | null;
};

/** Uploads one review photo to the buyer's own folder and returns its public URL. */
export function uploadReviewImage(buyerId: string, file: File): Promise<string> {
  return uploadImage('review-images', buyerId, file, '0041');
}

// Postgres/PostgREST codes that mean "the reviews table isn't there yet".
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || /relation .*reviews.* does not exist/i.test(error.message ?? '');
}

/** All reviews for a product, newest first. Empty list on any read failure. */
export async function fetchReviews(productId: string): Promise<ReviewRow[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false });
  if (error) {
    if (!isMissingTable(error)) console.error('fetchReviews failed:', error.message);
    return [];
  }
  // `images` defaults to [] when migration 0041 hasn't run yet, and the reply
  // columns to null before 0045, so an older deployment degrades gracefully
  // instead of breaking the list. Admin-hidden reviews (0048) are dropped;
  // `hidden` reads as undefined before that migration, so nothing is lost.
  return (data ?? []).filter((r) => !(r as { hidden?: boolean }).hidden).map(normalizeReview) as ReviewRow[];
}

/**
 * Whether this buyer may review this piece — i.e. has had it delivered.
 *
 * The rule lives in the database (migration 0083); this is the same question
 * asked ahead of time so the page can explain itself instead of offering a form
 * that fails on submit. It is a courtesy, never the control: a client that
 * skips this call still gets refused by RLS.
 *
 * Reads `order_items` with an inner join onto the buyer's own orders, which
 * their own RLS already permits — no new grant, and a signed-out visitor simply
 * gets `false`.
 */
export async function canReviewProduct(buyerId: string | null | undefined, productId: string): Promise<boolean> {
  if (!buyerId) return false;
  const { data, error } = await supabase
    .from('order_items')
    .select('id, orders!inner(buyer_id, status)')
    .eq('product_id', productId)
    .eq('orders.buyer_id', buyerId)
    .eq('orders.status', 'delivered')
    .limit(1);
  if (error) {
    // Never block on a failed check — the write is guarded regardless, and a
    // buyer who really has bought the piece should not be told otherwise by a
    // dropped connection.
    console.error('canReviewProduct failed:', error.message);
    return false;
  }
  return (data ?? []).length > 0;
}

/** Fill in columns added by later migrations so an un-migrated DB still parses. */
function normalizeReview<T extends Record<string, unknown>>(r: T): T & Pick<ReviewRow, 'images' | 'seller_reply' | 'seller_reply_at'> {
  return {
    ...r,
    images: (r.images as string[] | null) ?? [],
    seller_reply: (r.seller_reply as string | null) ?? null,
    seller_reply_at: (r.seller_reply_at as string | null) ?? null,
  };
}

/*
 * `fetchTopReviews` used to live here and fed the Home page's "What shoppers say
 * about MangaiMart" section. It was the wrong source: these are reviews of a
 * garment, and the cards printed "Saree · Boutique" under the buyer's name.
 * That section now reads consented platform feedback via
 * `fetchPublicPlatformReviews` in `src/data/feedback.ts` (migration 0084).
 */

export type BoutiqueReviewRow = ReviewRow & {
  product_title: string | null;
  product_image: string | null;
};

/**
 * Every review across a boutique's catalogue, newest first — the seller's
 * reviews inbox. Joins the product title + cover so each review is legible
 * without a second lookup. Empty list on any read failure (RLS lets the owning
 * seller read these via the "reviews: public read" owner branch).
 */
export async function fetchReviewsForBoutique(boutiqueId: string): Promise<BoutiqueReviewRow[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select('*, products(title, image_url)')
    .eq('boutique_id', boutiqueId)
    .order('created_at', { ascending: false });
  if (error) {
    if (!isMissingTable(error)) console.error('fetchReviewsForBoutique failed:', error.message);
    return [];
  }
  return (data ?? []).map((row) => {
    const { products, ...rest } = row as unknown as ReviewRow & { products: { title: string; image_url: string | null } | null };
    return { ...normalizeReview(rest), product_title: products?.title ?? null, product_image: products?.image_url ?? null };
  });
}

export type ReplyResult = { ok: true; review: ReviewRow } | { ok: false; error: string };

/**
 * Post, edit or clear the boutique's public reply to one of its reviews. A blank
 * reply clears it. Goes through the `reply_to_review` RPC (migration 0045) which
 * checks boutique ownership and only ever writes the reply columns.
 */
export async function replyToReview(reviewId: string, reply: string): Promise<ReplyResult> {
  const { data, error } = await supabase.rpc('reply_to_review', { p_review_id: reviewId, p_reply: reply });
  if (error) {
    if (/function .*reply_to_review.* does not exist/i.test(error.message)) {
      return { ok: false, error: 'Replies are not enabled yet. Please try again later.' };
    }
    console.error('replyToReview failed:', error.message);
    return { ok: false, error: 'Could not save your reply. Please try again.' };
  }
  return { ok: true, review: normalizeReview(data as Record<string, unknown>) as ReviewRow };
}

export type SubmitReviewInput = {
  productId: string;
  boutiqueId: string;
  buyerId: string;
  rating: number;
  body: string;
  authorName?: string | null;
  images?: string[];
};

export type SubmitReviewResult = { ok: true; review: ReviewRow } | { ok: false; error: string };

/**
 * Create or update the signed-in buyer's review for a product. The unique
 * (product_id, buyer_id) constraint means a second submission edits the first,
 * so `upsert` keeps one review per buyer per product.
 */
export async function submitReview(input: SubmitReviewInput): Promise<SubmitReviewResult> {
  const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
  const body = input.body.trim();
  if (!input.buyerId) return { ok: false, error: 'Please sign in to write a review.' };

  const { data, error } = await supabase
    .from('reviews')
    .upsert(
      {
        product_id: input.productId,
        boutique_id: input.boutiqueId,
        buyer_id: input.buyerId,
        rating,
        body,
        author_name: input.authorName ?? null,
        images: input.images ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'product_id,buyer_id' },
    )
    .select('*')
    .single();

  if (error) {
    if (isMissingTable(error)) {
      return { ok: false, error: 'Reviews are not enabled yet. Please try again later.' };
    }
    // The purchase rule from migration 0083. A buyer who gets here has usually
    // had the form open since before their order changed state, so name the
    // condition rather than showing them a generic failure they cannot act on.
    // 42501 = insufficient_privilege, which is how PostgREST reports an RLS
    // refusal on a write.
    if (error.code === '42501' || /row-level security/i.test(error.message ?? '')) {
      return { ok: false, error: 'You can review a piece once your order for it has been delivered.' };
    }
    console.error('submitReview failed:', error.message);
    return { ok: false, error: 'Could not save your review. Please try again.' };
  }
  return { ok: true, review: normalizeReview(data as Record<string, unknown>) as ReviewRow };
}
