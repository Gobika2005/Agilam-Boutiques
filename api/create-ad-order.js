import Razorpay from 'razorpay';
import { serviceClient } from './_supabase.js';
import { priceCampaign } from './_adPricing.js';
import { enforceRateLimit } from './_rateLimit.js';

/**
 * Vercel serverless function: create a Razorpay order for an ad campaign.
 *
 * The seller's Promote screen saves a draft campaign (status 'pending_payment')
 * then calls this before opening checkout. The amount is derived server-side from
 * the draft's placement + days via the `ad_placements` rate card — the browser's
 * figure is never trusted, exactly like api/create-order.js.
 *
 * Ownership is enforced: the caller's Supabase access token must belong to the
 * boutique that owns the draft, so one seller can't pay against another's draft.
 * The placement's `max_active` cap is checked here so an oversubscribed slot is
 * refused before any money moves.
 */

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// States that occupy a placement's inventory for the campaign's window.
const OCCUPYING = ['pending_review', 'scheduled', 'live', 'paused'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(req, res, { key: 'create-ad-order', limit: 20, windowMs: 60_000 }))) return;

  if (!keyId || !keySecret) {
    return res.status(401).json({ error: 'Razorpay credentials are not configured' });
  }

  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) {
    console.error('create-ad-order: Supabase service role missing');
    return res.status(500).json({ error: 'Ad service is not configured' });
  }

  const { campaignId } = req.body ?? {};
  if (!campaignId) return res.status(400).json({ error: 'campaignId is required' });

  // Who is asking — must own the boutique behind the draft.
  const authHeader = req.headers?.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Please sign in as a seller to buy an ad.' });

  let uid = null;
  try {
    const { data } = await supabase.auth.getUser(token);
    uid = data?.user?.id ?? null;
  } catch {
    /* invalid token → uid stays null */
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
    if (campaign.status !== 'pending_payment') {
      return res.status(409).json({ error: 'This campaign has already been paid for.' });
    }

    const { data: boutique, error: bErr } = await supabase
      .from('boutiques')
      .select('id, owner_id')
      .eq('id', campaign.boutique_id)
      .maybeSingle();
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

    // Inventory cap: how many campaigns already occupy this placement's slot?
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

    // Stamp the draft so the webhook backstop can settle it if the browser dies
    // after capture but before activate-ad runs. Best-effort — the sync path
    // doesn't depend on it.
    const { error: refErr } = await supabase.rpc('set_ad_order_ref', { p_id: campaignId, p_order_id: order.id });
    if (refErr) console.error('create-ad-order: set_ad_order_ref failed (non-fatal):', refErr?.message ?? refErr);

    return res.status(200).json({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: keyId,
    });
  } catch (err) {
    const status = err?.statusCode === 401 ? 401 : 500;
    console.error('create-ad-order failed:', err?.error ?? err?.message ?? err);
    return res.status(status).json({ error: 'Could not start the ad payment. Please try again.' });
  }
}
