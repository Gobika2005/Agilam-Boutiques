/**
 * Client-side pricing — what a bag costs, and what each coupon takes off it.
 *
 * This is the browser half of the rules in `api/_pricing.js`: the server
 * re-derives the same numbers from the same DB rows and asserts the Razorpay
 * payment matches them to the paise, so the two files MUST stay in step.
 * Change both together.
 *
 * Coupons are per-boutique aware (migration 0036): a PLATFORM coupon
 * (`boutique_id === null`) discounts the whole cart; a SELLER coupon discounts
 * only that boutique's items, so its "applicable base" is that boutique's
 * subtotal, not the cart's. Callers pass a `boutiqueSubtotals` map (boutique id →
 * goods value in the bag) alongside the cart subtotal.
 */
import type { CouponRow } from '@/data/coupons';

/**
 * Delivery and cash-on-delivery are the SELLER's terms, not the platform's.
 *
 * Until migration 0076 the buyer paid a flat platform delivery fee (free over a
 * platform threshold) and a flat platform COD fee, both set in the admin
 * console — and `boutiques.delivery_charge`, which the seller had been filling
 * in since onboarding, was collected and never charged. That is now inverted:
 * the seller's own numbers are what the buyer pays, and the admin console no
 * longer carries these knobs at all.
 *
 * The consequences of it being per-boutique rather than per-cart:
 *
 *   • a bag spanning two boutiques becomes two orders, shipped separately, so
 *     it carries two delivery charges — one shop cannot ship another's parcel;
 *   • free delivery is measured against THAT boutique's goods in the bag, not
 *     the cart total, because it is that seller who gives it up;
 *   • the COD cap is per boutique for the same reason — the seller is the one
 *     carrying the cash risk on their own order.
 *
 * `freeDeliveryOver: 0` means "never free" and `codMaxOrder: 0` means "no cap",
 * which is also what an un-migrated deployment falls back to (see
 * `TERMS_COLUMNS` in src/data/boutiques.ts). The server falls back identically.
 */
export type ShopTerms = {
  /** Charged once per boutique order, unless waived below. */
  deliveryCharge: number;
  /** This boutique's goods value that earns free delivery. 0 = never free. */
  freeDeliveryOver: number;
  /** Cash-handling fee, charged once per cash delivery. */
  codFee: number;
  /** Largest this boutique's order may be and still be paid in cash. 0 = no cap. */
  codMaxOrder: number;
  /** Only for the "which shop is refusing?" message. */
  name?: string;
};

export type ShopTermsMap = Record<string, ShopTerms>;

/** A shop we know nothing about charges nothing — never an invented fee. */
export const DEFAULT_SHOP_TERMS: ShopTerms = {
  deliveryCharge: 0,
  freeDeliveryOver: 0,
  codFee: 0,
  codMaxOrder: 0,
};

function termsFor(shops: ShopTermsMap, id: string): ShopTerms {
  return shops[id] ?? DEFAULT_SHOP_TERMS;
}

/** Boutiques with something in the bag — one order, one parcel, one fee each. */
function shopsInBag(boutiqueSubtotals: Record<string, number>): string[] {
  return Object.keys(boutiqueSubtotals).filter((id) => boutiqueSubtotals[id] > 0);
}

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

/** What one boutique charges to deliver its own part of the bag. */
export function shopShipFee(subtotal: number, t: ShopTerms): number {
  if (subtotal <= 0) return 0;
  if (t.freeDeliveryOver > 0 && subtotal >= t.freeDeliveryOver) return 0;
  return t.deliveryCharge;
}

/** Delivery for the whole bag before any coupon — the sum of each boutique's
 *  own charge, since each ships its own parcel. */
export function baseShipFee(boutiqueSubtotals: Record<string, number>, shops: ShopTermsMap): number {
  return shopsInBag(boutiqueSubtotals).reduce(
    (sum, id) => sum + shopShipFee(boutiqueSubtotals[id], termsFor(shops, id)),
    0,
  );
}

/** Cash handling for the whole bag — one fee per boutique, i.e. per delivery. */
export function baseCodFee(boutiqueSubtotals: Record<string, number>, shops: ShopTermsMap): number {
  return shopsInBag(boutiqueSubtotals).reduce((sum, id) => sum + Math.max(0, termsFor(shops, id).codFee), 0);
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
 *
 * `max_discount` is no longer settable (see src/lib/couponForm.ts) but is still
 * honoured for rows created while it was, so a live capped coupon does not
 * silently become more generous than it was published as.
 */
export function couponSavings(
  coupon: CouponRow,
  cartSubtotal: number,
  boutiqueSubtotals: Record<string, number>,
  shops: ShopTermsMap = {},
): number {
  if (!isEligible(coupon, cartSubtotal, boutiqueSubtotals)) return 0;
  const base = couponBase(coupon, cartSubtotal, boutiqueSubtotals);
  if (coupon.type === 'pct') return Math.min(Math.round((base * coupon.off) / 100), coupon.max_discount ?? Infinity);
  if (coupon.type === 'flat') return Math.min(coupon.off, base); // never exceed the goods it applies to
  return baseShipFee(boutiqueSubtotals, shops); // 'ship' — the delivery fee waived
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
 * How a discount is shared out across the boutiques in the bag.
 *
 * A seller coupon lands entirely on its own boutique. A platform coupon applies
 * to the whole cart, so it is split proportionally to each boutique's goods,
 * with the rounding remainder on the largest so the shares add back up to the
 * discount exactly. This is a line-for-line mirror of the same split in
 * api/_pricing.js — it decides each boutique's order value, which is what the
 * per-boutique COD cap is measured against on both sides.
 */
function allocateDiscount(
  coupon: CouponRow | undefined,
  discount: number,
  cartSubtotal: number,
  boutiqueSubtotals: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!coupon || discount <= 0) return out;
  if (coupon.boutique_id) {
    out[coupon.boutique_id] = discount;
    return out;
  }
  if (cartSubtotal <= 0) return out;
  const ids = Object.keys(boutiqueSubtotals).sort((a, b) => boutiqueSubtotals[b] - boutiqueSubtotals[a]);
  let remaining = discount;
  for (const id of ids.slice(1)) {
    const share = Math.floor((discount * boutiqueSubtotals[id]) / cartSubtotal);
    if (share > 0) out[id] = share;
    remaining -= share;
  }
  if (ids.length > 0) out[ids[0]] = remaining;
  return out;
}

/**
 * The bag's totals under an optional (already-resolved) coupon.
 *
 * `payingCash` replaces the old `codDeliveries` count: the COD fee is no longer
 * one platform rate times the number of deliveries but each boutique's own fee,
 * so the count alone can no longer price it.
 *
 * `perBoutiquePayable` is what each boutique's own order comes to — its goods,
 * less its share of the discount, plus its own delivery and cash-handling fees.
 * It is what the per-boutique COD cap is checked against, and the server derives
 * the identical map.
 */
export function computeTotals(
  cartSubtotal: number,
  boutiqueSubtotals: Record<string, number>,
  coupon: CouponRow | undefined,
  payingCash = false,
  shops: ShopTermsMap = {},
) {
  const eligible = coupon && isEligible(coupon, cartSubtotal, boutiqueSubtotals) ? coupon : undefined;
  const freeShip = eligible?.type === 'ship';
  const discount = eligible && !freeShip ? couponSavings(eligible, cartSubtotal, boutiqueSubtotals, shops) : 0;
  const shipFee = freeShip ? 0 : baseShipFee(boutiqueSubtotals, shops);
  const codFee = payingCash ? baseCodFee(boutiqueSubtotals, shops) : 0;

  const allocated = allocateDiscount(eligible && !freeShip ? eligible : undefined, discount, cartSubtotal, boutiqueSubtotals);
  const perBoutiquePayable: Record<string, number> = {};
  for (const id of shopsInBag(boutiqueSubtotals)) {
    const t = termsFor(shops, id);
    perBoutiquePayable[id] = Math.max(
      0,
      boutiqueSubtotals[id] - (allocated[id] ?? 0) + (freeShip ? 0 : shopShipFee(boutiqueSubtotals[id], t)) + (payingCash ? Math.max(0, t.codFee) : 0),
    );
  }

  return {
    coupon: eligible,
    discount,
    shipFee,
    codFee,
    perBoutiquePayable,
    total: Math.max(0, cartSubtotal - discount) + shipFee + codFee,
  };
}

/**
 * Why this bag cannot be paid in cash, or null if it can.
 *
 * `codEnabledEverywhere` comes from the boutiques in the bag: a seller who
 * turned COD off in their store settings must not have cash orders forced on
 * them, so one opted-out boutique disqualifies the whole bag. The cap is checked
 * the same way — per boutique, against that boutique's own order value, since
 * each shop sets its own limit and collects its own cash.
 */
export function codBlockedReason(
  cartSubtotal: number,
  boutiqueSubtotals: Record<string, number>,
  coupon: CouponRow | undefined,
  codEnabledEverywhere: boolean,
  shops: ShopTermsMap = {},
): string | null {
  if (!codEnabledEverywhere) return 'One of the boutiques in your bag does not accept cash on delivery.';
  // Priced as a cash order, because the handling fee is part of what the buyer
  // would owe at the door and so part of what the cap has to cover.
  const { perBoutiquePayable } = computeTotals(cartSubtotal, boutiqueSubtotals, coupon, true, shops);
  for (const id of Object.keys(perBoutiquePayable)) {
    const t = termsFor(shops, id);
    if (t.codMaxOrder > 0 && perBoutiquePayable[id] > t.codMaxOrder) {
      const who = t.name ? `${t.name} accepts` : 'One of the boutiques in your bag accepts';
      return `${who} cash on delivery on orders up to ₹${t.codMaxOrder.toLocaleString('en-IN')}.`;
    }
  }
  return null;
}
