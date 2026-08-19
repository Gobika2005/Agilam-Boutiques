/**
 * Account-access notifications — the emails a person gets when an admin changes
 * what they can do on MangaiMart.
 *
 * Until now the ONLY account email was the welcome/temp-password one in
 * admin-create-user. Everything after that was silent: a buyer promoted to
 * admin, a seller blocked mid-season, an account archived with its login
 * disabled — the person found out by being locked out, or never found out at
 * all. These six templates close that gap.
 *
 * Three rules carried over from _email.js, all of which matter more here:
 *
 *   • NEVER throws, and never blocks the action. The access change is the real
 *     work and it has already been committed to the database by the time we get
 *     here; a dead mail provider must not turn a successful block into a 500
 *     that tempts the admin to click Block a second time.
 *   • The reason is admin-typed free text and goes into HTML — `esc` is not
 *     optional. It is also shown to the affected user verbatim, which is why
 *     the admin console labels the field as such.
 *   • Wording stays factual and points at support. These messages land at a
 *     moment when the reader is often already unhappy; they should read as a
 *     record of what happened, not as a verdict.
 *
 * The leading underscore keeps this out of Vercel's /api routing. That is load
 * bearing: the project sits at the 12-function Hobby ceiling, so this had to be
 * a helper the two existing admin routes import, not a route of its own.
 */

import { appUrl, esc, layout, rowsTable, sendEmail } from './_email.js';

const SUPPORT_EMAIL = 'support@mangaimart.com';

/**
 * The console's URL segment, mirroring src/lib/adminPath.ts.
 *
 * Same var the client build reads. If it is missing here the mail would invite
 * a new admin to /admin/login — a dead URL, since that path no longer routes —
 * so the fallback matches the client's and the deploy sets the var for both.
 */
const ADMIN_SEGMENT = (process.env.VITE_ADMIN_PATH || 'admin').trim().replace(/^\/+|\/+$/g, '') || 'admin';

/** Where this role signs in. Shared with admin-create-user's welcome mail. */
export function loginPathForRole(role) {
  // Staff use the same door as admins — one console entrance, and the role
  // decides what is behind it (migration 0086).
  if (role === 'admin' || role === 'staff') return `/${ADMIN_SEGMENT}/login`;
  if (role === 'seller') return '/auth/signin/seller';
  return '/auth/signin/buyer';
}

export function buildLoginUrl(role, email) {
  const query = email ? `?email=${encodeURIComponent(email)}` : '';
  return `${appUrl}${loginPathForRole(role)}${query}`;
}

const ROLE_LABEL = { buyer: 'Buyer', seller: 'Boutique seller', admin: 'Administrator', staff: 'Staff' };

const ROLE_MEANS = {
  buyer: 'You can shop, save wishlists, follow boutiques and track your orders.',
  seller: 'You can now open your boutique, list products, and manage orders and payouts from the seller console.',
  admin: 'You now have administrator access to the MangaiMart console, including orders, payouts, users and platform settings.',
  // Says what the account can do AND what it cannot, so a new employee is not
  // left discovering the limits by hitting them.
  staff: 'You can work orders and deliveries, approve boutiques, products and catalogue terms, moderate reviews and send buyer updates. Payouts, refunds, expenses, coupons, platform settings and account management stay with the owner.',
};

/** The admin-typed reason, as its own block. Omitted entirely when blank. */
function reasonBlock(reason) {
  const clean = typeof reason === 'string' ? reason.trim() : '';
  if (!clean) return '';
  return `<div style="margin:16px 0 0;padding:14px 16px;background:#FBF6F2;border:1px solid #EFDCE4;border-radius:12px;">
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9D556F;font-weight:700;margin-bottom:6px;">Reason given</div>
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:13.5px;line-height:1.6;color:#4B3840;">${esc(clean)}</div>
  </div>`;
}

function paragraph(text) {
  return `<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.7;color:#4B3840;">${text}</p>`;
}

function supportLine() {
  return paragraph(
    `If this doesn't look right, reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#B02454;font-weight:700;text-decoration:none;">${SUPPORT_EMAIL}</a>.`,
  );
}

/**
 * A dated stamp on every message. An access change is the kind of thing people
 * dispute later ("I was never told"), so the mail carries its own timestamp in
 * IST rather than relying on the mail client's received header.
 */
function stampedRows(rows) {
  const when = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return rowsTable([...rows, ['When', `${when} IST`]]);
}

const FOOTER_NOTE = 'You are receiving this because it affects access to your MangaiMart account.';

// The shell's default sign-off says "about your order", which is wrong on every
// message in this file — none of them are about an order.
const ACCOUNT_TAGLINE = 'This is a transactional message about your account, not marketing.';

function roleChanged({ fullName, email, role, previousRole }) {
  const now = ROLE_LABEL[role] ?? role;
  const before = ROLE_LABEL[previousRole] ?? previousRole;
  return {
    subject: `Your MangaiMart access is now: ${now}`,
    html: layout({
      heading: 'Your account access has changed',
      intro: `Hello ${fullName || 'there'}, an administrator has updated the access level on your MangaiMart account.`,
      bodyHtml:
        stampedRows([
          ['Account', email],
          ['Previous access', before],
          ['New access', now],
        ]) +
        `<div style="height:16px"></div>` +
        paragraph(esc(ROLE_MEANS[role] ?? 'Your access level has been updated.')) +
        (role === 'admin'
          ? paragraph(
              '<strong>This is a privileged account.</strong> Please use a password you do not use anywhere else, and never share your sign-in details.',
            )
          : '') +
        supportLine(),
      ctaLabel: 'Sign in',
      ctaHref: buildLoginUrl(role, email),
      footerNote: FOOTER_NOTE,
      tagline: ACCOUNT_TAGLINE,
    }),
    text: [
      `Hello ${fullName || 'there'},`,
      '',
      'An administrator has updated the access level on your MangaiMart account.',
      `Account: ${email}`,
      `Previous access: ${before}`,
      `New access: ${now}`,
      '',
      ROLE_MEANS[role] ?? '',
      '',
      `Sign in: ${buildLoginUrl(role, email)}`,
      `Questions: ${SUPPORT_EMAIL}`,
    ].join('\n'),
  };
}

function blocked({ fullName, email, reason }) {
  return {
    subject: 'Your MangaiMart account has been suspended',
    html: layout({
      heading: 'Your account has been suspended',
      intro: `Hello ${fullName || 'there'}, access to your MangaiMart account has been suspended by an administrator.`,
      bodyHtml:
        stampedRows([['Account', email], ['Status', 'Suspended']]) +
        reasonBlock(reason) +
        `<div style="height:16px"></div>` +
        paragraph(
          'While your account is suspended you will not be able to sign in. Your data, orders and any order history are kept.',
        ) +
        paragraph('If you have an order in progress, it is unaffected and will be fulfilled as normal.') +
        supportLine(),
      footerNote: FOOTER_NOTE,
      tagline: ACCOUNT_TAGLINE,
    }),
    text: [
      `Hello ${fullName || 'there'},`,
      '',
      'Access to your MangaiMart account has been suspended by an administrator.',
      `Account: ${email}`,
      reason ? `Reason given: ${reason}` : '',
      '',
      'You will not be able to sign in while the account is suspended. Your data and order history are kept.',
      'Any order already in progress is unaffected and will be fulfilled as normal.',
      '',
      `To appeal or ask why, write to ${SUPPORT_EMAIL}.`,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function unblocked({ fullName, email, role }) {
  return {
    subject: 'Your MangaiMart account has been restored',
    html: layout({
      heading: 'Your account has been restored',
      intro: `Hello ${fullName || 'there'}, the suspension on your MangaiMart account has been lifted.`,
      bodyHtml:
        stampedRows([['Account', email], ['Status', 'Active']]) +
        `<div style="height:16px"></div>` +
        paragraph('You can sign in again with your usual email and password. Everything is where you left it.') +
        supportLine(),
      ctaLabel: 'Sign in',
      ctaHref: buildLoginUrl(role, email),
      footerNote: FOOTER_NOTE,
      tagline: ACCOUNT_TAGLINE,
    }),
    text: [
      `Hello ${fullName || 'there'},`,
      '',
      'The suspension on your MangaiMart account has been lifted. You can sign in again with your usual email and password.',
      '',
      `Sign in: ${buildLoginUrl(role, email)}`,
      `Questions: ${SUPPORT_EMAIL}`,
    ].join('\n'),
  };
}

/**
 * Hard delete — the row is gone. This mail is the only record the person will
 * ever have of it, which is why the delete path sends it even though there is
 * no longer an account to link back to.
 */
function deleted({ fullName, email, reason }) {
  return {
    subject: 'Your MangaiMart account has been closed',
    html: layout({
      heading: 'Your account has been closed',
      intro: `Hello ${fullName || 'there'}, your MangaiMart account has been closed by an administrator.`,
      bodyHtml:
        stampedRows([['Account', email], ['Status', 'Closed']]) +
        reasonBlock(reason) +
        `<div style="height:16px"></div>` +
        paragraph(
          'Your profile, saved addresses, wishlist and cart have been removed and your sign-in no longer works. You are welcome to create a new account at any time.',
        ) +
        supportLine(),
      footerNote: FOOTER_NOTE,
      tagline: ACCOUNT_TAGLINE,
    }),
    text: [
      `Hello ${fullName || 'there'},`,
      '',
      'Your MangaiMart account has been closed by an administrator.',
      `Account: ${email}`,
      reason ? `Reason given: ${reason}` : '',
      '',
      'Your profile, saved addresses, wishlist and cart have been removed and your sign-in no longer works.',
      'You are welcome to create a new account at any time.',
      '',
      `Questions: ${SUPPORT_EMAIL}`,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

/**
 * Soft delete — kept because the person has orders or chat history. The wording
 * has to be honest that records survive, since that is exactly what a reader
 * who asked to be forgotten would want to know.
 */
function archived({ fullName, email, reason }) {
  return {
    subject: 'Your MangaiMart account has been closed',
    html: layout({
      heading: 'Your account has been closed',
      intro: `Hello ${fullName || 'there'}, your MangaiMart account has been closed by an administrator and your sign-in has been disabled.`,
      bodyHtml:
        stampedRows([['Account', email], ['Status', 'Closed']]) +
        reasonBlock(reason) +
        `<div style="height:16px"></div>` +
        paragraph(
          'Because your account has order history, your past orders and invoices are retained as a financial record, as required. You can no longer sign in.',
        ) +
        supportLine(),
      footerNote: FOOTER_NOTE,
      tagline: ACCOUNT_TAGLINE,
    }),
    text: [
      `Hello ${fullName || 'there'},`,
      '',
      'Your MangaiMart account has been closed by an administrator and your sign-in has been disabled.',
      `Account: ${email}`,
      reason ? `Reason given: ${reason}` : '',
      '',
      'Because your account has order history, your past orders and invoices are retained as a financial record, as required.',
      '',
      `Questions: ${SUPPORT_EMAIL}`,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function restored({ fullName, email, role }) {
  return {
    subject: 'Your MangaiMart account has been reinstated',
    html: layout({
      heading: 'Your account has been reinstated',
      intro: `Hello ${fullName || 'there'}, your MangaiMart account has been reopened and your sign-in works again.`,
      bodyHtml:
        stampedRows([['Account', email], ['Status', 'Active']]) +
        `<div style="height:16px"></div>` +
        paragraph('Sign in with your usual email and password. Your order history is intact.') +
        supportLine(),
      ctaLabel: 'Sign in',
      ctaHref: buildLoginUrl(role, email),
      footerNote: FOOTER_NOTE,
      tagline: ACCOUNT_TAGLINE,
    }),
    text: [
      `Hello ${fullName || 'there'},`,
      '',
      'Your MangaiMart account has been reopened and your sign-in works again. Your order history is intact.',
      '',
      `Sign in: ${buildLoginUrl(role, email)}`,
      `Questions: ${SUPPORT_EMAIL}`,
    ].join('\n'),
  };
}

const TEMPLATES = { roleChanged, blocked, unblocked, deleted, archived, restored };

/**
 * Send one access-change notification to the affected user.
 *
 * @param {'roleChanged'|'blocked'|'unblocked'|'deleted'|'archived'|'restored'} kind
 * @param {{ to: string, fullName?: string, role?: string, previousRole?: string, reason?: string }} details
 * @returns {Promise<{ ok: boolean, error?: string }>} never rejects
 */
export async function sendAccessEmail(kind, details) {
  try {
    const build = TEMPLATES[kind];
    if (!build) return { ok: false, error: `Unknown access email: ${kind}` };
    if (!details?.to) return { ok: false, error: 'No email address on file for this user' };

    const { subject, html, text } = build({
      fullName: details.fullName || '',
      email: details.to,
      role: details.role || 'buyer',
      previousRole: details.previousRole || 'buyer',
      reason: details.reason || '',
    });

    const result = await sendEmail({ to: details.to, subject, html, text, replyTo: SUPPORT_EMAIL });
    if (!result.ok) console.error('[ACCESS_EMAIL]', kind, details.to, result.error);
    return result;
  } catch (err) {
    // A template bug must not take down the access change that already happened.
    console.error('[ACCESS_EMAIL_THREW]', kind, err?.message ?? err);
    return { ok: false, error: err?.message ?? String(err) };
  }
}
