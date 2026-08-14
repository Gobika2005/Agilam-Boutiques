import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { isAdminPath } from '@/lib/adminPath';

/**
 * Live "who's on the site right now" presence.
 *
 * Every open tab — signed-in or an anonymous guest — joins ONE shared Realtime
 * presence channel and broadcasts a small state blob (who they are, what page
 * they're on, when they were last active). The admin console reads the same
 * channel and renders the roster live. Presence is ephemeral: it lives in the
 * channel, not the database, so a closed tab or dropped connection clears itself
 * automatically — no cron, no stale "online" rows.
 *
 * IMPORTANT: there is exactly one channel object per tab (a module singleton).
 * On the admin's own browser both the publisher (PresenceTracker) and the reader
 * (LivePresence) run; giving each its own `supabase.channel('presence:site')`
 * means two channels on the same topic, which supabase-js does not support and
 * which blanked the Users page. They share this single channel instead.
 */

const SITE_CHANNEL = 'presence:site';

export type PresenceRole = 'guest' | 'buyer' | 'seller' | 'admin';
export type PresenceSection = 'buyer' | 'seller' | 'admin' | 'auth';

export interface PresenceMeta {
  id: string; // stable per-browser id (guests included)
  name: string; // display name, or "Guest"
  role: PresenceRole;
  page: string; // friendly activity label, e.g. "Viewing a product"
  section: PresenceSection;
  path: string; // raw pathname (for reference)
  location?: string; // approximate IP-based location, e.g. "Chennai, TN, IN" ('' when unknown)
  at: string; // ISO timestamp of last activity (navigation / heartbeat)
}

export interface OnlineUser extends PresenceMeta {
  onlineSince: string; // earliest tracked timestamp for this session
}

/** A per-tab id so a guest keeps one identity across pages during this visit. */
let sessionPresenceId: string | null = null;
export function presenceId(): string {
  if (!sessionPresenceId) {
    sessionPresenceId = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2);
  }
  return sessionPresenceId;
}

/**
 * Turn a route into a human-readable "what they're doing" label.
 *
 * The matchers are the CURRENT routes as registered in src/App.tsx. Migration
 * 0057 moved the storefront to root URLs and four of these were left behind,
 * which made the admin's live roster actively wrong rather than merely vague:
 *
 *   • `p === '/'` was treated as the sign-in splash, so every shopper on the
 *     home page — the single busiest route in the app — was reported as
 *     "Signing in" and filed under the `auth` section.
 *   • `/product/` (singular) never matched `/products/:slug`, so "Viewing a
 *     product" was unreachable and PDP traffic showed as generic "Browsing".
 *     Same for the legacy `/b/` boutique prefix, now `/boutique/:slug`.
 *   • `/results` was the old grid path; it is `/shop` and `/search` now.
 *   • `/home` no longer exists at all.
 *
 * Order matters: the specific paths are tested before the prefixes they sit
 * under, and `/` is matched LAST of the buyer routes because every path starts
 * with it.
 */
export function describePage(path: string): { page: string; section: PresenceSection } {
  const p = path.toLowerCase();
  // Both addresses: the console moved to VITE_ADMIN_PATH, but `/admin` is still
  // worth labelling — someone poking at it is exactly what this roster shows.
  if (isAdminPath(p) || p.startsWith('/admin')) return { page: 'Admin console', section: 'admin' };
  if (p.startsWith('/seller')) return { page: 'Seller console', section: 'seller' };
  if (p.startsWith('/auth')) return { page: 'Signing in', section: 'auth' };

  // Buyer surface — the public storefront.
  if (p.startsWith('/products/')) return { page: 'Viewing a product', section: 'buyer' };
  // `/boutique/:slug` is one shop; `/boutiques` (and `/boutiques/:city`) is the
  // directory. Both are "looking at shops", so one label covers them.
  if (p.startsWith('/boutique')) return { page: 'Viewing a boutique', section: 'buyer' };
  if (p.startsWith('/top-boutiques')) return { page: 'Viewing a boutique', section: 'buyer' };
  if (p.startsWith('/checkout')) return { page: 'At checkout', section: 'buyer' };
  if (p.startsWith('/payment')) return { page: 'Paying', section: 'buyer' };
  if (p.startsWith('/order-confirmation')) return { page: 'Order placed', section: 'buyer' };
  if (p.startsWith('/orders')) return { page: 'Viewing orders', section: 'buyer' };
  if (p.startsWith('/cart')) return { page: 'In their cart', section: 'buyer' };
  if (p.startsWith('/wishlist')) return { page: 'Browsing wishlist', section: 'buyer' };
  // `/shop` covers `/shop/filter` and `/shop/sort` too.
  if (p.startsWith('/shop') || p.startsWith('/search')) return { page: 'Searching products', section: 'buyer' };
  if (p.startsWith('/messages') || p.startsWith('/chat')) return { page: 'Chatting', section: 'buyer' };
  if (p.startsWith('/inspire')) return { page: 'On the Inspire feed', section: 'buyer' };
  if (p.startsWith('/collections') || p.startsWith('/occasions') || p.startsWith('/fabrics')
      || p.startsWith('/new-arrivals') || p.startsWith('/best-sellers')) {
    return { page: 'Exploring collections', section: 'buyer' };
  }
  if (p.startsWith('/profile')) return { page: 'On their profile', section: 'buyer' };
  if (p.startsWith('/notifications')) return { page: 'Reading notifications', section: 'buyer' };
  if (p.startsWith('/coupons')) return { page: 'Looking at offers', section: 'buyer' };
  // Last: the storefront home page, which is the root URL.
  if (p === '/') return { page: 'Browsing home', section: 'buyer' };
  return { page: 'Browsing', section: 'buyer' };
}

// ── One shared channel per tab ──────────────────────────────────────────────

let channel: RealtimeChannel | null = null;
let metaProvider: (() => PresenceMeta) | null = null;
const readers = new Set<(users: OnlineUser[]) => void>();

function computeUsers(): OnlineUser[] {
  if (!channel) return [];
  try {
    const state = channel.presenceState<PresenceMeta>();
    return Object.values(state)
      .map((metas) => {
        const list = [...metas].filter((m) => m && typeof m.at === 'string');
        if (list.length === 0) return null;
        const sorted = list.sort((a, b) => a.at.localeCompare(b.at));
        return { ...sorted[sorted.length - 1], onlineSince: sorted[0].at } as OnlineUser;
      })
      .filter((u): u is OnlineUser => u !== null)
      .sort((a, b) => b.at.localeCompare(a.at));
  } catch {
    return [];
  }
}

function broadcast() {
  const users = computeUsers();
  readers.forEach((r) => r(users));
}

function ensureChannel(): RealtimeChannel {
  if (channel) return channel;
  const key = metaProvider ? metaProvider().id : `viewer-${presenceId()}`;
  const ch = supabase.channel(SITE_CHANNEL, { config: { presence: { key } } });
  ch.on('presence', { event: 'sync' }, broadcast)
    .on('presence', { event: 'join' }, broadcast)
    .on('presence', { event: 'leave' }, broadcast)
    .subscribe((status) => {
      if (status === 'SUBSCRIBED' && metaProvider) {
        void ch.track(metaProvider());
      }
    });
  channel = ch;
  return ch;
}

function teardownIfIdle() {
  if (channel && readers.size === 0 && !metaProvider) {
    supabase.removeChannel(channel);
    channel = null;
  }
}

export interface PresenceHandle {
  update: () => void;
  leave: () => void;
}

/**
 * Publisher — announce this tab on the shared channel and keep its state fresh.
 * `getMeta` is read on every track so callers always hand back the latest
 * page/name without re-joining.
 */
export function joinPresence(getMeta: () => PresenceMeta): PresenceHandle {
  metaProvider = getMeta;
  const ch = ensureChannel();
  // If the channel was already subscribed (a reader opened it first), track now.
  if (ch.state === 'joined') void ch.track(getMeta());

  return {
    update: () => {
      if (channel && channel.state === 'joined') void channel.track(getMeta());
    },
    leave: () => {
      if (channel && channel.state === 'joined') void channel.untrack();
      metaProvider = null;
      teardownIfIdle();
    },
  };
}

/**
 * Reader (admin) — subscribe to the live roster. Attaches to the same shared
 * channel; never opens a second one.
 */
export function subscribeToOnlineUsers(onChange: (users: OnlineUser[]) => void) {
  readers.add(onChange);
  ensureChannel();
  onChange(computeUsers()); // hand back whatever we already know immediately
  return () => {
    readers.delete(onChange);
    teardownIfIdle();
  };
}
