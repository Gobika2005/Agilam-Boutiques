/**
 * Server-side pricing — the single source of truth for what a cart costs.
 *
 * These rules MUST stay identical to the client's pricing (src/lib/pricing.ts,
 * used by src/state/ShopContext.tsx), because api/place-order.js re-derives the
 * amount here and asserts the Razorpay order was created (and paid) for exactly
 * this many paise. Any drift between this file and the client would reject
 * legitimate checkouts, so change both together.
 *
 * Coupons live in the `coupons` table (migration 0036), not a hardcoded list.
 * `loadCoupon` fetches the row by code; `computeCartPricing` applies it:
 *   • a PLATFORM coupon (boutique_id null) discounts the whole cart and is
 *     platform-funded — it is NOT allocated to any boutique's order.
 *   • a SELLER coupon (boutique_id set) discounts only that boutique's goods and
 *     is returned in `perBoutiqueDiscount` so place-order.js can store that one
 *     boutique's order `total` net of it (which is how the seller funds it).
 *
 * The leading underscore keeps this out of Vercel's /api routing — it is a
 * helper imported by create-order.js / place-order.js, not an endpoint.
 */

// The commercial terms (COD fee and cap, delivery threshold and fee) are
// admin-editable and come from the `platform_settings` row via
// api/_settings.js — callers load them with `loadTerms(supabase)` and pass them
// in. They used to be the hardcoded constants below, which meant the Platform
// Settings page changed nothing and the client's `src/lib/pricing.ts` was the
// only place a fee could be adjusted. `DEFAULT_TERMS` is the fallback.
//
// The COD fee is per delivery — one boutique order is one cash collection —
// while the cap applies to the whole cart, so it cannot be dodged by splitting
// a large bag across several boutiques.
import { DEFAULT_TERMS } from './_settings.js';

// Mirror of baseShipFee() in src/lib/pricing.ts: flat, once per cart, free over
// the threshold — the rule published in the buyer's delivery policy. A seller's
// own `boutiques.delivery_charge` is a logistics setting on their side and is
// deliberately NOT part of what the buyer pays.
function shipFeeFor(groupTotals, terms) {
  const cartSubtotal = Object.values(groupTotals).reduce((sum, v) => sum + v, 0);
  return cartSubtotal === 0 || cartSubtotal >= terms.free_delivery_over ? 0 : terms.standard_shipping;
}

/**
 * Fetch the coupon row for a code, or null. Only an active, unexpired coupon is
 * returned — the same filter the buyer app's active list uses — so an expired or
 * deactivated code simply prices as no coupon on both sides. Codes are stored
 * uppercased (unique on upper(code)), so an exact uppercased match is correct.
 *
 * Never throws: a lookup failure prices the cart without the coupon rather than
 * failing the whole checkout on a discount the buyer may not even have.
 */
export async function loadCoupon(supabase, code) {
  if (!supabase || !code) return null;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data, error } = await supabase
      .from('coupons')
      .select('id, code, boutique_id, type, off, min_subtotal, max_discount, usage_limit, used_count, expires_at, active')
      .eq('code', String(code).trim().toUpperCase())
      .eq('active', true)
      .gte('expires_at', today)
      .maybeSingle();
    if (error) {
      console.error('loadCoupon failed:', error?.message ?? error);
      return null;
    }
    if (!data) return null;
    // A code that has hit its redemption cap (migration 0049) prices as no
    // coupon, the same as an expired one. `redeemCoupon` below re-checks this
    // atomically at the moment the order is written — this is the cheap
    // pre-check so the buyer sees the right total rather than a late failure.
    const limit = data.usage_limit == null ? null : Number(data.usage_limit);
    if (limit != null && Number(data.used_count ?? 0) >= limit) return null;
    return {
      id: data.id,
      code: data.code,
      boutique_id: data.boutique_id ?? null,
      type: data.type,
      off: Number(data.off) || 0,
      min_subtotal: Number(data.min_subtotal) || 0,
      max_discount: data.max_discount == null ? null : Number(data.max_discount),
    };
  } catch (e) {
    console.error('loadCoupon threw:', e?.message ?? e);
    return null;
  }
}

/**
 * Atomically take one redemption of a code, returning false if the cap was
 * already reached. Backed by the `redeem_coupon` function in migration 0049, so
 * two checkouts racing for the last redemption cannot both win.
 *
 * A missing function (migration not yet applied) resolves to `true`: an
 * un-migrated deploy keeps behaving exactly as it did before rather than
 * refusing every coupon.
 */
export async function redeemCoupon(supabase, code) {
  if (!supabase || !code) return true;
  try {
    const { data, error } = await supabase.rpc('redeem_coupon', { p_code: String(code).trim().toUpperCase() });
    if (error) {
      console.error('redeemCoupon failed:', error?.message ?? error);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.error('redeemCoupon threw:', e?.message ?? e);
    return true;
  }
}

// The subtotal a coupon measures against: the owning boutique's goods for a
// seller coupon, the whole cart for a platform coupon.
function couponBase(coupon, cartSubtotal, groupTotals) {
  return coupon.boutique_id ? (groupTotals[coupon.boutique_id] ?? 0) : cartSubtotal;
}

// Mirror of isEligible() in src/lib/pricing.ts (expiry is already filtered out by
// loadCoupon; the min / in-the-bag checks are what remain).
function isEligible(coupon, cartSubtotal, groupTotals) {
  const base = couponBase(coupon, cartSubtotal, groupTotals);
  if (coupon.boutique_id && base <= 0) return false; // seller coupon, its shop not in the bag
  return base >= coupon.min_subtotal;
}

// Mirror of couponSavings() in src/lib/pricing.ts.
function couponSavings(coupon, cartSubtotal, groupTotals, terms) {
  if (!isEligible(coupon, cartSubtotal, groupTotals)) return 0;
  const base = couponBase(coupon, cartSubtotal, groupTotals);
  if (coupon.type === 'pct') {
    return Math.min(Math.round((base * coupon.off) / 100), coupon.max_discount ?? Infinity);
  }
  if (coupon.type === 'flat') return Math.min(coupon.off, base);
  return shipFeeFor(groupTotals, terms); // 'ship' — the delivery fee waived
}

/**
 * Given the DB-derived per-boutique goods totals (`{ boutiqueId: rupees }`) and
 * an optional coupon row, return the same figures the browser shows plus the
 * paise the payment must carry — using the exact same arithmetic as
 * src/lib/pricing.ts so the value matches to the rupee.
 *
 * `perBoutiqueDiscount` is the seller-funded portion to net off each boutique's
 * order total (empty for a platform coupon). `codDeliveries` is the number of
 * boutique orders being paid in cash — 0 for a prepaid checkout. `terms` comes
 * from `loadTerms(supabase)`; it defaults to the published fallback so an older
 * caller still prices at the policy rates rather than NaN.
 */
export function computeCartPricing(groupTotals, coupon, codDeliveries = 0, terms = DEFAULT_TERMS) {
  const cartSubtotal = Object.values(groupTotals).reduce((sum, v) => sum + v, 0);
  const eligible = coupon && isEligible(coupon, cartSubtotal, groupTotals) ? coupon : null;

  const freeShip = eligible?.type === 'ship';
  const discount = eligible && !freeShip ? couponSavings(eligible, cartSubtotal, groupTotals, terms) : 0;

  // Only a seller coupon's discount is allocated to a boutique (and so funded by
  // that seller). A platform coupon reduces the buyer's payment but no order.
  const perBoutiqueDiscount = {};
  if (eligible && eligible.boutique_id && discount > 0) {
    perBoutiqueDiscount[eligible.boutique_id] = discount;
  }

  const shipFee = freeShip ? 0 : shipFeeFor(groupTotals, terms);
  const codFee = Math.max(0, codDeliveries) * terms.cod_fee;
  const total = Math.max(0, cartSubtotal - discount) + shipFee + codFee;

  return {
    cartSubtotal,
    discount,
    perBoutiqueDiscount,
    shipFee,
    codFee,
    total,
    totalPaise: Math.round(total * 100),
  };
}
