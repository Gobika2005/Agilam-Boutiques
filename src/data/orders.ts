import { supabase } from '@/lib/supabase';
import type { OrderWithDetails, OrderStatus } from './types';
import type { Paged } from './adminUsers';

const SELECT = `id, order_number, buyer_id, boutique_id, status, total, created_at, accepted_at, shipped_at, delivered_at, guest_name, guest_phone, guest_city, guest_address, guest_pincode, payment_id, refunded, channel, payment_method, payment_status, paid_at, cod_fee, shipping_fee, platform_discount, cancelled_at, cancel_reason, buyer:profiles!orders_buyer_id_fkey(full_name, phone, city), boutique:boutiques(name, tone), items:order_items(id, product_id, title, price, qty, size, color, product:products(image_url, tone))`;

export async function fetchOrdersForBuyer(buyerId: string): Promise<OrderWithDetails[]> {
  const { data, error } = await supabase.from('orders').select(SELECT).eq('buyer_id', buyerId).order('created_at', { ascending: false });
  if (error) throw error;
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
  const { data, error } = await supabase.from('orders').select(SELECT).eq('boutique_id', boutiqueId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as OrderWithDetails[];
}

export async function fetchAllOrdersAdmin(): Promise<OrderWithDetails[]> {
  const { data, error } = await supabase.from('orders').select(SELECT).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as OrderWithDetails[];
}

export async function fetchOrder(id: string): Promise<OrderWithDetails | null> {
  const { data, error } = await supabase.from('orders').select(SELECT).eq('id', id).maybeSingle();
  if (error) throw error;
  return data as unknown as OrderWithDetails | null;
}

export async function updateOrderStatus(id: string, status: OrderStatus) {
  const { error } = await supabase.from('orders').update({ status }).eq('id', id);
  if (error) throw error;
}

/**
 * Record that the seller took the cash for a COD order.
 *
 * This is the moment a COD order stops being a promise and becomes revenue, so
 * it is a deliberate seller action rather than something inferred from the
 * delivery status — an order can be handed over and the payment still disputed.
 * Migration 0022's trigger refuses this on a prepaid order, where settlement is
 * the gateway's business.
 */
export async function markCashCollected(id: string) {
  const { error } = await supabase
    .from('orders')
    .update({ payment_status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Messages the cancel RPC raises, mapped to something a buyer can act on. */
const CANCEL_ERRORS: Record<string, string> = {
  ORDER_NOT_FOUND: 'We could not find that order against this phone number.',
  NOT_CANCELLABLE_PREPAID: 'Prepaid orders cannot be cancelled here — please message the boutique.',
  NOT_CANCELLABLE_DISPATCHED: 'This order has already been dispatched. Please refuse it at the door or message the boutique.',
  NOT_CANCELLABLE_PAID: 'This order has already been paid for.',
};

/**
 * Buyer-side cancellation of an un-dispatched COD order.
 *
 * Goes through the `cancel_cod_order` SECURITY DEFINER function because a guest
 * has no account for RLS to authorise against — the order number plus the phone
 * captured at checkout is the proof of ownership. The function also releases the
 * reserved stock, so cancelling never silently eats inventory.
 */
export async function cancelCodOrder(orderNumber: string, phone: string, reason?: string) {
  const { error } = await supabase.rpc('cancel_cod_order', {
    p_order_number: orderNumber.replace(/^#/, ''),
    p_phone: phone.replace(/\D/g, ''),
    p_reason: reason ?? null,
  });
  if (error) {
    const code = Object.keys(CANCEL_ERRORS).find((k) => error.message.includes(k));
    throw new Error(code ? CANCEL_ERRORS[code] : 'Could not cancel this order. Please try again.');
  }
}

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
  let query = supabase.from('orders').select(SELECT, { count: 'exact' });

  if (q.status === 'refunded') query = query.eq('refunded', true);
  else if (q.status && q.status !== 'all') query = query.eq('status', q.status);
  if (q.search?.trim()) {
    const s = `%${q.search.trim()}%`;
    query = query.or(`order_number.ilike.${s},guest_name.ilike.${s},guest_phone.ilike.${s}`);
  }

  const from = q.page * q.pageSize;
  query = query.order('created_at', { ascending: false }).range(from, from + q.pageSize - 1);

  const { data, error, count } = await query;
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
