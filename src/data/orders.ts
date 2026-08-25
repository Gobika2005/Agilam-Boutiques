import { supabase } from '@/lib/supabase';
import { likeValue, isUuid } from '@/lib/search/query';
import { isStaffSession } from './consoleRole';
import type { OrderWithDetails, OrderStatus } from './types';
import type { Paged } from './adminUsers';

const BASE_SELECT = `id, order_number, buyer_id, boutique_id, status, total, created_at, accepted_at, shipped_at, delivered_at, guest_name, guest_phone, guest_city, guest_address, guest_pincode, payment_id, refunded, channel, payment_method, payment_status, paid_at, cod_fee, shipping_fee, platform_discount, cancelled_at, cancel_reason, buyer:profiles!orders_buyer_id_fkey(full_name, phone, city), boutique:boutiques(name, tone), items:order_items(id, product_id, title, price, qty, size, color, product:products(image_url, tone))`;

/**
 * Columns that only exist once a particular migration has been applied. Split
 * out for the same reason as the sales counters in `src/data/boutiques.ts`:
 * naming a column that does not exist yet fails the WHOLE query, and this SELECT
 * feeds every order screen in all three consoles. An un-migrated deploy must
 * lose the detail, not the orders.
 *
 * Migrations here are applied by hand, so "not applied yet" is a normal state
 * for a deploy to be in, not an error.
 */
const OPTIONAL_GROUPS = [
  {
    columns: 'packed_at, out_for_delivery_at, delivery_disputed, delivery_disputed_at',
    warn: '[orders] courier tracking columns unavailable — apply migration 0063.',
    available: true,
  },
  {
    columns: 'refund_id, refund_amount, refund_status',
    warn: '[orders] refund columns unavailable — apply migration 0097.',
    available: true,
  },
];

function currentSelect(): string {
  const extra = OPTIONAL_GROUPS.filter((g) => g.available).map((g) => g.columns);
  return extra.length ? `${BASE_SELECT}, ${extra.join(', ')}` : BASE_SELECT;
}

/**
 * Which group to give up on when a select fails on a missing column. PostgREST
 * names the offending column in its message, so prefer the group that actually
 * matches; fall back to dropping the last one still in play.
 */
function retireGroupFor(message: string | undefined): boolean {
  const live = OPTIONAL_GROUPS.filter((g) => g.available);
  if (live.length === 0) return false;
  const named = live.find((g) =>
    g.columns.split(',').some((c) => (message ?? '').includes(c.trim())),
  );
  const victim = named ?? live[live.length - 1];
  victim.available = false;
  console.warn(victim.warn);
  return true;
}

async function selectOrders<T>(
  run: (columns: string) => PromiseLike<{ data: T; error: { message?: string; code?: string } | null }>,
): Promise<T> {
  // At most one attempt per optional group, plus the bare base select.
  for (;;) {
    const { data, error } = await run(currentSelect());
    if (!error) return data;
    // 42703 = undefined_column, 42501 = insufficient_privilege (not granted).
    if (error.code !== '42703' && error.code !== '42501') throw error;
    if (!retireGroupFor(error.message)) throw error;
  }
}

export async function fetchOrdersForBuyer(buyerId: string): Promise<OrderWithDetails[]> {
  const data = await selectOrders((cols) =>
    supabase.from('orders').select(cols).eq('buyer_id', buyerId).order('created_at', { ascending: false }),
  );
  return (data ?? []) as unknown as OrderWithDetails[];
}

/**
 * Live order-status updates for a signed-in buyer.
 *
 * The boutique moves an order through pending → shipped → delivered from its
 * own console. Without this the buyer's tracking screen only ever showed the
 * status captured at checkout, so an order that had already shipped still read
 * "Order Placed" until the page was reloaded.
 */
export function subscribeToBuyerOrders(buyerId: string, onChange: () => void) {
  const channel = supabase
    .channel(`buyer-orders:${buyerId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `buyer_id=eq.${buyerId}` },
      () => onChange(),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export async function fetchOrdersForBoutique(boutiqueId: string): Promise<OrderWithDetails[]> {
  const data = await selectOrders((cols) =>
    supabase.from('orders').select(cols).eq('boutique_id', boutiqueId).order('created_at', { ascending: false }),
  );
  return (data ?? []) as unknown as OrderWithDetails[];
}

/**
 * Every order, for the console.
 *
 * Staff take a different road to the same place. Migration 0086 gives them no
 * RLS policy on `orders` at all — a direct select returns nothing — because a
 * policy cannot withhold a single column and `orders.guest_phone` is the buyer's
 * mobile number. `staff_orders_feed()` is a SECURITY DEFINER function that
 * returns the identical shape with the phone masked, so the screens below this
 * never learn which role fetched their rows.
 */
async function staffOrdersFeed(): Promise<OrderWithDetails[]> {
  const { data, error } = await supabase.rpc('staff_orders_feed');
  if (error) throw error;
  return (data ?? []) as unknown as OrderWithDetails[];
}

export async function fetchAllOrdersAdmin(): Promise<OrderWithDetails[]> {
  if (isStaffSession()) return staffOrdersFeed();
  const data = await selectOrders((cols) =>
    supabase.from('orders').select(cols).order('created_at', { ascending: false }),
  );
  return (data ?? []) as unknown as OrderWithDetails[];
}

export async function fetchOrder(id: string): Promise<OrderWithDetails | null> {
  const data = await selectOrders((cols) =>
    supabase.from('orders').select(cols).eq('id', id).maybeSingle(),
  );
  return data as unknown as OrderWithDetails | null;
}

/** The extra facts a printable receipt needs, beyond what the order screen holds. */
export interface ReceiptExtras {
  paymentId: string | null;
  paidAt: string | null;
  buyer: { name: string | null; phone: string | null; address: string | null; city: string | null; pincode: string | null };
  shop: {
    name: string;
    logoUrl: string | null;
    addressLine: string | null;
    city: string | null;
    district: string | null;
    state: string | null;
    pincode: string | null;
  } | null;
}

/**
 * Everything the buyer's downloadable receipt needs that `PlacedOrder` doesn't
 * carry: the payment reference, when it was paid, the address the order was
 * actually placed with, and the boutique's own postal details and logo.
 *
 * Fetched on demand — when the buyer taps "Download receipt" — rather than
 * folded into the orders query that runs on every visit to the orders list.
 * These fields are needed on one screen by one action, and `fetchOrdersForBuyer`
 * already returns every order a buyer has ever placed.
 *
 * Two queries, not a join: `boutiques` has column-level grants (migration 0021),
 * so it is selected by name from its own statement where the granted list is
 * obvious. Both are ordinary RLS reads — the order by `buyer_id`, the boutique
 * from the public storefront columns — so this needs no new policy.
 *
 * Returns null if the order isn't readable, which is the honest answer for a
 * guest's locally-mirrored order: it has no row the server will hand back.
 */
export async function fetchReceiptExtras(orderRowId: string): Promise<ReceiptExtras | null> {
  const { data: order, error } = await supabase
    .from('orders')
    .select('payment_id, paid_at, created_at, boutique_id, guest_name, guest_phone, guest_address, guest_city, guest_pincode')
    .eq('id', orderRowId)
    .maybeSingle();
  if (error || !order) return null;

  const { data: shop } = await supabase
    .from('boutiques')
    .select('name, logo_url, address_line, city, district, state, pincode')
    .eq('id', order.boutique_id)
    .maybeSingle();

  return {
    paymentId: order.payment_id ?? null,
    paidAt: order.paid_at ?? order.created_at ?? null,
    buyer: {
      name: order.guest_name ?? null,
      phone: order.guest_phone ?? null,
      address: order.guest_address ?? null,
      city: order.guest_city ?? null,
      pincode: order.guest_pincode ?? null,
    },
    shop: shop
      ? {
          name: shop.name,
          logoUrl: shop.logo_url ?? null,
          addressLine: shop.address_line ?? null,
          city: shop.city ?? null,
          district: shop.district ?? null,
          state: shop.state ?? null,
          pincode: shop.pincode ?? null,
        }
      : null,
  };
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  // Staff act through an RPC rather than an UPDATE policy, because a policy is
  // column-blind — `using (is_staff())` would also let an employee rewrite
  // `total` or clear `refunded` from the browser console. The RPC additionally
  // refuses 'rejected' and refuses to touch an order that is already delivered
  // or rejected, both of which are refund/payout territory (0086).
  if (isStaffSession()) {
    const { error } = await supabase.rpc('staff_set_order_status', { p_id: id, p_status: status });
    if (error) throw error;
    return;
  }
  const { error } = await supabase.from('orders').update({ status }).eq('id', id);
  if (error) throw error;
}

/**
 * Stamp "Packed" (migration 0063).
 *
 * Not a lifecycle status — packing sits between 'accepted' and 'shipped'
 * without changing either. It exists because the buyer's timeline has always
 * drawn a "Packed" step with nothing behind it; this is what finally gives that
 * step a real time instead of a blank.
 */
export async function markOrderPacked(id: string) {
  const { error } = await supabase
    .from('orders')
    .update({ packed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/*
 * `markCashCollected()` and `cancelCodOrder()` used to sit here — the seller
 * confirming cash at the door, and the buyer calling off an un-dispatched cash
 * order. Cash on delivery was withdrawn platform-wide (migration 0085), so
 * neither has anything to act on: every order is paid in full before it exists.
 *
 * The `cancel_cod_order` function stays in the database. Dropping it is a
 * schema change we deliberately did not make, and it is harmless — it refuses
 * any prepaid order by design, which is now every order.
 */

/**
 * Refunding lives in `src/data/admin.ts` — `refundOrder` (issues the real
 * Razorpay refund through /api/verify-payment) and `clearLegacyRefundFlag`.
 *
 * The flag-only `setOrderRefunded` that used to live here was removed with 0097.
 * It wrote `refunded = true` and nothing else, which is how the console came to
 * show "Refunded" for orders whose buyers had not been paid back.
 */

export interface OrdersQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: 'all' | 'pending' | 'shipped' | 'delivered' | 'rejected' | 'refunded';
}

/**
 * The staff half of `fetchOrdersAdminPaged`.
 *
 * PostgREST does the filtering, sorting and counting for an admin. Staff read
 * through an RPC, which returns the whole feed in one array, so the same three
 * jobs happen here instead. That is a real trade-off — it fetches every order
 * to show a page of twenty — and it is fine at the platform's current volume
 * but is the first thing to revisit when order count grows: the fix is to give
 * `staff_orders_feed()` limit/offset/search arguments, not to hand staff a
 * policy on the table.
 *
 * Search matches the same three fields as the admin path, except phone — staff
 * never receive an unmasked number, so there is nothing to match against.
 */
async function staffOrdersPaged(q: OrdersQuery): Promise<Paged<OrderWithDetails>> {
  const all = await staffOrdersFeed();

  const term = q.search?.trim().toLowerCase();
  const filtered = all.filter((o) => {
    if (q.status === 'refunded') { if (!o.refunded) return false; }
    else if (q.status && q.status !== 'all') { if (o.status !== q.status) return false; }
    if (!term) return true;
    return (
      o.order_number?.toLowerCase().includes(term) ||
      (o.guest_name ?? '').toLowerCase().includes(term) ||
      o.id === term
    );
  });

  const from = q.page * q.pageSize;
  return { rows: filtered.slice(from, from + q.pageSize), total: filtered.length };
}

export async function fetchOrdersAdminPaged(q: OrdersQuery): Promise<Paged<OrderWithDetails>> {
  if (isStaffSession()) return staffOrdersPaged(q);

  // `count` rides along with the rows, so this uses its own runner rather than
  // `selectOrders` — but it needs the identical un-migrated fallback, or the
  // admin Orders table goes blank before 0063 is applied.
  const run = (cols: string) => {
    let query = supabase.from('orders').select(cols, { count: 'exact' });

    if (q.status === 'refunded') query = query.eq('refunded', true);
    else if (q.status && q.status !== 'all') query = query.eq('status', q.status);
    const term = q.search?.trim();
    if (term) {
      // `likeValue` rather than a bare `%${term}%`: this string is spliced into
      // PostgREST's `or=(…)` grammar, which is parsed before any value is looked
      // at, so a customer named "Anitha (Salem)" or a search for "red, silk"
      // used to corrupt the whole filter list and return the wrong rows without
      // erroring. Newly reachable now that the global search and the
      // notification inbox both deep-link here with arbitrary terms.
      const v = likeValue(term);
      const filters = [`order_number.ilike.${v}`, `guest_name.ilike.${v}`, `guest_phone.ilike.${v}`];
      // An order notification in the admin console has only the order's id to
      // point at — there is no per-order admin route, so it links to this list
      // filtered by id. Guarded on the shape because `id.eq.<not-a-uuid>` is a
      // hard 22P02 that would fail the entire query.
      if (isUuid(term)) filters.push(`id.eq.${term}`);
      query = query.or(filters.join(','));
    }

    const from = q.page * q.pageSize;
    return query.order('created_at', { ascending: false }).range(from, from + q.pageSize - 1);
  };

  // Same progressive fallback as `selectOrders`, kept here because `count` has
  // to ride along with the rows.
  for (;;) {
    const { data, error, count } = await run(currentSelect());
    if (!error) return { rows: (data ?? []) as unknown as OrderWithDetails[], total: count ?? 0 };
    if (error.code !== '42703' && error.code !== '42501') throw error;
    if (!retireGroupFor(error.message)) throw error;
  }
}

export async function createOrder(input: {
  buyer_id: string;
  boutique_id: string;
  total: number;
  items: { product_id?: string; title: string; price: number; qty: number; size?: string; color?: string }[];
}) {
  // NOTE: nothing calls this. Real orders are placed by api/place-order.js,
  // which prices server-side and generates the `MM-` number there. Kept in step
  // with that prefix so it can't reintroduce `AGL-` if it ever gets wired up.
  const order_number = 'MM-' + Math.floor(1000 + Math.random() * 9000);
  const { data, error } = await supabase
    .from('orders')
    .insert({ order_number, buyer_id: input.buyer_id, boutique_id: input.boutique_id, total: input.total })
    .select()
    .single();
  if (error) throw error;
  const { error: itemsError } = await supabase.from('order_items').insert(input.items.map((it) => ({ ...it, order_id: data.id })));
  if (itemsError) throw itemsError;
  return data;
}

export interface CustomerStat {
  buyer_id: string;
  name: string;
  city: string | null;
  orders: number;
  spent: number;
  tone: number;
}

const CUSTOMER_SELECT = 'buyer_id, total, status, refunded, guest_name, guest_phone, guest_city, buyer:profiles!orders_buyer_id_fkey(full_name, city)';

type CustomerRow = {
  buyer_id: string | null;
  total: number;
  status: OrderStatus;
  refunded: boolean;
  guest_name: string | null;
  guest_phone: string | null;
  guest_city: string | null;
  buyer: { full_name: string; city: string | null } | null;
};

/**
 * Did this order actually earn money from the customer?
 *
 * Lifetime value used to sum every row, so a buyer whose orders were all
 * rejected still ranked as a top spender — one test account showed ₹29k of
 * "lifetime" spend made entirely of rejected COD orders. Only orders that
 * completed and were not refunded count towards what someone has spent.
 */
const isEarnedOrder = (r: Pick<CustomerRow, 'status' | 'refunded'>) =>
  !r.refunded && r.status !== 'rejected' && r.status !== 'cancelled';

export async function fetchCustomersForBoutique(boutiqueId: string): Promise<CustomerStat[]> {
  const { data, error } = await supabase.from('orders').select(CUSTOMER_SELECT).eq('boutique_id', boutiqueId);
  if (error) throw error;
  return aggregateCustomers((data ?? []) as unknown as CustomerRow[]);
}

export async function fetchCustomersAdmin(): Promise<CustomerStat[]> {
  // Staff get the same rows with `guest_phone` replaced by a hash of itself, so
  // anonymous orders still group into one customer without the number leaving
  // the database. `aggregateCustomers` only ever uses it as a grouping key.
  if (isStaffSession()) {
    const { data, error } = await supabase.rpc('staff_customer_rows');
    if (error) throw error;
    return aggregateCustomers((data ?? []) as unknown as CustomerRow[]);
  }
  const { data, error } = await supabase.from('orders').select(CUSTOMER_SELECT);
  if (error) throw error;
  return aggregateCustomers((data ?? []) as unknown as CustomerRow[]);
}

function aggregateCustomers(all: CustomerRow[]): CustomerStat[] {
  // Rejected, cancelled and refunded orders are not spend. They are dropped
  // before aggregation so "orders", "spent" and every average derived from them
  // describe money the platform actually took.
  const rows = all.filter(isEarnedOrder);
  const map = new Map<string, CustomerStat>();
  rows.forEach((r, i) => {
    // Registered buyers group by id; anonymous guests by phone (falling back to
    // name) so two different guests aren't merged under a null buyer_id.
    const key = r.buyer_id ?? `guest:${r.guest_phone ?? r.guest_name ?? i}`;
    const existing = map.get(key);
    if (existing) {
      existing.orders += 1;
      existing.spent += Number(r.total);
    } else {
      map.set(key, {
        buyer_id: key,
        name: r.buyer?.full_name ?? r.guest_name ?? 'Customer',
        city: r.buyer?.city ?? r.guest_city ?? null,
        orders: 1,
        spent: Number(r.total),
        tone: i % 8,
      });
    }
  });
  return [...map.values()].sort((a, b) => b.spent - a.spent);
}
