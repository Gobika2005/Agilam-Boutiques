import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { serviceClient } from './_supabase.js';
import { priceCampaign } from './_adPricing.js';
import { enforceRateLimit } from './_rateLimit.js';

/**
 * Vercel serverless function: settle a paid ad campaign.
 *
 * The ad equivalent of api/place-order.js. After the Razorpay modal succeeds the
 * Promote screen calls this with the signed payment. We:
 *   1. verify the HMAC signature (payment belongs to this order);
 *   2. confirm the caller owns the boutique behind the draft;
 *   3. re-price the campaign server-side and BIND the paid amount to it — a ₹1
 *      payment can't settle a ₹3,000 campaign;
 *   4. capture the payment if it is merely authorised;
 *   5. move the campaign to 'pending_review' via activate_ad_campaign (the unique
 *      payment_id column is the structural replay guard).
 * Any mismatch auto-refunds, mirroring place-order.
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

async function refundPayment(razorpay, paymentId, amountPaise) {
  if (!razorpay || !paymentId || !(amountPaise > 0)) return;
  try {
    await razorpay.payments.refund(paymentId, { amount: amountPaise, speed: 'optimum' });
  } catch (e) {
    console.error('activate-ad: auto-refund failed for', paymentId, e?.error ?? e);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(req, res, { key: 'activate-ad', limit: 20, windowMs: 60_000 }))) return;

  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) {
    console.error('activate-ad: Supabase service role missing');
    return res.status(500).json({ error: 'Ad service is not configured' });
  }

  const { campaignId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};
  if (!campaignId) return res.status(400).json({ error: 'campaignId is required' });

  const payment = { razorpay_order_id, razorpay_payment_id, razorpay_signature };
  if (!verifySignature(payment)) {
    return res.status(400).json({ error: 'Payment could not be verified' });
  }

  const razorpay = keyId && keySecret ? new Razorpay({ key_id: keyId, key_secret: keySecret }) : null;
  if (!razorpay) return res.status(500).json({ error: 'Payment verification is not configured' });

  // Owner check.
  const authHeader = req.headers?.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  let uid = null;
  if (token) {
    try {
      const { data } = await supabase.auth.getUser(token);
      uid = data?.user?.id ?? null;
    } catch { /* invalid token */ }
  }
  if (!uid) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });

  try {
    const { data: campaign, error: campErr } = await supabase
      .from('ad_campaigns')
      .select('id, boutique_id, placement_code, days, start_date, status')
      .eq('id', campaignId)
      .maybeSingle();
    if (campErr) throw campErr;
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const { data: boutique, error: bErr } = await supabase
      .from('boutiques').select('id, owner_id').eq('id', campaign.boutique_id).maybeSingle();
    if (bErr) throw bErr;
    if (!boutique || boutique.owner_id !== uid) {
      return res.status(403).json({ error: 'You can only pay for your own boutique’s ads.' });
    }

    // Replay guard (belt to the unique-column braces): a payment settles one ad.
    const { data: dup, error: dupErr } = await supabase
      .from('ad_campaigns').select('id').eq('payment_id', razorpay_payment_id).limit(1).maybeSingle();
    if (dupErr) throw dupErr;
    if (dup) return res.status(409).json({ error: 'This payment has already activated an ad.' });

    if (campaign.status !== 'pending_payment') {
      return res.status(409).json({ error: 'This campaign has already been paid for.' });
    }

    const priced = await priceCampaign(campaign.placement_code, campaign.days);
    if (!priced.ok) {
      // We cannot confirm what was owed — do not settle. The payment stays
      // captured and the webhook/operator can reconcile.
      return res.status(503).json({ error: 'We can’t confirm this ad right now. Please contact support.' });
    }
    const expectedPaise = priced.paise;

    // Bind the paid amount to the campaign.
    let rzPayment;
    try {
      rzPayment = await razorpay.payments.fetch(razorpay_payment_id);
    } catch (e) {
      console.error('activate-ad: could not fetch payment:', e?.error ?? e);
      return res.status(502).json({ error: 'Could not confirm the payment. Please contact support before retrying.' });
    }

    if (rzPayment?.order_id !== razorpay_order_id) {
      return res.status(400).json({ error: 'Payment could not be verified' });
    }
    const paidPaise = Number(rzPayment.amount) || 0;
    if (rzPayment.status === 'failed' || rzPayment.status === 'refunded') {
      return res.status(400).json({ error: 'That payment did not go through. Please try again.' });
    }
    if (rzPayment.status !== 'captured' && rzPayment.status !== 'authorized') {
      return res.status(400).json({ error: 'Payment is not confirmed yet. Please wait a moment and try again.' });
    }
    if (paidPaise !== expectedPaise || rzPayment.currency !== 'INR') {
      console.error('activate-ad: amount mismatch', { paidPaise, expectedPaise });
      await refundPayment(razorpay, razorpay_payment_id, paidPaise);
      return res.status(400).json({ error: 'Paid amount did not match the ad price; your payment has been refunded.' });
    }

    if (rzPayment.status === 'authorized') {
      try {
        await razorpay.payments.capture(razorpay_payment_id, expectedPaise, 'INR');
      } catch (e) {
        let captured = false;
        try {
          const after = await razorpay.payments.fetch(razorpay_payment_id);
          captured = after?.status === 'captured';
        } catch { /* fall through */ }
        if (!captured) {
          console.error('activate-ad: capture failed:', e?.error ?? e);
          return res.status(502).json({ error: 'Could not confirm the payment. Please contact support before retrying.' });
        }
      }
    }

    // Settle → pending_review. start_date defaults to today when the seller left
    // it blank; end_date is derived from days inside the function.
    const startDate = campaign.start_date || new Date().toISOString().slice(0, 10);
    const { data: activated, error: actErr } = await supabase.rpc('activate_ad_campaign', {
      p_id: campaignId,
      p_order_id: razorpay_order_id,
      p_payment_id: razorpay_payment_id,
      p_rate: priced.rate,
      p_days: priced.days,
      p_start: startDate,
    });
    if (actErr) {
      console.error('activate-ad: activate_ad_campaign failed:', actErr?.message ?? actErr);
      // Money is captured but we couldn't record it — refund rather than take it.
      await refundPayment(razorpay, razorpay_payment_id, paidPaise);
      return res.status(500).json({ error: 'Could not activate the ad; your payment has been refunded.' });
    }

    return res.status(200).json({ campaign: activated, status: 'pending_review' });
  } catch (err) {
    console.error('activate-ad failed:', err?.message ?? err);
    return res.status(500).json({ error: 'Could not activate the ad. Please contact support.' });
  }
}
