/**
 * Courier shipments — what was handed to whom, and how the buyer follows it.
 *
 * Deliberately fetched SEPARATELY from the order rather than embedded in
 * `src/data/orders.ts`'s SELECT. Naming a relation that does not exist yet fails
 * the *whole* query, so embedding this would take every order screen — buyer,
 * seller and admin — down on any deploy where migration 0063 has not been
 * applied. Read on its own, an un-migrated deploy simply shows no tracking.
 * Same reasoning as the counter-column fallback in `src/data/boutiques.ts`.
 */
import { supabase } from '@/lib/supabase';

export type Courier = {
  id: string;
  name: string;
  /** '{awb}' is substituted at render time. Null for couriers whose tracking
   *  page is form-POST and takes no AWB in the URL — most Indian ones. */
  tracking_url_template: string | null;
  active: boolean;
  sort_order: number;
};

export type Shipment = {
  id: string;
  order_id: string;
  boutique_id: string;
  courier_id: string | null;
  courier_name: string;
  awb: string;
  tracking_url: string | null;
  shipped_at: string;
};

const SHIPMENT_COLUMNS = 'id, order_id, boutique_id, courier_id, courier_name, awb, tracking_url, shipped_at';

/**
 * Substitute the AWB into a courier's template.
 *
 * Returns null when there is no template — which is a real answer, not a
 * failure. The tracking card then shows courier + AWB with no link, which is
 * strictly better than sending a buyer to a dead URL.
 */
export function buildTrackingUrl(template: string | null | undefined, awb: string): string | null {
  const code = awb.trim();
  if (!template || !code) return null;
  return template.replace('{awb}', encodeURIComponent(code));
}

/** The couriers a seller can pick from, in admin-defined order. */
export async function fetchCouriers(): Promise<Courier[]> {
  const { data, error } = await supabase
    .from('couriers')
    .select('id, name, tracking_url_template, active, sort_order')
    .eq('active', true)
    .order('sort_order')
    .order('name');
  if (error) throw error;
  return (data ?? []) as Courier[];
}

/** Every courier including deactivated ones — the admin console's list. */
export async function fetchAllCouriers(): Promise<Courier[]> {
  const { data, error } = await supabase
    .from('couriers')
    .select('id, name, tracking_url_template, active, sort_order')
    .order('sort_order')
    .order('name');
  if (error) throw error;
  return (data ?? []) as Courier[];
}

export async function saveCourier(
  courier: Partial<Courier> & { name: string },
): Promise<void> {
  const payload = {
    name: courier.name.trim(),
    tracking_url_template: courier.tracking_url_template?.trim() || null,
    active: courier.active ?? true,
    sort_order: courier.sort_order ?? 0,
  };
  const { error } = courier.id
    ? await supabase.from('couriers').update(payload).eq('id', courier.id)
    : await supabase.from('couriers').insert(payload);
  if (error) throw error;
}

/**
 * The shipment on one order, or null.
 *
 * Never throws on a missing table: on a deploy where 0063 has not been applied
 * the order screens must still render, just without tracking.
 */
export async function fetchShipment(orderId: string): Promise<Shipment | null> {
  const { data, error } = await supabase
    .from('shipments')
    .select(SHIPMENT_COLUMNS)
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) {
    console.error('fetchShipment failed:', error.message);
    return null;
  }
  return (data as Shipment | null) ?? null;
}

/** Shipments for a list of orders, keyed by order id — for order LISTS. */
export async function fetchShipmentsForOrders(orderIds: string[]): Promise<Record<string, Shipment>> {
  if (orderIds.length === 0) return {};
  const { data, error } = await supabase
    .from('shipments')
    .select(SHIPMENT_COLUMNS)
    .in('order_id', orderIds);
  if (error) {
    console.error('fetchShipmentsForOrders failed:', error.message);
    return {};
  }
  const byOrder: Record<string, Shipment> = {};
  for (const s of (data ?? []) as Shipment[]) byOrder[s.order_id] = s;
  return byOrder;
}

export type ShipmentInput = {
  orderId: string;
  boutiqueId: string;
  courierId: string | null;
  courierName: string;
  awb: string;
  trackingUrl: string | null;
};

/**
 * Record the parcel. Written BEFORE the order is flipped to 'shipped', because
 * migration 0063's trigger refuses that transition until this row exists.
 */
export async function createShipment(input: ShipmentInput): Promise<void> {
  const { error } = await supabase.from('shipments').insert({
    order_id: input.orderId,
    boutique_id: input.boutiqueId,
    courier_id: input.courierId,
    courier_name: input.courierName.trim(),
    awb: input.awb.trim(),
    tracking_url: input.trackingUrl?.trim() || null,
  });
  if (error) throw error;
}

/** Correct a typo'd AWB or courier. Does not re-notify the buyer. */
export async function updateShipment(
  id: string,
  patch: { courierId?: string | null; courierName?: string; awb?: string; trackingUrl?: string | null },
): Promise<void> {
  const payload: Partial<Shipment> = {};
  if (patch.courierId !== undefined) payload.courier_id = patch.courierId;
  if (patch.courierName !== undefined) payload.courier_name = patch.courierName.trim();
  if (patch.awb !== undefined) payload.awb = patch.awb.trim();
  if (patch.trackingUrl !== undefined) payload.tracking_url = patch.trackingUrl?.trim() || null;
  const { error } = await supabase.from('shipments').update(payload).eq('id', id);
  if (error) throw error;
}

/**
 * The buyer's "it never arrived" report.
 *
 * Goes through the `report_delivery_issue` RPC rather than an UPDATE: `orders`
 * has no buyer update policy and must not get one — a broad grant would let a
 * buyer edit status or total. The RPC verifies ownership and writes only the
 * dispute columns. Setting the flag takes the order out of the payout sweep.
 */
export async function reportDeliveryIssue(orderId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('report_delivery_issue', {
    p_order_id: orderId,
    p_note: note?.trim() || null,
  });
  if (error) throw error;
}

/* ── Admin ─────────────────────────────────────────────────────────────────
 * These read the tracking columns unconditionally rather than falling back the
 * way `src/data/orders.ts` does: the pages that call them exist only to
 * administer migration 0063, so failing loudly before it is applied is the
 * honest outcome.
 */

export type DeliveryIssueRow = {
  id: string;
  order_number: string;
  boutique_id: string;
  status: string;
  total: number;
  delivered_at: string | null;
  delivery_disputed_at: string | null;
  delivery_dispute_note: string | null;
  payout_id: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  boutique: { name: string } | null;
};

const ISSUE_COLUMNS =
  'id, order_number, boutique_id, status, total, delivered_at, delivery_disputed_at, delivery_dispute_note, payout_id, guest_name, guest_phone, boutique:boutiques(name)';

/** Delivered orders the buyer says never arrived. Payouts are frozen on these. */
export async function fetchDeliveryDisputes(): Promise<DeliveryIssueRow[]> {
  const { data, error } = await supabase
    .from('orders')
    .select(ISSUE_COLUMNS)
    .eq('delivery_disputed', true)
    .order('delivery_disputed_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as DeliveryIssueRow[];
}

/**
 * Close a dispute. Only an admin can — migration 0063's guard trigger silently
 * reverts a seller who tries, so this is the sole way the flag comes off and
 * the order becomes payable again.
 */
export async function resolveDeliveryDispute(orderId: string): Promise<void> {
  const { error } = await supabase
    .from('orders')
    .update({ delivery_disputed: false, delivery_resolved_at: new Date().toISOString() })
    .eq('id', orderId);
  if (error) throw error;
}

export type StalledShipmentRow = {
  id: string;
  order_number: string;
  boutique_id: string;
  shipped_at: string | null;
  total: number;
  boutique: { name: string } | null;
};

/**
 * Parcels dispatched a while ago that nobody has marked delivered.
 *
 * Not fraud — a seller who never marks delivered strands their OWN money, since
 * the payout keys off that transition. But it rots silently, which is why it
 * needs a surface.
 */
export async function fetchStalledShipments(days = 10): Promise<StalledShipmentRow[]> {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, boutique_id, shipped_at, total, boutique:boutiques(name)')
    .eq('status', 'shipped')
    .not('shipped_at', 'is', null)
    .lte('shipped_at', cutoff)
    .order('shipped_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as StalledShipmentRow[];
}
