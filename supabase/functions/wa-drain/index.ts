/**
 * Empty the WhatsApp outbox — the one place a message actually leaves for Meta.
 *
 * WHY A CRON-DRIVEN DRAINER AND NOT A DIRECT SEND
 * Order status is changed by a client-side `update({ status })` in
 * src/data/orders.ts, so there is no server hop to hang a send off, and `api/`
 * is at 12 of the 12 routes Vercel Hobby allows. Migration 0090's triggers
 * therefore queue a row from inside Postgres — which catches a status change
 * from any source, including an admin's manual SQL edit — and pg_cron pokes this
 * function once a minute to send what is waiting. Queueing in a transaction also
 * means a send can never be attributed to an order that rolled back.
 *
 * DEPLOY — --no-verify-jwt, same as wa-webhook, because the caller is pg_cron
 * presenting our own secret rather than a Supabase-issued JWT:
 *   supabase functions deploy wa-drain --no-verify-jwt
 * Then schedule it; see WHATSAPP_AUTOMATION_PLAN.md Phase 2.8.
 *
 * WHO MAY CALL IT
 * A shared secret of our own, `WA_DRAIN_SECRET`, presented as the bearer. See
 * authorised() for why it is not the service-role key.
 *
 * WHAT IS DECIDED IN SQL, NOT HERE
 * The kill switch, the second opt-out check and the staleness sweep all live in
 * `wa_claim_batch` (0090), so they hold however this function is invoked. This
 * file owns exactly one thing: the conversation with Meta.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const PHONE_NUMBER_ID = Deno.env.get('WA_PHONE_NUMBER_ID') ?? '';
const ACCESS_TOKEN = Deno.env.get('WA_ACCESS_TOKEN') ?? '';
const GRAPH_VERSION = Deno.env.get('WA_GRAPH_VERSION') ?? 'v21.0';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
/** Ours, not the platform's — see authorised(). */
const DRAIN_SECRET = Deno.env.get('WA_DRAIN_SECRET') ?? '';

/** One tick's worth. 20 × ~300ms sits well inside the function's time budget. */
const BATCH = Number(Deno.env.get('WA_BATCH_SIZE') ?? 20);
const MAX_ATTEMPTS = 5;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Meta errors that will never succeed on a retry, so the row fails immediately
 * rather than burning five attempts and five minutes:
 *   131026  recipient is not a WhatsApp user / cannot receive
 *   131047  outside the 24-hour service window (only templates escape it)
 *   131049  suppressed by Meta's own quality rules
 *   132000  parameter count does not match the approved template
 *   132001  no such template in this language
 *   132005  template body resolved longer than allowed
 *   132007  a parameter violated the template's format rules
 *   132012  a parameter's format is invalid (newlines, runs of spaces)
 *   132015  the template is paused for quality
 *   132016  the template was deleted
 *   131051  unsupported message type
 *   470     the template itself was rejected or expired
 * The distinction matters commercially: a retry on any of these is a request we
 * pay for and can never win.
 */
const PERMANENT = new Set([
  131026, 131047, 131049, 131051, 132000, 132001, 132005, 132007, 132012, 132015, 132016, 470,
]);

type Row = {
  id: string;
  recipient: string;
  template: string;
  lang: string;
  params: unknown;
  attempts: number;
};

/** Exponential, in minutes: 2, 4, 8, 16 — then the row is given up on. */
const backoffMinutes = (attempts: number) => Math.min(2 ** attempts, 60);

async function send(row: Row): Promise<{ ok: true; id: string } | { ok: false; permanent: boolean; error: string }> {
  const params = Array.isArray(row.params) ? row.params : [];

  const body: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: row.recipient,
    type: 'template',
    template: {
      name: row.template,
      language: { code: row.lang || 'en' },
      // A template with no variables must send NO components array at all —
      // an empty one is itself a 132000.
      ...(params.length
        ? {
            components: [
              {
                type: 'body',
                parameters: params.map((p) => ({ type: 'text', text: String(p ?? '-') })),
              },
            ],
          }
        : {}),
    },
  };

  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    // Network reached nobody. Always worth another go.
    return { ok: false, permanent: false, error: `network: ${(err as Error)?.message ?? err}` };
  }

  const payload = await res.json().catch(() => ({}));

  if (res.ok) {
    const id = payload?.messages?.[0]?.id;
    if (id) return { ok: true, id };
    // 200 with no message id should not happen; treat it as retryable rather
    // than marking a row sent we cannot later match a receipt to.
    return { ok: false, permanent: false, error: 'accepted but no message id returned' };
  }

  const code = Number(payload?.error?.code ?? 0);
  const detail =
    payload?.error?.error_data?.details ?? payload?.error?.message ?? `HTTP ${res.status}`;

  // 401/403 means the token is dead or the number was unassigned. Retrying will
  // not revive it, but every queued row failing on the same cause would bury the
  // real story, so these stay retryable and the admin panel shows the reason.
  return { ok: false, permanent: PERMANENT.has(code), error: `${code || res.status}: ${detail}` };
}

/**
 * Is this caller allowed to drain the queue?
 *
 * WHY A SECRET OF OUR OWN, AND NOT THE SERVICE-ROLE KEY
 * Two earlier versions of this check both broke on the same root cause, so it is
 * worth stating plainly: the `SUPABASE_*` credentials are issued, injected and
 * rotated by the platform, not by us.
 *
 *   1. Comparing the bearer to `SUPABASE_SERVICE_ROLE_KEY` failed because the
 *      value the deployed function saw had drifted from the project's key.
 *   2. Reading the `role` claim failed for a different reason: the project is on
 *      Supabase's newer API keys, where the dashboard hands you an
 *      `sb_secret_...` string that is not a JWT at all. The platform's own gate
 *      rejected it with UNAUTHORIZED_INVALID_JWT_FORMAT before this code ran.
 *
 * Both failures looked identical from the outside — a cron job quietly 401/403ing
 * every minute while orders queued and nothing sent. So authorisation no longer
 * depends on any Supabase-issued credential or its format. `WA_DRAIN_SECRET` is
 * ours, it changes only when we change it, and it is the same shape as
 * SHIPROCKET_WEBHOOK_TOKEN elsewhere in this project.
 *
 * That means the function is deployed --no-verify-jwt and THIS is the only gate,
 * exactly as the HMAC is the only gate on wa-webhook. Fails closed: an unset
 * secret refuses everyone rather than admitting everyone.
 *
 * The function's own service-role key is accepted too, so an operator holding it
 * can poke the endpoint by hand. That is an exact string match, not a decoded
 * claim: with --no-verify-jwt nothing upstream checks a signature any more, so
 * trusting a `role` claim read out of an unverified token would accept anything
 * a caller cared to base64 for themselves.
 */
function authorised(req: Request): boolean {
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return false;
  if (DRAIN_SECRET && bearer === DRAIN_SECRET) return true;
  if (SERVICE_KEY && bearer === SERVICE_KEY) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'method not allowed' }, 405);
  }

  if (!authorised(req)) {
    return json({ error: 'forbidden' }, 403);
  }

  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    // Nothing is claimed in this case — claiming would burn an attempt on every
    // row for a fault that has nothing to do with them.
    console.error('wa-drain: WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN not set');
    return json({ error: 'not configured' }, 500);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', SERVICE_KEY, {
    auth: { persistSession: false },
  });

  // Claiming stamps attempts+1 and pushes next_attempt_at two minutes out, so a
  // crash between here and the update below re-queues the row on its own instead
  // of stranding it.
  const { data: rows, error } = await supabase.rpc('wa_claim_batch', {
    p_limit: BATCH,
    p_stale_hours: 24,
  });

  if (error) {
    console.error('wa-drain: claim failed:', error.message);
    return json({ error: 'claim failed' }, 500);
  }
  if (!rows?.length) {
    // The overwhelmingly common case — an idle minute, or the kill switch off.
    return json({ claimed: 0, sent: 0, failed: 0 });
  }

  let sent = 0;
  let failed = 0;

  for (const row of rows as Row[]) {
    const result = await send(row);

    if (result.ok) {
      sent++;
      await supabase
        .from('whatsapp_outbox')
        .update({
          status: 'sent',
          wa_message_id: result.id,
          sent_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', row.id);
      continue;
    }

    const giveUp = result.permanent || row.attempts >= MAX_ATTEMPTS;
    if (giveUp) failed++;

    await supabase
      .from('whatsapp_outbox')
      .update(
        giveUp
          ? { status: 'failed', last_error: result.error }
          : {
              status: 'queued',
              last_error: result.error,
              next_attempt_at: new Date(
                Date.now() + backoffMinutes(row.attempts) * 60_000,
              ).toISOString(),
            },
      )
      .eq('id', row.id);

    console.error(
      `wa-drain: ${row.template} → ${row.recipient.slice(0, 4)}•••• ${giveUp ? 'FAILED' : 'retry'}: ${result.error}`,
    );
  }

  return json({ claimed: rows.length, sent, failed });
});
