import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { serviceClient } from './_supabase.js';
import { computeCartPricing, loadCoupon, redeemCoupon } from './_pricing.js';
import { loadTerms } from './_settings.js';
import { enforceRateLimit } from './_rateLimit.js';

/**
 * Vercel serverless function: create the real order(s) for a guest checkout.
 *
 * Buyers browse without an account, so orders are written here with the Supabase
 * service role (bypasses RLS) instead of from the anonymous browser client. The
 * server is the source of truth for prices and boutique ownership: the client
 * only sends product ids + quantities, and we look up the authoritative title,
 * price and boutique from the products table. A cart can span several
 * boutiques, so it is split into one order per boutique — that is what makes
 * each seller see only their own items.
 *
 * For online payments we re-verify the Razorpay signature here (the same HMAC
 * as verify-payment.js) so an order can't be forged without a genuine payment.
 *
 * Cash on Delivery is the one path that writes an order with no payment behind
 * it, so it is guarded on its own terms instead: every boutique in the cart
 * must have COD switched on, the cart must be under COD_MAX_ORDER, and a real
 * name/phone/address must be present — without those, an unpaid order is just a
 * way to burn a seller's stock. Everything else (server pricing, stock
 * reservation, the per-boutique split) is shared with the prepaid path.
 */

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function verifySignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  if (!keySecret || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return false;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(razorpay_signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function orderNumber() {
  // Time component keeps numbers roughly sortable; 4 hex chars of CSPRNG entropy
  // make same-millisecond collisions vanishingly unlikely. The DB `unique`
  // constraint on order_number remains the final guard.
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `AGL-${ts}${rand}`;
}

/**
 * How many un-collected COD orders one phone number may have in flight.
 *
 * A cash order costs the buyer nothing up front but locks up a seller's stock,
 * so this is the brake on someone placing a dozen and never answering the door.
 * Generous enough that a real household ordering for a wedding is unaffected.
 */
const MAX_OPEN_COD_ORDERS = 3;

// Auto-refund a captured payment we've decided not to fulfil (wrong amount, or
// stock sold out between pay and placement). A failed refund must never crash
// order handling — it's logged for manual follow-up instead.
async function refundPayment(razorpay, paymentId, amountPaise) {
  if (!razorpay || !paymentId || !(amountPaise > 0)) return;
  try {
    await razorpay.payments.refund(paymentId, { amount: amountPaise, speed: 'optimum' });
  } catch (e) {
    console.error('place-order: auto-refund failed for', paymentId, e?.error ?? e);
  }
}

/**
 * Drop a "New order" notification into each seller's inbox (the bell on
 * /seller/notifications). One row per boutique order, addressed to the
 * boutique's owner profile.
 *
 * Written with the service role because the buyer is anonymous and could never
 * satisfy an RLS insert policy on someone else's notifications. Entirely
 * best-effort: the order is already placed and paid for by the time this runs,
 * so a failure here is logged, never surfaced.
 */
async function notifySellers(supabase, created, guestFields) {
  try {
    const boutiqueIds = [...new Set(created.map((o) => o.boutique_id))];
    const { data: boutiques, error } = await supabase
      .from('boutiques')
      .select('id, owner_id')
      .in('id', boutiqueIds);
    if (error) throw error;

    const ownerById = new Map((boutiques ?? []).map((b) => [b.id, b.owner_id]));
    const rows = [];
    for (const order of created) {
      const ownerId = ownerById.get(order.boutique_id);
      if (!ownerId) continue;
      const units = order.lines.reduce((sum, l) => sum + l.qty, 0);
      const first = order.lines[0];
      const rest = order.lines.length > 1 ? ` +${order.lines.length - 1} more` : '';
      const buyer = guestFields.guest_name || 'A customer';
      const isCodOrder = guestFields.payment_method === 'COD';
      // The seller's next action differs completely between the two: a prepaid
      // order just ships, a COD order means counting cash at the door. Say which.
      const money = isCodOrder
        ? `Collect ₹${Math.round(order.total + (order.shipping_fee ?? 0) + (order.cod_fee ?? 0))} in cash on delivery.`
        : 'Paid online.';
      rows.push({
        profile_id: ownerId,
        type: 'Orders',
        title: `${isCodOrder ? 'New COD order' : 'New order'} ${order.order_number} · ₹${Math.round(order.total)}`,
        body: `${buyer} ordered ${units} item${units === 1 ? '' : 's'} — ${first?.title ?? 'Item'}${rest}. ${money}`,
        order_id: order.id,
      });
    }
    if (rows.length === 0) return;

    const { error: insErr } = await supabase.from('notifications').insert(rows);
    if (insErr) throw insErr;
  } catch (err) {
    console.error('place-order: seller notification failed (order still placed):', err?.message ?? err);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(req, res, { key: 'place-order', limit: 20, windowMs: 60_000 }))) return;

  // Built before anything else touches the network: a misconfigured environment
  // must fail here, with a diagnosable message, rather than after the buyer's
  // card has been charged.
  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) {
    console.error('place-order: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing or blank');
    return res.status(500).json({ error: 'Order service is not configured (missing Supabase service role)' });
  }

  const { items, guest, payment, couponCode, paymentMethod } = req.body ?? {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  // COD is opt-in per request and never inferred from a missing payment: a
  // prepaid checkout that loses its payment object must still fail closed
  // rather than quietly becoming an unpaid order.
  const isCod = paymentMethod === 'COD';

  if (!isCod) {
    if (!payment) {
      return res.status(400).json({ error: 'Payment is required to place an order' });
    }
    if (!verifySignature(payment)) {
      return res.status(400).json({ error: 'Payment could not be verified' });
    }
  } else {
    // Nobody delivers cash to a blank address. These are the seller's only
    // means of completing the order, so they are required rather than optional.
    const name = String(guest?.name ?? '').trim();
    const phone = String(guest?.phone ?? '').replace(/\D/g, '');
    const address = String(guest?.address ?? '').trim();
    const pincode = String(guest?.pincode ?? '').replace(/\D/g, '');
    if (name.length < 2 || !/^[6-9]\d{9}$/.test(phone) || address.length < 10 || !/^[1-9]\d{5}$/.test(pincode)) {
      return res.status(400).json({
        error: 'Cash on delivery needs your name, a valid 10-digit mobile number, a full delivery address and a 6-digit pincode.',
      });
    }
  }

  // One Razorpay client, reused for order lookup (amount binding) and any
  // auto-refund. Null when the keys aren't configured.
  const razorpay = keyId && keySecret ? new Razorpay({ key_id: keyId, key_secret: keySecret }) : null;

  // Replay guard: a genuine online payment maps to exactly one order-set. Without
  // this, replaying the same verified {order_id, payment_id, signature} to this
  // endpoint would mint unlimited orders from a single payment. The multi-boutique
  // split still shares one payment_id across the rows created in THIS request —
  // we only reject a payment_id that already exists from a PRIOR request.
  //
  // COD has no payment id to replay. Its equivalent abuse — spamming unpaid
  // orders — is bounded by the rate limiter above and by the open-COD-order
  // check further down, not here.
  if (!isCod) {
    const { data: dup, error: dupErr } = await supabase
      .from('orders')
      .select('id')
      .eq('payment_id', payment.razorpay_payment_id)
      .limit(1)
      .maybeSingle();
    if (dupErr) {
      console.error('place-order replay check failed:', dupErr?.message ?? dupErr);
      return res.status(500).json({ error: 'Could not place the order. Please try again.' });
    }
    if (dup) {
      return res.status(409).json({ error: 'This payment has already been used for an order.' });
    }
  }

  // A signed-in buyer (Google / email) sends their access token; tie the order
  // to their account so they can read it back cross-device via RLS. Guests
  // (no token / invalid) fall through to null, staying phone-keyed.
  let buyerId = null;
  // Optional-chained on purpose: a runtime without `headers` must degrade to a
  // guest checkout, never throw here — this runs after the buyer has paid.
  const authHeader = req.headers?.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token) {
    try {
      const { data } = await supabase.auth.getUser(token);
      buyerId = data?.user?.id ?? null;
    } catch {
      /* invalid token — treat as a guest checkout */
    }
  }

  try {
    // Authoritative product data — never trust prices sent by the browser.
    const ids = [...new Set(items.map((it) => it?.product_id).filter(Boolean))];
    if (ids.length === 0) return res.status(400).json({ error: 'No valid products in cart' });

    const { data: products, error: prodErr } = await supabase
      .from('products')
      .select('id, title, price, color, boutique_id')
      .in('id', ids)
      // Only live products are sellable: a moderation-hidden/rejected/pending or
      // soft-deleted item is treated as "removed" and skipped below, so an admin
      // or seller pulling a product actually stops it being bought. The service
      // role bypasses RLS, so this filter must be explicit here.
      .eq('status', 'active')
      .is('deleted_at', null);
    // The first query of the request, and therefore the one that fails when the
    // service-role credentials are wrong or the project is unreachable. Answered
    // on its own terms rather than falling into the generic catch: "please try
    // again" is a lie when no amount of retrying can work, and it leaves the
    // buyer tapping the button instead of telling anyone something is broken.
    if (prodErr) {
      console.error('place-order: catalogue lookup failed:', prodErr?.message ?? prodErr, prodErr?.code ?? '');
      return res.status(503).json({
        error: 'We can’t reach our catalogue right now, so your order wasn’t placed. Please try again in a few minutes.',
        code: 'CATALOGUE_UNAVAILABLE',
      });
    }

    const byId = new Map((products ?? []).map((p) => [p.id, p]));

    // Group order lines by boutique so each seller gets their own order.
    const groups = new Map();
    for (const it of items) {
      const p = byId.get(it?.product_id);
      if (!p) continue; // unknown/removed product — skip
      const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
      const line = {
        product_id: p.id,
        title: p.title,
        price: Number(p.price),
        qty,
        size: it.size ?? null,
        color: p.color ?? null,
      };
      const g = groups.get(p.boutique_id) ?? { boutique_id: p.boutique_id, lines: [], total: 0 };
      g.lines.push(line);
      g.total += line.price * qty;
      groups.set(p.boutique_id, g);
    }

    if (groups.size === 0) {
      return res.status(400).json({ error: 'None of the cart items are still available' });
    }

    // Per-boutique goods totals drive coupon pricing: a seller coupon discounts
    // only its own boutique's slice, a platform coupon the whole cart.
    const groupTotals = Object.fromEntries([...groups.values()].map((g) => [g.boutique_id, g.total]));
    const coupon = await loadCoupon(supabase, couponCode);
    // Admin-editable commercial terms. Read once per request so every total
    // below (COD cap, fees, the paise the payment is checked against) is priced
    // from one consistent snapshot even if an admin saves mid-checkout.
    const terms = await loadTerms(supabase);

    // ── Cash on Delivery ───────────────────────────────────────────────────
    // No payment to bind an amount against, so the checks are about whether
    // this unpaid order should be allowed to consume a seller's stock at all.
    if (isCod) {
      const codTotals = computeCartPricing(groupTotals, coupon, groups.size, terms);

      if (codTotals.total > terms.cod_max_order) {
        return res.status(400).json({
          error: `Cash on delivery is available on orders up to ₹${terms.cod_max_order.toLocaleString('en-IN')}. Please pay online for this order.`,
        });
      }

      // A seller who switched COD off in their store settings must never have a
      // cash order forced on them. Re-read the flag here rather than trusting
      // whatever the browser thought it saw.
      const { data: shops, error: shopErr } = await supabase
        .from('boutiques')
        .select('id, name, cod_enabled, status')
        .in('id', [...groups.keys()]);
      if (shopErr) {
        console.error('place-order: boutique lookup failed:', shopErr?.message ?? shopErr, shopErr?.code ?? '');
        return res.status(503).json({
          error: 'We can’t reach our boutiques right now, so your order wasn’t placed. Please try again in a few minutes.',
          code: 'BOUTIQUE_LOOKUP_UNAVAILABLE',
        });
      }

      const refusing = (shops ?? []).find((b) => !b.cod_enabled);
      if (refusing) {
        return res.status(400).json({ error: `${refusing.name} does not accept cash on delivery. Please pay online.` });
      }
      const unapproved = (shops ?? []).find((b) => b.status !== 'approved');
      if (unapproved || (shops ?? []).length !== groups.size) {
        return res.status(400).json({ error: 'One of the boutiques in your bag is not currently accepting orders.' });
      }

      // Cheap abuse brake: a phone number with several unpaid COD orders still
      // open has not proved it pays for the last one, and each new order locks
      // up more stock. Signed-in buyers are held to the same limit.
      const phone = String(guest?.phone ?? '').replace(/\D/g, '');
      const { count: openCod, error: openErr } = await supabase
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('payment_method', 'COD')
        .eq('payment_status', 'pending')
        .in('status', ['pending', 'accepted', 'shipped'])
        .eq('guest_phone', phone);
      if (openErr) {
        console.error('place-order: COD open-order check failed:', openErr?.message ?? openErr);
      } else if ((openCod ?? 0) >= MAX_OPEN_COD_ORDERS) {
        return res.status(429).json({
          error: 'You already have several cash-on-delivery orders in progress. Please take delivery of those first, or pay online.',
        });
      }
    }

    // ── Payment amount binding (critical) ──────────────────────────────────
    // Prove the buyer actually PAID the amount they owe. The subtotal is the
    // server-priced goods value; the coupon + shipping are re-derived here from
    // the same rules the browser used, giving the exact paise the payment must
    // carry. This closes the underpayment hole: a ₹1 payment can't settle a
    // ₹50,000 cart.
    //
    // The check is made against the PAYMENT rather than the order, because the
    // parent order only flips to 'paid' once Razorpay has captured. On an
    // account set to manual capture it never does on its own, and even on
    // auto-capture the flip can trail this request — either way a real, fully
    // authorised payment would be rejected here and the buyer left charged with
    // no order. So: bind the payment to our order id, assert the amount, and
    // capture it ourselves if it is still merely authorised.
    let refundAmountPaise = 0;
    if (!isCod) {
      if (!razorpay) {
        return res.status(500).json({ error: 'Payment verification is not configured' });
      }
      const expectedPaise = computeCartPricing(groupTotals, coupon, 0, terms).totalPaise;

      let rzPayment;
      try {
        rzPayment = await razorpay.payments.fetch(payment.razorpay_payment_id);
      } catch (e) {
        console.error('place-order: could not fetch Razorpay payment:', e?.error ?? e);
        return res.status(502).json({ error: 'Could not confirm the payment. Please contact support before retrying.' });
      }

      // The signature proves this payment/order pair was signed by Razorpay;
      // this proves the payment really belongs to the order id we were handed.
      if (rzPayment?.order_id !== payment.razorpay_order_id) {
        console.error('place-order: payment/order mismatch', {
          paymentOrder: rzPayment?.order_id,
          claimed: payment.razorpay_order_id,
        });
        return res.status(400).json({ error: 'Payment could not be verified' });
      }

      const paidPaise = Number(rzPayment.amount) || 0;
      // What we'd hand back if we can't honour the order — always the real
      // amount on the payment, never the amount we merely expected.
      refundAmountPaise = paidPaise;

      if (rzPayment.status === 'failed' || rzPayment.status === 'refunded') {
        return res.status(400).json({ error: 'That payment did not go through. Please try again.' });
      }
      if (rzPayment.status !== 'captured' && rzPayment.status !== 'authorized') {
        return res.status(400).json({ error: 'Payment is not confirmed yet. Please wait a moment and try again.' });
      }
      if (paidPaise !== expectedPaise || rzPayment.currency !== 'INR') {
        console.error('place-order: amount mismatch', { paidPaise, expectedPaise, currency: rzPayment.currency });
        await refundPayment(razorpay, payment.razorpay_payment_id, refundAmountPaise);
        return res.status(400).json({ error: 'Paid amount did not match the order total; your payment has been refunded.' });
      }

      // Authorised but not captured — take the money now that we know the cart
      // and amount are good. A concurrent capture (auto-capture winning the
      // race) makes this a no-op error, which we treat as success by re-reading.
      if (rzPayment.status === 'authorized') {
        try {
          await razorpay.payments.capture(payment.razorpay_payment_id, expectedPaise, 'INR');
        } catch (e) {
          let captured = false;
          try {
            const after = await razorpay.payments.fetch(payment.razorpay_payment_id);
            captured = after?.status === 'captured';
          } catch {
            /* fall through to the failure below */
          }
          if (!captured) {
            console.error('place-order: capture failed:', e?.error ?? e);
            return res.status(502).json({ error: 'Could not confirm the payment. Please contact support before retrying.' });
          }
        }
      }
    }

    // ── Inventory reservation (H-03) ───────────────────────────────────────
    // Atomically decrement stock for every line before writing the order.
    // All-or-nothing: if any item is short, nothing is decremented. On the
    // prepaid path the buyer has already paid by this point, so if stock sold
    // out in the meantime we refund rather than oversell; on COD there is
    // nothing to refund and the buyer simply gets told.
    const reserveItems = [];
    for (const g of groups.values()) {
      for (const l of g.lines) reserveItems.push({ product_id: l.product_id, qty: l.qty });
    }

    const { error: reserveErr } = await supabase.rpc('reserve_stock', { p_items: reserveItems });
    if (reserveErr) {
      const soldOut = String(reserveErr.message || '').includes('INSUFFICIENT_STOCK');
      if (!soldOut) console.error('place-order: stock reservation failed:', reserveErr?.message ?? reserveErr);
      if (!isCod) await refundPayment(razorpay, payment.razorpay_payment_id, refundAmountPaise);
      return res.status(soldOut ? 409 : 500).json({
        error: soldOut
          ? isCod
            ? 'Sorry, some items just sold out. Your order was not placed.'
            : 'Sorry, some items just sold out. Your payment has been refunded.'
          : 'Could not place the order. Please try again.',
      });
    }

    const guestFields = {
      guest_name: guest?.name ?? null,
      guest_phone: guest?.phone ?? null,
      guest_city: guest?.city ?? null,
      guest_address: guest?.address ?? null,
      guest_pincode: guest?.pincode ? String(guest.pincode).replace(/\D/g, '').slice(0, 6) : null,
      payment_id: isCod ? null : payment.razorpay_payment_id,
      payment_method: isCod ? 'COD' : 'Razorpay',
      // Prepaid orders are settled the moment they are written; a COD order is
      // money the seller has yet to collect, and stays 'pending' until they
      // confirm the cash arrived.
      payment_status: isCod ? 'pending' : 'paid',
      paid_at: isCod ? null : new Date().toISOString(),
      channel: 'online',
    };

    // Delivery is a single cart-level charge, so it is recorded against the
    // first order of the checkout. Summed across the orders this request
    // creates, total + shipping_fee + cod_fee equals exactly what the buyer was
    // quoted — which is what lets a seller collect the right cash at the door.
    const cartTotals = computeCartPricing(groupTotals, coupon, isCod ? groups.size : 0, terms);
    let shippingToAssign = cartTotals.shipFee;

    // Claim the redemption before writing the orders. Done here — after pricing,
    // before the rows exist — so a code that ran out between the buyer loading
    // checkout and submitting is rejected rather than over-redeemed. `coupon` is
    // only set when it actually discounted this cart, so nothing is consumed by
    // a code that turned out to be ineligible.
    let couponApplied = null;
    if (cartTotals.discount > 0 && coupon) {
      const claimed = await redeemCoupon(supabase, coupon.code);
      if (!claimed) {
        // Stock was already reserved above and, on the prepaid path, the buyer
        // has already been charged. Bailing out here without undoing both would
        // eat the inventory AND keep the money for an order that never exists —
        // so unwind exactly as the order-write failure below does.
        try {
          await supabase.rpc('release_stock', { p_items: reserveItems });
        } catch (releaseErr) {
          console.error('place-order: stock release failed after coupon exhaustion:', releaseErr?.message ?? releaseErr);
        }
        if (!isCod) await refundPayment(razorpay, payment.razorpay_payment_id, refundAmountPaise);
        return res.status(409).json({
          error: isCod
            ? 'That coupon has just reached its redemption limit. Remove it and try again.'
            : 'That coupon has just reached its redemption limit; your payment has been refunded. Remove it and try again.',
        });
      }
      couponApplied = coupon.code;
    }

    // Stock is now reserved — if the order rows fail to write, put it back
    // (and refund) so a failed write can't silently eat inventory or money.
    const created = [];
    try {
      for (const g of groups.values()) {
        const shippingForThisOrder = shippingToAssign;
        shippingToAssign = 0;
        // A seller coupon is funded by that seller: its discount is netted off
        // this boutique's goods total here, so the existing payout math (0025)
        // settles — and takes commission on — the discounted amount unchanged. A
        // platform coupon never lands in perBoutiqueDiscount, so those orders
        // keep their full goods total (the platform funds that discount).
        const orderDiscount = cartTotals.perBoutiqueDiscount[g.boutique_id] ?? 0;
        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert({
            order_number: orderNumber(),
            buyer_id: buyerId,
            boutique_id: g.boutique_id,
            total: g.total - orderDiscount,
            discount: orderDiscount,
            status: 'pending',
            // One handling fee per delivery, stored on the order it belongs to
            // so the seller knows the exact cash to collect at that door.
            cod_fee: isCod ? terms.cod_fee : 0,
            // Which code paid for this, so redemptions are auditable (0049).
            coupon_code: couponApplied,
            shipping_fee: shippingForThisOrder,
            ...guestFields,
          })
          .select('id, order_number, boutique_id, total, cod_fee, shipping_fee, created_at')
          .single();
        if (orderErr) throw orderErr;

        const { error: itemsErr } = await supabase
          .from('order_items')
          .insert(g.lines.map((l) => ({ ...l, order_id: order.id })));
        if (itemsErr) throw itemsErr;

        created.push({
          id: order.id,
          order_number: order.order_number,
          boutique_id: order.boutique_id,
          total: Number(order.total),
          cod_fee: Number(order.cod_fee ?? 0),
          shipping_fee: Number(order.shipping_fee ?? 0),
          created_at: order.created_at,
          lines: g.lines,
        });
      }
    } catch (writeErr) {
      console.error('place-order: order write failed after reservation:', {
        message: writeErr?.message ?? String(writeErr),
        code: writeErr?.code,
        details: writeErr?.details,
        hint: writeErr?.hint,
      });
      // `rpc()` is a thenable, not a Promise, so it has no `.catch` to chain —
      // calling one would throw inside the failure handler and lose both the
      // stock release and the refund below it.
      try {
        await supabase.rpc('release_stock', { p_items: reserveItems });
      } catch (releaseErr) {
        console.error('place-order: stock release failed:', releaseErr?.message ?? releaseErr);
      }
      if (!isCod) await refundPayment(razorpay, payment.razorpay_payment_id, refundAmountPaise);
      return res.status(500).json({ error: 'Could not place the order. Please try again.', code: 'ORDER_WRITE_FAILED' });
    }

    // The order exists — everything from here is best-effort and must never
    // turn a successful checkout into an error for the buyer.
    await notifySellers(supabase, created, guestFields);

    return res.status(200).json({
      orders: created.map(({ id, order_number, boutique_id, total, cod_fee, shipping_fee, created_at }) => ({
        id,
        order_number,
        boutique_id,
        total,
        cod_fee,
        shipping_fee,
        created_at,
      })),
      paid: !isCod,
      payment_method: guestFields.payment_method,
    });
  } catch (err) {
    // Everything reachable from here has already been given its own branch, so
    // landing in this catch means something genuinely unforeseen. Log the whole
    // error (code, details and hint carry the useful part of a Postgres
    // failure — `message` alone routinely does not) so the next report of this
    // is diagnosable from the function logs rather than by guesswork.
    console.error('place-order failed:', {
      message: err?.message ?? String(err),
      code: err?.code,
      details: err?.details,
      hint: err?.hint,
    });
    return res.status(500).json({ error: 'Could not place the order. Please try again.', code: 'UNEXPECTED' });
  }
}
