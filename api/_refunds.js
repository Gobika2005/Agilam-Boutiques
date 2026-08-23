import { serviceClient } from './_supabase.js';
import { configuredAccounts, clientFor, findPaymentAccount } from './_razorpay.js';

/**
 * Admin-initiated refunds that actually move the money.
 *
 * /admin/refunds used to write `orders.refunded = true` and stop there. The
 * console said "Refunded", the payout run stopped counting the order as owed to
 * the seller, and the buyer's money stayed in the merchant account until someone
 * opened the Razorpay dashboard by hand. This is the missing half.
 *
 * The leading underscore keeps this out of Vercel's /api routing — the Hobby
 * plan caps a deployment at 12 Serverless Functions and api/ is already at 12,
 * so this is reached through `POST /api/verify-payment` with
 * `action: 'refund-order'`, the same consolidation trick api/ads.js uses.
 *
 * ── What gets refunded ──────────────────────────────────────────────────────
 * NOT `orders.total`. One Razorpay payment can cover several orders — a cart
 * spanning three boutiques writes three rows against one payment — and each row
 * carries its own slice of the money. What the buyer actually paid for one order
 * is, from api/place-order.js:669-714,
 *
 *     total + shipping_fee - platform_discount
 *
 * `total` alone omits the seller's delivery charge (which the buyer paid and
 * must get back) and includes the platform-funded coupon discount (which the
 * buyer never paid, and refunding it would hand them our money). The refund
 * console showed `total` for years; it was only ever a display, and now that the
 * number is wired to the gateway it has to be the right one.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * Three layers, because this one moves real money:
 *   1. `refund_id is not null` → refuse before calling Razorpay at all.
 *   2. Razorpay's own "already fully refunded" error is treated as success.
 *   3. `orders_refund_id_uniq` (0097) makes a double-write impossible even if
 *      two admins press the button in the same second.
 */

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function callerId(supabase, req) {
  const authHeader = req.headers?.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;
  try {
    const { data } = await supabase.auth.getUser(token);
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Admin only — never staff. The staff role (0086) is deliberately the admin
 * console minus money, and this is money leaving the platform.
 */
async function authenticateAdmin(supabase, req) {
  const uid = await callerId(supabase, req);
  if (!uid) return { ok: false, status: 401, error: 'Invalid admin session' };
  const { data: profile, error } = await supabase
    .from('profiles').select('id, role, status, deleted_at').eq('id', uid).maybeSingle();
  if (error) return { ok: false, status: 500, error: 'Could not verify admin access' };
  if (!profile || profile.role !== 'admin' || profile.status !== 'active' || profile.deleted_at) {
    return { ok: false, status: 403, error: 'Admin access required' };
  }
  return { ok: true, adminId: uid };
}

/** What the buyer actually paid for this one order, in rupees. */
export function buyerPaidRupees(order) {
  return Number(order.total ?? 0) + Number(order.shipping_fee ?? 0) - Number(order.platform_discount ?? 0);
}

export async function refundOrder(req, res) {
  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) return res.status(500).json({ error: 'Refunds are not configured' });

  const auth = await authenticateAdmin(supabase, req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { orderId, reason } = req.body ?? {};
  if (!orderId) return res.status(400).json({ error: 'orderId is required' });

  try {
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_number, payment_id, payment_status, payment_method, total, shipping_fee, platform_discount, refunded, refund_id, refund_status')
      .eq('id', orderId)
      .maybeSingle();
    if (orderErr) throw orderErr;
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Layer 1. A refund already went through the gateway for this order — with
    // one exemption: a refund Razorpay reported as FAILED never reached the
    // buyer, so that order is refundable again and a fresh attempt is the whole
    // point of leaving it in the workbench.
    if (order.refund_id && order.refund_status !== 'failed') {
      return res.status(409).json({
        error: `This order was already refunded (${order.refund_id}).`,
        refund_id: order.refund_id,
        refund_status: order.refund_status,
      });
    }

    // Pre-0085 cash orders have no payment_id: the seller took the money at the
    // door, so there is nothing here to reverse and the refund is between the
    // seller and the buyer. Same for an order that never captured.
    if (!order.payment_id) {
      return res.status(400).json({
        error: order.payment_method === 'cod'
          ? 'This was a cash order — no online payment to refund.'
          : 'This order has no captured payment to refund.',
      });
    }
    if (order.payment_status === 'failed') {
      return res.status(400).json({ error: 'That payment never went through; there is nothing to refund.' });
    }

    const amountRupees = buyerPaidRupees(order);
    const amountPaise = Math.round(amountRupees * 100);
    if (!(amountPaise > 0)) {
      return res.status(400).json({ error: 'This order has no refundable amount.' });
    }

    if (configuredAccounts().length === 0) {
      return res.status(500).json({ error: 'Razorpay credentials are not configured' });
    }

    // An admin refund arrives with no signature to identify the merchant
    // account, and the order may pre-date an account switch — so locate the
    // account that actually holds the payment. Refunding blind on the currently
    // active account fails with a misleading "payment does not exist".
    const found = await findPaymentAccount(order.payment_id);
    if (!found.account) {
      console.error('refund-order: payment not found on any Razorpay account:', order.payment_id, found.error);
      return res.status(502).json({ error: 'Could not reach that payment at Razorpay. The order was left unchanged.' });
    }

    // Never send back more than is left on the payment. This is what stops a
    // multi-boutique cart — three orders, one payment — from over-refunding when
    // the sibling orders have already been refunded.
    const paidPaise = Number(found.payment?.amount) || 0;
    const alreadyPaise = Number(found.payment?.amount_refunded) || 0;
    const availablePaise = paidPaise - alreadyPaise;
    if (amountPaise > availablePaise) {
      console.error('refund-order: would over-refund', {
        order: order.order_number, amountPaise, availablePaise, paidPaise, alreadyPaise,
      });
      return res.status(409).json({
        error: `Only ₹${(availablePaise / 100).toFixed(2)} is left on that payment, but this order needs ₹${amountRupees.toFixed(2)}. Refund it in the Razorpay dashboard and check the other orders on this payment.`,
      });
    }

    const razorpay = clientFor(found.account);
    let refund = null;
    let alreadyAtGateway = false;
    try {
      refund = await razorpay.payments.refund(order.payment_id, {
        amount: amountPaise,
        speed: 'optimum',
        notes: {
          order_number: String(order.order_number ?? ''),
          reason: typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : 'Admin refund',
        },
      });
    } catch (e) {
      const desc = e?.error?.description || e?.message || '';
      if (/fully refunded|already been refunded/i.test(desc)) {
        // Layer 2. Someone refunded it in the dashboard before pressing this
        // button. The money is back with the buyer either way, so record it
        // rather than failing — but without inventing a refund id we never saw.
        alreadyAtGateway = true;
      } else {
        console.error('refund-order: Razorpay refund failed:', e?.error ?? e);
        return res.status(502).json({ error: 'Razorpay refused the refund. The order was left unchanged.' });
      }
    }

    // Money has moved. Everything from here is recording, and a failure to
    // record is loud — an unrecorded refund is one the payout run will still
    // pay the seller for.
    const status = alreadyAtGateway ? 'processed' : (refund?.status === 'processed' ? 'processed' : 'pending');
    const { data: updated, error: markErr } = await supabase.rpc('mark_order_refunded', {
      p_order_id: order.id,
      p_refund_id: refund?.id ?? null,
      p_amount: amountRupees,
      p_status: status,
      p_reason: alreadyAtGateway
        ? 'Already refunded at Razorpay before this was pressed'
        : (typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : null),
    });
    if (markErr) {
      console.error(
        'refund-order: REFUND ISSUED BUT NOT RECORDED — order', order.order_number,
        'refund', refund?.id, markErr?.message ?? markErr,
      );
      return res.status(500).json({
        error: `The refund went through at Razorpay${refund?.id ? ` (${refund.id})` : ''} but could not be recorded. Do NOT refund again — contact support.`,
      });
    }

    return res.status(200).json({
      refunded: true,
      order: updated ?? null,
      refund_id: refund?.id ?? null,
      refund_status: status,
      amount: amountRupees,
      account: found.account.key,
    });
  } catch (err) {
    console.error('refund-order failed:', err?.message ?? err);
    return res.status(500).json({ error: 'Could not issue the refund. Please try again.' });
  }
}
