import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { useShop } from '@/state/ShopContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { resolveDisplayName } from '@/lib/displayName';
import { BOUTIQUE_STATUS_LABEL } from '@/data/types';
import type { BoutiqueStatus } from '@/data/types';

const STATUS_TONE: Record<BoutiqueStatus, { fg: string; icon: string }> = {
  draft: { fg: 'var(--ag-gold-text)', icon: 'edit_note' },
  pending: { fg: 'var(--ag-info-text)', icon: 'hourglass_top' },
  changes_requested: { fg: 'var(--ag-gold-text)', icon: 'feedback' },
  approved: { fg: 'var(--ag-good)', icon: 'verified' },
  rejected: { fg: '#D6455A', icon: 'cancel' },
};

/**
 * Seller quick-profile popup from the header avatar — the "most needed" glance:
 * boutique identity, live/verification standing, the public storefront, and the
 * shortcuts a seller reaches for daily. "All settings" opens the full hub.
 */
export function ProfileMenu({ close }: { close: () => void }) {
  const navigate = useNavigate();
  const { signOut, profile, session } = useAuth();
  const { showToast } = useShop();
  const { boutique, loading } = useMyBoutique();

  const ownerName = resolveDisplayName(profile, session);
  const boutiqueName = boutique?.name || (loading ? '…' : ownerName ? `${ownerName}'s Boutique` : 'Your Boutique');
  const initial = (boutiqueName || ownerName || 'B').trim().charAt(0).toUpperCase();
  const email = session?.user?.email ?? '';
  const status = boutique?.status;
  const tone = status ? STATUS_TONE[status] : null;

  const go = (to: string) => { close(); navigate(to); };

  const shareStorefront = async () => {
    if (!boutique) return;
    const url = `${window.location.origin}/buyer/boutique/${boutique.id}`;
    const share = (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }).share;
    try {
      if (share) await share.call(navigator, { title: boutique.name, text: `Shop ${boutique.name} on MangaiMart`, url });
      else { await navigator.clipboard.writeText(url); showToast('Shop link copied'); }
    } catch { /* dismissed */ }
  };

  const links = [
    { label: 'Orders', icon: 'receipt_long', to: '/seller/orders' },
    { label: 'Earnings & payouts', icon: 'payments', to: '/seller/earnings' },
    { label: 'Analytics', icon: 'insights', to: '/seller/analytics' },
    { label: 'Boutique profile', icon: 'store', to: '/seller/boutique' },
  ];

  const logout = async () => {
    close();
    await signOut();
    navigate('/buyer/home', { replace: true });
  };

  return (
    <>
      {/* Identity */}
      <div style={css('display:flex;align-items:center;gap:10px;padding:11px 12px;background:linear-gradient(150deg,#D6336C,#B02454);color:#fff;')}>
        <span style={css("width:36px;height:36px;flex:none;border-radius:11px;overflow:hidden;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:15px;")}>
          {boutique?.logo_url ? <img src={boutique.logo_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} /> : initial}
        </span>
        <span style={css('flex:1;min-width:0;')}>
          <span style={css("display:flex;align-items:center;gap:4px;font-family:'Playfair Display',serif;font-weight:700;font-size:14.5px;line-height:1.15;")}>
            <span style={css('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{boutiqueName}</span>
            {boutique?.verified && <span style={css("font-family:'Material Symbols Outlined';font-size:14px;flex:none;")}>verified</span>}
          </span>
          {email && <span style={css('display:block;font-size:10.5px;opacity:.85;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{email}</span>}
        </span>
        <button onClick={close} aria-label="Close" style={css('flex:none;width:26px;height:26px;border-radius:8px;border:none;background:rgba(255,255,255,.16);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>close</span>
        </button>
      </div>

      {/* Standing + storefront actions */}
      {status && tone && (
        <div style={css('display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:7px 11px;border-bottom:1px solid var(--ag-border-soft);')}>
          <button onClick={() => status !== 'approved' && go('/seller/verification')} style={css(`display:inline-flex;align-items:center;gap:4px;background:var(--ag-surface-2);color:${tone.fg};border:none;border-radius:999px;padding:5px 9px;font-size:10.5px;font-weight:800;cursor:${status === 'approved' ? 'default' : 'pointer'};font-family:inherit;`)}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:14px;")}>{tone.icon}</span>
            {status === 'approved' ? 'Live on MangaiMart' : BOUTIQUE_STATUS_LABEL[status]}
          </button>
          {boutique && (
            <>
              <button onClick={() => go(`/buyer/boutique/${boutique.id}`)} style={css('display:inline-flex;align-items:center;gap:4px;background:var(--ag-surface-2);color:var(--ag-crimson);border:none;border-radius:999px;padding:5px 9px;font-size:10.5px;font-weight:800;cursor:pointer;font-family:inherit;')}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:14px;")}>visibility</span>View shop
              </button>
              <button onClick={shareStorefront} style={css('display:inline-flex;align-items:center;gap:4px;background:var(--ag-surface-2);color:var(--ag-crimson);border:none;border-radius:999px;padding:5px 9px;font-size:10.5px;font-weight:800;cursor:pointer;font-family:inherit;')}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:14px;")}>ios_share</span>Share
              </button>
            </>
          )}
        </div>
      )}

      {/* Shortcuts */}
      <div style={css('padding:4px 6px;')}>
        {links.map((l) => (
          <button key={l.label} onClick={() => go(l.to)} style={css('width:100%;display:flex;align-items:center;gap:9px;padding:7px 8px;border:none;background:none;cursor:pointer;text-align:left;border-radius:10px;color:inherit;')}>
            <span style={css("width:26px;height:26px;flex:none;border-radius:8px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;font-family:'Material Symbols Outlined';color:#D6336C;font-size:16px;")}>{l.icon}</span>
            <span style={css('flex:1;font-weight:700;font-size:12.5px;color:var(--ag-ink);')}>{l.label}</span>
            <span style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;font-size:18px;")}>chevron_right</span>
          </button>
        ))}
      </div>

      {/* Full hub + sign out */}
      <div style={css('padding:6px 10px 10px;border-top:1px solid var(--ag-border-soft);display:flex;flex-direction:column;gap:6px;')}>
        <button onClick={() => go('/seller/profile')} style={css('width:100%;height:38px;border:none;border-radius:11px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>settings</span>All settings
        </button>
        <button onClick={logout} style={css('width:100%;height:34px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:#D6455A;border-radius:10px;font-weight:800;font-size:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:15px;")}>logout</span>Log out
        </button>
      </div>
    </>
  );
}
