import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client factory for the serverless functions.
 *
 * Exists because `createClient()` builds a Realtime client as part of its
 * constructor, and current supabase-js resolves the WebSocket implementation
 * eagerly while doing so. Node only exposes a global `WebSocket` from v22, so on
 * Node 20 that resolution THROWS — "Node.js detected but native WebSocket not
 * found" — and takes the whole request down before a single query runs. In
 * api/place-order.js that lands after the buyer's payment is already captured,
 * which is exactly the failure you never want: money taken, no order.
 *
 * package.json pins `engines.node: 24.x` (any Node >= 22 works) so deployments
 * are fine, but a developer on Node 20 would hit this on every checkout, and a runtime that
 * quietly downgrades Node would reintroduce it in production. None of these
 * functions ever open a realtime channel — they use PostgREST and the Auth
 * admin API — so we pass a transport placeholder. `RealtimeClient` prefers
 * `options.transport` over the throwing factory lookup, and since no channel is
 * ever subscribed, the placeholder is never constructed.
 *
 * The leading underscore keeps this out of Vercel's /api routing.
 */

// Never instantiated: it exists only to satisfy the eager transport lookup.
class UnusedWebSocketTransport {
  constructor() {
    throw new Error('Realtime is not available in the API functions');
  }
}

const NON_REALTIME = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: UnusedWebSocketTransport },
};

/**
 * A service-role client (bypasses RLS). Returns null when the environment isn't
 * configured, so callers can answer with a clear error instead of crashing.
 */
export function serviceClient(url, serviceRoleKey) {
  if (!isConfigured(url) || !isConfigured(serviceRoleKey)) return null;
  return createClient(url, serviceRoleKey, NON_REALTIME);
}

/** A client bound to a caller-supplied key (e.g. the anon key). */
export function keyedClient(url, key) {
  if (!isConfigured(url) || !isConfigured(key)) return null;
  return createClient(url, key, NON_REALTIME);
}

/**
 * Env vars are strings, so an unset value that has been round-tripped through
 * `process.env` arrives as the literal "undefined"/"null" rather than a falsy
 * value — truthy enough to sail past a plain `if (!key)` guard and then fail
 * deep inside an API call. Treat those as absent.
 */
function isConfigured(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return v !== '' && v !== 'undefined' && v !== 'null';
}
