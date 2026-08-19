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
const PHONE_NUMBER_ID = Deno.env.get('WA_PHONE_NUMBER_ID') ?? '';
const ACCESS_TOKEN = Deno.env.get('WA_ACCESS_TOKEN') ?? '';
const GRAPH_VERSION = Deno.env.get('WA_GRAPH_VERSION') ?? 'v21.0';

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });

/**
 * The words that stop messages, and the ones that start them again.
 *
 * `cancel` is deliberately NOT here. A buyer typing "cancel" on WhatsApp almost
 * always means cancel my ORDER, not stop messaging me — treating it as an
 * opt-out would silently cut them off from updates about the very order they
 * were asking to cancel, and they would never know why the messages stopped.
 * It now falls through to the auto-reply and to a human.
 */
const STOP_WORDS = new Set(['stop', 'unsubscribe', 'quit', 'stopall', 'optout']);
const START_WORDS = new Set(['start', 'unstop', 'resume', 'subscribe']);

/**
 * Don't answer the same person more than once inside this many minutes.
 *
 * The rule chosen was "reply instantly, always", and this does not weaken it —
 * it only stops a burst. Someone sending "hi", "hello?", "are you there" in
 * fifteen seconds gets one answer rather than three, which is both what a human
 * would do and what keeps Meta's quality rating out of trouble.
 */
const AUTO_REPLY_COOLDOWN_MINUTES = 5;

/** Message types that are not a person asking something. */
const NON_CONVERSATIONAL = new Set(['reaction', 'system', 'order', 'unsupported']);

/**
 * How each order status reads to a buyer. Status only — no amount, no address —
 * because possession of a handset is weak proof of identity, and a borrowed
 * phone should not expose what someone bought or where it is going.
 */
const STATUS_LINE: Record<string, string> = {
  pending: 'is with the boutique for confirmation',
  accepted: 'has been accepted and is being prepared',
  shipped: 'has been dispatched and is on its way',
  delivered: 'has been delivered',
  cancelled: 'was cancelled',
  rejected: 'could not be accepted by the boutique',
};

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

/**
 * Send a plain text message, and log it in the outbox.
 *
 * FREE-FORM, NOT A TEMPLATE — AND WHY THAT IS ALLOWED
 * Business-initiated messages must use an approved template. This is not one:
 * it only ever runs in response to an inbound message, which opens a 24-hour
 * customer service window in which plain text is permitted. That is also why it
 * costs nothing — service conversations are not billed — and why the auto-reply
 * could ship today rather than waiting on template approval.
 *
 * The outbox row is deliberate. `whatsapp_outbox` is the audit trail for every
 * message this platform sends, and an auto-reply is no less a message the
 * business sent than an order confirmation is. It doubles as the cooldown's
 * memory, so no extra table and no migration is needed. `category: 'service'`
 * is what separates these from the billed `utility` template sends.
 */
async function sendText(supabase: any, to: string, body: string): Promise<void> {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    console.error('wa-webhook: auto-reply skipped, WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN not set');
    return;
  }

  let waId: string | null = null;
  let failure: string | null = null;
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body, preview_url: false },
      }),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) waId = payload?.messages?.[0]?.id ?? null;
    else failure = `${payload?.error?.code ?? res.status}: ${payload?.error?.message ?? 'send failed'}`;
  } catch (err) {
    failure = `network: ${(err as Error)?.message ?? err}`;
  }

  if (failure) console.error('wa-webhook: auto-reply send failed:', failure);

  // Logged whether it succeeded or not — a silent failure to answer customers is
  // exactly the thing that needs to show up in the admin panel's Failed count.
  const { error } = await supabase.from('whatsapp_outbox').insert({
    recipient: to,
    template: 'auto_reply',
    category: 'service',
    audience: 'buyer',
    lang: 'en',
    params: [body],
    status: failure ? 'failed' : 'sent',
    wa_message_id: waId,
    last_error: failure,
    sent_at: failure ? null : new Date().toISOString(),
  });
  if (error) console.error('wa-webhook: auto-reply log failed:', error.message);
}

/**
 * Answer someone who wrote to the support number.
 *
 * WHAT IT DOES AND DELIBERATELY DOES NOT DO
 * It looks up the sender's most recent order and states its status, then says a
 * person will follow up. It does not attempt to interpret the question, quote a
 * policy, promise a date, or discuss money — every one of those is a statement
 * the business would be making on WhatsApp, and a wrong one about a refund is
 * worse than no answer at all. Anything beyond "where is my order" is a human's
 * job, and the message says so plainly rather than pretending otherwise.
 *
 * OPT-OUT IS NOT CONSULTED, ON PURPOSE
 * `whatsapp_optout` suppresses business-INITIATED notifications, which is what
 * the checkout notice promises ("order updates ... reply STOP to opt out").
 * Someone who opted out and then writes in with a question is asking us
 * something; staying silent would be a worse reading of their intent than
 * answering. STOP itself never reaches here — it is handled above.
 *
 * MATCHING IS ON THE LAST TEN DIGITS
 * `orders.guest_phone` holds whatever checkout captured, which for older rows
 * predates the normalisation added in 0090. Meta always hands us `91XXXXXXXXXX`,
 * so matching the trailing ten digits is what reconciles the two without a
 * migration.
 */
async function autoReply(supabase: any, from: string, msisdnLocal: string): Promise<void> {
  // Cooldown, read from the outbox itself.
  const since = new Date(Date.now() - AUTO_REPLY_COOLDOWN_MINUTES * 60_000).toISOString();
  const { data: recent } = await supabase
    .from('whatsapp_outbox')
    .select('id')
    .eq('recipient', from)
    .eq('template', 'auto_reply')
    .gte('created_at', since)
    .limit(1);
  if (recent?.length) return;

  const { data: orders } = await supabase
    .from('orders')
    .select('order_number, status, created_at, delivered_at')
    .like('guest_phone', `%${msisdnLocal}`)
    .order('created_at', { ascending: false })
    .limit(1);

  const order = orders?.[0];
  let body: string;

  if (order) {
    const line = STATUS_LINE[order.status as string] ?? 'is being processed';
    const on =
      order.status === 'delivered' && order.delivered_at
        ? ` on ${new Date(order.delivered_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
        : '';
    body =
      `Thanks for messaging MangaiMart.\n\n` +
      `Your most recent order *${order.order_number}* ${line}${on}. ` +
      `You can see the full details in the app under My Orders.\n\n` +
      `Someone from our team will reply here shortly if you need anything else.`;
  } else {
    // No match is common and innocent: ordered on a different number, or never
    // ordered at all. Say so without implying they have done something wrong.
    body =
      `Thanks for messaging MangaiMart.\n\n` +
      `We could not find a recent order against this number — if you ordered using a different mobile, please share the order number.\n\n` +
      `Someone from our team will reply here shortly.`;
  }

  await sendText(supabase, from, body);
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

          // Record it before acting on it (migration 0091). Every inbound
          // message goes in the log, STOP included — an opt-out is exactly the
          // kind of thing you want evidence of later. `wa_message_id` is unique,
          // so Meta redelivering a webhook cannot turn one customer message into
          // three rows.
          {
            const { error } = await supabase.from('whatsapp_inbound').upsert(
              {
                msisdn: from,
                wa_message_id: msg?.id ?? null,
                msg_type: String(msg?.type ?? 'text'),
                // The original casing, not the lowercased matching copy.
                body:
                  msg?.text?.body ??
                  msg?.button?.text ??
                  msg?.interactive?.button_reply?.title ??
                  null,
                profile_name: value?.contacts?.[0]?.profile?.name ?? null,
                received_at: msg?.timestamp
                  ? new Date(Number(msg.timestamp) * 1000).toISOString()
                  : null,
              },
              { onConflict: 'wa_message_id', ignoreDuplicates: true },
            );
            if (error) console.error('wa-webhook: inbound log failed:', error.message);
          }

          if (STOP_WORDS.has(word)) {
            const { error } = await supabase
              .from('whatsapp_optout')
              .upsert({ msisdn: from, reason: word }, { onConflict: 'msisdn' });
            if (error) console.error('wa-webhook: opt-out insert failed:', error.message);
            else console.log('wa-webhook: opted out', from.slice(0, 4) + '••••');
          } else if (START_WORDS.has(word)) {
            const { error } = await supabase.from('whatsapp_optout').delete().eq('msisdn', from);
            if (error) console.error('wa-webhook: opt-in delete failed:', error.message);
          } else if (!NON_CONVERSATIONAL.has(String(msg?.type ?? 'text'))) {
            // A real person asking something. Answer with what we can state
            // safely, and tell them a human is coming. A reaction or a system
            // notice is not a question, so it gets nothing.
            //
            // Meta hands us 91XXXXXXXXXX; `orders.guest_phone` holds whatever
            // checkout captured, so the last ten digits are the common ground.
            try {
              await autoReply(supabase, from, from.slice(-10));
            } catch (err) {
              // Never fail the webhook over a reply. Meta retries a non-2xx and
              // eventually disables the subscription, which would cost us the
              // opt-out handling above — far more important than an auto-reply.
              console.error('wa-webhook: auto-reply failed:', (err as Error)?.message ?? err);
            }
          }
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
