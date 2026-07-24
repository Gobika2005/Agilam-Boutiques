import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/uploadImage';
import type { ProductWithBoutique } from './types';

export type ProductFilters = {
  maxPrice?: number;
  categories?: string[];
  colors?: string[];
  occasions?: string[];
  sort?: 'Latest' | 'Price: Low to High' | 'Price: High to Low' | 'Popularity';
};

const SELECT = '*, boutique:boutiques(name, city, tone)';

export async function fetchProducts(filters: ProductFilters = {}): Promise<ProductWithBoutique[]> {
  // Only surface live products to buyers — admin moderation (hidden/rejected)
  // and soft-deletes drop out of discovery. Existing rows default to 'active'.
  let query = supabase.from('products').select(SELECT).eq('status', 'active').is('deleted_at', null);

  if (filters.maxPrice != null) query = query.lte('price', filters.maxPrice);
  if (filters.categories?.length) query = query.in('category', filters.categories);
  if (filters.colors?.length) query = query.in('color', filters.colors);
  if (filters.occasions?.length) query = query.in('occasion', filters.occasions);

  if (filters.sort === 'Price: Low to High') query = query.order('price', { ascending: true });
  else if (filters.sort === 'Price: High to Low') query = query.order('price', { ascending: false });
  else if (filters.sort === 'Popularity') query = query.order('reviews_count', { ascending: false });
  else query = query.order('created_at', { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ProductWithBoutique[];
}

export async function fetchProduct(id: string): Promise<ProductWithBoutique | null> {
  // No status filter here on purpose: this is dual-use (buyer PDP + the seller's
  // own ProductAnalytics), and hiding a moderation-hidden product from anonymous
  // buyers while still letting its owner see it is enforced by RLS (migration
  // 0034), not by a query filter that would blind the seller to their own item.
  const { data, error } = await supabase
    .from('products')
    .select(SELECT)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as ProductWithBoutique | null;
}

export async function fetchProductsByBoutique(boutiqueId: string): Promise<ProductWithBoutique[]> {
  const { data, error } = await supabase.from('products').select(SELECT).eq('boutique_id', boutiqueId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as ProductWithBoutique[];
}

export async function createProduct(input: {
  boutique_id: string;
  title: string;
  category: string;
  price: number;
  stock: number;
  fabric?: string;
  color?: string;
  occasion?: string;
  tone?: number;
  description?: string;
  mrp?: number | null;
  sizes?: string[];
  wash_care?: string;
  image_url?: string;
  images?: string[];
}) {
  const { error } = await supabase.from('products').insert(input);
  if (error) throw error;
}

export async function updateProduct(
  id: string,
  patch: Partial<{
    title: string;
    price: number;
    stock: number;
    category: string;
    color: string;
    occasion: string;
    fabric: string;
    description: string;
    mrp: number | null;
    sizes: string[];
    wash_care: string;
    image_url: string;
    images: string[];
  }>,
) {
  const { error } = await supabase.from('products').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteProduct(id: string) {
  const { error } = await supabase.from('products').delete().eq('id', id);
  if (error) throw error;
}

/** Uploads a product photo to the public `product-images` bucket, scoped under
 *  the boutique's id so photos stay grouped per shop. */
export async function uploadProductImage(boutiqueId: string, file: File): Promise<string> {
  return uploadImage('product-images', boutiqueId, file, '0017');
}

/**
 * Record that a buyer opened this product page. The seller reads the resulting
 * `views_count`/`last_viewed_at` off their own catalogue row. Best-effort — a
 * failed view must never break browsing — and throttled once per product per
 * browser session so a re-render or a back-and-forth doesn't inflate it.
 * (RPC + counter columns land in migration 0031.)
 */
const VIEWED_KEY = 'agx.viewed';
export async function recordProductView(productId: string): Promise<void> {
  try {
    const seen = new Set<string>(JSON.parse(sessionStorage.getItem(VIEWED_KEY) ?? '[]'));
    if (seen.has(productId)) return;
    seen.add(productId);
    sessionStorage.setItem(VIEWED_KEY, JSON.stringify([...seen]));
  } catch {
    /* private mode / no sessionStorage — fall through and still record once */
  }
  await supabase.rpc('record_product_view', { pid: productId });
}

/** Record that a buyer shared this product. Best-effort. */
export async function recordProductShare(productId: string): Promise<void> {
  await supabase.rpc('record_product_share', { pid: productId });
}
