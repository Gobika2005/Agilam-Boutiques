import { supabase } from '@/lib/supabase';
import { fetchBoutiquePrivate } from './boutiques';

/**
 * Seller payouts — what the platform owes each boutique after every deduction.
 *
 * The rules live in one place (mirrored server-side in `settle_boutique_payout`,
 * migration 0078, which is the source of truth when money is actually recorded —
 * this module only computes what to *show*):
 *
 *   • The platform take is a flat 10% of goods, already covering the gateway fee
 *     and tax.
 *   • Prepaid orders: platform holds the money → it owes  goods − 10%.
 *   • COD orders: seller holds the cash → seller owes  10% + shipping + COD fee,
 *     netted off the payout (so a boutique can settle to a negative figure).
 *   • Offline / walk-in POS sales are the seller's own till — excluded.
 *
 * ── Delivery is the gate (migration 0078) ──────────────────────────────────
 *
 * An order becomes settleable only once it has been DELIVERED — `status =
 * 'delivered'` with a `delivered_at` stamp — on top of the money being real and
 * un-reversed (paid, not refunded, not disputed, not already stamped with a
 * `payout_id`).
 *
 * Until 0078 this module and the settle function both paid on `payment_status =
 * 'paid'` alone, so an order placed an hour ago and never shipped counted as a
 * balance owed. Anything paid but not yet delivered is now reported separately
 * as HELD: still visible to the admin, deliberately not payable.
 *
 * The 8-hour promise (`payout_sla_hours`) runs from the OLDEST delivery in the
 * balance — that is the order that has waited longest, so it is the one the
 * commitment is measured against.
 */
export const PAYOUT_RATE = 0.1; // commission + gateway + tax, bundled

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PayoutSummary {
  boutique_id: string;
  name: string;
  tone: number;
  /** Settleable, not-yet-settled order count. Delivered orders only. */
  orders: number;
  prepaidGoods: number;
  prepaidCommission: number;
  prepaidFees: number;
  codGoods: number;
  codCommission: number;
  codFees: number;
  /** Platform-funded coupon money the seller never collected in cash on their
   *  COD orders, and which we therefore owe them back (migration 0053). */
  codPlatformDiscount: number;
  /** What we owe the seller (goods − commission for prepaid). */
  prepaidPayout: number;
  /** What the seller owes us on COD cash they hold (shown as a positive owed). */
  codOwed: number;
  /** Net payable — can be negative (seller owes the platform). */
  net: number;
  /** Delivery time of the longest-waiting order in this balance. The payout
   *  clock runs from here; null only if the rows predate `delivered_at`. */
  oldestDeliveredAt: string | null;
  /** Paid orders NOT yet delivered — money the platform is holding on purpose.
   *  Never part of `net`; shown so an admin can see why a balance looks light. */
  heldOrders: number;
  heldValue: number;
}

interface OrderCalcRow {
  boutique_id: string;
  total: number;
  cod_fee: number | null;
  shipping_fee: number | null;
  platform_discount: number | null;
  payment_method: string | null;
  channel: string | null;
  status: string;
  delivered_at: string | null;
  delivery_disputed: boolean | null;
  boutique: { name: string; tone: number } | null;
}

const emptySummary = (r: OrderCalcRow): PayoutSummary => ({
  boutique_id: r.boutique_id,
  name: r.boutique?.name ?? 'Boutique',
  tone: r.boutique?.tone ?? 0,
  orders: 0,
  prepaidGoods: 0, prepaidCommission: 0, prepaidFees: 0,
  codGoods: 0, codCommission: 0, codFees: 0, codPlatformDiscount: 0,
  prepaidPayout: 0, codOwed: 0, net: 0,
  oldestDeliveredAt: null,
  heldOrders: 0, heldValue: 0,
});

/**
 * Per-boutique outstanding balance, ready to settle.
 *
 * One query covers both buckets: the delivered orders that make up the payable
 * balance, and the paid-but-undelivered ones held back. Splitting them here
 * rather than in two round trips keeps the two figures consistent — they are
 * read from the same snapshot, so a delivery landing mid-load can never make an
 * order appear in both or neither.
 */
export async function fetchPayoutSummaries(): Promise<PayoutSummary[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('boutique_id, total, cod_fee, shipping_fee, platform_discount, payment_method, channel, status, delivered_at, delivery_disputed, boutique:boutiques(name, tone)')
    .is('payout_id', null)
    .eq('payment_status', 'paid')
    .eq('refunded', false)
    .not('status', 'in', '(rejected,cancelled)');
  if (error) throw error;

  const rows = (data ?? []) as unknown as OrderCalcRow[];
  const map = new Map<string, PayoutSummary>();

  for (const r of rows) {
    if ((r.channel ?? 'online') === 'offline') continue;
    const s = map.get(r.boutique_id) ?? emptySummary(r);
    map.set(r.boutique_id, s);

    const goods = Number(r.total);

    // Not delivered (or delivered but disputed) → held, never payable. Mirrors
    // `is_settleable()` in migration 0078.
    if (r.status !== 'delivered' || !r.delivered_at || r.delivery_disputed) {
      s.heldOrders += 1;
      s.heldValue = round2(s.heldValue + goods);
      continue;
    }

    if (!s.oldestDeliveredAt || r.delivered_at < s.oldestDeliveredAt) {
      s.oldestDeliveredAt = r.delivered_at;
    }

    const commission = round2(goods * PAYOUT_RATE);
    const fees = Number(r.cod_fee ?? 0) + Number(r.shipping_fee ?? 0);
    s.orders += 1;
    if (r.payment_method === 'COD') {
      s.codGoods += goods;
      s.codCommission += commission;
      s.codFees += fees;
      // The seller collected the cash MINUS any platform coupon, but is settled
      // on the full goods value — so we owe them that gap back. Mirrors
      // settle_boutique_payout (migration 0053, restored in 0078).
      s.codPlatformDiscount += Number(r.platform_discount ?? 0);
    } else {
      s.prepaidGoods += goods;
      s.prepaidCommission += commission;
      s.prepaidFees += fees;
    }
  }

  const list = [...map.values()];
  for (const s of list) {
    s.prepaidPayout = round2(s.prepaidGoods - s.prepaidCommission);
    s.codOwed = round2(s.codCommission + s.codFees - s.codPlatformDiscount);
    s.net = round2(s.prepaidPayout - s.codOwed);
  }
  // A boutique with nothing delivered has no balance to act on; it stays in the
  // list only while it has something held, so the admin can still see it.
  return list
    .filter((s) => s.orders > 0 || s.heldOrders > 0)
    .sort((a, b) => b.net - a.net);
}

/**
 * How the 8-hour promise is doing for one balance.
 *
 * `dueAt` is `oldestDeliveredAt + payout_sla_hours`. A balance with nothing
 * delivered has no clock at all — returning null rather than a fabricated
 * deadline keeps "not payable yet" visibly different from "due now".
 */
export interface PayoutClock {
  dueAt: Date | null;
  msRemaining: number;
  overdue: boolean;
  /** "due in 5h 12m" / "3h 04m overdue" / "nothing delivered yet". */
  label: string;
}

export function payoutClock(oldestDeliveredAt: string | null, slaHours: number, now = Date.now()): PayoutClock {
  if (!oldestDeliveredAt) {
    return { dueAt: null, msRemaining: 0, overdue: false, label: 'nothing delivered yet' };
  }
  const dueAt = new Date(new Date(oldestDeliveredAt).getTime() + slaHours * 3600_000);
  const msRemaining = dueAt.getTime() - now;
  const overdue = msRemaining < 0;
  const abs = Math.abs(msRemaining);
  const h = Math.floor(abs / 3600_000);
  const m = Math.floor((abs % 3600_000) / 60_000);
  const span = h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
  return { dueAt, msRemaining, overdue, label: overdue ? `${span} overdue` : `due in ${span}` };
}

/**
 * Where a boutique's money actually has to be sent.
 *
 * Payouts are made by hand from the admin console, so the console has to show
 * the destination next to the amount — an admin should never have to open the
 * seller's profile in another tab to find an account number. `hasBank` is the
 * gate: MangaiMart settles by bank transfer only, so a boutique without an
 * account number AND IFSC cannot be paid, however large its balance.
 *
 * `upiId` is carried for the boutiques that onboarded under the older
 * "UPI or bank" rule. It is shown as a legacy fallback so those sellers can
 * still be paid manually while they add a bank account, but it never satisfies
 * `hasBank`.
 */
export interface PayoutDestination {
  boutique_id: string;
  accountName: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  upiId: string | null;
  hasBank: boolean;
  /** Where to tell the seller the money has gone. The in-app notification is
   *  automatic (trigger, migration 0078); these back the email advice and the
   *  WhatsApp message the admin sends by hand. */
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
}

/**
 * Payout destinations for the given boutiques.
 *
 * `boutique_private` is a per-boutique SECURITY DEFINER function (migration
 * 0021) with no bulk form, so this fans out one call per boutique. That is fine
 * here: the list is only ever the boutiques with an outstanding balance, and a
 * failure on any one of them degrades to "details unknown" rather than taking
 * the whole payouts page down.
 */
export async function fetchPayoutDestinations(boutiqueIds: string[]): Promise<Map<string, PayoutDestination>> {
  const unique = [...new Set(boutiqueIds)];
  const entries = await Promise.all(
    unique.map(async (id): Promise<[string, PayoutDestination] | null> => {
      try {
        const p = await fetchBoutiquePrivate(id);
        const accountNumber = p?.bank_account_number ?? null;
        const ifsc = p?.bank_ifsc ?? null;
        return [id, {
          boutique_id: id,
          accountName: p?.bank_account_name ?? null,
          accountNumber,
          ifsc,
          upiId: p?.upi_id ?? null,
          hasBank: Boolean(accountNumber && ifsc),
          email: p?.email ?? null,
          phone: p?.phone ?? null,
          whatsapp: p?.whatsapp ?? null,
        }];
      } catch {
        return null;
      }
    }),
  );
  return new Map(entries.filter((e): e is [string, PayoutDestination] => e !== null));
}

export type PayoutStatus = 'processing' | 'paid' | 'failed' | 'reversed';
export type PayoutProvider = 'manual' | 'razorpayx';

export interface PayoutRecord {
  id: string;
  boutique_id: string;
  amount: number;
  orders_count: number;
  gross: number;
  commission: number;
  fees: number;
  cod_adjustment: number;
  note: string | null;
  created_by_name: string;
  created_at: string;
  /** 'processing' while RazorpayX moves an automatic payout; 'paid' once done. */
  status: PayoutStatus;
  /** 'razorpayx' for an auto payout, 'manual' for an admin settlement. */
  provider: PayoutProvider;
  method: string | null;
  utr: string | null;
  failure_reason: string | null;
  boutique: { name: string; tone: number } | null;
}

/** Recorded payouts, most recent first. */
export async function fetchPayoutHistory(): Promise<PayoutRecord[]> {
  const { data, error } = await supabase
    .from('payouts')
    .select('id, boutique_id, amount, orders_count, gross, commission, fees, cod_adjustment, note, created_by_name, created_at, status, provider, method, utr, failure_reason, boutique:boutiques(name, tone)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as unknown as PayoutRecord[];
}

/**
 * Settle a boutique's outstanding balance. The server recomputes the amount from
 * the orders and stamps them, so the returned record is authoritative even if
 * the displayed figure had drifted since the page loaded.
 */
export async function settlePayout(boutiqueId: string, note?: string): Promise<PayoutRecord> {
  const { data, error } = await supabase.rpc('settle_boutique_payout', {
    p_boutique_id: boutiqueId,
    p_note: note ?? null,
  });
  if (error) throw error;
  return data as unknown as PayoutRecord;
}

/**
 * Email the seller their payout advice.
 *
 * Lives in a Supabase Edge Function, not `api/`: that directory is at Vercel's
 * 12-route Hobby ceiling. Never throws — the money has already moved by the time
 * this is called, so a mail failure is a toast, not an error state, and the
 * in-app notification has landed regardless.
 *
 * Returns `{ ok: false, error }` for every failure mode, including the function
 * not being deployed yet.
 */
export async function sendPayoutAdvice(payoutId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('payout-advice', { body: { payoutId } });
    if (error) return { ok: false, error: error.message };
    const res = data as { ok?: boolean; error?: string } | null;
    return res?.ok ? { ok: true } : { ok: false, error: res?.error ?? 'Could not send the email' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Could not send the email' };
  }
}

/**
 * The WhatsApp message an admin sends by hand.
 *
 * The Meta Cloud API automation (migration 0061) is planned, not built, so this
 * is a wa.me deep link — the same approach the seller's offline-billing screen
 * takes. Composed here rather than in the component so the admin's WhatsApp and
 * the emailed advice quote the same numbers.
 */
export function payoutWhatsAppText(opts: {
  boutiqueName: string;
  amount: number;
  orders: number;
  commission: number;
  reference?: string | null;
}): string {
  const rupees = (n: number) => '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN');
  if (opts.amount < 0) {
    return (
      `Hello ${opts.boutiqueName}, your MangaiMart statement is ready. ` +
      `This cycle your COD commission (${rupees(opts.amount)}) was more than your online earnings, so no transfer was made and the balance carries forward. ` +
      `The order-by-order breakdown is in your seller app under Earnings.`
    );
  }
  return (
    `Hello ${opts.boutiqueName}, MangaiMart has transferred ${rupees(opts.amount)} to your bank account for ` +
    `${opts.orders} delivered order${opts.orders === 1 ? '' : 's'}. Commission deducted: ${rupees(opts.commission)}.` +
    (opts.reference ? ` Reference: ${opts.reference}.` : '') +
    ` Payouts are released only after delivery, within 8 hours. The order-by-order breakdown is in your seller app under Earnings.`
  );
}

/** A boutique's own payout history — the seller's statement list. RLS (0025)
 *  scopes this to boutiques they own, so no filter here is load-bearing. */
export async function fetchBoutiquePayouts(boutiqueId: string): Promise<PayoutRecord[]> {
  const { data, error } = await supabase
    .from('payouts')
    .select('id, boutique_id, amount, orders_count, gross, commission, fees, cod_adjustment, note, created_by_name, created_at, status, provider, method, utr, failure_reason, boutique:boutiques(name, tone)')
    .eq('boutique_id', boutiqueId)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data ?? []) as unknown as PayoutRecord[];
}

/* ── The order-by-order statement ──────────────────────────────────────────
 *
 * Both consoles ask the same question of the same rows — "which orders is this
 * money for, and what was in them" — so one shape answers it for the admin
 * (before settling) and the seller (after). Every per-order figure is DERIVED
 * here from the stored order, not stored on a line table: the 10% is the one in
 * `PAYOUT_RATE`, and the payout row snapshots only the totals. That keeps the
 * statement honest against a historical payout without a schema for it.
 */

export interface StatementItem {
  id: string;
  title: string;
  price: number;
  qty: number;
  size: string | null;
  color: string | null;
}

export interface StatementOrder {
  id: string;
  /** The human order reference sellers and buyers both quote. */
  orderNumber: string;
  created_at: string;
  delivered_at: string | null;
  payment_method: string | null;
  isCod: boolean;
  buyerName: string;
  /** Goods value the commission is charged on. */
  goods: number;
  commission: number;
  shippingFee: number;
  codFee: number;
  platformDiscount: number;
  /** What this single order contributes to the payout. Prepaid: goods − 10%.
   *  COD: negative — the seller already holds the cash and owes us the take. */
  net: number;
  items: StatementItem[];
}

interface StatementRow {
  id: string;
  order_number: string | null;
  created_at: string;
  delivered_at: string | null;
  total: number;
  cod_fee: number | null;
  shipping_fee: number | null;
  platform_discount: number | null;
  payment_method: string | null;
  guest_name: string | null;
  buyer: { full_name: string | null } | null;
  items: { id: string; title: string; price: number; qty: number; size: string | null; color: string | null }[] | null;
}

const STATEMENT_COLS =
  'id, order_number, created_at, delivered_at, total, cod_fee, shipping_fee, platform_discount, payment_method, guest_name, ' +
  'buyer:profiles!orders_buyer_id_fkey(full_name), items:order_items(id, title, price, qty, size, color)';

function toStatementOrder(r: StatementRow): StatementOrder {
  const goods = Number(r.total);
  const commission = round2(goods * PAYOUT_RATE);
  const isCod = r.payment_method === 'COD';
  const shippingFee = Number(r.shipping_fee ?? 0);
  const codFee = Number(r.cod_fee ?? 0);
  const platformDiscount = Number(r.platform_discount ?? 0);
  return {
    id: r.id,
    orderNumber: r.order_number ?? `#${r.id.slice(0, 8)}`,
    created_at: r.created_at,
    delivered_at: r.delivered_at,
    payment_method: r.payment_method,
    isCod,
    buyerName: r.buyer?.full_name ?? r.guest_name ?? 'Customer',
    goods,
    commission,
    shippingFee,
    codFee,
    platformDiscount,
    // COD: the seller kept the cash, so this order REDUCES the transfer by the
    // take plus the fees they collected on our behalf, less any platform coupon
    // they were never handed in cash.
    net: isCod
      ? round2(-(commission + shippingFee + codFee) + platformDiscount)
      : round2(goods - commission),
    items: (r.items ?? []).map((i) => ({
      id: i.id,
      title: i.title,
      price: Number(i.price),
      qty: Number(i.qty),
      size: i.size,
      color: i.color,
    })),
  };
}

/**
 * The delivered orders making up a boutique's current outstanding balance —
 * what the admin is about to pay for, itemised.
 *
 * Filters mirror `is_settleable()` (0078) exactly. If they ever drift, the
 * drawer would itemise a different set of orders than the settle actually
 * stamps, so keep the two in step.
 */
export async function fetchSettleableOrders(boutiqueId: string): Promise<StatementOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(STATEMENT_COLS)
    .eq('boutique_id', boutiqueId)
    .is('payout_id', null)
    .eq('payment_status', 'paid')
    .eq('refunded', false)
    .eq('status', 'delivered')
    .not('delivered_at', 'is', null)
    .eq('delivery_disputed', false)
    .neq('channel', 'offline')
    .order('delivered_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as StatementRow[]).map(toStatementOrder);
}

/** The orders one recorded payout covered — the seller's statement for a
 *  credit that has already landed in their bank. */
export async function fetchPayoutStatement(payoutId: string): Promise<StatementOrder[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(STATEMENT_COLS)
    .eq('payout_id', payoutId)
    .order('delivered_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as unknown as StatementRow[]).map(toStatementOrder);
}
