import { NotificationsInbox } from '@/components/notifications/NotificationsInbox';

export function Notifications() {
  // AdminLayout already renders the page title bar, so the inbox runs headless
  // here rather than stacking a second "Notifications" heading under it.
  return <NotificationsInbox backTo="/admin/overview" embedded />;
}
