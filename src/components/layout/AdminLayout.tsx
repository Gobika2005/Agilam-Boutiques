import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { useShop } from '@/state/ShopContext';
import { useTheme } from '@/state/ThemeContext';
import { initial } from '@/lib/tokens';
import { RouteErrorBoundary } from '@/components/layout/RouteErrorBoundary';

const NAV = [
  { label: 'Overview', icon: 'dashboard', to: '/admin/overview', title: 'Overview', sub: 'Marketplace health at a glance' },
  { label: 'Approvals', icon: 'verified', to: '/admin/approvals', title: 'Boutique Approvals', sub: 'Review and verify new boutiques' },
  { label: 'Catalogue', icon: 'sell', to: '/admin/catalogue', title: 'Catalogue Vocabulary', sub: 'Categories, occasions and fabrics buyers browse by' },
  { label: 'Boutiques', icon: 'storefront', to: '/admin/boutiques', title: 'Boutiques', sub: 'All boutiques on the platform' },
  { label: 'Users', icon: 'group', to: '/admin/users', title: 'Users', sub: 'Buyers and sellers management' },
  { label: 'Products', icon: 'shopping_bag', to: '/admin/products', title: 'Products', sub: 'Moderation and inventory' },
  { label: 'Orders', icon: 'receipt_long', to: '/admin/orders', title: 'Orders', sub: 'Fulfillment and refunds' },
  { label: 'Reports', icon: 'analytics', to: '/admin/reports', title: 'Reports & Analytics', sub: 'Trends and analytics' },
  { label: 'Payouts', icon: 'account_balance', to: '/admin/payments', title: 'Seller Payouts', sub: 'Settlements after commission and deductions' },
  { label: 'Advertisements', icon: 'campaign', to: '/admin/ads', title: 'Advertisements', sub: 'Campaigns and promotions' },
  { label: 'Coupons', icon: 'local_offer', to: '/admin/coupons', title: 'Coupons', sub: 'Platform & seller discount codes' },
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
  const active = NAV.find((n) => location.pathname.startsWith(n.to)) ?? NAV[0];

  const logout = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <div style={css('min-height:100vh;display:flex;background:var(--ag-bg);')}>
      <div style={css('min-height:100vh;width:100%;background:var(--ag-surface);display:flex;')}>
        {/* admin sidebar — desktop only (hidden ≤900px, replaced by bottom tab bar) */}
        <div className="agx-scroll agx-admin-sidebar" style={css('width:238px;flex:none;background:var(--ag-surface-2);border-right:1px solid var(--ag-border);padding:20px 14px;height:100vh;position:sticky;top:0;overflow-y:auto;display:flex;flex-direction:column;')}>
          <div style={css('display:flex;align-items:center;gap:10px;padding:0 8px 16px;')}>
            <div style={css("width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#D6336C,#B02454);display:flex;align-items:center;justify-content:center;color:#fff;font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>A</div>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:19px;")}>Agilam Admin</div>
          </div>

          {NAV.map((a) => {
            const on = location.pathname.startsWith(a.to);
            return (
              <button
                key={a.to}
                onClick={() => navigate(a.to)}
                style={css(`width:100%;display:flex;align-items:center;gap:11px;padding:11px 12px;border:none;border-radius:11px;cursor:pointer;font-size:13.5px;font-weight:${on ? 700 : 600};text-align:left;margin-top:3px;background:${on ? 'var(--ag-surface)' : 'transparent'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-label)'};box-shadow:${on ? '0 6px 16px -10px var(--ag-shadow)' : 'none'};font-family:inherit;`)}
              >
                <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>{a.icon}</span>
                <span>{a.label}</span>
              </button>
            );
          })}

          <button onClick={logout} style={css('margin-top:auto;width:100%;display:flex;align-items:center;gap:11px;padding:11px 12px;border:none;border-radius:11px;cursor:pointer;font-size:13.5px;font-weight:600;text-align:left;background:transparent;color:#D6455A;font-family:inherit;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>logout</span>
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
              <div className="agx-admin-search" style={css('display:flex;align-items:center;gap:8px;background:var(--ag-surface-2);border-radius:12px;padding:0 12px;height:40px;width:220px;')}>
                <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);font-size:20px;")}>search</span>
                <input placeholder="Search…" style={css('border:none;background:none;flex:1;font-size:13px;min-width:0;color:var(--ag-ink);')} />
              </div>
              <button
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
                aria-label="Toggle theme"
                style={css('width:40px;height:40px;border-radius:12px;background:var(--ag-surface-2);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none;')}
              >
                <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;")}>{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
              </button>
              <div style={css('width:40px;height:40px;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;position:relative;flex:none;')}>
                <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;")}>notifications</span>
                <span style={css('position:absolute;top:8px;right:9px;width:8px;height:8px;border-radius:50%;background:#D6455A;')} />
              </div>
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
              <span translate="no" style={css(`font-family:'Material Symbols Outlined';font-size:22px;font-variation-settings:'FILL' ${on ? 1 : 0};`)}>{a.icon}</span>
              <span style={css('font-size:10px;font-weight:700;white-space:nowrap;')}>{a.label}</span>
            </button>
          );
        })}
        <button
          onClick={logout}
          aria-label="Log out"
          style={css("flex:none;min-width:60px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:6px 8px;border:none;border-radius:14px;cursor:pointer;font-family:inherit;background:transparent;color:#D6455A;")}
        >
          <span translate="no" style={css("font-family:'Material Symbols Outlined';font-size:22px;")}>logout</span>
          <span style={css('font-size:10px;font-weight:700;white-space:nowrap;')}>Log out</span>
        </button>
      </nav>

      {toast && (
        <div style={css('position:fixed;bottom:28px;left:50%;transform:translateX(-50%);background:#2A1A20;color:#fff;padding:13px 22px;border-radius:14px;font-weight:600;font-size:14px;box-shadow:0 16px 40px -14px rgba(0,0,0,.6);z-index:1200;display:flex;align-items:center;gap:10px;animation:agx-fade .2s ease;max-width:calc(100vw - 32px);text-align:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:#F7B7CF;font-size:20px;")}>info</span>
          {toast}
        </div>
      )}
    </div>
  );
}
