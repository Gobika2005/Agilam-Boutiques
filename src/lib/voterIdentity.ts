/**
 * Who a relative is, on a device that has never signed in.
 *
 * The whole point of "Ask my people" is that mum does not make an account to
 * say which saree she likes. So her identity on a shared board is two things
 * kept in `localStorage`:
 *
 *   • `voterKey` — a random uuid this browser generates once. It is NOT
 *     authentication and 0077 does not treat it as any. It exists so that one
 *     person can CHANGE their mind rather than vote twice, and so the board can
 *     show them their own choices when they come back to it. Someone who clears
 *     it can vote again; on a private link shared with four relatives that is
 *     not a threat model, and the server's per-board voter cap bounds it.
 *   • `name` — typed once, on the first vote, and reused on every board after.
 *     Nobody wants to type "Amma" four times.
 *
 * Storage is guarded exactly as `@/lib/buyerLocal` guards it: Safari private
 * mode and a full quota both throw on `setItem`, and a vote is never worth
 * taking the page down for. When storage is unavailable the key falls back to a
 * per-load value, so voting still works — it just won't be remembered.
 */

const KEY_STORAGE = 'agx:voter-key';
const NAME_STORAGE = 'agx:voter-name';

/** Matches the server's `length between 8 and 64` check on `voter_key`. */
function randomKey(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '');
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.padEnd(16, '0');
}

/** Held per load so a storage-blocked browser still gets a stable key. */
let memoryKey: string | null = null;

export function voterKey(): string {
  if (memoryKey) return memoryKey;
  try {
    const saved = localStorage.getItem(KEY_STORAGE);
    if (saved && saved.length >= 8 && saved.length <= 64) {
      memoryKey = saved;
      return saved;
    }
  } catch {
    /* storage unreadable — fall through to a fresh key */
  }
  const fresh = randomKey();
  memoryKey = fresh;
  try {
    localStorage.setItem(KEY_STORAGE, fresh);
  } catch {
    /* not remembered across loads; voting still works */
  }
  return fresh;
}

/** The name this device last voted under, if any. */
export function voterName(): string {
  try {
    return (localStorage.getItem(NAME_STORAGE) ?? '').slice(0, 40);
  } catch {
    return '';
  }
}

export function rememberVoterName(name: string): void {
  const clean = name.trim().slice(0, 40);
  if (!clean) return;
  try {
    localStorage.setItem(NAME_STORAGE, clean);
  } catch {
    /* ignored — they'll type it again next time */
  }
}
