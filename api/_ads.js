import crypto from 'node:crypto';
import Razorpay from 'razorpay';
import { serviceClient } from './_supabase.js';
import { priceCampaign } from './_adPricing.js';

/**
 * Ad endpoint logic, shared by the single `api/ads.js` router.
 *
 * These used to be four separate Vercel functions (create-ad-order, activate-ad,
 * refund-ad, run-ad-lifecycle). The Hobby plan caps a deployment at 12 Serverless
 * Functions and the marketplace was already near it, so the four routes are now
 * one function that dispatches on `action`; this module (leading underscore →
 * not itself a route) holds the handlers so ads.js stays a thin dispatcher.
 *
 * The payment paths mirror api/place-order.js exactly: server-side pricing from
 * the `ad_placements` rate card, signature verification, amount binding, capture
 * of an authorised payment, replay guard on the unique payment_id, and an
 * auto-refund on any mismatch.
 */

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adCronSecret = process.env.AD_CRON_SECRET || process.env.PAYOUT_CRON_SECRET;
const vercelCronSecret = process.env.CRON_SECRET;

// States that occupy a placement's inventory for the campaign's window.
const OCCUPYING = ['pending_review', 'scheduled', 'live', 'paused'];
// Anything paid but not already refunded can be refunded.
const REFUNDABLE = ['pending_review', 'scheduled', 'live', 'paused', 'rejected', 'expired'];

function present(v) {
  return typeof v === 'string' && v.trim() !== '' && v.trim() !== 'undefined' && v.trim() !== 'null';
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function verifySignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  if (!keySecret || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return false;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');
  return safeEqual(expected, razorpay_signature);
}

async function refundPayment(razorpay, paymentId, amountPaise) {
  if (!razorpay || !paymentId || !(amountPaise > 0)) return;
  try {
    await razorpay.payments.refund(paymentId, { amount: amountPaise, speed: 'optimum' });
  } catch (e) {
    console.error('ads: auto-refund failed for', paymentId, e?.error ?? e);
  }
}

/** The Supabase user id behind the request's bearer token, or null. */
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

// ── create-order ─────────────────────────────────────────────────────────────
export async function createAdOrder(req, res) {
  if (!keyId || !keySecret) return res.status(401).json({ error: 'Razorpay credentials are not configured' });

  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) return res.status(500).json({ error: 'Ad service is not configured' });

  const { campaignId } = req.body ?? {};
  if (!campaignId) return res.status(400).json({ error: 'campaignId is required' });

  const uid = await callerId(supabase, req);
  if (!uid) return res.status(401).json({ error: 'Please sign in as a seller to buy an ad.' });

  try {
    const { data: campaign, error: campErr } = await supabase
      .from('ad_campaigns')
      .select('id, boutique_id, placement_code, days, start_date, status')
      .eq('id', campaignId)
      .maybeSingle();
    if (campErr) throw campErr;
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'pending_payment') {
      return res.status(409).json({ error: 'This campaign has already been paid for.' });
    }

    const { data: boutique, error: bErr } = await supabase
      .from('boutiques').select('id, owner_id').eq('id', campaign.boutique_id).maybeSingle();
    if (bErr) throw bErr;
    if (!boutique || boutique.owner_id !== uid) {
      return res.status(403).json({ error: 'You can only buy ads for your own boutique.' });
    }

    const priced = await priceCampaign(campaign.placement_code, campaign.days);
    if (!priced.ok) {
      if (priced.reason === 'UNKNOWN_PLACEMENT') {
        return res.status(400).json({ error: 'That ad placement is no longer available.' });
      }
      return res.status(503).json({
        error: 'We can’t price ads right now. Nothing has been charged — please try again shortly.',
        code: 'RATE_CARD_UNAVAILABLE',
      });
    }

    const { count: occupied, error: capErr } = await supabase
      .from('ad_campaigns')
      .select('id', { count: 'exact', head: true })
      .eq('placement_code', campaign.placement_code)
      .in('status', OCCUPYING);
    if (capErr) throw capErr;
    if ((occupied ?? 0) >= priced.placement.max_active) {
      return res.status(409).json({
        error: `The “${priced.placement.name}” slot is fully booked right now. Please try again in a few days, or pick another placement.`,
        code: 'SLOT_FULL',
      });
    }

    if (!Number.isFinite(priced.paise) || priced.paise < 100) {
      return res.status(400).json({ error: 'This campaign’s price is below the minimum payable amount.' });
    }

    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order = await razorpay.orders.create({
      amount: priced.paise,
      currency: 'INR',
      receipt: `ad_${campaignId.slice(0, 30)}`,
      notes: { kind: 'ad_campaign', campaign_id: campaignId },
    });

    const { error: refErr } = await supabase.rpc('set_ad_order_ref', { p_id: campaignId, p_order_id: order.id });
    if (refErr) console.error('ads.create-order: set_ad_order_ref failed (non-fatal):', refErr?.message ?? refErr);

    return res.status(200).json({ order_id: order.id, amount: order.amount, currency: order.currency, key_id: keyId });
  } catch (err) {
    const status = err?.statusCode === 401 ? 401 : 500;
    console.error('ads.create-order failed:', err?.error ?? err?.message ?? err);
    return res.status(status).json({ error: 'Could not start the ad payment. Please try again.' });
  }
}

// ── activate ─────────────────────────────────────────────────────────────────
export async function activateAd(req, res) {
  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) return res.status(500).json({ error: 'Ad service is not configured' });

  const { campaignId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};
  if (!campaignId) return res.status(400).json({ error: 'campaignId is required' });

  if (!verifySignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature })) {
    return res.status(400).json({ error: 'Payment could not be verified' });
  }

  const razorpay = keyId && keySecret ? new Razorpay({ key_id: keyId, key_secret: keySecret }) : null;
  if (!razorpay) return res.status(500).json({ error: 'Payment verification is not configured' });

  const uid = await callerId(supabase, req);
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

    const { data: dup, error: dupErr } = await supabase
      .from('ad_campaigns').select('id').eq('payment_id', razorpay_payment_id).limit(1).maybeSingle();
    if (dupErr) throw dupErr;
    if (dup) return res.status(409).json({ error: 'This payment has already activated an ad.' });

    if (campaign.status !== 'pending_payment') {
      return res.status(409).json({ error: 'This campaign has already been paid for.' });
    }

    const priced = await priceCampaign(campaign.placement_code, campaign.days);
    if (!priced.ok) {
      return res.status(503).json({ error: 'We can’t confirm this ad right now. Please contact support.' });
    }
    const expectedPaise = priced.paise;

    let rzPayment;
    try {
      rzPayment = await razorpay.payments.fetch(razorpay_payment_id);
    } catch (e) {
      console.error('ads.activate: could not fetch payment:', e?.error ?? e);
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
      console.error('ads.activate: amount mismatch', { paidPaise, expectedPaise });
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
          console.error('ads.activate: capture failed:', e?.error ?? e);
          return res.status(502).json({ error: 'Could not confirm the payment. Please contact support before retrying.' });
        }
      }
    }

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
      console.error('ads.activate: activate_ad_campaign failed:', actErr?.message ?? actErr);
      await refundPayment(razorpay, razorpay_payment_id, paidPaise);
      return res.status(500).json({ error: 'Could not activate the ad; your payment has been refunded.' });
    }

    return res.status(200).json({ campaign: activated, status: 'pending_review' });
  } catch (err) {
    console.error('ads.activate failed:', err?.message ?? err);
    return res.status(500).json({ error: 'Could not activate the ad. Please contact support.' });
  }
}

// ── refund (admin) ───────────────────────────────────────────────────────────
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

export async function refundAd(req, res) {
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
    if (campaign.status === 'refunded') return res.status(409).json({ error: 'This ad has already been refunded.' });
    if (!REFUNDABLE.includes(campaign.status) || !campaign.payment_id) {
      return res.status(400).json({ error: 'This ad has no captured payment to refund.' });
    }

    const razorpay = keyId && keySecret ? new Razorpay({ key_id: keyId, key_secret: keySecret }) : null;
    if (!razorpay) return res.status(500).json({ error: 'Refunds are not configured' });

    const amountPaise = Math.round(Number(campaign.amount) * 100);
    try {
      await razorpay.payments.refund(campaign.payment_id, { amount: amountPaise, speed: 'optimum' });
    } catch (e) {
      const desc = e?.error?.description || '';
      if (!/fully refunded|already been refunded/i.test(desc)) {
        console.error('ads.refund: Razorpay refund failed:', e?.error ?? e);
        return res.status(502).json({ error: 'Could not issue the refund. The ad was left unchanged.' });
      }
    }

    const { data: updated, error: markErr } = await supabase.rpc('mark_ad_refunded', {
      p_id: campaignId,
      p_reason: typeof reason === 'string' ? reason : null,
    });
    if (markErr) {
      console.error('ads.refund: mark_ad_refunded failed (refund WAS issued):', markErr?.message ?? markErr);
      return res.status(500).json({ error: 'Refund issued but status update failed. Please refresh.' });
    }

    return res.status(200).json({ campaign: updated, refunded: true });
  } catch (err) {
    console.error('ads.refund failed:', err?.message ?? err);
    return res.status(500).json({ error: 'Could not refund the ad. Please try again.' });
  }
}

// ── lifecycle (cron) ─────────────────────────────────────────────────────────
function cronAuthorized(req) {
  if (!present(adCronSecret) && !present(vercelCronSecret)) return false;
  const header = req.headers?.['x-cron-secret'];
  if (present(adCronSecret) && header && safeEqual(header, adCronSecret)) return true;
  const auth = req.headers?.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (present(vercelCronSecret) && bearer && safeEqual(bearer, vercelCronSecret)) return true;
  return false;
}

export async function runAdLifecycle(req, res) {
  if (!present(adCronSecret) && !present(vercelCronSecret)) {
    return res.status(200).json({ ok: true, skipped: 'ad lifecycle cron not configured' });
  }
  if (!cronAuthorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) return res.status(500).json({ error: 'Ad service is not configured' });

  try {
    const { error } = await supabase.rpc('expire_and_activate_ads');
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('ads.lifecycle failed:', err?.message ?? err);
    return res.status(500).json({ error: 'Ad lifecycle run failed' });
  }
}
