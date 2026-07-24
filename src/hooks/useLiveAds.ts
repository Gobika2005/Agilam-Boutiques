import { useAsync } from './useAsync';
import { fetchLiveAds, type LiveAds } from '@/data/ads';

const EMPTY: LiveAds = { sponsored_card: [], home_hero: [], boutique_promo: [] };

/**
 * The ads currently serving on the buyer app, grouped by placement. Revalidates
 * on the catalogue's longer leash — a newly-approved ad appearing a minute late
 * is fine, and every buyer holds this query open.
 */
export function useLiveAds() {
  const { data, loading } = useAsync(() => fetchLiveAds(), [], { staleMs: 120_000 });
  return { ads: data ?? EMPTY, loading };
}
