import crypto from 'node:crypto';
import Razorpay from 'razorpay';

/**
 * Razorpay account registry — which merchant account collects the money.
 *
 * The platform can be configured with TWO Razorpay accounts: the everyday one
 * and a standby. Admin → Settings has a single switch that flips which account
 * new payments are opened on, so if the live account is frozen, under review, or
 * its keys are rotated mid-day, checkout can be moved to the other one in a
 * couple of seconds instead of waiting on a redeploy.
 *
 *   RAZORPAY_KEY_ID        / RAZORPAY_KEY_SECRET        → "primary"
 *   RAZORPAY_KEY_ID_B      / RAZORPAY_KEY_SECRET_B      → "backup"
 *   RAZORPAY_WEBHOOK_SECRET / RAZORPAY_WEBHOOK_SECRET_B → per-account webhooks
 *
 * The switch itself lives in `platform_settings.razorpay_account` (migration
 * 0064) so it is a DB row, not an env var — an env var would need a deploy,
 * which is exactly what an emergency doesn't have time for.
 *
 * ── The rule that makes switching safe ──────────────────────────────────────
 * Only ORDER CREATION follows the switch. Everything downstream — signature
 * verification, the amount binding in place-order, webhooks, refunds — accepts
 * EITHER account, because at the moment of the flip there are buyers halfway
 * through a checkout whose order was opened on the old account. Verifying only
 * against the newly-selected account would reject those payments as forged and
 * leave real buyers charged with no order. So: verify against every configured
 * account, and let the one whose secret produced the signature identify which
 * account to talk to for the rest of that payment.
 *
 * The leading underscore keeps this out of Vercel's /api routing (the Hobby plan
 * caps a deployment at 12 Serverless Functions and api/ is already at 12).
 */

function present(v) {
  return typeof v === 'string' && v.trim() !== '' && v.trim() !== 'undefined' && v.trim() !== 'null';
}

/** Account order matters: the first configured one is the last-resort fallback. */
const DEFINITIONS = [
  {
    key: 'primary',
    label: 'Primary',
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },
  {
    key: 'backup',
    label: 'Backup',
    keyId: process.env.RAZORPAY_KEY_ID_B,
    keySecret: process.env.RAZORPAY_KEY_SECRET_B,
    // Falling back to the primary webhook secret is deliberate: the Razorpay
    // dashboard lets you choose the signing secret, so an owner who sets the
    // same string on both accounts' webhooks needs no extra env var.
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET_B || process.env.RAZORPAY_WEBHOOK_SECRET,
  },
];

export const ACCOUNT_KEYS = DEFINITIONS.map((d) => d.key);
export const DEFAULT_ACCOUNT_KEY = 'primary';

/** Every account whose key pair is actually set. Env can't change at runtime. */
const ACCOUNTS = DEFINITIONS.filter((d) => present(d.keyId) && present(d.keySecret)).map((d) => {
  const keyId = d.keyId.trim();
  return {
    key: d.key,
    label: d.label,
    keyId,
    keySecret: d.keySecret.trim(),
    webhookSecret: present(d.webhookSecret) ? d.webhookSecret.trim() : null,
    mode: keyId.startsWith('rzp_live') ? 'live' : keyId.startsWith('rzp_test') ? 'test' : 'unknown',
  };
});

export function configuredAccounts() {
  return ACCOUNTS;
}

export function accountByKey(key) {
  return ACCOUNTS.find((a) => a.key === key) ?? null;
}

/**
 * Which account the admin switch currently points at.
 *
 * Any failure — table missing, column missing (0064 not applied), unreadable
 * row, unknown value — resolves to 'primary'. A settings outage must not be able
 * to move the money to a different account.
 */
export async function activeAccountKey(supabase) {
  if (!supabase) return DEFAULT_ACCOUNT_KEY;
  try {
    const { data, error } = await supabase
      .from('platform_settings')
      .select('razorpay_account')
      .eq('id', 1)
      .maybeSingle();
    if (error || !data) return DEFAULT_ACCOUNT_KEY;
    const key = String(data.razorpay_account ?? '').trim();
    return ACCOUNT_KEYS.includes(key) ? key : DEFAULT_ACCOUNT_KEY;
  } catch {
    return DEFAULT_ACCOUNT_KEY;
  }
}

/**
 * The account new payments should be opened on, or null when Razorpay is not
 * configured at all.
 *
 * If the switch names an account whose keys are missing, this falls back to the
 * first configured account rather than returning nothing. Refusing would turn a
 * mis-set switch into a total checkout outage, which is strictly worse than
 * collecting on the account that does work — and the admin screen shows which
 * accounts are configured so the flip can be made with the facts visible.
 */
export async function activeAccount(supabase) {
  const wanted = await activeAccountKey(supabase);
  const chosen = accountByKey(wanted);
  if (chosen) return chosen;
  const fallback = ACCOUNTS[0] ?? null;
  if (fallback) {
    console.error(
      `_razorpay: settings select the '${wanted}' account but its keys are not configured; collecting on '${fallback.key}' instead`,
    );
  }
  return fallback;
}

const clients = new Map();

/** A cached Razorpay SDK client for an account (from configuredAccounts()). */
export function clientFor(account) {
  if (!account) return null;
  let client = clients.get(account.key);
  if (!client) {
    client = new Razorpay({ key_id: account.keyId, key_secret: account.keySecret });
    clients.set(account.key, client);
  }
  return client;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Verify a checkout signature against EVERY configured account.
 *
 * Returns the account whose secret signed it (which is therefore the account
 * holding the payment), or null if no account matches. Comparison is
 * constant-time per account.
 */
export function verifyPaymentSignature({ razorpay_order_id, razorpay_payment_id, razorpay_signature }) {
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) return null;
  const body = `${razorpay_order_id}|${razorpay_payment_id}`;
  for (const account of ACCOUNTS) {
    const expected = crypto.createHmac('sha256', account.keySecret).update(body).digest('hex');
    if (safeEqual(expected, razorpay_signature)) return account;
  }
  return null;
}

/**
 * Verify a webhook HMAC over the RAW body against every account's webhook
 * secret. Returns the matching account, or null. Accounts sharing one secret are
 * tried once.
 */
export function verifyWebhookSignature(raw, signature) {
  if (!signature) return null;
  const seen = new Set();
  for (const account of ACCOUNTS) {
    if (!account.webhookSecret || seen.has(account.webhookSecret)) continue;
    seen.add(account.webhookSecret);
    const expected = crypto.createHmac('sha256', account.webhookSecret).update(raw).digest('hex');
    if (safeEqual(expected, signature)) return account;
  }
  return null;
}

/** True when at least one account has a webhook secret configured. */
export function webhookConfigured() {
  return ACCOUNTS.some((a) => a.webhookSecret);
}

/** Accounts to attempt, most-likely first. `preferred` may be a key or account. */
export function accountsToTry(preferred) {
  const key = typeof preferred === 'string' ? preferred : preferred?.key;
  const first = key ? accountByKey(key) : null;
  return first ? [first, ...ACCOUNTS.filter((a) => a.key !== first.key)] : [...ACCOUNTS];
}

/**
 * Find which account holds a payment id, for the paths that have no signature to
 * go on — an admin-initiated refund of a payment taken weeks ago, possibly on
 * the other account.
 *
 * A payment id belongs to exactly one merchant account; fetching it with the
 * wrong keys is a 400/404, never a false positive. Auth failures on one account
 * don't abort the search, so one rotated key can't block a refund on the other.
 * Returns `{ account, payment }`, or `{ error }` when nothing matched.
 */
export async function findPaymentAccount(paymentId, preferred = null) {
  if (!paymentId) return { error: 'No payment id' };
  let lastError = null;
  for (const account of accountsToTry(preferred)) {
    try {
      const payment = await clientFor(account).payments.fetch(paymentId);
      if (payment?.id) return { account, payment };
    } catch (e) {
      lastError = e?.error?.description || e?.message || String(e);
    }
  }
  return { error: lastError || 'Payment not found on any configured Razorpay account' };
}
