/**
 * Where the admin console lives.
 *
 * It used to be `/admin`, which every bot, scanner and curious visitor tries
 * first. The segment now comes from `VITE_ADMIN_PATH` so it is not in the repo,
 * and `/admin` itself falls through to the normal 404 — there is no redirect,
 * no decoy, nothing to confirm a console exists.
 *
 * ⚠ This is obscurity, not a lock. Vite inlines `VITE_ADMIN_PATH` into the
 * JavaScript bundle the browser downloads, so anyone who opens devtools and
 * searches it will find this path in seconds. It thins out drive-by traffic;
 * it does not defend the console. RLS and the role checks in
 * `@/lib/staffAccess` are what actually hold. Never treat a screen as safe
 * because its URL is hard to guess.
 *
 * Every link into the console must be built through here. A hardcoded
 * `/admin/...` left anywhere becomes a dead link the moment the var changes —
 * and in `canOpen()` it would lock staff out of the console entirely.
 */

/**
 * Missing var = `admin`, which only happens under `npm run dev`: vite.config.ts
 * refuses to build without it, so a deployed bundle always carries the real one.
 */
function normalise(value: string | undefined): string {
  const trimmed = (value ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed || 'admin';
}

/** The single URL segment, no slashes — e.g. `mangai-office`. */
export const ADMIN_SEGMENT = normalise(import.meta.env.VITE_ADMIN_PATH);

/** The console root, leading slash included — e.g. `/mangai-office`. */
export const ADMIN_BASE = `/${ADMIN_SEGMENT}`;

/** Builds a console URL: `adminPath('orders')` → `/mangai-office/orders`. */
export function adminPath(sub = ''): string {
  const tail = sub.replace(/^\/+/, '');
  return tail ? `${ADMIN_BASE}/${tail}` : ADMIN_BASE;
}

/** True when a pathname sits inside the console. Use instead of `startsWith('/admin')`. */
export function isAdminPath(pathname: string): boolean {
  return pathname === ADMIN_BASE || pathname.startsWith(`${ADMIN_BASE}/`);
}

/**
 * Rehomes a stored `/admin/...` path onto the console's real base.
 *
 * Rows already in the database point at `/admin/...` — `notifications.link` is
 * written by Postgres triggers (migration 0081) that cannot know a build-time
 * secret, and older rows were backfilled with it. Rather than teach the DB the
 * path, every stored link is translated on the way out. Anything else is
 * returned untouched, so buyer and seller links pass straight through.
 */
export function consolePath(stored: string): string {
  if (stored === '/admin') return ADMIN_BASE;
  return stored.startsWith('/admin/') ? `${ADMIN_BASE}${stored.slice('/admin'.length)}` : stored;
}
