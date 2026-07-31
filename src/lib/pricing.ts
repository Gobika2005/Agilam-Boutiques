/**
 * Client-side pricing — what a bag costs, and what each coupon takes off it.
 *
 * This is the browser half of the rules in `api/_pricing.js`: the server
 * re-derives the same numbers from the same DB coupon rows and asserts the
 * Razorpay payment matches them to the paise, so the two files MUST stay in step.
 * Change both together.
 *
 * Coupons are per-boutique aware (migration 0036): a PLATFORM coupon
 * (`boutique_id === null`) discounts the whole cart; a SELLER coupon discounts
 * only that boutique's items, so its "applicable base" is that boutique's
 * subtotal, not the cart's. Callers pass a `boutiqueSubtotals` map (boutique id →
 * goods value in the bag) alongside the cart subtotal.
 */
import type { CouponRow } from '@/data/coupons';
import { currentSettings, type PlatformSettings } from '@/data/settings';

/**
 * The commercial terms a calculation runs under.
 *
 * Every exported function takes these as a trailing argument defaulting to the
 * live admin-editable settings (`src/data/settings.ts`), so changing the
 * commission, COD fee or delivery threshold in the console actually re-prices
 * the storefront. They used to be module constants frozen at import time, which
 * is why the Platform Settings page had no effect on anything.
 *
 * Components that display a fee should read `useSettings()` so they re-render
 * when the row loads; pure calculations can rely on the default.
 */
export type Terms = Pick<PlatformSettings, 'free_delivery_over' | 'standard_shipping' | 'cod_fee' | 'cod_max_order'>;

/**
 * Delivery is a PLATFORM charge, not a per-boutique one.
 *
 * `boutiques.delivery_charge` is a seller-side logistics setting; the buyer is
 * charged the flat platform fee published in the delivery policy
 * (src/data/policies.ts): free over `FREE_SHIP_MIN`, otherwise `SHIP_FEE`, once
 * for the whole cart however many boutiques it spans. The product page and
 * checkout used to *print* the seller's private rate ("lilium · ₹150 delivery")
 * next to a summary that said FREE — the fix is that those screens now show the
 * fee this file actually charges. See `deliveryNote` in Checkout.tsx.
 */

/**
 * Cash on Delivery.
 *
 * The fee is charged per delivery, not per cart: a bag spanning two boutiques
 * becomes two orders, shipped separately and collected in cash separately, so
 * one fee would leave the second boutique handling cash for nothing. The cart
 * itemises it as "× N deliveries" so the buyer is never surprised at the door.
 *
 * The cap applies to the WHOLE cart rather than each order, otherwise splitting
 * a ₹50,000 bag across five boutiques would dodge it.
 */
/* The COD fee and cap now come from `terms` on each call — see `Terms` above. */

/** Today as a UTC YYYY-MM-DD string — compared lexicographically against a
 *  coupon's `expires_at`. Matches the server (api/_pricing.js) exactly so a
 *  coupon is valid, or expired, on both sides on the same calendar day. */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The subtotal a coupon measures against: the owning boutique's goods for a
 *  seller coupon, the whole cart for a platform coupon. */
export function couponBase(
  coupon: CouponRow,
  cartSubtotal: number,
  boutiqueSubtotals: Record<string, number>,
): number {
  return coupon.boutique_id ? (boutiqueSubtotals[coupon.boutique_id] ?? 0) : cartSubtotal;
}

/** True once a coupon is past its expiry date (for greying it out on the list). */
export function isExpired(coupon: CouponRow): boolean {
  return coupon.expires_at < todayUTC();
}

/** Delivery before any coupon — free over the threshold, and on an empty bag.
 *  Flat and once per cart, exactly as the published delivery policy says. */
export function baseShipFee(subtotal: number, terms: Terms = currentSettings()): number {
  return subtotal === 0 || subtotal >= terms.free_delivery_over ? 0 : terms.standard_shipping;
}

/**
 * Whether this coupon can be redeemed on the current bag: not expired, its
 * applicable base has actually reached the minimum, and — for a seller coupon —
 * the owning boutique has something in the bag at all.
 */
export function isEligible(
  coupon: CouponRow,
  cartSubtotal: number,
  boutiqueSubtotals: Record<string, number>,
): boolean {
  if (isExpired(coupon)) return false;
  const base = couponBase(coupon, cartSubtotal, boutiqueSubtotals);
  if (coupon.boutique_id && base <= 0) return false; // seller coupon, its shop not in the bag
  return base >= coupon.min_subtotal;
}

/**
 * What this coupon is worth on the current bag — money off the goods, or the
 * delivery fee it waives. Zero is a real answer (a free-delivery coupon on an
 * order that already ships free), which is why the coupon list still shows it.
 */
export function couponSavings(
  coupon: CouponRow,
  cartSubtotal: number,
  boutiqueSubtotals: Record<string, number>,
  terms: Terms = currentSettings(),
): number {
  if (!isEligible(coupon, cartSubtotal, boutiqueSubtotals)) return 0;
  const base = couponBase(coupon, cartSubtotal, boutiqueSubtotals);
  if (coupon.type === 'pct') return Math.min(Math.round((base * coupon.off) / 100), coupon.max_discount ?? Infinity);
  if (coupon.type === 'flat') return Math.min(coupon.off, base); // never exceed the goods it applies to
  return baseShipFee(cartSubtotal, terms); // 'ship' — the delivery fee waived
}

/**
 * Resolve an applied code to the coupon row that actually qualifies on this bag,
 * or undefined. Matches case-insensitively against the loaded active coupons.
 */
export function findCoupon(
  coupons: CouponRow[],
  code: string | null,
  cartSubtotal: number,
  boutiqueSubtotals: Record<string, number>,
): CouponRow | undefined {
  if (!code) return undefined;
  const up = code.trim().toUpperCase();
  const match = coupons.find((c) => c.code.toUpperCase() === up);
  if (!match) return undefined;
  return isEligible(match, cartSubtotal, boutiqueSubtotals) ? match : undefined;
}

/**
 * The bag's totals under an optional (already-resolved) coupon.
 *
 * `codDeliveries` is how many separate boutique orders the bag will split into
 * when paying cash — 0 for a prepaid order, which is what keeps the COD fee out
 * of every existing caller.
 */
export function computeTotals(
  cartSubtotal: number,
  boutiqueSubtotals: Record<string, number>,
  coupon: CouponRow | undefined,
  codDeliveries = 0,
  terms: Terms = currentSettings(),
) {
  const eligible = coupon && isEligible(coupon, cartSubtotal, boutiqueSubtotals) ? coupon : undefined;
  const freeShip = eligible?.type === 'ship';
  const discount = eligible && !freeShip ? couponSavings(eligible, cartSubtotal, boutiqueSubtotals, terms) : 0;
  const shipFee = freeShip ? 0 : baseShipFee(cartSubtotal, terms);
  const codFee = Math.max(0, codDeliveries) * terms.cod_fee;
  return {
    coupon: eligible,
    discount,
    shipFee,
    codFee,
    total: Math.max(0, cartSubtotal - discount) + shipFee + codFee,
  };
}

/**
 * Why this bag cannot be paid in cash, or null if it can.
 *
 * `codEnabledEverywhere` comes from the boutiques in the bag: a seller who
 * turned COD off in their store settings must not have cash orders forced on
 * them, so one opted-out boutique disqualifies the whole bag.
 */
export function codBlockedReason(
  cartSubtotal: number,
  boutiqueSubtotals: Record<string, number>,
  coupon: CouponRow | undefined,
  codEnabledEverywhere: boolean,
  terms: Terms = currentSettings(),
): string | null {
  if (!codEnabledEverywhere) return 'One of the boutiques in your bag does not accept cash on delivery.';
  const payable = computeTotals(cartSubtotal, boutiqueSubtotals, coupon, 0, terms).total;
  if (payable > terms.cod_max_order) {
    return `Cash on delivery is available on orders up to ₹${terms.cod_max_order.toLocaleString('en-IN')}.`;
  }
  return null;
}
