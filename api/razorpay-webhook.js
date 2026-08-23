import { serviceClient } from './_supabase.js';
import { verifyWebhookSignature, webhookConfigured } from './_razorpay.js';

/**
 * Vercel serverless function: Razorpay webhook backstop.
 *
 * api/place-order.js already confirms payments synchronously (fetch order +
 * verify signature + assert amount/paid), so the happy path never depends on
 * this endpoint. Its job is the edge case where a buyer's payment is captured
 * but the browser dies before place-order runs: Razorpay still delivers a
 * `payment.captured` / `order.paid` webhook, and this handler reconciles it.
 *
 * Reconciliation is deliberately conservative:
 *   • It verifies the webhook HMAC (RAZORPAY_WEBHOOK_SECRET) over the RAW body.
 *   • If an order already carries this payment_id, it's a no-op (the sync path
 *     won the race) — nothing to do.
 *   • If no order exists after a short grace window, the captured-but-unfulfilled
 *     payment is recorded to `payment_events` (when that table exists) and logged
 *     so it can be refunded / fulfilled by an operator. It does NOT auto-refund,
 *     because place-order legitimately writes the order milliseconds after
 *     capture and racing a refund would cancel good orders.
 *
 * It also resolves refund outcomes (0097). An admin refund is recorded as
 * 'pending' the instant Razorpay accepts it; `refund.processed` confirms the
 * buyer has the money and `refund.failed` says they do not — the latter puts the
 * order back in the refund workbench, because nothing else in the system would
 * ever notice.
 *
 * Setup: add this URL as a webhook in the Razorpay dashboard for the
 * `payment.captured`, `order.paid`, `refund.processed` and `refund.failed`
 * events, using RAZORPAY_WEBHOOK_SECRET as the secret. Without the secret
 * configured the endpoint is an inert 200 no-op.
 *
 * With a backup merchant account configured, add the SAME webhook in that
 * account's dashboard too and set RAZORPAY_WEBHOOK_SECRET_B (or reuse one secret
 * string for both). Deliveries are authenticated against every account's secret,
 * so this endpoint keeps reconciling whichever account is currently collecting —
 * including payments still landing from the account just switched away from.
 *
 * IMPORTANT: signature verification needs the unparsed body, so body parsing is
 * disabled for this route.
 */

export const config = { api: { bodyParser: false } };

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function readRawBody(req) {
  // Vercel may pre-parse; prefer the raw stream, fall back to a stringified body.
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

  // No secret configured on any account → inert. Return 200 so Razorpay doesn't
  // retry-storm.
  if (!webhookConfigured()) return res.status(200).json({ ok: true, skipped: 'webhook not configured' });

  let raw;
  try {
    raw = await readRawBody(req);
  } catch {
    return res.status(400).json({ error: 'Could not read webhook body' });
  }

  // Authenticated against every configured account's webhook secret; the match
  // also tells us which merchant account the delivery came from.
  const signature = req.headers?.['x-razorpay-signature'];
  const account = verifyWebhookSignature(raw, signature);
  if (!account) {
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return res.status(400).json({ error: 'Malformed webhook payload' });
  }

  const type = event?.event;
  const paymentEntity = event?.payload?.payment?.entity;
  const paymentId = paymentEntity?.id ?? null;
  const orderId = paymentEntity?.order_id ?? event?.payload?.order?.entity?.id ?? null;

  // ── Refund outcomes (0097) ────────────────────────────────────────────────
  // /admin/refunds records a refund as 'pending' the moment Razorpay accepts it,
  // because the money is already committed and the payout run must stop counting
  // the order as owed. This is where that pending state resolves — and the only
  // place we ever learn that a refund FAILED and the buyer is still out of pocket.
  if (type === 'refund.processed' || type === 'refund.failed') {
    const refundEntity = event?.payload?.refund?.entity;
    const refundId = refundEntity?.id ?? null;
    if (!refundId) return res.status(200).json({ ok: true, ignored: type });

    const supabase = serviceClient(supabaseUrl, serviceRoleKey);
    if (!supabase) {
      console.error('razorpay-webhook: Supabase not configured; cannot record refund', refundId);
      return res.status(200).json({ ok: true, reconciled: false });
    }

    try {
      const { data: order } = await supabase
        .from('orders')
        .select('id, order_number, refund_status')
        .eq('refund_id', refundId)
        .limit(1)
        .maybeSingle();

      // Not ours to reconcile — an ad refund (api/_ads.js) or a dashboard refund
      // on a payment we never issued one for.
      if (!order) return res.status(200).json({ ok: true, ignored: 'refund not on an order', refundId });

      const status = type === 'refund.processed' ? 'processed' : 'failed';
      if (order.refund_status === status) {
        return res.status(200).json({ ok: true, reconciled: true, unchanged: true });
      }

      const { error: markErr } = await supabase.rpc('mark_order_refunded', {
        p_order_id: order.id,
        p_refund_id: refundId,
        p_amount: null,
        p_status: status,
        p_reason: null,
      });
      if (markErr) {
        console.error('razorpay-webhook: could not record refund outcome', refundId, markErr.message ?? markErr);
        return res.status(200).json({ ok: true, reconciled: false });
      }

      if (status === 'failed') {
        // mark_order_refunded has just put `refunded` back to false, so the order
        // returns to the refund workbench and to the payout run. Someone has to
        // look at it: the buyer asked for their money and did not get it.
        console.error(
          `razorpay-webhook: REFUND FAILED for order ${order.order_number} (${refundId}) on the '${account.key}' account — buyer has not been refunded`,
        );
      }
      return res.status(200).json({ ok: true, reconciled: true, refundId, status });
    } catch (err) {
      console.error('razorpay-webhook: refund reconciliation failed', err?.message ?? err);
      return res.status(200).json({ ok: true, reconciled: false });
    }
  }

  // Only captured-payment events need reconciling; ack everything else.
  if (!paymentId || (type !== 'payment.captured' && type !== 'order.paid')) {
    return res.status(200).json({ ok: true, ignored: type ?? 'unknown' });
  }

  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) {
    // Can't reconcile without DB access; ack so Razorpay stops retrying, but log.
    console.error('razorpay-webhook: Supabase not configured; cannot reconcile', paymentId);
    return res.status(200).json({ ok: true, reconciled: false });
  }

  try {
    const { data: order } = await supabase
      .from('orders')
      .select('id')
      .eq('payment_id', paymentId)
      .limit(1)
      .maybeSingle();

    if (order) {
      // Sync path already placed the order — nothing to do.
      return res.status(200).json({ ok: true, reconciled: true, alreadyFulfilled: true });
    }

    // Not a shop order. It may be an AD payment whose browser died before
    // activate-ad ran: create-ad-order stamped the draft with this Razorpay
    // order id, so settle it the same way the sync path would. Idempotent — a
    // draft already moved on returns nothing and falls through.
    if (orderId) {
      const { data: settledAd, error: adErr } = await supabase.rpc('reconcile_ad_campaign', {
        p_order_id: orderId,
        p_payment_id: paymentId,
      });
      if (adErr) {
        console.error('razorpay-webhook: ad reconcile failed', adErr.message ?? adErr);
      } else if (settledAd?.id) {
        return res.status(200).json({ ok: true, reconciled: true, adCampaign: settledAd.id });
      }
    }

    // Captured but no order yet. Record for operator follow-up. The insert is
    // best-effort and idempotent on payment_id; a missing table is not an error.
    const { error: logErr } = await supabase.from('payment_events').upsert(
      {
        payment_id: paymentId,
        order_ref: orderId,
        event_type: type,
        amount: paymentEntity?.amount ?? null,
        status: 'captured_unfulfilled',
        raw: event,
      },
      { onConflict: 'payment_id' },
    );
    if (logErr && logErr.code !== 'PGRST205' && !/relation .* does not exist/i.test(logErr.message || '')) {
      console.error('razorpay-webhook: could not record event', logErr.message ?? logErr);
    }

    // Name the account: an operator chasing this payment has to open the right
    // Razorpay dashboard to find it.
    console.warn(`razorpay-webhook: captured payment with no order on the '${account.key}' account (needs review):`, paymentId);
    return res.status(200).json({ ok: true, reconciled: false, needsReview: true });
  } catch (err) {
    // Never 5xx a webhook we've already authenticated — that just triggers
    // Razorpay retries. Log and ack.
    console.error('razorpay-webhook: reconciliation failed', err?.message ?? err);
    return res.status(200).json({ ok: true, reconciled: false });
  }
}
