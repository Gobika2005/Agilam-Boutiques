import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { resolveDisplayName } from '@/lib/displayName';

export function ProfileHub() {
  const navigate = useNavigate();
  const { signOut, profile, session } = useAuth();
  const { boutique, loading } = useMyBoutique();

  // Header identity comes from the signed-in account: the seller's own boutique
  // row plus their profile/OAuth name — never a hardcoded sample boutique.
  const ownerName = resolveDisplayName(profile, session);
  const boutiqueName = boutique?.name || (loading ? '' : ownerName ? `${ownerName}'s Boutique` : 'Your Boutique');
  const initial = (boutiqueName || ownerName || 'B').trim().charAt(0).toUpperCase();
  const subline = [boutique?.city, ownerName && `Owner: ${ownerName}`].filter(Boolean).join(' · ');

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
        { label: 'Customer Orders', sub: 'Buyers & their history', icon: 'group', to: '/seller/customers' },
      ],
    },
    {
      title: 'Money & insights',
      rows: [
        { label: 'Promote & Ads', sub: 'Advertise on the marketplace', icon: 'campaign', to: '/seller/promote' },
        { label: 'Coupons', sub: 'Discount codes for your boutique', icon: 'local_offer', to: '/seller/coupons' },
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
    <div style={css('min-height:100%;background:#FBF6F2;padding-bottom:20px;')}>
      <div style={css('background:linear-gradient(150deg,#D6336C,#B02454);padding:24px 20px 30px;color:#fff;')}>
        <div style={css('display:flex;align-items:center;gap:14px;')}>
          <div style={css("width:64px;height:64px;flex:none;border-radius:20px;overflow:hidden;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:28px;")}>
            {boutique?.logo_url ? <img src={boutique.logo_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} /> : initial}
          </div>
          <div>
            <div style={css('display:flex;align-items:center;gap:5px;')}>
              <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:23px;")}>{boutiqueName || '…'}</span>
              {boutique?.verified && <span style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>verified</span>}
            </div>
            {subline && <div style={css('opacity:.85;font-size:13px;')}>{subline}</div>}
            {session?.user?.email && <div style={css('opacity:.7;font-size:12px;margin-top:2px;')}>{session.user.email}</div>}
          </div>
        </div>
      </div>

      {sections.map((sec) => (
        <div key={sec.title} style={css('margin:18px 20px 0;')}>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:#B02454;margin:0 4px 8px;')}>{sec.title}</div>
          <div style={css('background:#fff;border-radius:18px;padding:6px;box-shadow:0 12px 30px -20px rgba(107,20,54,.6);')}>
            {sec.rows.map((r, i) => (
              <button key={r.label} onClick={() => navigate(r.to)} style={css(`width:100%;display:flex;align-items:center;gap:13px;padding:13px 12px;border:none;background:none;cursor:pointer;border-bottom:${i < sec.rows.length - 1 ? '1px solid #F5E4EC' : 'none'};text-align:left;`)}>
                <span style={css('width:38px;height:38px;flex:none;border-radius:11px;background:#FCE0EC;display:flex;align-items:center;justify-content:center;')}>
                  <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:20px;")}>{r.icon}</span>
                </span>
                <span style={css('flex:1;min-width:0;')}>
                  <span style={css('display:block;font-weight:700;font-size:14.5px;')}>{r.label}</span>
                  {r.sub && <span style={css('display:block;font-size:11.5px;color:#A98D99;font-weight:600;margin-top:1px;')}>{r.sub}</span>}
                </span>
                <span style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;")}>chevron_right</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <button onClick={logout} style={css('margin:16px 20px 0;width:calc(100% - 40px);height:50px;border:1.5px solid #F0D8E2;background:#fff;color:#D6455A;border-radius:14px;font-weight:800;cursor:pointer;')}>
        Log out
      </button>
    </div>
  );
}
