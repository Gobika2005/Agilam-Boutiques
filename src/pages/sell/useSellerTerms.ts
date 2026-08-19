import { useCallback, useEffect, useMemo } from 'react';
import { loadSettings, useSettings } from '@/data/settings';
import { useAsync } from '@/hooks/useAsync';
import { fetchPlacements, type AdPlacement } from '@/data/ads';

/**
 * The live commercial terms, for the public seller pages.
 *
 * Every number a seller is quoted on /sell comes from here, and every number
 * here comes from a row an admin can edit — `platform_settings` for the
 * commission and the payout timings, `ad_placements` for the ad rate card. Both
 * tables carry a `for select using (true)` policy (0048 and 0032), so a
 * signed-out visitor reads them fine.
 *
 * This is deliberate, not incidental. The buyer policy pages used to quote
 * frozen compile-time constants and were found in the 2026-08-11 functional
 * test publishing a ₹79 delivery fee while checkout charged ₹89. A seller
 * landing page that advertises "8% commission" after someone moves the row to
 * 10% is the same defect pointed at the people whose livelihood it is.
 *
 * `fill()` substitutes the values into the copy in `sellContent.ts`, so the
 * writing stays readable prose with `{commission}` in it rather than a string
 * built out of fragments.
 */
export type SellerTerms = {
  /**
   * The platform fee, as a percentage of the goods value of a delivered order.
   *
   * Named for its column (`platform_settings.commission_pct`) so the trail from
   * page to row stays obvious. Every seller-facing LINE calls it the "platform
   * fee" — see the note at the top of `sellContent.ts` — but renaming the field
   * too would hide which row it came from.
   */
  commissionPct: number;
  /** Days after delivery before a payout is released. */
  holdDays: number;
  /** Hours within which a due payout is promised (migration 0078). */
  slaHours: number;
  /** The default change-of-mind window a NEW shop starts with; the seller then owns it. */
  defaultReturnWindowDays: number;
  /** What the seller keeps on a delivered order of `goods`, before delivery charges. */
  netOf: (goods: number) => number;
  /** What MangaiMart takes on a delivered order of `goods`. */
  cutOf: (goods: number) => number;
  /** Swap `{commission}` / `{hold}` / `{sla}` / `{returnWindow}` into a sentence. */
  fill: (text: string) => string;
  /** The live ad rate card, cheapest first. Empty until it loads (or if 0032 is missing). */
  placements: AdPlacement[];
};

export function useSellerTerms(): SellerTerms {
  // ShopProvider already kicks this off app-wide, but /sell is reachable
  // without ever mounting a storefront screen, and asking twice is free —
  // `loadSettings` collapses concurrent calls and caches the result.
  useEffect(() => { void loadSettings(); }, []);
  const settings = useSettings();

  // The rate card is a handful of rows that change perhaps monthly; there is no
  // reason to poll it on a marketing page.
  const { data: placements } = useAsync(() => fetchPlacements().catch(() => []), [], { live: false });

  const { commission_pct: commissionPct, payout_hold_days: holdDays } = settings;
  const slaHours = settings.payout_sla_hours;
  const defaultReturnWindowDays = settings.return_window_days;

  const fill = useCallback(
    (text: string) =>
      text
        .replace(/\{commission\}/g, String(commissionPct))
        .replace(/\{hold\}/g, String(holdDays))
        .replace(/\{sla\}/g, String(slaHours))
        .replace(/\{returnWindow\}/g, String(defaultReturnWindowDays)),
    [commissionPct, holdDays, slaHours, defaultReturnWindowDays],
  );

  return useMemo(
    () => ({
      commissionPct,
      holdDays,
      slaHours,
      defaultReturnWindowDays,
      // Rounded to the rupee, because that is how the payout row is rounded
      // (`round(…, 2)` in settle_boutique_payout) and how a seller thinks. The
      // worked examples on /sell/pricing must add up when read down the column.
      netOf: (goods: number) => Math.round(goods - (goods * commissionPct) / 100),
      cutOf: (goods: number) => Math.round((goods * commissionPct) / 100),
      fill,
      placements: [...(placements ?? [])]
        .filter((p) => p.active)
        .sort((a, b) => a.daily_rate - b.daily_rate),
    }),
    [commissionPct, holdDays, slaHours, defaultReturnWindowDays, fill, placements],
  );
}
