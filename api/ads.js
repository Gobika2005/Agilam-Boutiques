import { enforceRateLimit } from './_rateLimit.js';
import { createAdOrder, activateAd, refundAd, runAdLifecycle } from './_ads.js';

/**
 * Single Vercel function for the whole ad flow, dispatching on `action`.
 *
 * Consolidated from four separate functions (create-ad-order, activate-ad,
 * refund-ad, run-ad-lifecycle) to stay under the Hobby plan's 12-function-per-
 * deployment limit. The handlers live in ./_ads.js; this only routes and
 * rate-limits.
 *
 *   POST /api/ads            { action: 'create-order' | 'activate' | 'refund', ... }
 *   GET  /api/ads?action=lifecycle    (the daily cron; cron-secret protected)
 */
export default async function handler(req, res) {
  // The lifecycle sweep is the cron path — it comes in as GET with ?action, and
  // authenticates on the cron secret rather than a user session.
  const action = req.query?.action ?? req.body?.action;

  if (action === 'lifecycle') {
    if (!(await enforceRateLimit(req, res, { key: 'ads-lifecycle', limit: 10, windowMs: 60_000 }))) return;
    return runAdLifecycle(req, res);
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(req, res, { key: 'ads', limit: 30, windowMs: 60_000 }))) return;

  switch (action) {
    case 'create-order':
      return createAdOrder(req, res);
    case 'activate':
      return activateAd(req, res);
    case 'refund':
      return refundAd(req, res);
    default:
      return res.status(400).json({ error: 'Unknown or missing ad action' });
  }
}
