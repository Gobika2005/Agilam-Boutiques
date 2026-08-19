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
 * Make sure the signed-in buyer has a profile row, so their side of the chat is
 * a real, RLS-satisfying participant.
 *
 * This used to mint an ANONYMOUS Supabase auth user for a buyer who had never
 * signed up, back when browsing and chatting were both open to strangers. Two
 * things have since made that branch dead code:
 *
 *   • the Supabase project has "Anonymous sign-ins" disabled — the call now
 *     fails outright with `422 anonymous_provider_disabled`; and
 *   • `Chat.tsx` holds on `signedIn` before it ever calls this, so a signed-out
 *     buyer never reaches it in the first place.
 *
 * It has been removed rather than left in: a fallback that can only throw is
 * worse than no fallback, because it reads as a working escape hatch. A caller
 * that reaches here without a session now gets a clear error instead of a
 * confusing auth failure.
 */
export async function ensureBuyerIdentity(): Promise<string> {
  const uid = await getBuyerId();
  if (!uid) throw new Error('Please sign in to message this boutique.');
  const guest = readGuest();
  const name = guest.name.trim() || 'Customer';
  const phone = guest.phone.trim() || null;
  // Ensure a profile row exists so conversations.buyer_id / messages.sender_id
  // resolve, and the seller sees a real name/number instead of a bare id.
  // upsert/ignoreDuplicates: AuthContext's onAuthStateChange and migration
  // 0030's handle_new_user trigger both create this row too, so tolerate the
  // race rather than assuming we are first. This must
  // succeed before we create the conversation — otherwise the conversation's
  // buyer_id foreign key has nothing to point at and the whole chat fails to
  // start ("Could not start chat"). A swallowed error here was invisible.
  const { error: profileErr } = await supabase
    .from('profiles')
    .upsert({ id: uid, role: 'buyer', full_name: name, phone }, { onConflict: 'id', ignoreDuplicates: true });
  if (profileErr) throw new Error(profileErr.message);
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

/**
 * Friendly one-line summary of a message body, for anywhere a message is shown
 * outside the thread itself — the conversation inbox and the "New message"
 * notification.
 *
 * Card messages carry a marker + JSON payload as their body, which is only
 * meaningful to ChatView's renderer. Anywhere else it has to be summarised, or
 * the raw `@@ORDER@@{"orderId":…}` blob shows up as the preview text.
 */
export function messagePreview(body: string): string {
  const product = parseProductCard(body);
  if (product) return `🛍️ ${product.title}`;
  const order = parseOrderCard(body);
  if (order) return `🧾 ${order.orderId} · ${order.title}`;
  // A body that only *looks* like a card — a marker with unparseable JSON
  // behind it — must still never surface raw. Without these two lines the inbox
  // would show `@@ORDER@@{not json` verbatim, which is the exact failure
  // `message_preview()` guards against in SQL (migration 0055). The wording
  // matches that function's, so the list and the notification agree.
  if (body.startsWith(PRODUCT_MARKER)) return 'Shared a product';
  if (body.startsWith(ORDER_MARKER)) return 'Shared an order';
  return body;
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
        last_message: last ? messagePreview(last.body) : 'Say hello 👋',
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
  const { data: existing, error: selErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('buyer_id', buyerId)
    .eq('boutique_id', boutiqueId)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from('conversations')
    .insert({ buyer_id: buyerId, boutique_id: boutiqueId })
    .select('id')
    .single();
  if (!error) return data.id;

  // A concurrent open (or a row the first select couldn't see) means the row
  // already exists — the unique (buyer_id, boutique_id) constraint fired. Fall
  // back to reading it rather than surfacing a scary "duplicate key" as
  // "Could not start chat".
  if (error.code === '23505') {
    const { data: again } = await supabase
      .from('conversations')
      .select('id')
      .eq('buyer_id', buyerId)
      .eq('boutique_id', boutiqueId)
      .maybeSingle();
    if (again) return again.id;
  }
  throw new Error(error.message);
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
  if (error) throw new Error(error.message);
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
