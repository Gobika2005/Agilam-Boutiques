import { enforceRateLimit } from './_rateLimit.js';
import { configuredAccounts, verifyPaymentSignature } from './_razorpay.js';
import { refundOrder } from './_refunds.js';

/**
 * Vercel serverless function: the payment-side operations that aren't checkout.
 *
 * Two actions share one function because the Hobby plan caps a deployment at 12
 * Serverless Functions and api/ is already at 12 — the same consolidation
 * api/ads.js does for the four ad endpoints. The handlers stay in their own
 * files; this only routes and rate-limits.
 *
 *   POST /api/verify-payment  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *       → verify a checkout signature (buyer, unauthenticated). The default:
 *         a body with no `action` behaves exactly as it always has.
 *
 *   POST /api/verify-payment  { action: 'refund-order', orderId, reason }
 *       → issue a real Razorpay refund for an order (admin only, ./_refunds.js).
 *
 * ── Signature verification ──────────────────────────────────────────────────
 * Razorpay signs `order_id|payment_id` with HMAC-SHA256 keyed by the secret.
 * We recompute it here and only report success on an exact, constant-time
 * match — the secret key stays server-side.
 *
 * The check runs against EVERY configured merchant account, not just the one
 * the admin switch currently selects: a buyer whose order was opened seconds
 * before an emergency account switch still holds a genuine signature from the
 * old account, and rejecting it would leave them charged with no order.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = req.body?.action;

  if (action === 'refund-order') {
    // Tighter than the verify path on purpose: this one moves money, and a
    // legitimate admin never needs more than a handful a minute.
    if (!(await enforceRateLimit(req, res, { key: 'refund-order', limit: 10, windowMs: 60_000 }))) return;
    return refundOrder(req, res);
  }

  if (!(await enforceRateLimit(req, res, { key: 'verify-payment', limit: 30, windowMs: 60_000 }))) return;

  if (configuredAccounts().length === 0) {
    return res.status(401).json({ error: 'Razorpay credentials are not configured' });
  }

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ verified: false, error: 'Missing payment verification fields' });
  }

  // Constant-time comparison per account; returns the account that signed it.
  const account = verifyPaymentSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature });

  if (!account) {
    return res.status(400).json({ verified: false, error: 'Signature verification failed' });
  }

  return res.status(200).json({
    verified: true,
    payment_id: razorpay_payment_id,
    order_id: razorpay_order_id,
  });
}
