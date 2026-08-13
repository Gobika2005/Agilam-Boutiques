import { supabase } from '@/lib/supabase';
import { slugify } from '@/lib/seo';
import { fmt } from '@/data/demo';
import { ilikeAny } from './query';
import type { SearchHit, SearchSource } from './types';

/**
 * What the storefront search looks through.
 *
 * The buyer's box used to filter whatever `CatalogContext` had already loaded,
 * which is capped by PostgREST's row ceiling — fine at sixteen products, wrong
 * the moment the catalogue outgrows one page. These query the database instead,
 * so a search finds a saree whether or not the grid has met it yet.
 *
 * Every source here runs anonymously. That is deliberate and safe: the RLS
 * policies on `products` and `boutiques` already restrict anon reads to
 * approved boutiques, so the search cannot surface a shop that moderation has
 * not passed. The `status`/`deleted_at` filters below mirror `fetchProducts`
 * so a hidden or soft-deleted item does not reappear through search.
 */

export type BuyerCtx = Record<string, never>;

const PRODUCT_COLUMNS = 'id, slug, title, category, occasion, price, image_url, tone, boutique:boutiques(name, city)';

type ProductRow = {
  id: string;
  slug: string | null;
  title: string;
  category: string | null;
  occasion: string | null;
  price: number;
  image_url: string | null;
  tone: number | null;
  boutique: { name: string | null; city: string | null } | null;
};

const products: SearchSource<BuyerCtx> = {
  key: 'products',
  label: 'Products',
  icon: 'shopping_bag',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('status', 'active')
      .is('deleted_at', null)
      .or(ilikeAny(['title', 'category', 'occasion', 'fabric', 'color'], term))
      .order('reviews_count', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as unknown as ProductRow[]).map<SearchHit>((p) => ({
      id: p.id,
      group: 'products',
      kind: 'product',
      title: p.title,
      sub: [p.category, p.boutique?.name].filter(Boolean).join(' · '),
      right: fmt(Number(p.price) || 0),
      image: p.image_url,
      tone: p.tone ?? 0,
      to: `/products/${p.slug ?? p.id}`,
    }));
  },
};

const BOUTIQUE_COLUMNS = 'id, slug, name, city, area, logo_url, tone, rating';

type BoutiqueRow = {
  id: string;
  slug: string | null;
  name: string;
  city: string | null;
  area: string | null;
  logo_url: string | null;
  tone: number | null;
  rating: number | null;
};

const boutiques: SearchSource<BuyerCtx> = {
  key: 'boutiques',
  label: 'Boutiques',
  icon: 'storefront',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('boutiques')
      // Never `select('*')` here — migration 0021 revoked the blanket grant.
      .select(BOUTIQUE_COLUMNS)
      .eq('status', 'approved')
      .or(ilikeAny(['name', 'city', 'area'], term))
      .order('rating', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as unknown as BoutiqueRow[]).map<SearchHit>((b) => ({
      id: b.id,
      group: 'boutiques',
      kind: 'boutique',
      title: b.name,
      sub: [b.area, b.city].filter(Boolean).join(', ') || 'Boutique',
      right: b.rating ? `★ ${Number(b.rating).toFixed(1)}` : undefined,
      logo: b.logo_url,
      tone: b.tone ?? 0,
      to: `/boutique/${b.slug ?? b.id}`,
    }));
  },
};

/**
 * Category / occasion / fabric / colour shortcuts.
 *
 * Typing "bridal" should offer the edit as well as the individual pieces that
 * happen to mention it, and the landing pages those resolve to are the SEO
 * surface we most want reachable. Read from the managed `taxonomy` vocabulary
 * (migration 0024) rather than distinct-ing over product columns, so the term a
 * buyer picks is one an admin has actually approved.
 */
const KIND_ROUTE: Record<string, string> = {
  category: 'collections',
  occasion: 'occasions',
  fabric: 'fabrics',
  color: 'colours',
};

type TaxonomyRow = { id: string; kind: string; name: string };

const collections: SearchSource<BuyerCtx> = {
  key: 'collections',
  label: 'Collections',
  icon: 'category',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('taxonomy')
      .select('id, kind, name')
      .eq('status', 'approved')
      .in('kind', ['category', 'occasion', 'fabric', 'color'])
      .ilike('name', `%${term}%`)
      .order('sort_order')
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as TaxonomyRow[])
      .filter((t) => KIND_ROUTE[t.kind])
      .map<SearchHit>((t) => ({
        id: t.id,
        group: 'collections',
        kind: 'page',
        title: t.name,
        sub: 'Browse the edit',
        icon: 'category',
        to: `/${KIND_ROUTE[t.kind]}/${slugify(t.name)}`,
      }));
  },
};

export const BUYER_SOURCES: SearchSource<BuyerCtx>[] = [collections, products, boutiques];
