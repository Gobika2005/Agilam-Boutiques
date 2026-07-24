import Razorpay from 'razorpay';
import { serviceClient } from './_supabase.js';
import { enforceRateLimit } from './_rateLimit.js';

/**
 * Vercel serverless function: admin rejects a paid ad and refunds the seller.
 *
 * Admin-only. Reads the campaign with the service role, refunds the captured
 * Razorpay payment for the full amount, then records the state via
 * mark_ad_refunded. The refund is issued BEFORE the status flip so a failed
 * refund leaves the campaign untouched (and reported) rather than marked
 * refunded with the seller's money still taken.
 */

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Anything paid but not already refunded can be refunded.
const REFUNDABLE = ['pending_review', 'scheduled', 'live', 'paused', 'rejected', 'expired'];

async function authenticateAdmin(supabase, req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, error: 'Missing admin session' };

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) return { ok: false, status: 401, error: 'Invalid admin session' };

  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('id, role, status, deleted_at').eq('id', authData.user.id).maybeSingle();
  if (profileError) return { ok: false, status: 500, error: 'Could not verify admin access' };
  if (!profile || profile.role !== 'admin' || profile.status !== 'active' || profile.deleted_at) {
    return { ok: false, status: 403, error: 'Admin access required' };
  }
  return { ok: true, adminId: authData.user.id };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(req, res, { key: 'refund-ad', limit: 30, windowMs: 60_000 }))) return;

  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) return res.status(500).json({ error: 'Ad service is not configured' });

  const auth = await authenticateAdmin(supabase, req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { campaignId, reason } = req.body ?? {};
  if (!campaignId) return res.status(400).json({ error: 'campaignId is required' });

  try {
    const { data: campaign, error: campErr } = await supabase
      .from('ad_campaigns').select('id, status, payment_id, amount').eq('id', campaignId).maybeSingle();
    if (campErr) throw campErr;
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status === 'refunded') {
      return res.status(409).json({ error: 'This ad has already been refunded.' });
    }
    if (!REFUNDABLE.includes(campaign.status) || !campaign.payment_id) {
      return res.status(400).json({ error: 'This ad has no captured payment to refund.' });
    }

    const razorpay = keyId && keySecret ? new Razorpay({ key_id: keyId, key_secret: keySecret }) : null;
    if (!razorpay) return res.status(500).json({ error: 'Refunds are not configured' });

    const amountPaise = Math.round(Number(campaign.amount) * 100);
    try {
      await razorpay.payments.refund(campaign.payment_id, { amount: amountPaise, speed: 'optimum' });
    } catch (e) {
      // A payment already fully refunded on Razorpay's side is fine — treat as done.
      const desc = e?.error?.description || '';
      const alreadyRefunded = /fully refunded|already been refunded/i.test(desc);
      if (!alreadyRefunded) {
        console.error('refund-ad: Razorpay refund failed:', e?.error ?? e);
        return res.status(502).json({ error: 'Could not issue the refund. The ad was left unchanged.' });
      }
    }

    const { data: updated, error: markErr } = await supabase.rpc('mark_ad_refunded', {
      p_id: campaignId,
      p_reason: typeof reason === 'string' ? reason : null,
    });
    if (markErr) {
      console.error('refund-ad: mark_ad_refunded failed (refund WAS issued):', markErr?.message ?? markErr);
      return res.status(500).json({ error: 'Refund issued but status update failed. Please refresh.' });
    }

    return res.status(200).json({ campaign: updated, refunded: true });
  } catch (err) {
    console.error('refund-ad failed:', err?.message ?? err);
    return res.status(500).json({ error: 'Could not refund the ad. Please try again.' });
  }
}
