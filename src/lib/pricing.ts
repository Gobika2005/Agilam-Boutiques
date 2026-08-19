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
import {
  rateForZone, resolveZone, zoneEarnsFreeDelivery,
  type BuyerPlace, type DeliveryZone, type ShopPlace, type ZoneRates,
} from '@/lib/deliveryZone';

/**
 * Delivery is the SELLER's term, not the platform's.
 *
 * Until migration 0076 the buyer paid a flat platform delivery fee (free over a
 * platform threshold), set in the admin console — and `boutiques.delivery_charge`,
 * which the seller had been filling in since onboarding, was collected and never
 * charged. That is now inverted: the seller's own numbers are what the buyer
 * pays, and the admin console no longer carries these knobs at all.
 *
 * The consequences of it being per-boutique rather than per-cart:
 *
 *   • a bag spanning two boutiques becomes two orders, shipped separately, so
 *     it carries two delivery charges — one shop cannot ship another's parcel;
 *   • free delivery is measured against THAT boutique's goods in the bag, not
 *     the cart total, because it is that seller who gives it up.
 *
 * Migration 0077 then split the delivery charge itself by DISTANCE: each shop
 * prices its own town, its district, its state and the rest of India
 * separately, and the buyer's delivery pincode picks which applies. So every
 * function here that touches delivery needs to know where the parcel is going —
 * that is the `buyer: BuyerPlace | null` argument threaded through below.
 *
 * A null buyer (nothing typed yet) is NOT treated as local. It prices at the
 * shop's furthest zone, because quoting the cheapest and then raising it at the
 * payment screen is the version of this that loses carts.
 *
 * `freeDeliveryOver: 0` means "never free", which is also what an un-migrated
 * deployment falls back to (see `TERMS_COLUMNS` in src/data/boutiques.ts). The
 * server falls back identically.
 *
 * Cash on delivery was removed from the platform (migration 0085). Every order
 * is prepaid, so there is no cash-handling fee and no cash cap here any more —
 * `api/_pricing.js` dropped the same two fields in the same change.
 */
export type ShopTerms = {
  /**
   * What this shop charges to deliver, per zone (migration 0077). `local` is
   * always a number; the wider zones are null when the seller does not deliver
   * that far, and a bag containing that shop cannot ship to such an address at
   * all — see `undeliverableReason`.
   */
  rates: ZoneRates;
  /** This boutique's goods value that earns free delivery. 0 = never free.
   *  Applies in the shop's own town and district only — see zoneEarnsFreeDelivery. */
  freeDeliveryOver: number;
  /** Where the shop is, which is what the buyer's address is measured against. */
  place: ShopPlace;
  /** Only for the "which shop is refusing?" message. */
  name?: string;
};

export type ShopTermsMap = Record<string, ShopTerms>;

/** A shop we know nothing about charges nothing — never an invented fee. */
export const DEFAULT_SHOP_TERMS: ShopTerms = {
  rates: { local: 0, district: 0, state: 0, national: 0 },
  freeDeliveryOver: 0,
  place: {},
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

/**
 * Which of a shop's four rates applies to this delivery.
 *
 * With no buyer address yet, the FURTHEST zone the shop serves — see the note at
 * the top of this file. Deliberately not the cheapest: a quote that only ever
 * falls at the payment screen is a pleasant surprise, one that rises is an
 * abandoned cart.
 */
export function zoneForShop(t: ShopTerms, buyer: BuyerPlace | null): DeliveryZone {
  if (buyer) return resolveZone(t.place, buyer);
  if (t.rates.national != null) return 'national';
  if (t.rates.state != null) return 'state';
  if (t.rates.district != null) return 'district';
  return 'local';
}

/**
 * What one boutique charges to deliver its own part of the bag.
 *
 * Null means this shop does not deliver to that zone at all — a different thing
 * from 0 (free), and the reason this returns a nullable rather than falling back
 * to some other rate. `undeliverableReason` is what turns it into words.
 */
export function shopShipFee(subtotal: number, t: ShopTerms, buyer: BuyerPlace | null): number | null {
  if (subtotal <= 0) return 0;
  const zone = zoneForShop(t, buyer);
  const rate = rateForZone(t.rates, zone);
  if (rate == null) return null;
  // Free delivery is the seller's incentive to buy more locally; it does not
  // waive the carriage on a parcel crossing the country.
  if (t.freeDeliveryOver > 0 && subtotal >= t.freeDeliveryOver && zoneEarnsFreeDelivery(zone)) return 0;
  return rate;
}

/** Delivery for the whole bag before any coupon — the sum of each boutique's
 *  own charge, since each ships its own parcel. A shop that cannot reach the
 *  address contributes 0 here; checkout is blocked by `undeliverableReason`
 *  rather than by quietly pricing an impossible bag. */
export function baseShipFee(
  boutiqueSubtotals: Record<string, number>,
  shops: ShopTermsMap,
  buyer: BuyerPlace | null = null,
): number {
  return shopsInBag(boutiqueSubtotals).reduce(
    (sum, id) => sum + (shopShipFee(boutiqueSubtotals[id], termsFor(shops, id), buyer) ?? 0),
    0,
  );
}

/**
 * Why this bag cannot be sent to this address, or null if it can.
 *
 * Only answerable once there is an address: with no pincode the bag is priced,
 * not refused. Named shop-first because "Uzhamagal does not deliver to Delhi" is
 * something a buyer can act on — swap the item, or change the address — where
 * "delivery unavailable" is not.
 */
export function undeliverableReason(
  boutiqueSubtotals: Record<string, number>,
  shops: ShopTermsMap,
  buyer: BuyerPlace | null,
): string | null {
  if (!buyer) return null;
  for (const id of shopsInBag(boutiqueSubtotals)) {
    const t = termsFor(shops, id);
    if (rateForZone(t.rates, resolveZone(t.place, buyer)) == null) {
      const who = t.name || 'One of the boutiques in your bag';
      const where = [buyer.district, buyer.state].filter(Boolean).join(', ') || buyer.pincode;
      return `${who} does not deliver to ${where}. Remove those items, or use a different delivery address.`;
    }
  }
  return null;
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
  buyer: BuyerPlace | null = null,
): number {
  if (!isEligible(coupon, cartSubtotal, boutiqueSubtotals)) return 0;
  const base = couponBase(coupon, cartSubtotal, boutiqueSubtotals);
  if (coupon.type === 'pct') return Math.min(Math.round((base * coupon.off) / 100), coupon.max_discount ?? Infinity);
  if (coupon.type === 'flat') return Math.min(coupon.off, base); // never exceed the goods it applies to
  return baseShipFee(boutiqueSubtotals, shops, buyer); // 'ship' — the delivery fee waived
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
 * api/_pricing.js — it decides each boutique's own order value, which is what
 * the server writes to `orders.total` and asserts the payment against.
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
 * `perBoutiquePayable` is what each boutique's own order comes to — its goods,
 * less its share of the discount, plus its own delivery fee. The server derives
 * the identical map and binds the Razorpay payment to the sum of it.
 *
 * `buyer` is where the parcel is going, which is what picks each shop's delivery
 * rate (migration 0077). Null until an address is known — see the note at the
 * top of this file for why that prices high rather than low.
 */
export function computeTotals(
  cartSubtotal: number,
  boutiqueSubtotals: Record<string, number>,
  coupon: CouponRow | undefined,
  shops: ShopTermsMap = {},
  buyer: BuyerPlace | null = null,
) {
  const eligible = coupon && isEligible(coupon, cartSubtotal, boutiqueSubtotals) ? coupon : undefined;
  const freeShip = eligible?.type === 'ship';
  const discount = eligible && !freeShip ? couponSavings(eligible, cartSubtotal, boutiqueSubtotals, shops, buyer) : 0;
  const shipFee = freeShip ? 0 : baseShipFee(boutiqueSubtotals, shops, buyer);

  const allocated = allocateDiscount(eligible && !freeShip ? eligible : undefined, discount, cartSubtotal, boutiqueSubtotals);
  const perBoutiquePayable: Record<string, number> = {};
  const perBoutiqueShipFee: Record<string, number> = {};
  for (const id of shopsInBag(boutiqueSubtotals)) {
    const t = termsFor(shops, id);
    perBoutiqueShipFee[id] = freeShip ? 0 : (shopShipFee(boutiqueSubtotals[id], t, buyer) ?? 0);
    perBoutiquePayable[id] = Math.max(
      0,
      boutiqueSubtotals[id] - (allocated[id] ?? 0) + perBoutiqueShipFee[id],
    );
  }

  return {
    coupon: eligible,
    discount,
    shipFee,
    perBoutiquePayable,
    perBoutiqueShipFee,
    total: Math.max(0, cartSubtotal - discount) + shipFee,
  };
}
