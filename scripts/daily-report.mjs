/**
 * Daily admin report — FALLBACK sender, and the local tool for looking at one.
 *
 * The primary sender is the `daily-report` Supabase Edge Function on a pg_cron
 * tick at 01:30 UTC (07:00 IST). This script exists for the morning that does
 * not happen: Supabase paused, the function undeployed, Resend rejecting from
 * that IP. It runs from Windows Task Scheduler 45 minutes later, asks the
 * database whether today's report has already gone out, and sends it only if it
 * has not.
 *
 * That "asks first" is `claim_report_run()`, and it is what makes two senders
 * safe. The claim is a row keyed on the day, so the two callers race for a
 * primary-key insert and exactly one wins — no clock comparison, no config
 * telling this script when the cloud runs, nothing to keep in step.
 *
 * The template is NOT defined here. It lives in
 * supabase/functions/_shared/reportTemplate.js and is imported verbatim by both
 * senders, because two copies of a report drift and a drifting report is one
 * nobody trusts — the same rule that binds src/lib/pricing.ts to api/_pricing.js.
 *
 * All figures come from the `daily_digest` RPC (0060 → 0062 → 0093) and the
 * recipient list from `report_recipients`, both called with the PUBLIC anon key
 * plus REPORT_TOKEN. The service-role key is deliberately never used here.
 *
 * Modes:
 *   node scripts/daily-report.mjs                  # print the digest as JSON
 *   node scripts/daily-report.mjs --html           # print the email HTML
 *   node scripts/daily-report.mjs --out mail.html  # …and write it to a file
 *   node scripts/daily-report.mjs --ensure         # send ONLY if nobody has
 *   node scripts/daily-report.mjs --send           # send regardless (manual)
 *   node scripts/daily-report.mjs --send --to me@example.com   # test recipient
 *   node scripts/daily-report.mjs --send --brief brief.md      # add commentary
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, REPORT_TOKEN
 *      RESEND_API_KEY, REPORT_FROM                (sending only)
 *      APP_URL, ADMIN_PATH, REPORT_TO             (optional)
 * A repo .env is loaded when present; real environment variables always win.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { renderReport, renderText, subjectFor } from '../supabase/functions/_shared/reportTemplate.js';

function loadDotEnv() {
  const file = new URL('../.env', import.meta.url);
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (process.env[key] !== undefined) continue;
      process.env[key] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    }
  }
  // The app stores these VITE_-prefixed; both are public and ship in the browser
  // bundle anyway. Nothing here aliases the service-role key.
  process.env.SUPABASE_URL ??= process.env.VITE_SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY ??= process.env.VITE_SUPABASE_ANON_KEY;
  process.env.APP_URL ??= process.env.VITE_APP_URL;
  process.env.ADMIN_PATH ??= process.env.VITE_ADMIN_PATH;
}
loadDotEnv();

/**
 * Which site this report is ABOUT — always production, never the dev server.
 *
 * The repo `.env` carries `APP_URL=http://localhost:5173`, because every other
 * consumer of it is a local dev process. Inheriting that here would have the
 * fallback sender probe a Vite server that is not running and mail every admin a
 * red banner saying the storefront is down. Same reasoning as the pinned logo
 * URL in api/_email.js: the value has to be true from the reader's phone, not
 * from the machine that sent it. `REPORT_APP_URL` overrides, for staging.
 */
function productionUrl() {
  const raw = (process.env.REPORT_APP_URL || process.env.APP_URL || '').trim().replace(/\/$/, '');
  if (!raw || /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(raw)) {
    return 'https://mangaimart.com';
  }
  return raw;
}

const APP_URL = productionUrl();
const ADMIN_PATH = (process.env.ADMIN_PATH || '').trim().replace(/^\/+|\/+$/g, '');

function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }
}

/**
 * Call a token-gated report RPC.
 *
 * Straight to PostgREST rather than through supabase-js: constructing a Supabase
 * client also constructs a RealtimeClient, which needs a native WebSocket.
 * Nothing here wants realtime, and this script has no dependencies at all.
 */
async function rpc(name, args = {}) {
  requireEnv('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'REPORT_TOKEN');
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    // EVERY fetch here carries a timeout, and that is not belt-and-braces.
    // Node's fetch has no default timeout at all: on a half-open socket it waits
    // for ever. This task is triggered by StartWhenAvailable, so it typically
    // fires seconds after the machine wakes, with the network still coming up —
    // which is exactly how 21 Aug 2026 was lost. The run claimed the day, hung
    // on the next call, and never wrote an exit code or released the claim, so
    // no report went out and nothing said why.
    signal: AbortSignal.timeout(20_000),
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_token: process.env.REPORT_TOKEN, ...args }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${name} failed (${res.status}): ${body?.message ?? JSON.stringify(body)}`);
  }
  return body;
}

/**
 * The live half of "is the platform working" — the part no database query can
 * answer. Mirrors supabase/functions/daily-report/index.ts on purpose: whichever
 * sender wins the day, the reader sees the same two checks.
 */
async function probeSite() {
  const probes = [];

  try {
    const r = await fetch(`${APP_URL}/`, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
    probes.push({
      name: 'Storefront',
      ok: r.ok,
      detail: r.ok ? `HTTP ${r.status}` : `Storefront returned HTTP ${r.status}`,
      critical: true,
    });
  } catch (err) {
    probes.push({ name: 'Storefront', ok: false, detail: `Storefront unreachable: ${err?.message ?? err}`, critical: true });
  }

  // /api/health replays the exact reads place-order does and probes the live
  // Razorpay account — the failure that is invisible from the outside, where
  // the shop browses perfectly while every checkout dies (CLAUDE.md rule 6).
  try {
    const r = await fetch(`${APP_URL}/api/health`, { signal: AbortSignal.timeout(15_000) });
    const b = await r.json().catch(() => null);
    const ready = b?.checkoutReady === true;
    const why = [
      b?.database?.ok === false ? `database: ${b?.database?.error ?? 'failing'}` : '',
      b?.razorpay?.ok === false ? `payments: ${b?.razorpay?.error ?? 'failing'}` : '',
    ].filter(Boolean).join('; ');
    probes.push({
      name: 'Checkout',
      ok: ready,
      detail: ready ? 'Orders can be written and paid' : `Checkout is DOWN — ${why || `HTTP ${r.status}`}`,
      critical: true,
    });
  } catch (err) {
    probes.push({ name: 'Checkout', ok: false, detail: `/api/health unreachable: ${err?.message ?? err}`, critical: true });
  }

  return probes;
}

/**
 * One message per recipient, through Resend's batch endpoint. Per-recipient
 * rather than a shared `to`: admins should not learn each other's personal
 * addresses from a system mail, and one bad address should not fail the send.
 */
async function sendAll(recipients, subject, html, text) {
  requireEnv('RESEND_API_KEY');
  const from = process.env.REPORT_FROM || process.env.EMAIL_FROM || 'MangaiMart Reports <reports@mangaimart.com>';
  // The sender must be on a domain we have verified with the provider. The
  // provider's own shared sandbox domain is permitted to deliver ONLY to the
  // account owner's address, so with several admins on the list it would send
  // to one of them and silently drop the rest — a failure with no error to see.
  if (/@[\w.-]*resend\.dev\b/i.test(from)) {
    throw new Error(`REPORT_FROM is set to a provider sandbox sender (${from}), which only delivers to the Resend account owner. Use an address on the verified mangaimart.com domain.`);
  }
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    // Longer than the RPC timeout — this one is carrying the whole message body
    // to a third party — but still bounded. See the note in rpc().
    signal: AbortSignal.timeout(45_000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(recipients.map((to) => ({ from, to: [to], subject, html, text }))),
  });
  const out = await res.text();
  if (!res.ok) throw new Error(`Resend ${res.status}: ${out.slice(0, 300)}`);
  return out;
}

// ── main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };

const wantsSend = has('--send') || has('--ensure');
const digest = await rpc('daily_digest');

if (!wantsSend) {
  if (has('--html') || has('--out')) {
    const html = renderReport({
      digest,
      probes: has('--no-probe') ? [] : await probeSite(),
      appUrl: APP_URL,
      adminUrl: ADMIN_PATH ? `${APP_URL}/${ADMIN_PATH}` : '',
      source: 'preview',
    });
    const out = value('--out');
    if (out) {
      writeFileSync(out, html, 'utf8');
      console.log(`Wrote ${out}`);
    } else {
      console.log(html);
    }
  } else {
    console.log(JSON.stringify(digest, null, 2));
  }
  process.exit(0);
}

// --ensure is the scheduled fallback: it must be silent and exit 0 when the
// cloud already sent, because Task Scheduler reads a non-zero exit as a fault
// and the normal case is "nothing to do".
if (has('--ensure')) {
  const claimed = await rpc('claim_report_run', { p_source: 'local' });
  if (!claimed) {
    console.log(`Already sent for ${digest.day} — nothing to do.`);
    process.exit(0);
  }
  console.log(`Cloud did not send for ${digest.day}. Sending from here.`);
} else {
  // A manual --send still claims, so the row records who sent and the cloud
  // does not send a second copy an hour later.
  await rpc('claim_report_run', { p_source: 'manual' }).catch(() => false);
}

/**
 * Everything from here on is inside one try/catch, and that boundary matters as
 * much as the timeouts.
 *
 * The claim is already held at this point. Any failure past it — resolving
 * recipients, probing the site, Resend refusing the batch — must report itself
 * back, because `finish_report_run(ok => false)` backdates the claim and hands
 * the day straight back. A throw that escaped this block would leave the row
 * claimed, unsent and silent until the staleness window expired, which for a
 * once-a-day job means no report at all.
 */
try {
  const override = (value('--to') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const fromDb = override.length ? [] : await rpc('report_recipients');
  const extra = (process.env.REPORT_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
  const recipients = Array.from(new Set(
    override.length ? override : fromDb.map((r) => r.email).concat(extra),
  ));

  if (recipients.length === 0) {
    throw new Error('No admin account has an email address on file — nothing sent.');
  }

  const briefPath = value('--brief');
  const brief = briefPath && existsSync(briefPath) ? readFileSync(briefPath, 'utf8').trim() : '';
  const probes = await probeSite();
  const html = renderReport({
    digest,
    probes,
    brief,
    appUrl: APP_URL,
    adminUrl: ADMIN_PATH ? `${APP_URL}/${ADMIN_PATH}` : '',
    source: has('--ensure') ? 'backup sender — the scheduled cloud run did not report success' : 'sent manually',
  });

  await sendAll(recipients, subjectFor(digest, probes), html, renderText(digest, probes));
  await rpc('finish_report_run', {
    p_ok: true,
    p_recipients: recipients.length,
    p_detail: `${has('--ensure') ? 'local fallback' : 'manual'} → ${recipients.length} admin(s)`,
  }).catch(() => {});
  console.log(`Sent to ${recipients.length} admin(s): ${recipients.join(', ')}`);
} catch (err) {
  const message = String(err?.message ?? err);
  await rpc('finish_report_run', { p_ok: false, p_detail: message }).catch(() => {});
  console.error(message);
  process.exit(1);
}
