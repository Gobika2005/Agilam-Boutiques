/**
 * Recently searched terms, per console.
 *
 * Kept in `localStorage` and never sent anywhere. An admin's recent searches
 * are order numbers and customer names, so this is deliberately device-local
 * rather than synced to the account — and it is cleared on sign-out by
 * `clearRecentSearches`.
 */

const PREFIX = 'ag.search.recent.';
const MAX = 6;

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    // Private mode, a quota error, or a hand-edited value — recents are a
    // convenience, never a reason to break the search box.
    return [];
  }
}

export function recentSearches(key: string): string[] {
  return read(key).slice(0, MAX);
}

export function rememberSearch(key: string, term: string): string[] {
  const t = term.trim();
  if (t.length < 2) return read(key);
  const next = [t, ...read(key).filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, MAX);
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(next));
  } catch {
    /* ignore — see above */
  }
  return next;
}

export function clearRecentSearches(key: string) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
