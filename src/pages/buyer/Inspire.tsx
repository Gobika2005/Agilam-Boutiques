import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { FeedPostCard } from '@/components/buyer/FeedPostCard';
import { StoryRail } from '@/components/buyer/StoryRail';
import { useInspireFeed } from '@/hooks/useInspireFeed';

/**
 * Inspire — a scrolling feed of new pieces, straight from the catalogue.
 *
 * There is no separate posting step: whatever a boutique lists shows up here for
 * its followers, with the shop's own photos, price and description. The feed
 * runs in two halves — everything from the shops you follow, then everyone else
 * once those run out — with a divider marking the hand-over, so the bottom is
 * never a dead end. The next page loads as the sentinel comes into view, so the
 * buyer never taps "load more".
 *
 * The screen has no title of its own: the tab bar already says Inspire, and the
 * story rail is a better use of the first 90px than a heading.
 */
export function Inspire() {
  const navigate = useNavigate();
  const { items, followsAnyone, loading, loadingMore, exhausted, error, loadMore, likes, toggleLike } =
    useInspireFeed();

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

  // Where the followed half ends and discovery begins. Only meaningful when the
  // buyer follows someone *and* both halves have cards.
  const firstDiscoverIndex = items.findIndex((p) => p.phase === 'discover');
  const showDivider = followsAnyone && firstDiscoverIndex > 0;

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div className="agx-feed">
        {/* ── Stories ── */}
        <StoryRail />

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
          <div style={css('display:flex;gap:12px;padding:16px;background:var(--ag-gold-bg);border:1px solid #F0D8A2;border-radius:18px;')}>
            <span style={css("font-family:'Material Symbols Outlined';color:#C99A3F;font-size:22px;flex:none;")}>cloud_off</span>
            <div style={css('font-size:13px;color:#7A6450;line-height:1.55;')}>{error}</div>
          </div>
        )}

        {!loading && !error && items.length === 0 && (
          <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:56px 30px;')}>
            <div style={css('width:82px;height:82px;border-radius:50%;background:linear-gradient(145deg,var(--ag-surface-2),var(--ag-surface-2));display:flex;align-items:center;justify-content:center;box-shadow:inset 0 2px 3px rgba(255,255,255,.7),0 12px 26px -12px rgba(214,51,108,.55);')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:38px;color:var(--ag-crimson);")}>auto_awesome</span>
            </div>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;margin-top:18px;")}>Nothing new yet</div>
            <div style={css('color:var(--ag-muted);font-size:14px;margin-top:8px;max-width:330px;line-height:1.55;')}>
              Boutiques are just getting started. Check back soon for new arrivals.
            </div>
            <button
              onClick={() => navigate('/buyer/boutiques')}
              style={css('margin-top:20px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;border:none;border-radius:14px;padding:13px 24px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);')}
            >
              Browse boutiques
            </button>
          </div>
        )}

        {items.map((p, i) => (
          <div key={p.id}>
            {/* The hand-over from "shops you follow" to the rest of the market. */}
            {showDivider && i === firstDiscoverIndex && (
              <div style={css('display:flex;align-items:center;gap:12px;margin:6px 0 18px;')}>
                <span style={css('flex:1;height:1px;background:var(--ag-surface-2);')} />
                <span style={css('display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;')}>
                  <span className="agx-eyebrow" style={css('font-size:9px;color:var(--ag-crimson);')}>You’re all caught up</span>
                  <span style={css('font-size:12.5px;color:var(--ag-muted);font-weight:600;')}>More from other boutiques</span>
                </span>
                <span style={css('flex:1;height:1px;background:var(--ag-surface-2);')} />
              </div>
            )}
            <FeedPostCard
              product={p}
              liked={!!likes[p.id]}
              likes={p.likes_count ?? 0}
              onToggleLike={() => toggleLike(p.id)}
            />
          </div>
        ))}

        {/* Infinite-scroll trigger. Sits below the last card so the next page is
            already loading by the time the buyer reaches the bottom. */}
        <div ref={sentinelRef} style={css('height:1px;')} />

        {loadingMore && (
          <div style={css('display:flex;align-items:center;justify-content:center;gap:9px;padding:14px;color:var(--ag-muted-soft);font-size:13px;font-weight:700;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>sync</span>Loading more…
          </div>
        )}

        {!loading && exhausted && items.length > 0 && (
          <div style={css('text-align:center;padding:18px 20px 6px;color:var(--ag-muted-soft);font-size:12.5px;font-weight:700;')}>
            That’s everything for now ✦
          </div>
        )}
      </div>
    </div>
  );
}
