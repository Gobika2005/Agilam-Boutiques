/**
 * RazorpayX payout helpers (server-only).
 *
 * RazorpayX is Razorpay's *payout* product: where the rest of the app uses
 * Razorpay to COLLECT money from buyers, this pushes money OUT to sellers. It
 * shares the Razorpay auth scheme (Basic auth with a key id + secret) but the
 * key must have RazorpayX enabled, and a payout must name the source
 * `account_number` — the RazorpayX current-account number money leaves from.
 *
 * We call the REST API directly (Node 22 has global fetch); the `razorpay` npm
 * SDK is geared to the collection side. The leading underscore keeps this file
 * out of Vercel's /api routing.
 *
 * Required env:
 *   RAZORPAYX_KEY_ID, RAZORPAYX_KEY_SECRET   — a RazorpayX-enabled API key
 *   RAZORPAYX_ACCOUNT_NUMBER                 — the source account payouts debit
 * Falls back to the collection keys (RAZORPAY_KEY_ID/SECRET) if the X-specific
 * ones aren't set, since on many accounts the same key does both.
 */

const BASE = 'https://api.razorpay.com/v1';

const keyId = process.env.RAZORPAYX_KEY_ID || process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAYX_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;
const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER;

function present(v) {
  return typeof v === 'string' && v.trim() !== '' && v.trim() !== 'undefined' && v.trim() !== 'null';
}

/** True only when everything needed to actually move money is configured. */
export function rxConfigured() {
  return present(keyId) && present(keySecret) && present(accountNumber);
}

export function rxAccountNumber() {
  return accountNumber;
}

/**
 * A RazorpayX API error carries the useful part in `error.description`; surface
 * that so a failed payout logs *why* rather than "HTTP 400".
 */
export class RazorpayXError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'RazorpayXError';
    this.status = status;
    this.body = body;
  }
}

async function rx(path, { method = 'POST', body, idempotencyKey } = {}) {
  const headers = {
    Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64'),
    'Content-Type': 'application/json',
  };
  // Idempotency guarantees a retried payout with the same key can never send
  // twice — the single most important safety property here.
  if (idempotencyKey) headers['X-Payout-Idempotency'] = idempotencyKey;

  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!resp.ok) {
    const desc = json?.error?.description || json?.message || `RazorpayX ${resp.status}`;
    throw new RazorpayXError(desc, resp.status, json);
  }
  return json;
}

/**
 * Ensure the boutique has a RazorpayX fund account to pay into, creating the
 * contact + fund account once and caching the ids on the boutique row.
 *
 * Prefers a bank account (IMPS/NEFT, the norm for vendor payouts); falls back to
 * the seller's UPI id. Returns null when the seller has given us neither.
 */
export async function ensureFundAccount(supabase, boutique) {
  // The mode must match how the fund account was created. It is derived from the
  // same details every time (bank preferred over UPI), so a reused account
  // resolves to the same method without needing to be stored separately.
  const methodFor = (b) => (present(b.bank_account_number) && present(b.bank_ifsc) ? 'bank' : 'upi');

  if (present(boutique.razorpayx_fund_account_id)) {
    return { fundAccountId: boutique.razorpayx_fund_account_id, method: methodFor(boutique) };
  }

  // 1) Contact — reused across payouts; create only if we don't have one.
  let contactId = boutique.razorpayx_contact_id;
  if (!present(contactId)) {
    const contact = await rx('/contacts', {
      body: {
        name: boutique.name || 'Seller',
        email: boutique.email || undefined,
        contact: boutique.phone || boutique.whatsapp || undefined,
        type: 'vendor',
        reference_id: `boutique_${boutique.id}`,
      },
    });
    contactId = contact.id;
  }

  // 2) Fund account — bank first, else UPI.
  const hasBank = present(boutique.bank_account_number) && present(boutique.bank_ifsc);
  const hasUpi = present(boutique.upi_id);
  if (!hasBank && !hasUpi) {
    // Still persist the contact so we don't recreate it once details arrive.
    if (contactId !== boutique.razorpayx_contact_id) {
      await supabase.from('boutiques').update({ razorpayx_contact_id: contactId }).eq('id', boutique.id);
    }
    return null;
  }

  let method;
  let fundAccount;
  if (hasBank) {
    method = 'bank';
    fundAccount = await rx('/fund_accounts', {
      body: {
        contact_id: contactId,
        account_type: 'bank_account',
        bank_account: {
          name: boutique.bank_account_name || boutique.name || 'Seller',
          ifsc: boutique.bank_ifsc,
          account_number: boutique.bank_account_number,
        },
      },
    });
  } else {
    method = 'upi';
    fundAccount = await rx('/fund_accounts', {
      body: { contact_id: contactId, account_type: 'vpa', vpa: { address: boutique.upi_id } },
    });
  }

  await supabase
    .from('boutiques')
    .update({ razorpayx_contact_id: contactId, razorpayx_fund_account_id: fundAccount.id })
    .eq('id', boutique.id);

  return { fundAccountId: fundAccount.id, method };
}

/**
 * Start a penny-drop on a bank fund account: RazorpayX deposits a tiny amount
 * (default ₹1) and reports whether the account is real + the registered name.
 * Asynchronous — the result arrives via `getFundAccountValidation` polling or
 * the `fund_account.validation.completed` webhook.
 */
export async function createFundAccountValidation({ fundAccountId, amountPaise = 100, referenceId }) {
  return rx('/fund_accounts/validations', {
    body: {
      account_number: accountNumber,
      fund_account: { id: fundAccountId },
      amount: amountPaise,
      currency: 'INR',
      notes: referenceId ? { reference_id: referenceId } : undefined,
    },
  });
}

export async function getFundAccountValidation(id) {
  return rx(`/fund_accounts/validations/${id}`, { method: 'GET' });
}

/**
 * Reduce a validation entity to one of three states. A completed penny-drop
 * whose account came back `active` (bank) / `valid` (vpa) is verified; a
 * `failed` status or an `invalid` account is a hard fail; anything else is
 * still in flight.
 */
export function validationOutcome(entity) {
  const status = entity?.status; // created | completed | failed
  const acct = entity?.results?.account_status; // active | invalid | valid
  if (status === 'completed' && (acct === 'active' || acct === 'valid')) return 'verified';
  if (status === 'failed' || acct === 'invalid') return 'failed';
  return 'pending';
}

/**
 * Create the payout. `amountPaise` is the net already computed by the DB.
 * `idempotencyKey` is the payout row id, so a retry of the same settlement is a
 * no-op at RazorpayX rather than a second transfer.
 */
export async function createPayout({ fundAccountId, amountPaise, method, referenceId, narration, idempotencyKey }) {
  const mode = method === 'upi' ? 'UPI' : 'IMPS';
  return rx('/payouts', {
    idempotencyKey,
    body: {
      account_number: accountNumber,
      fund_account_id: fundAccountId,
      amount: amountPaise,
      currency: 'INR',
      mode,
      purpose: 'payout',
      // If the RazorpayX balance is short, queue the payout rather than fail it;
      // it releases automatically once the account is topped up.
      queue_if_low_balance: true,
      reference_id: referenceId,
      narration: (narration || 'MangaiMart seller payout').slice(0, 30),
    },
  });
}
