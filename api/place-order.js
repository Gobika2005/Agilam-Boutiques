import crypto from 'node:crypto';
import { serviceClient } from './_supabase.js';
import { computeCartPricing, loadBuyerPlace, loadCoupon, loadShopTerms, redeemCoupon, undeliverableShop } from './_pricing.js';
import { enforceRateLimit } from './_rateLimit.js';
import { clientFor, verifyPaymentSignature } from './_razorpay.js';
import { sendEmail, layout, rowsTable, inr, esc, appUrl, isValidEmail } from './_email.js';
import { receiptBody, receiptText } from './_receipt.js';

/**
 * Vercel serverless function: create the real order(s) for a checkout.
 *
 * Buyers browse without an account, but they cannot order without one: this
 * endpoint requires the buyer's Supabase access token and refuses the request
 * without it (see the sign-in gate in the handler). The `guest_*` columns are
 * still where the delivery details live — the name kept its original meaning of
 * "typed at checkout" rather than "no account behind it".
 *
 * Orders are written with the Supabase service role (bypasses RLS) rather than
 * from the browser client, so one request can create rows for several sellers.
 * The server is the source of truth for prices and boutique ownership: the client
 * only sends product ids + quantities, and we look up the authoritative title,
 * price and boutique from the products table. A cart can span several
 * boutiques, so it is split into one order per boutique — that is what makes
 * each seller see only their own items.
 *
 * For online payments we re-verify the Razorpay signature here (the same HMAC
 * as verify-payment.js) so an order can't be forged without a genuine payment.
 * The signature is checked against every configured merchant account, and the
 * account whose secret matched is the one this request then fetches, captures
 * and refunds against — so a payment taken just before an emergency account
 * switch still settles on the account that actually holds the money.
 *
 * Every order is prepaid. Cash on delivery was removed from the platform
 * (migration 0085) and this endpoint is the gate that enforces it: there is no
 * longer any path that writes an order without a verified Razorpay payment
 * behind it, and a request still asking for `paymentMethod: 'COD'` is refused
 * outright rather than quietly downgraded to something else.
 */

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function orderNumber() {
  // Time component keeps numbers roughly sortable; 4 hex chars of CSPRNG entropy
  // make same-millisecond collisions vanishingly unlikely. The DB `unique`
  // constraint on order_number remains the final guard.
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `AGL-${ts}${rand}`;
}

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
      rows.push({
        profile_id: ownerId,
        type: 'Orders',
        title: `New order ${order.order_number} · ₹${Math.round(order.total)}`,
        body: `${buyer} ordered ${units} item${units === 1 ? '' : 's'} — ${first?.title ?? 'Item'}${rest}. Paid online.`,
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

/**
 * Queue the WhatsApp confirmation for the buyer and the new-order alert for each
 * seller (migration 0090).
 *
 * WHY THESE TWO ARE NOT TRIGGERS
 * Every other WhatsApp message in the system is queued by a Postgres trigger, so
 * that a status change fires wherever it comes from. Placement is the exception:
 * the confirmation wants the basket summary and the seller alert wants the unit
 * count, and both are already in hand here. A trigger would have to re-read
 * order_items to rebuild what this function is holding — and would fire once per
 * boutique order with no way to tell a two-shop checkout from two checkouts.
 *
 * `wa_enqueue` does the rest: it normalises the phone, drops anyone on the
 * opt-out list, sanitises every parameter, and de-duplicates on the key. Nothing
 * is sent from here — the wa-drain Edge Function does that on its next tick, and
 * only if the admin kill switch is on.
 *
 * Best-effort, like everything past the order write: the buyer has already paid,
 * so a queueing failure is logged and never surfaced.
 */
async function queueWhatsApp(supabase, created, guestFields, buyerId) {
  try {
    const boutiqueIds = [...new Set(created.map((o) => o.boutique_id))];
    // The service-role client reads `whatsapp` and `phone` straight through the
    // column grants 0021/0073 put on boutiques — the same reason emailOrderPlaced
    // below can read `email`. Columns are named, never select('*').
    const { data: boutiques, error } = await supabase
      .from('boutiques')
      .select('id, name, owner_id, whatsapp, phone')
      .in('id', boutiqueIds);
    if (error) throw error;

    const byId = new Map((boutiques ?? []).map((b) => [b.id, b]));
    const buyerFirstName = String(guestFields.guest_name || '').trim().split(/\s+/)[0] || 'there';

    for (const order of created) {
      const shop = byId.get(order.boutique_id);
      const units = order.lines.reduce((sum, l) => sum + l.qty, 0);
      const first = order.lines[0]?.title ?? 'your order';
      const rest = order.lines.length > 1 ? ` +${order.lines.length - 1} more` : '';
      // What the buyer was actually charged for this boutique's order, matching
      // the receipt: goods and delivery, less the platform-funded discount.
      // No COD fee term — every order is prepaid since 0085, so it is always 0.
      const billed = Math.round(
        Number(order.total || 0) +
          Number(order.shipping_fee || 0) -
          Number(order.platform_discount || 0),
      );

      // One message per boutique order, not one per checkout — a bag spanning
      // two shops becomes two orders that ship and track separately, so a single
      // combined message would misdescribe what the buyer has.
      //
      // `order_received`, NOT `order_confirmed`. The order is written with
      // status 'pending' (below), and the seller console offers Accept *and*
      // Reject from that state — so at this moment the shop has agreed to
      // nothing. The old template told the buyer their order was confirmed and
      // that the boutique "will pack and dispatch it shortly", which the
      // boutique may never do. This one says we have the order and their money,
      // and that the shop is deciding; `order_accepted` (migration 0092) is what
      // reports the decision. `order_confirmed` is left in place at Meta but
      // unused — deleting it would lock the name for 30 days for no gain.
      const { error: buyerErr } = await supabase.rpc('wa_enqueue', {
        p_recipient: guestFields.guest_phone,
        p_template: 'order_received',
        p_params: [
          buyerFirstName,
          order.order_number,
          `${units} item${units === 1 ? '' : 's'} — ${first}${rest}`,
          `₹${billed.toLocaleString('en-IN')}`,
          shop?.name ?? 'the boutique',
        ],
        p_dedupe_key: `order:${order.id}:received`,
        p_audience: 'buyer',
        p_order_id: order.id,
        p_boutique_id: order.boutique_id,
        p_profile_id: buyerId ?? null,
      });
      if (buyerErr) throw buyerErr;

      if (!shop) continue;
      const { error: sellerErr } = await supabase.rpc('wa_enqueue', {
        p_recipient: shop.whatsapp || shop.phone,
        p_template: 'seller_new_order',
        p_params: [
          shop.name ?? 'Seller',
          order.order_number,
          String(units),
          // The seller's side of the same order: goods value, before our
          // commission. Every order is prepaid (0085), so there is nothing to
          // collect on delivery.
          `₹${Math.round(Number(order.total || 0)).toLocaleString('en-IN')}`,
        ],
        p_dedupe_key: `order:${order.id}:new`,
        p_audience: 'seller',
        p_order_id: order.id,
        p_boutique_id: order.boutique_id,
        p_profile_id: shop.owner_id ?? null,
      });
      if (sellerErr) throw sellerErr;
    }
  } catch (err) {
    console.error('place-order: WhatsApp queue failed (order still placed):', err?.message ?? err);
  }
}

/**
 * Email the buyer their confirmation, and each seller their new order.
 *
 * Until this existed the platform sent no transactional email whatsoever: a
 * buyer who had just paid received nothing outside the app, and a seller only
 * found out about an order if they happened to open the console. In-app
 * notifications (notifySellers above, plus 0018's status triggers) are real but
 * they are not a channel you can rely on reaching someone.
 *
 * Entirely best-effort, like everything else past the order write. Every send is
 * awaited so failures land in the logs with a reason, but nothing here can fail
 * the request — `sendEmail` never throws and the whole body is wrapped anyway.
 *
 * One email per boutique order rather than one per checkout: a bag spanning two
 * shops becomes two orders that ship, track and can be cancelled separately, so
 * one combined receipt would misrepresent what the buyer actually has.
 */
async function emailOrderPlaced(supabase, created, guestFields, buyerEmail) {
  try {
    // Seller addresses come from the service-role client, which bypasses the
    // column grants migration 0073 put on `boutiques.email` — the whole reason
    // those columns are safe to withhold from the browser.
    const boutiqueIds = [...new Set(created.map((o) => o.boutique_id))];
    const { data: boutiques } = await supabase
      .from('boutiques')
      // Named columns, never `select('*')` — `boutiques` has had column-level
      // grants since the onboarding work. The address and logo are here for the
      // buyer's receipt: it bills FROM the shop, so it has to say who the shop
      // is and show their mark.
      .select('id, name, email, logo_url, address_line, city, district, state, pincode')
      .in('id', boutiqueIds);
    const shopById = new Map((boutiques ?? []).map((b) => [b.id, b]));

    const buyerName = guestFields.guest_name || 'there';
    const payLine = 'Paid online';

    for (const order of created) {
      const shop = shopById.get(order.boutique_id);
      // What the buyer was actually charged, for THIS order.
      const payable = order.total + (order.shipping_fee ?? 0) - (order.platform_discount ?? 0);

      const itemsHtml = order.lines
        .map(
          (l) =>
            `<tr><td style="padding:8px 0;border-bottom:1px solid #EFDCE4;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#241019;">` +
            `${esc(l.title)}${l.size ? ` <span style="color:#775D66;">· ${esc(l.size)}</span>` : ''}` +
            `<span style="color:#775D66;"> × ${Number(l.qty) || 1}</span></td>` +
            `<td align="right" style="padding:8px 0;border-bottom:1px solid #EFDCE4;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#241019;font-weight:700;">${esc(inr(Number(l.price) * (Number(l.qty) || 1)))}</td></tr>`,
        )
        .join('');
      const itemsTable = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>`;

      const summary = rowsTable([
        ['Items', inr(order.total + (order.platform_discount ?? 0))],
        ...(order.platform_discount ? [['Discount', '−' + inr(order.platform_discount)]] : []),
        ['Delivery', order.shipping_fee ? inr(order.shipping_fee) : 'Free'],
        ['Paid', inr(payable)],
      ]);

      // ── Buyer ──────────────────────────────────────────────────────────────
      // This IS the receipt. Razorpay's own post-payment receipt feature only
      // covers Payment Links and Payment Pages, and checkout here settles a
      // Razorpay *order* (api/create-order.js), so nothing the dashboard is
      // configured to send can ever fire for a MangaiMart purchase. The one
      // that reaches the buyer is this one — see api/_receipt.js.
      if (isValidEmail(buyerEmail)) {
        const receiptOrder = { ...order, payment_id: guestFields.payment_id, paid_at: guestFields.paid_at };
        const receiptBuyer = {
          name: guestFields.guest_name,
          email: buyerEmail,
          phone: guestFields.guest_phone,
          address: guestFields.guest_address,
          city: guestFields.guest_city,
          pincode: guestFields.guest_pincode,
        };
        const r = await sendEmail({
          to: buyerEmail,
          subject: `Payment receipt · ${order.order_number} · ${inr(payable)}`,
          html: layout({
            heading: 'Payment Receipt',
            intro: `Thanks, ${buyerName} — ${shop?.name ?? 'the boutique'} has your payment of ${inr(payable)} and is getting order ${order.order_number} ready. We'll tell you the moment it ships.`,
            bodyHtml: receiptBody({ order: receiptOrder, shop, buyer: receiptBuyer }),
            ctaLabel: 'Track this order',
            ctaHref: `${appUrl}/orders/${order.id}`,
            footerNote: 'Keep this receipt — it is your proof of payment for this order.',
          }),
          text: receiptText({ order: receiptOrder, shop, buyer: receiptBuyer, appUrl }),
        });
        if (!r.ok) console.error('place-order: buyer receipt email failed:', order.order_number, r.error);
      }

      // ── Seller ─────────────────────────────────────────────────────────────
      if (isValidEmail(shop?.email)) {
        const units = order.lines.reduce((sum, l) => sum + (Number(l.qty) || 1), 0);
        const r = await sendEmail({
          to: shop.email,
          subject: `New order ${order.order_number} · ${inr(payable)}`,
          html: layout({
            heading: `You have a new order — ${order.order_number}`,
            intro: `${guestFields.guest_name || 'A customer'} ordered ${units} item${units === 1 ? '' : 's'}. Already paid online.`,
            bodyHtml: `${itemsTable}<div style="height:14px"></div>${summary}`,
            ctaLabel: 'Open in your console',
            ctaHref: `${appUrl}/seller/orders/${order.id}`,
            footerNote: 'Accept the order in your console to let the buyer know it is being prepared.',
          }),
          text:
            `New order ${order.order_number} — ${units} item${units === 1 ? '' : 's'}, ${inr(payable)} (${payLine}).\n` +
            `Open it: ${appUrl}/seller/orders/${order.id}\n`,
        });
        if (!r.ok) console.error('place-order: seller email failed:', order.order_number, r.error);
      }
    }
  } catch (err) {
    console.error('place-order: order emails failed (order still placed):', err?.message ?? err);
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

  // Cash on delivery was withdrawn platform-wide (migration 0085). An old cached
  // bundle, a replayed request or a hand-rolled client can still ask for it, so
  // it is refused here explicitly rather than falling through to the prepaid
  // path — which would otherwise reject it as "payment required" and leave the
  // buyer with a misleading reason.
  if (paymentMethod === 'COD') {
    return res.status(400).json({
      error: 'Cash on delivery is no longer available on MangaiMart. Please pay online to place this order.',
      code: 'COD_WITHDRAWN',
    });
  }

  // A reachable mobile number is now mandatory on every order (migration 0090).
  // Until COD was withdrawn this rule existed only on the cash path, where a
  // courier had to be able to ring the door; it went with 0085 and nothing
  // replaced it, so a scripted request could place a prepaid order with no way
  // to contact the buyer at all. WhatsApp order updates make that a real gap
  // rather than a tidy one — a queued message with no recipient is a buyer who
  // hears nothing. The checkout form has always validated this same rule
  // client-side, so in practice only a tampered or hand-rolled request is
  // turned away here.
  const guestPhone = String(guest?.phone ?? '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(guestPhone)) {
    return res.status(400).json({
      error: 'A 10-digit mobile number is required so we can send you order updates.',
      code: 'PHONE_REQUIRED',
    });
  }

  // Which merchant account signed this payment — and therefore which one holds
  // the money.
  if (!payment) {
    return res.status(400).json({ error: 'Payment is required to place an order' });
  }
  const paymentAccount = verifyPaymentSignature(payment);
  if (!paymentAccount) {
    return res.status(400).json({ error: 'Payment could not be verified' });
  }

  // One Razorpay client, reused for order lookup (amount binding) and any
  // auto-refund — bound to the account the signature identified, NOT to whatever
  // the admin switch points at now. If the switch moved between checkout opening
  // and this request, the money is still sitting in the old account and every
  // call below has to be made there.
  const razorpay = clientFor(paymentAccount);

  // Replay guard: a genuine online payment maps to exactly one order-set. Without
  // this, replaying the same verified {order_id, payment_id, signature} to this
  // endpoint would mint unlimited orders from a single payment. The multi-boutique
  // split still shares one payment_id across the rows created in THIS request —
  // we only reject a payment_id that already exists from a PRIOR request.
  {
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

  // ── Sign-in required ───────────────────────────────────────────────────
  // Every order is owned by an account. The buyer's access token is what proves
  // that, and it is mandatory: guest checkout is closed. This is the server half
  // of the gate the UI enforces in src/auth/SignInGate.tsx — the browser can
  // skip its own guard, this it cannot.
  //
  // An *anonymous* Supabase user does not count. Opening a chat signs the
  // browser in anonymously (src/data/chat.ts), so a bare token is not evidence
  // of an account; `is_anonymous` is what separates the two.
  //
  // Ordering matters: this sits AFTER the replay check so a re-sent settlement
  // for an order that already exists still answers 409 ("already used") instead
  // of a sign-in error, and the retry path in ShopContext stops rather than
  // looping. It is otherwise as early as possible.
  let buyerId = null;
  // The address for the order-confirmation email. Every order has a real
  // account behind it (migration 0069), so this is normally present.
  let buyerEmail = null;
  {
    // Optional-chained on purpose: a runtime without `headers` must not throw.
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    let user = null;
    if (token) {
      try {
        const { data } = await supabase.auth.getUser(token);
        user = data?.user ?? null;
      } catch {
        /* expired or malformed token — handled as signed out below */
      }
    }
    if (!user || user.is_anonymous) {
      // We reach here only if the session expired between opening checkout and
      // settling, so the money may already be captured. Say so: the browser has
      // parked the payment and the "Complete my order" retry will settle it once
      // they are signed in again — being told to sign in with no word about the
      // charge is how a buyer pays twice.
      return res.status(401).json({
        error: 'Please sign in again to finish your order — your payment is safe and you will not be charged twice.',
        code: 'SIGN_IN_REQUIRED',
      });
    }
    buyerId = user.id;
    buyerEmail = user.email ?? null;
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
    // Each boutique's own delivery terms (migration 0076). Read once per request
    // so every total below — the fees stored on each order, the paise the payment
    // is checked against — is priced from one consistent snapshot even if a
    // seller saves their settings mid-checkout.
    const shops = await loadShopTerms(supabase, [...groups.keys()]);
    // Where the parcel is going decides which of each shop's zone rates applies
    // (migration 0077). Read from the SAME `pincodes` directory the browser
    // quoted from, so the two derive the same zone and the amount binding below
    // does not reject a correctly-priced payment.
    const buyerPlace = await loadBuyerPlace(supabase, guest?.pincode);

    // A shop that does not deliver this far must not be sold a parcel it cannot
    // send. Checked before the payment binding so a prepaid buyer is refused
    // with their money untouched, and re-checked here rather than trusted from
    // the browser because it is the seller's promise, not the buyer's claim.
    const cannotDeliver = undeliverableShop(groupTotals, shops, buyerPlace);
    if (cannotDeliver) {
      return res.status(400).json({
        error: `${cannotDeliver} does not deliver to that address. Remove those items, or use a different delivery address.`,
        code: 'UNDELIVERABLE',
      });
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
    {
      if (!razorpay) {
        return res.status(500).json({ error: 'Payment verification is not configured' });
      }
      const expectedPaise = computeCartPricing(groupTotals, coupon, shops, buyerPlace).totalPaise;

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
    // All-or-nothing: if any item is short, nothing is decremented. The buyer
    // has already paid by this point, so if stock sold out in the meantime we
    // refund rather than oversell.
    const reserveItems = [];
    for (const g of groups.values()) {
      for (const l of g.lines) reserveItems.push({ product_id: l.product_id, qty: l.qty });
    }

    const { error: reserveErr } = await supabase.rpc('reserve_stock', { p_items: reserveItems });
    if (reserveErr) {
      const soldOut = String(reserveErr.message || '').includes('INSUFFICIENT_STOCK');
      if (!soldOut) console.error('place-order: stock reservation failed:', reserveErr?.message ?? reserveErr);
      await refundPayment(razorpay, payment.razorpay_payment_id, refundAmountPaise);
      return res.status(soldOut ? 409 : 500).json({
        error: soldOut
          ? 'Sorry, some items just sold out. Your payment has been refunded.'
          : 'Could not place the order. Please try again.',
      });
    }

    const guestFields = {
      guest_name: guest?.name ?? null,
      // Normalised above, and validated — never the raw string, so what the
      // WhatsApp triggers read is a number they can always resolve.
      guest_phone: guestPhone,
      guest_city: guest?.city ?? null,
      guest_address: guest?.address ?? null,
      guest_pincode: guest?.pincode ? String(guest.pincode).replace(/\D/g, '').slice(0, 6) : null,
      payment_id: payment.razorpay_payment_id,
      payment_method: 'Razorpay',
      // Every order is prepaid (migration 0085), so it is settled the moment it
      // is written — there is no longer a 'pending' state waiting on cash.
      payment_status: 'paid',
      paid_at: new Date().toISOString(),
      channel: 'online',
    };

    // Delivery is each boutique's own charge now, so every order carries its own
    // — no more assigning the whole cart's delivery to the first order of the
    // checkout. Summed across the orders this request creates, total +
    // shipping_fee − platform_discount equals exactly what the buyer paid, which
    // is what the amount binding above asserted against.
    const cartTotals = computeCartPricing(groupTotals, coupon, shops, buyerPlace);

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
        await refundPayment(razorpay, payment.razorpay_payment_id, refundAmountPaise);
        return res.status(409).json({
          error: 'That coupon has just reached its redemption limit; your payment has been refunded. Remove it and try again.',
        });
      }
      couponApplied = coupon.code;
    }

    // Stock is now reserved — if the order rows fail to write, put it back
    // (and refund) so a failed write can't silently eat inventory or money.
    const created = [];
    try {
      for (const g of groups.values()) {
        const shippingForThisOrder = cartTotals.perBoutiqueShipFee[g.boutique_id] ?? 0;
        // A seller coupon is funded by that seller: its discount is netted off
        // this boutique's goods total here, so the existing payout math (0025)
        // settles — and takes commission on — the discounted amount unchanged. A
        // platform coupon never lands in perBoutiqueDiscount, so those orders
        // keep their full goods total (the platform funds that discount).
        const orderDiscount = cartTotals.perBoutiqueDiscount[g.boutique_id] ?? 0;
        // A platform coupon is funded by us, so it is NOT taken off `total` —
        // the seller is still paid for the full goods value. It is recorded
        // alongside instead, because it IS money the buyer no longer owes:
        // total + shipping_fee − platform_discount is what they pay, and it is
        // what the payout credits back to the seller (migration 0053).
        const platformDiscount = cartTotals.perBoutiquePlatformDiscount[g.boutique_id] ?? 0;
        const { data: order, error: orderErr } = await supabase
          .from('orders')
          .insert({
            order_number: orderNumber(),
            buyer_id: buyerId,
            boutique_id: g.boutique_id,
            total: g.total - orderDiscount,
            discount: orderDiscount,
            platform_discount: platformDiscount,
            status: 'pending',
            // Which code paid for this, so redemptions are auditable (0049).
            coupon_code: couponApplied,
            shipping_fee: shippingForThisOrder,
            ...guestFields,
          })
          .select('id, order_number, boutique_id, total, discount, platform_discount, shipping_fee, created_at')
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
          // Seller-funded coupon, already netted off `total`. Carried through so
          // the buyer's receipt can name it as the boutique's own offer instead
          // of quietly printing a line total that doesn't reconcile.
          discount: Number(order.discount ?? 0),
          platform_discount: Number(order.platform_discount ?? 0),
          shipping_fee: Number(order.shipping_fee ?? 0),
          created_at: order.created_at,
          lines: g.lines,
        });
      }
    } catch (writeErr) {
      // ── Lost the race for this payment ──────────────────────────────────
      // `orders_payment_boutique_uniq` (migration 0092) is the structural half
      // of the replay guard near the top of this handler. That guard is a
      // SELECT and this INSERT is many awaits later — the token check, the
      // product read, a Razorpay fetch, possibly a capture, the stock
      // reservation and the coupon claim all sit in between — so two requests
      // carrying the same genuine {order_id, payment_id, signature} can both
      // pass it. The unique index is what makes only one of them land.
      //
      // This is NOT a failed checkout: the request that won wrote the real
      // order for this payment. Both compensations below would therefore do
      // damage here — a refund would reverse money a live order is holding,
      // and releasing every reserved unit would give away stock the winner's
      // order has already committed. So release only what THIS request
      // reserved and did not turn into an order, and leave the payment alone.
      //
      // Matched on the index name so that the OTHER unique on this table
      // (`order_number`) still falls through to the refund path below, where a
      // genuine write failure belongs.
      const constraint = `${writeErr?.message ?? ''} ${writeErr?.details ?? ''} ${writeErr?.constraint ?? ''}`;
      if (writeErr?.code === '23505' && constraint.includes('orders_payment_boutique_uniq')) {
        const written = new Set(created.map((o) => o.boutique_id));
        const unwritten = [];
        for (const g of groups.values()) {
          if (written.has(g.boutique_id)) continue;
          for (const l of g.lines) unwritten.push({ product_id: l.product_id, qty: l.qty });
        }
        if (unwritten.length > 0) {
          try {
            await supabase.rpc('release_stock', { p_items: unwritten });
          } catch (releaseErr) {
            console.error('place-order: stock release failed after duplicate settlement:', releaseErr?.message ?? releaseErr);
          }
        }
        // With both requests iterating the same boutiques in the same order the
        // loser collides on its first insert and has written nothing, which is
        // the ordinary case. A partial write means the two requests interleaved
        // across boutiques — the union is still exactly one order per boutique
        // (that is what the index guarantees), but it is worth a loud line.
        console.warn(
          'place-order: duplicate settlement for payment', payment.razorpay_payment_id,
          created.length
            ? `— this request had already written ${created.length} order(s) before colliding; reconcile by hand`
            : '— nothing written, reserved stock released, payment left alone',
        );
        return res.status(409).json({ error: 'This payment has already been used for an order.' });
      }

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
      await refundPayment(razorpay, payment.razorpay_payment_id, refundAmountPaise);
      return res.status(500).json({ error: 'Could not place the order. Please try again.', code: 'ORDER_WRITE_FAILED' });
    }

    // The order exists — everything from here is best-effort and must never
    // turn a successful checkout into an error for the buyer.
    await notifySellers(supabase, created, guestFields);
    await emailOrderPlaced(supabase, created, guestFields, buyerEmail);
    await queueWhatsApp(supabase, created, guestFields, buyerId);

    return res.status(200).json({
      orders: created.map(({ id, order_number, boutique_id, total, platform_discount, shipping_fee, created_at }) => ({
        id,
        order_number,
        boutique_id,
        total,
        platform_discount,
        shipping_fee,
        created_at,
      })),
      paid: true,
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
