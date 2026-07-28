import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChatView } from '@/components/chat/ChatView';
import { AccountSheet } from '@/components/buyer/AccountSheet';
import { useAuth } from '@/auth/AuthContext';
import { useCatalog } from '@/state/CatalogContext';
import { useShop } from '@/state/ShopContext';
import {
  ensureBuyerIdentity,
  encodeOrderCard,
  encodeProductCard,
  fetchMessages,
  getOrCreateConversation,
  parseOrderCard,
  parseProductCard,
  sendMessage,
  type OrderCard,
  type ProductCard,
} from '@/data/chat';

/**
 * Buyer conversation. The route param is the boutique id (chats are opened from
 * a product or boutique page). Chatting requires a signed-in account: the buyer
 * logs in / signs up once, and their name comes straight from the account
 * profile (Google / email) — no separate name + phone form. Once signed in we
 * reuse that identity and the one conversation they have with that boutique.
 */
export function Chat() {
  const { id: boutiqueId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { boutiqueById } = useCatalog();
  const { showToast } = useShop();
  const { session, loading: authLoading } = useAuth();
  const signedIn = !!session;
  const [live, setLive] = useState<{ conversationId: string; senderId: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const navState = location.state as { product?: ProductCard; order?: OrderCard } | null;
  const pendingProduct = navState?.product ?? null;
  const pendingOrder = navState?.order ?? null;
  const sharedRef = useRef(false);
  const sharedOrderRef = useRef(false);

  useEffect(() => {
    // Hold until the buyer is signed in; their profile identity is the chat
    // participant, so the seller sees the account's real name.
    if (!boutiqueId || !signedIn) return;
    let active = true;
    setLive(null);
    setFailed(false);
    (async () => {
      const buyerId = await ensureBuyerIdentity();
      const conversationId = await getOrCreateConversation(buyerId, boutiqueId);
      if (active) setLive({ conversationId, senderId: buyerId });
    })().catch((e) => {
      if (!active) return;
      setFailed(true);
      showToast(e instanceof Error ? e.message : 'Could not start chat');
    });
    return () => {
      active = false;
    };
  }, [boutiqueId, signedIn, showToast]);

  // Once live, if the buyer arrived from a product's Chat button, post that
  // product as a card so the seller sees which item the enquiry is about. Skip
  // if the same product is already the most recent one shared, to avoid spam.
  useEffect(() => {
    if (!live || !pendingProduct || sharedRef.current) return;
    sharedRef.current = true;
    const { conversationId, senderId } = live;
    const product = pendingProduct;
    (async () => {
      try {
        const msgs = await fetchMessages(conversationId);
        const lastCard = [...msgs].reverse().map((m) => parseProductCard(m.body)).find(Boolean);
        if (lastCard?.id === product.id) return;
        await sendMessage(conversationId, senderId, encodeProductCard(product));
      } catch {
        /* non-fatal: the buyer can still chat */
      }
    })();
  }, [live, pendingProduct]);

  // Same idea for an order enquiry: if the buyer arrived from "Chat with
  // boutique" on an order, post that order as a card so the seller knows which
  // purchase the question is about.
  useEffect(() => {
    if (!live || !pendingOrder || sharedOrderRef.current) return;
    sharedOrderRef.current = true;
    const { conversationId, senderId } = live;
    const order = pendingOrder;
    (async () => {
      try {
        const msgs = await fetchMessages(conversationId);
        const lastCard = [...msgs].reverse().map((m) => parseOrderCard(m.body)).find(Boolean);
        if (lastCard?.orderId === order.orderId) return;
        await sendMessage(conversationId, senderId, encodeOrderCard(order));
      } catch {
        /* non-fatal: the buyer can still chat */
      }
    })();
  }, [live, pendingOrder]);

  const boutique = boutiqueById(boutiqueId);
  const name = boutique?.name ?? 'Boutique';

  return (
    <>
      <ChatView
        name={name}
        avatar={boutique?.logo}
        viewerRole="buyer"
        backTo="/buyer/messages"
        conversationId={live?.conversationId}
        senderId={live?.senderId}
        pending={(authLoading || (signedIn && !live)) && !failed}
        onProductClick={(pid) => navigate(`/buyer/product/${pid}`)}
        onOrderClick={(oid) => navigate(`/buyer/orders/${encodeURIComponent(oid)}/track`)}
      />
      {!authLoading && !signedIn && (
        <AccountSheet
          title={`Sign in to chat with ${name}`}
          subtitle="Sign in or create an account to start chatting — the boutique sees your name straight from your profile."
          onDone={() => showToast('Signed in')}
          onClose={() => navigate('/buyer/messages')}
        />
      )}
    </>
  );
}
