import { supabase } from '@/lib/supabase';
import { likeValue, isUuid } from '@/lib/search/query';
import type { OrderWithDetails, OrderStatus } from './types';
import type { Paged } from './adminUsers';

const BASE_SELECT = `id, order_number, buyer_id, boutique_id, status, total, created_at, accepted_at, shipped_at, delivered_at, guest_name, guest_phone, guest_city, guest_address, guest_pincode, payment_id, refunded, channel, payment_method, payment_status, paid_at, cod_fee, shipping_fee, platform_discount, cancelled_at, cancel_reason, buyer:profiles!orders_buyer_id_fkey(full_name, phone, city), boutique:boutiques(name, tone), items:order_items(id, product_id, title, price, qty, size, color, product:products(image_url, tone))`;

/**
 * Courier-tracking columns from migration 0063. Split out for the same reason
 * as the sales counters in `src/data/boutiques.ts`: naming a column that does
 * not exist yet fails the WHOLE query, and this SELECT feeds every order screen
 * in all three consoles. An un-migrated deploy must lose the tracking detail,
 * not the orders.
 */
const TRACKING_COLUMNS = 'packed_at, out_for_delivery_at, delivery_disputed, delivery_disputed_at';

const SELECT = `${BASE_SELECT}, ${TRACKING_COLUMNS}`;

let trackingAvailable = true;

async function selectOrders<T>(
  run: (columns: string) => PromiseLike<{ data: T; error: { message?: string; code?: string } | null }>,
): Promise<T> {
  if (trackingAvailable) {
    const { data, error } = await run(SELECT);
    if (!error) return data;
    // 42703 = undefined_column, 42501 = insufficient_privilege (not granted).
    if (error.code !== '42703' && error.code !== '42501') throw error;
    trackingAvailable = false;
    console.warn('[orders] courier tracking columns unavailable — apply migration 0063.');
  }
  const { data, error } = await run(BASE_SELECT);
  if (error) throw error;
  return data;
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

export async function fetchAllOrdersAdmin(): Promise<OrderWithDetails[]> {
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

export async function updateOrderStatus(id: string, status: OrderStatus) {
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

/** Flag/unflag an order as refunded (independent of the fulfilment status). */
export async function setOrderRefunded(id: string, refunded: boolean) {
  const { error } = await supabase
    .from('orders')
    .update({ refunded, refunded_at: refunded ? new Date().toISOString() : null })
    .eq('id', id);
  if (error) throw error;
}

export interface OrdersQuery {
  page: number;
  pageSize: number;
  search?: string;
  status?: 'all' | 'pending' | 'shipped' | 'delivered' | 'rejected' | 'refunded';
}

export async function fetchOrdersAdminPaged(q: OrdersQuery): Promise<Paged<OrderWithDetails>> {
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

  if (trackingAvailable) {
    const { data, error, count } = await run(SELECT);
    if (!error) return { rows: (data ?? []) as unknown as OrderWithDetails[], total: count ?? 0 };
    if (error.code !== '42703' && error.code !== '42501') throw error;
    trackingAvailable = false;
    console.warn('[orders] courier tracking columns unavailable — apply migration 0063.');
  }
  const { data, error, count } = await run(BASE_SELECT);
  if (error) throw error;
  return { rows: (data ?? []) as unknown as OrderWithDetails[], total: count ?? 0 };
}

export async function createOrder(input: {
  buyer_id: string;
  boutique_id: string;
  total: number;
  items: { product_id?: string; title: string; price: number; qty: number; size?: string; color?: string }[];
}) {
  const order_number = 'AGL-' + Math.floor(1000 + Math.random() * 9000);
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
