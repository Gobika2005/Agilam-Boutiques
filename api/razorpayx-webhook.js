import crypto from 'node:crypto';
import { serviceClient } from './_supabase.js';
import { validationOutcome } from './_razorpayx.js';

/**
 * Vercel serverless function: RazorpayX payout webhook.
 *
 * A payout submitted by api/run-payouts.js settles asynchronously. RazorpayX
 * calls this endpoint when it does — `payout.processed` means the money left and
 * reached the seller; `payout.failed` / `payout.reversed` / `payout.rejected`
 * mean it did not. We reconcile the matching `payouts` row by its provider id:
 *   • processed → status 'paid', with the bank UTR recorded;
 *   • failed/reversed/rejected → fail_auto_payout, which releases the covered
 *     orders so the next daily run retries them.
 *
 * Setup: add this URL as a webhook in the RazorpayX dashboard for the
 * `payout.processed`, `payout.failed`, `payout.reversed` and `payout.rejected`
 * events, secret = RAZORPAYX_WEBHOOK_SECRET. Without the secret it is an inert
 * 200 no-op.
 *
 * Signature verification needs the raw body, so body parsing is disabled.
 */

export const config = { api: { bodyParser: false } };

const webhookSecret = process.env.RAZORPAYX_WEBHOOK_SECRET;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function readRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (req.body && typeof req.body === 'object' && !req.on) return JSON.stringify(req.body);
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  /*
   * No secret configured means we cannot authenticate a caller, so there is no
   * caller we should answer in detail. This used to reply
   * `200 {"skipped":"webhook not configured"}` to anyone who asked, publishing
   * the payout integration's configuration state to the internet. RazorpayX
   * itself only ever reaches this endpoint once the secret exists, so the
   * friendly body was read by nobody but a prober. 401 is both the honest
   * status and the quiet one; the reason still goes to the function log, where
   * an operator debugging the wiring will actually look.
   */
  if (!webhookSecret) {
    console.warn('razorpayx-webhook: RAZORPAYX_WEBHOOK_SECRET is not set; rejecting delivery');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let raw;
  try {
    raw = await readRawBody(req);
  } catch {
    return res.status(400).json({ error: 'Could not read webhook body' });
  }

  const signature = req.headers?.['x-razorpay-signature'];
  const expected = crypto.createHmac('sha256', webhookSecret).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature || ''));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'Malformed webhook payload' });
  }

  const type = event?.event;
  if (typeof type !== 'string') {
    return res.status(200).json({ ok: true, ignored: 'unknown' });
  }

  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) {
    console.error('razorpayx-webhook: Supabase not configured; cannot reconcile', type);
    return res.status(200).json({ ok: true, reconciled: false });
  }

  // ── Penny-drop result: flip the boutique's verification state ─────────────
  if (type.startsWith('fund_account.validation')) {
    const entity = event?.payload?.fund_account?.validation?.entity;
    const validationId = entity?.id ?? null;
    if (!validationId) return res.status(200).json({ ok: true, ignored: type });
    const outcome = validationOutcome(entity);
    if (outcome === 'pending') return res.status(200).json({ ok: true, ignored: type });
    try {
      const update =
        outcome === 'verified'
          ? { payout_details_verified: true, payout_verification_status: 'verified', payout_verification_note: entity?.results?.registered_name ?? null }
          : { payout_verification_status: 'failed', payout_verification_note: `penny-drop: ${entity?.results?.account_status ?? 'invalid account'}` };
      await supabase.from('boutiques').update(update).eq('razorpayx_validation_id', validationId);
      return res.status(200).json({ ok: true, reconciled: true, verification: outcome });
    } catch (err) {
      console.error('razorpayx-webhook: verification update failed', err?.message ?? err);
      return res.status(200).json({ ok: true, reconciled: false });
    }
  }

  const payout = event?.payload?.payout?.entity;
  const payoutId = payout?.id ?? null;

  if (!payoutId || !type.startsWith('payout.')) {
    return res.status(200).json({ ok: true, ignored: type });
  }

  try {
    const { data: row } = await supabase.from('payouts').select('id, status').eq('provider_payout_id', payoutId).maybeSingle();
    if (!row) {
      // Provider id not stored yet (webhook beat the run's set_reference), or a
      // payout we don't track. Ack — RazorpayX will not resend indefinitely, and
      // the run's own status check covers the fast-settle case.
      return res.status(200).json({ ok: true, reconciled: false, unknownPayout: true });
    }
    if (row.status === 'paid') {
      return res.status(200).json({ ok: true, reconciled: true, alreadyPaid: true });
    }

    if (type === 'payout.processed') {
      await supabase.rpc('mark_auto_payout_paid', {
        p_payout_id: row.id,
        p_provider_payout_id: payoutId,
        p_utr: payout?.utr ?? null,
      });
      return res.status(200).json({ ok: true, reconciled: true, status: 'paid' });
    }

    if (type === 'payout.failed' || type === 'payout.reversed' || type === 'payout.rejected') {
      await supabase.rpc('fail_auto_payout', {
        p_payout_id: row.id,
        p_reason: `${type}: ${payout?.status_details?.description || payout?.failure_reason || 'payout not completed'}`,
      });
      return res.status(200).json({ ok: true, reconciled: true, status: 'failed' });
    }

    // Non-terminal event (queued/pending/initiated) — nothing to change.
    return res.status(200).json({ ok: true, ignored: type });
  } catch (err) {
    console.error('razorpayx-webhook: reconciliation failed', err?.message ?? err);
    return res.status(200).json({ ok: true, reconciled: false });
  }
}
