/**
 * The endpoint Meta calls back — webhook verification, delivery receipts, and
 * the STOP that opts someone out.
 *
 * WHY AN EDGE FUNCTION AND NOT `api/`
 * `api/` holds exactly 12 routes, which is the Vercel Hobby ceiling; a
 * thirteenth fails the deploy outright. The same escape hatch the Shiprocket
 * booking, the payout advice and the unsubscribe endpoint all took.
 *
 * DEPLOY — the --no-verify-jwt is required, exactly as for `unsubscribe`:
 *   supabase functions deploy wa-webhook --no-verify-jwt
 * Meta calls this unauthenticated. It has no Supabase JWT to present and never
 * will, so leaving the platform's JWT gate on would make every callback a 401
 * and Meta would disable the subscription. The HMAC below is what replaces it,
 * and it is a stronger check than a JWT would have been: it proves the body was
 * written by whoever holds our app secret, not merely that a caller had a token.
 *
 * THE THREE JOBS
 *   GET   → answer Meta's subscription challenge by echoing `hub.challenge`,
 *           but only when `hub.verify_token` matches ours.
 *   POST statuses → record sent/delivered/read/failed against the outbox row.
 *   POST messages → an inbound STOP or UNSUBSCRIBE writes `whatsapp_optout`;
 *           START or UNSTOP removes it again.
 *
 * ALWAYS 200 ON A POST WE UNDERSTOOD
 * Meta retries a non-2xx with escalating backoff and disables a webhook that
 * keeps failing. A row we cannot match, a shape we do not recognise, a database
 * blip — none of those are Meta's problem to retry, so they are logged and
 * acknowledged. Only a failed signature check gets a 401, because that request
 * did not come from Meta at all.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const VERIFY_TOKEN = Deno.env.get('WA_VERIFY_TOKEN') ?? '';
const APP_SECRET = Deno.env.get('WA_APP_SECRET') ?? '';

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

/** The words that stop messages, and the ones that start them again. */
const STOP_WORDS = new Set(['stop', 'unsubscribe', 'cancel', 'quit', 'stopall']);
const START_WORDS = new Set(['start', 'unstop', 'resume', 'subscribe']);

/**
 * Meta signs the raw body with the app secret. Verify against the BYTES exactly
 * as received — re-serialising the parsed JSON changes key order and whitespace
 * and the digest stops matching, which is the classic way this check gets
 * quietly disabled by someone "cleaning it up".
 */
async function signatureOk(raw: string, header: string | null): Promise<boolean> {
  if (!APP_SECRET) return false;                       // fail closed: no secret, no trust
  if (!header?.startsWith('sha256=')) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice(7);

  // Constant-time compare. A length-then-early-return comparison leaks how much
  // of a forged signature was right, which is enough to reconstruct one byte at
  // a time.
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const db = () =>
  createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    // Service role: `whatsapp_outbox` and `whatsapp_optout` have RLS on with no
    // policies at all (migration 0090), so nothing short of the service role can
    // touch them. That is the point — they hold every customer's phone number.
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ── Subscription challenge ────────────────────────────────────────────────
  // This is what the "Verify and save" button on Meta's Configure Webhooks
  // screen calls. It needs only WA_VERIFY_TOKEN to be set, so the webhook can be
  // registered before the app secret or the access token exist.
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge') ?? '';

    if (!VERIFY_TOKEN) {
      console.error('wa-webhook: WA_VERIFY_TOKEN is not set — cannot verify the subscription');
      return text('not configured', 500);
    }
    if (mode === 'subscribe' && token === VERIFY_TOKEN) return text(challenge, 200);
    return text('forbidden', 403);
  }

  if (req.method !== 'POST') return text('method not allowed', 405);

  const raw = await req.text();
  if (!(await signatureOk(raw, req.headers.get('x-hub-signature-256')))) {
    console.warn('wa-webhook: rejected a POST with a bad or missing X-Hub-Signature-256');
    return text('bad signature', 401);
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return text('ok', 200);       // unparseable, but retrying will not fix it
  }

  try {
    const supabase = db();

    for (const entry of payload?.entry ?? []) {
      for (const change of entry?.changes ?? []) {
        const value = change?.value ?? {};

        // ── Delivery receipts ────────────────────────────────────────────────
        // Reporting only: the row is already 'sent' and nothing is re-queued off
        // a receipt. A `failed` status here means Meta accepted the message and
        // could not deliver it — retrying would produce the same failure and
        // charge us again for the privilege.
        for (const st of value?.statuses ?? []) {
          const id = st?.id;
          if (!id) continue;
          const { error } = await supabase
            .from('whatsapp_outbox')
            .update({
              delivery_status: st.status ?? null,
              last_error: st?.errors?.[0]?.title ?? null,
            })
            .eq('wa_message_id', id);
          if (error) console.error('wa-webhook: status update failed:', error.message);
        }

        // ── Inbound messages ─────────────────────────────────────────────────
        for (const msg of value?.messages ?? []) {
          const from = String(msg?.from ?? '').replace(/\D/g, '');
          if (!from) continue;

          // A button reply carries its label rather than a text body — Meta's
          // own opt-out buttons on utility templates arrive this way, and
          // ignoring them would mean silently disregarding an opt-out.
          const bodyText = String(
            msg?.text?.body ?? msg?.button?.text ?? msg?.interactive?.button_reply?.title ?? '',
          )
            .trim()
            .toLowerCase();
          const word = bodyText.replace(/[^a-z]/g, '');

          if (STOP_WORDS.has(word)) {
            const { error } = await supabase
              .from('whatsapp_optout')
              .upsert({ msisdn: from, reason: word }, { onConflict: 'msisdn' });
            if (error) console.error('wa-webhook: opt-out insert failed:', error.message);
            else console.log('wa-webhook: opted out', from.slice(0, 4) + '••••');
          } else if (START_WORDS.has(word)) {
            const { error } = await supabase.from('whatsapp_optout').delete().eq('msisdn', from);
            if (error) console.error('wa-webhook: opt-in delete failed:', error.message);
          }
          // Anything else is a real person writing to the support number. It is
          // waiting for whoever answers Meta Business Suite's inbox; there is no
          // auto-reply here on purpose, because an automated reply to an inbound
          // message opens a paid 24-hour service window we get nothing from.
        }
      }
    }
  } catch (err) {
    // Logged, then acknowledged. Meta cannot fix our database for us, and a 500
    // here only earns a retry storm and eventually a disabled subscription.
    console.error('wa-webhook: handler error (acknowledged anyway):', (err as Error)?.message ?? err);
  }

  return text('ok', 200);
});
