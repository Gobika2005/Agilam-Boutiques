import { supabase } from '@/lib/supabase';
import { uploadImage } from '@/lib/uploadImage';
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
  'cod_enabled', 'online_payment_enabled',
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

export const BOUTIQUE_COLUMNS = `${BASE_COLUMNS}, ${COUNTER_COLUMNS}`;

/**
 * Runs a boutique query with the counter columns, falling back to the base
 * column list once per session if the database does not have them yet. The
 * counters only feed ranking, so their absence should cost a slightly duller
 * "Best-selling boutiques" order — never an empty shop.
 */
let countersAvailable = true;

async function selectBoutiques<T>(
  run: (columns: string) => PromiseLike<{ data: T; error: { message?: string; code?: string } | null }>,
): Promise<T> {
  if (countersAvailable) {
    const { data, error } = await run(BOUTIQUE_COLUMNS);
    if (!error) return data;
    // 42703 = undefined_column, 42501 = insufficient_privilege (column not granted).
    if (error.code !== '42703' && error.code !== '42501') throw error;
    countersAvailable = false;
    console.warn('[boutiques] sales counters unavailable — apply migration 0023. Ranking will use ratings only.');
  }
  const { data, error } = await run(BASE_COLUMNS);
  if (error) throw error;
  return data;
}

export async function fetchApprovedBoutiques(): Promise<BoutiqueRow[]> {
  const data = await selectBoutiques((cols) =>
    supabase.from('boutiques').select(cols).eq('status', 'approved').order('rating', { ascending: false }),
  );
  return (data ?? []) as unknown as BoutiqueRow[];
}

export async function fetchBoutique(id: string): Promise<BoutiqueRow | null> {
  const data = await selectBoutiques((cols) =>
    supabase.from('boutiques').select(cols).eq('id', id).maybeSingle(),
  );
  return data as unknown as BoutiqueRow | null;
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
      city: input.city,
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
  cod_enabled: boolean;
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

export async function updateBoutique(id: string, patch: BoutiquePatch) {
  const { error } = await supabase.from('boutiques').update(patch).eq('id', id);
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
      ...patch,
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

export async function fetchAllBoutiquesAdmin(): Promise<AdminBoutiqueRow[]> {
  const { data, error } = await supabase
    .from('boutiques')
    .select(`${BOUTIQUE_COLUMNS}, owner:profiles!boutiques_owner_id_fkey(full_name)`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AdminBoutiqueRow[];
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
