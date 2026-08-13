import { namesAgree } from '@/lib/nameMatch';

/**
 * How far the parcel is going, and therefore what the shop charges to send it.
 *
 * A seller used to set ONE delivery charge and type anything they liked into
 * "delivery areas" — including "All India" — so the same rupees covered a
 * parcel handed over the counter and a parcel crossing three states. Since
 * migration 0077 a shop sets a rate per zone instead, and the buyer's delivery
 * pincode decides which one applies.
 *
 * The four zones are relative to the SHOP, not absolute regions:
 *
 *   local     — the shop's own town (same pincode, or the buyer's pincode
 *               covers a locality with the shop's town name)
 *   district  — elsewhere in the shop's district
 *   state     — elsewhere in the shop's state
 *   national  — everywhere else in India
 *
 * This file must stay in step with `zoneFor()` in api/_pricing.js: the browser
 * quotes the delivery from these rules and the server re-derives it before
 * accepting the payment, so a disagreement rejects a legitimate checkout.
 *
 * Both sides resolve a pincode through the same `pincodes` cache table
 * (src/data/pincodes.ts), so they are reading identical district/state strings
 * rather than two independent lookups that might answer differently.
 */

export type DeliveryZone = 'local' | 'district' | 'state' | 'national';

/** In charge order, cheapest first — used to describe a shop's rate card. */
export const DELIVERY_ZONES: DeliveryZone[] = ['local', 'district', 'state', 'national'];

/** Where the shop is, as stored on its boutique row. */
export type ShopPlace = {
  pincode?: string | null;
  city?: string | null;
  district?: string | null;
  state?: string | null;
};

/** Where the parcel is going, as resolved from the buyer's delivery pincode. */
export type BuyerPlace = {
  pincode: string;
  district: string;
  state: string;
  /** Localities the pincode covers — how "same town" is recognised. */
  places?: string[];
};

/**
 * Which zone a delivery falls into.
 *
 * Widest test first, so a shop whose own district/state fields are blank — a
 * row that predates the address step, or one an admin edited — degrades to
 * `national` (its most expensive rate) rather than to `local`. Guessing cheap
 * on missing data would have the seller subsidising a parcel they never priced.
 */
export function resolveZone(shop: ShopPlace, buyer: BuyerPlace): DeliveryZone {
  const shopPin = (shop.pincode ?? '').replace(/\D/g, '');
  const buyerPin = (buyer.pincode ?? '').replace(/\D/g, '');

  // Same pincode is the one case needing no name matching at all.
  if (shopPin.length === 6 && shopPin === buyerPin) return 'local';

  if (!namesAgree(shop.state, buyer.state)) return 'national';
  if (!namesAgree(shop.district, buyer.district)) return 'state';

  // Same district: local only if the buyer's pincode covers the shop's own
  // town. A district holds dozens of towns and the parcel still has to travel
  // between them, which is exactly the distinction the seller is pricing.
  const town = shop.city ?? '';
  const covers = (buyer.places ?? []).some((p) => namesAgree(town, p));
  return covers || namesAgree(town, buyer.district) ? 'local' : 'district';
}

/** What the shop charges for this zone, or null when it does not deliver there. */
export type ZoneRates = {
  local: number;
  district: number | null;
  state: number | null;
  national: number | null;
};

/**
 * The rate for a zone. `local` always exists (a shop can always be collected
 * from, and 0 is a real answer meaning free); the rest are null when the seller
 * left them blank, which is how a shop says "I don't deliver that far".
 */
export function rateForZone(rates: ZoneRates, zone: DeliveryZone): number | null {
  if (zone === 'local') return rates.local;
  return rates[zone];
}

/** Buyer-facing name for a zone, given the shop's own town and district. */
export function zoneLabel(zone: DeliveryZone, shop: ShopPlace): string {
  switch (zone) {
    case 'local': return shop.city ? `Within ${shop.city}` : 'Within the shop’s town';
    case 'district': return shop.district ? `${shop.district} district` : 'Same district';
    case 'state': return shop.state ? `Within ${shop.state}` : 'Same state';
    default: return 'Rest of India';
  }
}

/**
 * Free delivery applies in the shop's own town and district only.
 *
 * The threshold is one number, not one per zone — but letting it waive a
 * cross-country parcel would mean a ₹2,000 order costing the seller ₹150 to
 * ship for nothing, on the orders where their margin is already thinnest. Near
 * shops it is a real incentive; far ones still pay the carriage.
 */
export function zoneEarnsFreeDelivery(zone: DeliveryZone): boolean {
  return zone === 'local' || zone === 'district';
}
