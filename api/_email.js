/**
 * Transactional email, via Resend.
 *
 * Extracted from api/admin-create-user.js, which had the only copy. That meant
 * the ONLY emails the platform ever sent were an admin welcome, a payout notice
 * and the owner's daily digest — a buyer who paid for an order received nothing
 * at all outside the app, and neither did the seller who had to pack it. This
 * module is the shared sender; api/place-order.js is its main caller.
 *
 * Design rules, all learned from the surrounding code:
 *
 *   • NEVER throws. Every caller here is on a path where the money has already
 *     moved and the order row already exists. An email failure must never turn
 *     a successful checkout into an error, so this reports `{ ok, error }` and
 *     the caller logs it.
 *   • Inert, not broken, when RESEND_API_KEY is unset — the same posture the
 *     webhooks take. In development it logs the message instead of sending.
 *   • No layout framework and no external CSS. Email clients strip <style>
 *     blocks and ignore most of what they don't; inline attributes on tables
 *     are the only thing that renders the same in Gmail, Outlook and Apple Mail.
 *
 * The leading underscore keeps this out of Vercel's /api routing, which matters:
 * the project is at the 12-function Hobby ceiling, so a new route here would
 * cost a deploy.
 */

const resendApiKey = process.env.RESEND_API_KEY || process.env.VITE_RESEND_API_KEY;
const fromEmail = process.env.EMAIL_FROM || process.env.VITE_EMAIL_FROM || 'noreply@mangaimart.com';
export const appUrl = (process.env.APP_URL || process.env.VITE_APP_URL || 'https://mangaimart.com').replace(/\/$/, '');

const BRAND = 'MangaiMart';

/**
 * The wordmark, centred at the top of every message we send.
 *
 * Hard-coded to the production origin rather than derived from `APP_URL`,
 * deliberately: `.env` carries `APP_URL=http://localhost:5173` for dev, and a
 * logo pointing at localhost is a broken image in every inbox it reaches. The
 * URL has to resolve from the recipient's phone, not from the machine that sent
 * it. `EMAIL_LOGO_URL` overrides it if the asset ever moves.
 *
 * PNG, not the smaller WebP next to it in /public — Outlook on Windows still
 * cannot decode WebP and would show the alt text instead of the brand.
 *
 * Width is set as an HTML attribute as well as CSS because Outlook ignores the
 * style. The source is 800px wide and renders at 210, so it stays sharp on a
 * retina screen.
 */
export const LOGO_URL = process.env.EMAIL_LOGO_URL || 'https://mangaimart.com/mangaimart-wordmark.png';
const LOGO_LINK = 'https://mangaimart.com';

/**
 * The masthead. Cream, not the old crimson bar: the wordmark is deep pink on a
 * transparent background and disappears into crimson.
 *
 * `alt` matters more here than on the web — most clients block images until the
 * reader asks for them, so for the first few seconds this row IS the word
 * "MangaiMart" in whatever the client's fallback styling is.
 */
export function logoHeader() {
  return `<tr><td align="center" style="background:#FFF8F4;padding:22px 24px 20px;border-bottom:1px solid #F4E7ED;">
      <a href="${LOGO_LINK}" style="text-decoration:none;">
        <img src="${LOGO_URL}" width="210" alt="${BRAND}" class="ag-logo" style="display:block;margin:0 auto;width:210px;max-width:72%;height:auto;border:0;outline:none;text-decoration:none;" />
      </a>
    </td></tr>`;
}

/**
 * The one stylesheet an email is allowed.
 *
 * Two jobs, both of them about the phone:
 *
 *   • `text-size-adjust:100%` stops Android WebViews (Gmail) and iOS Safari
 *     running their own font-boosting pass over the message. Without it a mail
 *     that measures 14px on the desktop arrives inflated on a narrow screen,
 *     which is exactly how the broadcast looked in the field.
 *   • The media query drops the heading, body and side padding a step below 600px.
 *     On a 360px phone the card is ~336px wide; 24px of padding either side and
 *     a 23px serif heading left four or five words per line.
 *
 * Everything here is a REFINEMENT, never a requirement — a client that strips
 * `<style>` (Gmail with a non-Gmail account still does) shows the inline values,
 * so those are sized to be correct on their own. `!important` is what lets a
 * rule beat the inline style it is overriding.
 *
 * Mirrored in supabase/functions/broadcast-email and payout-advice.
 */
export const HEAD_STYLE = `<style>
  body, table, td, p, h1, li, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; text-size-adjust:100%; }
  @media only screen and (max-width:600px) {
    .ag-pad { padding-left:18px !important; padding-right:18px !important; }
    .ag-h1 { font-size:19px !important; line-height:1.32 !important; }
    .ag-logo { width:168px !important; }
    .ag-body p, .ag-body li { font-size:13.5px !important; line-height:1.6 !important; }
    .ag-btn { font-size:13.5px !important; padding:12px 22px !important; }
    .ag-small { font-size:11px !important; }
  }
</style>`;

export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/** ₹1,899 — the format every buyer-facing surface in the app uses. */
export function inr(n) {
  return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
}

/**
 * Escape for HTML. Order data is user-supplied — a product titled
 * `<img onerror=…>` or a buyer named `</td><script>` must not be able to
 * restructure the message, and some webmail clients will happily run what a
 * naive template hands them.
 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap body HTML in the shared shell.
 *
 * Colours are literal hex on purpose: this is the one place in the codebase
 * where the `--ag-*` token rule does NOT apply, because an email is rendered by
 * a mail client that has never seen our stylesheet and cannot resolve a CSS
 * variable. They are the light-theme brand values, which is correct — email
 * has no dark-mode contract we can honour.
 *
 * ── Alignment ───────────────────────────────────────────────────────────────
 * Logo, heading, button and footer are centred; the intro and body are LEFT.
 * Centred running text has a ragged left edge, so the eye has to hunt for the
 * start of every line — fine for a two-line heading, tiring for a paragraph and
 * wrong for the order tables and payout statements that pass through `bodyHtml`.
 *
 * Alignment is set with the `align` attribute on each `<td>` AND `text-align` in
 * the style, because Outlook honours the attribute and ignores the CSS while
 * several webmail clients strip the attribute and keep the CSS.
 */
export function layout({ heading, intro, bodyHtml, ctaLabel, ctaHref, footerNote, tagline }) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(heading)}</title>
${HEAD_STYLE}</head>
<body style="margin:0;padding:0;background:#FBF6F2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6F2;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #EFDCE4;">
    ${logoHeader()}
    <tr><td align="center" class="ag-pad" style="padding:26px 24px 8px;text-align:center;">
      <h1 class="ag-h1" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:21px;line-height:1.3;color:#241019;font-weight:700;text-align:center;">${esc(heading)}</h1>
    </td></tr>
    ${intro ? `<tr><td align="left" class="ag-pad ag-body" style="padding:10px 24px 0;text-align:left;">
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.65;color:#4B3840;text-align:left;">${esc(intro)}</p>
    </td></tr>` : ''}
    <tr><td align="left" class="ag-pad ag-body" style="padding:14px 24px 0;text-align:left;">${bodyHtml}</td></tr>
    ${ctaHref ? `<tr><td align="center" class="ag-pad" style="padding:24px 24px 4px;text-align:center;">
      <a href="${esc(ctaHref)}" class="ag-btn" style="display:inline-block;background:#B02454;color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:13px 26px;border-radius:10px;">${esc(ctaLabel || 'View')}</a>
    </td></tr>` : ''}
    <tr><td align="center" class="ag-pad" style="padding:24px 24px 26px;text-align:center;">
      ${footerNote ? `<p class="ag-small" style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;color:#775D66;text-align:center;">${esc(footerNote)}</p>` : ''}
      <p class="ag-small" style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#836B74;text-align:center;">
        ${BRAND} — ethnic wear from verified independent boutiques.<br />
        ${esc(tagline || 'This is a transactional message about your order, not marketing.')}
      </p>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
}

/** A simple label/value table for order summaries. */
export function rowsTable(rows) {
  const body = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#775D66;">${esc(label)}</td>` +
        `<td align="right" style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#241019;font-weight:700;">${esc(value)}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>`;
}

/**
 * Send one message. Resolves `{ ok: true }` or `{ ok: false, error }` — never
 * rejects, so a caller can `await` it on a success path without a try/catch.
 */
export async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!isValidEmail(to)) return { ok: false, error: 'No valid recipient' };

  if (!resendApiKey) {
    // Not an error: an unconfigured provider should leave checkout working.
    console.log('[email skipped — RESEND_API_KEY unset]', { to, subject });
    return { ok: false, error: 'Email provider is not configured' };
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
      body: JSON.stringify({
        from: fromEmail,
        to: [to.trim()],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
      // A hung provider must not hold the checkout response open. Resend is
      // fast; anything past 8s is a failure we would rather log than wait for.
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        detail = body?.message || body?.error?.message || detail;
      } catch { /* keep the status line */ }
      return { ok: false, error: detail };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
