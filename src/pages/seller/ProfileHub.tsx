import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { useShop } from '@/state/ShopContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { resolveDisplayName } from '@/lib/displayName';
import { shareBoutique } from '@/lib/share';
import { BOUTIQUE_STATUS_LABEL } from '@/data/types';
import type { BoutiqueStatus } from '@/data/types';

// Every status gets a colour + icon so the seller can read their standing at a
// glance from the header, not only when something is wrong.
const STATUS_TONE: Record<BoutiqueStatus, { fg: string; icon: string }> = {
  draft: { fg: 'var(--ag-gold-text)', icon: 'edit_note' },
  pending: { fg: 'var(--ag-info-text)', icon: 'hourglass_top' },
  changes_requested: { fg: 'var(--ag-gold-text)', icon: 'feedback' },
  approved: { fg: 'var(--ag-good-text)', icon: 'verified' },
  rejected: { fg: 'var(--ag-danger-text)', icon: 'cancel' },
};

export function ProfileHub() {
  const navigate = useNavigate();
  const { signOut, profile, session } = useAuth();
  const { showToast } = useShop();
  const { boutique, loading } = useMyBoutique();

  // Header identity comes from the signed-in account: the seller's own boutique
  // row plus their profile/OAuth name — never a hardcoded sample boutique.
  const ownerName = resolveDisplayName(profile, session);
  const boutiqueName = boutique?.name || (loading ? '' : ownerName ? `${ownerName}'s Boutique` : 'Your Boutique');
  const initial = (boutiqueName || ownerName || 'B').trim().charAt(0).toUpperCase();
  const subline = [boutique?.city, ownerName && `Owner: ${ownerName}`].filter(Boolean).join(' · ');

  const status = boutique?.status;
  const tone = status ? STATUS_TONE[status] : null;

  // The public storefront a buyer sees, so the seller can preview or share it.
  const storefrontPath = boutique ? `/buyer/boutique/${boutique.id}` : null;
  // Sends the shop's logo along with the caption where the browser supports it,
  // so the storefront lands in WhatsApp looking like the shop rather than as a
  // bare link — the same treatment a product gets. See `shareBoutique`.
  const shareStorefront = async () => {
    if (!boutique) return;
    const result = await shareBoutique({
      name: boutique.name,
      url: `${window.location.origin}/buyer/boutique/${boutique.id}`,
      logo: boutique.logo_url ?? undefined,
      cover: boutique.cover_url ?? undefined,
      city: [boutique.area, boutique.city].filter(Boolean).join(', ') || undefined,
      desc: boutique.description || undefined,
    });
    if (result === 'copied') showToast('Shop link copied');
    else if (result === 'failed') showToast("Couldn't share your shop", 'error');
  };

  // Grouped so the hub reads as sections rather than one long undifferentiated
  // list. Business & bank / GST / pickup / hours are all captured in the setup
  // wizard, so "Business details" opens that flow; the storefront basics live in
  // the lighter Boutique Profile editor.
  const sections: { title: string; rows: { label: string; sub?: string; icon: string; to: string }[] }[] = [
    {
      title: 'Business',
      rows: [
        ...(boutique && boutique.status !== 'approved'
          ? [{ label: 'Verification status', sub: 'Track your approval', icon: 'verified_user', to: '/seller/verification' }]
          : []),
        { label: 'Boutique Profile', sub: 'Name, logo, storefront', icon: 'store', to: '/seller/boutique' },
        { label: 'Business details', sub: 'Bank, GST, pickup, hours', icon: 'badge', to: '/seller/onboarding' },
        { label: 'Customers', sub: 'Buyers & their order history', icon: 'group', to: '/seller/customers' },
      ],
    },
    {
      title: 'Money & insights',
      rows: [
        { label: 'Promote & Ads', sub: 'Advertise on the marketplace', icon: 'campaign', to: '/seller/promote' },
        { label: 'Coupons', sub: 'Discount codes for your boutique', icon: 'local_offer', to: '/seller/coupons' },
        { label: 'Reviews', sub: 'Buyer ratings — reply in public', icon: 'reviews', to: '/seller/reviews' },
        { label: 'Earnings & payouts', sub: 'What you have earned', icon: 'payments', to: '/seller/earnings' },
        { label: 'Analytics', sub: 'Trends & performance', icon: 'insights', to: '/seller/analytics' },
        { label: 'Billing (Offline Sales)', sub: 'Walk-in invoices', icon: 'receipt_long', to: '/seller/billing' },
      ],
    },
    {
      title: 'Account',
      rows: [
        { label: 'Notifications', sub: 'Alerts & activity', icon: 'notifications', to: '/seller/notifications' },
        { label: 'Settings', sub: 'Preferences', icon: 'settings', to: '/seller/settings' },
        { label: 'Help & Support', sub: 'Get in touch', icon: 'help', to: '/seller/help' },
      ],
    },
  ];

  const logout = async () => {
    await signOut();
    navigate('/buyer/home', { replace: true });
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      {/* The page's identity is carried visually by the boutique card; screen
          readers need an actual heading to navigate to. */}
      <h1 className="agx-sr-only">Your profile</h1>
      <div style={css('background:linear-gradient(150deg,#D6336C,#B02454);padding:24px 20px 30px;color:#fff;')}>
        {/* The whole identity card opens the profile editor — one tap to manage
            "who am I" from the top of the hub — with an explicit Edit chip so the
            affordance is discoverable, not hidden. */}
        <div style={css('display:flex;align-items:center;gap:14px;')}>
          <button onClick={() => navigate('/seller/boutique')} aria-label="Edit boutique profile" style={css('flex:1;min-width:0;display:flex;align-items:center;gap:14px;border:none;background:none;color:inherit;cursor:pointer;text-align:left;padding:0;font-family:inherit;')}>
            <span style={css("width:64px;height:64px;flex:none;border-radius:20px;overflow:hidden;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:28px;")}>
              {boutique?.logo_url ? <img src={boutique.logo_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} /> : initial}
            </span>
            <span style={css('min-width:0;')}>
              <span style={css('display:flex;align-items:center;gap:5px;')}>
                <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:23px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;")}>{boutiqueName || '…'}</span>
                {boutique?.verified && <span style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>verified</span>}
              </span>
              {subline && <span style={css('display:block;opacity:.85;font-size:13px;')}>{subline}</span>}
              {session?.user?.email && <span style={css('display:block;opacity:.7;font-size:12px;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{session.user.email}</span>}
            </span>
          </button>
          <span style={css('flex:none;display:inline-flex;align-items:center;gap:5px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.28);padding:7px 12px;border-radius:11px;font-size:12px;font-weight:800;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>edit</span>Edit
          </span>
        </div>

        {/* Always-visible standing + shortcuts to the public shop, so a seller
            never has to hunt for "am I live?" or "what do buyers see?". */}
        {status && tone && (
          <div style={css('display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:16px;')}>
            <button
              onClick={() => status !== 'approved' && navigate('/seller/verification')}
              style={css(`display:inline-flex;align-items:center;gap:6px;background:var(--ag-surface);color:${tone.fg};border:none;border-radius:999px;padding:7px 13px;font-size:12px;font-weight:800;cursor:${status === 'approved' ? 'default' : 'pointer'};font-family:inherit;`)}
            >
              <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>{tone.icon}</span>
              {status === 'approved' ? 'Live on MangaiMart' : BOUTIQUE_STATUS_LABEL[status]}
            </button>
            {storefrontPath && (
              <>
                <button onClick={() => navigate(storefrontPath)} style={css('display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:7px 13px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;')}>
                  <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>visibility</span>View shop
                </button>
                <button onClick={shareStorefront} style={css('display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.16);color:#fff;border:1px solid rgba(255,255,255,.28);border-radius:999px;padding:7px 13px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;')}>
                  <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>ios_share</span>Share
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {sections.map((sec) => (
        <div key={sec.title} style={css('margin:18px 20px 0;')}>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);margin:0 4px 8px;')}>{sec.title}</div>
          <div style={css('background:var(--ag-surface);border-radius:18px;padding:6px;box-shadow:0 12px 30px -20px rgba(107,20,54,.6);')}>
            {sec.rows.map((r, i) => (
              <button key={r.label} onClick={() => navigate(r.to)} style={css(`width:100%;display:flex;align-items:center;gap:13px;padding:13px 12px;border:none;background:none;cursor:pointer;border-bottom:${i < sec.rows.length - 1 ? '1px solid var(--ag-border-soft)' : 'none'};text-align:left;`)}>
                <span style={css('width:38px;height:38px;flex:none;border-radius:11px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
                  <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:20px;")}>{r.icon}</span>
                </span>
                <span style={css('flex:1;min-width:0;')}>
                  <span style={css('display:block;font-weight:700;font-size:14.5px;')}>{r.label}</span>
                  {r.sub && <span style={css('display:block;font-size:11.5px;color:var(--ag-muted);font-weight:600;margin-top:1px;')}>{r.sub}</span>}
                </span>
                <span style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;")}>chevron_right</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <button onClick={logout} style={css('margin:16px 20px 0;width:calc(100% - 40px);height:50px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-danger-text);border-radius:14px;font-weight:800;cursor:pointer;')}>
        Log out
      </button>
    </div>
  );
}
