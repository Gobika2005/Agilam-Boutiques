import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { useShop } from '@/state/ShopContext';
import {
  fetchConversationBuyerId,
  fetchMessages,
  fetchPeerLastSeen,
  fetchPeerReadAt,
  markConversationRead,
  parseOrderCard,
  parseProductCard,
  sendMessage,
  subscribeToMessages,
  subscribeToPresence,
  subscribeToReadReceipt,
} from '@/data/chat';
import { TONES, fmt } from '@/data/demo';

type Bubble = { id?: string; sender: string; text: string; time: string; createdAt: string };

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

/** "Last seen 12 min ago" / "Last seen yesterday" / "" when we've never heard from them. */
function lastSeenLabel(iso: string | null): string {
  if (!iso) return 'Offline';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'Last seen just now';
  if (mins < 60) return `Last seen ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Last seen ${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return 'Last seen yesterday';
  if (days < 7) return `Last seen ${days} days ago`;
  return 'Offline';
}

/**
 * Conversation view, shared by the buyer and seller chats.
 *
 * It always runs live: once `conversationId` and `senderId` are supplied,
 * messages load from the database, stream in over realtime, and the composer
 * inserts real rows that the other side sees instantly. While the caller is
 * still resolving those ids (e.g. the buyer's anonymous identity is being
 * created), pass `pending` to show a connecting state instead.
 */
export function ChatView({
  name,
  avatar,
  backTo,
  conversationId,
  senderId,
  viewerRole,
  pending,
  onProductClick,
  onOrderClick,
  quickReplies,
  focusOnOpen,
}: {
  name: string;
  /** The other participant's photo — the boutique's shop logo on the buyer
   *  side. Falls back to a monogram (via `BoutiqueLogo`) when there isn't one,
   *  same as everywhere else a boutique is shown. */
  avatar?: string | null;
  backTo: string;
  conversationId?: string;
  senderId?: string;
  /** Which side of the conversation this view is — decides which of the two
   *  read-receipt columns is "mine" to stamp and which is the peer's to watch
   *  for the double-tick (migration 0043). */
  viewerRole: 'buyer' | 'seller';
  pending?: boolean;
  onProductClick?: (productId: string) => void;
  onOrderClick?: (orderId: string) => void;
  /** Seller-only canned openers, shown as tappable chips while the draft is
   *  empty. Tapping one loads it into the composer to edit or send. */
  quickReplies?: string[];
  /**
   * Put the cursor in the composer when the conversation is brand new, so the
   * keyboard comes up ready to type.
   *
   * Buyer-side only. A seller works through a queue and reads before replying,
   * so a keyboard opening on every conversation they tap would fight them.
   */
  focusOnOpen?: boolean;
}) {
  const navigate = useNavigate();
  const { showToast } = useShop();
  const live = Boolean(conversationId && senderId);
  const [thread, setThread] = useState<Bubble[]>([]);
  /** Whether the first read of this conversation has finished, either way. */
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Whether the *other* participant is joined to this conversation right now,
  // and when we last heard from them. Both drive the header status line.
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerLastSeen, setPeerLastSeen] = useState<string | null>(null);
  // The peer's last-read time — a bubble I sent is "read" (blue double-tick)
  // once its created_at is at or before this, "sent" (grey) until then.
  const [peerReadAt, setPeerReadAt] = useState<string | null>(null);
  // The conversation's buyer id (seller view only). A boutique reply can come
  // from any staff/owner account, so on the seller side "mine" is every bubble
  // that isn't the buyer's — not just ones matching this logged-in seller.
  const [buyerId, setBuyerId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  // Flag the whole app as "in a chat" while this full-screen surface is mounted,
  // so the floating bottom nav dock can be hidden (it has no place over a chat,
  // and on mobile it floats up over the composer when the keyboard opens). A
  // body class is used rather than relying only on the CSS `:has()` selector so
  // it works even where `:has()` isn't supported. Both the buyer and seller
  // chats render this component, so this covers both.
  useEffect(() => {
    document.body.classList.add('agx-chatting');
    return () => document.body.classList.remove('agx-chatting');
  }, []);

  /**
   * Keep the whole chat above the on-screen keyboard.
   *
   * The chat is a fixed surface, so it is sized to the *layout* viewport — and
   * no mobile browser reliably shrinks that when the keyboard opens. iOS Safari
   * never does. Android Chrome shrinks the *visual* viewport instead and then
   * pans it (`offsetTop`) to bring the focused field into view, which pushes
   * the header off the top of the screen while the composer is still under the
   * keyboard at the bottom.
   *
   * So don't reserve a strip — position the surface on the visual viewport
   * itself: `--ag-vv-top` is how far the browser has panned, `--ag-kb-inset`
   * how much of the bottom the keyboard covers. Together they park the header,
   * thread and composer inside the visible slice in every mode — as insets
   * rather than as a height, so the browser derives the size and there is no
   * arithmetic here to be wrong.
   *
   * `--ag-kb` is still published on the body for the toast, which is a fixed
   * sibling rather than a child: it stays in layout coordinates, so what it has
   * to clear is only the part of the keyboard the pan has not already absorbed.
   * `data-kb-open` lets the stylesheet stand the banner and the home-indicator
   * inset down while the keyboard is up. All three are cleaned up on unmount.
   */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let last = '';
    const apply = () => {
      // Pinch-zoom shrinks the visual viewport too. Only an interactive widget
      // should move the chat, so sit still while the page is zoomed.
      const zoomed = vv.scale > 1.05;
      // The keyboard's own height. Deliberately *not* minus offsetTop: how much
      // the widget covers is independent of how far the browser has panned, and
      // subtracting it used to hide the keyboard from this measurement entirely.
      const kb = zoomed ? 0 : Math.max(0, Math.round(window.innerHeight - vv.height));
      // Only a widget this tall is a keyboard; anything less is the URL bar.
      // This still decides `data-kb-open` and `--ag-kb`, but it no longer
      // decides the insets below — that was the bug.
      const open = kb > 120;
      const top = zoomed ? 0 : Math.round(vv.offsetTop);

      /*
       * Everything below the visible slice — whatever is causing it.
       *
       * `position:fixed; bottom:0` resolves against the LAYOUT viewport, and
       * Android Chrome's layout viewport is the large one: the height the page
       * would have with the URL bar retracted. So while the URL bar is showing,
       * `bottom:0` is genuinely below the bottom of the screen, and the composer
       * sitting on that edge is out of sight until a scroll retracts the bar.
       *
       * This used to be gated on `open`, so it was 0 unless a keyboard was up —
       * and a URL bar is only ~60-90px, well under the 120px that counts as a
       * keyboard. That is why a conversation opened cold had no visible
       * composer, while a brand-new one did: the auto-focus raised the keyboard,
       * which pushed the measurement over the threshold and corrected the inset
       * as a side effect.
       *
       * Subtracting `offsetTop` as well as the height is what makes it general:
       * whatever the browser has already panned out of view at the top is not
       * also hidden at the bottom. Keyboard, URL bar or both, this is simply
       * "how far up from the layout viewport's bottom the visible area ends".
       */
      const bottom = zoomed
        ? 0
        : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));

      const key = `${top}|${bottom}|${open}`;
      if (key === last) return;
      last = key;
      const root = rootRef.current;
      root?.style.setProperty('--ag-vv-top', `${top}px`);
      root?.style.setProperty('--ag-kb-inset', `${bottom}px`);
      document.body.style.setProperty('--ag-kb', `${open ? Math.max(0, kb - top) : 0}px`);
      if (open) document.body.dataset.kbOpen = '1';
      else delete document.body.dataset.kbOpen;
      // The thread just got shorter; without this the message you were reading
      // when you tapped the field scrolls out of sight behind the keyboard.
      // Only while the keyboard is up: now that a URL bar toggle also lands
      // here, scrolling on every change would yank the thread to the bottom
      // while someone is reading back through it.
      if (open) {
        requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
      }
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      document.body.style.removeProperty('--ag-kb');
      delete document.body.dataset.kbOpen;
    };
  }, []);

  useEffect(() => {
    if (!conversationId || !senderId) return;
    let active = true;
    setThread([]);
    setLoaded(false);
    fetchMessages(conversationId)
      .then((rows) => {
        if (active) setThread(rows.map((m) => ({ id: m.id, sender: m.sender_id, text: m.body, time: fmtTime(m.created_at), createdAt: m.created_at })));
      })
      .catch(() => {})
      // Settled either way: "we know what is in this thread" is what the
      // open-with-the-keyboard decision below waits on, and a failed read still
      // answers that question — it just answers "nothing".
      .finally(() => {
        if (active) setLoaded(true);
      });
    const unsub = subscribeToMessages(conversationId, (m) => {
      setThread((t) => (t.some((b) => b.id === m.id) ? t : [...t, { id: m.id, sender: m.sender_id, text: m.body, time: fmtTime(m.created_at), createdAt: m.created_at }]));
    });
    return () => {
      active = false;
      unsub();
    };
  }, [conversationId, senderId]);

  // The seller side needs the buyer's id to tell the shop's bubbles apart from
  // the buyer's; the buyer side just compares against its own id, so skip it.
  useEffect(() => {
    if (viewerRole !== 'seller' || !conversationId) {
      setBuyerId(null);
      return;
    }
    let active = true;
    fetchConversationBuyerId(conversationId).then((id) => { if (active) setBuyerId(id); }).catch(() => {});
    return () => { active = false; };
  }, [viewerRole, conversationId]);

  // Presence + last-seen, so the header reports the peer rather than the reader.
  useEffect(() => {
    if (!conversationId || !senderId) {
      setPeerOnline(false);
      setPeerLastSeen(null);
      return;
    }
    fetchPeerLastSeen(conversationId, senderId).then(setPeerLastSeen).catch(() => {});
    return subscribeToPresence(conversationId, senderId, setPeerOnline);
  }, [conversationId, senderId]);

  // Read receipts: watch the peer's last-read time for the double-tick, and
  // stamp my own the moment the thread is open (and again whenever a new
  // message arrives while I'm still looking at it).
  useEffect(() => {
    if (!conversationId) {
      setPeerReadAt(null);
      return;
    }
    fetchPeerReadAt(conversationId, viewerRole).then(setPeerReadAt).catch(() => {});
    return subscribeToReadReceipt(conversationId, viewerRole, setPeerReadAt);
  }, [conversationId, viewerRole]);

  useEffect(() => {
    if (!conversationId || thread.length === 0) return;
    void markConversationRead(conversationId, viewerRole);
  }, [conversationId, viewerRole, thread.length]);

  // Is this bubble the viewer's own? The buyer matches on their own id. The
  // seller can't — a boutique reply may come from any staff/owner account, so
  // once the buyer id is known, "mine" is anything that isn't the buyer's
  // (matching the inbox). Until it loads, fall back to an exact-id match.
  const isMine = (sender: string) =>
    viewerRole === 'seller'
      ? buyerId != null
        ? sender !== buyerId
        : sender === senderId
      : sender === senderId;

  // A message arriving from the other side is itself proof of recent activity.
  useEffect(() => {
    const last = thread[thread.length - 1];
    if (last && !isMine(last.sender)) setPeerLastSeen(new Date().toISOString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread, buyerId]);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [thread]);

  /**
   * Open a brand-new conversation ready to type.
   *
   * Someone opening a chat that has never been used came here to say something,
   * so put the cursor in the field. Someone returning to a thread with replies
   * in it came to READ, and a keyboard covering half the conversation would be
   * in the way — so this fires only while there is nothing to read.
   *
   * "Nothing to read" is not `thread.length === 0`. Arriving from a product's
   * Chat button posts an enquiry card automatically (see the buyer's Chat
   * page), so the most focus-worthy case of all — she tapped Chat on a saree
   * and wants to ask about it — already has a message in it. What matters is
   * whether a person has typed anything, so the cards are discounted.
   *
   * Deliberately best-effort. Browsers only raise the on-screen keyboard for a
   * focus that happens inside a user gesture: iOS Safari will move the caret
   * and show no keyboard, and Android Chrome varies with how the page was
   * reached. That is why this is a convenience layered on a composer that is
   * already visible and usable on its own, and never the thing that makes it
   * reachable.
   */
  const autoFocusedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!focusOnOpen || !live || !loaded || !conversationId) return;
    if (autoFocusedFor.current === conversationId) return;

    const conversationStarted = thread.some(
      (b) => !parseProductCard(b.text) && !parseOrderCard(b.text),
    );
    if (conversationStarted) {
      // Mark it anyway: this thread is not a candidate, and re-checking on
      // every incoming message is pointless.
      autoFocusedFor.current = conversationId;
      return;
    }

    autoFocusedFor.current = conversationId;
    // After paint, so the field exists and the scroll position has settled.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [focusOnOpen, live, loaded, conversationId, thread]);

  /**
   * Publish the composer's real height as `--ag-composer-h`.
   *
   * It is anchored over the bottom of the column rather than stacked after it
   * (see `.agx-chat-composer`), so the thread has to reserve its height or the
   * newest message hides behind it. Measured rather than hard-coded because the
   * bar is not a fixed size: the textarea grows with the draft up to ~120px, and
   * the seller's quick-reply chips add a whole row on top while the draft is
   * empty. A constant would be wrong in both directions.
   */
  useEffect(() => {
    const el = composerRef.current;
    const root = rootRef.current;
    if (!el || !root) return;
    const publish = () =>
      root.style.setProperty('--ag-composer-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    publish();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Grow the composer with the draft, up to a few lines, then let it scroll.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [draft]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !live || !conversationId || !senderId || sending) return;
    setDraft('');
    setSending(true);
    try {
      await sendMessage(conversationId, senderId, text);
      // Realtime echoes the inserted row back; no optimistic append needed.
    } catch (e) {
      setDraft(text);
      showToast(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const statusLabel = pending
    ? 'Connecting…'
    : !live
      ? 'Offline'
      : peerOnline
        ? 'Online now'
        : lastSeenLabel(peerLastSeen);
  const statusOn = live && peerOnline;
  const canSend = live && !!draft.trim() && !sending;

  // Anchored to the top AND the bottom of the viewport, with no height of its
  // own. That is the whole point: the height is then the browser's arithmetic,
  // not ours, so the bottom edge of this surface IS the bottom of the screen by
  // definition and the composer sitting on it cannot be pushed past the edge.
  // Every version of this bug came from a computed height being wrong by a
  // banner, a URL bar or 22 unexplained pixels.
  //
  // The two insets are all that is left to say. `--ag-banner-h` reserves the
  // maintenance banner at the top: it is a sticky element in the document flow
  // and sits above this surface in the stacking order, so spanning the whole
  // viewport would put the chat header underneath it. `--ag-kb-inset` holds the
  // bottom clear of the on-screen keyboard, which `position:fixed` alone knows
  // nothing about, and `--ag-vv-top` follows the browser's own panning. All
  // three are 0 on a desktop browser, where this reduces to `inset:0`.
  return (
    <div ref={rootRef} className="agx-chat-root" style={css('position:fixed;top:calc(var(--ag-vv-top,0px) + var(--ag-banner-h,0px));left:0;right:0;bottom:var(--ag-kb-inset,0px);z-index:40;background:radial-gradient(120% 60% at 50% 0%,var(--ag-surface-2) 0%,var(--ag-bg) 42%,var(--ag-surface-2) 100%);display:flex;flex-direction:column;')}>
      {/* `flex:1;min-height:0` rather than `height:100%`: a percentage height
          resolves against the parent's *height* property, which is the very
          thing the cap above may be overriding, and a stale percentage basis is
          how a column like this ends up taller than its own box. Filling the
          flex line instead needs no basis at all, and `min-height:0` is what
          lets the thread inside scroll rather than push the composer out. */}
      <div style={css('position:relative;max-width:900px;width:100%;margin:0 auto;flex:1;min-height:0;display:flex;flex-direction:column;')}>
        {/* Premium glass header */}
        <div style={css('flex:none;background:var(--ag-frost);backdrop-filter:blur(16px) saturate(1.3);padding:10px 14px;display:flex;align-items:center;gap:12px;border-bottom:1px solid var(--ag-border);box-shadow:0 10px 30px -26px var(--ag-shadow);')}>
          <button onClick={() => navigate(backTo)} aria-label="Back" style={css('width:40px;height:40px;flex:none;border-radius:13px;border:none;background:var(--ag-surface-2);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:22px;")}>arrow_back</span>
          </button>
          <div style={css('position:relative;flex:none;')}>
            <BoutiqueLogo name={name} src={avatar} size={44} radius={14} />
            {statusOn && <span className="agx-online-dot" style={css('position:absolute;right:-2px;bottom:-2px;width:13px;height:13px;border-radius:50%;background:var(--ag-good);border:2.5px solid #fff;')} />}
          </div>
          <div style={css('flex:1;min-width:0;')}>
            <div style={css('font-weight:800;font-size:15.5px;color:var(--ag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{name}</div>
            <div style={css(`font-size:11.5px;font-weight:700;color:${statusOn ? 'var(--ag-good)' : 'var(--ag-muted-soft)'};display:flex;align-items:center;gap:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`)}>
              {statusOn && <span style={css('flex:none;width:6px;height:6px;border-radius:50%;background:var(--ag-good);')} />}{statusLabel}
            </div>
          </div>
          <div style={css('flex:none;display:flex;align-items:center;gap:6px;background:var(--ag-surface-2);border:1px solid var(--ag-border);border-radius:11px;padding:6px 10px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-good);font-size:15px;")}>lock</span>
            <span className="agx-hide-sm" style={css('font-size:10.5px;font-weight:700;color:var(--ag-muted);')}>Secure</span>
          </div>
        </div>

        {/* Messages */}
        {/* The composer is anchored over the bottom of this column rather than
            stacked after it (see `.agx-chat-composer`), so the thread reserves
            its measured height as padding — otherwise the newest message, the
            one you actually want to read, sits behind the bar. The 76px
            fallback is roughly one empty field, used only for the first frame
            before the observer reports. */}
        <div
          ref={scrollRef}
          className="agx-scroll"
          style={css('flex:1;min-height:0;overflow-y:auto;padding:18px 16px calc(8px + var(--ag-composer-h,76px));display:flex;flex-direction:column;gap:9px;')}
        >
          {pending && thread.length === 0 && (
            <div style={css('margin:auto;display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--ag-muted-soft);font-size:13px;font-weight:600;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:30px;color:var(--ag-border);")}>chat</span>Starting your chat…
            </div>
          )}
          {live && thread.length === 0 && !pending && (
            <div style={css('margin:auto;text-align:center;color:var(--ag-muted-soft);font-size:13px;font-weight:600;max-width:240px;display:flex;flex-direction:column;align-items:center;gap:10px;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:34px;color:var(--ag-border);")}>waving_hand</span>No messages yet. Say hello 👋
            </div>
          )}
          {thread.length > 0 && (
            <div style={css('align-self:center;background:rgba(180,64,116,.1);color:#9A5B76;font-size:10.5px;font-weight:800;letter-spacing:.03em;padding:4px 13px;border-radius:999px;margin-bottom:4px;')}>Today</div>
          )}
          {thread.map((c, i) => {
          const me = isMine(c.sender);
          const order = parseOrderCard(c.text);
          if (order) {
            return (
              <div
                key={c.id ?? i}
                onClick={onOrderClick ? () => onOrderClick(order.orderId) : undefined}
                style={css(`max-width:78%;width:250px;align-self:${me ? 'flex-end' : 'flex-start'};background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:16px;overflow:hidden;box-shadow:0 8px 20px -14px rgba(107,20,54,.55);cursor:${onOrderClick ? 'pointer' : 'default'};`)}
              >
                <div style={css('display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--ag-border);')}>
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-crimson);")}>receipt_long</span>
                  <span className="agx-eyebrow" style={css('font-size:9px;letter-spacing:.14em;color:var(--ag-crimson);')}>Enquiry about this order · {order.orderId}</span>
                </div>
                <div style={css('display:flex;gap:11px;padding:11px 12px;')}>
                  <div style={css(`width:60px;height:76px;flex:none;border-radius:11px;overflow:hidden;background:${TONES[order.tone % TONES.length]};position:relative;`)}>
                    <ImageSlot src={order.image} placeholder={order.title} style={css('position:absolute;inset:0;')} />
                  </div>
                  <div style={css('flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;')}>
                    {order.status && <div className="agx-eyebrow" style={css('font-size:9px;color:var(--ag-muted);')}>{order.status}</div>}
                    <div style={css('font-size:13.5px;font-weight:700;color:var(--ag-ink);line-height:1.25;margin-top:2px;')}>{order.title}</div>
                    <div style={css('display:flex;align-items:baseline;gap:8px;margin-top:4px;')}>
                      {order.amount != null && <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:16px;")}>{fmt(order.amount)}</span>}
                      {order.qty != null && <span style={css('font-size:11px;color:var(--ag-muted);font-weight:600;')}>Qty {order.qty}</span>}
                    </div>
                  </div>
                </div>
                <div style={css('font-size:10px;color:var(--ag-muted-soft);padding:0 12px 8px;text-align:right;')}>{c.time}</div>
              </div>
            );
          }
          const card = parseProductCard(c.text);
          if (card) {
            return (
              <div
                key={c.id ?? i}
                onClick={onProductClick ? () => onProductClick(card.id) : undefined}
                style={css(`max-width:78%;width:250px;align-self:${me ? 'flex-end' : 'flex-start'};background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:16px;overflow:hidden;box-shadow:0 8px 20px -14px rgba(107,20,54,.55);cursor:${onProductClick ? 'pointer' : 'default'};`)}
              >
                <div style={css('display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:1px solid var(--ag-border);')}>
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-crimson);")}>sell</span>
                  <span className="agx-eyebrow" style={css('font-size:9px;letter-spacing:.14em;color:var(--ag-crimson);')}>Enquiry about this product</span>
                </div>
                <div style={css('display:flex;gap:11px;padding:11px 12px;')}>
                  <div style={css(`width:60px;height:76px;flex:none;border-radius:11px;overflow:hidden;background:${TONES[card.tone % TONES.length]};position:relative;`)}>
                    <ImageSlot src={card.image} placeholder={card.title} style={css('position:absolute;inset:0;')} />
                  </div>
                  <div style={css('flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;')}>
                    {card.cat && <div className="agx-eyebrow" style={css('font-size:9px;color:var(--ag-muted);')}>{card.cat}</div>}
                    <div style={css('font-size:13.5px;font-weight:700;color:var(--ag-ink);line-height:1.25;margin-top:2px;')}>{card.title}</div>
                    <div style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:16px;margin-top:4px;")}>{fmt(card.price)}</div>
                  </div>
                </div>
                <div style={css('font-size:10px;color:var(--ag-muted-soft);padding:0 12px 8px;text-align:right;')}>{c.time}</div>
              </div>
            );
          }
          return (
            <div
              key={c.id ?? i}
              style={css(`position:relative;max-width:80%;align-self:${me ? 'flex-end' : 'flex-start'};background:${me ? 'linear-gradient(135deg,#E8558A,#B02454 88%)' : 'var(--ag-surface)'};color:${me ? '#fff' : 'var(--ag-ink)'};padding:9px 13px 7px;border-radius:${me ? '18px 18px 5px 18px' : '18px 18px 18px 5px'};font-size:13.5px;line-height:1.45;border:${me ? 'none' : '1px solid var(--ag-border)'};box-shadow:${me ? '0 10px 22px -14px rgba(176,36,84,.85)' : '0 8px 20px -16px rgba(107,20,54,.5)'};`)}
            >
              {c.text}
              <div style={css('display:flex;align-items:center;justify-content:flex-end;gap:3px;margin-top:3px;')}>
                <span style={css(`font-size:9.5px;color:${me ? 'rgba(255,255,255,.75)' : 'var(--ag-muted-soft)'};font-weight:600;`)}>{c.time}</span>
                {me && (
                  <span aria-hidden="true"
                    aria-label={peerReadAt && c.createdAt <= peerReadAt ? 'Read' : 'Sent'}
                    style={css(`font-family:'Material Symbols Outlined';font-size:15px;color:${peerReadAt && c.createdAt <= peerReadAt ? '#7FE0FF' : 'rgba(255,255,255,.75)'};`)}
                  >
                    done_all
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>


      {/* Composer — pinned to the bottom of the chat column, clearing both the
          nav dock and the iOS home indicator (see `.agx-chat-composer`). The
          field is a textarea so a long message wraps instead of scrolling
          sideways inside a one-line input; Enter sends, Shift+Enter breaks. */}
      <div ref={composerRef} className="agx-chat-composer">
        {live && !draft.trim() && quickReplies && quickReplies.length > 0 && (
          <div className="agx-scroll" style={css('display:flex;gap:7px;overflow-x:auto;padding:0 2px 8px;')}>
            {quickReplies.map((qr) => (
              <button
                key={qr}
                onClick={() => { setDraft(qr); inputRef.current?.focus(); }}
                style={css('flex:none;padding:7px 13px;border:1px solid var(--ag-border);background:rgba(255,255,255,.92);border-radius:999px;font-family:inherit;font-size:12.5px;font-weight:700;color:var(--ag-crimson);cursor:pointer;white-space:nowrap;')}
              >
                {qr}
              </button>
            ))}
          </div>
        )}
        {/* Opaque, and deliberately NOT `backdrop-filter`.
            A blurred, semi-transparent field is what made this bar vanish: a
            backdrop-filtered element inside a position:fixed, overflow:hidden
            ancestor is a long-standing Chrome compositing failure — it paints
            as nothing at all until a scroll forces a repaint, which is exactly
            how this presented ("scroll down and back up and it appears").
            There is also nothing left to blur: the bar behind it is opaque
            because it sits over the scrolling thread. */}
        <div className="agx-field" style={css('display:flex;gap:8px;align-items:flex-end;background:var(--ag-surface);border:1px solid var(--ag-border);border-radius:22px;padding:7px;box-shadow:0 2px 0 rgba(255,255,255,.12) inset,0 12px 24px -18px var(--ag-shadow);')}>
          <button
            onClick={() => showToast('Photo sharing is coming soon')}
            disabled={!live}
            aria-label="Attach a photo"
            className="agx-chat-attach"
            style={css(`width:40px;height:40px;flex:none;border-radius:14px;border:none;background:var(--ag-surface-2);cursor:${live ? 'pointer' : 'not-allowed'};opacity:${live ? 1 : 0.5};align-items:center;justify-content:center;`)}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:21px;")}>add_photo_alternate</span>
          </button>
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            disabled={!live}
            aria-label="Message"
            placeholder={live ? 'Type a message…' : pending ? 'Connecting…' : 'Message…'}
            style={css('border:none;background:none;flex:1;min-width:0;resize:none;overflow-y:auto;max-height:120px;font-size:15px;line-height:1.4;font-weight:500;color:var(--ag-ink);padding:10px 4px;')}
          />
          <button
            onClick={send}
            disabled={!canSend}
            aria-label="Send message"
            style={css(`width:40px;height:40px;flex:none;border-radius:14px;border:none;background:linear-gradient(135deg,#E14A7E,#B02454 75%,#8E1C44);cursor:${canSend ? 'pointer' : 'not-allowed'};opacity:${canSend ? 1 : 0.5};display:flex;align-items:center;justify-content:center;box-shadow:0 12px 24px -12px rgba(176,36,84,.9);transition:opacity .2s ease;`)}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#fff;font-size:20px;")}>send</span>
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
