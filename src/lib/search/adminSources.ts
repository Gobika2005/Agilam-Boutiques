import { supabase } from '@/lib/supabase';
import { fmtInr } from '@/lib/tokens';
import { ADMIN_BASE, adminPath } from '@/lib/adminPath';
import { ilikeAny, likePattern } from './query';
import { matchPages } from './sellerSources';
import type { SearchHit, SearchSource } from './types';

/**
 * What the admin console searches.
 *
 * The header field here was an uncontrolled `<input>` wired to nothing — it has
 * never searched anything. These are the sources that back it now.
 *
 * Two things shape every query below:
 *
 *  - **Nothing is fetched wholesale.** Orders, profiles and products are the
 *    three biggest tables in the marketplace; matching them in the browser was
 *    never an option, so each source is a `LIMIT`ed server query.
 *  - **`is_admin()` is the boundary, not this file.** Every table read here is
 *    already governed by an RLS policy that admits admins. A non-admin who
 *    somehow reached this code would get empty groups, not a leak.
 *
 * Rows link to their console page carrying `?q=`, which each page seeds its own
 * filter from (`useSeededSearch`) — so picking a result lands on the row in the
 * surface that can actually act on it, rather than on a dead-end detail view.
 */

export type AdminCtx = Record<string, never>;

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });

/* ── Core ──────────────────────────────────────────────────────────────── */

type OrderRow = {
  id: string;
  order_number: string;
  guest_name: string | null;
  guest_phone: string | null;
  guest_city: string | null;
  status: string;
  total: number;
  refunded: boolean;
  created_at: string;
  boutique: { name: string | null } | null;
};

const ORDER_COLUMNS =
  'id, order_number, guest_name, guest_phone, guest_city, status, total, refunded, created_at, boutique:boutiques(name)';

/**
 * `payment_id` is in the match list on purpose: when Razorpay flags a payment,
 * the only identifier support has is `pay_XXXX`, and without this there was no
 * way to get from that back to an order.
 */
const ORDER_MATCH = ['order_number', 'guest_name', 'guest_phone', 'guest_city', 'payment_id'];

const orders: SearchSource<AdminCtx> = {
  key: 'orders',
  label: 'Orders',
  icon: 'receipt_long',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_COLUMNS)
      .or(ilikeAny(ORDER_MATCH, term))
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as unknown as OrderRow[]).map<SearchHit>((o) => ({
      id: o.id,
      group: 'orders',
      kind: 'row',
      title: `#${o.order_number}`,
      sub: [o.guest_name, o.boutique?.name, shortDate(o.created_at)].filter(Boolean).join(' · '),
      right: fmtInr(Number(o.total) || 0),
      icon: 'receipt_long',
      to: `${ADMIN_BASE}/orders?q=${encodeURIComponent(o.order_number)}`,
    }));
  },
};

type ProductRow = {
  id: string;
  title: string;
  category: string | null;
  price: number;
  stock: number | null;
  status: string | null;
  image_url: string | null;
  tone: number | null;
  boutique: { name: string | null } | null;
};

const products: SearchSource<AdminCtx> = {
  key: 'products',
  label: 'Products',
  icon: 'shopping_bag',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('products')
      .select('id, title, category, price, stock, status, image_url, tone, boutique:boutiques(name)')
      .is('deleted_at', null)
      .or(ilikeAny(['title', 'category', 'fabric', 'color', 'occasion'], term))
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as unknown as ProductRow[]).map<SearchHit>((p) => ({
      id: p.id,
      group: 'products',
      kind: 'product',
      title: p.title,
      sub: [p.boutique?.name, p.category, p.status && p.status !== 'active' ? p.status : null]
        .filter(Boolean)
        .join(' · '),
      right: fmtInr(Number(p.price) || 0),
      image: p.image_url,
      tone: p.tone ?? 0,
      to: `${ADMIN_BASE}/products?q=${encodeURIComponent(p.title)}`,
    }));
  },
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  role: string;
  status: string | null;
};

const users: SearchSource<AdminCtx> = {
  key: 'users',
  label: 'Users',
  icon: 'group',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, email, phone, city, role, status')
      .is('deleted_at', null)
      .or(ilikeAny(['full_name', 'email', 'phone', 'city'], term))
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as ProfileRow[]).map<SearchHit>((u) => ({
      id: u.id,
      group: 'users',
      kind: 'person',
      title: u.full_name?.trim() || u.email || 'Unnamed account',
      sub: [u.email, u.phone, u.city].filter(Boolean).join(' · ') || 'No contact on file',
      right: u.status && u.status !== 'active' ? u.status : u.role,
      to: `${ADMIN_BASE}/users?q=${encodeURIComponent(u.full_name?.trim() || u.email || '')}`,
    }));
  },
};

type BoutiqueRow = {
  id: string;
  name: string;
  city: string | null;
  area: string | null;
  owner_name: string | null;
  status: string;
  logo_url: string | null;
  tone: number | null;
};

const boutiques: SearchSource<AdminCtx> = {
  key: 'boutiques',
  label: 'Boutiques',
  icon: 'storefront',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('boutiques')
      // Column list, never `*` — 0021 revoked the blanket grant and 0073 took
      // email/phone/whatsapp out of it entirely.
      .select('id, name, city, area, owner_name, status, logo_url, tone')
      .or(ilikeAny(['name', 'city', 'area', 'owner_name'], term))
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as BoutiqueRow[]).map<SearchHit>((b) => ({
      id: b.id,
      group: 'boutiques',
      kind: 'boutique',
      title: b.name,
      sub: [b.owner_name, b.area, b.city].filter(Boolean).join(' · ') || 'Boutique',
      right: b.status,
      logo: b.logo_url,
      tone: b.tone ?? 0,
      to: `${ADMIN_BASE}/boutiques?q=${encodeURIComponent(b.name)}`,
    }));
  },
};

/* ── Money ─────────────────────────────────────────────────────────────── */

type CouponRow = {
  id: string;
  code: string;
  boutique_id: string | null;
  type: string;
  off: number;
  description: string | null;
  active: boolean;
  expires_at: string;
};

const coupons: SearchSource<AdminCtx> = {
  key: 'coupons',
  label: 'Coupons',
  icon: 'local_offer',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('coupons')
      // 0058 revoked created_by / usage_limit / used_count from `authenticated`
      // as well as `anon` — a column privilege is checked before RLS, so being
      // an admin does not help. Naming one here is a hard 42501.
      .select('id, code, boutique_id, type, off, description, active, expires_at')
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
      sub: [c.boutique_id ? 'Seller coupon' : 'Platform coupon', c.description || null, c.active ? null : 'inactive']
        .filter(Boolean)
        .join(' · '),
      right: c.type === 'pct' ? `${Number(c.off)}%` : c.type === 'ship' ? 'Free delivery' : fmtInr(Number(c.off) || 0),
      icon: 'local_offer',
      to: `${ADMIN_BASE}/coupons?q=${encodeURIComponent(c.code)}`,
    }));
  },
};

/**
 * Refunds are not a table — the Refunds console is the orders list filtered to
 * money that went back out, so this is the orders query narrowed the same way.
 */
const refunds: SearchSource<AdminCtx> = {
  key: 'refunds',
  label: 'Refunds',
  icon: 'currency_exchange',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_COLUMNS)
      .eq('refunded', true)
      .or(ilikeAny(ORDER_MATCH, term))
      .order('refunded_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as unknown as OrderRow[]).map<SearchHit>((o) => ({
      id: `refund:${o.id}`,
      group: 'refunds',
      kind: 'row',
      title: `#${o.order_number} refunded`,
      sub: [o.guest_name, o.boutique?.name].filter(Boolean).join(' · ') || 'Refunded order',
      right: fmtInr(Number(o.total) || 0),
      icon: 'currency_exchange',
      to: `${ADMIN_BASE}/refunds?q=${encodeURIComponent(o.order_number)}`,
    }));
  },
};

type PayoutRow = {
  id: string;
  amount: number;
  orders_count: number;
  created_at: string;
  created_by_name: string | null;
  boutique: { name: string | null } | null;
};

/**
 * Payouts are looked up by who was paid, so the boutique embed is `!inner` —
 * PostgREST only pushes a filter down into an embedded resource when the join
 * is inner, and with a left join every payout would come back regardless.
 */
const payouts: SearchSource<AdminCtx> = {
  key: 'payouts',
  label: 'Payouts',
  icon: 'account_balance',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('payouts')
      .select('id, amount, orders_count, created_at, created_by_name, boutique:boutiques!inner(name)')
      .ilike('boutique.name', likePattern(term))
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as unknown as PayoutRow[]).map<SearchHit>((p) => ({
      id: p.id,
      group: 'payouts',
      kind: 'row',
      title: p.boutique?.name || 'Payout',
      sub: `${p.orders_count} order${p.orders_count === 1 ? '' : 's'} · ${shortDate(p.created_at)}${p.created_by_name ? ` · by ${p.created_by_name}` : ''}`,
      right: fmtInr(Number(p.amount) || 0),
      icon: 'account_balance',
      to: `${ADMIN_BASE}/payments?q=${encodeURIComponent(p.boutique?.name ?? '')}`,
    }));
  },
};

type ExpenseRow = {
  id: string;
  title: string;
  vendor: string | null;
  category: string | null;
  amount: number;
  spent_on: string;
  reference: string | null;
};

const expenses: SearchSource<AdminCtx> = {
  key: 'expenses',
  label: 'Expenses',
  icon: 'savings',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('expenses')
      .select('id, title, vendor, category, amount, spent_on, reference')
      .or(ilikeAny(['title', 'vendor', 'reference', 'category', 'notes'], term))
      .order('spent_on', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as ExpenseRow[]).map<SearchHit>((e) => ({
      id: e.id,
      group: 'expenses',
      kind: 'row',
      title: e.title,
      sub: [e.vendor, e.category, shortDate(e.spent_on)].filter(Boolean).join(' · '),
      right: fmtInr(Number(e.amount) || 0),
      icon: 'savings',
      to: `${ADMIN_BASE}/expenses?q=${encodeURIComponent(e.title)}`,
    }));
  },
};

/* ── Content ───────────────────────────────────────────────────────────── */

type ReviewRow = {
  id: string;
  rating: number;
  body: string | null;
  author_name: string | null;
  products: { title: string | null } | null;
  boutiques: { name: string | null } | null;
};

const reviews: SearchSource<AdminCtx> = {
  key: 'reviews',
  label: 'Reviews',
  icon: 'reviews',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('reviews')
      .select('id, rating, body, author_name, products(title), boutiques(name)')
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
      sub: [r.author_name, r.products?.title, r.boutiques?.name].filter(Boolean).join(' · ') || 'Review',
      right: '★'.repeat(Math.max(1, Math.min(5, r.rating))),
      icon: 'reviews',
      to: `${ADMIN_BASE}/reviews?q=${encodeURIComponent(r.author_name || r.body?.slice(0, 24) || '')}`,
    }));
  },
};

type CampaignRow = {
  id: string;
  headline: string | null;
  placement_code: string;
  status: string;
  amount: number;
  boutique: { name: string | null } | null;
};

const ads: SearchSource<AdminCtx> = {
  key: 'ads',
  label: 'Advertisements',
  icon: 'campaign',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('ad_campaigns')
      .select('id, headline, placement_code, status, amount, boutique:boutiques(name)')
      .or(ilikeAny(['headline', 'subtext', 'placement_code', 'status'], term))
      .order('created_at', { ascending: false })
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as unknown as CampaignRow[]).map<SearchHit>((c) => ({
      id: c.id,
      group: 'ads',
      kind: 'row',
      title: c.headline?.trim() || c.placement_code.replace(/_/g, ' '),
      sub: [c.boutique?.name, c.status.replace(/_/g, ' ')].filter(Boolean).join(' · '),
      right: fmtInr(Number(c.amount) || 0),
      icon: 'campaign',
      to: `${ADMIN_BASE}/ads?q=${encodeURIComponent(c.headline?.trim() || c.boutique?.name || '')}`,
    }));
  },
};

type TaxonomyRow = { id: string; kind: string; name: string; status: string };

const catalogue: SearchSource<AdminCtx> = {
  key: 'catalogue',
  label: 'Catalogue terms',
  icon: 'sell',
  async run({ term, limit, signal }) {
    const { data, error } = await supabase
      .from('taxonomy')
      .select('id, kind, name, status')
      .ilike('name', likePattern(term))
      .order('sort_order')
      .limit(limit)
      .abortSignal(signal);
    if (error) throw error;
    return ((data ?? []) as TaxonomyRow[]).map<SearchHit>((t) => ({
      id: t.id,
      group: 'catalogue',
      kind: 'row',
      title: t.name,
      sub: `${t.kind} · ${t.status}`,
      right: t.status === 'pending' ? 'awaiting review' : undefined,
      icon: 'sell',
      to: `${ADMIN_BASE}/catalogue?q=${encodeURIComponent(t.name)}`,
    }));
  },
};

/* ── Navigation ────────────────────────────────────────────────────────── */

/**
 * Console destinations. Kept in step with `NAV` in AdminLayout by hand, with
 * `keywords` carrying the words an operator would actually type — "commission"
 * for Settings, "kyc" for Approvals — which the sidebar labels do not contain.
 */
const PAGES = [
  { title: 'Overview', sub: 'Marketplace health and trends', icon: 'dashboard', to: adminPath('overview'), keywords: 'dashboard home stats revenue gmv' },
  { title: 'Approvals', sub: 'Review and verify new boutiques', icon: 'verified', to: adminPath('approvals'), keywords: 'kyc verify pending seller onboarding' },
  { title: 'Catalogue Vocabulary', sub: 'Categories, occasions and fabrics', icon: 'sell', to: adminPath('catalogue'), keywords: 'taxonomy category occasion fabric colour terms' },
  { title: 'Boutiques', sub: 'All boutiques on the platform', icon: 'storefront', to: adminPath('boutiques'), keywords: 'shops sellers stores' },
  { title: 'Users', sub: 'Accounts and buyer history', icon: 'group', to: adminPath('users'), keywords: 'customers accounts people buyers admins roles' },
  { title: 'Products', sub: 'Moderation and inventory', icon: 'shopping_bag', to: adminPath('products'), keywords: 'listings catalogue stock hide moderation' },
  { title: 'Reviews', sub: 'Moderate product and boutique reviews', icon: 'reviews', to: adminPath('reviews'), keywords: 'ratings stars moderation' },
  { title: 'Orders', sub: 'Fulfilment and refunds', icon: 'receipt_long', to: adminPath('orders'), keywords: 'sales purchases transactions' },
  { title: 'Deliveries', sub: 'Disputes, stalled parcels and couriers', icon: 'local_shipping', to: adminPath('deliveries'), keywords: 'courier shipping awb tracking shiprocket parcel' },
  { title: 'Buyer Feedback', sub: 'What buyers say about MangaiMart', icon: 'rate_review', to: adminPath('feedback'), keywords: 'nps complaints suggestions' },
  { title: 'Refunds', sub: 'Record and track order refunds', icon: 'currency_exchange', to: adminPath('refunds'), keywords: 'money back returns reversal' },
  { title: 'Seller Payouts', sub: 'Settlements after commission', icon: 'account_balance', to: adminPath('payments'), keywords: 'payout settlement bank transfer razorpayx commission' },
  { title: 'Expenses', sub: 'What the platform spends', icon: 'savings', to: adminPath('expenses'), keywords: 'spend cost bills receipts vendor' },
  { title: 'Advertisements', sub: 'Campaigns and promotions', icon: 'campaign', to: adminPath('ads'), keywords: 'ads sponsored placement hero promo' },
  { title: 'Coupons', sub: 'Platform and seller discount codes', icon: 'local_offer', to: adminPath('coupons'), keywords: 'discount promo code offer voucher' },
  { title: 'Broadcast', sub: 'Send a notification to buyers or sellers', icon: 'send', to: adminPath('broadcast'), keywords: 'notification announce message push blast' },
  { title: 'Audit Trail', sub: 'Every sensitive admin action, logged', icon: 'history', to: adminPath('audit'), keywords: 'log history who did what activity' },
  { title: 'Platform Settings', sub: 'Commission, fees and return window', icon: 'settings', to: adminPath('settings'), keywords: 'commission rate returns window payout hold maintenance config' },
  { title: 'Notifications', sub: 'Alerts across the marketplace', icon: 'notifications', to: adminPath('notifications'), keywords: 'alerts bell' },
];

const pages: SearchSource<AdminCtx> = {
  key: 'pages',
  label: 'Go to',
  icon: 'arrow_forward',
  run: async ({ term, limit }) => matchPages(PAGES, term, limit, 'pages'),
};

export const ADMIN_SOURCES: SearchSource<AdminCtx>[] = [
  pages,
  orders,
  products,
  users,
  boutiques,
  coupons,
  refunds,
  payouts,
  expenses,
  reviews,
  ads,
  catalogue,
];
