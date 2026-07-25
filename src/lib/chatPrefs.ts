/**
 * Seller-side, in-memory chat preferences: pinned and favourite conversations,
 * plus a manual read override. None of this needs the backend — pins and stars
 * are a personal way to organise the inbox, and "mark as read/unread" without
 * server read-receipts (deferred) is a local view over the computed unread
 * count. Not persisted — resets on reload.
 */

type Prefs = {
  pinned: string[];
  favourite: string[];
  /** conversationId → the last_message_at the seller marked read at. Unread is
   *  suppressed while nothing newer has arrived. */
  readAt: Record<string, string>;
};

let state: Prefs = { pinned: [], favourite: [], readAt: {} };

function read(): Prefs {
  return state;
}

function write(p: Prefs) {
  state = p;
}

export function getChatPrefs(): Prefs {
  return read();
}

export function togglePinned(id: string): Prefs {
  const p = read();
  p.pinned = p.pinned.includes(id) ? p.pinned.filter((x) => x !== id) : [...p.pinned, id];
  write(p);
  return p;
}

export function toggleFavourite(id: string): Prefs {
  const p = read();
  p.favourite = p.favourite.includes(id) ? p.favourite.filter((x) => x !== id) : [...p.favourite, id];
  write(p);
  return p;
}

/** Mark read up to the given last-message time, or clear it to mark unread. */
export function setReadState(id: string, lastMessageAt: string | null, read_: boolean): Prefs {
  const p = read();
  if (read_ && lastMessageAt) p.readAt[id] = lastMessageAt;
  else delete p.readAt[id];
  write(p);
  return p;
}

/** Whether the seller's manual "read" mark still covers the latest message. */
export function isMarkedRead(prefs: Prefs, id: string, lastMessageAt: string | null): boolean {
  const at = prefs.readAt[id];
  if (!at) return false;
  if (!lastMessageAt) return true;
  return lastMessageAt <= at;
}
