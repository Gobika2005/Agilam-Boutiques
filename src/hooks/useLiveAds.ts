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
 * Did the last successful fetch have a hero ad to show?
 *
 * The home hero is a 340px block at the very top of the page that only exists
 * when a `home_hero` campaign is live — so on a cold visit the page painted
 * without it and then had it spliced in when the fetch landed a few seconds
 * later, shoving the entire screen down under whoever was already reading it.
 * That single insertion measured a layout shift of 0.34 on a throttled 4G
 * profile, three times Google's whole-page budget by itself.
 *
 * Only the *answer* is remembered, never the ad. Seeding the creative from
 * storage would mean painting — and counting an impression for — a campaign
 * that may have been paused, refunded or ended since. A boolean lets Home hold
 * the space open with a skeleton and put the real slide into a box that is
 * already the right size.
 *
 * A stale `true` costs one shift when the hero turns out to be gone; a stale
 * `false` costs the shift we have today. Both self-correct on the next visit.
 */
const HERO_HINT_KEY = 'agx:had-hero-ad';

/**
 * Unknown means *yes*. A first-ever visitor has no hint, and reserving the box
 * is the better bet in both directions: a hero campaign is normally running, so
 * they usually get a page that never moves — and when one is not, collapsing the
 * reserved space costs exactly the same single shift that inserting it used to.
 * From the second visit on, the stored answer is the real one.
 */
export function expectsHeroAd(): boolean {
  try {
    return localStorage.getItem(HERO_HINT_KEY) !== '0';
  } catch {
    return true;
  }
}

function rememberHeroAd(present: boolean) {
  try {
    localStorage.setItem(HERO_HINT_KEY, present ? '1' : '0');
  } catch {
    /* private mode — the hint simply never applies */
  }
}

/**
 * The ads currently serving on the buyer app, grouped by placement. Revalidates
 * on the catalogue's longer leash — a newly-approved ad appearing a minute late
 * is fine, and every buyer holds this query open.
 */
export function useLiveAds() {
  const { data, loading } = useAsync(() => fetchLiveAds(), [], { staleMs: 120_000 });
  if (data) {
    cache = data;
    rememberHeroAd(liveNow(data).home_hero.length > 0);
  }
  const ads = liveNow(data ?? cache ?? EMPTY);
  return {
    ads,
    loading,
    /**
     * True while we do not yet know whether a hero ad exists, but last time we
     * looked there was one. Home reserves the hero's height on this rather than
     * letting a 340px block appear mid-read.
     */
    heroPending: !data && !cache && loading && expectsHeroAd(),
  };
}
