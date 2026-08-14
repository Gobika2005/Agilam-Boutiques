/**
 * Email a seller their payout advice — the itemised statement for money that
 * has just been transferred to them.
 *
 * WHY THIS IS A SUPABASE EDGE FUNCTION AND NOT `api/`
 * `api/` holds exactly 12 routes, which is the Vercel Hobby ceiling; a
 * thirteenth fails the deploy outright. The same escape hatch the Shiprocket
 * booking took. `api/_email.js` cannot simply be imported here either — it reads
 * `process.env`, which does not exist in Deno — so the Resend call and the mail
 * shell are reimplemented below. They are deliberately kept visually identical
 * to `layout()` in that file; if the brand shell changes, change both.
 *
 * WHO MAY CALL IT
 * Admins only, checked by calling `is_admin()` with the CALLER'S OWN JWT rather
 * than trusting anything in the body. A seller who forged a payout id would be
 * asking us to email a statement to whoever owns that boutique — not a leak of
 * their own data, but still an unauthenticated mail cannon, so it is refused.
 *
 * WHAT IT DOES NOT DO
 * It does not move money, mark anything paid, or write to `payouts`. The
 * settlement already happened via `settle_boutique_payout`; this only reports
 * it. That means a failed send is never a failed payout — the caller shows a
 * "couldn't email" toast and the in-app notification (trigger, migration 0078)
 * has already landed regardless.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const RATE_PCT = 10;
const BRAND = 'MangaiMart';
const APP_URL = (Deno.env.get('APP_URL') ?? 'https://mangaimart.com').replace(/\/$/, '');

/**
 * The wordmark. Pinned to the production origin rather than built from APP_URL,
 * because APP_URL is localhost in a dev environment and a localhost logo is a
 * broken image in the seller's inbox. PNG, not WebP — Outlook cannot decode it.
 * Mirrors LOGO_URL in api/_email.js.
 */
const LOGO_URL = Deno.env.get('EMAIL_LOGO_URL') ?? 'https://mangaimart.com/mangaimart-wordmark.png';

const inr = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

type ItemRow = { title: string; price: number; qty: number; size: string | null; color: string | null };
type OrderRow = {
  id: string;
  order_number: string | null;
  total: number;
  cod_fee: number | null;
  shipping_fee: number | null;
  platform_discount: number | null;
  payment_method: string | null;
  delivered_at: string | null;
  order_items: ItemRow[] | null;
};

/**
 * Mirrors `toStatementOrder` in src/data/payouts.ts. Duplicated rather than
 * shared because that module is browser TypeScript importing the Supabase
 * browser client; the arithmetic is four lines and the alternative is a shared
 * package for it. If the commission model changes, both change.
 */
function lineFor(o: OrderRow) {
  const goods = Number(o.total);
  const commission = Math.round(goods * (RATE_PCT / 100) * 100) / 100;
  const isCod = o.payment_method === 'COD';
  const fees = Number(o.shipping_fee ?? 0) + Number(o.cod_fee ?? 0);
  const discount = Number(o.platform_discount ?? 0);
  return {
    isCod,
    goods,
    commission,
    fees,
    discount,
    net: isCod ? -(commission + fees) + discount : goods - commission,
  };
}

function statementHtml(orders: OrderRow[]) {
  const rows = orders.map((o) => {
    const l = lineFor(o);
    const items = (o.order_items ?? [])
      .map((i) => `${esc(i.title)}${i.size || i.color ? ` (${esc([i.size, i.color].filter(Boolean).join(' / '))})` : ''} × ${i.qty}`)
      .join('<br />');
    return `<tr>
      <td style="padding:10px 0;border-top:1px solid #EFDCE4;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#241019;vertical-align:top;">
        <strong>${esc(o.order_number ?? o.id.slice(0, 8))}</strong>${l.isCod ? ' <span style="font-size:11px;color:#8A6D00;font-weight:700;">COD</span>' : ''}
        <div style="margin-top:3px;font-size:12px;color:#775D66;line-height:1.5;">${items || 'Item details unavailable'}</div>
        <div style="margin-top:3px;font-size:11.5px;color:#775D66;">
          Order ${inr(l.goods)} · commission −${inr(l.commission)}${l.isCod && l.fees > 0 ? ` · fees you collected −${inr(l.fees)}` : ''}${l.isCod && l.discount > 0 ? ` · coupon refunded +${inr(l.discount)}` : ''}
        </div>
      </td>
      <td align="right" style="padding:10px 0;border-top:1px solid #EFDCE4;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:${l.net < 0 ? '#B00020' : '#1B7A43'};vertical-align:top;white-space:nowrap;">
        ${l.net < 0 ? '−' : ''}${inr(Math.abs(l.net))}
      </td>
    </tr>`;
  });
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>`;
}

function layout({ heading, intro, bodyHtml, ctaLabel, ctaHref, footerNote }: {
  heading: string; intro: string; bodyHtml: string; ctaLabel?: string; ctaHref?: string; footerNote?: string;
}) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#FBF6F2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6F2;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #EFDCE4;">
    <tr><td align="center" style="background:#FFF8F4;padding:22px 24px 20px;border-bottom:1px solid #F4E7ED;">
      <a href="https://mangaimart.com" style="text-decoration:none;">
        <img src="${LOGO_URL}" width="210" alt="${BRAND}" style="display:block;margin:0 auto;width:210px;max-width:72%;height:auto;border:0;outline:none;text-decoration:none;" />
      </a>
    </td></tr>
    <tr><td align="center" style="padding:26px 24px 8px;text-align:center;">
      <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.3;color:#241019;font-weight:700;text-align:center;">${esc(heading)}</h1>
    </td></tr>
    <tr><td align="left" style="padding:10px 24px 0;text-align:left;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#4B3840;text-align:left;">${esc(intro)}</p>
    </td></tr>
    <tr><td align="left" style="padding:14px 24px 0;text-align:left;">${bodyHtml}</td></tr>
    ${ctaHref ? `<tr><td align="center" style="padding:24px 24px 4px;text-align:center;">
      <a href="${esc(ctaHref)}" style="display:inline-block;background:#B02454;color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:13px 26px;border-radius:10px;">${esc(ctaLabel || 'View')}</a>
    </td></tr>` : ''}
    <tr><td align="center" style="padding:24px 24px 26px;text-align:center;">
      ${footerNote ? `<p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;color:#775D66;text-align:center;">${esc(footerNote)}</p>` : ''}
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#836B74;text-align:center;">
        ${BRAND} — ethnic wear from verified independent boutiques.<br />
        This is a transactional message about your payout, not marketing.
      </p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  // Admin check with the caller's own token — the body is not trusted for this.
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: isAdmin, error: adminErr } = await asCaller.rpc('is_admin');
  if (adminErr || isAdmin !== true) return json({ error: 'Admin only' }, 403);

  let payoutId = '';
  try {
    payoutId = String((await req.json())?.payoutId ?? '');
  } catch {
    return json({ error: 'Invalid body' }, 400);
  }
  if (!payoutId) return json({ error: 'payoutId is required' }, 400);

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  const { data: payout, error: pErr } = await db
    .from('payouts')
    .select('id, boutique_id, amount, orders_count, gross, commission, fees, cod_adjustment, note, utr, created_at, status')
    .eq('id', payoutId)
    .maybeSingle();
  if (pErr || !payout) return json({ error: 'Payout not found' }, 404);

  const { data: boutique } = await db
    .from('boutiques')
    .select('name, email, bank_account_number')
    .eq('id', payout.boutique_id)
    .maybeSingle();

  const to = String(boutique?.email ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return json({ ok: false, error: 'This boutique has no email address on file' }, 200);
  }

  const { data: orders } = await db
    .from('orders')
    .select('id, order_number, total, cod_fee, shipping_fee, platform_discount, payment_method, delivered_at, order_items(title, price, qty, size, color)')
    .eq('payout_id', payoutId)
    .order('delivered_at', { ascending: true });

  const amount = Number(payout.amount);
  const owed = amount < 0;
  const acct = String(boutique?.bank_account_number ?? '');
  const masked = acct ? `A/c ••${acct.slice(-4)}` : 'your registered account';

  const summary = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    ${[
      ['Delivered orders settled', String(payout.orders_count)],
      ['Order value', inr(payout.gross)],
      [`MangaiMart commission (${RATE_PCT}%)`, '− ' + inr(payout.commission)],
      ...(Number(payout.cod_adjustment) !== 0
        ? [['COD cash you hold, netted off', '− ' + inr(payout.cod_adjustment)]]
        : []),
      [owed ? 'You owe MangaiMart' : 'Transferred to you', (owed ? '− ' : '') + inr(Math.abs(amount))],
      ...(payout.utr ? [['Bank reference', String(payout.utr)]] : payout.note ? [['Reference', String(payout.note)]] : []),
    ]
      .map(([label, value]) =>
        `<tr><td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#775D66;">${esc(label)}</td>` +
        `<td align="right" style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#241019;font-weight:700;">${esc(value)}</td></tr>`)
      .join('')}
  </table>`;

  const html = layout({
    heading: owed ? 'Your payout statement' : `${inr(amount)} is on its way to you`,
    intro: owed
      ? `Hello ${boutique?.name ?? 'there'} — here is your settlement statement. This cycle your cash-on-delivery commission came to more than your online earnings, so nothing was transferred and the balance carries forward.`
      : `Hello ${boutique?.name ?? 'there'} — ${inr(amount)} has been transferred to ${masked} for ${payout.orders_count} delivered order${payout.orders_count === 1 ? '' : 's'}. Payouts are released only after delivery, within 8 hours of it.`,
    bodyHtml:
      summary +
      `<div style="margin:20px 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#241019;">Order by order</div>` +
      statementHtml((orders ?? []) as OrderRow[]),
    ctaLabel: 'Open Earnings',
    ctaHref: `${APP_URL}/seller/earnings`,
    footerNote: 'Amounts are calculated from the delivered orders listed above. If a figure looks wrong, reply to this email with the order number and we will check it.',
  });

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    // Inert rather than broken, the same posture api/_email.js takes: an
    // unconfigured provider must not read as a failed payout.
    console.log('[payout-advice skipped — RESEND_API_KEY unset]', { to, payoutId });
    return json({ ok: false, error: 'Email provider is not configured on this project' }, 200);
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
      body: JSON.stringify({
        from: Deno.env.get('EMAIL_FROM') ?? 'noreply@mangaimart.com',
        to: [to],
        subject: owed ? `Your ${BRAND} payout statement` : `${inr(amount)} paid to you — ${BRAND}`,
        html,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      return json({ ok: false, error: body?.message ?? `HTTP ${res.status}` }, 200);
    }
    return json({ ok: true, to });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 200);
  }
});
