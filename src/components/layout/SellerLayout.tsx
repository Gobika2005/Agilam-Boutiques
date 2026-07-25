import { useLocation, useNavigate } from 'react-router-dom';
import { AppShell, type TabDef } from './AppShell';
import { NotificationBell } from './NotificationBell';
import { ProfileMenu } from '@/components/seller/ProfileMenu';
import { css } from '@/lib/css';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import type { BoutiqueStatus } from '@/data/types';

const tabs: TabDef[] = [
  { label: 'Home', icon: 'home', to: '/seller/dashboard', match: ['/seller/dashboard'] },
  { label: 'Products', icon: 'inventory_2', to: '/seller/products', match: ['/seller/products', '/seller/add-product'] },
  { label: 'Orders', icon: 'receipt_long', to: '/seller/orders', match: ['/seller/orders'] },
  { label: 'Messages', icon: 'chat', to: '/seller/messages', match: ['/seller/messages', '/seller/chat'] },
  {
    label: 'Profile',
    icon: 'person',
    to: '/seller/profile',
    match: ['/seller/profile', '/seller/earnings', '/seller/analytics', '/seller/boutique', '/seller/settings', '/seller/help', '/seller/customers', '/seller/notifications', '/seller/verification'],
  },
];

/**
 * The console-wide verification notice.
 *
 * Sellers are soft-gated: an unapproved boutique can finish its setup and load
 * products, but nothing reaches buyers until an admin approves it. So every
 * screen carries this reminder of where the application stands, plus a shortcut
 * to whatever the seller needs to do next.
 */
const BANNERS: Record<
  Exclude<BoutiqueStatus, 'approved'>,
  { bg: string; border: string; fg: string; accent: string; icon: string; text: string; action: string; to: string }
> = {
  draft: {
    bg: 'var(--ag-gold-bg)', border: 'var(--ag-gold-border)', fg: 'var(--ag-gold-text)', accent: 'var(--ag-gold-text)', icon: 'edit_note',
    text: 'Your boutique setup is not finished — buyers cannot see you yet.',
    action: 'Finish setup', to: '/seller/onboarding',
  },
  pending: {
    bg: 'var(--ag-info-bg)', border: 'var(--ag-info-bg)', fg: 'var(--ag-info-text)', accent: 'var(--ag-info-text)', icon: 'hourglass_top',
    text: 'Your boutique is under review. Products you add now go live as soon as you are approved.',
    action: 'View status', to: '/seller/verification',
  },
  changes_requested: {
    bg: 'var(--ag-gold-bg)', border: 'var(--ag-gold-border)', fg: 'var(--ag-gold-text)', accent: 'var(--ag-gold-text)', icon: 'feedback',
    text: 'Our team asked for a few corrections before your boutique can go live.',
    action: 'See what to fix', to: '/seller/verification',
  },
  rejected: {
    bg: 'var(--ag-bad-bg)', border: 'var(--ag-bad-bg)', fg: 'var(--ag-crimson)', accent: '#D6455A', icon: 'cancel',
    text: 'Your boutique was not approved, so it is not visible to buyers.',
    action: 'See the reason', to: '/seller/verification',
  },
};

/** Seller AppBar actions: global search + the notification bell. */
function SellerHeaderActions() {
  const navigate = useNavigate();
  return (
    <>
      <button
        onClick={() => navigate('/seller/search')}
        aria-label="Search"
        title="Search"
        style={css('width:44px;height:44px;flex:none;border-radius:14px;border:1px solid var(--ag-border-soft);background:var(--ag-surface);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 22px -16px rgba(107,20,54,.7);')}
      >
        <span style={css("font-family:'Material Symbols Outlined';font-size:23px;color:var(--ag-crimson);")}>search</span>
      </button>
      <NotificationBell to="/seller/notifications" />
    </>
  );
}

function VerificationBanner() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { boutique, loading } = useMyBoutique();

  // Nothing to say while loading, once approved, or on the verification screen
  // itself — which already explains the status in full.
  if (loading || !boutique || boutique.status === 'approved') return null;
  if (pathname.startsWith('/seller/verification')) return null;

  const b = BANNERS[boutique.status];
  if (!b) return null;

  return (
    <div style={css(`background:${b.bg};border:1px solid ${b.border};border-radius:16px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:11px;flex-wrap:wrap;`)}>
      <span style={css(`font-family:'Material Symbols Outlined';font-size:21px;color:${b.accent};`)}>{b.icon}</span>
      <span style={css(`flex:1;min-width:200px;font-size:13px;font-weight:600;line-height:1.5;color:${b.fg};`)}>{b.text}</span>
      <button
        onClick={() => navigate(b.to)}
        style={css(`flex:none;height:38px;padding:0 16px;border:none;border-radius:11px;background:${b.accent};color:#fff;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;`)}
      >
        {b.action}
      </button>
    </div>
  );
}

export function SellerLayout() {
  return (
    <AppShell
      tabs={tabs}
      profileTo="/seller/profile"
      homeTo="/seller/dashboard"
      banner={<VerificationBanner />}
      headerAction={<SellerHeaderActions />}
      renderProfileMenu={(close) => <ProfileMenu close={close} />}
    />
  );
}
