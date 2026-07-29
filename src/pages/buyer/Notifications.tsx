import { NotificationsInbox } from '@/components/notifications/NotificationsInbox';

export function Notifications() {
  return <NotificationsInbox backTo="/buyer/profile" orderBasePath="/buyer" />;
}
