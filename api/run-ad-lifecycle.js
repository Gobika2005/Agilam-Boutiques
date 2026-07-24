import crypto from 'node:crypto';
import { serviceClient } from './_supabase.js';

/**
 * Vercel serverless function: the daily ad-lifecycle run.
 *
 * Ads are visible to buyers only while `status='live'` and today is within the
 * campaign window (the public RLS policy in migration 0032), so the buyer app is
 * already correct without this. Its job is to keep the STATUS column honest for
 * the seller/admin consoles and to free a placement's max_active slot the day a
 * campaign ends:
 *   • scheduled → live   when the start date arrives;
 *   • live/scheduled → expired   once the end date has passed.
 * All of that is one SQL function, expire_and_activate_ads().
 *
 * Trigger: a daily cron (see vercel.json). Protected by AD_CRON_SECRET — accepted
 * as `x-cron-secret`, or PAYOUT_CRON_SECRET, or Vercel Cron's `Authorization:
 * Bearer <CRON_SECRET>`. With nothing configured it is an inert 200 so a
 * misconfigured deploy never 500s the scheduler.
 */

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adCronSecret = process.env.AD_CRON_SECRET || process.env.PAYOUT_CRON_SECRET;
const vercelCronSecret = process.env.CRON_SECRET;

function present(v) {
  return typeof v === 'string' && v.trim() !== '' && v.trim() !== 'undefined' && v.trim() !== 'null';
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function authorized(req) {
  if (!present(adCronSecret) && !present(vercelCronSecret)) return false;
  const header = req.headers?.['x-cron-secret'];
  if (present(adCronSecret) && header && safeEqual(header, adCronSecret)) return true;
  const auth = req.headers?.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (present(vercelCronSecret) && bearer && safeEqual(bearer, vercelCronSecret)) return true;
  return false;
}

export default async function handler(req, res) {
  // Nothing configured → inert, so a scheduler never errors on a fresh deploy.
  if (!present(adCronSecret) && !present(vercelCronSecret)) {
    return res.status(200).json({ ok: true, skipped: 'ad lifecycle cron not configured' });
  }
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) {
    console.error('run-ad-lifecycle: Supabase service role missing');
    return res.status(500).json({ error: 'Ad service is not configured' });
  }

  try {
    const { error } = await supabase.rpc('expire_and_activate_ads');
    if (error) throw error;
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('run-ad-lifecycle failed:', err?.message ?? err);
    return res.status(500).json({ error: 'Ad lifecycle run failed' });
  }
}
