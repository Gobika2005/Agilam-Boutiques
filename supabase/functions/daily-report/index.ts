/**
 * The daily admin report — primary sender.
 *
 * WHY AN EDGE FUNCTION AND NOT `api/` OR A LOCAL SCRIPT
 * `api/` holds exactly 12 routes, the Vercel Hobby ceiling, and the one cron
 * slot is spent on the ads lifecycle sweep — same escape hatch as wa-drain and
 * broadcast-email. The report previously ran as a Windows Scheduled Task on the
 * owner's PC, which meant no report on any morning the machine was asleep. This
 * runs in Supabase on pg_cron and does not care whose laptop is open.
 *
 * WHO MAY CALL IT
 * pg_cron, with the service-role key in the Authorization header — the same
 * shape wa-drain uses, and the reason this deploys with --no-verify-jwt: the
 * caller is a database job, not a signed-in user. The bearer is compared to the
 * service-role key (and to REPORT_TOKEN, so the owner can fire it by hand
 * without pasting the service-role key into a terminal). Anything else is 401.
 *
 * WHAT IT DOES NOT TRUST
 * The service-role key it holds is never used to read business data. Figures
 * come from `daily_digest()` and the recipient list from `report_recipients()`,
 * both SECURITY DEFINER and gated on REPORT_TOKEN, so the blast radius of this
 * function leaking is one token that reads aggregates — not a key that bypasses
 * RLS on every table.
 *
 * DOUBLE SENDS
 * The Windows task still runs as a fallback. Both call `claim_report_run()`
 * first and only the winner sends, so the fallback needs no knowledge of
 * whether the cloud ran.
 *
 * DEPLOY
 *   supabase functions deploy daily-report --no-verify-jwt
 *   supabase secrets set REPORT_TOKEN=... RESEND_API_KEY=... REPORT_FROM=... APP_URL=https://mangaimart.com
 *   -- optional: ADMIN_PATH=<the VITE_ADMIN_PATH segment> for deep links
 * Then schedule it (SQL editor, once):
 *   select cron.schedule('daily-report', '30 1 * * *', $$
 *     select net.http_post(
 *       url := 'https://<project-ref>.supabase.co/functions/v1/daily-report',
 *       headers := '{"Authorization":"Bearer <service-role-key>"}'::jsonb
 *     );
 *   $$);
 * 01:30 UTC is 07:00 IST.
 */

import { renderReport, renderText, subjectFor } from '../_shared/reportTemplate.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const REPORT_TOKEN = Deno.env.get('REPORT_TOKEN') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
/**
 * The sender.
 *
 * Falls back to a real address on the platform's own verified domain, never to
 * the mail provider's shared sandbox domain — that sender is only permitted to
 * deliver to the provider account owner's own address, so with more than one
 * admin on the list it would silently drop the report for everyone else.
 * `reports@` rather than `noreply@` because a reply here should reach a human.
 */
const REPORT_FROM = Deno.env.get('REPORT_FROM')
  ?? Deno.env.get('EMAIL_FROM')
  ?? 'MangaiMart Reports <reports@mangaimart.com>';
/**
 * Which site this report is ABOUT — always a real origin, never a dev server.
 * A localhost value (copied in from the repo .env by habit) would probe nothing
 * and mail every admin a red "storefront is down" banner. Same reasoning as the
 * pinned logo URL in api/_email.js: it must be true from the reader's phone.
 */
const rawAppUrl = (Deno.env.get('APP_URL') ?? '').trim().replace(/\/$/, '');
const APP_URL = (!rawAppUrl || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(rawAppUrl))
  ? 'https://mangaimart.com'
  : rawAppUrl;
const ADMIN_PATH = (Deno.env.get('ADMIN_PATH') ?? '').trim().replace(/^\/+|\/+$/g, '');
/** Extra addresses that are not admin accounts. Optional, comma-separated. */
const EXTRA_TO = (Deno.env.get('REPORT_TO') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Call one of the token-gated report RPCs. */
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    // Bounded, like every other fetch here. Deno's fetch has no default timeout,
    // and a hang would burn the function's whole wall clock and then be killed
    // by the platform — which skips the catch below, so the day would stay
    // claimed with no finish record and no report. The local sender lost
    // 21 Aug 2026 to exactly that shape of failure.
    signal: AbortSignal.timeout(20_000),
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_token: REPORT_TOKEN, ...args }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${name} failed (${res.status}): ${(body as { message?: string })?.message ?? 'no detail'}`);
  }
  return body as T;
}

/**
 * Live HTTP probes — the half of "is it working" that no database query can
 * answer. `critical` marks the two that mean buyers are affected right now;
 * everything else degrades the banner to amber rather than red.
 */
async function probeSite() {
  const probes: Array<{ name: string; ok: boolean; detail: string; critical?: boolean }> = [];

  // 1. Does the storefront render at all?
  try {
    const r = await fetch(`${APP_URL}/`, {
      redirect: 'follow',
      headers: { 'User-Agent': 'MangaiMart-daily-report' },
      signal: AbortSignal.timeout(10_000),
    });
    probes.push({
      name: 'Storefront',
      ok: r.ok,
      detail: r.ok ? `HTTP ${r.status}` : `Storefront returned HTTP ${r.status}`,
      critical: true,
    });
  } catch (err) {
    probes.push({
      name: 'Storefront',
      ok: false,
      detail: `Storefront unreachable: ${(err as Error)?.message ?? String(err)}`,
      critical: true,
    });
  }

  // 2. Can an order actually be written and paid for? /api/health replays the
  //    exact reads place-order does and probes the live Razorpay account, which
  //    is the failure that is invisible from the outside — the shop browses
  //    perfectly while every checkout dies (see CLAUDE.md rule 6).
  try {
    const r = await fetch(`${APP_URL}/api/health`, { signal: AbortSignal.timeout(15_000) });
    const b = await r.json().catch(() => null) as
      | { checkoutReady?: boolean; database?: { ok?: boolean; error?: string }; razorpay?: { ok?: boolean; error?: string } }
      | null;
    const ready = b?.checkoutReady === true;
    const why = !ready
      ? [b?.database?.ok === false ? `database: ${b?.database?.error ?? 'failing'}` : '',
         b?.razorpay?.ok === false ? `payments: ${b?.razorpay?.error ?? 'failing'}` : ''].filter(Boolean).join('; ')
      : '';
    probes.push({
      name: 'Checkout',
      ok: ready,
      detail: ready ? 'Orders can be written and paid' : `Checkout is DOWN — ${why || `HTTP ${r.status}`}`,
      critical: true,
    });
  } catch (err) {
    probes.push({
      name: 'Checkout',
      ok: false,
      detail: `/api/health unreachable: ${(err as Error)?.message ?? String(err)}`,
      critical: true,
    });
  }

  return probes;
}

/**
 * Send one message per recipient through Resend's batch endpoint.
 *
 * Per-recipient rather than one message with several `to` addresses: admins
 * should not learn each other's personal addresses from a system mail, and a
 * single bad address in a combined `to` can fail the whole send.
 */
async function sendAll(recipients: string[], subject: string, html: string, text: string) {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    // Longer than the RPC timeout — this one carries every message body — but
    // still bounded. See the note in rpc().
    signal: AbortSignal.timeout(45_000),
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(recipients.map((to) => ({ from: REPORT_FROM, to: [to], subject, html, text }))),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  return body;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  const authorised = bearer.length > 0 && (bearer === SERVICE_KEY || (REPORT_TOKEN && bearer === REPORT_TOKEN));
  if (!authorised) return json({ error: 'Unauthorized' }, 401);

  if (!SUPABASE_URL || !ANON_KEY) return json({ error: 'Supabase env missing' }, 500);
  if (!REPORT_TOKEN) return json({ error: 'REPORT_TOKEN is not set' }, 500);

  const url = new URL(req.url);
  const body = req.method === 'POST'
    ? await req.json().catch(() => ({})) as Record<string, unknown>
    : {};
  // `dry` renders and returns the HTML without sending or claiming — how you
  // look at a change to the template. `force` skips the claim, for a resend.
  const dry = url.searchParams.get('dry') === '1' || body.dry === true;
  const force = url.searchParams.get('force') === '1' || body.force === true;

  try {
    if (!dry && !force) {
      const claimed = await rpc<boolean>('claim_report_run', { p_source: 'cloud' });
      if (!claimed) return json({ ok: true, skipped: 'already sent today' });
    }

    const [digest, recipientRows, probes] = await Promise.all([
      rpc<Record<string, unknown>>('daily_digest', {}),
      rpc<Array<{ email: string; name: string }>>('report_recipients', {}),
      probeSite(),
    ]);

    const recipients = Array.from(new Set(
      recipientRows.map((r) => r.email).concat(EXTRA_TO).filter(Boolean),
    ));

    const html = renderReport({
      digest,
      probes,
      appUrl: APP_URL,
      adminUrl: ADMIN_PATH ? `${APP_URL}/${ADMIN_PATH}` : '',
      source: 'scheduled from Supabase',
    });
    const subject = subjectFor(digest, probes);

    if (dry) {
      return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }

    if (recipients.length === 0) {
      // Not an error worth retrying — there is genuinely nobody to tell. It is
      // still recorded, because "no report arrived" and "no admin has an email
      // address on file" look identical from an inbox.
      await rpc('finish_report_run', { p_ok: false, p_recipients: 0, p_detail: 'no admin recipients' });
      return json({ ok: false, error: 'No admin accounts with an email address' }, 200);
    }

    await sendAll(recipients, subject, html, renderText(digest, probes));
    await rpc('finish_report_run', {
      p_ok: true,
      p_recipients: recipients.length,
      p_detail: `cloud → ${recipients.length} admin(s)`,
    });

    return json({ ok: true, recipients: recipients.length, subject });
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    console.error('[daily-report]', message);
    // Record the failure so the row is not left claimed-but-silent: that is what
    // lets the local fallback take the day over 25 minutes later.
    try {
      await rpc('finish_report_run', { p_ok: false, p_recipients: 0, p_detail: message });
    } catch { /* the failure to record a failure is not worth masking the first */ }
    return json({ ok: false, error: message }, 500);
  }
});
