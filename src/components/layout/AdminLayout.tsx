import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { useShop } from '@/state/ShopContext';
import { useTheme } from '@/state/ThemeContext';
import { initial } from '@/lib/tokens';
import { RouteErrorBoundary } from '@/components/layout/RouteErrorBoundary';
import { NotificationBellMenu } from '@/components/notifications/NotificationBellMenu';

const NAV = [
  { label: 'Overview', icon: 'dashboard', to: '/admin/overview', title: 'Overview', sub: 'Marketplace health, trends and analytics' },
  { label: 'Approvals', icon: 'verified', to: '/admin/approvals', title: 'Boutique Approvals', sub: 'Review and verify new boutiques' },
  { label: 'Catalogue', icon: 'sell', to: '/admin/catalogue', title: 'Catalogue Vocabulary', sub: 'Categories, occasions and fabrics buyers browse by' },
  { label: 'Boutiques', icon: 'storefront', to: '/admin/boutiques', title: 'Boutiques', sub: 'All boutiques on the platform' },
  { label: 'Users', icon: 'group', to: '/admin/users', title: 'Users', sub: 'Accounts, and Customer 360° buyer history' },
  { label: 'Products', icon: 'shopping_bag', to: '/admin/products', title: 'Products', sub: 'Moderation and inventory' },
  { label: 'Reviews', icon: 'reviews', to: '/admin/reviews', title: 'Reviews', sub: 'Moderate product & boutique reviews' },
  { label: 'Orders', icon: 'receipt_long', to: '/admin/orders', title: 'Orders', sub: 'Fulfillment and refunds' },
  { label: 'Deliveries', icon: 'local_shipping', to: '/admin/deliveries', title: 'Deliveries', sub: 'Delivery disputes, stalled parcels and the courier list' },
  { label: 'Refunds', icon: 'currency_exchange', to: '/admin/refunds', title: 'Refunds', sub: 'Record and track order refunds' },
  { label: 'Payouts', icon: 'account_balance', to: '/admin/payments', title: 'Seller Payouts', sub: 'Settlements after commission and deductions' },
  { label: 'Expenses', icon: 'savings', to: '/admin/expenses', title: 'Expenses', sub: 'What the platform spends, with proof attached' },
  { label: 'Advertisements', icon: 'campaign', to: '/admin/ads', title: 'Advertisements', sub: 'Campaigns and promotions' },
  { label: 'Coupons', icon: 'local_offer', to: '/admin/coupons', title: 'Coupons', sub: 'Platform & seller discount codes' },
  { label: 'Broadcast', icon: 'send', to: '/admin/broadcast', title: 'Broadcast', sub: 'Send a notification to buyers or sellers' },
  { label: 'Audit', icon: 'history', to: '/admin/audit', title: 'Audit Trail', sub: 'Every sensitive admin action, logged' },
  { label: 'Settings', icon: 'settings', to: '/admin/settings', title: 'Platform Settings', sub: 'Commission, fees, return window and more' },
];

/** Console routes with no sidebar tile — opened from the header bell, not the
 *  nav. They still need a title, so they are resolved alongside NAV. */
const OFF_NAV = [
  { label: 'Notifications', icon: 'notifications', to: '/admin/notifications', title: 'Notifications', sub: 'Alerts across the marketplace' },
];

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();
  const { theme, toggleTheme } = useTheme();
  // The buyer AppShell renders the global toast, but admin pages live outside it,
  // so every showToast() on the console (create user, block, delete, errors…) was
  // silently discarded. Render it here too so admin actions give feedback.
  const { toast } = useShop();
  // Routes that exist in the console but deliberately have no sidebar entry —
  // reached from the header instead. Without these the `?? NAV[0]` fallback
  // below labelled them "Overview · Marketplace health at a glance".
  const active =
    NAV.find((n) => location.pathname.startsWith(n.to)) ??
    OFF_NAV.find((n) => location.pathname.startsWith(n.to)) ??
    NAV[0];

  const logout = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <div style={css('min-height:100vh;display:flex;background:var(--ag-bg);')}>
      <div style={css('min-height:100vh;width:100%;background:var(--ag-surface);display:flex;')}>
        {/* admin sidebar — desktop only (hidden ≤900px, replaced by bottom tab bar) */}
        <div className="agx-scroll agx-admin-sidebar" style={css('width:238px;flex:none;background:var(--ag-surface-2);border-right:1px solid var(--ag-border);padding:20px 14px;height:100vh;position:sticky;top:0;overflow-y:auto;display:flex;flex-direction:column;')}>
          <div style={css('display:flex;align-items:center;gap:11px;padding:0 8px 18px;')}>
            {/* 96px WebP, not the 1.7 MB source PNG: this is a 44px sidebar
                mark, and it was the heaviest asset in the admin console. */}
            <img
              src="/mangaimart-logo-96.webp"
              alt="MangaiMart"
              width={44}
              height={44}
              style={css('width:44px;height:44px;border-radius:12px;object-fit:contain;flex:none;')}
            />
            <div>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:19px;line-height:1.15;")}>MangaiMart</div>
              <div style={css('font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--ag-muted);text-transform:uppercase;')}>Admin</div>
            </div>
          </div>

          {NAV.map((a) => {
            const on = location.pathname.startsWith(a.to);
            return (
              <button
                key={a.to}
                onClick={() => navigate(a.to)}
                style={css(`width:100%;display:flex;align-items:center;gap:11px;padding:11px 12px;border:none;border-radius:11px;cursor:pointer;font-size:13.5px;font-weight:${on ? 700 : 600};text-align:left;margin-top:3px;background:${on ? 'var(--ag-surface)' : 'transparent'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-label)'};box-shadow:${on ? '0 6px 16px -10px var(--ag-shadow)' : 'none'};font-family:inherit;`)}
              >
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>{a.icon}</span>
                <span>{a.label}</span>
              </button>
            );
          })}

          {/* Seventeen destinations do not fit a 900px-tall window, so the last
              few (and Log out) sit below the fold. The list scrolls, but with no
              scrollbar and a flush bottom edge there was nothing to say so — this
              spacer keeps the final row clear of the viewport edge and of the
              non-production ribbon. */}
          <div style={css('flex:none;height:10px;')} />
          <button onClick={logout} style={css('margin-top:auto;width:100%;display:flex;align-items:center;gap:11px;padding:11px 12px;border:none;border-radius:11px;cursor:pointer;font-size:13.5px;font-weight:600;text-align:left;background:transparent;color:var(--ag-danger-text);font-family:inherit;margin-bottom:6px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>logout</span>
            <span>Log out</span>
          </button>
        </div>

        {/* admin main */}
        <div className="agx-scroll" style={css('flex:1;display:flex;flex-direction:column;min-width:0;')}>
          <div className="agx-admin-header" style={css('flex:none;padding:20px 30px;border-bottom:1px solid var(--ag-border-soft);display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:0;background:var(--ag-surface);z-index:6;')}>
            <div style={css('min-width:0;')}>
              <div className="agx-admin-header-title" style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:28px;line-height:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;")}>{active.title}</div>
              <div style={css('color:var(--ag-muted);font-size:13px;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{active.sub}</div>
            </div>
            <div style={css('display:flex;align-items:center;gap:14px;flex:none;')}>
              <div className="agx-admin-search agx-field" style={css('display:flex;align-items:center;gap:8px;background:var(--ag-surface-2);border-radius:12px;padding:0 12px;height:40px;width:220px;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);font-size:20px;")}>search</span>
                <input placeholder="Search…" style={css('border:none;background:none;flex:1;font-size:13px;min-width:0;color:var(--ag-ink);')} />
              </div>
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
                aria-label="Toggle theme"
                style={css('width:40px;height:40px;border-radius:12px;background:var(--ag-surface-2);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;')}
              >
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;")}>{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
              </button>
              <NotificationBellMenu viewAllTo="/admin/notifications" />
              <button onClick={logout} title="Log out" style={css('width:40px;height:40px;border-radius:12px;background:#B02454;color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-weight:800;flex:none;')}>
                {initial(profile?.full_name ?? 'Admin K')}
              </button>
            </div>
          </div>

          {/* `agx-scroll-main` marks this as the page's scroller, so ScrollManager
              resets it on navigation — the window never scrolls in the console. */}
          <div className="agx-scroll agx-scroll-main agx-admin-main" style={css('flex:1;overflow-y:auto;padding:26px 30px;background:var(--ag-bg);')}>
            <RouteErrorBoundary>
              <Outlet />
            </RouteErrorBoundary>
          </div>
        </div>
      </div>

      {/* mobile bottom tab bar — shown ≤900px in place of the sidebar */}
      <nav className="agx-admin-tabbar">
        {NAV.map((a) => {
          const on = location.pathname.startsWith(a.to);
          return (
            <button
              key={a.to}
              onClick={() => navigate(a.to)}
              aria-label={a.label}
              style={css(`flex:none;min-width:60px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:6px 8px;border:none;border-radius:14px;cursor:pointer;font-family:inherit;background:${on ? 'var(--ag-surface-2)' : 'transparent'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-muted)'};`)}
            >
              <span aria-hidden="true" translate="no" style={css(`font-family:'Material Symbols Outlined';font-size:22px;font-variation-settings:'FILL' ${on ? 1 : 0};`)}>{a.icon}</span>
              <span style={css('font-size:10px;font-weight:700;white-space:nowrap;')}>{a.label}</span>
            </button>
          );
        })}
        <button
          onClick={logout}
          aria-label="Log out"
          style={css("flex:none;min-width:60px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:6px 8px;border:none;border-radius:14px;cursor:pointer;font-family:inherit;background:transparent;color:var(--ag-danger-text);")}
        >
          <span aria-hidden="true" translate="no" style={css("font-family:'Material Symbols Outlined';font-size:22px;")}>logout</span>
          <span style={css('font-size:10px;font-weight:700;white-space:nowrap;')}>Log out</span>
        </button>
      </nav>

      {toast && (
        <div
          role="status"
          aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
          style={css('position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#2A1A20;color:#fff;padding:13px 22px;border-radius:14px;font-weight:600;font-size:14px;box-shadow:0 16px 40px -14px rgba(0,0,0,.6);z-index:1400;display:flex;align-items:center;gap:10px;animation:agx-fade .2s ease;max-width:calc(100vw - 32px);text-align:center;')}
        >
          <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';color:${toast.tone === 'error' ? '#FFB4A8' : '#F7B7CF'};font-size:20px;flex:none;`)}>
            {toast.tone === 'error' ? 'error' : 'info'}
          </span>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
