/**
 * The buyer's own order history, held in memory for the current visit.
 *
 * Ordering requires an account, so the authoritative copy of an order lives in
 * Supabase and is read back through the `buyer_id` RLS policy (see
 * data/orders.ts). This mirror exists for the seconds either side of that: the
 * just-placed order shows on "My orders" and the tracker immediately, without
 * waiting on a round-trip, and it still carries the orders of anyone who
 * checked out before the sign-in requirement (those rows have a null `buyer_id`
 * and RLS will never hand them back). It is not persisted — a refresh falls
 * through to the account's DB-backed orders, which are the source of truth.
 */

export type { OrderStatus } from '@/types/database';
import type { OrderStatus, PaymentStatus } from '@/types/database';

export type PlacedOrderItem = {
  pid: string;
  title: string;
  tone: number;
  qty: number;
  size: string;
  price: number;
};

export type PlacedOrder = {
  /** Display id, e.g. `#AGL-1234567`. */
  id: string;
  /**
   * The `orders` row's uuid. Deep links built from a DB id — notably an order
   * notification, whose only handle on the order is `notifications.order_id` —
   * arrive as `/orders/<uuid>`, which matches neither `id` nor
   * `orderNumber`, so the tracking screen answered "Order not found". Absent on
   * a guest's locally-mirrored order until it is read back from the server.
   */
  rowId?: string;
  orderNumber: string;
  /** ISO timestamp of when the order was placed. */
  placedAt: string;
  boutique: string;
  boutiqueId: string;
  status: OrderStatus;
  total: number;
  items: PlacedOrderItem[];
  /** 'COD' or 'Razorpay'. Absent on orders placed before COD existed. */
  paymentMethod?: string | null;
  paymentStatus?: PaymentStatus;
  /** COD handling fee on this delivery, already included in `total`. */
  codFee?: number;
  /** Delivery fee on this order, already included in `total`. */
  shippingFee?: number;
  /** Platform coupon taken off this order, already deducted from `total`. */
  platformDiscount?: number;
  /** When the boutique moved this order into each stage (migration 0042). Absent
   *  on a guest's locally-mirrored order until it's read back from the server. */
  acceptedAt?: string | null;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  /** Migration 0063 — the two timeline stages that never had a source. */
  packedAt?: string | null;
  outForDeliveryAt?: string | null;
  /** The buyer reported it never arrived; the seller's payout is frozen. */
  deliveryDisputed?: boolean;
};

let orderState: PlacedOrder[] = [];

/**
 * Timeline stage (index into demo `TRACK_STAGES`) each status maps to.
 *
 * `pending` sits on "Order Placed" rather than "Confirmed": now that a seller
 * explicitly accepts an order, claiming it is confirmed before they have looked
 * at it would be telling the buyer something that has not happened.
 */
export const STATUS_STAGE: Record<OrderStatus, number> = {
  pending: 0,
  accepted: 1,
  shipped: 3,
  delivered: 5,
  rejected: 0,
  cancelled: 0,
};

/** True while a COD order can still be called off from the buyer's side. */
export function isCancellable(o: PlacedOrder): boolean {
  return (
    o.paymentMethod === 'COD' &&
    (o.paymentStatus ?? 'pending') === 'pending' &&
    (o.status === 'pending' || o.status === 'accepted')
  );
}

export function readOrders(): PlacedOrder[] {
  return orderState;
}

/** Prepend newly-placed orders (newest first). Returns the full list. */
export function addOrders(orders: PlacedOrder[]): PlacedOrder[] {
  orderState = [...orders, ...orderState];
  return orderState;
}

/**
 * Patch one locally-mirrored order in place.
 *
 * A guest's orders are never readable back from Supabase, so after an action
 * that changes one server-side — cancelling a COD order — this is the only way
 * the change reaches their screen.
 */
export function patchLocalOrder(orderNumber: string, patch: Partial<PlacedOrder>): PlacedOrder[] {
  orderState = orderState.map((o) => (o.orderNumber === orderNumber ? { ...o, ...patch } : o));
  return orderState;
}

export function findOrder(id: string | undefined): PlacedOrder | undefined {
  if (!id) return undefined;
  return readOrders().find((o) => o.id === id || o.orderNumber === id);
}

/** A signed-in buyer's order as read back via RLS (see data/orders.ts). */
export type BuyerDbOrder = {
  id: string;
  order_number: string;
  boutique_id: string;
  status: OrderStatus;
  total: number;
  created_at: string;
  accepted_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  packed_at?: string | null;
  out_for_delivery_at?: string | null;
  delivery_disputed?: boolean;
  payment_method?: string | null;
  payment_status?: PaymentStatus;
  cod_fee?: number;
  shipping_fee?: number;
  platform_discount?: number;
  boutique: { name: string; tone: number } | null;
  items: { product_id?: string | null; title: string; price: number; qty: number; size: string | null }[];
};

/** Map a signed-in buyer's DB order onto the local PlacedOrder shape. */
export function fromBuyerOrder(o: BuyerDbOrder): PlacedOrder {
  const tone = o.boutique?.tone ?? 0;
  const codFee = Number(o.cod_fee ?? 0);
  const shippingFee = Number(o.shipping_fee ?? 0);
  // A platform coupon never reduces `orders.total` — the seller is paid the full
  // goods value and we fund the discount — so it has to come off here instead,
  // or the buyer is shown (and, paying cash, asked for) more than they owe.
  const platformDiscount = Number(o.platform_discount ?? 0);
  return {
    id: '#' + o.order_number,
    rowId: o.id,
    orderNumber: o.order_number,
    placedAt: o.created_at,
    boutique: o.boutique?.name ?? 'Boutique',
    boutiqueId: o.boutique_id,
    status: o.status,
    // `orders.total` is the goods value; delivery and the COD fee are stored
    // beside it, so add them back to show the figure the buyer actually pays.
    total: Math.max(0, Number(o.total) + shippingFee + codFee - platformDiscount),
    paymentMethod: o.payment_method ?? null,
    paymentStatus: o.payment_status ?? 'paid',
    codFee,
    shippingFee,
    platformDiscount,
    acceptedAt: o.accepted_at ?? null,
    shippedAt: o.shipped_at ?? null,
    deliveredAt: o.delivered_at ?? null,
    packedAt: o.packed_at ?? null,
    outForDeliveryAt: o.out_for_delivery_at ?? null,
    deliveryDisputed: o.delivery_disputed ?? false,
    // `pid` is what the order screens look the product photo up by, so it has to
    // survive the round-trip through the server copy — without it every line
    // falls back to the empty placeholder tile.
    items: (o.items ?? []).map((it) => ({ pid: it.product_id ?? '', title: it.title, tone, qty: it.qty, size: it.size ?? '', price: Number(it.price) })),
  };
}

/**
 * Merge server orders (source of truth) with any locally-stored ones, de-duped
 * by order number, newest first, and persist. Server rows win on conflict since
 * they carry the up-to-date status. Returns the merged list.
 */
export function mergeServerOrders(serverOrders: PlacedOrder[]): PlacedOrder[] {
  const byNumber = new Map<string, PlacedOrder>();
  for (const o of readOrders()) byNumber.set(o.orderNumber, o);
  for (const o of serverOrders) byNumber.set(o.orderNumber, o);
  const merged = [...byNumber.values()].sort(
    (a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime(),
  );
  orderState = merged;
  return merged;
}

/**
 * Human-readable delivery estimate for an order that hasn't arrived yet.
 * Derived from when it was placed — the boutiques dispatch in 1–2 working days
 * and our partners quote 3–7 after that, so this is the honest outer edge.
 */
export function deliveryEstimate(placedAt: string): string {
  const d = new Date(placedAt);
  if (Number.isNaN(d.getTime())) return '';
  const from = new Date(d.getTime() + 4 * 86400000);
  const to = new Date(d.getTime() + 9 * 86400000);
  const fmtDay = (x: Date) => x.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${fmtDay(from)} – ${fmtDay(to)}`;
}

/** "19 Jul 2026" for order cards. */
export function formatOrderDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "19 Jul, 4:32 pm" — date and time together, for a tracking milestone. */
export function formatOrderDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}
