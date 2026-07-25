import { AppShell, type TabDef } from './AppShell';
import { LoginPrompt } from '@/components/buyer/LoginPrompt';
import { FloatingBag } from '@/components/buyer/FloatingBag';
import { ProfileMenu } from '@/components/buyer/ProfileMenu';

/**
 * Cart is deliberately not a tab. It moved to the floating bag (see
 * `FloatingBag`), which frees the fifth slot for Inspire — the feed is a
 * destination people return to, whereas the bag is only interesting when it has
 * something in it.
 */
const tabs: TabDef[] = [
  { label: 'Home', icon: 'home', to: '/buyer/home', match: ['/buyer/home', '/buyer/results', '/buyer/filter', '/buyer/sort'] },
  { label: 'Boutiques', icon: 'storefront', to: '/buyer/boutiques', match: ['/buyer/boutiques', '/buyer/boutique'] },
  { label: 'Inspire', icon: 'auto_awesome', to: '/buyer/inspire', match: ['/buyer/inspire'], raised: true },
  { label: 'Orders', icon: 'receipt_long', to: '/buyer/orders', match: ['/buyer/orders'] },
  { label: 'Messages', icon: 'chat', to: '/buyer/messages', match: ['/buyer/messages', '/buyer/chat'] },
];

export function BuyerLayout() {
  return (
    <>
      <AppShell
        tabs={tabs}
        profileTo="/buyer/profile"
        homeTo="/buyer/home"
        searchable
        renderProfileMenu={(close) => <ProfileMenu close={close} />}
      />
      <FloatingBag />
      <LoginPrompt />
    </>
  );
}
