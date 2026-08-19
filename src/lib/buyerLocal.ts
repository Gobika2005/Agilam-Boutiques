import type { Cart, CartLine } from '@/state/ShopContext';

/**
 * A guest buyer's collections — bag, saved items and followed boutiques — kept
 * in `localStorage` so they survive a refresh.
 *
 * They have to be durable rather than in-memory: buyers browse this app signed
 * out by design, and a bag that only lives in a JS module is emptied by every
 * full page load — a refresh, a shared product link opened cold, the chunk
 * reload in `@/lib/appUpdate`, or the redirect back from the payment gateway.
 *
 * Once the buyer signs in, this is merged into the account (see
 * `src/data/buyerCollections.ts`), the keys are cleared, and the account (DB)
 * becomes the source of truth — so nothing here ever leaks between accounts on
 * a shared device.
 */

const CART_KEY = 'agx:buyer-cart';
const WISHLIST_KEY = 'agx:buyer-wishlist';
const FOLLOWS_KEY = 'agx:buyer-follows';
const PINCODE_KEY = 'agx:buyer-pincode';

/**
 * Storage can throw rather than merely fail: Safari private mode and a full
 * quota both raise on `setItem`, and reading can throw where storage is blocked
 * by policy. A guest's bag is never worth taking the page down for, so every
 * access is guarded and falls back to "nothing saved".
 */
function readJSON<T>(key: string, fallback: T, parse: (raw: unknown) => T | null): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return parse(JSON.parse(raw)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full — the bag stays in memory for this session */
  }
}

/** Anything could be sitting under our key (an older build, a hand-edit), so the
 *  stored shape is validated rather than trusted — a bad line is dropped, not
 *  allowed to reach the cart maths as `NaN`. */
function parseCart(raw: unknown): Cart | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Cart = {};
  for (const [id, line] of Object.entries(raw as Record<string, unknown>)) {
    if (!line || typeof line !== 'object') continue;
    const { qty, size } = line as Partial<CartLine>;
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty <= 0) continue;
    if (typeof size !== 'string' || !size) continue;
    out[id] = { qty: Math.floor(qty), size };
  }
  return out;
}

function parseFlags(raw: unknown): Record<string, boolean> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, boolean> = {};
  for (const [id, on] of Object.entries(raw as Record<string, unknown>)) {
    if (on === true) out[id] = true;
  }
  return out;
}

export function readLocalCart(): Cart {
  return readJSON<Cart>(CART_KEY, {}, parseCart);
}

export function writeLocalCart(cart: Cart): void {
  writeJSON(CART_KEY, cart);
}

export function readLocalWishlist(): Record<string, boolean> {
  return readJSON<Record<string, boolean>>(WISHLIST_KEY, {}, parseFlags);
}

export function writeLocalWishlist(wishlist: Record<string, boolean>): void {
  writeJSON(WISHLIST_KEY, wishlist);
}

export function readLocalFollows(): Record<string, boolean> {
  return readJSON<Record<string, boolean>>(FOLLOWS_KEY, {}, parseFlags);
}

export function writeLocalFollows(follows: Record<string, boolean>): void {
  writeJSON(FOLLOWS_KEY, follows);
}

/**
 * The pincode the buyer is shopping for, from the "Deliver to" box on a product
 * page (migration 0077 — delivery is priced by distance, so the storefront has
 * to know roughly where the parcel is going before checkout).
 *
 * Kept because re-typing it on every visit is the fastest way to make people
 * stop using it, and a stale one costs nothing: the checkout address overrides
 * it, and a pincode is not a secret worth clearing on logout — which is why it
 * is deliberately NOT in `clearLocalCollections` below.
 */
export function readDeliveryPincode(): string {
  try {
    const v = localStorage.getItem(PINCODE_KEY) ?? '';
    return /^[1-9]\d{5}$/.test(v) ? v : '';
  } catch {
    return '';
  }
}

export function writeDeliveryPincode(pincode: string): void {
  try {
    if (pincode) localStorage.setItem(PINCODE_KEY, pincode);
    else localStorage.removeItem(PINCODE_KEY);
  } catch {
    /* private mode — it just is not remembered next visit */
  }
}

/** Wipe the local copies — called after a successful merge into the account and
 * on logout, so collections never leak between accounts on a shared device. */
export function clearLocalCollections(): void {
  for (const key of [CART_KEY, WISHLIST_KEY, FOLLOWS_KEY]) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* nothing to do — the account is the source of truth from here */
    }
  }
}
