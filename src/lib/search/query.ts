/**
 * Query helpers shared by every search source.
 *
 * All three consoles search server-side: the admin console alone spans orders,
 * profiles and products, none of which can be held in the browser, and the RLS
 * policies are the thing that decides who may see which rows. So a source is
 * always a real PostgREST query, and these are the pieces every one of them
 * needs — a safely escaped pattern, and a consistent way to fail.
 */

/** Below this a term is too broad to be worth a round trip. */
export const MIN_TERM = 2;

/**
 * A term as a quoted `ilike` value for use *inside* `.or(…)`.
 *
 * PostgREST's `or=(a.ilike.x,b.ilike.y)` is a comma-and-parenthesis grammar
 * parsed before any value is looked at, so a shopper typing "Kanchipuram, red"
 * or an admin pasting "Anitha (Salem)" silently corrupts the whole filter list
 * — the query does not error, it just returns the wrong rows. Wrapping the
 * value in double quotes carries commas, dots and parens through untouched;
 * backslash and the double quote are the only two characters that can break
 * back out of that quoting, so they are dropped rather than escaped.
 *
 * `%` and `_` are deliberately left alone. A term containing them is rare, and
 * treating them as wildcards only ever widens the match — it can never reach a
 * row the caller's RLS policy would not already have allowed.
 */
export function likeValue(term: string): string {
  return `"%${term.replace(/["\\]/g, '')}%"`;
}

/** `col.ilike."%term%"` for each column, joined for `.or(…)`. */
export function ilikeAny(columns: string[], term: string): string {
  const value = likeValue(term);
  return columns.map((c) => `${c}.ilike.${value}`).join(',');
}

/**
 * The bare pattern for a single `.ilike(col, …)` call, which supabase-js
 * encodes itself and so must NOT be pre-quoted.
 */
export function likePattern(term: string): string {
  return `%${term}%`;
}

/** True when a term looks like a UUID, so an id paste can match a primary key. */
export function isUuid(term: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term.trim());
}

const warned = new Set<string>();

/**
 * Log a failing source once per session.
 *
 * Migrations here are applied by hand, so a source can be pointing at a table
 * or column that is not in the database yet. That must degrade to "this group
 * found nothing" rather than taking the whole search down with it — but it also
 * must not scroll past unnoticed, and it must not repeat on every keystroke.
 */
export function warnSourceOnce(key: string, error: unknown) {
  if (warned.has(key)) return;
  warned.add(key);
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[search] source "${key}" failed and was skipped: ${message}`);
}
