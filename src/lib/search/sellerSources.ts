import { supabase } from '@/lib/supabase';
import { fmt } from '@/data/demo';
import { ilikeAny, likePattern } from './query';
import type { SearchHit, SearchSource } from './types';

/**
 * What the seller console searches.
 *
 * Everything is scoped to the signed-in boutique by an explicit
 * `.eq('boutique_id', …)`, and RLS enforces the same thing underneath — the
 * filter is for the query planner, the policy is the security boundary.
 *
 * The context carries the *owner's* id rather than the boutique's, and the
 * boutique is resolved lazily by `myBoutiqueId` below. Two reasons:
 *
 *  - The owner id is already in `AuthContext`, so the header costs no extra
 *    query on a console where every screen mounts this box.
 *  - Passing the boutique in would mean gating the sources on it having loaded,
 *    and a seller who types before that resolves would be told "nothing
 *    matched" — a wrong answer, not a slow one.
 */

export type SellerCtx = { ownerId: string | null };

const signedIn = (ctx: SellerCtx) => Boolean(ctx.ownerId);

/**
 * The signed-in seller's boutique id.
 *
 * The *promise* is cached, not just the result: the first keystroke starts
 * eight sources at once, and caching only the resolved value would let all
 * eight fire their own lookup before any of them finished. Deliberately not
 * given the abort signal — one keystroke being superseded must not poison the
 * shared lookup for the seven sources still running.
 */
let boutiqueLookup: { ownerId: string; promise: Promise<string | null> } | null = null;

function myBoutiqueId(ownerId: string): Promise<string | null> {
  if (boutiqueLookup?.ownerId === ownerId) return boutiqueLookup.promise;
  // An async IIFE rather than `.then()` on the builder: PostgREST's builder is
  // a thenable, not a real Promise, so chaining off it does not give us one.
  const promise = (async () => {
    const { data, error } = await supabase.from('boutiques').select('id').eq('owner_id', ownerId).maybeSingle();
    if (error) {
      // Drop a failed lookup so the next search retries rather than caching the
      // failure for the rest of the session.
      boutiqueLookup = null;
      throw error;
    }
    return (data?.id as string | undefined) ?? null;
  })();
  boutiqueLookup = { ownerId, promise };
  return promise;
}

/** Clears the cache on sign-out, so the next account does not inherit it. */
export function resetSellerSearchScope() {
  boutiqueLookup = null;
}

type ProductRow = {
  id: string;
  title: string;
  category: string | null;
  price: number;
  stock: number | null;
  image_url: string | null;
  tone: number | null;
  status: string | null;
};

const products: SearchSource<SellerCtx> = {
  key: 'products',
  label: 'Products',
  icon: 'inventory_2',
  enabled: signedIn,
  async run({ term, limit, signal, ctx }) {
    const boutiqueId = await myBoutiqueId(ctx.ownerId!);
    if (!boutiqueId) return [];
    const { data, error } = await supabase
      .from('products')
      .select('id, title, category, price, stock, image_url, tone, status')
      .eq('boutique_id', boutiqueId)
      .is('deleted_at', null)
      .or(ilikeAny(['title', 'category', 'fabric', 'color', 'occasion'], term))
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as ProductRow[]).map<SearchHit>((p) => ({
      id: p.id,
      group: 'products',
      kind: 'product',
      title: p.title,
      sub: [p.category, p.stock === 0 ? 'Out of stock' : `${p.stock ?? 0} in stock`].filter(Boolean).join(' · '),
      right: fmt(Number(p.price) || 0),
      image: p.image_url,
      tone: p.tone ?? 0,
      to: `/seller/products/${p.id}`,
    }));
  },
};

type OrderRow = {
  id: string;
  order_number: string;
  guest_name: string | null;
  guest_phone: string | null;
  guest_city: string | null;
  status: string;
  total: number;
  created_at: string;
};

const ORDER_COLUMNS = 'id, order_number, guest_name, guest_phone, guest_city, status, total, created_at';

/**
 * The order columns worth matching on.
 *
 * `guest_*` are the delivery contact captured at checkout, denormalised onto the
 * order itself — which is what lets a name or phone search stay a single-table
 * query instead of an inner join through `profiles` on every keystroke.
 */
const ORDER_MATCH = ['order_number', 'guest_name', 'guest_phone', 'guest_city'];

const orders: SearchSource<SellerCtx> = {
  key: 'orders',
  label: 'Orders',
  icon: 'receipt_long',
  enabled: signedIn,
  async run({ term, limit, signal, ctx }) {
    const boutiqueId = await myBoutiqueId(ctx.ownerId!);
    if (!boutiqueId) return [];
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_COLUMNS)
      .eq('boutique_id', boutiqueId)
      .or(ilikeAny(ORDER_MATCH, term))
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as OrderRow[]).map<SearchHit>((o) => ({
      id: o.id,
      group: 'orders',
      kind: 'row',
      title: `#${o.order_number}`,
      sub: [o.guest_name, new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })]
        .filter(Boolean)
        .join(' · '),
      right: fmt(Number(o.total) || 0),
      icon: 'receipt_long',
      to: `/seller/orders/${o.id}`,
    }));
  },
};

/**
 * Customers, derived from their orders.
 *
 * There is no customer table — a customer is "someone who has ordered from this
 * boutique", so this is the orders query again, deduped by name. It over-fetches
 * deliberately (`limit * 4`) because several rows can collapse into one person.
 */
const customers: SearchSource<SellerCtx> = {
  key: 'customers',
  label: 'Customers',
  icon: 'group',
  enabled: signedIn,
  async run({ term, limit, signal, ctx }) {
    const boutiqueId = await myBoutiqueId(ctx.ownerId!);
    if (!boutiqueId) return [];
    const { data, error } = await supabase
      .from('orders')
      .select('id, guest_name, guest_phone, guest_city, total, created_at')
      .eq('boutique_id', boutiqueId)
      .or(ilikeAny(['guest_name', 'guest_phone'], term))
      .order('created_at', { ascending: false })
      .limit(limit * 4)
      .abortSignal(signal);
    if (error) throw error;

    const seen = new Set<string>();
    const hits: SearchHit[] = [];
    for (const o of (data ?? []) as OrderRow[]) {
      const name = (o.guest_name ?? '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        id: key,
        group: 'customers',
        kind: 'person',
        title: name,
        sub: [o.guest_phone, o.guest_city].filter(Boolean).join(' · ') || 'Customer',
        to: `/seller/customers?q=${encodeURIComponent(name)}`,
      });
      if (hits.length >= limit) break;
    }
    return hits;
  },
};

type ConversationRow = {
  id: string;
  created_at: string;
  buyer: { full_name: string | null } | null;
};

/**
 * Chats, matched on who they are with.
 *
 * Message *bodies* are deliberately not searched. They are the buyer's words in
 * a private thread, and a substring search across them is a different privacy
 * proposition to finding a conversation by the name already shown in the inbox.
 *
 * The embed is `!inner` so the buyer's name can be filtered on as
 * `buyer.full_name` — PostgREST only pushes a filter into an embedded resource
 * when the join is inner. Sellers may read these profiles because of migration
 * 0007 ("profiles: seller reads chat buyers"), not because of this query.
 */
const messages: SearchSource<SellerCtx> = {
  key: 'messages',
  label: 'Messages',
  icon: 'chat',
  enabled: signedIn,
  async run({ term, limit, signal, ctx }) {
    const boutiqueId = await myBoutiqueId(ctx.ownerId!);
    if (!boutiqueId) return [];
    const { data, error } = await supabase
      .from('conversations')
      .select('id, created_at, buyer:profiles!conversations_buyer_id_fkey!inner(full_name)')
      .eq('boutique_id', boutiqueId)
      .ilike('buyer.full_name', likePattern(term))
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as unknown as ConversationRow[]).map<SearchHit>((c) => ({
      id: c.id,
      group: 'messages',
      kind: 'person',
      title: c.buyer?.full_name || 'Customer',
      sub: 'Open the chat',
      icon: 'chat',
      to: `/seller/chat/${c.id}`,
    }));
  },
};

type CouponRow = {
  id: string;
  code: string;
  type: string;
  off: number;
  description: string | null;
  expires_at: string;
  active: boolean;
};

const coupons: SearchSource<SellerCtx> = {
  key: 'coupons',
  label: 'Coupons',
  icon: 'local_offer',
  enabled: signedIn,
  async run({ term, limit, signal, ctx }) {
    const boutiqueId = await myBoutiqueId(ctx.ownerId!);
    if (!boutiqueId) return [];
    const { data, error } = await supabase
      .from('coupons')
      // Only the columns migration 0058 granted back — `created_by`,
      // `usage_limit` and `used_count` are a hard 42501 for everyone.
      .select('id, code, type, off, description, expires_at, active')
      .eq('boutique_id', boutiqueId)
      .or(ilikeAny(['code', 'description'], term))
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as CouponRow[]).map<SearchHit>((c) => ({
      id: c.id,
      group: 'coupons',
      kind: 'row',
      title: c.code,
      sub: c.description || (c.active ? 'Active' : 'Inactive'),
      right: c.type === 'pct' ? `${Number(c.off)}% off` : fmt(Number(c.off) || 0),
      icon: 'local_offer',
      to: `/seller/coupons?q=${encodeURIComponent(c.code)}`,
    }));
  },
};

type ReviewRow = {
  id: string;
  rating: number;
  body: string | null;
  author_name: string | null;
  products: { title: string | null } | null;
};

const reviews: SearchSource<SellerCtx> = {
  key: 'reviews',
  label: 'Reviews',
  icon: 'reviews',
  enabled: signedIn,
  async run({ term, limit, signal, ctx }) {
    const boutiqueId = await myBoutiqueId(ctx.ownerId!);
    if (!boutiqueId) return [];
    const { data, error } = await supabase
      .from('reviews')
      .select('id, rating, body, author_name, products(title)')
      .eq('boutique_id', boutiqueId)
      .or(ilikeAny(['body', 'author_name'], term))
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as unknown as ReviewRow[]).map<SearchHit>((r) => ({
      id: r.id,
      group: 'reviews',
      kind: 'row',
      title: r.body?.trim() || `${r.rating}-star review`,
      sub: [r.author_name, r.products?.title].filter(Boolean).join(' · ') || 'Review',
      right: '★'.repeat(Math.max(1, Math.min(5, r.rating))),
      icon: 'reviews',
      to: `/seller/reviews?q=${encodeURIComponent(r.author_name || r.body?.slice(0, 24) || '')}`,
    }));
  },
};

type CampaignRow = {
  id: string;
  headline: string | null;
  placement_code: string;
  status: string;
  amount: number;
  product: { title: string | null } | null;
};

const ads: SearchSource<SellerCtx> = {
  key: 'ads',
  label: 'Advertisements',
  icon: 'campaign',
  enabled: signedIn,
  async run({ term, limit, signal, ctx }) {
    const boutiqueId = await myBoutiqueId(ctx.ownerId!);
    if (!boutiqueId) return [];
    const { data, error } = await supabase
      .from('ad_campaigns')
      .select('id, headline, placement_code, status, amount, product:products(title)')
      .eq('boutique_id', boutiqueId)
      .or(ilikeAny(['headline', 'subtext', 'placement_code', 'status'], term))
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as unknown as CampaignRow[]).map<SearchHit>((c) => ({
      id: c.id,
      group: 'ads',
      kind: 'row',
      title: c.headline?.trim() || c.product?.title || c.placement_code,
      sub: `${c.placement_code.replace(/_/g, ' ')} · ${c.status.replace(/_/g, ' ')}`,
      right: fmt(Number(c.amount) || 0),
      icon: 'campaign',
      to: '/seller/promote',
    }));
  },
};

/** Console destinations, so typing "earn" offers the Earnings screen itself. */
const PAGES: { title: string; sub: string; icon: string; to: string; keywords: string }[] = [
  { title: 'Dashboard', sub: 'Today at a glance', icon: 'home', to: '/seller/dashboard', keywords: 'home overview' },
  { title: 'Products', sub: 'Your catalogue', icon: 'inventory_2', to: '/seller/products', keywords: 'catalogue inventory stock listings' },
  { title: 'Add a product', sub: 'List something new', icon: 'add_box', to: '/seller/add-product', keywords: 'new listing upload create' },
  { title: 'Orders', sub: 'Fulfil and track', icon: 'receipt_long', to: '/seller/orders', keywords: 'sales fulfilment shipping' },
  { title: 'Customers', sub: 'Who buys from you', icon: 'group', to: '/seller/customers', keywords: 'buyers people' },
  { title: 'Messages', sub: 'Chats with buyers', icon: 'chat', to: '/seller/messages', keywords: 'chat inbox conversations' },
  { title: 'Reviews', sub: 'What buyers said', icon: 'reviews', to: '/seller/reviews', keywords: 'ratings stars feedback' },
  { title: 'Earnings', sub: 'Payouts and settlements', icon: 'payments', to: '/seller/earnings', keywords: 'payout money settlement bank commission' },
  { title: 'Analytics', sub: 'How the shop is doing', icon: 'insights', to: '/seller/analytics', keywords: 'stats numbers reports traffic' },
  { title: 'Billing', sub: 'Walk-in and offline sales', icon: 'point_of_sale', to: '/seller/billing', keywords: 'pos invoice bill offline walk-in' },
  { title: 'Promote', sub: 'Buy an ad placement', icon: 'campaign', to: '/seller/promote', keywords: 'ads advertising sponsored boost' },
  { title: 'Coupons', sub: 'Your discount codes', icon: 'local_offer', to: '/seller/coupons', keywords: 'discount offer promo code sale' },
  { title: 'Boutique profile', sub: 'How buyers see your shop', icon: 'storefront', to: '/seller/boutique', keywords: 'shop store profile about logo cover' },
  { title: 'Settings', sub: 'Delivery, dispatch and preferences', icon: 'settings', to: '/seller/settings', keywords: 'delivery charges dispatch preferences account' },
  { title: 'Verification', sub: 'Your approval status', icon: 'verified', to: '/seller/verification', keywords: 'approval kyc documents status' },
  { title: 'Help', sub: 'Guides and support', icon: 'help', to: '/seller/help', keywords: 'support faq guide contact' },
];

/**
 * Page matching is the one source that stays in the browser — the list is a
 * constant in this file, so a round trip would buy nothing.
 */
export function matchPages(
  pages: typeof PAGES,
  term: string,
  limit: number,
  group: string,
): SearchHit[] {
  const q = term.toLowerCase();
  return pages
    .filter((p) => p.title.toLowerCase().includes(q) || p.sub.toLowerCase().includes(q) || p.keywords.includes(q))
    .slice(0, limit)
    .map<SearchHit>((p) => ({
      id: p.to,
      group,
      kind: 'page',
      title: p.title,
      sub: p.sub,
      icon: p.icon,
      to: p.to,
    }));
}

const pages: SearchSource<SellerCtx> = {
  key: 'pages',
  label: 'Go to',
  icon: 'arrow_forward',
  run: async ({ term, limit }) => matchPages(PAGES, term, limit, 'pages'),
};

export const SELLER_SOURCES: SearchSource<SellerCtx>[] = [
  pages,
  products,
  orders,
  customers,
  messages,
  coupons,
  reviews,
  ads,
];
