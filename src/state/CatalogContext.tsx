import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAsync } from '@/hooks/useAsync';
import { fetchProducts } from '@/data/products';
import { fetchApprovedBoutiques } from '@/data/boutiques';
import type { ProductWithBoutique, BoutiqueRow } from '@/data/types';
import type { Product, Boutique } from '@/data/demo';

/**
 * Live catalogue, adapted to the shapes the screens were built against.
 *
 * The buyer screens were composed around the demo `Product`/`Boutique` records
 * (`p.cat`, `p.image`, `b.insta`, matching products to a boutique by name…).
 * This context fetches the real rows from Supabase and maps them onto those
 * exact shapes, so the screens read from the database without a rewrite.
 * Approved boutiques and their products are public (RLS), so this loads for
 * anonymous buyers too.
 */

function instaHandle(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/(^\.|\.$)/g, '');
}

/** URL-safe handle used for shareable profile links: "Pinky's Boutique" -> "pinkys-boutique". */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function toProduct(p: ProductWithBoutique): Product {
  return {
    id: p.id,
    title: p.title,
    price: Number(p.price),
    cat: p.category,
    boutique: p.boutique?.name ?? '',
    boutiqueId: p.boutique_id,
    city: p.boutique?.city ?? '',
    color: p.color ?? '',
    occasion: p.occasion ?? '',
    rating: Number(p.rating),
    reviews: p.reviews_count,
    tone: p.tone,
    featured: p.featured,
    stock: p.stock,
    fabric: p.fabric ?? '',
    image: p.image_url ?? '',
    description: p.description ?? '',
    mrp: p.mrp ?? null,
    sizes: p.sizes ?? [],
    washCare: p.wash_care ?? '',
    images: p.images ?? [],
    badges: p.badges ?? [],
    feedingFriendly: p.feeding_friendly ?? false,
    feedingNote: p.feeding_note ?? '',
    shippingInfo: p.shipping_info ?? '',
    colorDisclaimer: p.color_disclaimer ?? '',
    // `specs` is jsonb, so a hand-edited row could hold anything — keep only
    // well-formed { label, value } pairs rather than rendering `undefined`.
    specs: Array.isArray(p.specs)
      ? p.specs
          .filter((s): s is { label: string; value: string } => !!s && typeof s === 'object')
          .map((s) => ({ label: String(s.label ?? ''), value: String(s.value ?? '') }))
          .filter((s) => s.label && s.value)
      : [],
    createdAt: p.created_at,
    soldCount: p.sold_count ?? 0,
  };
}

function toBoutique(b: BoutiqueRow, productCount: number): Boutique {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug || slugify(b.name),
    city: b.city,
    area: b.area || b.city,
    insta: b.instagram || instaHandle(b.name),
    mapUrl: b.map_url ?? '',
    phone: b.phone ?? '',
    // Same fallback chain the seller console uses (src/pages/seller/Dashboard.tsx):
    // the established year if given, else derived from the years-in-business the
    // seller entered during onboarding, and only then the join date. Skipping the
    // middle step showed a boutique trading since 2023 as "Since 2026" to buyers
    // while its own dashboard said 2023 — the join date dressed up as a founding
    // date, which understates exactly the history a buyer is judging trust on.
    since:
      b.established_year ??
      (b.years_in_business ? new Date().getFullYear() - b.years_in_business : undefined) ??
      (b.created_at ? new Date(b.created_at).getFullYear() : undefined),
    followers: b.followers_count ?? 0,
    positiveRating: b.positive_rating ?? 0,
    rating: Number(b.rating),
    reviews: b.reviews_count,
    tone: b.tone,
    verified: b.verified,
    featured: b.featured,
    products: productCount,
    desc: b.description,
    image: b.cover_url ?? '',
    logo: b.logo_url ?? '',
    codEnabled: b.cod_enabled ?? true,
    createdAt: b.created_at,
    unitsSold: b.units_sold ?? 0,
    ordersCount: b.orders_count ?? 0,
    deliveryAvailable: b.delivery_available ?? true,
    deliveryAreas: b.delivery_areas ?? '',
    deliveryCharge: b.delivery_charge ?? 0,
  };
}

type CatalogValue = {
  products: Product[];
  boutiques: Boutique[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  productById: (id: string | undefined) => Product | undefined;
  boutiqueById: (id: string | undefined) => Boutique | undefined;
  boutiqueBySlug: (slug: string | undefined) => Boutique | undefined;
};

const CatalogContext = createContext<CatalogValue | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  // The catalogue is the one query every buyer holds open, so it revalidates on
  // a longer leash than a seller's own order list: new stock and price changes
  // are worth catching, but not at the cost of a request per buyer per minute.
  const { data: rawProducts, loading: lp, error: ep, reload: reloadP } = useAsync(
    () => fetchProducts(),
    [],
    { staleMs: 120_000 },
  );
  const { data: rawBoutiques, loading: lb, error: eb, reload: reloadB } = useAsync(
    () => fetchApprovedBoutiques(),
    [],
    { staleMs: 180_000 },
  );

  const products = useMemo(() => (rawProducts ?? []).map(toProduct), [rawProducts]);

  const boutiques = useMemo(() => {
    const counts = new Map<string, number>();
    (rawProducts ?? []).forEach((p) => counts.set(p.boutique_id, (counts.get(p.boutique_id) ?? 0) + 1));
    return (rawBoutiques ?? []).map((b) => toBoutique(b, counts.get(b.id) ?? 0));
  }, [rawBoutiques, rawProducts]);

  const value = useMemo<CatalogValue>(() => ({
    products,
    boutiques,
    loading: lp || lb,
    error: ep ?? eb,
    reload: () => { reloadP(); reloadB(); },
    productById: (id) => products.find((p) => p.id === id),
    boutiqueById: (id) => boutiques.find((b) => b.id === id),
    boutiqueBySlug: (slug) => boutiques.find((b) => b.slug === slug),
  }), [products, boutiques, lp, lb, ep, eb, reloadP, reloadB]);

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used within a CatalogProvider');
  return ctx;
}
