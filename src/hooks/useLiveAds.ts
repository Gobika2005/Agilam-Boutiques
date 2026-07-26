import { useAsync } from './useAsync';
import { fetchLiveAds, effectiveAdStatus, type LiveAds } from '@/data/ads';

const EMPTY: LiveAds = { sponsored_card: [], home_hero: [], boutique_promo: [] };

/**
 * Drop any ad whose window has closed since it was fetched.
 *
 * `fetchLiveAds` filters at fetch time, but the results are cached (below) and
 * revalidated only every couple of minutes, and the module cache outlives the
 * page — so an ad that ends between fetches could otherwise linger on the buyer
 * app. Re-checking the real window on every read means the moment an ad's
 * end_at passes it stops rendering, cron or no cron.
 */
function liveNow(ads: LiveAds): LiveAds {
  const keep = (list: LiveAds[keyof LiveAds]) => list.filter((a) => effectiveAdStatus(a) === 'live');
  return {
    sponsored_card: keep(ads.sponsored_card),
    home_hero: keep(ads.home_hero),
    boutique_promo: keep(ads.boutique_promo),
  };
}

/**
 * Last-known ads, kept outside React state. Home unmounts on every tab switch
 * (it's a route, not a persistent tab), so a plain useAsync would start from
 * null on each visit — hiding the hero carousel, then popping it in once the
 * fetch resolves a beat later. That pop-in shoves the rest of the page down,
 * which reads as a jarring jump right after landing on Home. Seeding repeat
 * mounts with the last fetch avoids the flash entirely.
 */
let cache: LiveAds | null = null;

/**
 * The ads currently serving on the buyer app, grouped by placement. Revalidates
 * on the catalogue's longer leash — a newly-approved ad appearing a minute late
 * is fine, and every buyer holds this query open.
 */
export function useLiveAds() {
  const { data, loading } = useAsync(() => fetchLiveAds(), [], { staleMs: 120_000 });
  if (data) cache = data;
  return { ads: liveNow(data ?? cache ?? EMPTY), loading };
}
