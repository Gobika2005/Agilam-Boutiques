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
  description: string;
  expires_at: string;
  active?: boolean;
};

const COLUMNS =
  'id, code, boutique_id, type, off, min_subtotal, max_discount, description, expires_at, active, created_by, created_at, updated_at';

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
  const { data, error } = await supabase
    .from('coupons')
    .select(COLUMNS)
    .eq('active', true)
    .gte('expires_at', todayUTC());
  if (error) throw error;
  return (data ?? []).map(normalize);
}

/** Admin console: every coupon, newest first (RLS "admin all" returns them). */
export async function fetchAllCoupons(): Promise<CouponRow[]> {
  const { data, error } = await supabase
    .from('coupons')
    .select(COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(normalize);
}

/** Seller app: this boutique's own coupons, newest first. */
export async function fetchBoutiqueCoupons(boutiqueId: string): Promise<CouponRow[]> {
  const { data, error } = await supabase
    .from('coupons')
    .select(COLUMNS)
    .eq('boutique_id', boutiqueId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(normalize);
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
    description: input.description.trim(),
    expires_at: input.expires_at,
    active: input.active ?? true,
  };
}

export async function createCoupon(input: CouponInput): Promise<CouponRow> {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('coupons')
    .insert({ ...toDbFields(input), created_by: userData.user?.id ?? null })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return normalize(data);
}

export async function updateCoupon(id: string, input: CouponInput): Promise<CouponRow> {
  const { data, error } = await supabase
    .from('coupons')
    .update(toDbFields(input))
    .eq('id', id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return normalize(data);
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
