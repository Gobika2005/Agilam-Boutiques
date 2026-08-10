/**
 * Shiprocket tracking webhook — where "delivered" stops being the seller's word.
 *
 * This is the point of the whole integration. Before it, `api/run-payouts.js`
 * released real money on the strength of a seller tapping "Mark delivered":
 * self-attestation by the party being paid, with a 3-day hold as the only brake.
 * A courier scan arriving here is a third party with no stake in the payout.
 *
 * SECURITY. Shiprocket signs nothing — no HMAC, no signature header. All they
 * offer is a static token echoed in `x-api-key`, which you set in their panel.
 * That makes this endpoint exactly as strong as that shared secret, so it is
 * compared in constant time and the function refuses to run at all when the
 * secret is unset (an empty expected value would otherwise match an empty
 * header and let anyone mark orders delivered).
 *
 * RETRIES. Shiprocket re-sends on any non-2xx, indefinitely. So a payload we
 * cannot use — an AWB we never issued, a status we do not recognise — returns
 * 200 with an explanatory body. Only a genuine auth failure or a server fault
 * gets a non-2xx, because those are the only two worth retrying.
 *
 * All order writes go through apply_shipment_scan() (migration 0067). This
 * function decides nothing about an order; it authenticates, normalises and
 * forwards.
 */

import { json, mapStage, serviceClient } from '../_shared/shiprocket.ts';

/** Constant-time string compare. A plain `===` on a shared secret leaks its
 *  length and prefix to a patient caller; this endpoint can mark orders
 *  delivered, so it is worth the eight lines. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Scan = {
  awb?: string | number;
  current_status?: string;
  shipment_status?: string;
  current_timestamp?: string;
  scan_date_time?: string;
  location?: string;
  current_location?: string;
};

/** Their field names differ between the tracking webhook and the NDR one, and
 *  have changed across their API versions. Read defensively rather than pin to
 *  one shape — a rename must not silently stop delivering orders. */
function readScan(row: Scan) {
  const awb = String(row.awb ?? '').trim();
  const raw = (row.current_status ?? row.shipment_status ?? '').trim();
  const when = row.current_timestamp ?? row.scan_date_time ?? null;
  const where = row.location ?? row.current_location ?? null;

  let occurredAt: string | null = null;
  if (when) {
    // "2026-08-10 14:32:00" is not ISO — without the T, Date parsing is
    // implementation-defined. Normalise before trusting it, and drop the value
    // entirely if it still will not parse rather than storing an Invalid Date.
    const parsed = new Date(when.includes('T') ? when : when.replace(' ', 'T') + 'Z');
    occurredAt = Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  return { awb, raw, occurredAt, where };
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const expected = Deno.env.get('SHIPROCKET_WEBHOOK_TOKEN') ?? '';
  if (!expected) {
    console.error('SHIPROCKET_WEBHOOK_TOKEN is not set — refusing every webhook');
    return json({ error: 'Webhook not configured' }, 503);
  }

  const presented = req.headers.get('x-api-key') ?? '';
  if (!safeEqual(presented, expected)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: true, note: 'Unparseable body ignored' });
  }

  // They send a single object; batches have appeared in the wild. Accept both.
  const rows: Scan[] = Array.isArray(body) ? body as Scan[] : [body as Scan];
  const db = serviceClient();

  const results: { awb: string; stage?: string; applied: boolean; note?: string }[] = [];

  for (const row of rows) {
    const { awb, raw, occurredAt, where } = readScan(row);

    if (!awb || !raw) {
      results.push({ awb, applied: false, note: 'Missing awb or status' });
      continue;
    }

    const stage = mapStage(raw);

    const { data, error } = await db.rpc('apply_shipment_scan', {
      p_awb: awb,
      p_raw_status: raw,
      p_stage: stage,
      p_location: where,
      p_occurred_at: occurredAt,
      p_payload: row as unknown as Record<string, unknown>,
    });

    if (error) {
      // A database fault IS worth a retry — return non-2xx so they re-send.
      console.error('apply_shipment_scan failed', { awb, stage, error: error.message });
      return json({ error: 'Could not record the scan' }, 500);
    }

    // `false` means we have no shipment with that AWB. Logged, not retried:
    // re-sending will not conjure the row, and a permanent non-2xx would have
    // them hammering this endpoint forever.
    if (data === false) {
      console.warn('scan for an unknown AWB', { awb, raw });
      results.push({ awb, stage, applied: false, note: 'Unknown AWB' });
      continue;
    }

    results.push({ awb, stage, applied: true });
  }

  return json({ ok: true, results });
});
