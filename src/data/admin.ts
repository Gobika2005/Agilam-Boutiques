import { supabase } from '@/lib/supabase';
import { fmtInr } from '@/lib/tokens';
import { POLICY_TERMS } from '@/data/company';
import type { OrderStatus } from '@/types/database';

const COMMISSION_RATE = POLICY_TERMS.commissionPct / 100;

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

  return { gmv, activeBoutiques: activeBoutiques ?? 0, ordersThisMonth, platformRevenue: gmv * COMMISSION_RATE };
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

export async function fetchCategoryStats(): Promise<CategoryStat[]> {
  const { data } = await supabase.from('products').select('category');
  const rows = data ?? [];
  const counts = new Map<string, number>();
  rows.forEach((r) => counts.set(r.category, (counts.get(r.category) ?? 0) + 1));
  const total = rows.length || 1;
  return [...counts.entries()]
    .map(([name, count]) => ({ name, pct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 6);
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
  gmv: number;
  platformRevenue: number;
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
const isEarned = (o: DashOrder) => o.status !== 'rejected' && !o.refunded;

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
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();

  const blank = (): WindowStat => ({ revenue: 0, orders: 0 });
  const acc = { today: blank(), yesterday: blank(), week: blank(), month: blank(), year: blank() };
  let gmv = 0;
  let online = 0;
  let cod = 0;
  const byBoutique = new Map<string, TopBoutique>();

  // 14-day series buckets
  const days = 14;
  const revSeries = new Array(days).fill(0);
  const ordSeries = new Array(days).fill(0);

  for (const o of orders) {
    const t = new Date(o.created_at).getTime();
    const earned = isEarned(o);
    const amt = Number(o.total);
    if (earned) {
      gmv += amt;
      if (o.payment_id) online += 1; else cod += 1;
      if (t >= todayStart) { acc.today.revenue += amt; acc.today.orders += 1; }
      if (t >= yStart && t < todayStart) { acc.yesterday.revenue += amt; acc.yesterday.orders += 1; }
      if (t >= weekStart) { acc.week.revenue += amt; acc.week.orders += 1; }
      if (t >= monthStart) { acc.month.revenue += amt; acc.month.orders += 1; }
      if (t >= yearStart) { acc.year.revenue += amt; acc.year.orders += 1; }

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
    platformRevenue: gmv * COMMISSION_RATE,
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
    commission: fmtInr(Number(r.total) * COMMISSION_RATE),
    status: r.status === 'delivered' || r.status === 'shipped' ? 'Settled' : 'Pending',
    orderStatus: r.status,
  }));
}
