/**
 * Server-side platform settings — the admin-editable commercial terms.
 *
 * The mirror of src/data/settings.ts. api/_pricing.js prices every cart from
 * these values and api/place-order.js asserts the Razorpay payment matches, so
 * the server must read the same `platform_settings` row the console writes.
 * Before this existed the server priced from hardcoded constants, which meant
 * changing the COD fee or delivery threshold in the admin console would have
 * made the server reject legitimate checkouts as underpaid.
 *
 * The defaults below mirror POLICY_TERMS in src/data/company.ts — the numbers
 * the buyer policy pages publish. They apply when the table is missing
 * (migration 0048 not yet applied) or unreadable, so a settings outage prices
 * carts at the published terms rather than failing checkout.
 *
 * The leading underscore keeps this out of Vercel's /api routing.
 */

/**
 * Delivery and COD are NOT here any more. Since migration 0076 the delivery
 * charge, the free-delivery threshold, the cash-handling fee and the COD cap
 * are each boutique's own (`api/_pricing.js` → `loadShopTerms`), so the four
 * columns they used to occupy in `platform_settings` are no longer read by
 * anything. What remains is genuinely platform-wide: the commission the
 * marketplace takes, the returns window it publishes, and how long a payout is
 * held before it transfers.
 */
export const DEFAULT_TERMS = {
  commission_pct: 10,
  return_window_days: 7,
  payout_hold_days: 3,
};

const NUMERIC = Object.keys(DEFAULT_TERMS);

/**
 * Read the settings row, falling back to the published defaults on any failure.
 * Never throws and never returns a partial object: a missing or non-numeric
 * column keeps its default rather than turning a fee into NaN and pricing the
 * whole cart at NaN paise.
 */
export async function loadTerms(supabase) {
  if (!supabase) return { ...DEFAULT_TERMS };
  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select(NUMERIC.join(','))
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) {
      if (error) console.error('loadTerms failed:', error.message ?? error);
      return { ...DEFAULT_TERMS };
    }
    const terms = { ...DEFAULT_TERMS };
    for (const key of NUMERIC) {
      const n = Number(data[key]);
      if (Number.isFinite(n) && n >= 0) terms[key] = n;
    }
    return terms;
  } catch (e) {
    console.error('loadTerms threw:', e?.message ?? e);
    return { ...DEFAULT_TERMS };
  }
}

/**
 * The platform-wide cash-on-delivery switch (migration 0066).
 *
 * Read in its OWN query rather than joining the list above, and that separation
 * is deliberate. Postgres fails a SELECT naming a column that does not exist —
 * the whole SELECT, not just that column — so folding `cod_enabled` into
 * loadTerms would mean that on any deploy where 0066 has not been applied,
 * every commercial term silently collapses to its default. Changing the COD
 * flag must not be able to reprice a cart.
 *
 * Defaults to true on any failure: an unreadable switch leaves COD exactly as
 * it was rather than cutting off a payment method nobody asked to disable.
 */
export async function loadCodSwitch(supabase) {
  if (!supabase) return true;
  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('cod_enabled')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return true;
    return data.cod_enabled !== false;
  } catch {
    return true;
  }
}
