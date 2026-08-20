import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/uploadImage';
import { normalizeCity } from '@/lib/cities';
import type { BoutiqueRow, BoutiquePrivate, BoutiqueStatus } from './types';

/**
 * The columns anon/authenticated are allowed to SELECT.
 *
 * Migration 0021 revoked the blanket SELECT on `boutiques` and granted these
 * columns back one by one, so that bank details and the admin's review note
 * cannot be read off the public API. A bare `select('*')` now fails with a
 * permission error — always select this list, and add any new column to the
 * grant in 0021 first.
 *
 * `email`, `phone` and `whatsapp` are NOT here. They were, because this one list
 * served both the storefront and the seller reading its own shop — which meant
 * every seller's mobile number and email were readable in bulk by anyone with
 * the anon key, and that key ships in the browser bundle. Migration 0073 revoked
 * all three and moved them behind `boutique_private()`; naming any of them in a
 * query here now fails with a permission error, which is the point. Owner and
 * admin surfaces get them through `fetchBoutiquePrivate()`.
 */
const BASE_COLUMNS = [
  'id', 'owner_id', 'name', 'slug', 'city', 'area', 'description', 'tone',
  'cover_url', 'logo_url', 'instagram', 'established_year',
  'verified', 'status', 'featured', 'rating', 'reviews_count',
  'followers_count', 'positive_rating', 'created_at',
  'owner_name',
  'address_line', 'district', 'state', 'pincode', 'map_url',
  'category', 'years_in_business',
  'open_time', 'close_time', 'working_days',
  'delivery_available', 'delivery_areas', 'delivery_charge',
  'online_payment_enabled',
  'onboarding_step', 'onboarding_complete', 'submitted_at', 'reviewed_at',
  'notify_orders', 'notify_messages', 'notify_promotions',
].join(', ');

/**
 * The sales counters added by migration 0023. Split out from the base list
 * because naming a column that does not exist yet fails the *whole* query —
 * which would take the buyer catalogue down on any deployment where 0023 has
 * not been applied. `selectBoutiques` retries without them instead.
 */
const COUNTER_COLUMNS = 'units_sold, orders_count';

/**
 * The seller's own delivery terms and map pin (migration 0076), in their own
 * optional group for the same reason as the counters above.
 *
 * If they are missing the storefront still works: `shopTerms` in
 * src/state/ShopContext.tsx falls back to charging `delivery_charge` with no
 * free-delivery threshold — and api/_pricing.js falls back identically, which is
 * what keeps the client and server totals in step on a deployment where 0076 has
 * not been applied yet. A mismatch there would reject legitimate checkouts as
 * underpaid.
 */
const TERMS_COLUMNS = 'latitude, longitude, free_delivery_over';

/**
 * The per-zone delivery rates (migration 0077), in their own group again —
 * without them a shop charges its single `delivery_charge` to every address,
 * which is exactly how it behaved before 0077 and is what api/_pricing.js falls
 * back to as well.
 */
const ZONE_COLUMNS = 'delivery_charge_district, delivery_charge_state, delivery_charge_national';

/**
 * What this shop promises about fulfilment (migration 0078) — its dispatch time
 * and its own return window. Its own optional group for the same reason as the
 * others: missing, the product page falls back to the platform copy it used
 * before, rather than the whole catalogue failing to load.
 */
const FULFILMENT_COLUMNS = 'dispatch_days_min, dispatch_days_max, return_window_days';

export const BOUTIQUE_COLUMNS = `${BASE_COLUMNS}, ${COUNTER_COLUMNS}, ${TERMS_COLUMNS}, ${ZONE_COLUMNS}, ${FULFILMENT_COLUMNS}`;

/**
 * Runs a boutique query with the optional column groups, dropping one group at a
 * time if the database does not have it yet — because naming a column that does
 * not exist fails the WHOLE query, and neither group is worth an empty shop.
 * Each decision is remembered for the session, so the fallback costs one extra
 * round trip in total rather than one per query.
 */
let countersAvailable = true;
let termsAvailable = true;
let zonesAvailable = true;
let fulfilmentAvailable = true;

function columnList(): string {
  return [
    BASE_COLUMNS,
    countersAvailable ? COUNTER_COLUMNS : '',
    termsAvailable ? TERMS_COLUMNS : '',
    zonesAvailable ? ZONE_COLUMNS : '',
    fulfilmentAvailable ? FULFILMENT_COLUMNS : '',
  ].filter(Boolean).join(', ');
}

async function selectBoutiques<T>(
  run: (columns: string) => PromiseLike<{ data: T; error: { message?: string; code?: string } | null }>,
): Promise<T> {
  for (;;) {
    const { data, error } = await run(columnList());
    if (!error) return data;
    // 42703 = undefined_column, 42501 = insufficient_privilege (column not granted).
    if (error.code !== '42703' && error.code !== '42501') throw error;
    // Drop the newest group first — it is the likelier one to be missing, and
    // dropping it may be enough on its own.
    if (fulfilmentAvailable) {
      fulfilmentAvailable = false;
      console.warn('[boutiques] dispatch times and per-shop return windows unavailable — apply migration 0078. The platform estimate will be shown instead.');
    } else if (zonesAvailable) {
      zonesAvailable = false;
      console.warn('[boutiques] delivery zone rates unavailable — apply migration 0077. Every address will be charged the shop’s local rate.');
    } else if (termsAvailable) {
      termsAvailable = false;
      console.warn('[boutiques] seller delivery terms unavailable — apply migration 0076. Delivery will be charged at each shop’s delivery_charge with no free-delivery threshold.');
    } else if (countersAvailable) {
      countersAvailable = false;
      console.warn('[boutiques] sales counters unavailable — apply migration 0023. Ranking will use ratings only.');
    } else {
      throw error;
    }
  }
}

/**
 * Canonicalise the typed city on the way out.
 *
 * The buyer directory groups shops by city and gives each one a landing page, so
 * "Cbe" and "Coimbatore" being two strings means two chips and two competing
 * pages for one place. Writes are normalised below and migration 0075 fixes the
 * rows already stored, but this read stays in place for anything written before
 * either landed — the storefront must never show a half-typed city.
 */
const withCity = <T extends { city?: string | null }>(row: T): T =>
  ({ ...row, city: normalizeCity(row.city) });

export async function fetchApprovedBoutiques(): Promise<BoutiqueRow[]> {
  const data = await selectBoutiques((cols) =>
    supabase.from('boutiques').select(cols).eq('status', 'approved').order('rating', { ascending: false }),
  );
  return ((data ?? []) as unknown as BoutiqueRow[]).map(withCity);
}

export async function fetchBoutique(id: string): Promise<BoutiqueRow | null> {
  const data = await selectBoutiques((cols) =>
    supabase.from('boutiques').select(cols).eq('id', id).maybeSingle(),
  );
  const row = data as unknown as BoutiqueRow | null;
  return row ? withCity(row) : null;
}

/**
 * Move a boutique's shared follower count up (follow) or down (unfollow) and
 * return the new total. Backed by a SECURITY DEFINER RPC so anonymous buyers
 * can update the count past RLS. The client guards against double-counting per
 * device via local storage.
 */
export async function followBoutique(id: string, follow: boolean): Promise<number> {
  const { data, error } = await supabase.rpc('toggle_boutique_follow', { bid: id, do_follow: follow });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/** Live-subscribe to a boutique's follower count; returns an unsubscribe fn. */
export function subscribeToBoutiqueFollowers(id: string, onChange: (count: number) => void) {
  const channel = supabase
    .channel(`boutique-followers:${id}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'boutiques', filter: `id=eq.${id}` },
      (payload) => {
        const row = payload.new as { followers_count?: number };
        if (typeof row.followers_count === 'number') onChange(row.followers_count);
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * The signed-in seller's own shop, contact details included.
 *
 * Two reads, because migration 0073 moved `email`/`phone`/`whatsapp` out of the
 * public column grant: the base row, then `boutique_private()` for the columns
 * only the owner (or an admin) may see. Merged here rather than at each screen
 * so Settings, the profile editor, Billing and the order detail all keep
 * reading `boutique.phone` exactly as they did.
 *
 * The private read is best-effort. If it fails — most likely because 0073 has
 * not been applied yet, in which case the columns are still on the base row
 * anyway — the seller gets their shop with blank contact fields instead of an
 * error page.
 */
export async function fetchMyBoutique(ownerId: string): Promise<BoutiqueRow | null> {
  const { data, error } = await supabase.from('boutiques').select(BOUTIQUE_COLUMNS).eq('owner_id', ownerId).maybeSingle();
  if (error) throw error;
  const row = data as unknown as BoutiqueRow | null;
  if (!row) return null;
  return { ...row, ...(await contactFields(row.id)) };
}

/**
 * Owner-or-admin contact details for one shop, or blanks. Never throws: these
 * are display fields, and losing them should not take a console screen down.
 */
async function contactFields(boutiqueId: string): Promise<Pick<BoutiqueRow, 'email' | 'phone' | 'whatsapp'>> {
  try {
    const priv = await fetchBoutiquePrivate(boutiqueId);
    return { email: priv?.email ?? null, phone: priv?.phone ?? null, whatsapp: priv?.whatsapp ?? null };
  } catch (e) {
    console.warn('[boutiques] contact details unavailable — apply migration 0073.', e);
    return { email: null, phone: null, whatsapp: null };
  }
}

/**
 * Read the columns withheld by 0021's grants (GST, payout details, the admin's
 * review note). Goes through the `boutique_private` SECURITY DEFINER function,
 * which answers only for the boutique's owner or an admin.
 */
export async function fetchBoutiquePrivate(boutiqueId: string): Promise<BoutiquePrivate | null> {
  const { data, error } = await supabase.rpc('boutique_private', { bid: boutiqueId });
  if (error) throw error;
  const rows = (data ?? []) as BoutiquePrivate[];
  return rows[0] ?? null;
}

/**
 * Create the signed-in seller's boutique. Starts as a `draft` so the admin
 * queue only ever shows boutiques that have actually been submitted for review.
 */
export async function createMyBoutique(ownerId: string, input: { name: string; city: string; owner_name?: string }): Promise<BoutiqueRow> {
  const { data, error } = await supabase
    .from('boutiques')
    .insert({
      owner_id: ownerId,
      name: input.name,
      // Canonical from the first keystroke it is stored under — see withCity.
      city: normalizeCity(input.city),
      owner_name: input.owner_name ?? '',
      status: 'draft',
      tone: Math.floor(Math.random() * 8),
    })
    .select(BOUTIQUE_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as BoutiqueRow;
}

/**
 * Everything the seller can write to their own boutique row. The columns the
 * seller must never set themselves — status, verified, featured, review_note,
 * reviewed_at — are absent on purpose; only `setBoutiqueStatus` (admin, guarded
 * by RLS) touches those.
 */
export type BoutiquePatch = Partial<{
  name: string;
  city: string;
  area: string;
  description: string;
  phone: string | null;
  instagram: string | null;
  cover_url: string | null;
  logo_url: string | null;
  owner_name: string;
  whatsapp: string | null;
  email: string | null;
  address_line: string;
  district: string;
  state: string;
  pincode: string;
  map_url: string | null;
  latitude: number | null;
  longitude: number | null;
  category: string;
  gst_number: string | null;
  business_reg_number: string | null;
  years_in_business: number | null;
  established_year: number | null;
  open_time: string;
  close_time: string;
  working_days: string[];
  delivery_available: boolean;
  delivery_areas: string;
  delivery_charge: number;
  delivery_charge_district: number | null;
  delivery_charge_state: number | null;
  delivery_charge_national: number | null;
  dispatch_days_min: number;
  dispatch_days_max: number;
  return_window_days: number;
  free_delivery_over: number;
  online_payment_enabled: boolean;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  upi_id: string | null;
  onboarding_step: number;
  notify_orders: boolean;
  notify_messages: boolean;
  notify_promotions: boolean;
}>;

/**
 * Every seller-side write to the row goes through here, so this is the one place
 * that has to canonicalise the city. `city` is only touched when the patch
 * actually carries one — writing `''` on an unrelated patch would wipe it.
 */
const patchWithCity = (patch: BoutiquePatch): BoutiquePatch =>
  patch.city === undefined ? patch : { ...patch, city: normalizeCity(patch.city) };

export async function updateBoutique(id: string, patch: BoutiquePatch) {
  const { error } = await supabase.from('boutiques').update(patchWithCity(patch)).eq('id', id);
  if (error) throw error;
}

/**
 * Finish the wizard: mark onboarding complete and hand the boutique to the
 * admin queue. Also used to resubmit after a "needs changes" decision, which is
 * why it clears the previous review note and timestamp — 0021's trigger allows
 * a seller to null those two fields precisely on this transition, so the status
 * screen stops showing feedback they have already acted on.
 */
export async function submitBoutiqueForReview(id: string, patch: BoutiquePatch = {}) {
  const { error } = await supabase
    .from('boutiques')
    .update({
      ...patchWithCity(patch),
      onboarding_step: 7,
      onboarding_complete: true,
      status: 'pending',
      submitted_at: new Date().toISOString(),
      reviewed_at: null,
      review_note: null,
    })
    .eq('id', id);
  if (error) throw error;
}

/** Uploads a boutique logo/cover to the public `boutique-images` bucket.
 *
 *  `name` is the shop's own name where the caller has it, so the file lands as
 *  `mangaimart-menmai-boutique-logo-<id>.png` — the one piece of text that
 *  travels with the image if it is hotlinked or saved. */
export async function uploadBoutiqueImage(
  boutiqueId: string,
  kind: 'logo' | 'cover',
  file: File,
  name?: string,
): Promise<string> {
  return uploadImage('boutique-images', `${boutiqueId}/${kind}`, file, '0019', `${name || 'boutique'} ${kind}`);
}

export interface AdminBoutiqueRow extends BoutiqueRow {
  owner: { full_name: string } | null;
}

/**
 * Every boutique, whatever its status, for the admin table and the approval
 * queue.
 *
 * Goes through `selectBoutiques` for exactly the reason the storefront does:
 * this list names four optional column groups (0023, 0076, 0077a, 0078b), and
 * naming a column the database does not have — or has not granted — fails the
 * WHOLE query, not just that column. Without the ladder a single unapplied
 * migration emptied both admin screens while the storefront, which already had
 * it, carried on working.
 */
export async function fetchAllBoutiquesAdmin(): Promise<AdminBoutiqueRow[]> {
  const data = await selectBoutiques((cols) =>
    supabase
      .from('boutiques')
      .select(`${cols}, owner:profiles!boutiques_owner_id_fkey(full_name)`)
      .order('created_at', { ascending: false }),
  );
  return ((data ?? []) as unknown as AdminBoutiqueRow[]).map(withCity);
}

/**
 * Record the admin's decision. `note` is the correction list a seller sees on
 * their verification screen — required for `changes_requested` and `rejected`
 * so nobody is sent back without being told what to fix.
 */
export async function setBoutiqueStatus(id: string, status: BoutiqueStatus, note?: string) {
  const { error } = await supabase
    .from('boutiques')
    .update({
      status,
      verified: status === 'approved',
      reviewed_at: new Date().toISOString(),
      review_note: status === 'approved' ? null : (note?.trim() || null),
    })
    .eq('id', id);
  if (error) throw error;
}

/** Toggle whether a boutique is featured across the marketplace. Admin-only via RLS. */
export async function setBoutiqueFeatured(id: string, featured: boolean) {
  const { error } = await supabase.from('boutiques').update({ featured }).eq('id', id);
  if (error) throw error;
}
