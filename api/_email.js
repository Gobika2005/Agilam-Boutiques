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
 */
export function layout({ heading, intro, bodyHtml, ctaLabel, ctaHref, footerNote, tagline }) {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:#FBF6F2;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6F2;padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid #EFDCE4;">
    <tr><td style="background:#B02454;padding:18px 24px;">
      <span style="color:#FFFFFF;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;letter-spacing:.02em;">${BRAND}</span>
    </td></tr>
    <tr><td style="padding:26px 24px 8px;">
      <h1 style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:22px;line-height:1.25;color:#241019;font-weight:700;">${esc(heading)}</h1>
      ${intro ? `<p style="margin:10px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#4B3840;">${esc(intro)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:14px 24px 0;">${bodyHtml}</td></tr>
    ${ctaHref ? `<tr><td style="padding:22px 24px 4px;">
      <a href="${esc(ctaHref)}" style="display:inline-block;background:#B02454;color:#FFFFFF;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 22px;border-radius:10px;">${esc(ctaLabel || 'View')}</a>
    </td></tr>` : ''}
    <tr><td style="padding:22px 24px 26px;">
      ${footerNote ? `<p style="margin:0 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:12.5px;line-height:1.6;color:#775D66;">${esc(footerNote)}</p>` : ''}
      <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11.5px;line-height:1.6;color:#836B74;">
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
