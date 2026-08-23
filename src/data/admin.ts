import { supabase } from '@/lib/supabase';
import { fmtInr } from '@/lib/tokens';
import { currentSettings } from '@/data/settings';
import type { OrderStatus, PaymentStatus } from '@/types/database';

/** The live commission, read per call so a rate change in Platform Settings
 *  reaches the payout and revenue figures instead of the compile-time default. */
const commissionRate = () => currentSettings().commission_pct / 100;

export interface OverviewMetrics {
  gmv: number;
  activeBoutiques: number;
  ordersThisMonth: number;
  platformRevenue: number;
}

export async function fetchOverviewMetrics(): Promise<OverviewMetrics> {
  const [{ count: activeBoutiques }, { data: orders }] = await Promise.all([
    supabase.from('boutiques').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('orders').select('total, created_at'),
  ]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const rows = orders ?? [];
  const gmv = rows.reduce((sum, o) => sum + Number(o.total), 0);
  const ordersThisMonth = rows.filter((o) => new Date(o.created_at) >= monthStart).length;

  return { gmv, activeBoutiques: activeBoutiques ?? 0, ordersThisMonth, platformRevenue: gmv * commissionRate() };
}

export async function fetchGmvBars(): Promise<string[]> {
  const { data: orders } = await supabase.from('orders').select('total, created_at');
  const rows = orders ?? [];
  const weeks: number[] = new Array(12).fill(0);
  const now = new Date();
  rows.forEach((o) => {
    const weeksAgo = Math.floor((now.getTime() - new Date(o.created_at).getTime()) / (7 * 24 * 3600 * 1000));
    if (weeksAgo >= 0 && weeksAgo < 12) weeks[11 - weeksAgo] += Number(o.total);
  });
  const max = Math.max(...weeks, 1);
  return weeks.map((w) => `${Math.max(6, Math.round((w / max) * 100))}%`);
}

export interface CategoryStat {
  name: string;
  pct: number;
}

/**
 * Share of units sold per category.
 *
 * This used to count rows in `products`, i.e. how many items were *listed* per
 * category, under a chart captioned "Orders by category" — a catalogue mix
 * presented as a sales mix. It now counts sold quantity from `order_items`.
 *
 * Everything outside the top five is folded into "Other" so the bars total
 * 100%; the old version sliced the top six and left the remainder unaccounted,
 * which is why the percentages added up to 81%.
 */
export async function fetchCategoryStats(): Promise<CategoryStat[]> {
  const [{ data: items }, { data: products }] = await Promise.all([
    supabase.from('order_items').select('product_id, qty'),
    supabase.from('products').select('id, category'),
  ]);

  const categoryOf = new Map((products ?? []).map((p) => [p.id, p.category]));
  const units = new Map<string, number>();
  let total = 0;
  (items ?? []).forEach((it) => {
    // product_id is nullable — an item whose product row was hard-deleted has
    // nothing to attribute, so it sits outside the category split entirely.
    const cat = it.product_id ? categoryOf.get(it.product_id) : undefined;
    if (!cat) return; // product deleted — no category to attribute it to
    const q = Number(it.qty) || 0;
    units.set(cat, (units.get(cat) ?? 0) + q);
    total += q;
  });
  if (total === 0) return [];

  const sorted = [...units.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 5);
  const restUnits = sorted.slice(5).reduce((s, [, v]) => s + v, 0);

  // Largest-remainder rounding so the displayed percentages sum to exactly 100.
  const parts = [...top, ...(restUnits > 0 ? [['Other', restUnits] as [string, number]] : [])];
  const exact = parts.map(([name, v]) => ({ name, raw: (v / total) * 100 }));
  const out = exact.map((e) => ({ name: e.name, pct: Math.floor(e.raw) }));
  let slack = 100 - out.reduce((s, o) => s + o.pct, 0);
  exact
    .map((e, i) => ({ i, frac: e.raw - Math.floor(e.raw) }))
    .sort((a, b) => b.frac - a.frac)
    .forEach(({ i }) => { if (slack > 0) { out[i].pct += 1; slack -= 1; } });

  return out;
}

export interface CityStat {
  d: string;
  h: string;
}

export async function fetchRevenueByCity(): Promise<CityStat[]> {
  const { data } = await supabase.from('orders').select('total, boutique:boutiques(city)');
  const rows = (data ?? []) as unknown as { total: number; boutique: { city: string } | null }[];
  const byCity = new Map<string, number>();
  rows.forEach((r) => {
    const city = r.boutique?.city ?? 'Other';
    byCity.set(city, (byCity.get(city) ?? 0) + Number(r.total));
  });
  const entries = [...byCity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const max = Math.max(...entries.map((e) => e[1]), 1);
  return entries.map(([d, v]) => ({ d, h: `${Math.max(6, Math.round((v / max) * 100))}%` }));
}

export interface PaymentRow {
  id: string;
  txn: string;
  name: string;
  amount: string;
  commission: string;
  /** Derived settlement label (Settled once the order is shipped/delivered). */
  status: string;
  /** Underlying order status the admin can manage. */
  orderStatus: OrderStatus;
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export interface WindowStat { revenue: number; orders: number }
export interface TopBoutique { id: string; name: string; tone: number; revenue: number; orders: number }
export interface TopProduct { title: string; qty: number; revenue: number }
export interface LowStockRow { id: string; title: string; stock: number; boutique: string }
export interface RecentOrder { id: string; order_number: string; name: string; boutique: string; total: number; status: OrderStatus; created_at: string }

export interface DashboardData {
  today: WindowStat;
  yesterday: WindowStat;
  week: WindowStat;
  month: WindowStat;
  year: WindowStat;
  /** Previous comparable window, for period-over-period deltas. */
  prevWeek: WindowStat;
  prevMonth: WindowStat;
  prevYear: WindowStat;
  gmv: number;
  platformRevenue: number;
  /** Earned (non-refunded, non-rejected) order count across all time — AOV denominator. */
  earnedOrders: number;
  /** Fulfilled = shipped or delivered; drives the fulfillment-rate health tile. */
  fulfilledOrders: number;
  refunds: { count: number; amount: number };
  counts: {
    buyers: number;
    sellers: number;
    activeBoutiques: number;
    pendingApprovals: number;
    products: number;
    lowStock: number;
    pendingOrders: number;
  };
  revenueSeries: { label: string; value: number }[];
  orderSeries: { label: string; value: number }[];
  paymentSplit: { online: number; cod: number };
  topBoutiques: TopBoutique[];
  topProducts: TopProduct[];
  lowStockList: LowStockRow[];
  recentOrders: RecentOrder[];
}

type DashOrder = {
  id: string; order_number: string; total: number; status: OrderStatus; created_at: string;
  payment_id: string | null; boutique_id: string; refunded: boolean;
  guest_name: string | null;
  boutique: { name: string; tone: number } | null;
  buyer: { full_name: string } | null;
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
/**
 * Did this order actually earn the marketplace anything?
 *
 * `cancelled` used to be missing here, so a cancelled order still counted
 * toward GMV, Revenue, Avg. order and the 10% Platform earning tile — the
 * platform booked commission on an order nobody paid for, and the admin's
 * numbers drifted above the seller console's for the same orders.
 * (A seller-side cancellation and an admin-side rejection are both "no sale".)
 */
const isEarned = (o: DashOrder) => o.status !== 'rejected' && o.status !== 'cancelled' && !o.refunded;

export async function fetchDashboard(): Promise<DashboardData> {
  const [ordersRes, itemsRes, buyers, sellers, activeBoutiques, pendingApprovals, products, lowStockRes] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, total, status, created_at, payment_id, boutique_id, refunded, guest_name, boutique:boutiques(name, tone), buyer:profiles!orders_buyer_id_fkey(full_name)')
      .order('created_at', { ascending: false }),
    supabase.from('order_items').select('title, price, qty'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'buyer').is('deleted_at', null),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'seller').is('deleted_at', null),
    supabase.from('boutiques').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('boutiques').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('status', 'active').is('deleted_at', null),
    supabase.from('products').select('id, title, stock, boutique:boutiques(name)').lte('stock', 5).is('deleted_at', null).order('stock', { ascending: true }).limit(12),
  ]);

  const orders = (ordersRes.data ?? []) as unknown as DashOrder[];
  const now = new Date();
  const todayStart = startOfDay(now);
  const yStart = todayStart - 86400000;
  const weekStart = todayStart - 6 * 86400000;
  const prevWeekStart = weekStart - 7 * 86400000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();
  const prevYearStart = new Date(now.getFullYear() - 1, 0, 1).getTime();

  const blank = (): WindowStat => ({ revenue: 0, orders: 0 });
  const acc = {
    today: blank(), yesterday: blank(), week: blank(), month: blank(), year: blank(),
    prevWeek: blank(), prevMonth: blank(), prevYear: blank(),
  };
  let gmv = 0;
  let online = 0;
  let cod = 0;
  let earnedOrders = 0;
  let fulfilledOrders = 0;
  let refundCount = 0;
  let refundAmount = 0;
  const byBoutique = new Map<string, TopBoutique>();

  // 14-day series buckets
  const days = 14;
  const revSeries = new Array(days).fill(0);
  const ordSeries = new Array(days).fill(0);

  for (const o of orders) {
    const t = new Date(o.created_at).getTime();
    const earned = isEarned(o);
    const amt = Number(o.total);
    if (o.refunded) { refundCount += 1; refundAmount += amt; }
    if (earned) {
      gmv += amt;
      earnedOrders += 1;
      if (o.status === 'shipped' || o.status === 'delivered') fulfilledOrders += 1;
      if (o.payment_id) online += 1; else cod += 1;
      if (t >= todayStart) { acc.today.revenue += amt; acc.today.orders += 1; }
      if (t >= yStart && t < todayStart) { acc.yesterday.revenue += amt; acc.yesterday.orders += 1; }
      if (t >= weekStart) { acc.week.revenue += amt; acc.week.orders += 1; }
      if (t >= prevWeekStart && t < weekStart) { acc.prevWeek.revenue += amt; acc.prevWeek.orders += 1; }
      if (t >= monthStart) { acc.month.revenue += amt; acc.month.orders += 1; }
      if (t >= prevMonthStart && t < monthStart) { acc.prevMonth.revenue += amt; acc.prevMonth.orders += 1; }
      if (t >= yearStart) { acc.year.revenue += amt; acc.year.orders += 1; }
      if (t >= prevYearStart && t < yearStart) { acc.prevYear.revenue += amt; acc.prevYear.orders += 1; }

      const b = byBoutique.get(o.boutique_id) ?? { id: o.boutique_id, name: o.boutique?.name ?? 'Boutique', tone: o.boutique?.tone ?? 0, revenue: 0, orders: 0 };
      b.revenue += amt; b.orders += 1;
      byBoutique.set(o.boutique_id, b);

      const dayIdx = Math.floor((t - (todayStart - (days - 1) * 86400000)) / 86400000);
      if (dayIdx >= 0 && dayIdx < days) { revSeries[dayIdx] += amt; ordSeries[dayIdx] += 1; }
    }
  }

  const items = (itemsRes.data ?? []) as { title: string; price: number; qty: number }[];
  const prodMap = new Map<string, TopProduct>();
  for (const it of items) {
    const p = prodMap.get(it.title) ?? { title: it.title, qty: 0, revenue: 0 };
    p.qty += Number(it.qty);
    p.revenue += Number(it.price) * Number(it.qty);
    prodMap.set(it.title, p);
  }

  const seriesLabel = (i: number) => {
    const d = new Date(todayStart - (days - 1 - i) * 86400000);
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const lowStock = (lowStockRes.data ?? []) as unknown as { id: string; title: string; stock: number; boutique: { name: string } | null }[];

  return {
    ...acc,
    gmv,
    platformRevenue: gmv * commissionRate(),
    earnedOrders,
    fulfilledOrders,
    refunds: { count: refundCount, amount: refundAmount },
    counts: {
      buyers: buyers.count ?? 0,
      sellers: sellers.count ?? 0,
      activeBoutiques: activeBoutiques.count ?? 0,
      pendingApprovals: pendingApprovals.count ?? 0,
      products: products.count ?? 0,
      lowStock: lowStock.length,
      pendingOrders: orders.filter((o) => o.status === 'pending').length,
    },
    revenueSeries: revSeries.map((v, i) => ({ label: seriesLabel(i), value: v })),
    orderSeries: ordSeries.map((v, i) => ({ label: seriesLabel(i), value: v })),
    paymentSplit: { online, cod },
    topBoutiques: [...byBoutique.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    topProducts: [...prodMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    lowStockList: lowStock.map((p) => ({ id: p.id, title: p.title, stock: p.stock, boutique: p.boutique?.name ?? '—' })),
    recentOrders: orders.slice(0, 6).map((o) => ({
      id: o.id, order_number: o.order_number, name: o.buyer?.full_name ?? o.guest_name ?? 'Guest',
      boutique: o.boutique?.name ?? '—', total: Number(o.total), status: o.status, created_at: o.created_at,
    })),
  };
}

// ── Refunds ─────────────────────────────────────────────────────────────────

export interface RefundRow {
  id: string;
  order_number: string;
  name: string;
  boutique: string;
  total: number;
  /** The seller's delivery charge on this order — the buyer paid it, so a
   *  refund owes it back. */
  shipping_fee: number;
  /** Platform-funded coupon money the buyer never paid. Refunding it would be
   *  handing them ours. */
  platform_discount: number;
  status: OrderStatus;
  payment_id: string | null;
  /** Whether money actually reached us — the only thing that makes an order
   *  refundable. A COD order sits at 'pending' until the cash is collected on
   *  delivery, so it is NOT refundable however it was later cancelled. */
  payment_status: PaymentStatus;
  refunded: boolean;
  refunded_at: string | null;
  /** Razorpay's refund reference (0097). NULL on a row that was flagged by hand
   *  before real refunds existed — which is how the console tells them apart. */
  refund_id: string | null;
  refund_amount: number | null;
  refund_status: 'pending' | 'processed' | 'failed' | null;
  created_at: string;
}

/**
 * What the buyer actually paid for this one order — and therefore what a refund
 * has to send back.
 *
 * One Razorpay payment can cover several orders (a cart spanning three boutiques
 * writes three rows against one payment), and each row carries its own slice.
 * From api/place-order.js:669-714 that slice is `total + shipping_fee -
 * platform_discount`: `total` alone drops the delivery charge the buyer paid and
 * keeps the platform-funded discount they didn't.
 *
 * Mirrored server-side by `buyerPaidRupees` in api/_refunds.js — the server is
 * what actually refunds, so this is a display of that number, never the source
 * of it.
 */
export function buyerPaid(r: Pick<RefundRow, 'total' | 'shipping_fee' | 'platform_discount'>): number {
  return r.total + r.shipping_fee - r.platform_discount;
}

/**
 * Was money actually collected for this order?
 *
 * Online orders are paid up front. A COD order only becomes "paid" when the
 * seller collects at the door and the order is marked delivered, which is what
 * moves `payment_status` to 'paid' — before that there is nothing to give back.
 */
export function moneyCollected(r: Pick<RefundRow, 'payment_id' | 'payment_status'>): boolean {
  return r.payment_status === 'paid' || (!!r.payment_id && r.payment_status !== 'failed');
}

/**
 * An order the platform genuinely owes a refund on: money was taken, the order
 * fell through, and it has not been refunded yet.
 *
 * The rejected/cancelled test alone used to be the whole rule, which listed
 * every abandoned COD order as "Awaiting refund" — orders that were never paid
 * for. Acting on one would have paid out cash the platform never received.
 */
export function isRefundCandidate(r: RefundRow): boolean {
  if (r.refunded) return false;
  if (r.status !== 'rejected' && r.status !== 'cancelled') return false;
  return moneyCollected(r);
}

/**
 * The refund workbench feed — recent orders with their refund state, so the
 * admin can see the history and refund the ones that fell through.
 */
export async function fetchRefunds(): Promise<RefundRow[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, total, shipping_fee, platform_discount, status, payment_id, payment_status, refunded, refunded_at, refund_id, refund_amount, refund_status, created_at, guest_name, boutique:boutiques(name), buyer:profiles!orders_buyer_id_fkey(full_name)')
    .order('created_at', { ascending: false })
    .limit(150);
  if (error) throw error;
  const rows = (data ?? []) as unknown as (Omit<RefundRow, 'name' | 'boutique'> & {
    guest_name: string | null;
    boutique: { name: string } | null;
    buyer: { full_name: string } | null;
  })[];
  return rows.map((r) => ({
    id: r.id,
    order_number: r.order_number,
    name: r.buyer?.full_name ?? r.guest_name ?? 'Guest',
    boutique: r.boutique?.name ?? '—',
    total: Number(r.total),
    shipping_fee: Number(r.shipping_fee ?? 0),
    platform_discount: Number(r.platform_discount ?? 0),
    status: r.status,
    payment_id: r.payment_id,
    payment_status: r.payment_status ?? 'pending',
    refunded: r.refunded,
    refunded_at: r.refunded_at,
    refund_id: r.refund_id ?? null,
    refund_amount: r.refund_amount == null ? null : Number(r.refund_amount),
    refund_status: r.refund_status ?? null,
    created_at: r.created_at,
  }));
}

/**
 * Issue a real refund.
 *
 * The money moves server-side: the browser cannot hold a Razorpay secret, and
 * the amount must be re-derived from the order rather than trusted from here.
 * `/api/verify-payment` re-reads the order, works out what the buyer actually
 * paid, refunds it on whichever merchant account holds the payment, and only
 * then records it. See api/_refunds.js.
 */
export async function refundOrder(id: string, reason?: string): Promise<{ ok: boolean; error?: string; refundId?: string | null }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: 'Admin session expired. Please sign in again.' };

  try {
    const res = await fetch('/api/verify-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'refund-order', orderId: id, reason }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: body?.error ?? 'Could not issue the refund.' };
    return { ok: true, refundId: body?.refund_id ?? null };
  } catch (e) {
    console.error('refundOrder failed:', e);
    return { ok: false, error: 'Could not reach the refund service. Please try again.' };
  }
}

/**
 * Un-flag an order that was marked refunded BY HAND, before 0097.
 *
 * Deliberately not offered for a real gateway refund: once Razorpay has the
 * instruction the money is gone, and a button that quietly implies otherwise is
 * worse than no button. Those rows are corrected in the Razorpay dashboard.
 */
export async function clearLegacyRefundFlag(id: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from('orders')
    .update({ refunded: false, refunded_at: null })
    .eq('id', id)
    .is('refund_id', null);
  if (error) {
    console.error('clearLegacyRefundFlag failed:', error.message);
    return { ok: false, error: 'Could not update the refund. Please try again.' };
  }
  return { ok: true };
}

export async function fetchPayments(): Promise<PaymentRow[]> {
  const { data } = await supabase
    .from('orders')
    .select('id, total, status, boutique:boutiques(name)')
    .order('created_at', { ascending: false })
    .limit(20);
  const rows = (data ?? []) as unknown as { id: string; total: number; status: OrderStatus; boutique: { name: string } | null }[];
  return rows.map((r) => ({
    id: r.id,
    txn: '#TXN-' + r.id.slice(0, 6).toUpperCase(),
    name: r.boutique?.name ?? 'Boutique',
    amount: fmtInr(Number(r.total)),
    commission: fmtInr(Number(r.total) * commissionRate()),
    status: r.status === 'delivered' || r.status === 'shipped' ? 'Settled' : 'Pending',
    orderStatus: r.status,
  }));
}
