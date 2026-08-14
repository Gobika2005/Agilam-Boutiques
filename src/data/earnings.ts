import { supabase } from '@/lib/supabase';
import { currentSettings } from '@/data/settings';
import { isMissingExpensesTable } from '@/data/expenses';
import type { OrderStatus, AdStatus } from '@/types/database';

/**
 * MangaiMart's own books — what the *platform* earns and spends, as opposed to
 * what the marketplace turns over.
 *
 * `src/data/admin.ts` answers "how is the marketplace doing" (GMV, orders, top
 * boutiques). This answers "how is the business doing", and it is what the
 * admin Overview leads with. The two deliberately disagree on some numbers,
 * because they are counting different things at different moments:
 *
 *  - **Commission is earned on DELIVERY**, not at checkout. An order that has
 *    been placed but not handed over is money we might still have to give back,
 *    so it sits in `pipeline` instead of in earnings. (`admin.ts` counts GMV
 *    from placement — that is a marketplace-activity number, not a revenue one.)
 *  - **Ad income is recognised on `paid_at`**, the day the seller's money
 *    actually arrived. House ads (migration 0070) are `amount = 0` and
 *    `house_ad = true`, and refunded campaigns are dropped outright.
 *  - **Platform coupons are a cost.** `orders.platform_discount` is funded by us,
 *    not the seller (migration 0053), so it is real money out of the business.
 *  - **Refunds reverse the commission** that delivery booked, on the day of the
 *    refund. Nothing is rewritten retroactively: an order delivered in March and
 *    refunded in April earns in March and reverses in April, which is how the
 *    months stay reconcilable. The coupon cost is NOT reversed — that discount
 *    was spent to win the sale whether or not it later came back.
 *
 * One caveat worth knowing: `platform_settings.commission_pct` is a single live
 * rate with no history, so changing it re-prices every past order in this view.
 * Nothing here can fix that; only a per-order commission column could.
 */

/** The live commission rate, read per call so a change in Platform Settings reaches these figures. */
const commissionRate = () => currentSettings().commission_pct / 100;

/** Every money line for one period. All amounts in rupees. */
export interface EarningsWindow {
  /** Commission booked on orders delivered in this period. */
  commission: number;
  /** Ad placements paid for in this period (house ads and refunds excluded). */
  ads: number;
  /** Platform-funded coupon discounts on those delivered orders — a cost. */
  couponCost: number;
  /** Commission backed out of refunds recorded in this period — a cost. */
  refundReversal: number;
  /** Platform spend recorded in /admin/expenses for this period. */
  expenses: number;
  deliveredOrders: number;
  paidCampaigns: number;
}

/** The numeric fields of a window — every field, used as accumulator keys. */
type Field = keyof EarningsWindow;

export const blankWindow = (): EarningsWindow => ({
  commission: 0, ads: 0, couponCost: 0, refundReversal: 0, expenses: 0,
  deliveredOrders: 0, paidCampaigns: 0,
});

/** What the platform took in before any cost. */
export const grossIncome = (w: EarningsWindow) => w.commission + w.ads;
/** Everything the business paid out, including the discounts it funded. */
export const totalCosts = (w: EarningsWindow) => w.couponCost + w.refundReversal + w.expenses;
/** Income − costs. The one number the owner asked to lead with. */
export const netProfit = (w: EarningsWindow) => grossIncome(w) - totalCosts(w);

export interface PeriodRow extends EarningsWindow {
  /** Bucket label — "8 Aug" for the daily series, "Aug 2026" for the monthly one. */
  label: string;
}

export interface EarningsData {
  today: EarningsWindow;
  yesterday: EarningsWindow;
  week: EarningsWindow;
  prevWeek: EarningsWindow;
  month: EarningsWindow;
  prevMonth: EarningsWindow;
  year: EarningsWindow;
  prevYear: EarningsWindow;
  allTime: EarningsWindow;
  /** Commission on orders placed and still in flight — earned only once delivered. */
  pipeline: { commission: number; orders: number };
  /** Last 14 days, for the trend chart. */
  series: PeriodRow[];
  /** Last 12 months, for the P&L table and its CSV. */
  monthly: PeriodRow[];
  /** The rate every commission figure above was computed at. */
  commissionPct: number;
  /**
   * Delivered orders with no `delivered_at` stamp — they predate migration 0042,
   * so their commission is recognised on `created_at` instead. Surfaced so a
   * skewed early month can be explained rather than quietly wrong.
   */
  undatedDelivered: number;
  /** True when the expenses table is missing (migration 0056 not applied). */
  expensesUnavailable: boolean;
}

type EarnOrder = {
  total: number;
  status: OrderStatus;
  created_at: string;
  delivered_at: string | null;
  refunded: boolean;
  refunded_at: string | null;
  platform_discount: number | null;
};

type EarnCampaign = {
  amount: number;
  paid_at: string | null;
  house_ad: boolean;
  status: AdStatus;
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Parses a `YYYY-MM-DD` column as local midnight — `new Date(str)` would read it as UTC. */
function parseDay(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
}

const monthKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export async function fetchEarnings(): Promise<EarningsData> {
  const [ordersRes, adsRes, expensesRes] = await Promise.all([
    supabase
      .from('orders')
      .select('total, status, created_at, delivered_at, refunded, refunded_at, platform_discount'),
    supabase.from('ad_campaigns').select('amount, paid_at, house_ad, status'),
    supabase.from('expenses').select('amount, spent_on'),
  ]);

  const orders = (ordersRes.data ?? []) as EarnOrder[];
  const campaigns = (adsRes.data ?? []) as EarnCampaign[];
  // Migration 0056 may not be applied yet; an absent table must read as "no
  // expenses recorded", not as a dead dashboard.
  const expensesUnavailable = isMissingExpensesTable(expensesRes.error);
  const expenses = (expensesRes.data ?? []) as { amount: number; spent_on: string }[];

  const rate = commissionRate();
  const now = new Date();
  const todayStart = startOfDay(now);
  const weekStart = todayStart - 6 * 86400000;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const yearStart = new Date(now.getFullYear(), 0, 1).getTime();

  const windows = {
    today: blankWindow(), yesterday: blankWindow(), week: blankWindow(), prevWeek: blankWindow(),
    month: blankWindow(), prevMonth: blankWindow(), year: blankWindow(), prevYear: blankWindow(),
    allTime: blankWindow(),
  };
  const ranges: { key: keyof typeof windows; from: number; to: number }[] = [
    { key: 'today', from: todayStart, to: Infinity },
    { key: 'yesterday', from: todayStart - 86400000, to: todayStart },
    { key: 'week', from: weekStart, to: Infinity },
    { key: 'prevWeek', from: weekStart - 7 * 86400000, to: weekStart },
    { key: 'month', from: monthStart, to: Infinity },
    { key: 'prevMonth', from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), to: monthStart },
    { key: 'year', from: yearStart, to: Infinity },
    { key: 'prevYear', from: new Date(now.getFullYear() - 1, 0, 1).getTime(), to: yearStart },
    { key: 'allTime', from: -Infinity, to: Infinity },
  ];

  // 14 daily buckets + 12 monthly ones, filled by the same event pass.
  const DAYS = 14;
  const seriesStart = todayStart - (DAYS - 1) * 86400000;
  const series: PeriodRow[] = Array.from({ length: DAYS }, (_, i) => ({
    label: new Date(seriesStart + i * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
    ...blankWindow(),
  }));
  const MONTHS = 12;
  const monthIdx = new Map<string, number>();
  const monthly: PeriodRow[] = Array.from({ length: MONTHS }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (MONTHS - 1 - i), 1);
    monthIdx.set(monthKey(d.getTime()), i);
    return { label: d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }), ...blankWindow() };
  });

  /** One money movement: an amount landing on a field on a given day. */
  const events: { t: number; field: Field; v: number }[] = [];
  const add = (t: number, field: Field, v: number) => { if (v) events.push({ t, field, v }); };

  let pipelineCommission = 0;
  let pipelineOrders = 0;
  let undatedDelivered = 0;

  for (const o of orders) {
    const amt = Number(o.total) || 0;
    const commission = amt * rate;
    const delivered = o.status === 'delivered';

    if (delivered) {
      // Pre-0042 orders carry no delivery stamp — fall back to placement rather
      // than dropping their commission out of the books entirely.
      if (!o.delivered_at) undatedDelivered += 1;
      const t = parseIso(o.delivered_at) ?? parseIso(o.created_at) ?? Date.now();
      add(t, 'commission', commission);
      add(t, 'deliveredOrders', 1);
      add(t, 'couponCost', Number(o.platform_discount) || 0);
    } else if (o.status !== 'cancelled' && o.status !== 'rejected' && !o.refunded) {
      // Paid for and still in flight: commission we expect but have not earned.
      pipelineCommission += commission;
      pipelineOrders += 1;
    }

    // A refund only reverses what delivery actually booked. Refunding an order
    // that never got there costs the platform nothing in commission terms.
    if (o.refunded && delivered) {
      const t = parseIso(o.refunded_at) ?? parseIso(o.created_at) ?? Date.now();
      add(t, 'refundReversal', commission);
    }
  }

  for (const c of campaigns) {
    if (c.house_ad || !c.paid_at || c.status === 'refunded') continue;
    const t = parseIso(c.paid_at);
    if (t === null) continue;
    add(t, 'ads', Number(c.amount) || 0);
    add(t, 'paidCampaigns', 1);
  }

  for (const e of expenses) {
    if (!e.spent_on) continue;
    add(parseDay(e.spent_on), 'expenses', Number(e.amount) || 0);
  }

  for (const ev of events) {
    for (const r of ranges) {
      if (ev.t >= r.from && ev.t < r.to) windows[r.key][ev.field] += ev.v;
    }
    const di = Math.floor((ev.t - seriesStart) / 86400000);
    if (di >= 0 && di < DAYS) series[di][ev.field] += ev.v;
    const mi = monthIdx.get(monthKey(ev.t));
    if (mi !== undefined) monthly[mi][ev.field] += ev.v;
  }

  return {
    ...windows,
    pipeline: { commission: pipelineCommission, orders: pipelineOrders },
    series,
    monthly,
    commissionPct: currentSettings().commission_pct,
    undatedDelivered,
    expensesUnavailable,
  };
}

function parseIso(v: string | null): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}
