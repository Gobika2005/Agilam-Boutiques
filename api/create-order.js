import Razorpay from 'razorpay';
import { serviceClient } from './_supabase.js';
import { computeCartPricing, loadCoupon } from './_pricing.js';
import { enforceRateLimit } from './_rateLimit.js';

/**
 * Vercel serverless function: create a Razorpay order.
 *
 * The frontend (src/lib/razorpay.ts) calls this before opening the checkout
 * modal. The secret key is read from the server-only RAZORPAY_KEY_SECRET env
 * var and never leaves this function.
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

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  if (!keyId || !keySecret) {
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
  const paise = computeCartPricing(priced.groupTotals, coupon).totalPaise;

  // Razorpay rejects anything below 100 paise (₹1).
  if (!Number.isFinite(paise) || paise < 100) {
    return res.status(400).json({ error: 'amount must be an integer of at least 100 paise' });
  }

  try {
    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order = await razorpay.orders.create({
      amount: paise,
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
    });

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: keyId, // publishable id — safe to expose to the browser
    });
  } catch (err) {
    // 401 from Razorpay means bad credentials; everything else is a server-side failure.
    const status = err?.statusCode === 401 ? 401 : 500;
    console.error('Razorpay order creation failed:', err?.error ?? err);
    return res.status(status).json({ error: 'Could not create payment order' });
  }
}
