import { NotificationsInbox } from '@/components/notifications/NotificationsInbox';
import { usePageMeta } from '@/lib/pageMeta';

export function Notifications() {
  usePageMeta({ title: 'Notifications', description: 'Order updates, replies from boutiques and news from MangaiMart.' });
  return <NotificationsInbox backTo="/profile" console="buyer" />;
}
