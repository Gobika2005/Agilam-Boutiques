import { serviceClient } from './_supabase.js';
import { computeCartPricing, loadCoupon, loadShopTerms } from './_pricing.js';
import { enforceRateLimit } from './_rateLimit.js';
import { activeAccount, clientFor, configuredAccounts } from './_razorpay.js';

/**
 * Vercel serverless function: create a Razorpay order.
 *
 * The frontend (src/lib/razorpay.ts) calls this before opening the checkout
 * modal. The secret key is read from the server-only RAZORPAY_KEY_SECRET env
 * var and never leaves this function.
 *
 * WHICH account collects the money is the admin switch in Settings, resolved
 * per request by api/_razorpay.js — this is the only endpoint that follows it.
 * The publishable key id of the account the order was actually opened on is
 * returned so the browser opens checkout against the matching merchant.
 *
 * Amount authority (defense-in-depth): the browser sends the cart `items`
 * (product ids + quantities) and an optional `couponCode`; the server looks up
 * authoritative prices from the DB and derives the exact paise via the shared
 * `_pricing.js` rules — the same value api/place-order.js re-verifies at
 * settlement. So the Razorpay order is created for a server-trusted amount and a
 * tampered client can't even open checkout at the wrong price.
 *
 * `items` are mandatory: the server always derives the amount from the DB, and a
 * request without priceable items is rejected rather than trusting any
 * browser-supplied figure (see the fail-closed note in the handler).
 */

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * The signed-in buyer behind this request, or null.
 *
 * An *anonymous* Supabase user is not a buyer: opening a chat signs the browser
 * in anonymously (src/data/chat.ts), so a token alone proves nothing about who
 * is paying. Only a real account (email/password or Google) counts.
 */
async function authedBuyer(supabase, req) {
  const authHeader = req.headers?.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;
  try {
    const { data } = await supabase.auth.getUser(token);
    const user = data?.user;
    return user && !user.is_anonymous ? user : null;
  } catch {
    return null; // expired or malformed token — treat as signed out
  }
}

/**
 * Group the server-priced goods value for the given cart items by boutique.
 *
 * Returns `{ ok: true, groupTotals }` (a `{ boutiqueId: rupees }` map) when the
 * catalogue answered, or `{ ok: false, reason }` when it could not. The two are
 * kept apart on purpose: "the catalogue is unreachable" and "none of these
 * products exist" need opposite answers from the caller, and collapsing them
 * into a single `null` is what previously let an unreachable database turn into
 * a real charge. The per-boutique breakdown is what lets a seller coupon price
 * against just its own boutique's items.
 */
async function groupTotalsFromItems(supabase, items) {
  const ids = [...new Set(items.map((it) => it?.product_id).filter(Boolean))];
  if (ids.length === 0) return { ok: false, reason: 'EMPTY_CART' };

  let products;
  try {
    // Only live products can be priced/sold: moderation-hidden, rejected, pending
    // and soft-deleted rows are excluded so a pulled item can't open checkout.
    // (The service role bypasses RLS, so this filter must be explicit.)
    const { data, error } = await supabase
      .from('products')
      .select('id, price, boutique_id')
      .in('id', ids)
      .eq('status', 'active')
      .is('deleted_at', null);
    if (error) throw error;
    products = data;
  } catch (err) {
    // Bad/expired service-role key, a paused project, a network blip — all land
    // here, and all mean the same thing: we cannot price this cart right now.
    console.error('create-order: catalogue lookup failed:', err?.message ?? err);
    return { ok: false, reason: 'CATALOGUE_UNAVAILABLE' };
  }

  const byId = new Map((products ?? []).map((p) => [p.id, p]));
  const groupTotals = {};
  let matched = 0;
  for (const it of items) {
    const p = byId.get(it?.product_id);
    if (!p) continue;
    const qty = Math.max(1, Math.floor(Number(it.qty) || 1));
    groupTotals[p.boutique_id] = (groupTotals[p.boutique_id] ?? 0) + Number(p.price) * qty;
    matched += 1;
  }
  return matched === 0 ? { ok: false, reason: 'EMPTY_CART' } : { ok: true, groupTotals };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(req, res, { key: 'create-order', limit: 20, windowMs: 60_000 }))) return;

  if (configuredAccounts().length === 0) {
    return res.status(401).json({ error: 'Razorpay credentials are not configured' });
  }

  const { items, couponCode, currency = 'INR', receipt } = req.body ?? {};

  // The cart is the only price authority. The browser's own `amount` is never
  // trusted, so a request that carries no server-priceable items cannot open
  // checkout — there is no client-amount fallback to abuse.
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Add items to your bag before paying.', code: 'ITEMS_REQUIRED' });
  }

  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) {
    console.error('create-order: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing or blank');
    return res.status(503).json({
      error: 'We can’t take payments right now. Nothing has been charged — please try again in a few minutes.',
      code: 'CATALOGUE_UNAVAILABLE',
    });
  }

  // ── Sign-in required ───────────────────────────────────────────────────
  // Orders belong to accounts, so checkout does not open for a signed-out
  // browser. Refusing here (before Razorpay is called) rather than only at
  // settlement is deliberate: place-order rejecting the same request would do
  // it with the money already captured. Nothing has been charged at this point.
  if (!(await authedBuyer(supabase, req))) {
    return res.status(401).json({
      error: 'Please sign in to place your order.',
      code: 'SIGN_IN_REQUIRED',
    });
  }

  const priced = await groupTotalsFromItems(supabase, items);

  // ── Fail closed ────────────────────────────────────────────────────────
  // Never open checkout on an amount we couldn't derive from the DB. Both this
  // function and place-order depend on the SAME service-role client, so if the
  // catalogue can't be read here, place-order's first query fails too. Opening
  // checkout anyway takes the buyer's money and then guarantees "Could not place
  // the order" — charged, with nothing to show for it. Refusing to start is the
  // only honest outcome; the bag is untouched and the buyer can retry for free.
  if (!priced.ok) {
    if (priced.reason === 'EMPTY_CART') {
      return res.status(400).json({
        error: 'The items in your bag are no longer available. Please refresh your bag and try again.',
        code: 'EMPTY_CART',
      });
    }
    return res.status(503).json({
      error: 'We can’t take payments right now. Nothing has been charged — please try again in a few minutes.',
      code: 'CATALOGUE_UNAVAILABLE',
    });
  }

  // The coupon (if any) is re-fetched and applied here so the Razorpay order is
  // opened for the exact discounted amount place-order will re-verify.
  const coupon = await loadCoupon(supabase, couponCode);
  // Delivery is each boutique's own charge (migration 0076), so the terms come
  // from the shops in the bag rather than from platform settings.
  const shops = await loadShopTerms(supabase, Object.keys(priced.groupTotals));
  const paise = computeCartPricing(priced.groupTotals, coupon, false, shops).totalPaise;

  // Razorpay rejects anything below 100 paise (₹1).
  //
  // The interesting case is a bag whose payable total is legitimately zero — a
  // 100%-off coupon on an order that already ships free. That is a coupon
  // configuration the admin console permits, and the buyer met every condition,
  // so blaming them with the gateway's raw "amount must be an integer of at
  // least 100 paise" was both unintelligible and unfair. Say which of the two
  // it is, and point at the coupon when the coupon is the reason.
  if (!Number.isFinite(paise) || paise < 100) {
    const zeroedByCoupon = coupon && paise === 0;
    return res.status(400).json({
      error: zeroedByCoupon
        ? 'This coupon covers your whole order, so there is nothing left to pay online. Please remove the coupon, or ask the boutique to complete this order for you.'
        : 'This order is below the ₹1 minimum we can charge online. Please add something else to your bag.',
      code: zeroedByCoupon ? 'COUPON_ZEROES_TOTAL' : 'AMOUNT_TOO_LOW',
    });
  }

  // The account the admin switch currently points at. Resolved from the same
  // service client used above, so a settings read failure degrades to 'primary'
  // rather than failing the checkout.
  const account = await activeAccount(supabase);
  if (!account) {
    return res.status(401).json({ error: 'Razorpay credentials are not configured' });
  }

  try {
    const order = await clientFor(account).orders.create({
      amount: paise,
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
    });

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: account.keyId, // publishable id — safe to expose to the browser
      // Whether the code the browser sent actually priced this order.
      //
      // It can legitimately not have: `loadCoupon` returns null for a code that
      // is expired, deactivated, or has hit its redemption cap since the buyer
      // applied it. The cap is the one the browser CANNOT see — `usage_limit`
      // and `used_count` are deliberately withheld from the buyer's column list
      // so a stranger can't count redemptions — so the bag went on showing a
      // discount that no longer existed and the buyer was quietly charged the
      // full amount. Reporting it lets the client stop and say so instead.
      couponApplied: Boolean(coupon),
    });
  } catch (err) {
    // 401 from Razorpay means bad credentials; everything else is a server-side failure.
    const status = err?.statusCode === 401 ? 401 : 500;
    console.error(`Razorpay order creation failed on the '${account.key}' account:`, err?.error ?? err);
    return res.status(status).json({ error: 'Could not create payment order' });
  }
}
