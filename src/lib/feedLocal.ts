/**
 * In-memory (per-tab, per-load) guard for Inspire feed likes.
 *
 * The shared like counter is moved by an RPC that a guest can call, so the
 * client is the only thing stopping a double-tap from counting twice within
 * the same visit. Not persisted — a refresh clears it.
 */

type Flags = Record<string, boolean>;

let likeState: Flags = {};

export function readLocalLikes(): Flags {
  return likeState;
}

export function writeLocalLikes(likes: Flags): void {
  likeState = likes;
}

/** Called on logout so one account's hearts don't greet the next person. */
export function clearLocalFeedInteractions(): void {
  likeState = {};
}
