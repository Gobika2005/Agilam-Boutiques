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
  // `images` defaults to [] when migration 0041 hasn't run yet, so an older
  // deployment degrades to text-only reviews instead of breaking the list.
  return (data ?? []).map((r) => ({ ...r, images: r.images ?? [] })) as ReviewRow[];
}

export type TopReviewRow = ReviewRow & {
  product_title: string | null;
  boutique_name: string | null;
};

/**
 * The best real reviews across the whole catalogue, for the Home page
 * testimonials — highest rated first, ties broken by newest, and only ones
 * with actual written feedback (a bare star rating reads as filler there).
 * Empty list on any read failure, so Home just hides the section rather than
 * falling back to invented quotes.
 */
export async function fetchTopReviews(limit = 6): Promise<TopReviewRow[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select('*, products(title), boutiques(name)')
    .neq('body', '')
    .gte('rating', 4)
    .order('rating', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (!isMissingTable(error)) console.error('fetchTopReviews failed:', error.message);
    return [];
  }
  return (data ?? []).map((row) => {
    const { products, boutiques, ...rest } = row as unknown as ReviewRow & {
      products: { title: string } | null;
      boutiques: { name: string } | null;
    };
    return { ...rest, images: rest.images ?? [], product_title: products?.title ?? null, boutique_name: boutiques?.name ?? null };
  });
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
    console.error('submitReview failed:', error.message);
    return { ok: false, error: 'Could not save your review. Please try again.' };
  }
  return { ok: true, review: { ...data, images: data.images ?? [] } as ReviewRow };
}
