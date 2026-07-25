/**
 * Client-side "following" store for boutiques (legacy/unused — superseded by
 * src/lib/buyerLocal.ts). Kept in-memory only, no persistence.
 */

/** Fires when the follow map changes, so open screens can re-read it. */
export const FOLLOW_EVENT = 'agx:following-changed';

let followState: Record<string, boolean> = {};

export function readFollows(): Record<string, boolean> {
  return followState;
}

export function isFollowing(id: string): boolean {
  return !!followState[id];
}

/** Sets the follow state for a boutique and returns the new value. */
export function setFollow(id: string, follow: boolean): boolean {
  const map = { ...followState };
  if (follow) map[id] = true;
  else delete map[id];
  followState = map;
  window.dispatchEvent(new Event(FOLLOW_EVENT));
  return follow;
}

/** Toggles the follow state for a boutique and returns the new value. */
export function toggleFollow(id: string): boolean {
  return setFollow(id, !isFollowing(id));
}
