import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { routes } from '@/lib/seo';
import { breadcrumbSchema, graph, organizationSchema } from '@/lib/schema';
import { FeedPostCard } from '@/components/buyer/FeedPostCard';
import { StoryRail } from '@/components/buyer/StoryRail';
import { useInspireFeed } from '@/hooks/useInspireFeed';
import { InspireFilterSheet } from '@/components/buyer/InspireFilterSheet';
import { NO_FEED_FILTERS, feedFilterCount, type FeedFilters } from '@/lib/feedFilters';

/**
 * Inspire — a scrolling feed of pieces, straight from the catalogue.
 *
 * There is no separate posting step: whatever a boutique lists shows up here,
 * with the shop's own photos, price and description. The next page loads as the
 * sentinel comes into view, so the buyer never taps "load more".
 *
 * Two tabs, and they answer different questions:
 *
 *   • For You is the whole market, ordered by `rankFeed` — recency, likes,
 *     views and orders, blended with a per-visit shuffle, and the same shop's
 *     pieces held apart. It used to lead with the shops you follow and only
 *     widen once those ran out, which made "For You" a slightly longer version
 *     of "Following" for anyone who followed a few boutiques.
 *   • Following is exactly the shops you follow, newest first.
 *
 * There is deliberately no sort control. It was built as a row of chips (New /
 * Most liked / Most viewed / Most ordered) and taken out again: it put a
 * merchandising decision in front of a buyer who has no way to know which lens
 * is worth picking, cost a row of the first screen above the first photograph,
 * and left three of the four orders unseen by almost everybody. The blend does
 * the same job without asking, and re-deals itself each visit so the feed is
 * never the same six cards twice.
 *
 * The screen has no title of its own: the tab bar already says Inspire, and the
 * story rail is a better use of the first 90px than a heading.
 */
/** The two feed lenses, in the order they appear. */
const TABS = [
  { key: 'foryou', label: 'For You', icon: 'auto_awesome' },
  { key: 'following', label: 'Following', icon: 'favorite' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

export function Inspire() {
  usePageMeta({
    title: 'Inspire — New Pieces from Indian Boutiques',
    description: 'A live feed of what MangaiMart boutiques are listing right now. Follow the shops you like and see their new pieces first.',
    canonical: routes.inspire(),
    schema: graph(
      organizationSchema(),
      breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Inspire', path: routes.inspire() }]),
    ),
  });
  const navigate = useNavigate();
  // A social-feed lens (For You / Following) as the primary filter.
  const [tab, setTab] = useState<TabKey>('foryou');

  /**
   * The filter sheet's value, and whether it is open.
   *
   * Held here, in the screen, and nowhere else: leaving Inspire unmounts this
   * component and the filters go with it, so the feed is always the whole market
   * again when the buyer comes back. That is deliberate — a filter left on from
   * a previous session is the commonest way a feed comes to look broken.
   *
   * It applies to both tabs, so "cotton sarees from the shops I follow" is a
   * thing the buyer can ask for.
   */
  const [filters, setFilters] = useState<FeedFilters>(NO_FEED_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const activeFilters = feedFilterCount(filters);

  const { items, followsAnyone, loading, loadingMore, exhausted, error, loadMore, likes, toggleLike } =
    useInspireFeed({ followingOnly: tab === 'following', filters });

  // Infinite scroll. An IntersectionObserver on a sentinel below the last card
  // beats a scroll listener: no per-frame work, and it keeps firing correctly
  // when the feed is inside a scroll container rather than the window.
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || exhausted) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) void loadMore(); },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore, exhausted]);

  return (
    <>
      {/* The feed's own chrome is the story rail and the For You / Following
          tabs — there is no visible title, so this names the screen for anything
          reading the page rather than looking at it. */}
      <h1 className="agx-sr-only">Inspire — new pieces from Indian boutiques</h1>
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div className="agx-feed">
        {/* ── Stories ── */}
        <StoryRail />

        {/* ── Feed lens: For You / Following, then Filter ──
            The two tabs are a segmented control (not loose pills) so they read
            as "which feed am I in". The filter button sits OUTSIDE that control
            rather than as a third segment, because it is not a third feed: it
            narrows whichever one you are in, and putting it inside would make
            the pair look like a choice of three. */}
        <div style={css('display:flex;align-items:stretch;gap:8px;margin:2px 0 10px;')}>
          <div style={css('flex:1;min-width:0;display:flex;gap:4px;background:var(--ag-surface-2);border:1px solid var(--ag-border-soft);border-radius:15px;padding:4px;')}>
            {TABS.map((t) => {
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  style={css(
                    `flex:1;display:flex;align-items:center;justify-content:center;gap:7px;height:38px;border:none;cursor:pointer;border-radius:11px;font-family:inherit;font-weight:800;font-size:13.5px;transition:background .25s ease,color .25s ease,box-shadow .25s ease;background:${
                      on ? 'linear-gradient(135deg,#C62A60,#B02454 70%,#8E1C44)' : 'transparent'
                    };color:${on ? '#fff' : 'var(--ag-muted)'};box-shadow:${
                      on ? '0 1px 0 rgba(255,255,255,.3) inset,0 10px 22px -12px rgba(176,36,84,.9)' : 'none'
                    };`,
                  )}
                >
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>{t.icon}</span>
                  {t.label}
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setSheetOpen(true)}
            aria-label={activeFilters ? `Filter the feed — ${activeFilters} active` : 'Filter the feed'}
            aria-haspopup="dialog"
            style={css(`position:relative;width:48px;flex:none;border-radius:15px;border:1px solid ${activeFilters ? 'transparent' : 'var(--ag-border-soft)'};cursor:pointer;display:flex;align-items:center;justify-content:center;background:${activeFilters ? 'linear-gradient(135deg,#C62A60,#B02454 70%,#8E1C44)' : 'var(--ag-surface-2)'};box-shadow:${activeFilters ? '0 10px 22px -12px rgba(176,36,84,.9)' : 'none'};`)}
          >
            <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:21px;color:${activeFilters ? '#fff' : 'var(--ag-crimson)'};`)}>tune</span>
            {/* The count, so a filter left on is never invisible — the commonest
                way a feed comes to look broken is one nobody remembers setting. */}
            {!!activeFilters && (
              <span style={css('position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--ag-surface);color:var(--ag-crimson);font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;border:1.5px solid #B02454;')}>
                {activeFilters}
              </span>
            )}
          </button>
        </div>

        {/* A filtered feed says so, with the one control that undoes it. Without
            this the buyer has to reopen the sheet to find out why the feed is
            short. */}
        {activeFilters > 0 && (
          <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;margin:-2px 0 10px;font-size:12.5px;')}>
            <span style={css('color:var(--ag-muted);font-weight:600;')}>
              {activeFilters} {activeFilters === 1 ? 'filter' : 'filters'} on{filters.city ? ` · ${filters.city}` : ''}
            </span>
            <button
              onClick={() => setFilters(NO_FEED_FILTERS)}
              style={css('border:none;background:none;color:var(--ag-crimson);font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;')}
            >
              Clear all
            </button>
          </div>
        )}

        {/* ── Feed ── */}
        {loading && (
          <div style={css('display:flex;flex-direction:column;gap:18px;')}>
            {[0, 1].map((i) => (
              <div key={i} style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;overflow:hidden;')}>
                <div style={css('display:flex;align-items:center;gap:11px;padding:13px 14px;')}>
                  <span className="agx-shimmer" style={css('width:44px;height:44px;border-radius:50%;')} />
                  <span style={css('flex:1;')}>
                    <span className="agx-shimmer" style={css('display:block;width:44%;height:12px;border-radius:6px;')} />
                    <span className="agx-shimmer" style={css('display:block;width:28%;height:10px;border-radius:5px;margin-top:7px;')} />
                  </span>
                </div>
                <span className="agx-shimmer" style={css('display:block;width:100%;aspect-ratio:4/5;')} />
                <div style={css('padding:14px 16px 18px;')}>
                  <span className="agx-shimmer" style={css('display:block;width:60%;height:14px;border-radius:7px;')} />
                  <span className="agx-shimmer" style={css('display:block;width:80%;height:11px;border-radius:6px;margin-top:9px;')} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && error && (
          <div style={css('display:flex;gap:12px;padding:16px;background:var(--ag-gold-bg);border:1px solid var(--ag-gold-border);border-radius:18px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-gold-text);font-size:22px;flex:none;")}>cloud_off</span>
            <div style={css('font-size:13px;color:#7A6450;line-height:1.55;')}>{error}</div>
          </div>
        )}

        {!loading && !error && items.length === 0 && (() => {
          // The empty state speaks to *why* it's empty: filters that match
          // nothing, an un-followed Following tab, or a followed one with no new
          // pieces — each with the one action that actually helps. The filter
          // case comes first because it is the only one the buyer caused, and
          // the only one they can undo from here.
          const followingEmpty = tab === 'following';
          const notFollowing = followingEmpty && !followsAnyone && activeFilters === 0;
          const empty = activeFilters > 0
            ? { icon: 'filter_alt_off', title: 'Nothing matches those filters', sub: `No ${tab === 'following' ? 'piece from the shops you follow' : 'piece on the feed'} matches all ${activeFilters === 1 ? 'of that filter' : `${activeFilters} of those filters`} right now. Try loosening one.`, cta: 'Clear filters', act: () => setFilters(NO_FEED_FILTERS) }
            : notFollowing
            ? { icon: 'favorite', title: 'Follow your favourite boutiques', sub: 'Pieces from the shops you follow show up here first. Find a few you love to fill this feed.', cta: 'Discover boutiques', act: () => navigate('/boutiques') }
            : followingEmpty
              ? { icon: 'auto_awesome', title: 'You’re all caught up', sub: 'No new pieces from the shops you follow right now — see what else is new in For You.', cta: 'Switch to For You', act: () => setTab('foryou') }
              : { icon: 'auto_awesome', title: 'Nothing new yet', sub: 'Boutiques are just getting started. Check back soon for new arrivals.', cta: 'Browse boutiques', act: () => navigate('/boutiques') };
          return (
            <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:56px 30px;')}>
              <div style={css('width:82px;height:82px;border-radius:50%;background:linear-gradient(145deg,var(--ag-surface-2),var(--ag-surface-2));display:flex;align-items:center;justify-content:center;box-shadow:inset 0 2px 3px rgba(255,255,255,.7),0 12px 26px -12px rgba(214,51,108,.55);')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:38px;color:var(--ag-crimson);")}>{empty.icon}</span>
              </div>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;margin-top:18px;")}>{empty.title}</div>
              <div style={css('color:var(--ag-muted);font-size:14px;margin-top:8px;max-width:330px;line-height:1.55;')}>
                {empty.sub}
              </div>
              <button
                onClick={empty.act}
                style={css('margin-top:20px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;border:none;border-radius:14px;padding:13px 24px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);')}
              >
                {empty.cta}
              </button>
            </div>
          );
        })()}

        {items.map((p) => (
          <FeedPostCard
            key={p.id}
            product={p}
            liked={!!likes[p.id]}
            likes={p.likes_count ?? 0}
            onToggleLike={() => toggleLike(p.id)}
          />
        ))}

        {/* Infinite-scroll trigger. Sits below the last card so the next page is
            already loading by the time the buyer reaches the bottom. */}
        <div ref={sentinelRef} style={css('height:1px;')} />

        {loadingMore && (
          <div style={css('display:flex;align-items:center;justify-content:center;gap:9px;padding:14px;color:var(--ag-muted-soft);font-size:13px;font-weight:700;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>sync</span>Loading more…
          </div>
        )}

        {!loading && exhausted && items.length > 0 && (
          <div style={css('text-align:center;padding:18px 20px 6px;color:var(--ag-muted-soft);font-size:12.5px;font-weight:700;')}>
            {activeFilters > 0 ? 'That’s everything matching those filters ✦' : 'That’s everything for now ✦'}
          </div>
        )}
      </div>
    </div>

    {/* Mounted only while open, so the sheet always opens on the committed
        filters rather than on a draft the buyer abandoned last time. */}
    {sheetOpen && (
      <InspireFilterSheet
        value={filters}
        onApply={setFilters}
        onClose={() => setSheetOpen(false)}
      />
    )}
    </>
  );
}
