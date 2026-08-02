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
  /**
   * Which routes belong to which tab.
   *
   * `match` is compared with `isTabActive`, which treats a pattern as "this path
   * or anything under it" — so `/shop` covers `/shop/filter` and `/shop/sort`
   * without listing them, and `'/'` means the home screen and nothing else.
   * (Under the old prefix test `'/'` matched every route in the app, which is
   * why Home stayed lit while you stood on another tab.)
   *
   * The lists below are wider than the tab's own screen on purpose: every buyer
   * route should belong to exactly one tab, or the dock goes blank on the pages
   * people spend the most time on. Browsing anything from the catalogue — a
   * product, a collection, a search — is the Home branch; anything about a shop
   * is the Boutiques branch.
   *
   * `/buyer/boutique` is gone: migration 0057 moved the storefront to root URLs,
   * so a boutique profile is `/boutique/:slug` and that stale pattern had left
   * the Boutiques tab dark on the very screen it names.
   */
  const tabs: TabDef[] = [
    {
      label: 'Home', icon: 'home', to: '/',
      match: ['/', '/shop', '/search', '/collections', '/occasions', '/fabrics',
              '/products', '/new-arrivals', '/best-sellers'],
    },
    {
      label: 'Boutiques', icon: 'storefront', to: '/boutiques',
      match: ['/boutiques', '/boutique', '/top-boutiques'],
    },
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
