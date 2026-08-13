import crypto from 'node:crypto';
import { serviceClient } from './_supabase.js';
import { computeCartPricing, loadBuyerPlace, loadCoupon, loadShopTerms, redeemCoupon, undeliverableShop } from './_pricing.js';
import { loadCodSwitch } from './_settings.js';
import { enforceRateLimit } from './_rateLimit.js';
import { clientFor, verifyPaymentSignature } from './_razorpay.js';
import { sendEmail, layout, rowsTable, inr, esc, appUrl, isValidEmail } from './_email.js';

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
 * Cash on Delivery is the one path that writes an order with no payment behind
 * it, so it is guarded on its own terms instead: every boutique in the cart
 * must have COD switched on, the cart must be under COD_MAX_ORDER, and a real
 * name/phone/address must be present — without those, an unpaid order is just a
 * way to burn a seller's stock. Everything else (server pricing, stock
 * reservation, the per-boutique split) is shared with the prepaid path.
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
        ? `Collect ₹${Math.round(
            order.total + (order.shipping_fee ?? 0) + (order.cod_fee ?? 0) - (order.platform_discount ?? 0),
          )} in cash on delivery.`
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
async function emailOrderPlaced(supabase, created, guestFields, buyerEmail, isCod) {
  try {
    // Seller addresses come from the service-role client, which bypasses the
    // column grants migration 0073 put on `boutiques.email` — the whole reason
    // those columns are safe to withhold from the browser.
    const boutiqueIds = [...new Set(created.map((o) => o.boutique_id))];
    const { data: boutiques } = await supabase
      .from('boutiques')
      .select('id, name, email')
      .in('id', boutiqueIds);
    const shopById = new Map((boutiques ?? []).map((b) => [b.id, b]));

    const buyerName = guestFields.guest_name || 'there';
    const payLine = isCod ? 'Cash on delivery' : 'Paid online';

    for (const order of created) {
      const shop = shopById.get(order.boutique_id);
      // What the buyer actually hands over or was charged, for THIS order.
      const payable =
        order.total + (order.shipping_fee ?? 0) + (order.cod_fee ?? 0) - (order.platform_discount ?? 0);

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
        ...(order.cod_fee ? [['Cash handling', inr(order.cod_fee)]] : []),
        [isCod ? 'To pay on delivery' : 'Paid', inr(payable)],
      ]);

      // ── Buyer ──────────────────────────────────────────────────────────────
      if (isValidEmail(buyerEmail)) {
        const r = await sendEmail({
          to: buyerEmail,
          subject: `Order ${order.order_number} confirmed · ${shop?.name ?? 'MangaiMart'}`,
          html: layout({
            heading: `Thanks, ${buyerName} — your order is in.`,
            intro: `${shop?.name ?? 'The boutique'} has your order ${order.order_number} and will start getting it ready. We'll let you know the moment it ships.`,
            bodyHtml: `${itemsTable}<div style="height:14px"></div>${summary}`,
            ctaLabel: 'Track this order',
            ctaHref: `${appUrl}/orders/${order.id}`,
            footerNote: isCod
              ? `Please keep ${inr(payable)} in cash ready for the delivery agent.`
              : 'Your payment has been received in full.',
          }),
          text:
            `Order ${order.order_number} confirmed.\n` +
            `${shop?.name ?? 'The boutique'} is getting it ready.\n` +
            `${payLine}: ${inr(payable)}\n` +
            `Track it: ${appUrl}/orders/${order.id}\n`,
        });
        if (!r.ok) console.error('place-order: buyer email failed:', order.order_number, r.error);
      }

      // ── Seller ─────────────────────────────────────────────────────────────
      if (isValidEmail(shop?.email)) {
        const units = order.lines.reduce((sum, l) => sum + (Number(l.qty) || 1), 0);
        const r = await sendEmail({
          to: shop.email,
          subject: `${isCod ? 'New COD order' : 'New order'} ${order.order_number} · ${inr(payable)}`,
          html: layout({
            heading: `You have a new order — ${order.order_number}`,
            intro: `${guestFields.guest_name || 'A customer'} ordered ${units} item${units === 1 ? '' : 's'}. ${isCod ? `Collect ${inr(payable)} in cash on delivery.` : 'Already paid online.'}`,
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

  // COD is opt-in per request and never inferred from a missing payment: a
  // prepaid checkout that loses its payment object must still fail closed
  // rather than quietly becoming an unpaid order.
  const isCod = paymentMethod === 'COD';

  // Which merchant account signed this payment — and therefore which one holds
  // the money. Null for COD, where there is no payment at all.
  let paymentAccount = null;

  if (!isCod) {
    if (!payment) {
      return res.status(400).json({ error: 'Payment is required to place an order' });
    }
    paymentAccount = verifyPaymentSignature(payment);
    if (!paymentAccount) {
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
  // auto-refund — bound to the account the signature identified, NOT to whatever
  // the admin switch points at now. If the switch moved between checkout opening
  // and this request, the money is still sitting in the old account and every
  // call below has to be made there. Null for COD.
  const razorpay = clientFor(paymentAccount);

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
      // Prepaid reaches here only if the session expired between opening
      // checkout and settling, so the money may already be captured. Say so:
      // the browser has parked the payment and the "Complete my order" retry
      // will settle it once they are signed in again — being told to sign in
      // with no word about the charge is how a buyer pays twice.
      return res.status(401).json({
        error: isCod
          ? 'Please sign in to place your order.'
          : 'Please sign in again to finish your order — your payment is safe and you will not be charged twice.',
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
    // Each boutique's own delivery and cash-handling terms (migration 0076).
    // Read once per request so every total below — the COD cap, the fees stored
    // on each order, the paise the payment is checked against — is priced from
    // one consistent snapshot even if a seller saves their settings mid-checkout.
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

    // ── Cash on Delivery ───────────────────────────────────────────────────
    // No payment to bind an amount against, so the checks are about whether
    // this unpaid order should be allowed to consume a seller's stock at all.
    if (isCod) {
      // The platform-wide switch (migration 0066) beats every per-shop flag.
      // Checked before anything else so a platform running prepaid-only never
      // reaches the stock and cap logic on a payment method it does not offer.
      if (!(await loadCodSwitch(supabase))) {
        return res.status(400).json({
          error: 'Cash on delivery is not available right now. Please pay online to place this order.',
        });
      }

      // The cap is now per boutique, because each shop sets its own and each
      // collects its own cash — so it is measured against that shop's order,
      // not the whole bag. Mirrors codBlockedReason() in src/lib/pricing.ts.
      const codTotals = computeCartPricing(groupTotals, coupon, true, shops, buyerPlace);
      for (const [id, payable] of Object.entries(codTotals.perBoutiquePayable)) {
        const cap = Number(shops[id]?.codMaxOrder) || 0;
        if (cap > 0 && payable > cap) {
          const who = shops[id]?.name || 'One of the boutiques in your bag';
          return res.status(400).json({
            error: `${who} accepts cash on delivery on orders up to ₹${cap.toLocaleString('en-IN')}. Please pay online for this order.`,
          });
        }
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
      const expectedPaise = computeCartPricing(groupTotals, coupon, false, shops, buyerPlace).totalPaise;

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

    // Delivery is each boutique's own charge now, so every order carries its own
    // — no more assigning the whole cart's delivery to the first order of the
    // checkout. Summed across the orders this request creates, total +
    // shipping_fee + cod_fee still equals exactly what the buyer was quoted,
    // which is what lets a seller collect the right cash at the door.
    const cartTotals = computeCartPricing(groupTotals, coupon, isCod, shops, buyerPlace);

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
        // total + shipping_fee + cod_fee − platform_discount is what they pay.
        // Skipping this used to hand a COD buyer an undiscounted bill at the
        // door (migration 0053).
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
            // One handling fee per delivery — this boutique's own — stored on
            // the order it belongs to so the seller knows the exact cash to
            // collect at that door.
            cod_fee: cartTotals.perBoutiqueCodFee[g.boutique_id] ?? 0,
            // Which code paid for this, so redemptions are auditable (0049).
            coupon_code: couponApplied,
            shipping_fee: shippingForThisOrder,
            ...guestFields,
          })
          .select('id, order_number, boutique_id, total, discount, platform_discount, cod_fee, shipping_fee, created_at')
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
          platform_discount: Number(order.platform_discount ?? 0),
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
    await emailOrderPlaced(supabase, created, guestFields, buyerEmail, isCod);

    return res.status(200).json({
      orders: created.map(({ id, order_number, boutique_id, total, platform_discount, cod_fee, shipping_fee, created_at }) => ({
        id,
        order_number,
        boutique_id,
        total,
        platform_discount,
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
