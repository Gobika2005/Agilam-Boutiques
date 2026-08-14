/**
 * Daily owner report — yesterday's trading, mailed as HTML.
 *
 * Runs as a plain Node script, NOT a Vercel serverless function. That is
 * deliberate: this project is on Vercel's Hobby plan, which caps both cron jobs
 * and serverless functions, and `api/` already sits at 12 routable functions
 * with the single cron slot spent on the ads lifecycle sweep. The schedule
 * therefore lives outside Vercel — a Windows Scheduled Task invoking
 * scripts/daily-report.cmd.
 *
 * All figures come from the `daily_digest` RPC (migrations 0060 + 0062), called
 * with the PUBLIC anon key plus a shared token. There is deliberately no
 * second, direct-table implementation: two copies of the same arithmetic drift,
 * which is the failure this codebase already guards against between
 * src/lib/pricing.ts and api/_pricing.js. The RPC is the only source of truth,
 * and it is also why the service-role key is never needed here.
 *
 * Two modes:
 *   node scripts/daily-report.mjs --json
 *   node scripts/daily-report.mjs --send [--brief brief.txt]
 *
 * Env: SUPABASE_URL, SUPABASE_ANON_KEY, REPORT_TOKEN
 *      RESEND_API_KEY, REPORT_TO, REPORT_FROM   (--send only)
 * A repo .env is loaded when present; real environment variables always win.
 */
import { readFileSync, existsSync } from 'node:fs';

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
  // The app stores these VITE_-prefixed; both are public and ship in the
  // browser bundle anyway. Nothing aliases the service-role key.
  process.env.SUPABASE_URL ??= process.env.VITE_SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY ??= process.env.VITE_SUPABASE_ANON_KEY;
}
loadDotEnv();

const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`Missing required env: ${missing.join(', ')}`);
    process.exit(1);
  }
}

async function fetchDigest() {
  requireEnv('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'REPORT_TOKEN');
  // Straight to PostgREST rather than through supabase-js: constructing a
  // Supabase client also constructs a RealtimeClient, which needs a native
  // WebSocket and therefore Node 22+. Nothing here wants realtime.
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
  if (!res.ok) {
    throw new Error(`daily_digest failed (${res.status}): ${body?.message ?? JSON.stringify(body)}`);
  }
  return body;
}

// ── rendering ────────────────────────────────────────────────────────────────
// Email HTML, so: tables not flexbox, inline styles only, no external assets.

const C = {
  ink: '#111827', mute: '#6b7280', line: '#e5e7eb',
  good: '#047857', bad: '#b91c1c', soft: '#f9fafb',
};

function delta(now, prev) {
  now = Number(now) || 0; prev = Number(prev) || 0;
  if (now === prev) return `<span style="color:${C.mute}">level</span>`;
  const up = now > prev;
  const pct = prev === 0 ? null : Math.round(((now - prev) / prev) * 100);
  return `<span style="color:${up ? C.good : C.bad}">${up ? '▲' : '▼'} ${
    pct === null ? 'from nil' : Math.abs(pct) + '%'}</span>`;
}

function section(title, inner) {
  return `<h2 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;
    color:${C.mute};margin:26px 0 8px;border-bottom:1px solid ${C.line};padding-bottom:5px">${title}</h2>${inner}`;
}

function kv(rows) {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows.filter(Boolean).map(
    ([k, v, note]) => `<tr>
      <td style="padding:5px 0;color:#4b5563">${k}</td>
      <td style="padding:5px 0;text-align:right;font-weight:600;white-space:nowrap">${v}</td>
      <td style="padding:5px 0 5px 12px;font-size:12px;white-space:nowrap">${note ?? ''}</td>
    </tr>`).join('')}</table>`;
}

/** Horizontal bars: the only chart shape that survives every email client. */
function trendTable(trend) {
  if (!trend?.length) return '';
  const max = Math.max(...trend.map((t) => Number(t.gmv) || 0), 1);
  return `<table style="width:100%;border-collapse:collapse;font-size:13px">${trend.map((t) => {
    const gmv = Number(t.gmv) || 0;
    const pct = Math.round((gmv / max) * 100);
    return `<tr>
      <td style="padding:3px 0;color:${C.mute};white-space:nowrap;width:62px">${esc(t.date)}</td>
      <td style="padding:3px 8px;width:100%">
        <div style="background:${gmv ? C.ink : C.line};height:8px;border-radius:4px;width:${Math.max(pct, 2)}%"></div>
      </td>
      <td style="padding:3px 0;text-align:right;white-space:nowrap">${t.orders} ord</td>
      <td style="padding:3px 0 3px 10px;text-align:right;white-space:nowrap;font-weight:600">${inr(gmv)}</td>
    </tr>`;
  }).join('')}</table>`;
}

function listTable(rows, cols) {
  if (!rows?.length) return `<p style="margin:0;font-size:13px;color:${C.mute}">Nothing yesterday.</p>`;
  return `<table style="width:100%;border-collapse:collapse;font-size:13px">${rows.map((r) => `<tr>
    <td style="padding:4px 0">${esc(r[cols[0]])}</td>
    <td style="padding:4px 8px;text-align:right;color:${C.mute};white-space:nowrap">${r[cols[1]]}</td>
    <td style="padding:4px 0;text-align:right;font-weight:600;white-space:nowrap">${inr(r[cols[2]])}</td>
  </tr>`).join('')}</table>`;
}

function renderHtml(d, brief) {
  const m = d.money ?? {}, o = d.orders ?? {}, a = d.actions ?? {}, g = d.growth ?? {}, p = d.pipeline ?? {};

  const actionItems = [
    a.boutiquesPending && `${a.boutiquesPending} boutique(s) awaiting verification${
      a.boutiqueNames?.length ? ' — ' + a.boutiqueNames.map(esc).join(', ') : ''}`,
    a.adsPending && `${a.adsPending} ad(s) pending review`,
    a.payoutsDueCount && `${inr(a.payoutsDueValue)} across ${a.payoutsDueCount} delivered order(s) awaiting manual payout`,
    a.outOfStock && `${a.outOfStock} product(s) out of stock — listed but unbuyable`,
    a.lowStock && `${a.lowStock} product(s) down to 3 or fewer`,
  ].filter(Boolean);

  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:620px;margin:0 auto;color:${C.ink}">
  <h1 style="font-size:19px;margin:0 0 2px">MangaiMart — daily report</h1>
  <p style="margin:0 0 20px;color:${C.mute};font-size:13px">${esc(d.day)}</p>

  ${brief ? `<div style="background:${C.soft};border-left:3px solid ${C.ink};padding:12px 16px;
    margin-bottom:20px;white-space:pre-wrap;font-size:14px;line-height:1.55">${esc(brief)}</div>` : ''}

  ${section('Yesterday', kv([
    ['Orders', o.count ?? 0, delta(o.count, o.prevCount)],
    ['GMV', inr(m.gmv), delta(m.gmv, m.prevGmv)],
    ['Goods value', inr(m.goods), 'excl. shipping'],
    [`Commission (${m.commissionPct ?? 10}%)`, inr(m.commission), 'on goods value'],
    ['Average order', inr(m.aov)],
    (o.units ? ['Units sold', o.units] : null),
    (m.prepaidCount ? ['Prepaid', `${m.prepaidCount} · ${inr(m.prepaidValue)}`] : null),
    // Cash on delivery was withdrawn (migration 0085); this line only appears if
    // a legacy cash order is still unsettled, and is expected to stay absent.
    (m.codCount ? ['COD receivable (legacy)', `${m.codCount} · ${inr(m.codValue)}`, 'sellers hold this cash'] : null),
    (Number(m.platformDiscount) ? ['Platform coupons', '−' + inr(m.platformDiscount), 'our cost'] : null),
    (o.cancelled ? ['Cancelled', o.cancelled, 'excluded above'] : null),
    (o.offline ? ['Offline / POS', o.offline, 'walk-in, no commission'] : null),
  ]))}

  ${section('Last 7 days', trendTable(d.trend))}

  ${section('Pipeline', kv([
    ['Pending', p.pending ?? 0],
    ['Shipped', p.shipped ?? 0],
    ['Delivered', p.delivered ?? 0],
  ]))}

  ${section('Top boutiques', listTable(d.boutiques, ['name', 'orders', 'gmv']))}
  ${section('Top products', listTable(d.products, ['title', 'qty', 'revenue']))}

  ${section('Growth', kv([
    ['New buyers', g.newBuyers ?? 0],
    ['New boutiques', g.newSellers ?? 0],
    ['Products listed', g.newProducts ?? 0],
    ['Reviews posted', g.newReviews ?? 0],
  ]))}

  ${section('Needs you', actionItems.length
    ? `<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7">${
        actionItems.map((i) => `<li>${i}</li>`).join('')}</ul>`
    : `<p style="margin:0;font-size:14px;color:${C.good}">Nothing.</p>`)}

  <p style="margin-top:26px;color:#9ca3af;font-size:11px;line-height:1.5">
    Covers ${esc(d.day)}, 00:00–24:00 IST. Cancelled orders are excluded from every money figure.
    Commission is calculated on goods value, not order totals. Settle payouts at /admin/payments.
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
const value = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };

const digest = await fetchDigest();

if (args.includes('--send')) {
  const briefPath = value('--brief');
  const brief = briefPath && existsSync(briefPath) ? readFileSync(briefPath, 'utf8').trim() : '';
  const subject = `MangaiMart — ${digest.orders?.count ?? 0} orders, ${inr(digest.money?.gmv)} — ${digest.day}`;
  const out = await send(renderHtml(digest, brief), subject);
  console.log(`Sent to ${process.env.REPORT_TO} (id ${out.id ?? 'n/a'})`);
} else if (args.includes('--html')) {
  console.log(renderHtml(digest, ''));
} else {
  console.log(JSON.stringify(digest, null, 2));
}
