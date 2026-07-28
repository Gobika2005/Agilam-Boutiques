import { useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { SellModal } from '@/components/SellModal';
import { GlobalSearch } from '@/components/buyer/GlobalSearch';
import { initialsFrom, resolveDisplayName } from '@/lib/displayName';

/**
 * Premium header profile button — shows the user's initials in a gradient
 * avatar (falling back to an icon before they've told us their name). Reused
 * for the desktop and mobile header slots.
 */
function ProfileAvatar({ initials, onClick, className }: { initials: string; onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={className}
      style={css('width:44px;height:44px;flex:none;border-radius:14px;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#E14A7E,#B02454 70%,#8E1C44);color:#fff;box-shadow:0 1px 0 rgba(255,255,255,.35) inset,0 12px 26px -12px rgba(176,36,84,.9);')}
    >
      {initials ? (
        <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:16px;letter-spacing:.02em;")}>{initials}</span>
      ) : (
        <span style={css("font-family:'Material Symbols Outlined';font-size:24px;")}>person</span>
      )}
    </button>
  );
}

export type TabDef = {
  label: string;
  icon: string;
  to: string;
  /** Route prefixes that keep this tab highlighted. */
  match: string[];
  badge?: number;
  /** Promotes this tab to the floating centre orb (see `RaisedTab`). */
  raised?: boolean;
};

function Tab({ tab, active, onClick }: { tab: TabDef; active: boolean; onClick: () => void }) {
  const hasBadge = !!tab.badge;
  // Flat dock item: no pill, no lift — the active tab simply tints its icon and
  // label in the brand crimson while the rest stay muted.
  const tint = active ? 'var(--ag-crimson)' : '#9A8189';
  return (
    <button
      onClick={onClick}
      style={css(
        `display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-width:68px;border:none;cursor:pointer;padding:10px 16px;border-radius:20px;font-family:inherit;white-space:nowrap;background:transparent;color:${tint};transition:color .28s ease;`,
      )}
    >
      <span style={css('position:relative;display:inline-flex;')}>
        <span style={css(`font-family:'Material Symbols Outlined';font-size:23px;font-variation-settings:'FILL' ${active ? 1 : 0};`)}>{tab.icon}</span>
        {hasBadge && (
          <span style={css('position:absolute;top:-6px;right:-10px;min-width:18px;height:18px;padding:0 4px;border-radius:9px;background:#D6336C;color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff;')}>
            {tab.badge}
          </span>
        )}
      </span>
      <span style={css(`font-size:11px;font-weight:${active ? 800 : 700};`)}>{tab.label}</span>
    </button>
  );
}

/**
 * The centre tab breaks out of the dock's top edge as a floating orb, so the
 * app's signature destination reads as a hero action rather than one of five
 * equals. It keeps the jewelled gradient whether or not it is the current
 * route — only the glow and lift respond to `active`.
 */
function RaisedTab({ tab, active, onClick }: { tab: TabDef; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="agx-dock-fab"
      aria-label={tab.label}
      style={css('align-self:flex-start;margin-top:-26px;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:68px;padding:0 8px;border:none;background:none;cursor:pointer;font-family:inherit;white-space:nowrap;')}
    >
      <span
        className="agx-dock-fab-orb"
        style={css(
          `display:flex;align-items:center;justify-content:center;width:54px;height:54px;border-radius:50%;background:linear-gradient(140deg,#F06A96,#B02454 62%,#7E1A3E);border:4px solid rgba(255,255,255,.92);color:#fff;box-shadow:0 1px 0 rgba(255,255,255,.45) inset,0 14px 30px -10px rgba(176,36,84,${active ? '.95' : '.7'}),0 0 0 ${active ? '7px' : '0px'} rgba(224,74,126,.15);transform:translateY(${active ? '-3px' : '0'}) scale(${active ? '1.05' : '1'});transition:transform .3s cubic-bezier(.2,.7,.2,1),box-shadow .3s ease;`,
        )}
      >
        <span style={css("font-family:'Material Symbols Outlined';font-size:26px;")}>{tab.icon}</span>
      </span>
      <span style={css(`font-size:11px;font-weight:800;color:${active ? 'var(--ag-crimson)' : '#9A8189'};transition:color .28s ease;`)}>
        {tab.label}
      </span>
    </button>
  );
}

export function AppShell({
  tabs,
  profileTo,
  /** Where the wordmark takes you — the app's landing screen for this role. */
  homeTo,
  /** Buyer-only: the header catalogue search. */
  searchable,
  /** Console-wide notice pinned above every page (seller verification status). */
  banner,
  /** Optional AppBar element (the seller notification bell) shown before the
   *  profile avatar. Kept off the buyer shell. */
  headerAction,
  /** When provided, tapping the header avatar opens this as a quick-glance
   *  popup (identity + the most-needed shortcuts) instead of jumping straight to
   *  the full profile page. `close` dismisses the popup. */
  renderProfileMenu,
}: {
  tabs: TabDef[];
  profileTo: string;
  homeTo: string;
  searchable?: boolean;
  banner?: ReactNode;
  headerAction?: ReactNode;
  renderProfileMenu?: (close: () => void) => ReactNode;
}) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { toast, sellModal, guest } = useShop();
  const { profile, session } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  // Resolve a display name for the avatar initials from the signed-in account,
  // so a signed-in user always gets initials instead of the fallback icon.
  const initials = initialsFrom(resolveDisplayName(profile, session, guest.name));

  // The avatar opens the quick popup when a menu is supplied; otherwise it is a
  // plain shortcut to the full profile screen.
  const onProfileTap = renderProfileMenu ? () => setMenuOpen((o) => !o) : () => navigate(profileTo);

  return (
    <div style={css('min-height:100vh;background:var(--ag-bg);')}>
      {sellModal && <SellModal />}

      <div style={css('min-height:100vh;display:flex;flex-direction:column;background:var(--ag-bg);')}>
        <header style={css('position:sticky;top:0;z-index:30;background:var(--ag-frost);backdrop-filter:blur(14px);border-bottom:1px solid var(--ag-border-soft);')}>
          <div className="agx-app agx-app-header" style={css('display:flex;align-items:center;gap:20px;padding:20px 16px;')}>
            {/* The wordmark is the way home from anywhere in the app. */}
            <button
              onClick={() => navigate(homeTo)}
              aria-label="MangaiMart — go to home"
              title="Go to home"
              style={css('display:flex;align-items:center;gap:11px;border:none;background:none;cursor:pointer;padding:0;height:84px;flex:none;')}
            >
              <img
                className="agx-brand-mark"
                src="/mangaimart-wordmark.png"
                alt="MangaiMart"
                style={css('width:240px;height:84px;object-fit:contain;object-position:left center;')}
              />
            </button>

            <div style={css('flex:1;min-width:8px;')} />

            {searchable && <GlobalSearch className="agx-only-desktop agx-search-desktop" />}

            {headerAction}

            <ProfileAvatar initials={initials} onClick={onProfileTap} className="agx-only-desktop" />

            {/* Below 960px the header is a single row: wordmark, search icon,
                profile. A permanently-open search field cost a whole second row
                of chrome on every screen — it opens as a sheet on tap instead. */}
            {searchable && <GlobalSearch className="agx-only-mobile" variant="icon" />}

            <ProfileAvatar initials={initials} onClick={onProfileTap} className="agx-only-mobile" />
          </div>
        </header>

        {/* Quick profile popup — anchored under the header on the same (right)
            side as both the desktop and mobile avatars, so one fixed position
            serves either breakpoint. The backdrop closes it on an outside tap. */}
        {menuOpen && renderProfileMenu && (
          <>
            <div
              onClick={() => setMenuOpen(false)}
              style={css('position:fixed;inset:0;z-index:60;background:transparent;')}
            />
            <div
              style={css('position:fixed;top:70px;right:12px;left:auto;z-index:61;width:min(296px,calc(100vw - 24px));background:var(--ag-surface);border:1px solid var(--ag-border-soft);border-radius:18px;box-shadow:0 26px 60px -22px var(--ag-shadow),0 2px 0 rgba(255,255,255,.15) inset;overflow:hidden;animation:agx-sheet .2s ease;')}
            >
              {renderProfileMenu(() => setMenuOpen(false))}
            </div>
          </>
        )}

        <main className="agx-app agx-app-main" style={css('flex:1;width:100%;padding:16px 18px 128px;')}>
          {banner}
          <Outlet />
        </main>

        <div
          className="agx-dock"
          style={css('position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:50;display:flex;gap:5px;background:var(--ag-frost-strong);backdrop-filter:blur(22px) saturate(1.3);border:1px solid var(--ag-frost-border);border-radius:28px;padding:8px;box-shadow:0 2px 0 rgba(255,255,255,.15) inset,0 1px 3px rgba(107,20,54,.1),0 26px 60px -20px var(--ag-shadow);animation:agx-sheet .35s ease;')}
        >
          {tabs.map((t) => {
            const Item = t.raised ? RaisedTab : Tab;
            return (
              <Item
                key={t.label}
                tab={t}
                active={t.match.some((m) => pathname.startsWith(m))}
                onClick={() => navigate(t.to)}
              />
            );
          })}
        </div>
      </div>

      {toast && (
        <div style={css('position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#2A1A20;color:#fff;padding:13px 22px;border-radius:14px;font-weight:600;font-size:14px;box-shadow:0 16px 40px -14px rgba(0,0,0,.6);z-index:999;display:flex;align-items:center;gap:10px;animation:agx-fade .2s ease;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:#F7B7CF;font-size:20px;")}>check_circle</span>
          {toast}
        </div>
      )}
    </div>
  );
}
