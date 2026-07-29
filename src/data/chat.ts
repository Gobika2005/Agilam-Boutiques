import { supabase } from '@/lib/supabase';
import { readGuest } from '@/lib/buyerDetails';
import type { ConversationWithPeer, MessageRow } from './types';

/**
 * Return the current signed-in user's id, or null. Used by read-only surfaces
 * (the buyer inbox) so merely opening Messages never mints a throwaway account.
 */
export async function getBuyerId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/**
 * Give the anonymous buyer a durable identity so their side of the chat is a
 * real, RLS-satisfying participant. Buyers never sign up (they browse the public
 * surface), so the first time one actually opens a conversation we create an
 * anonymous Supabase auth user + matching buyer profile, seeded with the name +
 * phone they gave at the details gate. The session persists in localStorage, so
 * a returning buyer keeps the same threads. Requires "Anonymous sign-ins" to be
 * enabled in the Supabase project's Auth settings.
 */
export async function ensureBuyerIdentity(): Promise<string> {
  let uid = await getBuyerId();
  if (!uid) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) throw error;
    uid = data.user?.id ?? null;
    if (!uid) throw new Error('Could not start a chat session');
  }
  const guest = readGuest();
  const name = guest.name.trim() || 'Customer';
  const phone = guest.phone.trim() || null;
  // Ensure a profile row exists so conversations.buyer_id / messages.sender_id
  // resolve, and the seller sees a real name/number instead of a bare id.
  // upsert/ignoreDuplicates: AuthContext's onAuthStateChange also creates the
  // profile when the anonymous session lands, so tolerate the race.
  await supabase
    .from('profiles')
    .upsert({ id: uid, role: 'buyer', full_name: name, phone }, { onConflict: 'id', ignoreDuplicates: true });
  return uid;
}

/**
 * Push the buyer's latest saved name/phone onto their profile. Called after the
 * details gate so a returning buyer who updates their info is reflected to the
 * boutique (the initial upsert above ignores conflicts, so it won't overwrite).
 */
export async function syncBuyerProfile(): Promise<void> {
  const uid = await getBuyerId();
  if (!uid) return;
  const guest = readGuest();
  if (!guest.name.trim()) return;
  await supabase
    .from('profiles')
    .update({ full_name: guest.name.trim(), phone: guest.phone.trim() || null })
    .eq('id', uid);
}

export async function fetchConversationsForBuyer(buyerId: string): Promise<ConversationWithPeer[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, buyer_id, boutique_id, created_at, buyer_last_read_at, boutique_last_read_at, boutique:boutiques(name, tone), messages(body, created_at, sender_id)')
    .eq('buyer_id', buyerId);
  if (error) throw error;
  return shapeConversations(data ?? [], buyerId, 'buyer');
}

export async function fetchConversationsForBoutique(boutiqueId: string): Promise<ConversationWithPeer[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('id, buyer_id, boutique_id, created_at, buyer_last_read_at, boutique_last_read_at, buyer:profiles!conversations_buyer_id_fkey(full_name), messages(body, created_at, sender_id)')
    .eq('boutique_id', boutiqueId);
  if (error) throw error;
  return shapeConversations(data ?? [], boutiqueId, 'seller');
}

// Friendly one-line preview for the inbox: product-card messages carry an
// encoded body, so surface the product name instead of the raw marker/JSON.
function previewText(body: string): string {
  const card = parseProductCard(body);
  return card ? `🛍️ ${card.title}` : body;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shapeConversations(rows: any[], viewerId: string, mode: 'buyer' | 'seller'): ConversationWithPeer[] {
  return rows
    .map((r) => {
      const msgs = (r.messages ?? []) as { body: string; created_at: string; sender_id: string }[];
      const ordered = [...msgs].sort((a, b) => a.created_at.localeCompare(b.created_at));
      const last = ordered[ordered.length - 1];

      // Which messages are the viewer's own. A buyer sends as themselves, so the
      // id matches directly — but a seller replies as their staff profile, never
      // as the boutique, so `viewerId` (the boutique id) matches nothing on that
      // side. Comparing against it counted the shop's own replies as incoming and
      // the badge never cleared. Anything not from the buyer is the shop's.
      const mine = (senderId: string) => (mode === 'seller' ? senderId !== r.buyer_id : senderId === viewerId);

      // Messages waiting on the viewer. "Seen up to" is the later of two points:
      // the read stamp written when they last opened the thread (migration 0043),
      // and their own last reply (answering implies having read). Counting only
      // incoming messages past that point means simply *reading* a chat clears the
      // badge — previously it stayed until the shop actually replied, so a seller
      // who read a message still saw the unread number.
      const readAt: string = (mode === 'seller' ? r.boutique_last_read_at : r.buyer_last_read_at) ?? '';
      let seenUpTo = readAt;
      for (let i = ordered.length - 1; i >= 0; i--) {
        if (mine(ordered[i].sender_id)) {
          if (ordered[i].created_at > seenUpTo) seenUpTo = ordered[i].created_at;
          break;
        }
      }
      let unread = 0;
      for (const msg of ordered) {
        if (!mine(msg.sender_id) && msg.created_at > seenUpTo) unread++;
      }

      return {
        id: r.id,
        buyer_id: r.buyer_id,
        boutique_id: r.boutique_id,
        created_at: r.created_at,
        buyer_name: mode === 'seller' ? r.buyer?.full_name ?? 'Customer' : '',
        boutique_name: mode === 'buyer' ? r.boutique?.name ?? 'Boutique' : '',
        boutique_tone: r.boutique?.tone ?? 0,
        last_message: last ? previewText(last.body) : 'Say hello 👋',
        last_message_at: last?.created_at ?? null,
        unread,
      } as ConversationWithPeer;
    })
    .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at));
}

export async function fetchConversationPeerName(conversationId: string, viewerRole: 'buyer' | 'seller'): Promise<string> {
  if (viewerRole === 'buyer') {
    const { data } = await supabase.from('conversations').select('boutique:boutiques(name)').eq('id', conversationId).maybeSingle();
    return (data as unknown as { boutique: { name: string } } | null)?.boutique?.name ?? 'Boutique';
  }
  const { data } = await supabase.from('conversations').select('buyer:profiles!conversations_buyer_id_fkey(full_name)').eq('id', conversationId).maybeSingle();
  return (data as unknown as { buyer: { full_name: string } } | null)?.buyer?.full_name ?? 'Customer';
}

export async function getOrCreateConversation(buyerId: string, boutiqueId: string): Promise<string> {
  const { data: existing } = await supabase.from('conversations').select('id').eq('buyer_id', buyerId).eq('boutique_id', boutiqueId).maybeSingle();
  if (existing) return existing.id;
  const { data, error } = await supabase.from('conversations').insert({ buyer_id: buyerId, boutique_id: boutiqueId }).select('id').single();
  if (error) throw error;
  return data.id;
}

/**
 * The buyer's id for a conversation. The seller's chat view needs it to decide
 * which bubbles are the shop's: a boutique reply can come from any staff/owner
 * account, so "mine" is "anything not from the buyer" (same rule the inbox uses)
 * rather than an exact match on the current seller's id.
 */
export async function fetchConversationBuyerId(conversationId: string): Promise<string | null> {
  const { data } = await supabase.from('conversations').select('buyer_id').eq('id', conversationId).maybeSingle();
  return (data as { buyer_id: string } | null)?.buyer_id ?? null;
}

export async function fetchMessages(conversationId: string): Promise<MessageRow[]> {
  const { data, error } = await supabase.from('messages').select('*').eq('conversation_id', conversationId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MessageRow[];
}

export async function sendMessage(conversationId: string, senderId: string, body: string) {
  const { error } = await supabase.from('messages').insert({ conversation_id: conversationId, sender_id: senderId, body });
  if (error) throw error;
}

/**
 * Product context shared into a conversation. When a buyer starts a chat from a
 * product page we post one of these as a normal message, encoded with a marker
 * so both the buyer's and the seller's ChatView render it as a product card —
 * that way the seller immediately sees which product the enquiry is about.
 */
export type ProductCard = { id: string; title: string; price: number; image?: string; tone: number; cat?: string };

const PRODUCT_MARKER = '@@PRODUCT@@';

export function encodeProductCard(p: ProductCard): string {
  return PRODUCT_MARKER + JSON.stringify(p);
}

export function parseProductCard(body: string): ProductCard | null {
  if (!body.startsWith(PRODUCT_MARKER)) return null;
  try {
    return JSON.parse(body.slice(PRODUCT_MARKER.length)) as ProductCard;
  } catch {
    return null;
  }
}

/**
 * Order context shared into a conversation. When a buyer taps "Chat with
 * boutique" from an order we post one of these, so the seller immediately sees
 * which order the enquiry is about (rendered as an order card, same idea as the
 * product card above).
 */
export type OrderCard = { orderId: string; title: string; image?: string; tone: number; qty?: number; amount?: number; status?: string };

const ORDER_MARKER = '@@ORDER@@';

export function encodeOrderCard(o: OrderCard): string {
  return ORDER_MARKER + JSON.stringify(o);
}

export function parseOrderCard(body: string): OrderCard | null {
  if (!body.startsWith(ORDER_MARKER)) return null;
  try {
    return JSON.parse(body.slice(ORDER_MARKER.length)) as OrderCard;
  } catch {
    return null;
  }
}

/**
 * Live presence for one conversation.
 *
 * The header used to read "Online now" the moment the thread loaded, which said
 * nothing about the other side — a boutique that had been closed for a week
 * still showed as online. This tracks the viewer on a Realtime presence channel
 * keyed to the conversation and reports whether *anyone else* is joined, so the
 * indicator reflects the peer rather than the reader.
 *
 * Presence is ephemeral (it lives in the channel, not the database), so a
 * dropped connection clears it automatically.
 */
export function subscribeToPresence(
  conversationId: string,
  selfId: string,
  onChange: (peerOnline: boolean) => void,
) {
  const channel = supabase.channel(`presence:${conversationId}`, {
    config: { presence: { key: selfId } },
  });

  const report = () => {
    const state = channel.presenceState();
    onChange(Object.keys(state).some((k) => k !== selfId));
  };

  channel
    .on('presence', { event: 'sync' }, report)
    .on('presence', { event: 'join' }, report)
    .on('presence', { event: 'leave' }, report)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') void channel.track({ at: new Date().toISOString() });
    });

  return () => {
    void channel.untrack();
    supabase.removeChannel(channel);
  };
}

/**
 * When the peer was last active in this conversation — their most recent
 * message. Used for the "Last seen …" line when they aren't currently online.
 */
export async function fetchPeerLastSeen(conversationId: string, selfId: string): Promise<string | null> {
  const { data } = await supabase
    .from('messages')
    .select('created_at')
    .eq('conversation_id', conversationId)
    .neq('sender_id', selfId)
    .order('created_at', { ascending: false })
    .limit(1);
  return data?.[0]?.created_at ?? null;
}

/** Stamp "I've seen this conversation up to now" for the signed-in side (migration 0043). */
export async function markConversationRead(conversationId: string, role: 'buyer' | 'seller'): Promise<void> {
  const { error } = await supabase.rpc('mark_conversation_read', { p_conversation_id: conversationId, p_role: role });
  if (error) console.error('markConversationRead failed:', error.message);
}

/** The peer's last-read time, for double-tick — read once on open. */
export async function fetchPeerReadAt(conversationId: string, role: 'buyer' | 'seller'): Promise<string | null> {
  const { data } = await supabase
    .from('conversations')
    .select('buyer_last_read_at, boutique_last_read_at')
    .eq('id', conversationId)
    .maybeSingle();
  if (!data) return null;
  const row = data as { buyer_last_read_at: string | null; boutique_last_read_at: string | null };
  return role === 'buyer' ? row.boutique_last_read_at : row.buyer_last_read_at;
}

/** Live updates to the peer's last-read time, so a tick turns blue while the chat is open. */
export function subscribeToReadReceipt(
  conversationId: string,
  role: 'buyer' | 'seller',
  onChange: (peerReadAt: string | null) => void,
) {
  const channel = supabase
    .channel(`read:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${conversationId}` },
      (payload) => {
        const row = payload.new as { buyer_last_read_at?: string | null; boutique_last_read_at?: string | null };
        onChange((role === 'buyer' ? row.boutique_last_read_at : row.buyer_last_read_at) ?? null);
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

export function subscribeToMessages(conversationId: string, onInsert: (msg: MessageRow) => void) {
  const channel = supabase
    .channel(`messages:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onInsert(payload.new as MessageRow),
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
