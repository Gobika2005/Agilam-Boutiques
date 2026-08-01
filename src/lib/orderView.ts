import type { OrderWithDetails } from '@/data/types';

/**
 * Display shape the seller/admin order screens were built against (they came
 * from the demo `SellerOrder` records). `toOrderView` maps a live
 * `OrderWithDetails` row onto it so those screens render database orders.
 */
export type OrderView = {
  id: string;       // real uuid — used for routing and fetching
  number: string;   // '#AGL-2481' for display
  customer: string;
  city: string | null;
  phone: string | null;
  /** Street address to ship to — the seller can't fulfil the order without it. */
  address: string | null;
  /** 6-digit delivery pincode — the courier can't route the parcel without it. */
  pincode: string | null;
  item: string;     // first item title (+ "+N more")
  color: string | null;
  size: string | null;
  qty: number;
  amount: number;
  status: string;   // Capitalised, for statusStyle()
  rawStatus: OrderWithDetails['status'];
  date: string;     // '15 Jul'
  tone: number;
  items: OrderWithDetails['items'];
  channel: 'online' | 'offline';
  paymentMethod: string | null;
  /** True when the money is still to be collected at the door. */
  isCod: boolean;
  /** Cash still owed on this order — 0 once collected, or on a prepaid order. */
  collectAmount: number;
  codFee: number;
  shippingFee: number;
  /**
   * Platform-funded coupon discount on this order (migration 0053). The seller
   * is still settled on the full goods value, so this is shown to explain why
   * the buyer pays less than goods + delivery + handling.
   */
  platformDiscount: number;
  /** Goods + delivery + cash handling − any platform coupon: what the buyer
   *  actually pays, and so exactly what is collected at a COD door. */
  grandTotal: number;
  paymentStatus: NonNullable<OrderWithDetails['payment_status']>;
  cancelReason: string | null;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

export function toOrderView(o: OrderWithDetails, i = 0): OrderView {
  const items = o.items ?? [];
  const first = items[0];
  const qty = items.reduce((s, it) => s + it.qty, 0) || 1;
  const extra = items.length > 1 ? ` +${items.length - 1} more` : '';
  // Orders written before migration 0022 have no payment_status and were all
  // prepaid, so absence means settled rather than outstanding.
  const paymentStatus = o.payment_status ?? 'paid';
  const codFee = Number(o.cod_fee ?? 0);
  const shippingFee = Number(o.shipping_fee ?? 0);
  const isCod = o.payment_method === 'COD';
  // A platform coupon is funded by us and so never lands in `total` (the seller
  // is paid in full), but the buyer genuinely does not owe it — leaving it out
  // here is what used to make a cash order ask for the undiscounted amount at
  // the door. See migration 0053.
  const platformDiscount = Number(o.platform_discount ?? 0);
  const grandTotal = Math.max(0, Number(o.total) + shippingFee + codFee - platformDiscount);
  // A cancelled or rejected order is never collected against: nobody is at the
  // door and no cash changes hands. Without this the order still counted toward
  // the seller's outstanding cash — the Orders banner and the "To collect" tab
  // listed it, and printInvoice told the buyer to pay on delivery — while the
  // dashboard tile (which filters these itself) disagreed and showed ₹0.
  const collectable = o.status !== 'cancelled' && o.status !== 'rejected';
  return {
    id: o.id,
    number: '#' + o.order_number,
    // Guest orders (anonymous buyers) carry their details on the order itself.
    customer: o.buyer?.full_name ?? o.guest_name ?? 'Customer',
    city: o.buyer?.city ?? o.guest_city ?? null,
    phone: o.buyer?.phone ?? o.guest_phone ?? null,
    address: o.guest_address ?? null,
    pincode: o.guest_pincode ?? null,
    item: (first?.title ?? 'Item') + extra,
    color: first?.color ?? null,
    size: first?.size ?? null,
    qty,
    amount: Number(o.total),
    status: cap(o.status),
    rawStatus: o.status,
    date: fmtDate(o.created_at),
    tone: (o.boutique?.tone ?? i) % 8,
    items,
    channel: o.channel ?? 'online',
    paymentMethod: o.payment_method ?? null,
    isCod,
    // Goods, delivery and the handling fee — the single figure the seller
    // counts out at the door. Zero once collected, so the UI never asks twice.
    collectAmount: isCod && paymentStatus === 'pending' && collectable ? grandTotal : 0,
    codFee,
    shippingFee,
    platformDiscount,
    grandTotal,
    paymentStatus,
    cancelReason: o.cancel_reason ?? null,
  };
}
