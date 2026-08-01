import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ChatView } from '@/components/chat/ChatView';
import { AccountSheet } from '@/components/buyer/AccountSheet';
import { css } from '@/lib/css';
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
  const { boutiqueById, loading: catalogLoading } = useCatalog();
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
      // Surface the real reason. Supabase errors are plain objects (not Error
      // instances), so read `.message` off whatever shape we got before falling
      // back to the generic line — otherwise every failure looked identical.
      const msg =
        e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : '';
      showToast(msg || 'Could not start chat', 'error');
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

  /**
   * Dismissing the sign-in sheet returns the buyer where they came from — the
   * product they were asking about — instead of dropping them on an empty
   * Messages list, which read as "your chat vanished". Home is the fallback for
   * a cold deep link with nothing behind it.
   */
  const leave = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/messages');
  };

  // An id that resolves to no boutique used to render a conversation header for
  // an invented shop called "Boutique", complete with an online status. Say
  // plainly that it isn't there.
  if (!catalogLoading && boutiqueId && !boutique) {
    return (
      <div style={css('min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 20px;')}>
        <div style={css('width:88px;height:88px;border-radius:26px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:44px;color:#D6336C;")}>storefront</span>
        </div>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;margin:20px 0 0;")}>Boutique not found</h1>
        <p style={css('color:var(--ag-muted);font-size:14px;margin:6px 0 0;max-width:380px;')}>
          This shop is no longer on MangaiMart, so there is nobody to chat to here.
        </p>
        <div style={css('display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:22px;')}>
          <button onClick={() => navigate('/messages')} style={css('height:50px;padding:0 26px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer;')}>My messages</button>
          <button onClick={() => navigate('/boutiques')} style={css('height:50px;padding:0 26px;border:1.5px solid var(--ag-border);border-radius:14px;background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:14.5px;cursor:pointer;')}>Browse boutiques</button>
        </div>
      </div>
    );
  }

  const name = boutique?.name ?? 'Boutique';

  return (
    <>
      <ChatView
        name={name}
        avatar={boutique?.logo}
        viewerRole="buyer"
        backTo="/messages"
        conversationId={live?.conversationId}
        senderId={live?.senderId}
        pending={(authLoading || catalogLoading || (signedIn && !live)) && !failed}
        onProductClick={(pid) => navigate(`/products/${pid}`)}
        onOrderClick={(oid) => navigate(`/orders/${encodeURIComponent(oid)}/track`)}
      />
      {!authLoading && !signedIn && (
        <AccountSheet
          title={`Sign in to chat with ${name}`}
          subtitle="Sign in or create an account to start chatting — the boutique sees your name straight from your profile."
          onDone={() => showToast('Signed in')}
          onClose={leave}
        />
      )}
    </>
  );
}
