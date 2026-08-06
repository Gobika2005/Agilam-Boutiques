/**
 * Daily owner report — gathers yesterday's trading figures and mails them.
 *
 * Runs as a plain Node script, NOT a Vercel serverless function. That is
 * deliberate: this project is on Vercel's Hobby plan, which caps both cron jobs
 * and serverless functions, and `api/` already sits at 12 routable functions
 * with the single cron slot spent on the ads lifecycle sweep. So the schedule
 * lives outside Vercel (a Claude Code cloud routine) and calls this directly.
 *
 * Two modes:
 *   node scripts/daily-report.mjs --json
 *       Prints the digest as JSON on stdout. The reporting agents read this.
 *
 *   node scripts/daily-report.mjs --send --brief brief.md
 *       Renders the digest plus the CEO brief as HTML and sends it via Resend.
 *
 * Env required (all of it — the script refuses to guess):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   read the figures
 *   RESEND_API_KEY, REPORT_TO, REPORT_FROM    send the mail (--send only)
 *
 * Service-role is used because this reads across every boutique, which RLS
 * correctly forbids for any normal caller. Never expose this over HTTP.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const IST_OFFSET_MIN = 330; // +05:30, no DST in India

/** Yesterday in IST, returned as the UTC instants bounding that calendar day. */
function istYesterday(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate() - 1;
  const startUtc = Date.UTC(y, m, d) - IST_OFFSET_MIN * 60_000;
  return {
    label: new Date(Date.UTC(y, m, d)).toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
    }),
    from: new Date(startUtc).toISOString(),
    to: new Date(startUtc + 86_400_000).toISOString(),
    prevFrom: new Date(startUtc - 86_400_000).toISOString(),
  };
}

const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }
}

/**
 * Cancelled orders are excluded from every revenue figure, matching the rest of
 * the app's analytics. `rejected` is this schema's cancelled state.
 */
const CANCELLED = 'rejected';

async function buildDigest(sb) {
  const day = istYesterday();

  const orderCols = 'id,order_number,boutique_id,status,payment_status,channel,total,platform_discount,created_at';

  const [{ data: orders, error: oErr }, { data: prevOrders }] = await Promise.all([
    sb.from('orders').select(orderCols).gte('created_at', day.from).lt('created_at', day.to),
    sb.from('orders').select('id,total,status').gte('created_at', day.prevFrom).lt('created_at', day.from),
  ]);
  if (oErr) throw new Error(`orders query failed: ${oErr.message}`);

  const live = (orders ?? []).filter((o) => o.status !== CANCELLED);
  const prevLive = (prevOrders ?? []).filter((o) => o.status !== CANCELLED);

  // Goods value drives commission — order.total also carries shipping and the
  // COD fee, which the platform does not take a cut of. See src/data/payouts.ts.
  let goods = 0;
  if (live.length) {
    const { data: items } = await sb
      .from('order_items').select('order_id,price,qty')
      .in('order_id', live.map((o) => o.id));
    goods = (items ?? []).reduce((sum, it) => sum + Number(it.price) * Number(it.qty), 0);
  }

  const { data: settings } = await sb
    .from('platform_settings').select('commission_pct').limit(1).maybeSingle();
  const commissionPct = Number(settings?.commission_pct ?? 10);

  const sum = (rows, f = (r) => Number(r.total)) => rows.reduce((s, r) => s + f(r), 0);
  const gmv = sum(live);
  const cod = live.filter((o) => o.payment_status !== 'paid');
  const online = live.filter((o) => o.channel !== 'offline');

  // Things that need the owner's hand. Payouts are manual by decision, so they
  // are an action item every single day rather than a background process.
  const [boutiquesPending, adsPending, payoutsDue] = await Promise.all([
    sb.from('boutiques').select('id,name,created_at', { count: 'exact' }).eq('status', 'pending'),
    // Ads live in `ad_campaigns`; 'pending_review' is paid-and-awaiting-admin.
    sb.from('ad_campaigns').select('id', { count: 'exact', head: true }).eq('status', 'pending_review'),
    sb.from('orders').select('id,total', { count: 'exact' })
      .eq('status', 'delivered').eq('payment_status', 'paid').is('payout_id', null),
  ]);

  return {
    day: day.label,
    window: { from: day.from, to: day.to },
    orders: {
      count: live.length,
      prevCount: prevLive.length,
      cancelled: (orders ?? []).length - live.length,
      offline: live.length - online.length,
    },
    money: {
      gmv,
      prevGmv: sum(prevLive),
      goods,
      commissionPct,
      commission: goods * (commissionPct / 100),
      platformDiscount: sum(live, (o) => Number(o.platform_discount ?? 0)),
      codCount: cod.length,
      codValue: sum(cod),
    },
    actions: {
      boutiquesPending: boutiquesPending.count ?? 0,
      boutiqueNames: (boutiquesPending.data ?? []).slice(0, 5).map((b) => b.name),
      adsPending: adsPending.count ?? 0,
      payoutsDueCount: payoutsDue.count ?? 0,
      payoutsDueValue: sum(payoutsDue.data ?? []),
    },
  };
}

function renderHtml(d, brief) {
  const delta = (now, prev) => {
    if (prev === now) return '<span style="color:#6b7280">no change</span>';
    const up = now > prev;
    const pct = prev === 0 ? null : Math.round(((now - prev) / prev) * 100);
    return `<span style="color:${up ? '#047857' : '#b91c1c'}">${up ? '▲' : '▼'} ${
      pct === null ? 'from nil' : Math.abs(pct) + '%'} vs prior day</span>`;
  };
  const row = (k, v, note = '') =>
    `<tr><td style="padding:6px 0;color:#4b5563">${k}</td>` +
    `<td style="padding:6px 0;text-align:right;font-weight:600">${v}</td>` +
    `<td style="padding:6px 0 6px 12px;font-size:12px">${note}</td></tr>`;

  const a = d.actions;
  const actionItems = [
    a.boutiquesPending && `${a.boutiquesPending} boutique(s) awaiting verification${
      a.boutiqueNames.length ? ' — ' + a.boutiqueNames.join(', ') : ''}`,
    a.adsPending && `${a.adsPending} ad(s) pending approval`,
    a.payoutsDueCount && `${inr(a.payoutsDueValue)} across ${a.payoutsDueCount} delivered order(s) awaiting manual payout`,
  ].filter(Boolean);

  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:600px;margin:0 auto;color:#111827">
  <h1 style="font-size:18px;margin:0 0 2px">Agilam — daily report</h1>
  <p style="margin:0 0 20px;color:#6b7280;font-size:13px">${d.day}</p>

  ${brief ? `<div style="background:#f9fafb;border-left:3px solid #111827;padding:12px 16px;margin-bottom:22px;white-space:pre-wrap;font-size:14px;line-height:1.55">${
    brief.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</div>` : ''}

  <table style="width:100%;border-collapse:collapse;font-size:14px">
    ${row('Orders', d.orders.count, delta(d.orders.count, d.orders.prevCount))}
    ${row('GMV', inr(d.money.gmv), delta(d.money.gmv, d.money.prevGmv))}
    ${row('Goods value', inr(d.money.goods), 'excl. shipping &amp; COD fee')}
    ${row(`Commission (${d.money.commissionPct}%)`, inr(d.money.commission), 'on goods value')}
    ${d.money.platformDiscount ? row('Platform coupons', '−' + inr(d.money.platformDiscount), 'our cost') : ''}
    ${d.money.codCount ? row('COD receivable', inr(d.money.codValue), `${d.money.codCount} order(s) — sellers hold this cash`) : ''}
    ${d.orders.cancelled ? row('Cancelled', d.orders.cancelled, 'excluded above') : ''}
    ${d.orders.offline ? row('Offline/POS', d.orders.offline, 'walk-in, no commission') : ''}
  </table>

  <h2 style="font-size:14px;margin:24px 0 8px">Needs you</h2>
  ${actionItems.length
    ? `<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7">${
        actionItems.map((i) => `<li>${i}</li>`).join('')}</ul>`
    : '<p style="margin:0;font-size:14px;color:#047857">Nothing.</p>'}

  <p style="margin-top:26px;color:#9ca3af;font-size:11px">
    Figures cover ${d.day} 00:00–24:00 IST. Commission is calculated on goods value;
    settle payouts at /admin/payments.
  </p>
</div>`;
}

async function send(html, subject) {
  requireEnv('RESEND_API_KEY', 'REPORT_TO', 'REPORT_FROM');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.REPORT_FROM,
      to: process.env.REPORT_TO.split(',').map((s) => s.trim()),
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return res.json();
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };

/**
 * Two ways in, depending on who is running this.
 *
 * With REPORT_TOKEN set (how the cloud routine runs it) we call the
 * `daily_digest` RPC from migration 0060 using the ordinary PUBLIC anon key. The
 * token authorises exactly one thing — read these aggregates — so the cloud
 * environment never holds the service-role key, which would bypass RLS on every
 * table in the project.
 *
 * Without it, we read the tables directly with the service-role key. That path is
 * for running this on a trusted machine, and needs no migration.
 */
let digest;
if (!process.env.REPORT_TOKEN && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  // Neither path is configured. Say so explicitly rather than falling through to
  // the service-role branch and reporting SUPABASE_SERVICE_ROLE_KEY as "missing"
  // — that reads as an instruction to go and set it, which in a cloud sandbox is
  // exactly the wrong fix.
  console.error(
    'No credentials configured. Pick one path:\n' +
    '\n' +
    '  Cloud routine / any untrusted runner (preferred):\n' +
    '    REPORT_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY\n' +
    '    REPORT_TOKEN is what selects this path. It uses the public anon key plus\n' +
    '    the daily_digest RPC (migration 0060), which can read nothing else.\n' +
    '\n' +
    '  Trusted machine only:\n' +
    '    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY\n' +
    '    NEVER put the service-role key in a cloud environment — it bypasses RLS\n' +
    '    on every table in the project.',
  );
  process.exit(1);
}
if (process.env.REPORT_TOKEN) {
  requireEnv('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'REPORT_TOKEN');
  // Plain fetch rather than supabase-js on purpose: constructing a Supabase
  // client also constructs a RealtimeClient, which needs a native WebSocket and
  // therefore Node 22+. This path has no use for realtime, and going straight to
  // PostgREST keeps the report runnable on any Node with fetch.
  const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/daily_digest`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_token: process.env.REPORT_TOKEN }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`daily_digest RPC failed (${res.status}): ${body?.message ?? JSON.stringify(body)}`);
  digest = body;
} else {
  requireEnv('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  digest = await buildDigest(sb);
}

if (flag('--send')) {
  const briefPath = value('--brief');
  const brief = briefPath ? readFileSync(briefPath, 'utf8').trim() : '';
  const subject = `Agilam — ${digest.orders.count} orders, ${inr(digest.money.gmv)} — ${digest.day}`;
  const out = await send(renderHtml(digest, brief), subject);
  console.log(`Sent to ${process.env.REPORT_TO} (id ${out.id ?? 'n/a'})`);
} else {
  console.log(JSON.stringify(digest, null, 2));
}
