import { serviceClient } from './_supabase.js';
import { enforceRateLimit } from './_rateLimit.js';

/**
 * Vercel serverless function: is checkout actually able to work right now?
 *
 * This exists because of a failure that was invisible from the outside. The
 * browser talks to Supabase with the anon key, so the catalogue, product pages
 * and the whole shop kept rendering perfectly — while /api/place-order, which
 * uses the SERVICE-ROLE key, could not read a single row. Every checkout ended
 * on "Could not place the order. Please try again.", and nothing on the site
 * distinguished that from a transient glitch.
 *
 * The two credentials are configured in different places (the anon key is baked
 * into the build, the service-role key lives only in the Vercel project's
 * environment variables), so one can rot without the other. This endpoint is the
 * cheapest way to tell them apart: hit it after any deploy or key rotation and
 * it says, in one line, whether orders can be written.
 *
 * Deliberately returns no secrets — only whether each dependency is configured,
 * whether the round-trip worked, and the provider's own error text when it
 * didn't ("Invalid API key" and friends, which is the part you need).
 */

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;

function configured(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return v !== '' && v !== 'undefined' && v !== 'null';
}

/**
 * Run one probe and flatten it into a reportable result.
 *
 * A HEAD/count probe alone proved not to be enough: it came back healthy while
 * the identical table was unreadable with a real column list, which sent a whole
 * debugging session down the wrong path. So each probe below mirrors an actual
 * query the checkout makes, verbatim, and reports the provider's own message,
 * code and HTTP status rather than a boolean.
 */
async function probe(name, run) {
  try {
    const { error, status, count, data } = await run();
    if (error) {
      return {
        name,
        ok: false,
        // status 0 is postgrest-js's marker for "the fetch itself never
        // completed" (DNS, TLS, socket) as opposed to a rejection from PostgREST.
        status: status ?? 0,
        error: error.message || 'Unknown PostgREST error',
        code: error.code || undefined,
        hint: error.hint || undefined,
      };
    }
    // Row counts, never row contents. A count that disagrees with what the
    // browser sees is how you catch the functions being pointed at a different
    // Supabase project than the front end — which no error message would reveal.
    return {
      name,
      ok: true,
      status: status ?? 200,
      ...(typeof count === 'number' && { count }),
      ...(Array.isArray(data) && { rows: data.length }),
    };
  } catch (err) {
    return { name, ok: false, status: 0, error: err?.message ?? String(err) };
  }
}

/**
 * Exercise the exact queries an order depends on, in the order place-order runs
 * them, so the first failing probe names the broken step.
 */
async function checkDatabase() {
  if (!configured(supabaseUrl)) {
    return { ok: false, error: 'SUPABASE_URL (or VITE_SUPABASE_URL) is not set' };
  }
  if (!configured(serviceRoleKey)) {
    return { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not set' };
  }

  const supabase = serviceClient(supabaseUrl, serviceRoleKey);
  if (!supabase) return { ok: false, error: 'Supabase service client could not be created' };

  // Deliberately no `head: true` probes anywhere here. postgrest-js rewrites a
  // 404 with an empty body — exactly what a HEAD against a missing table
  // returns — into a successful 204 with no error. A HEAD probe therefore
  // reports a completely empty Supabase project as healthy, which is precisely
  // the false clean bill of health that hid this bug. Every probe reads real
  // columns so the table has to genuinely exist to pass.
  const probes = [];

  // The place-order column list, first without a filter and then through the
  // same `.in()` filter, so a column-privilege problem is distinguishable from a
  // filter/URL problem.
  const sample = await supabase.from('products').select('id, title, price, color, boutique_id').limit(1);
  probes.push(await probe('products.select', async () => sample));

  const sampleId = Array.isArray(sample.data) && sample.data[0]?.id;
  if (sampleId) {
    probes.push(await probe('products.in', () =>
      supabase.from('products').select('id, title, price, color, boutique_id').in('id', [sampleId])));
  }

  probes.push(await probe('boutiques.select', () =>
    supabase.from('boutiques').select('id, name, cod_enabled, status').limit(1)));
  probes.push(await probe('orders.select', () =>
    supabase.from('orders').select('id, order_number, payment_status, cod_fee, shipping_fee').limit(1)));
  // Empty array is a deliberate no-op: it proves the function exists and is
  // callable by this role without touching a single unit of stock.
  probes.push(await probe('rpc.reserve_stock', () => supabase.rpc('reserve_stock', { p_items: [] })));

  const failed = probes.filter((p) => !p.ok);
  return {
    ok: failed.length === 0,
    // The single highest-value check here. The browser reads Supabase via the
    // build-time VITE_SUPABASE_URL while the functions prefer the server-only
    // SUPABASE_URL, so the two can silently address DIFFERENT projects: the shop
    // browses perfectly against one while every order is written to another.
    // If that second project is empty, checkout fails with errors that look
    // nothing like a misrouted URL.
    ...(urlMismatch() && { urlMismatch: urlMismatch() }),
    // Which Supabase project the FUNCTIONS are pointed at. The host is already
    // public (it ships in the browser bundle); the key never appears here.
    project: hostOf(supabaseUrl),
    // Supabase's legacy JWT keys and its newer sb_secret_ keys are configured in
    // different places and can be disabled independently, so which kind is in
    // use is the first thing worth knowing when auth misbehaves.
    keyFormat: keyFormatOf(serviceRoleKey),
    probes,
    ...(failed.length > 0 && { error: `${failed[0].name}: ${failed[0].error}` }),
  };
}

/**
 * Describes the API/browser project split when there is one, or null when both
 * point at the same Supabase project (including when SUPABASE_URL is unset and
 * the functions simply inherit VITE_SUPABASE_URL, which is the safe default).
 */
function urlMismatch() {
  const apiUrl = process.env.SUPABASE_URL;
  const browserUrl = process.env.VITE_SUPABASE_URL;
  if (!configured(apiUrl) || !configured(browserUrl)) return null;
  const api = hostOf(apiUrl);
  const browser = hostOf(browserUrl);
  if (api === browser) return null;
  return {
    api,
    browser,
    fix: 'The /api functions and the shop are on different Supabase projects. Point SUPABASE_URL at the browser’s project and use THAT project’s service-role key, or unset SUPABASE_URL so the functions inherit VITE_SUPABASE_URL.',
  };
}

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'unparseable';
  }
}

// Shape only — never any part of the secret itself.
function keyFormatOf(key) {
  const v = String(key).trim();
  if (v.startsWith('sb_secret_')) return 'sb_secret';
  if (v.startsWith('sb_publishable_')) return 'sb_publishable (WRONG — this is the browser key)';
  if (v.startsWith('eyJ')) return 'legacy JWT';
  return 'unrecognised';
}

/**
 * Does the gateway actually accept these keys?
 *
 * Checking only that the two variables are non-empty was the same false
 * assurance this endpoint exists to kill: an invalid or rotated test key is a
 * perfectly well-formed string, so health reported `checkoutReady: true` while
 * every prepaid checkout died on Razorpay's 401 and the buyer saw nothing but
 * "Could not create payment order".
 *
 * `GET /v1/payments?count=1` is the cheapest authenticated read Razorpay
 * offers: it moves no money, creates nothing, and a 401 there is exactly the
 * 401 /api/create-order would hit. Only the gateway's own message is reported —
 * never the key.
 */
async function checkRazorpay() {
  if (!configured(razorpayKeyId) || !configured(razorpayKeySecret)) {
    return { ok: false, error: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not both set' };
  }
  const mode = razorpayKeyId.startsWith('rzp_live') ? 'live' : razorpayKeyId.startsWith('rzp_test') ? 'test' : 'unknown';
  try {
    const auth = Buffer.from(`${razorpayKeyId}:${razorpayKeySecret}`).toString('base64');
    const r = await fetch('https://api.razorpay.com/v1/payments?count=1', {
      headers: { Authorization: `Basic ${auth}` },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) return { ok: true, mode, status: r.status };
    let description = `HTTP ${r.status}`;
    try {
      const body = await r.json();
      description = body?.error?.description || description;
    } catch { /* keep the status line */ }
    return { ok: false, mode, status: r.status, error: description };
  } catch (err) {
    // A network/DNS failure reaching Razorpay is not proof the keys are wrong,
    // so say so rather than branding them invalid.
    return { ok: false, mode, error: `Could not reach Razorpay: ${err?.message ?? String(err)}` };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await enforceRateLimit(req, res, { key: 'health', limit: 30, windowMs: 60_000 }))) return;

  const [database, razorpay] = await Promise.all([checkDatabase(), checkRazorpay()]);

  // Orders need both: the gateway to take the money and the service role to
  // write the row. Either one down means checkout is down.
  const checkoutReady = database.ok && razorpay.ok;

  res.setHeader('Cache-Control', 'no-store');
  return res.status(checkoutReady ? 200 : 503).json({
    checkoutReady,
    database,
    razorpay,
    checkedAt: new Date().toISOString(),
  });
}
