import { supabase } from '@/lib/supabase';

/**
 * Coupon rows (migration 0036) and the CRUD the admin console + seller app use to
 * manage them. Pricing/eligibility maths live in `@/lib/pricing` (mirrored by the
 * server in `api/_pricing.js`); this file is only data access.
 *
 *  • boutique_id === null  → PLATFORM coupon (admin-created), discounts the whole
 *    cart, platform-funded.
 *  • boutique_id set       → SELLER coupon, discounts only that boutique's items,
 *    seller-funded (netted off that boutique's order total at checkout).
 */

export type CouponType = 'pct' | 'flat' | 'ship';

export type CouponRow = {
  id: string;
  code: string;
  /** null = platform/admin coupon; set = this boutique's own coupon. */
  boutique_id: string | null;
  type: CouponType;
  /** Percent for 'pct', rupees for 'flat', ignored for 'ship'. */
  off: number;
  min_subtotal: number;
  /** Cap on a 'pct' discount, in rupees; null = uncapped. */
  max_discount: number | null;
  /** Total redemptions allowed across all buyers; null = unlimited (0049). */
  usage_limit: number | null;
  /** Redemptions taken so far, maintained by the checkout (0049). */
  used_count: number;
  description: string;
  /** UTC YYYY-MM-DD. */
  expires_at: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Fields a create/edit form supplies. */
export type CouponInput = {
  code: string;
  boutique_id: string | null;
  type: CouponType;
  off: number;
  min_subtotal: number;
  max_discount: number | null;
  usage_limit: number | null;
  description: string;
  expires_at: string;
  active?: boolean;
};

/**
 * What a buyer may read.
 *
 * Migration 0058 revokes the blanket SELECT on `coupons` and grants exactly
 * this list to `anon` and `authenticated`, so asking for anything else here
 * fails the whole query with 42501 rather than quietly over-fetching. The three
 * withheld columns are `created_by` (an internal auth user id), `usage_limit`
 * and `used_count` (which together tell a stranger how many redemptions of a
 * limited offer are left to race for).
 */
const BASE_COLUMNS =
  'id, code, boutique_id, type, off, min_subtotal, max_discount, description, expires_at, active, created_at, updated_at';
/**
 * The operator-only columns: the redemption limits from 0049 and the author
 * from 0036.
 *
 * These are NOT selectable from `coupons` by anyone — migration 0058 revoked
 * the column privilege from `authenticated` as well as `anon`, and a column
 * privilege is checked before RLS, so being the boutique's owner or an admin
 * does not help. Asking for them in a normal select is a hard 42501, which is
 * exactly what killed both consoles until 0059.
 *
 * They come from `coupon_private_all()` instead (0059) — SECURITY DEFINER, one
 * round trip, entitlement enforced in its WHERE clause.
 */
type PrivateFields = { created_by: string | null; usage_limit: number | null; used_count: number };

/**
 * True when PostgREST rejected the query because migration 0049 has not been
 * applied to this project yet. Coupons then load without their redemption
 * fields instead of the whole screen erroring — the same graceful-degradation
 * `src/data/settings.ts` uses for its own late-arriving table.
 */
function isMissingUsageColumns(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42703' || /usage_limit|used_count/.test(error.message ?? '');
}

/**
 * Whether this Supabase project has migration 0059. Latched off on the first
 * failure so a project that hasn't run it pays for one failed RPC per page load
 * rather than one per query — the consoles still work, just without the
 * redemption counters, instead of showing a false empty list.
 */
let hasPrivateFn = true;

/**
 * The withheld columns for every coupon this user may manage, keyed by id.
 *
 * Returns an empty map rather than throwing: the counters are decoration on a
 * list that must render regardless, and a buyer calling this legitimately gets
 * nothing back.
 */
async function fetchPrivateFields(): Promise<Map<string, PrivateFields>> {
  const out = new Map<string, PrivateFields>();
  if (!hasPrivateFn) return out;

  const { data, error } = await supabase.rpc('coupon_private_all');
  if (error) {
    // PGRST202 is what PostgREST actually returns when the function isn't in its
    // schema cache — i.e. 0059 hasn't been applied to this project. (42883 is
    // the Postgres-level equivalent; 42703 means 0049 is missing.) Latch on all
    // three, or every coupon page load repeats a request that cannot succeed and
    // logs a console error each time.
    if (error.code === 'PGRST202' || error.code === '42883' || isMissingUsageColumns(error)) hasPrivateFn = false;
    return out;
  }
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    out.set(String(r.id), {
      created_by: (r.created_by as string | null) ?? null,
      usage_limit: r.usage_limit == null ? null : Number(r.usage_limit),
      used_count: Number(r.used_count ?? 0),
    });
  }
  return out;
}

/**
 * Run a console coupons query and graft the operator-only columns on.
 *
 * Errors from the row query propagate — a console that cannot read its own
 * coupons must say so, not render an empty list. That silent failure is how the
 * 0058 breakage stayed invisible in production.
 */
async function selectCoupons(
  build: () => PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>,
): Promise<CouponRow[]> {
  const [rows, priv] = await Promise.all([build(), fetchPrivateFields()]);
  if (rows.error) throw rows.error;
  return (rows.data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return normalize({ ...row, ...(priv.get(String(row.id)) ?? {}) });
  });
}

// PostgREST can hand a numeric column back as a string; coerce so the pricing
// maths (and the mirror check against the server) never compare a string.
function normalize(row: Record<string, unknown>): CouponRow {
  return {
    id: String(row.id),
    code: String(row.code ?? ''),
    boutique_id: (row.boutique_id as string | null) ?? null,
    type: (row.type as CouponType) ?? 'pct',
    off: Number(row.off ?? 0),
    min_subtotal: Number(row.min_subtotal ?? 0),
    max_discount: row.max_discount == null ? null : Number(row.max_discount),
    usage_limit: row.usage_limit == null ? null : Number(row.usage_limit),
    used_count: Number(row.used_count ?? 0),
    description: String(row.description ?? ''),
    expires_at: String(row.expires_at ?? ''),
    active: Boolean(row.active),
    created_by: (row.created_by as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  };
}

const todayUTC = () => new Date().toISOString().slice(0, 10);

/**
 * Every currently-valid coupon (active, not expired) — what the buyer app loads
 * to preview and resolve typed codes. RLS ("public read active") returns exactly
 * these to an anonymous buyer; the extra filters keep a signed-in seller's own
 * inactive rows out of the buyer-facing list.
 */
export async function fetchActiveCoupons(): Promise<CouponRow[]> {
  // Deliberately NOT routed through selectCoupons: the buyer app loads this on
  // every screen, and it has no use for the operator-only columns. Pairing it
  // with the `coupon_private_all()` call would put a second round trip — one
  // that returns nothing to a buyer — on every page load.
  const { data, error } = await supabase
    .from('coupons').select(BASE_COLUMNS).eq('active', true).gte('expires_at', todayUTC());
  if (error) throw error;
  return (data ?? []).map((r) => normalize(r as Record<string, unknown>));
}

/** Admin console: every coupon, newest first (RLS "admin all" returns them). */
export async function fetchAllCoupons(): Promise<CouponRow[]> {
  return selectCoupons(() =>
    supabase.from('coupons').select(BASE_COLUMNS).order('created_at', { ascending: false }));
}

/** Seller app: this boutique's own coupons, newest first. */
export async function fetchBoutiqueCoupons(boutiqueId: string): Promise<CouponRow[]> {
  return selectCoupons(() =>
    supabase.from('coupons').select(BASE_COLUMNS).eq('boutique_id', boutiqueId).order('created_at', { ascending: false }));
}

function toDbFields(input: CouponInput) {
  return {
    code: input.code.trim().toUpperCase(),
    boutique_id: input.boutique_id,
    type: input.type,
    off: input.type === 'ship' ? 0 : Math.max(0, input.off),
    min_subtotal: Math.max(0, input.min_subtotal),
    // A cap only means anything for a percentage discount.
    max_discount: input.type === 'pct' && input.max_discount != null ? Math.max(0, input.max_discount) : null,
    usage_limit: input.usage_limit != null ? Math.max(1, Math.round(input.usage_limit)) : null,
    description: input.description.trim(),
    expires_at: input.expires_at,
    active: input.active ?? true,
  };
}

/**
 * Run a coupon write and hand back the saved row.
 *
 * `RETURNING` is where the 0058 breakage actually bit: the INSERT/UPDATE itself
 * was always permitted (only SELECT was revoked), but asking for the withheld
 * columns back aborted the whole statement, so the coupon was never written and
 * the form reported nothing. The returning clause is BASE_COLUMNS only, and the
 * operator columns are grafted on afterwards.
 *
 * The one retry left is for a project without migration 0049, where
 * `usage_limit` does not exist as a column to write at all.
 */
async function writeCoupon<T extends { usage_limit: number | null }>(
  fields: T,
  send: (payload: T | Omit<T, 'usage_limit'>) => PromiseLike<{
    data: Record<string, unknown> | null;
    error: { code?: string; message?: string } | null;
  }>,
): Promise<CouponRow> {
  let { data, error } = await send(fields);
  if (error && isMissingUsageColumns(error)) {
    const { usage_limit: _drop, ...rest } = fields;
    ({ data, error } = await send(rest));
  }
  if (error) throw error;

  const saved = normalize(data ?? {});
  const priv = (await fetchPrivateFields()).get(saved.id);
  return priv ? { ...saved, ...priv } : saved;
}

export async function createCoupon(input: CouponInput): Promise<CouponRow> {
  const { data: userData } = await supabase.auth.getUser();
  const fields = { ...toDbFields(input), created_by: userData.user?.id ?? null };
  return writeCoupon(fields, (payload) =>
    supabase.from('coupons').insert(payload).select(BASE_COLUMNS).single() as unknown as
      PromiseLike<{ data: Record<string, unknown> | null; error: { code?: string; message?: string } | null }>);
}

export async function updateCoupon(id: string, input: CouponInput): Promise<CouponRow> {
  return writeCoupon(toDbFields(input), (payload) =>
    supabase.from('coupons').update(payload).eq('id', id).select(BASE_COLUMNS).single() as unknown as
      PromiseLike<{ data: Record<string, unknown> | null; error: { code?: string; message?: string } | null }>);
}

/** Flip a coupon on/off without opening the full editor. */
export async function setCouponActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('coupons').update({ active }).eq('id', id);
  if (error) throw error;
}

export async function deleteCoupon(id: string): Promise<void> {
  const { error } = await supabase.from('coupons').delete().eq('id', id);
  if (error) throw error;
}
