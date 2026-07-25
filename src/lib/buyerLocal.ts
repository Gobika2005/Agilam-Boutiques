import type { Cart } from '@/state/ShopContext';

/**
 * In-memory (per-tab, per-load) holding area for a guest buyer's collections —
 * bag, saved items and followed boutiques. Nothing here is persisted: a guest's
 * bag/wishlist/follows are lost on refresh, and only become durable once the
 * buyer signs in and this is merged into the account (see
 * src/data/buyerCollections.ts) — from then on the account (DB) is the source
 * of truth.
 */

let cartState: Cart = {};
let wishlistState: Record<string, boolean> = {};
let followsState: Record<string, boolean> = {};

export function readLocalCart(): Cart {
  return cartState;
}

export function writeLocalCart(cart: Cart): void {
  cartState = cart;
}

export function readLocalWishlist(): Record<string, boolean> {
  return wishlistState;
}

export function writeLocalWishlist(wishlist: Record<string, boolean>): void {
  wishlistState = wishlist;
}

export function readLocalFollows(): Record<string, boolean> {
  return followsState;
}

export function writeLocalFollows(follows: Record<string, boolean>): void {
  followsState = follows;
}

/** Wipe the local copies — called after a successful merge into the account and
 * on logout, so collections never leak between accounts on a shared device. */
export function clearLocalCollections(): void {
  cartState = {};
  wishlistState = {};
  followsState = {};
}
