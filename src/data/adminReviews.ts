import { supabase } from '@/lib/supabase';

/**
 * Admin reviews moderation — reads every review across the platform (past the
 * buyer-only RLS via the "reviews: admin read" policy in migration 0048) and
 * lets an admin hide or delete abuse. Degrades gracefully if 0048 hasn't run:
 * `hidden` reads as false and hide/delete return a clear message.
 */
export interface AdminReviewRow {
  id: string;
  product_id: string;
  boutique_id: string;
  rating: number;
  body: string;
  author_name: string | null;
  verified_purchase: boolean;
  images: string[];
  hidden: boolean;
  seller_reply: string | null;
  created_at: string;
  product_title: string | null;
  boutique_name: string | null;
}

function isMissing(error: { code?: string; message?: string } | null, what = 'reviews'): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || new RegExp(`relation .*${what}.* does not exist`, 'i').test(error.message ?? '');
}

export async function fetchAllReviews(): Promise<AdminReviewRow[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select('*, products(title), boutiques(name)')
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) {
    if (!isMissing(error)) console.error('fetchAllReviews failed:', error.message);
    return [];
  }
  return (data ?? []).map((row) => {
    const { products, boutiques, ...rest } = row as unknown as Record<string, unknown> & {
      products: { title: string } | null;
      boutiques: { name: string } | null;
    };
    return {
      ...(rest as unknown as AdminReviewRow),
      images: (rest.images as string[] | null) ?? [],
      hidden: (rest.hidden as boolean | null) ?? false,
      seller_reply: (rest.seller_reply as string | null) ?? null,
      product_title: products?.title ?? null,
      boutique_name: boutiques?.name ?? null,
    };
  });
}

export type ModResult = { ok: true } | { ok: false; error: string };

export async function setReviewHidden(id: string, hidden: boolean): Promise<ModResult> {
  const { error } = await supabase.from('reviews').update({ hidden }).eq('id', id);
  if (error) {
    if (/column .*hidden.* does not exist/i.test(error.message)) return { ok: false, error: 'Moderation needs migration 0048.' };
    console.error('setReviewHidden failed:', error.message);
    return { ok: false, error: 'Could not update the review.' };
  }
  return { ok: true };
}

export async function deleteReview(id: string): Promise<ModResult> {
  const { error } = await supabase.from('reviews').delete().eq('id', id);
  if (error) {
    console.error('deleteReview failed:', error.message);
    return { ok: false, error: 'Could not delete the review.' };
  }
  return { ok: true };
}
