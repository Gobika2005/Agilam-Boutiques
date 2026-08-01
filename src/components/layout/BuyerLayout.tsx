import { AppShell, type TabDef } from './AppShell';
import { LoginPrompt } from '@/components/buyer/LoginPrompt';
import { FloatingBag } from '@/components/buyer/FloatingBag';
import { ProfileMenu } from '@/components/buyer/ProfileMenu';
import { NotificationBellMenu, useUnreadMessageCount } from '@/components/notifications/NotificationBellMenu';

export function BuyerLayout() {
  const unreadMessages = useUnreadMessageCount();

  /**
   * Cart is deliberately not a tab. It moved to the floating bag (see
   * `FloatingBag`), which frees the fifth slot for Inspire — the feed is a
   * destination people return to, whereas the bag is only interesting when it
   * has something in it.
   */
  const tabs: TabDef[] = [
    { label: 'Home', icon: 'home', to: '/', match: ['/', '/shop', '/shop/filter', '/shop/sort'] },
    { label: 'Boutiques', icon: 'storefront', to: '/boutiques', match: ['/boutiques', '/buyer/boutique'] },
    { label: 'Inspire', icon: 'auto_awesome', to: '/inspire', match: ['/inspire'], raised: true },
    { label: 'Orders', icon: 'receipt_long', to: '/orders', match: ['/orders'] },
    { label: 'Messages', icon: 'chat', to: '/messages', match: ['/messages', '/chat'], badge: unreadMessages },
  ];

  return (
    <>
      <AppShell
        tabs={tabs}
        profileTo="/profile"
        homeTo="/"
        searchable
        headerAction={<NotificationBellMenu viewAllTo="/notifications" orderBasePath="" />}
        renderProfileMenu={(close) => <ProfileMenu close={close} />}
      />
      <FloatingBag />
      <LoginPrompt />
    </>
  );
}
