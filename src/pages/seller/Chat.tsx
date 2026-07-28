import { useParams } from 'react-router-dom';
import { ChatView } from '@/components/chat/ChatView';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { fetchConversationPeerName } from '@/data/chat';

// Common openers a boutique reaches for — one tap loads it into the composer.
const QUICK_REPLIES = [
  'Hello! Thank you for reaching out 😊',
  'Yes, this is available.',
  'This piece can be customised to your size.',
  'Could you share your pincode for delivery?',
  'Your order has been dispatched.',
  'Thank you for shopping with us! 🌸',
];

export function Chat() {
  const { id } = useParams();
  const { profile } = useAuth();
  const { data: name } = useAsync(() => (id ? fetchConversationPeerName(id, 'seller') : Promise.resolve('Customer')), [id]);

  return (
    <ChatView
      name={name ?? 'Customer'}
      viewerRole="seller"
      backTo="/seller/messages"
      conversationId={id}
      senderId={profile?.id}
      quickReplies={QUICK_REPLIES}
    />
  );
}
