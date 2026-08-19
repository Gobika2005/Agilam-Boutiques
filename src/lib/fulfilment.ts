import { POLICY_TERMS } from '@/data/company';

/**
 * What a shop promises about getting an order to the buyer, in words.
 *
 * Two numbers used to be printed on the product page as facts about the shop and
 * were nothing of the kind: "3–7 working days" was one estimate for every
 * boutique on the marketplace, and "7-day easy returns" was a compile-time
 * constant that did not even match the admin-configured window the returns flow
 * actually enforced. Migration 0078 moved both onto the boutique; this is the
 * one place that turns them into sentences, so the product page, the checkout
 * screen and the order confirmation cannot word the same promise differently.
 *
 * The split of who owns what:
 *
 *   • DISPATCH is the seller's — the days between an order arriving and the
 *     parcel leaving their hands. Only they know whether a piece is on the shelf
 *     or cut to measure.
 *   • TRANSIT stays the platform's (`POLICY_TERMS.deliveryEstimate`). How long a
 *     courier takes across India is not something a boutique can promise.
 *   • RETURNS is the seller's, but only the goodwill half: a faulty, wrong or
 *     misdescribed item is accepted for 30 days whatever a shop sets, because
 *     that is the marketplace's own commitment. See `request_return()` in 0078.
 */

/** What a shop with no answer of its own is taken to promise — the wording the
 *  app shipped with, so nothing on the storefront changes until a seller edits
 *  it. Also what a deployment without 0078 falls back to. */
export const DEFAULT_DISPATCH = { min: 1, max: 2 } as const;

export type ShopFulfilment = {
  dispatchMin: number;
  dispatchMax: number;
  returnWindowDays: number;
};

/** Normalise a boutique's (optional) fulfilment fields into real numbers. */
export function shopFulfilment(b: {
  dispatchMin?: number;
  dispatchMax?: number;
  returnWindowDays?: number;
} | null | undefined): ShopFulfilment {
  const min = Number.isFinite(b?.dispatchMin) ? Number(b?.dispatchMin) : DEFAULT_DISPATCH.min;
  const max = Number.isFinite(b?.dispatchMax) ? Number(b?.dispatchMax) : DEFAULT_DISPATCH.max;
  return {
    dispatchMin: Math.max(0, min),
    // Guard the ordering here as well as in the DB check: a row edited by hand
    // must not be able to print "5–2 days".
    dispatchMax: Math.max(Math.max(0, min), max),
    returnWindowDays: Number.isFinite(b?.returnWindowDays)
      ? Math.max(0, Number(b?.returnWindowDays))
      : POLICY_TERMS.returnWindowDays,
  };
}

/** "Same day", "next working day", "in 2 working days", "in 1–2 working days". */
export function dispatchLabel(f: ShopFulfilment): string {
  const { dispatchMin: lo, dispatchMax: hi } = f;
  if (hi === 0) return 'Dispatched the same day';
  if (lo === hi) return hi === 1 ? 'Dispatched the next working day' : `Dispatched in ${hi} working days`;
  if (lo === 0) return `Dispatched within ${hi} working days`;
  return `Dispatched in ${lo}–${hi} working days`;
}

/** The whole journey, for the screens that should say when it will arrive
 *  rather than when it will leave. */
export function deliveryEtaLabel(f: ShopFulfilment): string {
  return `${dispatchLabel(f)}, then ${POLICY_TERMS.deliveryEstimate} in transit`;
}

/**
 * The returns promise. Zero is a real, common answer — a shop that stitches to
 * measure cannot take a change of mind — and it must not read as "no returns at
 * all", because a faulty item is still covered.
 */
export function returnsLabel(f: ShopFulfilment): string {
  return f.returnWindowDays > 0
    ? `${f.returnWindowDays}-day easy returns`
    : 'Returns for faults only';
}

/** The same, spelled out where there is room for a sentence. */
export function returnsDetail(f: ShopFulfilment): string {
  return f.returnWindowDays > 0
    ? `Change your mind within ${f.returnWindowDays} days of delivery, or report a fault within 30 days.`
    : 'This boutique does not accept change-of-mind returns. Damaged, faulty or wrong items are still accepted for 30 days.';
}
