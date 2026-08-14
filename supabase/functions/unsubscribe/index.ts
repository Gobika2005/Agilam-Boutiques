/**
 * One-click unsubscribe — the endpoint the `List-Unsubscribe` header points at.
 *
 * WHY A FUNCTION AND NOT JUST THE /unsubscribe PAGE
 * RFC 8058, which Gmail and Yahoo require of bulk senders, is not a link — it is
 * a POST. The mail client sends it from its own servers, with no browser, no
 * cookies and no JavaScript, and expects a 2xx. A React route cannot answer that:
 * a POST to the SPA returns the shell with HTTP 200, the client would report
 * success, and the person would stay subscribed while believing they had opted
 * out. Claiming `List-Unsubscribe-Post` without an endpoint that honours it is
 * worse than not claiming it at all.
 *
 * So both shapes are handled here:
 *   POST  → unsubscribe, return 200 text. This is the one-click path.
 *   GET   → unsubscribe, then redirect a human to the storefront page, which
 *           confirms what happened and offers to undo it.
 *
 * THE TOKEN IS THE CREDENTIAL
 * No session is involved — the reader is in a mail client, often on another
 * device. `unsubscribe_by_token` (0089) is SECURITY DEFINER, granted to `anon`,
 * and does exactly one thing. A guessed uuid buys nothing except stopping
 * marketing mail to an address the guesser cannot see.
 *
 * DEPLOY — the --no-verify-jwt is required, same as the Shiprocket webhook:
 *   supabase functions deploy unsubscribe --no-verify-jwt
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const APP_URL = (Deno.env.get('APP_URL') ?? 'https://mangaimart.com').replace(/\/$/, '');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  // `t` is what the emails use; `token` accepted because a person forwarding a
  // link by hand gets it wrong in exactly that way.
  const token = (url.searchParams.get('t') ?? url.searchParams.get('token') ?? '').trim();
  const wantsPage = req.method === 'GET';

  const fail = (message: string) =>
    wantsPage
      ? Response.redirect(`${APP_URL}/unsubscribe?error=${encodeURIComponent(message)}`, 302)
      : new Response(message, { status: 400, headers: { ...CORS, 'Content-Type': 'text/plain' } });

  if (!UUID.test(token)) return fail('That unsubscribe link is not valid.');

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    // The anon key is enough: the RPC is SECURITY DEFINER and granted to anon on
    // purpose. Using the service-role key here would hand a public, unauthenticated
    // endpoint the keys to the whole database for no benefit at all.
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { data, error } = await db.rpc('unsubscribe_by_token', { p_token: token });
  const row = Array.isArray(data) ? data[0] : data;

  if (error) {
    console.error('[unsubscribe]', error.message);
    // A one-click POST that 500s makes the mail client retry and, in Gmail's
    // case, count it against the sender. Report the failure plainly instead.
    return new Response('Could not process this request.', {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'text/plain' },
    });
  }

  if (!row?.ok) return fail('That unsubscribe link has already been used or is no longer valid.');

  if (wantsPage) {
    // `done=1` tells the page not to call the RPC a second time; the token rides
    // along so the "resubscribe" button on that page has something to work with.
    return Response.redirect(
      `${APP_URL}/unsubscribe?t=${encodeURIComponent(token)}&done=1&e=${encodeURIComponent(row.masked_email ?? '')}`,
      302,
    );
  }

  return new Response('Unsubscribed.', { status: 200, headers: { ...CORS, 'Content-Type': 'text/plain' } });
});
