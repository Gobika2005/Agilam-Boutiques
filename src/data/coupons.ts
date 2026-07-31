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

const BASE_COLUMNS =
  'id, code, boutique_id, type, off, min_subtotal, max_discount, description, expires_at, active, created_by, created_at, updated_at';
/** Adds the redemption-limit columns from migration 0049. */
const COLUMNS = `${BASE_COLUMNS}, usage_limit, used_count`;

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
 * Whether this Supabase project has migration 0049. Latched on the first 42703
 * so an un-migrated project pays for exactly one failed request per page load
 * instead of one per query — the buyer app loads the active coupon list on every
 * screen, so retrying blindly meant a 400 everywhere, forever.
 */
let hasUsageColumns = true;

/** Run a coupons query, retrying without the 0049 columns if they aren't there. */
async function selectCoupons(
  build: (columns: string) => PromiseLike<{ data: unknown[] | null; error: { code?: string; message?: string } | null }>,
): Promise<CouponRow[]> {
  if (hasUsageColumns) {
    const first = await build(COLUMNS);
    if (!first.error) return (first.data ?? []).map((r) => normalize(r as Record<string, unknown>));
    if (!isMissingUsageColumns(first.error)) throw first.error;
    hasUsageColumns = false;
  }

  const legacy = await build(BASE_COLUMNS);
  if (legacy.error) throw legacy.error;
  return (legacy.data ?? []).map((r) => normalize(r as Record<string, unknown>));
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
  return selectCoupons((cols) =>
    supabase.from('coupons').select(cols).eq('active', true).gte('expires_at', todayUTC()));
}

/** Admin console: every coupon, newest first (RLS "admin all" returns them). */
export async function fetchAllCoupons(): Promise<CouponRow[]> {
  return selectCoupons((cols) =>
    supabase.from('coupons').select(cols).order('created_at', { ascending: false }));
}

/** Seller app: this boutique's own coupons, newest first. */
export async function fetchBoutiqueCoupons(boutiqueId: string): Promise<CouponRow[]> {
  return selectCoupons((cols) =>
    supabase.from('coupons').select(cols).eq('boutique_id', boutiqueId).order('created_at', { ascending: false }));
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

/** Drops the 0049-only fields, for a project that hasn't run that migration. */
function withoutUsageFields<T extends { usage_limit: number | null }>(fields: T): Omit<T, 'usage_limit'> {
  const { usage_limit: _drop, ...rest } = fields;
  return rest;
}

export async function createCoupon(input: CouponInput): Promise<CouponRow> {
  const { data: userData } = await supabase.auth.getUser();
  const fields = { ...toDbFields(input), created_by: userData.user?.id ?? null };
  const write = (payload: typeof fields | Omit<typeof fields, 'usage_limit'>, cols: string) =>
    supabase.from('coupons').insert(payload).select(cols).single() as unknown as
      PromiseLike<{ data: Record<string, unknown> | null; error: { code?: string; message?: string } | null }>;

  let data: Record<string, unknown> | null = null;
  let error: { code?: string; message?: string } | null = null;
  if (hasUsageColumns) {
    ({ data, error } = await write(fields, COLUMNS));
    if (error && isMissingUsageColumns(error)) hasUsageColumns = false;
  }
  if (!hasUsageColumns) {
    ({ data, error } = await write(withoutUsageFields(fields), BASE_COLUMNS));
  }
  if (error) throw error;
  return normalize(data ?? {});
}

export async function updateCoupon(id: string, input: CouponInput): Promise<CouponRow> {
  const fields = toDbFields(input);
  const write = (payload: typeof fields | Omit<typeof fields, 'usage_limit'>, cols: string) =>
    supabase.from('coupons').update(payload).eq('id', id).select(cols).single() as unknown as
      PromiseLike<{ data: Record<string, unknown> | null; error: { code?: string; message?: string } | null }>;

  let data: Record<string, unknown> | null = null;
  let error: { code?: string; message?: string } | null = null;
  if (hasUsageColumns) {
    ({ data, error } = await write(fields, COLUMNS));
    if (error && isMissingUsageColumns(error)) hasUsageColumns = false;
  }
  if (!hasUsageColumns) {
    ({ data, error } = await write(withoutUsageFields(fields), BASE_COLUMNS));
  }
  if (error) throw error;
  return normalize(data ?? {});
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
