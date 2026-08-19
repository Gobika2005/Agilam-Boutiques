/**
 * Pull a human-readable message out of whatever a failed call threw.
 *
 * The data layer does `const { error } = await supabase...; if (error) throw error`
 * — and what PostgREST hands back there is a **plain object**, not an Error
 * instance (see PostgrestBuilder.processResponse: it is `JSON.parse(body)`; only
 * `.throwOnError()` wraps it in the PostgrestError class). So the very common
 *
 *     catch (e) { showToast(e instanceof Error ? e.message : 'Something failed') }
 *
 * always takes the fallback branch for a database error, and the one thing worth
 * reading — "record \"new\" has no field \"name\"", "new row violates row-level
 * security policy", "Could not find the 'weight_grams' column" — never reaches
 * the screen or the console. A whole class of bugs looks like a generic shrug.
 *
 * This handles both shapes, plus the `hint` Postgres attaches to permission and
 * typo errors (which is usually the actual fix).
 */
export function errMessage(e: unknown, fallback: string): string {
  if (typeof e === 'string' && e.trim()) return e;

  if (e && typeof e === 'object') {
    const { message, hint } = e as { message?: unknown; hint?: unknown };
    if (typeof message === 'string' && message.trim()) {
      return typeof hint === 'string' && hint.trim() ? `${message} — ${hint}` : message;
    }
  }

  return fallback;
}
