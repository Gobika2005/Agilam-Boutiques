import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { resolveDisplayName, initialsFrom } from '@/lib/displayName';
import { readOrders } from '@/lib/orderHistory';
import { ProfileEditSheet } from '@/components/buyer/ProfileEditSheet';
import { AccountSheet } from '@/components/buyer/AccountSheet';

/**
 * Buyer quick-profile popup — the "most needed" glance from the header avatar:
 * who you are, whether you're synced, your live counts, and one-tap shortcuts.
 * The full account screen (edit everything, policies, sell, etc.) is one tap
 * away via "Account & settings".
 */
export function ProfileMenu({ close }: { close: () => void }) {
  const navigate = useNavigate();
  const { guest, hasBuyerDetails, wishlist, cartCount, clearGuest } = useShop();
  const { session, profile, signOut } = useAuth();
  const [sheet, setSheet] = useState<'none' | 'edit' | 'account'>('none');

  const signedIn = !!session;
  const name = signedIn ? resolveDisplayName(profile, session, guest.name) || 'Shopper' : hasBuyerDetails ? guest.name : 'Guest shopper';
  const initials = initialsFrom(signedIn || hasBuyerDetails ? name : '');
  const email = session?.user?.email ?? '';
  const subline = [guest.phone && `+91 ${guest.phone}`, guest.city].filter(Boolean).join(' · ') || email || 'Add your details for faster checkout';

  const go = (to: string) => { close(); navigate(to); };

  const stats = [
    { label: 'Orders', value: readOrders().length, icon: 'receipt_long', to: '/orders' },
    { label: 'Wishlist', value: Object.keys(wishlist).length, icon: 'favorite', to: '/wishlist' },
    { label: 'Bag', value: cartCount, icon: 'shopping_bag', to: '/cart' },
  ];

  const links = [
    { label: 'My orders', icon: 'receipt_long', to: '/orders' },
    { label: 'Wishlist', icon: 'favorite', to: '/wishlist' },
    { label: 'Coupons & offers', icon: 'confirmation_number', to: '/coupons' },
    { label: 'Messages', icon: 'chat', to: '/messages' },
  ];

  const logout = async () => {
    close();
    if (session) await signOut();
    clearGuest();
    navigate('/', { replace: true });
  };

  return (
    <>
      {/* Identity */}
      <div style={css('display:flex;align-items:center;gap:10px;padding:11px 12px;background:linear-gradient(150deg,#8E1C44,#B02454 60%,#D6336C);color:#fff;')}>
        <span style={css("width:36px;height:36px;flex:none;border-radius:11px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.3);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:15px;")}>
          {initials || <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>person</span>}
        </span>
        <span style={css('flex:1;min-width:0;')}>
          <span style={css("display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:14.5px;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{name}</span>
          <span style={css('display:block;font-size:10.5px;opacity:.85;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{subline}</span>
        </span>
        <button onClick={close} aria-label="Close" style={css('flex:none;width:26px;height:26px;border-radius:8px;border:none;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>close</span>
        </button>
      </div>

      {/* Sync standing */}
      {signedIn ? (
        <div style={css('display:flex;align-items:center;gap:6px;padding:6px 12px;background:var(--ag-good-bg);color:var(--ag-good-text);font-size:11px;font-weight:800;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-good);")}>verified</span>
          Synced across your devices
        </div>
      ) : (
        <button onClick={() => setSheet('account')} style={css('width:100%;display:flex;align-items:center;gap:7px;padding:8px 12px;border:none;border-bottom:1px solid var(--ag-border-soft);background:var(--ag-surface-2);color:var(--ag-crimson);font-size:11.5px;font-weight:800;cursor:pointer;text-align:left;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>cloud_sync</span>
          <span style={css('flex:1;')}>Sign in to sync</span>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>chevron_right</span>
        </button>
      )}

      {/* Live counts */}
      <div style={css('display:flex;padding:6px 8px 2px;')}>
        {stats.map((s) => (
          <button key={s.label} onClick={() => go(s.to)} style={css('flex:1;background:none;border:none;cursor:pointer;padding:5px 4px;display:flex;flex-direction:column;align-items:center;gap:2px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:17px;")}>{s.icon}</span>
            <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:15px;color:var(--ag-ink);line-height:1;")}>{s.value}</span>
            <span style={css('font-size:9.5px;font-weight:700;color:var(--ag-muted);')}>{s.label}</span>
          </button>
        ))}
      </div>

      {/* Shortcuts */}
      <div style={css('padding:2px 6px 4px;')}>
        {links.map((l) => (
          <button key={l.label} onClick={() => go(l.to)} style={css('width:100%;display:flex;align-items:center;gap:9px;padding:7px 8px;border:none;background:none;cursor:pointer;text-align:left;border-radius:10px;color:inherit;')}>
            <span aria-hidden="true" style={css("width:26px;height:26px;flex:none;border-radius:8px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;font-family:'Material Symbols Outlined';color:#D6336C;font-size:16px;")}>{l.icon}</span>
            <span style={css('flex:1;font-weight:700;font-size:12.5px;color:var(--ag-ink);')}>{l.label}</span>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;font-size:18px;")}>chevron_right</span>
          </button>
        ))}
        {(signedIn || hasBuyerDetails) && (
          <button onClick={() => setSheet('edit')} style={css('width:100%;display:flex;align-items:center;gap:9px;padding:7px 8px;border:none;background:none;cursor:pointer;text-align:left;border-radius:10px;color:inherit;')}>
            <span aria-hidden="true" style={css("width:26px;height:26px;flex:none;border-radius:8px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;font-family:'Material Symbols Outlined';color:#D6336C;font-size:16px;")}>edit</span>
            <span style={css('flex:1;font-weight:700;font-size:12.5px;color:var(--ag-ink);')}>Edit my details</span>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;font-size:18px;")}>chevron_right</span>
          </button>
        )}
      </div>

      {/* Full account + sign out */}
      <div style={css('padding:6px 10px 10px;border-top:1px solid var(--ag-border-soft);display:flex;flex-direction:column;gap:6px;')}>
        <button onClick={() => go('/profile')} style={css('width:100%;height:38px;border:none;border-radius:11px;background:linear-gradient(135deg,#8E1C44,#B02454);color:#fff;font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>settings</span>Account &amp; settings
        </button>
        <button onClick={logout} style={css('width:100%;height:34px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-danger-text);border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;")}>logout</span>
          {signedIn ? 'Log out' : 'Clear my details'}
        </button>
      </div>

      {sheet === 'edit' && <ProfileEditSheet onClose={() => setSheet('none')} />}
      {sheet === 'account' && <AccountSheet onDone={() => { setSheet('none'); close(); }} onClose={() => setSheet('none')} />}
    </>
  );
}
