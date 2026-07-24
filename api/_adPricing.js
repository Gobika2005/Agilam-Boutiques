import { serviceClient } from './_supabase.js';

/**
 * Ad pricing — the single server-side source of truth for what a campaign costs.
 *
 * Mirrors api/_pricing.js for orders: the browser never sends a price. The seller
 * picks a placement + a number of days, and the amount is derived here from the
 * admin-managed `ad_placements` rate card. create-ad-order.js uses this to build
 * the Razorpay order; activate-ad.js uses it again to bind the paid amount.
 *
 * The leading underscore keeps this out of Vercel's /api routing.
 */

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const MIN_AD_DAYS = 1;
export const MAX_AD_DAYS = 90;

export function clampDays(days) {
  const n = Math.floor(Number(days) || 0);
  return Math.min(MAX_AD_DAYS, Math.max(MIN_AD_DAYS, n));
}

/**
 * Look up a placement and price a campaign of `days` days.
 *
 * Returns `{ ok: true, placement, days, rupees, paise }` when the rate card
 * answered, or `{ ok: false, reason }` when it could not. Kept apart, like
 * subtotalFromItems in create-order.js: "the rate card is unreachable" and "no
 * such placement" need different answers from the caller.
 */
export async function priceCampaign(placementCode, days) {
  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) {
    console.error('_adPricing: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing or blank');
    return { ok: false, reason: 'RATE_CARD_UNAVAILABLE' };
  }

  let placement;
  try {
    const { data, error } = await supabase
      .from('ad_placements')
      .select('code, name, daily_rate, max_active, active')
      .eq('code', placementCode)
      .maybeSingle();
    if (error) throw error;
    placement = data;
  } catch (err) {
    console.error('_adPricing: rate-card lookup failed:', err?.message ?? err);
    return { ok: false, reason: 'RATE_CARD_UNAVAILABLE' };
  }

  if (!placement || !placement.active) return { ok: false, reason: 'UNKNOWN_PLACEMENT' };

  const d = clampDays(days);
  const rupees = Math.round(Number(placement.daily_rate) * d * 100) / 100;
  const paise = Math.round(rupees * 100);
  return { ok: true, placement, days: d, rate: Number(placement.daily_rate), rupees, paise };
}
