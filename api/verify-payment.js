import { enforceRateLimit } from './_rateLimit.js';
import { configuredAccounts, verifyPaymentSignature } from './_razorpay.js';

/**
 * Vercel serverless function: verify a Razorpay payment signature.
 *
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
