import { useMemo, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { routes } from '@/lib/seo';
import { breadcrumbSchema, graph, organizationSchema } from '@/lib/schema';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { SiteFooter } from '@/components/buyer/SiteFooter';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import {
  DiscoveryHeader,
  RankingNote,
  EmptyState,
  ShowMore,
} from '@/components/buyer/DiscoveryPage';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { scoreBoutiques, compactCount, RATING_CONFIDENCE_BOUTIQUE } from '@/lib/ranking';
import { TONES } from '@/data/demo';

const PAGE = 12;

/**
 * Best-selling boutiques — the shop leaderboard.
 *
 * Distinct from /boutiques, which is the directory: that page is for
 * "find the shop I already know", this one is for "who should I trust with this
 * order". The ranking is in `scoreBoutiques` (@/lib/ranking) and the weights are
 * published on the page, for the same reason as Best sellers: a marketplace
 * that takes commission has to be able to show its leaderboard is not for sale.
 */
export function TopBoutiques() {
  usePageMeta({
    title: 'Best-Selling Boutiques in India — Top Rated Shops',
    description: 'The independent boutiques moving the most pieces on MangaiMart, weighed against how well they are rated by real buyers.',
    canonical: routes.topBoutiques(),
    schema: graph(
      organizationSchema(),
      breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Best-selling boutiques', path: routes.topBoutiques() }]),
    ),
  });
  const navigate = useNavigate();
  const { follows, toggleFollow, showToast } = useShop();
  const { boutiques: BOUTIQUES, loading } = useCatalog();

  const [city, setCity] = useState<string | null>(null);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const cities = useMemo(
    () => [...new Set(BOUTIQUES.map((b) => b.city))].sort(),
    [BOUTIQUES],
  );

  // Rank within the filter, so "top boutiques in Madurai" is numbered 1, 2, 3
  // rather than being the national list with the holes left in it.
  const ranked = useMemo(
    () =>
      scoreBoutiques(
        BOUTIQUES.filter((b) => (!city || b.city === city) && (!verifiedOnly || b.verified)),
      ),
    [BOUTIQUES, city, verifiedOnly],
  );

  const page = ranked.slice(0, shown);
  const anySalesData = BOUTIQUES.some((b) => (b.unitsSold ?? 0) > 0);

  function follow(e: MouseEvent, id: string, name: string) {
    e.stopPropagation();
    showToast(toggleFollow(id) ? `Following ${name}` : `Unfollowed ${name}`);
  }

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
      <DiscoveryHeader
        eyebrow="Shops buyers love"
        title="Best-selling"
        accent="boutiques"
        subtitle="The shops moving the most pieces, weighed against how well they are rated and how long they have been trading — so a boutique that opened this year can still make the list."
        count={ranked.length}
        countLabel={ranked.length === 1 ? 'boutique' : 'boutiques'}
      />

      <RankingNote
        lines={[
          { term: 'Sales pace', weight: '40%', why: 'units sold per month since the shop opened on MangaiMart. A rate, so an established shop cannot coast on its back catalogue.' },
          { term: 'Rating', weight: '20%', why: `weighed by confidence — a shop's rating settles after roughly ${RATING_CONFIDENCE_BOUTIQUE} reviews, not after its first happy customer.` },
          { term: 'Orders fulfilled', weight: '15%', why: 'counted separately from units: sixty orders of one piece is a broader business than one order of sixty.' },
          { term: 'Followers', weight: '15%', why: 'the buyers who came back. The clearest signal a shop is worth returning to.' },
          { term: 'Styles listed', weight: '10%', why: 'a shop with three pieces may be selling all three, and still is not what you mean by a best-selling boutique.' },
          { term: 'Verification', why: 'unverified shops rank a little below their equals. It is a nudge, not a ban — we would rather point you at a shop whose details we have checked.' },
        ]}
      />

      {!loading && !anySalesData && BOUTIQUES.length > 0 && (
        <div style={css('display:flex;gap:10px;align-items:flex-start;background:var(--ag-gold-bg);border:1px solid var(--ag-gold-border);border-radius:16px;padding:13px 15px;margin-top:14px;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;color:#B8892B;flex:none;")}>hourglass_top</span>
          <span style={css('font-size:12.5px;color:#7A5C1E;line-height:1.55;')}>
            Too early to rank by sales, so these are ordered by rating, following and catalogue size for now.
          </span>
        </div>
      )}

      {/* City first — for most buyers "best" quietly means "best near me", and
          a boutique three districts away is a different proposition. */}
      <div className="agx-scroll" style={css('display:flex;gap:8px;overflow-x:auto;margin-top:18px;padding-bottom:4px;')}>
        <Chip on={!city} onClick={() => { setCity(null); setShown(PAGE); }} label="All cities" />
        {cities.map((c) => (
          <Chip key={c} on={city === c} onClick={() => { setCity(city === c ? null : c); setShown(PAGE); }} label={c} />
        ))}
      </div>

      <div style={css('display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;')}>
        <button
          onClick={() => { setVerifiedOnly((v) => !v); setShown(PAGE); }}
          style={css(`display:flex;align-items:center;gap:7px;border:1px solid ${verifiedOnly ? 'transparent' : 'var(--ag-border-soft)'};background:${verifiedOnly ? 'linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44)' : 'var(--ag-surface)'};color:${verifiedOnly ? '#fff' : 'var(--ag-ink-3)'};cursor:pointer;padding:9px 15px;border-radius:999px;font-size:12.5px;font-weight:700;font-family:inherit;`)}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>verified</span>
          Verified only
        </button>
        <button
          onClick={() => navigate('/boutiques')}
          style={css('display:flex;align-items:center;gap:6px;border:none;background:none;cursor:pointer;color:var(--ag-crimson);font-size:12.5px;font-weight:700;font-family:inherit;')}
        >
          Search the full directory
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>search</span>
        </button>
      </div>

      <div style={css('margin-top:22px;')}>
        {!loading && ranked.length === 0 && (
          <EmptyState
            icon="storefront"
            title={city ? `No boutiques in ${city} yet` : 'No boutiques to rank yet'}
            body={city ? 'We are onboarding shops city by city. Try another city, or browse the full directory.' : 'Approved boutiques appear here as soon as they start trading.'}
            action={
              <button
                onClick={() => { setCity(null); setVerifiedOnly(false); }}
                style={css('border:none;background:linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44);cursor:pointer;padding:11px 22px;border-radius:999px;font-size:13px;font-weight:700;color:#fff;font-family:inherit;')}
              >
                Show all boutiques
              </button>
            }
          />
        )}

        <div className="agx-bgrid">
          {page.map(({ boutique: b }, i) => (
            <div
              key={b.id}
              onClick={() => navigate(`/boutique/${b.id}`)}
              className="agx-lift"
              style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;overflow:hidden;cursor:pointer;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}
            >
              <div className="agx-zoom" style={css(`position:relative;aspect-ratio:16/10;background:${TONES[b.tone]};overflow:hidden;`)}>
                {/* `.agx-bgrid` is one card per row on a phone, so the cover is
                    full-bleed there — not the half-width tile ImageSlot assumes. */}
                <ImageSlot src={b.image} placeholder={`${b.name} — cover`} sizes="(min-width: 1060px) 33vw, (min-width: 620px) 50vw, 100vw" style={css('position:absolute;inset:0;')} />
                <span style={css("position:absolute;left:12px;top:12px;min-width:28px;height:28px;padding:0 8px;border-radius:10px;background:linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44);color:#fff;font-family:'IBM Plex Mono',monospace;font-size:12.5px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px -6px rgba(176,36,84,.9);")}>
                  {i + 1}
                </span>
              </div>

              <div style={css('padding:14px 16px 16px;')}>
                <div style={css('display:flex;align-items:center;gap:11px;')}>
                  <BoutiqueLogo name={b.name} src={b.logo} size={44} />
                  <div style={css('min-width:0;flex:1;')}>
                    <div style={css('display:flex;align-items:center;gap:5px;')}>
                      <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:17px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{b.name}</span>
                      {b.verified && <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;color:#3A9BE0;flex:none;")}>verified</span>}
                    </div>
                    <div style={css('color:var(--ag-muted);font-size:12px;display:flex;align-items:center;gap:3px;margin-top:2px;')}>
                      <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:14px;")}>location_on</span>
                      {b.area && b.area !== b.city ? `${b.area}, ${b.city}` : b.city}
                    </div>
                  </div>
                  <button
                    onClick={(e) => follow(e, b.id, b.name)}
                    aria-label={follows[b.id] ? `Unfollow ${b.name}` : `Follow ${b.name}`}
                    aria-pressed={!!follows[b.id]}
                    style={css(`width:38px;height:38px;flex:none;border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;border:1px solid ${follows[b.id] ? 'transparent' : 'var(--ag-border-soft)'};background:${follows[b.id] ? 'linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44)' : 'var(--ag-surface)'};`)}
                  >
                    <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:20px;color:${follows[b.id] ? '#fff' : 'var(--ag-crimson)'};`)}>
                      {follows[b.id] ? 'how_to_reg' : 'person_add'}
                    </span>
                  </button>
                </div>

                {/* The numbers behind the rank, stated plainly. A leaderboard
                    that will not show its working is just an advert. */}
                <div style={css('display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:13px;padding-top:12px;border-top:1px solid var(--ag-border-soft);')}>
                  <Stat icon="star" tint="var(--ag-star)" value={String(b.rating)} sub={`${compactCount(b.reviews)} reviews`} />
                  {(b.unitsSold ?? 0) > 0 && (
                    <Stat icon="local_fire_department" tint="var(--ag-good)" value={compactCount(b.unitsSold ?? 0)} sub="sold" />
                  )}
                  <Stat icon="checkroom" tint="#B02454" value={String(b.products)} sub="styles" />
                  {b.followers > 0 && (
                    <Stat icon="group" tint="#8E1C44" value={compactCount(b.followers)} sub="followers" />
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <ShowMore shown={page.length} total={ranked.length} onMore={() => setShown((s) => s + PAGE)} />
      </div>

      <SiteFooter />
    </div>
  );
}

function Stat({ icon, tint, value, sub }: { icon: string; tint: string; value: string; sub: string }) {
  return (
    <span style={css('display:flex;align-items:center;gap:4px;font-size:12.5px;font-weight:700;color:var(--ag-ink);background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:10px;padding:5px 9px;white-space:nowrap;')}>
      <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:15px;color:${tint};`)}>{icon}</span>
      {value}
      <span style={css('color:var(--ag-muted-soft);font-weight:600;')}>{sub}</span>
    </span>
  );
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={css(`flex:none;border:1px solid ${on ? 'transparent' : 'var(--ag-border-soft)'};background:${on ? 'linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-ink-3)'};cursor:pointer;padding:9px 15px;border-radius:999px;font-size:12.5px;font-weight:700;font-family:inherit;white-space:nowrap;`)}
    >
      {label}
    </button>
  );
}
