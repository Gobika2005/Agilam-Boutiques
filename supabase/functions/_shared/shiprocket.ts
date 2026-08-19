/**
 * Shiprocket API client, shared by the booking and webhook functions.
 *
 * WHY THIS IS A SUPABASE EDGE FUNCTION AND NOT `api/`
 * `api/` holds exactly 12 routes, which is the Vercel Hobby ceiling — adding a
 * thirteenth fails the deploy outright. Shipping booking therefore lives in
 * Deno on Supabase, the same escape hatch the WhatsApp outbox (migration 0061)
 * was designed around.
 *
 * TOKEN HANDLING is the one thing worth reading carefully. Shiprocket's login
 * endpoint is aggressively rate-limited and its token is valid for 240 hours,
 * so authenticating per request gets the account throttled within a day of any
 * real volume. The token is cached in `shiprocket_auth` (migration 0067) — a
 * table with RLS on and no policies, reachable only by the service role.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const BASE = 'https://apiv2.shiprocket.in/v1/external';

/** Refresh a little before the stated 240h so a request in flight never
 *  straddles the expiry and fails with a 401 we'd have to retry. */
const EXPIRY_MARGIN_MS = 6 * 60 * 60 * 1000;

export type ShiprocketError = { status: number; message: string; body?: unknown };

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );
}

/** Bad credentials and a down API are different problems; keep them apart. */
export class SrError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function login(): Promise<{ token: string; expiresAt: Date }> {
  const email = Deno.env.get('SHIPROCKET_EMAIL');
  const password = Deno.env.get('SHIPROCKET_PASSWORD');
  if (!email || !password) {
    throw new SrError(500, 'SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD are not set on this project');
  }

  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.token) {
    // Carry THEIR wording through. A bare "(403)" sends whoever reads it into
    // our code, where the fault never is — login is the first call we make, so
    // a non-2xx here is always the account, never the order or the seller.
    // 403 in particular has one overwhelmingly common cause: the secrets hold a
    // panel login. The external API only accepts a user created under
    // Settings → API → Configure → Create an API User.
    const detail = (body as { message?: string } | null)?.message;
    const hint = res.status === 403
      ? ' — check SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD hold a Shiprocket *API user* (Settings → API → Configure), not your panel login, and that the password has no stray spaces'
      : '';
    throw new SrError(
      502,
      `Shiprocket login failed (${res.status})${detail ? `: ${detail}` : ''}${hint}`,
      body,
    );
  }
  // Their docs state 240 hours and the response carries no expiry field, so the
  // lifetime is computed rather than read. The margin above absorbs the drift.
  return { token: body.token as string, expiresAt: new Date(Date.now() + 240 * 60 * 60 * 1000) };
}

/**
 * A valid bearer token: the cached one if it has life left, otherwise a fresh
 * login written back to the cache.
 *
 * Not locked. Two functions racing here both log in and the second write wins —
 * which costs one redundant login, whereas an advisory lock would cost a stall
 * on every booking. Shiprocket accepts concurrent valid tokens.
 */
export async function getToken(db: SupabaseClient): Promise<string> {
  const { data } = await db
    .from('shiprocket_auth')
    .select('token, expires_at')
    .eq('id', true)
    .maybeSingle();

  if (data?.token && data.expires_at) {
    const remaining = new Date(data.expires_at).getTime() - Date.now();
    if (remaining > EXPIRY_MARGIN_MS) return data.token as string;
  }

  const fresh = await login();
  await db.from('shiprocket_auth').upsert({
    id: true,
    token: fresh.token,
    expires_at: fresh.expiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  });
  return fresh.token;
}

/** One authenticated call. Throws SrError on anything that isn't 2xx. */
export async function srFetch<T>(
  token: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!res.ok) {
    const message =
      (body as { message?: string } | null)?.message ??
      `Shiprocket ${path} failed (${res.status})`;
    throw new SrError(res.status, message, body);
  }
  return body as T;
}

/**
 * The state a pincode sits in.
 *
 * Shiprocket validates the destination state against the pincode and rejects
 * the order if they disagree — and our checkout never collected a state, only
 * city and pincode (migration 0035). Asking them is better than adding a field
 * to checkout: they are the authority on what their own API will accept, and
 * checkout stays out of the blast radius entirely.
 *
 * Returns null rather than throwing; the caller decides whether a missing state
 * is fatal.
 */
export async function stateForPincode(token: string, pincode: string): Promise<string | null> {
  try {
    const body = await srFetch<{ postcode_details?: { state?: string } }>(
      token,
      `/open/postcode/details?postcode=${encodeURIComponent(pincode)}`,
    );
    return body?.postcode_details?.state ?? null;
  } catch {
    return null;
  }
}

/**
 * Map a courier's own wording onto the five stages `shipment_events.stage`
 * accepts.
 *
 * Deliberately conservative: anything unrecognised becomes `in_transit`, which
 * records the scan without moving the order. A status we have never seen must
 * never be the thing that releases money, and Shiprocket's status vocabulary
 * varies by courier — new strings appear without notice.
 */
export function mapStage(raw: string): 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'rto' | 'failed' {
  const s = (raw ?? '').toUpperCase();

  // RTO first: "RTO DELIVERED" contains "DELIVERED" and means the exact
  // opposite — the parcel came back to the seller. Order matters here.
  if (s.includes('RTO') || s.includes('RETURN TO ORIGIN')) return 'rto';
  if (s.includes('CANCELL') || s.includes('LOST') || s.includes('DAMAGE')) return 'failed';
  if (s.includes('OUT FOR DELIVERY') || s.includes('OFD')) return 'out_for_delivery';
  if (s.includes('DELIVERED')) return 'delivered';
  if (s.includes('PICKED') || s.includes('PICKUP COMPLETE')) return 'picked_up';
  return 'in_transit';
}

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** Every response carries CORS — the seller console calls these from the
 *  browser, so an error without the headers reaches the UI as an opaque
 *  network failure instead of the message we bothered to write. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
