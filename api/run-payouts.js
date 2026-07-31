import crypto from 'node:crypto';
import { serviceClient } from './_supabase.js';
import { loadTerms } from './_settings.js';
import {
  rxConfigured, ensureFundAccount, createPayout, RazorpayXError,
  createFundAccountValidation, getFundAccountValidation, validationOutcome,
} from './_razorpayx.js';

/**
 * Vercel serverless function: the daily seller-payout run.
 *
 * For every boutique with prepaid orders that were delivered and have cleared
 * the hold window, this:
 *   1. opens a 'processing' payout in the DB (open_auto_payout) — which also
 *      stamps the covered orders so they can never be picked up twice;
 *   2. registers the seller's bank/UPI with RazorpayX (once, then cached);
 *   3. fires the transfer, idempotent on the payout id so a retry never double-pays.
 *
 * The final 'paid' confirmation comes from the RazorpayX webhook
 * (api/razorpayx-webhook.js); a transfer that fails to even submit is unwound
 * immediately (fail_auto_payout releases the orders for the next run).
 *
 * COD is never touched here — the seller holds that cash and owes the platform,
 * which is a manual net-off on the admin console.
 *
 * Trigger: a daily cron (see vercel.json). Protected by PAYOUT_CRON_SECRET —
 * accepted either as `x-cron-secret` or as Vercel Cron's `Authorization: Bearer
 * <CRON_SECRET>`. With nothing configured (no RazorpayX, or no secret) it is an
 * inert 200 so a misconfigured deploy never 500s a scheduler.
 */

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const cronSecret = process.env.PAYOUT_CRON_SECRET;
const vercelCronSecret = process.env.CRON_SECRET;
/** Env override for the hold window; when unset the admin-editable
 *  `platform_settings.payout_hold_days` applies (see resolveHoldDays below). */
const HOLD_DAYS_ENV = process.env.PAYOUT_HOLD_DAYS;

const BOUTIQUE_COLS =
  'id, name, email, phone, whatsapp, bank_account_name, bank_account_number, bank_ifsc, upi_id, razorpayx_contact_id, razorpayx_fund_account_id, payout_details_verified';

function authorized(req) {
  if (!present(cronSecret) && !present(vercelCronSecret)) return false;
  const header = req.headers?.['x-cron-secret'];
  if (present(cronSecret) && header && safeEqual(header, cronSecret)) return true;
  const auth = req.headers?.authorization || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (present(vercelCronSecret) && bearer && safeEqual(bearer, vercelCronSecret)) return true;
  return false;
}

function present(v) {
  return typeof v === 'string' && v.trim() !== '' && v.trim() !== 'undefined' && v.trim() !== 'null';
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Gate a boutique on penny-drop verification before any money is opened.
 *
 * Returns true only when the payout destination is confirmed:
 *   • already verified          → true, pay now;
 *   • bank, not yet started     → kick off the penny-drop, return false (wait);
 *   • bank, in progress         → poll; verify/fail/keep-waiting accordingly;
 *   • UPI                       → validated at payout time, so verified on file.
 *
 * Returning false is not an error — it means "hold the money until the account
 * is proven", and the next run (or the validation webhook) will let it through.
 */
async function ensurePayoutVerified(supabase, boutique, account, result) {
  if (boutique.payout_details_verified || boutique.payout_verification_status === 'verified') return true;

  if (account.method === 'upi') {
    await supabase
      .from('boutiques')
      .update({ payout_details_verified: true, payout_verification_status: 'verified', payout_verification_note: 'UPI — validated at payout' })
      .eq('id', boutique.id);
    return true;
  }

  // Bank penny-drop already running → check where it got to.
  if (present(boutique.razorpayx_validation_id)) {
    let entity;
    try {
      entity = await getFundAccountValidation(boutique.razorpayx_validation_id);
    } catch (e) {
      console.error('run-payouts: validation poll failed for', boutique.id, e.message);
      result.verifyPending += 1;
      return false;
    }
    const outcome = validationOutcome(entity);
    if (outcome === 'verified') {
      await supabase
        .from('boutiques')
        .update({ payout_details_verified: true, payout_verification_status: 'verified', payout_verification_note: entity?.results?.registered_name ?? null })
        .eq('id', boutique.id);
      return true;
    }
    if (outcome === 'failed') {
      await supabase
        .from('boutiques')
        .update({ payout_verification_status: 'failed', payout_verification_note: `penny-drop: ${entity?.results?.account_status ?? 'invalid account'}` })
        .eq('id', boutique.id);
      result.verifyFailed += 1;
      return false;
    }
    result.verifyPending += 1;
    return false;
  }

  // Not started → begin the penny-drop and wait for it to complete.
  try {
    const v = await createFundAccountValidation({ fundAccountId: account.fundAccountId, referenceId: `verify_${boutique.id}` });
    await supabase
      .from('boutiques')
      .update({ razorpayx_validation_id: v.id, payout_verification_status: 'pending' })
      .eq('id', boutique.id);
    result.verifyStarted += 1;
  } catch (e) {
    console.error('run-payouts: penny-drop init failed for', boutique.id, e.message);
    result.verifyFailed += 1;
  }
  return false;
}

/**
 * Move the money for one already-opened 'processing' payout. Idempotent on the
 * payout id at RazorpayX, so calling it again for a payout that already sent is
 * safe — it returns the same transfer instead of making a second one.
 */
async function attemptTransfer(supabase, payout, account, boutique, result) {
  const amountPaise = Math.round(Number(payout.amount) * 100);
  if (!(amountPaise > 0)) {
    // Nothing to send (net was zero) — close it out rather than leave it stuck.
    await supabase.rpc('mark_auto_payout_paid', { p_payout_id: payout.id });
    result.skippedZero += 1;
    return;
  }

  if (!account) {
    // Seller hasn't given us bank/UPI details yet — release and wait.
    await supabase.rpc('fail_auto_payout', { p_payout_id: payout.id, p_reason: 'no payout details on file' });
    result.noDetails += 1;
    return;
  }

  try {
    const pout = await createPayout({
      fundAccountId: account.fundAccountId,
      amountPaise,
      method: account.method,
      referenceId: `payout_${payout.id}`,
      narration: `MangaiMart ${boutique.name || 'payout'}`,
      idempotencyKey: payout.id,
    });

    // Record the provider id straight away so a webhook that races us can match.
    await supabase.rpc('set_auto_payout_reference', { p_payout_id: payout.id, p_provider_payout_id: pout.id });

    // RazorpayX may already report the payout done for fast rails; otherwise the
    // webhook flips it to paid. Anything not-yet-terminal stays 'processing'.
    if (pout.status === 'processed') {
      await supabase.rpc('mark_auto_payout_paid', {
        p_payout_id: payout.id,
        p_provider_payout_id: pout.id,
        p_utr: pout.utr ?? null,
      });
      result.paid += 1;
    } else {
      result.processing += 1;
    }
  } catch (e) {
    const reason = e instanceof RazorpayXError ? `${e.status}: ${e.message}` : e.message;
    await supabase.rpc('fail_auto_payout', { p_payout_id: payout.id, p_reason: reason });
    result.failed += 1;
    console.error('run-payouts: transfer failed for payout', payout.id, reason);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    res.setHeader('Allow', 'POST, GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!rxConfigured()) return res.status(200).json({ ok: true, skipped: 'RazorpayX not configured' });
  if (!authorized(req)) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) {
    console.error('run-payouts: Supabase service role not configured');
    return res.status(500).json({ error: 'Payout service is not configured' });
  }

  const result = {
    boutiques: 0, opened: 0, paid: 0, processing: 0, failed: 0, noDetails: 0, skippedZero: 0, recovered: 0,
    verifyStarted: 0, verifyPending: 0, verifyFailed: 0,
  };
  // The hold window is an admin-editable setting; an explicit env var still wins
  // so a deploy can pin it during an incident.
  const holdDays = HOLD_DAYS_ENV != null
    ? Math.max(0, Number(HOLD_DAYS_ENV) || 0)
    : (await loadTerms(supabase)).payout_hold_days;
  const cutoff = new Date(Date.now() - holdDays * 86400000).toISOString();

  try {
    // ── 1) Recover stuck transfers ──────────────────────────────────────────
    // A payout opened but never confirmed at RazorpayX (crash between the two).
    // Retrying is safe: the idempotency key blocks a duplicate transfer.
    const { data: stuck } = await supabase
      .from('payouts')
      .select('id, amount, boutique_id')
      .eq('provider', 'razorpayx')
      .eq('status', 'processing')
      .is('provider_payout_id', null)
      .limit(200);

    for (const payout of stuck ?? []) {
      const { data: boutique } = await supabase.from('boutiques').select(BOUTIQUE_COLS).eq('id', payout.boutique_id).maybeSingle();
      if (!boutique) continue;
      result.recovered += 1;
      let account = null;
      try {
        account = await ensureFundAccount(supabase, boutique);
      } catch (e) {
        await supabase.rpc('fail_auto_payout', { p_payout_id: payout.id, p_reason: `fund account: ${e.message}` });
        result.failed += 1;
        continue;
      }
      await attemptTransfer(supabase, payout, account, boutique, result);
    }

    // ── 2) Open + pay new eligible balances ─────────────────────────────────
    const { data: eligible, error: eligErr } = await supabase
      .from('orders')
      .select('boutique_id')
      .is('payout_id', null)
      .neq('payment_method', 'COD')
      .eq('payment_status', 'paid')
      .eq('refunded', false)
      .eq('status', 'delivered')
      .not('delivered_at', 'is', null)
      .lte('delivered_at', cutoff)
      .limit(5000);
    if (eligErr) throw eligErr;

    const boutiqueIds = [...new Set((eligible ?? []).map((o) => o.boutique_id))];

    for (const boutiqueId of boutiqueIds) {
      const { data: boutique } = await supabase.from('boutiques').select(BOUTIQUE_COLS).eq('id', boutiqueId).maybeSingle();
      if (!boutique) continue;
      result.boutiques += 1;

      // Register the bank/UPI first: if the seller has no details, don't even
      // open a payout — leave the orders outstanding until they add them.
      let account;
      try {
        account = await ensureFundAccount(supabase, boutique);
      } catch (e) {
        console.error('run-payouts: fund account setup failed for', boutiqueId, e.message);
        result.failed += 1;
        continue;
      }
      if (!account) {
        result.noDetails += 1;
        continue;
      }

      // Do not open a payout until the destination account is proven.
      const verified = await ensurePayoutVerified(supabase, boutique, account, result);
      if (!verified) continue;

      const { data: payout, error: openErr } = await supabase.rpc('open_auto_payout', {
        p_boutique_id: boutiqueId,
        p_cutoff: cutoff,
        p_method: account.method,
      });
      if (openErr) {
        console.error('run-payouts: open_auto_payout failed for', boutiqueId, openErr.message);
        result.failed += 1;
        continue;
      }
      if (!payout) continue; // nothing eligible after all (raced)
      result.opened += 1;

      await attemptTransfer(supabase, payout, account, boutique, result);
    }

    return res.status(200).json({ ok: true, holdDays, ...result });
  } catch (err) {
    console.error('run-payouts failed:', err?.message ?? err);
    return res.status(500).json({ error: 'Payout run failed', ...result });
  }
}
