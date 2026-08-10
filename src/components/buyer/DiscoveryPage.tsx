import { useState, type ReactNode, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { WishButton } from '@/components/buyer/WishButton';
import { CardLink } from '@/components/buyer/CardLink';
import { CatalogError } from '@/components/buyer/CatalogError';
import { Skeleton, SkeletonGroup } from '@/components/ui/Skeleton';
import { useCatalog } from '@/state/CatalogContext';
import { useGoBack } from '@/hooks/useGoBack';
import { routes } from '@/lib/seo';
import { TONES, fmt, type Product } from '@/data/demo';
import { compactCount } from '@/lib/ranking';

/**
 * Shared chrome for the four "See all" discovery pages — Collections, New
 * arrivals, Best sellers and Best-selling boutiques.
 *
 * They are siblings of each other rather than of the Results grid: Results
 * answers "show me what matches these filters", these answer "show me what
 * MangaiMart thinks is worth seeing". Keeping their header, their ranking note and
 * their card in one place is what stops the four drifting into four slightly
 * different-looking pages.
 */

// ── Header ──────────────────────────────────────────────────────────────────

export function DiscoveryHeader({
  eyebrow,
  title,
  accent,
  subtitle,
  count,
  countLabel,
}: {
  eyebrow: string;
  title: string;
  /** Trailing word set in italic display type, as on the Home rails. */
  accent?: string;
  subtitle: string;
  count?: number;
  countLabel?: string;
}) {
  const goBack = useGoBack('/');

  return (
    <div style={css('padding:2px 0 0;')}>
      {/* Back + breadcrumb. These pages are entered FROM somewhere — a Home
          rail, a search — so the buyer needs a way back that is not the browser
          button. Back returns to wherever they came from; the breadcrumb stays
          because Back alone doesn't say where you are. The tab dock stays put on
          these pages: they float no bottom furniture of their own, so nothing
          was competing with it. */}
      <div style={css('display:flex;align-items:center;gap:10px;')}>
        <button
          onClick={goBack}
          aria-label="Go back"
          title="Back"
          style={css('flex:none;width:38px;height:38px;border-radius:12px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>arrow_back</span>
        </button>
        <div style={css('display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ag-muted-soft);font-weight:600;min-width:0;')}>
          <Link to="/" style={css('color:var(--ag-crimson);text-decoration:none;')}>Home</Link>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;")}>chevron_right</span>
          <span style={css('color:var(--ag-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{title}</span>
        </div>
      </div>

      <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);margin-top:14px;')}>{eyebrow}</div>
      <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(28px,3.4vw,44px);line-height:1.08;margin:6px 0 0;letter-spacing:-.015em;text-wrap:balance;")}>
        {title}{accent && <> <span style={css('font-style:italic;color:var(--ag-crimson);')}>{accent}</span></>}
      </h1>
      <div style={css('display:flex;align-items:baseline;flex-wrap:wrap;gap:10px;margin-top:10px;')}>
        <div style={css('color:var(--ag-muted);font-size:14px;line-height:1.6;max-width:620px;')}>{subtitle}</div>
        {count != null && (
          <div style={css("font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ag-muted-soft);letter-spacing:.04em;white-space:nowrap;")}>
            {count} {countLabel ?? (count === 1 ? 'piece' : 'pieces')}
          </div>
        )}
      </div>
    </div>
  );
}

// ── "How this is ordered" ───────────────────────────────────────────────────

/**
 * Every ranked rail carries its own explanation, collapsed by default.
 *
 * A buyer who cannot tell why one saree is above another assumes the top slot
 * was bought — and on a marketplace where sellers pay commission, that
 * suspicion is corrosive. Saying it plainly ("sales, ratings, recency; nobody
 * can pay to be here") costs one line and buys the ranking its credibility.
 */
export function RankingNote({ lines }: { lines: { term: string; weight?: string; why: string }[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;margin-top:18px;overflow:hidden;')}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        style={css('width:100%;display:flex;align-items:center;gap:10px;background:none;border:none;cursor:pointer;padding:14px 16px;text-align:left;font-family:inherit;')}
      >
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;color:var(--ag-crimson);")}>insights</span>
        <span style={css('flex:1;font-size:13.5px;font-weight:700;color:var(--ag-ink);')}>How this list is ordered</span>
        <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:20px;color:var(--ag-muted-soft);transition:transform .25s ease;transform:rotate(${open ? 180 : 0}deg);`)}>expand_more</span>
      </button>
      {open && (
        <div style={css('padding:0 16px 16px;')}>
          <div style={css('display:grid;gap:10px;')}>
            {lines.map((l) => (
              <div key={l.term} style={css('display:flex;gap:10px;align-items:flex-start;')}>
                {l.weight && (
                  <span style={css("flex:none;min-width:42px;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:700;color:var(--ag-crimson);background:var(--ag-surface-2);border-radius:8px;padding:4px 7px;text-align:center;")}>
                    {l.weight}
                  </span>
                )}
                <span style={css('font-size:13px;color:var(--ag-ink-2);line-height:1.55;')}>
                  <b style={css('color:var(--ag-ink);')}>{l.term}</b> — {l.why}
                </span>
              </div>
            ))}
          </div>
          <div style={css('margin-top:12px;padding-top:12px;border-top:1px solid var(--ag-surface-2);display:flex;gap:8px;align-items:flex-start;color:var(--ag-good);font-size:12.5px;font-weight:600;line-height:1.5;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;flex:none;")}>verified_user</span>
            <span>No boutique can pay for a place in this list. Ads are sold separately and always labelled.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section label ───────────────────────────────────────────────────────────

/**
 * A section heading.
 *
 * This was a styled `<div>`, which is why pages like Collections and New
 * arrivals reported a document outline of exactly one heading: "Shop by
 * category", "Shop by occasion" and "Shop by colour" all looked like ordinary
 * text to a crawler and to a screen reader, so neither could tell the page had
 * sections at all. It is an `<h2>` now — the visual design is unchanged, since
 * the size and family were already set explicitly.
 */
export function SectionLabel({ icon, title, note }: { icon: string; title: string; note?: string }) {
  return (
    <div style={css('display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:34px 2px 14px;')}>
      <div style={css('display:flex;align-items:center;gap:9px;')}>
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;color:var(--ag-crimson);")}>{icon}</span>
        <h2 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(19px,2vw,24px);color:var(--ag-ink);margin:0;")}>{title}</h2>
      </div>
      {note && (
        <span style={css("font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ag-muted-soft);letter-spacing:.04em;white-space:nowrap;")}>{note}</span>
      )}
    </div>
  );
}

// ── Product card ────────────────────────────────────────────────────────────

export type CardBadge = { icon: string; label: string };

/**
 * The catalogue card as the Home rails draw it, plus the two things a ranked
 * page needs and a rail does not: the position in the list, and the reason the
 * piece is there ("128 sold"). Sold-out pieces stay visible but read as sold
 * out, so a popular boutique does not look empty and nobody taps into a dead
 * end by accident.
 */
export function CatalogCard({
  product: p,
  wished,
  onToggleWish,
  badge,
  proof,
  rank,
}: {
  product: Product;
  wished: boolean;
  onToggleWish: (e: MouseEvent) => void;
  badge?: CardBadge | null;
  proof?: string | null;
  rank?: number;
}) {
  const soldOut = p.stock === 0;

  /**
   * A real `<a href>`, not a `<div onClick>`.
   *
   * These four discovery pages — New arrivals, Best sellers, Collections and
   * Best-selling boutiques — held every card in a click handler, so the entire
   * ranked catalogue was invisible to anything reading the page rather than
   * clicking it: a crawler found no links to follow, the cards could not be
   * tabbed to, and none of them could be opened in a new tab or have their
   * address copied. `CardLink` fixed exactly this for the Results grid; these
   * pages were missed. They are the pages that link to the freshest and
   * best-selling stock, so they are the ones crawl budget should be spent on.
   */
  return (
    <CardLink to={routes.product(p)} label={p.title} className="agx-lift">
      <div className="agx-prod-media agx-zoom" style={css(`background:${TONES[p.tone]};`)}>
        <ImageSlot
          src={p.image}
          alt={`${p.title} — ${p.cat} from ${p.boutique}, ${p.city}`}
          placeholder={p.title}
          className="agx-prod-fill"
        />

        {/* Rank chip — only the top few carry one; past that a number is noise. */}
        {rank != null && rank <= 10 && (
          <div style={css("position:absolute;left:10px;top:10px;min-width:26px;height:26px;padding:0 7px;border-radius:9px;background:linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44);color:#fff;font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px -6px rgba(176,36,84,.9);")}>
            {rank}
          </div>
        )}

        {badge && rank == null && (
          <div style={css('position:absolute;left:10px;top:10px;display:flex;align-items:center;gap:5px;background:rgba(255,255,255,.94);color:var(--ag-crimson);padding:5px 10px;border-radius:999px;box-shadow:0 4px 12px rgba(0,0,0,.14);')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:13px;")}>{badge.icon}</span>
            <span className="agx-eyebrow" style={css('font-size:8.5px;letter-spacing:.14em;')}>{badge.label}</span>
          </div>
        )}

        <WishButton wished={wished} title={p.title} onToggle={onToggleWish} className="agx-card-wish" />

        {soldOut && (
          <div style={css('position:absolute;inset:0;background:rgba(36,16,25,.42);display:flex;align-items:center;justify-content:center;')}>
            <span style={css('background:rgba(255,255,255,.95);color:var(--ag-deep);border-radius:999px;padding:7px 14px;font-size:12px;font-weight:800;letter-spacing:.02em;')}>Sold out</span>
          </div>
        )}

        {proof && !soldOut && (
          <div style={css('position:absolute;left:10px;bottom:10px;display:flex;align-items:center;gap:4px;background:rgba(255,255,255,.96);border-radius:9px;padding:3px 8px;font-size:11px;font-weight:800;color:#241019;box-shadow:0 4px 10px rgba(0,0,0,.14);')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:13px;color:var(--ag-good);")}>local_fire_department</span>
            {proof}
          </div>
        )}
      </div>

      <div style={css('padding:12px 2px 0;')}>
        <div className="agx-card-title" style={css('font-size:14.5px;font-weight:700;')}>{p.title}</div>
        <div style={css('font-size:12.5px;color:var(--ag-muted);margin-top:2px;')}>{p.boutique}</div>
        <div style={css('display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;')}>
          <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:19px;")}>{fmt(p.price)}</span>
          {p.reviews > 0 && (
            <span style={css('display:flex;align-items:center;gap:3px;font-size:12px;font-weight:700;color:var(--ag-ink-2);')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-star);")}>star</span>
              {p.rating}
              <span style={css('color:var(--ag-muted-soft);font-weight:600;')}>({compactCount(p.reviews)})</span>
            </span>
          )}
        </div>
      </div>
    </CardLink>
  );
}

// ── States ──────────────────────────────────────────────────────────────────

/**
 * "Nothing here" — but only once we know that for a fact.
 *
 * Every catalogue surface reached this component whenever its list came back
 * short, including when the list was short because the database never answered.
 * The result was a shop that told buyers on a patchy connection there were no
 * new arrivals, no best sellers and no boutiques, with no way to retry.
 *
 * Reading `CatalogContext` here rather than threading `error` through all five
 * callers keeps the check impossible to forget: this component is only ever
 * rendered by catalogue pages, and none of them can honestly claim emptiness
 * while the load is failing.
 */
export function EmptyState({ icon, title, body, action }: { icon: string; title: string; body: string; action?: ReactNode }) {
  const { error, reload } = useCatalog();
  if (error) return <CatalogError onRetry={reload} />;
  return (
    <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;padding:48px 24px;text-align:center;margin-top:20px;')}>
      <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:44px;color:rgba(176,36,84,.28);`)}>{icon}</span>
      <div style={css('color:var(--ag-ink);font-size:16px;font-weight:700;margin-top:12px;')}>{title}</div>
      <div style={css('color:var(--ag-muted);font-size:13.5px;margin-top:6px;line-height:1.6;max-width:380px;margin-left:auto;margin-right:auto;')}>{body}</div>
      {action && <div style={css('margin-top:18px;')}>{action}</div>}
    </div>
  );
}

/** Skeleton tiles while the catalogue is still loading. */
export function CardSkeletons({ count = 10 }: { count?: number }) {
  return (
    <SkeletonGroup label="Loading styles…">
      <div className="agx-rgrid">
        {Array.from({ length: count }, (_, i) => (
          <div key={i}>
            <div className="agx-prod-media agx-shimmer" />
            <Skeleton w="80%" style="margin-top:12px;" />
            <Skeleton w="45%" style="margin-top:8px;" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}

/** "Show more" — these lists can run to hundreds; a page that dumps them all
 *  costs a phone its scroll performance and the buyer their place in the list. */
export function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <div style={css('display:flex;flex-direction:column;align-items:center;gap:8px;margin-top:28px;')}>
      <button
        onClick={onMore}
        style={css('border:1px solid var(--ag-border-soft);background:var(--ag-surface);cursor:pointer;padding:12px 26px;border-radius:999px;font-size:13.5px;font-weight:700;color:var(--ag-crimson);font-family:inherit;box-shadow:0 12px 28px -20px rgba(107,20,54,.6);')}
      >
        Show more
      </button>
      <span style={css("font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ag-muted-soft);")}>{shown} of {total}</span>
    </div>
  );
}
