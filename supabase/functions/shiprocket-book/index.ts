/**
 * Book one order as a Shiprocket parcel, and ship it.
 *
 * Called by the seller console (`bookShiprocketShipment` in src/data/shipments.ts)
 * with the seller's own session JWT. Four Shiprocket calls, in order:
 *
 *   1. orders/create/adhoc     → their order + shipment ids
 *   2. courier/assign/awb      → the AWB and the courier that won the rate
 *   3. courier/generate/label  → a printable label (best-effort)
 *   4. courier/generate/pickup → ask the courier to come (best-effort)
 *
 * Then we write the `shipments` row and flip the order to 'shipped'. That order
 * is not arbitrary: migration 0063's trg_orders_require_shipment refuses the
 * 'shipped' transition until the shipment row exists.
 *
 * WHAT THIS REFUSES, AND WHY
 *   • COD orders. Shiprocket's COD remittance pays the wallet holder — us —
 *     which would make the platform the money handler and break the model in
 *     migration 0022 (seller keeps the cash, owes the commission). Refused here
 *     AND by trg_shipments_reject_cod, because the UI is not the boundary.
 *   • Orders already shipped. Double-booking means two parcels and two freight
 *     charges against the wallet for one sale.
 *
 * Steps 3 and 4 are best-effort on purpose. Once the AWB exists the parcel is
 * real and the buyer can track it; failing the whole booking because a label PDF
 * did not render would strand an order that Shiprocket already accepted, and the
 * seller would have no way to retry without double-booking.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  CORS, SrError, getToken, json, serviceClient, srFetch, stateForPincode,
} from '../_shared/shiprocket.ts';

type OrderRow = {
  id: string;
  order_number: string;
  boutique_id: string;
  status: string;
  total: number;
  payment_method: string | null;
  created_at: string;
  guest_name: string | null;
  guest_phone: string | null;
  guest_city: string | null;
  guest_address: string | null;
  guest_pincode: string | null;
  buyer_id: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { orderId } = await req.json().catch(() => ({ orderId: null }));
    if (!orderId) return json({ error: 'orderId is required' }, 400);

    // ── Who is asking ───────────────────────────────────────────────────────
    // The JWT is verified by Supabase, not by us parsing it. A user-scoped
    // client is also what calls order_parcel_metrics below: that RPC checks
    // ownership through auth.uid(), which is null under the service role, so
    // calling it with the service key would fail its own guard.
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return json({ error: 'Not signed in' }, 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: 'Not signed in' }, 401);

    const db = serviceClient();

    // ── Is the integration on at all ────────────────────────────────────────
    const { data: settings } = await db
      .from('platform_settings')
      .select('shiprocket_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (!settings?.shiprocket_enabled) {
      return json({ error: 'Shiprocket booking is switched off for this platform' }, 409);
    }

    // ── The order ───────────────────────────────────────────────────────────
    const { data: order, error: orderErr } = await db
      .from('orders')
      .select('id, order_number, boutique_id, status, total, payment_method, created_at, guest_name, guest_phone, guest_city, guest_address, guest_pincode, buyer_id')
      .eq('id', orderId)
      .maybeSingle<OrderRow>();
    if (orderErr || !order) return json({ error: 'Order not found' }, 404);

    if (order.payment_method === 'COD') {
      return json({
        error: 'Cash-on-delivery orders cannot be booked through Shiprocket. Ship this one with your own courier and enter the docket number.',
      }, 409);
    }
    if (order.status === 'shipped' || order.status === 'delivered') {
      return json({ error: 'This order has already been shipped' }, 409);
    }
    if (order.status === 'cancelled' || order.status === 'rejected') {
      return json({ error: 'This order is closed' }, 409);
    }

    const { data: existing } = await db
      .from('shipments').select('id').eq('order_id', order.id).maybeSingle();
    if (existing) return json({ error: 'This order already has a parcel recorded' }, 409);

    // ── The shop, and that it belongs to the caller ─────────────────────────
    // `boutiques` cannot be read with select('*') — column grants since 0021.
    const { data: shop } = await db
      .from('boutiques')
      .select('id, name, owner_id, phone, address_line, district, state, pincode, shiprocket_pickup_location, shiprocket_enabled')
      .eq('id', order.boutique_id)
      .maybeSingle();
    if (!shop) return json({ error: 'Boutique not found' }, 404);
    if (shop.owner_id !== user.id) return json({ error: 'Not your order' }, 403);
    if (!shop.shiprocket_enabled || !shop.shiprocket_pickup_location) {
      return json({
        error: 'This shop has no Shiprocket pickup location yet. An admin registers it before you can book.',
      }, 409);
    }

    // ── Where it is going ───────────────────────────────────────────────────
    // A signed-in buyer's address still lands on the guest_* columns at
    // checkout, so this reads the same fields either way.
    const pincode = (order.guest_pincode ?? '').trim();
    const address = (order.guest_address ?? '').trim();
    if (!pincode || !address) {
      return json({ error: 'This order has no delivery address or pincode — it cannot be booked.' }, 422);
    }

    const { data: items } = await db
      .from('order_items')
      .select('title, price, qty, product_id')
      .eq('order_id', order.id);
    if (!items?.length) return json({ error: 'This order has no items' }, 422);

    // ── The parcel ──────────────────────────────────────────────────────────
    // Migration 0065. Product weights with a per-shop fallback, resolved in one
    // place so this function does not reimplement the fallback chain.
    const { data: metrics, error: metricsErr } = await userClient
      .rpc('order_parcel_metrics', { p_order_id: order.id })
      .maybeSingle<{ weight_kg: number; length_cm: number; breadth_cm: number; height_cm: number; is_estimated: boolean }>();
    if (metricsErr || !metrics) {
      return json({ error: metricsErr?.message ?? 'Could not work out the parcel weight' }, 422);
    }

    const token = await getToken(db);

    // Shiprocket rejects an order whose state disagrees with its pincode, and
    // checkout never collected one. Ask them rather than guess.
    const state = await stateForPincode(token, pincode);
    if (!state) {
      return json({ error: `Shiprocket does not recognise pincode ${pincode}. Check the delivery address.` }, 422);
    }

    const buyerName = (order.guest_name ?? '').trim() || 'Customer';
    const [firstName, ...restName] = buyerName.split(/\s+/);

    // ── 1. Create the order ─────────────────────────────────────────────────
    const created = await srFetch<{ order_id: number; shipment_id: number }>(token, '/orders/create/adhoc', {
      method: 'POST',
      body: {
        order_id: order.order_number,
        order_date: order.created_at.slice(0, 16).replace('T', ' '),
        pickup_location: shop.shiprocket_pickup_location,
        billing_customer_name: firstName,
        // Their API requires a last name field; a single-word name is common and
        // must not fail validation, so it falls back to the first name.
        billing_last_name: restName.join(' ') || firstName,
        billing_address: address,
        billing_city: (order.guest_city ?? '').trim() || state,
        billing_pincode: pincode,
        billing_state: state,
        billing_country: 'India',
        // Guest checkout collects a phone and never an email (see place-order).
        // Shiprocket requires the field, so it goes out empty rather than
        // fabricated — a made-up address would bounce their notification mail
        // and could get the account flagged.
        billing_email: '',
        billing_phone: (order.guest_phone ?? '').replace(/\D/g, '').slice(-10),
        shipping_is_billing: true,
        order_items: items.map((it) => ({
          name: it.title,
          sku: it.product_id ?? it.title.slice(0, 40),
          units: it.qty,
          selling_price: it.price,
        })),
        payment_method: 'Prepaid',
        sub_total: order.total,
        length: metrics.length_cm,
        breadth: metrics.breadth_cm,
        height: metrics.height_cm,
        weight: metrics.weight_kg,
      },
    });

    if (!created?.shipment_id) {
      return json({ error: 'Shiprocket accepted the order but returned no shipment id' }, 502);
    }

    // ── 2. Assign an AWB ────────────────────────────────────────────────────
    // This is the step that picks the courier and commits the freight charge.
    const awbRes = await srFetch<{
      response?: { data?: { awb_code?: string; courier_name?: string; freight_charges?: number } };
    }>(token, '/courier/assign/awb', {
      method: 'POST',
      body: { shipment_id: created.shipment_id },
    });

    const awb = awbRes?.response?.data?.awb_code;
    const courierName = awbRes?.response?.data?.courier_name ?? 'Shiprocket';
    const freight = awbRes?.response?.data?.freight_charges ?? null;

    if (!awb) {
      // Their order exists but nothing is carrying it. Surfaced plainly: the
      // usual cause is an empty wallet or no courier serving that pincode.
      return json({
        error: 'Shiprocket could not assign a courier. Check the wallet balance and that the destination pincode is serviceable.',
      }, 502);
    }

    // ── 3 & 4. Label and pickup — best-effort ───────────────────────────────
    let labelUrl: string | null = null;
    try {
      const label = await srFetch<{ label_url?: string }>(token, '/courier/generate/label', {
        method: 'POST',
        body: { shipment_id: [created.shipment_id] },
      });
      labelUrl = label?.label_url ?? null;
    } catch (_e) {
      // A missing label costs the seller a click in the Shiprocket panel. It
      // does not invalidate a parcel that already has an AWB.
    }

    try {
      await srFetch(token, '/courier/generate/pickup', {
        method: 'POST',
        body: { shipment_id: [created.shipment_id] },
      });
    } catch (_e) {
      // Pickup can be requested later from their panel; some couriers schedule
      // it automatically. Never worth failing a booked parcel over.
    }

    // ── Record it, then ship it ─────────────────────────────────────────────
    const { error: shipErr } = await db.from('shipments').insert({
      order_id: order.id,
      boutique_id: order.boutique_id,
      courier_id: null,
      courier_name: courierName,
      awb,
      tracking_url: `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`,
      provider: 'shiprocket',
      sr_order_id: String(created.order_id ?? ''),
      sr_shipment_id: String(created.shipment_id),
      sr_courier_name: courierName,
      label_url: labelUrl,
      freight_charge: freight,
      declared_weight_kg: metrics.weight_kg,
      created_by: user.id,
    });
    if (shipErr) {
      // The parcel is booked with Shiprocket but unknown to us — the one state
      // that needs a human, because a retry would book it twice.
      console.error('shipment insert failed after booking', { awb, error: shipErr.message });
      return json({
        error: `The parcel was booked (AWB ${awb}) but could not be saved. Do NOT book again — send this AWB to support.`,
      }, 500);
    }

    const { error: statusErr } = await db
      .from('orders').update({ status: 'shipped' }).eq('id', order.id);
    if (statusErr) {
      return json({
        error: `Parcel booked (AWB ${awb}) but the order status did not update: ${statusErr.message}`,
      }, 500);
    }

    return json({
      ok: true,
      awb,
      courierName,
      labelUrl,
      freightCharge: freight,
      weightKg: metrics.weight_kg,
      weightEstimated: metrics.is_estimated,
    });
  } catch (e) {
    if (e instanceof SrError) {
      console.error('shiprocket-book SrError', e.status, e.message, e.body);
      return json({ error: e.message }, e.status >= 500 ? 502 : e.status);
    }
    console.error('shiprocket-book failed', e);
    return json({ error: e instanceof Error ? e.message : 'Booking failed' }, 500);
  }
});
