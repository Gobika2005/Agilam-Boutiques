import { useAsync } from './useAsync';
import { fetchLiveAds, type LiveAds } from '@/data/ads';

const EMPTY: LiveAds = { sponsored_card: [], home_hero: [], boutique_promo: [] };

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
  return { ads: data ?? cache ?? EMPTY, loading };
}
