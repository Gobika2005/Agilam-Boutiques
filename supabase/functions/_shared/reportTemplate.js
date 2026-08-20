/**
 * The daily admin report — one template, two senders.
 *
 * WHY THIS FILE IS PLAIN .js IN _shared/
 * The report is sent by a Supabase Edge Function (Deno) with a Node script as
 * the fallback sender. Two renderers would drift, and a drifting report is a
 * report nobody trusts — the same failure this codebase already guards against
 * between src/lib/pricing.ts and api/_pricing.js. So there is exactly one
 * renderer, written in dependency-free ESM that both runtimes import verbatim:
 * `.js` rather than `.ts` because Node imports it without a type-stripping flag,
 * and Deno does not care either way. Nothing here touches Deno.*, process.*,
 * fetch or the filesystem — it takes data and returns a string.
 *
 * WHY IT LOOKS LIKE THIS
 * It is read once a day, on a phone, before coffee. So it is ordered by what
 * the reader has to decide, not by what is easiest to query:
 *
 *   1. Is anything broken?        — the status banner, first screen, colour-coded
 *   2. What do I have to do?      — the action queue, above the numbers
 *   3. How did yesterday go?      — KPI tiles + 7-day trend
 *   4. How big is the shop now?   — marketplace state
 *   5. Detail                     — pipeline, top boutiques, top products, ops
 *
 * Colours are literal hex, and that is correct: the `--ag-*` token rule exists
 * because the app has a dark theme, and a mail client has never seen our
 * stylesheet and cannot resolve a CSS variable. These are the light-theme brand
 * values from api/_email.js.
 *
 * Layout is tables with inline styles. Not a stylistic choice — Outlook renders
 * neither flexbox nor grid, and Gmail strips <style> blocks for non-Gmail
 * accounts, so the media query at the top is a refinement and every value it
 * overrides is already correct on its own.
 */

// ── palette ──────────────────────────────────────────────────────────────────
const C = {
  page: '#F6F1ED',
  card: '#FFFFFF',
  cream: '#FFF8F4',
  line: '#EADCE3',
  ink: '#241019',
  body: '#4B3840',
  mute: '#775D66',
  faint: '#9A868E',
  brand: '#B02454',
  goodInk: '#0E6B4B', goodBg: '#E8F6EF', goodLine: '#BFE5D3',
  warnInk: '#8A5A00', warnBg: '#FDF3E2', warnLine: '#F0DCB4',
  badInk: '#A81230', badBg: '#FCECEE', badLine: '#F2CBD2',
};

const SANS = "Arial,Helvetica,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

/**
 * The wordmark, pinned to the production origin — not derived from APP_URL,
 * which is localhost in a dev environment and a broken image in every inbox.
 * PNG rather than the smaller WebP beside it in /public: Outlook on Windows
 * cannot decode WebP and would fall back to the alt text.
 *
 * The `<img>` that uses this carries font styling of its own. That is not
 * decoration for the image — it styles the ALT TEXT, which is what a reader
 * actually sees for the first few seconds while a client holds remote images
 * back, and permanently if they never allow them. Unstyled, that fallback is
 * 11px black serif and reads as a defect; styled, the masthead still says
 * MangaiMart in brand pink. Width and height are also set as HTML attributes,
 * because Outlook ignores the CSS and would otherwise reserve no space.
 */
const LOGO = 'https://mangaimart.com/mangaimart-wordmark.png';

// ── primitives ───────────────────────────────────────────────────────────────

export function inr(n) {
  return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
}

/** ₹48,200 → ₹48.2k. Tiles have one line and about nine characters of room. */
function inrShort(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 10000000) return '₹' + (v / 10000000).toFixed(v % 10000000 === 0 ? 0 : 1) + 'cr';
  if (Math.abs(v) >= 100000) return '₹' + (v / 100000).toFixed(v % 100000 === 0 ? 0 : 1) + 'L';
  if (Math.abs(v) >= 10000) return '₹' + (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
  return inr(v);
}

/**
 * Escape for HTML. Boutique names and product titles are seller-supplied — a
 * product called `</td><script>` must not be able to restructure the message.
 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const num = (n) => Number(n) || 0;
/** null/undefined means "not measured", which must not render as a zero. */
const known = (v) => v !== null && v !== undefined;

// ── health verdict ───────────────────────────────────────────────────────────

/**
 * Turn the digest's `status` block plus the live HTTP probes into one verdict.
 *
 * Split into its own export because the subject line needs the same answer as
 * the banner, and an inbox that says "all normal" above a red page is worse
 * than no report at all.
 *
 * Severity rules — `down` is reserved for "buyers cannot shop or cannot pay",
 * because an alert that cries wolf gets filtered. Everything that needs a human
 * but is not costing sales this minute is `warn`.
 */
export function assess(digest, probes) {
  const s = digest?.status ?? {};
  const bad = [];
  const warn = [];

  for (const p of probes ?? []) {
    if (p.ok === false) (p.critical ? bad : warn).push(p.detail || `${p.name} is failing`);
  }

  if (s.maintenanceMode) bad.push('Maintenance mode is ON — the storefront is closed to buyers');
  if (num(s.unpaidOrders) > 0) {
    bad.push(`${num(s.unpaidOrders)} order(s) written without payment in the last 7 days`);
  }
  if (num(s.stuckOrders) > 0) {
    warn.push(`${num(s.stuckOrders)} paid order(s) untouched for over 3 days`);
  }
  if (num(s.waFailed) > 0) {
    warn.push(`${num(s.waFailed)} WhatsApp message(s) failed in the last 48h`);
  }
  if (num(s.waQueued) > 25) {
    warn.push(`${num(s.waQueued)} WhatsApp messages queued — the drain may be stalled`);
  }
  if (known(s.hoursSinceOrder) && num(s.hoursSinceOrder) >= 72) {
    warn.push(`No order in ${num(s.hoursSinceOrder)} hours`);
  }

  const level = bad.length ? 'down' : warn.length ? 'warn' : 'ok';
  return {
    level,
    reasons: bad.concat(warn),
    label: level === 'ok' ? 'All systems normal'
      : level === 'warn' ? 'Running, needs attention'
        : 'Needs action now',
  };
}

/** The action queue, as flat lines. Shared by the body and the subject count. */
export function actionLines(digest, appUrl, adminUrl) {
  const a = digest?.actions ?? {};
  const link = (path, label) => (adminUrl ? `<a href="${esc(adminUrl + path)}" style="color:${C.brand};text-decoration:underline;">${label}</a>` : label);

  return [
    num(a.boutiquesPending) && {
      text: `${num(a.boutiquesPending)} boutique(s) awaiting verification` +
        (a.boutiqueNames?.length ? ` — ${a.boutiqueNames.map(esc).join(', ')}` : ''),
      cta: link('/boutiques', 'Review'),
    },
    num(a.payoutsDueCount) && {
      text: `${inr(a.payoutsDueValue)} across ${num(a.payoutsDueCount)} delivered order(s) awaiting payout`,
      cta: link('/payouts', 'Settle'),
    },
    num(a.refundsDue) && {
      text: `${num(a.refundsDue)} approved return(s) awaiting refund`,
      cta: link('/refunds', 'Refund'),
    },
    num(a.returnsPending) && {
      text: `${num(a.returnsPending)} return request(s) not yet answered`,
      cta: link('/orders', 'Open'),
    },
    num(a.adsPending) && {
      text: `${num(a.adsPending)} paid ad(s) pending review`,
      cta: link('/ads', 'Review'),
    },
    num(a.productsPending) && {
      text: `${num(a.productsPending)} product(s) awaiting moderation`,
      cta: link('/products', 'Review'),
    },
    num(a.outOfStock) && {
      text: `${num(a.outOfStock)} product(s) out of stock — listed but unbuyable`,
      cta: link('/products', 'Open'),
    },
    num(a.lowStock) && {
      text: `${num(a.lowStock)} product(s) down to 3 or fewer`,
      cta: '',
    },
  ].filter(Boolean);
}

// ── building blocks ──────────────────────────────────────────────────────────

function delta(now, prev) {
  const a = num(now), b = num(prev);
  if (a === b) return `<span style="color:${C.faint};">level</span>`;
  const up = a > b;
  const pct = b === 0 ? null : Math.round(((a - b) / b) * 100);
  const colour = up ? C.goodInk : C.badInk;
  return `<span style="color:${colour};">${up ? '&#9650;' : '&#9660;'} ${pct === null ? 'from nil' : Math.abs(pct) + '%'}</span>`;
}

/**
 * A row of KPI tiles.
 *
 * Each tile is a <td>, not a floated div: Outlook renders neither flex nor
 * inline-block reliably, and a table row is the one construct guaranteed to
 * keep three boxes side by side in every client.
 *
 * The gutter is padding on the inner faces only — no negative margin, which
 * Outlook drops — so the outer edges of the row line up exactly with the full
 * width panels above and below it. `tiles` are `[label, value, foot]`.
 */
function tileRow(tiles) {
  const cells = tiles.map(([label, value, foot], i) => {
    const first = i === 0, last = i === tiles.length - 1;
    const pad = `padding:0 ${last ? '0' : '4px'} 0 ${first ? '0' : '4px'};`;
    return `<td width="${Math.floor(100 / tiles.length)}%" class="ag-tile" valign="top" style="${pad}">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;">
        <tr><td style="padding:14px 8px;text-align:center;">
          <div class="ag-kpi" style="font-family:${SERIF};font-size:24px;line-height:1.1;color:${C.ink};font-weight:700;white-space:nowrap;">${value}</div>
          <div class="ag-kpi-label" style="font-family:${SANS};font-size:10.5px;line-height:1.4;color:${C.mute};text-transform:uppercase;letter-spacing:.07em;padding-top:6px;">${esc(label)}</div>
          ${foot ? `<div style="font-family:${SANS};font-size:11px;line-height:1.4;padding-top:5px;">${foot}</div>` : ''}
        </td></tr>
      </table>
    </td>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:10px;"><tr>${cells}</tr></table>`;
}

function heading(text) {
  return `<div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${C.faint};padding:22px 0 8px;">${esc(text)}</div>`;
}

/** A bordered white panel — the unit every non-tile section sits in. */
function panel(inner, pad = '14px 16px') {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.card};border:1px solid ${C.line};border-radius:12px;">
    <tr><td style="padding:${pad};">${inner}</td></tr>
  </table>`;
}

/** label → value rows. `values` are pre-escaped HTML, labels are not. */
function statRows(rows) {
  const body = rows.filter(Boolean).map(([label, value, note], i) => `<tr>
    <td style="padding:${i ? '8px' : '0'} 0 8px;border-top:${i ? `1px solid ${C.line}` : '0'};font-family:${SANS};font-size:13px;color:${C.body};">${esc(label)}</td>
    <td align="right" style="padding:${i ? '8px' : '0'} 0 8px;border-top:${i ? `1px solid ${C.line}` : '0'};font-family:${SANS};font-size:13px;color:${C.ink};font-weight:700;white-space:nowrap;">${value}</td>
    ${note !== undefined ? `<td align="right" style="padding:${i ? '8px' : '0'} 0 8px 10px;border-top:${i ? `1px solid ${C.line}` : '0'};font-family:${SANS};font-size:11.5px;white-space:nowrap;">${note ?? ''}</td>` : ''}
  </tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>`;
}

/**
 * The 7-day trend, as horizontal bars.
 *
 * Bars built from a background colour on a <td> of a given width percentage —
 * the only chart shape that survives every mail client, because it needs no
 * image, no SVG and no external request. Yesterday is highlighted; a zero day
 * still gets a hairline so the row does not read as missing data.
 */
function trendPanel(trend) {
  if (!trend?.length) return '';
  const max = Math.max(...trend.map((t) => num(t.gmv)), 1);
  const rows = trend.map((t, i) => {
    const last = i === trend.length - 1;
    const gmv = num(t.gmv);
    const pct = Math.max(Math.round((gmv / max) * 100), gmv > 0 ? 4 : 1);
    return `<tr>
      <td width="52" style="padding:4px 0;font-family:${SANS};font-size:11.5px;color:${last ? C.ink : C.mute};font-weight:${last ? 700 : 400};white-space:nowrap;">${esc(t.date)}</td>
      <td style="padding:4px 8px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td width="${pct}%" style="background:${gmv > 0 ? (last ? C.brand : '#E3B9C9') : C.line};height:9px;line-height:9px;border-radius:5px;font-size:0;">&nbsp;</td>
          <td>&nbsp;</td>
        </tr></table>
      </td>
      <td width="46" align="right" style="padding:4px 0;font-family:${SANS};font-size:11.5px;color:${C.mute};white-space:nowrap;">${num(t.orders)} ord</td>
      <td width="62" align="right" style="padding:4px 0 4px 8px;font-family:${SANS};font-size:12px;color:${C.ink};font-weight:700;white-space:nowrap;">${inrShort(gmv)}</td>
    </tr>`;
  }).join('');
  return panel(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`);
}

function rankTable(rows, cols, emptyText) {
  if (!rows?.length) {
    return panel(`<p style="margin:0;font-family:${SANS};font-size:12.5px;color:${C.faint};">${esc(emptyText)}</p>`);
  }
  const body = rows.map((r, i) => `<tr>
    <td style="padding:${i ? '7px' : '0'} 0 7px;border-top:${i ? `1px solid ${C.line}` : '0'};font-family:${SANS};font-size:13px;color:${C.body};">${esc(r[cols[0]])}</td>
    <td align="right" style="padding:${i ? '7px' : '0'} 8px 7px;border-top:${i ? `1px solid ${C.line}` : '0'};font-family:${SANS};font-size:11.5px;color:${C.faint};white-space:nowrap;">${num(r[cols[1]])}</td>
    <td align="right" style="padding:${i ? '7px' : '0'} 0 7px;border-top:${i ? `1px solid ${C.line}` : '0'};font-family:${SANS};font-size:13px;color:${C.ink};font-weight:700;white-space:nowrap;">${inr(r[cols[2]])}</td>
  </tr>`).join('');
  return panel(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>`);
}

// ── the page ─────────────────────────────────────────────────────────────────

const HEAD_STYLE = `<style>
  body, table, td, p, h1, li, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; text-size-adjust:100%; }
  @media only screen and (max-width:600px) {
    .ag-pad  { padding-left:14px !important; padding-right:14px !important; }
    .ag-logo { width:150px !important; }
    .ag-kpi  { font-size:19px !important; }
    .ag-kpi-label { font-size:9px !important; letter-spacing:.04em !important; }
    .ag-tile { padding-left:2px !important; padding-right:2px !important; }
    .ag-h1   { font-size:18px !important; }
  }
</style>`;

/**
 * @param {object}   opts
 * @param {object}   opts.digest   daily_digest() output
 * @param {object[]} opts.probes   [{ name, ok, detail, critical }] live HTTP checks
 * @param {string}   opts.brief    optional commentary, plain text, shown up top
 * @param {string}   opts.appUrl   storefront origin
 * @param {string}   opts.adminUrl admin console origin+path, omitted if unknown
 * @param {string}   opts.source   'cloud' | 'local' — footer provenance
 */
export function renderReport({ digest, probes = [], brief = '', appUrl = 'https://mangaimart.com', adminUrl = '', source = '' }) {
  const d = digest ?? {};
  const o = d.orders ?? {}, m = d.money ?? {}, g = d.growth ?? {},
    p = d.pipeline ?? {}, s = d.status ?? {}, cat = d.catalogue ?? {};

  const verdict = assess(d, probes);
  const tone = verdict.level === 'ok'
    ? { ink: C.goodInk, bg: C.goodBg, line: C.goodLine, dot: '#12A06A' }
    : verdict.level === 'warn'
      ? { ink: C.warnInk, bg: C.warnBg, line: C.warnLine, dot: '#E0A02A' }
      : { ink: C.badInk, bg: C.badBg, line: C.badLine, dot: '#D8283F' };

  const actions = actionLines(d, appUrl, adminUrl);

  // The banner. Reasons are listed in full rather than summarised: "2 issues"
  // forces a click into the console to find out what they are, which is exactly
  // the friction this mail exists to remove.
  const banner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${tone.bg};border:1px solid ${tone.line};border-radius:12px;">
    <tr><td style="padding:13px 15px;">
      <div style="font-family:${SANS};font-size:14px;font-weight:700;color:${tone.ink};">
        <span style="color:${tone.dot};font-size:15px;">&#9679;</span>&nbsp; ${esc(verdict.label)}
      </div>
      ${verdict.reasons.length ? `<div style="font-family:${SANS};font-size:12.5px;line-height:1.6;color:${tone.ink};padding-top:6px;">
        ${verdict.reasons.map((r) => `&bull; ${esc(r)}`).join('<br />')}
      </div>` : `<div style="font-family:${SANS};font-size:12.5px;line-height:1.55;color:${tone.ink};padding-top:4px;">
        Storefront and checkout responding, no stuck orders, no failed notifications.
      </div>`}
    </td></tr>
  </table>`;

  const actionPanel = actions.length
    ? panel(actions.map((a, i) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="padding:${i ? '9px' : '0'} 0 9px;border-top:${i ? `1px solid ${C.line}` : '0'};font-family:${SANS};font-size:13px;line-height:1.55;color:${C.body};">${a.text}</td>
        ${a.cta ? `<td align="right" valign="top" style="padding:${i ? '9px' : '0'} 0 9px 10px;border-top:${i ? `1px solid ${C.line}` : '0'};font-family:${SANS};font-size:12px;font-weight:700;white-space:nowrap;">${a.cta}</td>` : ''}
      </tr></table>`).join(''))
    : panel(`<p style="margin:0;font-family:${SANS};font-size:13px;color:${C.goodInk};font-weight:700;">Nothing waiting on you. Queue is clear.</p>`);

  // Ops detail. Deliberately last and deliberately dull — it is the section you
  // read only when the banner sent you looking.
  const opsRows = [
    ...(probes ?? []).map((pr) => [
      pr.name,
      pr.ok === false
        ? `<span style="color:${C.badInk};">Failing</span>`
        : `<span style="color:${C.goodInk};">OK</span>`,
      `<span style="color:${C.faint};">${esc(pr.detail ?? '')}</span>`,
    ]),
    ['Maintenance mode', s.maintenanceMode
      ? `<span style="color:${C.badInk};">ON</span>`
      : `<span style="color:${C.goodInk};">Off</span>`, ''],
    ['Orders so far today', String(num(s.ordersToday)), ''],
    ['Last order', s.lastOrderAt
      ? `${esc(s.lastOrderAt)}`
      : '—', known(s.hoursSinceOrder) ? `<span style="color:${C.faint};">${num(s.hoursSinceOrder)}h ago</span>` : ''],
    ['Paid orders stuck &gt; 3 days', num(s.stuckOrders)
      ? `<span style="color:${C.badInk};">${num(s.stuckOrders)}</span>` : '0', ''],
    ['Orders without payment (7d)', num(s.unpaidOrders)
      ? `<span style="color:${C.badInk};">${num(s.unpaidOrders)}</span>` : '0',
      '<span style="color:' + C.faint + ';">expect 0</span>'],
    known(s.waQueued) ? ['WhatsApp queued / failed 48h',
      `${num(s.waQueued)} / ${num(s.waFailed) ? `<span style="color:${C.badInk};">${num(s.waFailed)}</span>` : '0'}`, ''] : null,
  ];

  const body = `
  ${banner}

  ${brief ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;background:${C.cream};border:1px solid ${C.line};border-left:3px solid ${C.brand};border-radius:10px;">
    <tr><td style="padding:12px 15px;font-family:${SANS};font-size:13px;line-height:1.6;color:${C.body};white-space:pre-wrap;">${esc(brief)}</td></tr>
  </table>` : ''}

  ${heading(`Needs you${actions.length ? ` (${actions.length})` : ''}`)}
  ${actionPanel}

  ${heading('Yesterday')}
  ${tileRow([
    ['Orders', String(num(o.count)), delta(o.count, o.prevCount)],
    ['GMV', inrShort(m.gmv), delta(m.gmv, m.prevGmv)],
    [`Commission ${num(m.commissionPct) || 10}%`, inrShort(m.commission), 'on goods value'],
  ])}
  ${tileRow([
    ['Avg order', inrShort(m.aov), ''],
    ['Units sold', String(num(o.units)), ''],
    ['New buyers', String(num(g.newBuyers)), ''],
  ])}
  ${panel(statRows([
    ['Goods value', inr(m.goods), '<span style="color:' + C.faint + ';">excl. delivery</span>'],
    num(m.platformDiscount) ? ['Platform coupons', '&minus;' + inr(m.platformDiscount), '<span style="color:' + C.faint + ';">our cost</span>'] : null,
    num(o.cancelled) ? ['Cancelled', String(num(o.cancelled)), '<span style="color:' + C.faint + ';">excluded above</span>'] : null,
    num(o.offline) ? ['Offline / POS', String(num(o.offline)), '<span style="color:' + C.faint + ';">no commission</span>'] : null,
    // Cash on delivery was withdrawn in 0085. This line appears only if a legacy
    // cash order is still unsettled and is expected to stay absent forever.
    num(m.codCount) ? ['Unpaid (legacy COD)', `${num(m.codCount)} &middot; ${inr(m.codValue)}`, ''] : null,
    ['Pipeline', `${num(p.pending)} pending &middot; ${num(p.shipped)} shipped &middot; ${num(p.delivered)} delivered`, ''],
  ]))}

  ${heading('Last 7 days')}
  ${trendPanel(d.trend)}

  ${heading('Marketplace right now')}
  ${tileRow([
    ['Live products', String(num(cat.liveProducts)), ''],
    ['Live boutiques', String(num(cat.boutiquesLive)), num(cat.boutiquesPending) ? `+${num(cat.boutiquesPending)} pending` : ''],
    ['Buyers', String(num(cat.buyers)), num(g.newBuyers) ? `+${num(g.newBuyers)} yesterday` : ''],
  ])}
  ${panel(statRows([
    ['Out of stock', num(cat.outOfStock)
      ? `<span style="color:${C.badInk};">${num(cat.outOfStock)}</span>` : '0', ''],
    ['Low stock (&le;3)', String(num(cat.lowStock)), ''],
    ['Hidden / rejected listings', String(num(cat.hiddenProducts)), ''],
    known(cat.adsLive) ? ['Ads running', String(num(cat.adsLive)), ''] : null,
    ['Listed yesterday', `${num(g.newProducts)} product(s), ${num(g.newSellers)} boutique(s)`, ''],
    ['Reviews yesterday', String(num(g.newReviews)), ''],
  ]))}

  ${heading('Top boutiques yesterday')}
  ${rankTable(d.boutiques, ['name', 'orders', 'gmv'], 'No orders yesterday.')}

  ${heading('Top products yesterday')}
  ${rankTable(d.products, ['title', 'qty', 'revenue'], 'No items sold yesterday.')}

  ${heading('System detail')}
  ${panel(statRows(opsRows))}
  `;

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>MangaiMart daily report — ${esc(d.day ?? '')}</title>
${HEAD_STYLE}</head>
<body style="margin:0;padding:0;background:${C.page};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};padding:20px 10px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">

    <tr><td align="center" style="background:${C.cream};border:1px solid ${C.line};border-radius:14px;padding:20px 20px 16px;">
      <a href="${esc(appUrl)}" style="text-decoration:none;">
        <img src="${LOGO}" width="170" height="68" alt="MangaiMart" class="ag-logo"
             style="display:block;margin:0 auto 10px;width:170px;max-width:60%;height:auto;border:0;outline:none;font-family:${SERIF};font-size:22px;font-weight:700;color:${C.brand};text-decoration:none;" />
      </a>
      <h1 class="ag-h1" style="margin:0;font-family:${SERIF};font-size:20px;line-height:1.3;color:${C.ink};font-weight:700;">Daily report</h1>
      <p style="margin:4px 0 0;font-family:${SANS};font-size:12.5px;color:${C.mute};">${esc(d.day ?? '')}</p>
    </td></tr>

    <tr><td class="ag-pad" style="padding:16px 0 0;">${body}</td></tr>

    <tr><td align="center" class="ag-pad" style="padding:26px 8px 10px;">
      <p style="margin:0 0 8px;font-family:${SANS};font-size:11px;line-height:1.65;color:${C.faint};">
        Covers ${esc(d.day ?? '')}, 00:00&ndash;24:00 IST. Cancelled orders are excluded from every money figure.
        Commission is calculated on goods value, not order totals. Status figures are as of ${esc(d.generatedAt ?? 'send time')}.
      </p>
      <p style="margin:0;font-family:${SANS};font-size:11px;line-height:1.65;color:${C.faint};">
        Sent to every active admin account${source ? ` &middot; ${esc(source)}` : ''}.
        To stop receiving it, remove the admin role for that account.
      </p>
    </td></tr>

  </table>
</td></tr>
</table>
</body></html>`;
}

/**
 * Subject line.
 *
 * Front-loaded with the verdict, because on a phone the subject is often the
 * whole report: a quiet morning should be answerable without opening anything.
 */
export function subjectFor(digest, probes) {
  const d = digest ?? {};
  const v = assess(d, probes);
  const flag = v.level === 'ok' ? '' : v.level === 'warn' ? '⚠ ' : '🔴 ';
  const orders = num(d.orders?.count);
  const todo = actionLines(d, '', '').length;
  const tail = todo ? ` · ${todo} to action` : '';
  return `${flag}MangaiMart — ${orders} order${orders === 1 ? '' : 's'}, ${inr(d.money?.gmv)}${tail} — ${d.day ?? ''}`;
}

/** Plain-text alternative. Some clients show it, and spam filters like seeing it. */
export function renderText(digest, probes) {
  const d = digest ?? {};
  const v = assess(d, probes);
  const o = d.orders ?? {}, m = d.money ?? {}, cat = d.catalogue ?? {};
  const lines = [
    `MangaiMart daily report — ${d.day ?? ''}`,
    '',
    `STATUS: ${v.label}`,
    ...v.reasons.map((r) => `  - ${r}`),
    '',
    `Orders ${num(o.count)} | GMV ${inr(m.gmv)} | Commission ${inr(m.commission)} | AOV ${inr(m.aov)}`,
    `Live products ${num(cat.liveProducts)} | Live boutiques ${num(cat.boutiquesLive)} | Buyers ${num(cat.buyers)}`,
    '',
    'NEEDS YOU:',
    ...(actionLines(d, '', '').map((a) => `  - ${a.text.replace(/<[^>]+>/g, '')}`)),
  ];
  if (!actionLines(d, '', '').length) lines.push('  - nothing');
  return lines.join('\n');
}
