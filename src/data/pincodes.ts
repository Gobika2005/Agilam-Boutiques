import { supabase } from '@/lib/supabase';
import { PINCODE_RE, lookupPincodeUpstream, type PincodeArea } from '@/lib/pincode';

/**
 * The pincode directory: which district and state a pincode is in.
 *
 * Three layers, cheapest first — this page load, then the `pincodes` table
 * (migration 0077), then India Post, whose answer is written back to the table
 * for everyone after it.
 *
 * The table is not just a speed-up. Delivery is priced by zone, and the zone is
 * decided by comparing the buyer's district and state against the shop's — in
 * the browser when it quotes the total, and again on the server before it
 * accepts the payment. Two independent lookups of the same pincode can disagree
 * (a transient API failure, a spelling that changed between calls) and the
 * disagreement would surface to a buyer as a rejected checkout. Reading one
 * stored row makes that impossible.
 *
 * Every failure resolves to `null`, meaning "we don't know where this is".
 * Callers must treat that as its own case: pricing falls back to the shop's
 * furthest zone rather than its cheapest, so an unknown pincode can never be
 * quoted as a local delivery.
 */

/** Resolved lookups for this page load, including the `null` misses. */
const memo = new Map<string, PincodeArea | null>();

/** Set once the `pincodes` table answers with "no such table" — on a deployment
 *  without 0077 we go straight to India Post rather than failing every read. */
let tableAvailable = true;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === 'PGRST205' || error.code === '42P01' || /relation .*pincodes.* does not exist/i.test(error.message ?? '');
}

async function readRow(code: string): Promise<PincodeArea | null> {
  if (!tableAvailable) return null;
  const { data, error } = await supabase
    .from('pincodes')
    .select('pincode, district, state, places')
    .eq('pincode', code)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) {
      tableAvailable = false;
      console.warn('[pincodes] directory table missing — apply migration 0077. Falling back to the live lookup.');
    } else {
      console.error('pincodes: read failed:', error.message);
    }
    return null;
  }
  if (!data) return null;
  return {
    pincode: data.pincode,
    district: data.district ?? '',
    state: data.state ?? '',
    places: Array.isArray(data.places) ? data.places : [],
  };
}

/** Write what we learned back for everyone else. Best-effort and silent: a
 *  failed cache write must never fail the lookup that succeeded. */
async function saveRow(area: PincodeArea): Promise<void> {
  if (!tableAvailable) return;
  try {
    const { error } = await supabase.rpc('upsert_pincode', {
      p_pincode: area.pincode,
      p_district: area.district,
      p_state: area.state,
      p_places: area.places,
    });
    if (error && isMissingTable(error)) tableAvailable = false;
  } catch {
    /* offline, or the function is not there yet */
  }
}

/**
 * Where a pincode is. Null when we could not find out — never a guess.
 *
 * Safe to call repeatedly and concurrently: in-flight lookups are shared, so a
 * cart with four boutiques resolving the same delivery pincode issues one
 * request rather than four.
 */
const inflight = new Map<string, Promise<PincodeArea | null>>();

export function resolvePincode(pin: string | null | undefined): Promise<PincodeArea | null> {
  const code = String(pin ?? '').trim();
  if (!PINCODE_RE.test(code)) return Promise.resolve(null);
  if (memo.has(code)) return Promise.resolve(memo.get(code) ?? null);

  const existing = inflight.get(code);
  if (existing) return existing;

  const run = (async () => {
    const stored = await readRow(code);
    if (stored && stored.district && stored.state) {
      memo.set(code, stored);
      return stored;
    }
    const fresh = await lookupPincodeUpstream(code);
    if (fresh) void saveRow(fresh);
    // A miss is memoised too — an unknown pincode stays unknown for this page
    // load rather than re-asking on every keystroke and every cart re-price.
    memo.set(code, fresh);
    return fresh;
  })().finally(() => { inflight.delete(code); });

  inflight.set(code, run);
  return run;
}

/** The already-resolved answer, or undefined if it has not been looked up yet.
 *  For synchronous render paths (pricing memos) that cannot await. */
export function knownPincode(pin: string | null | undefined): PincodeArea | null | undefined {
  const code = String(pin ?? '').trim();
  return memo.get(code);
}
