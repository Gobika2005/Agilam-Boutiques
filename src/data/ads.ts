import { supabase } from '@/lib/supabase';
import { payForAd } from '@/lib/razorpay';
import type { Database, AdStatus, AdPlacementCode, AdSubjectType } from '@/types/database';

export type AdCampaign = Database['public']['Tables']['ad_campaigns']['Row'];
export type AdPlacement = Database['public']['Tables']['ad_placements']['Row'];

/** A campaign joined with its boutique/product for the admin console. */
export interface AdCampaignAdmin extends AdCampaign {
  boutique?: { name: string; logo_url: string | null } | null;
  product?: { title: string; image_url: string | null } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate card (admin-managed placements)
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchPlacements(): Promise<AdPlacement[]> {
  const { data, error } = await supabase.from('ad_placements').select('*').order('sort');
  if (error) throw error;
  return (data ?? []) as AdPlacement[];
}

export async function updatePlacement(
  code: AdPlacementCode,
  patch: Partial<Pick<AdPlacement, 'name' | 'description' | 'daily_rate' | 'max_active' | 'active'>>,
) {
  const { error } = await supabase
    .from('ad_placements')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('code', code);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seller — draft, list, pay
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchMyCampaigns(boutiqueId: string): Promise<AdCampaign[]> {
  const { data, error } = await supabase
    .from('ad_campaigns')
    .select('*')
    .eq('boutique_id', boutiqueId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AdCampaign[];
}

export interface DraftInput {
  boutique_id: string;
  placement_code: AdPlacementCode;
  subject_type: AdSubjectType;
  product_id?: string | null;
  headline?: string;
  subtext?: string;
  image_url?: string;
  cta_label?: string;
  /** Editable eyebrow tag shown above the hero headline (the "Sponsored" pill stays). */
  tag?: string;
  days: number;
  /** ISO yyyy-mm-dd. Defaults to today at activation when omitted. */
  start_date?: string | null;
}

/** The creative fields a seller can author/edit (shared by draft + edit paths). */
export interface CreativeInput {
  subject_type: AdSubjectType;
  product_id?: string | null;
  headline?: string;
  subtext?: string;
  image_url?: string;
  cta_label?: string;
  tag?: string;
}

/** Create a draft campaign the seller then pays for. */
export async function saveCampaignDraft(input: DraftInput): Promise<AdCampaign> {
  const { data, error } = await supabase
    .from('ad_campaigns')
    .insert({
      boutique_id: input.boutique_id,
      placement_code: input.placement_code,
      subject_type: input.subject_type,
      product_id: input.product_id ?? null,
      headline: input.headline ?? '',
      subtext: input.subtext ?? '',
      image_url: input.image_url ?? '',
      cta_label: input.cta_label ?? '',
      tag: input.tag ?? '',
      days: input.days,
      start_date: input.start_date ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data as AdCampaign;
}

/** Edit an UNPAID draft in place (RLS + guard allow this while pending_payment). */
export async function updateCampaignDraft(id: string, patch: Partial<DraftInput>) {
  const { error } = await supabase.from('ad_campaigns').update(patch).eq('id', id);
  if (error) throw error;
}

/**
 * Edit a PAID campaign's creative (in review, sent back for rework, scheduled,
 * live or paused). Server-side it rewrites only the creative and drops the
 * campaign back to 'pending_review' for re-approval — editing a live ad takes it
 * out of rotation until an admin approves the change.
 */
export async function sellerEditCreative(id: string, c: CreativeInput) {
  const { error } = await supabase.rpc('seller_edit_ad_creative', {
    p_id: id,
    p_subject_type: c.subject_type,
    p_product_id: c.product_id ?? null,
    p_headline: c.headline ?? '',
    p_subtext: c.subtext ?? '',
    p_image_url: c.image_url ?? '',
    p_tag: c.tag ?? '',
    p_cta_label: c.cta_label ?? '',
  });
  if (error) throw error;
}

/** Delete an unpaid draft (RLS only allows this while status = pending_payment). */
export async function deleteDraft(id: string) {
  const { error } = await supabase.from('ad_campaigns').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Pay for a draft and settle it. Opens Razorpay checkout (server-priced), then
 * activates the campaign to 'pending_review'. Resolves with the activated row.
 */
export async function payForCampaign(campaignId: string, boutiqueName: string): Promise<AdCampaign> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Your session has expired. Please sign in again.');
  const res = await payForAd({
    campaignId,
    accessToken: token,
    name: boutiqueName || 'Agilam Boutique',
    description: 'Ad campaign',
  });
  return res.campaign as AdCampaign;
}

// ─────────────────────────────────────────────────────────────────────────────
// Buyer — what is serving right now + engagement tracking
// ─────────────────────────────────────────────────────────────────────────────

export interface LiveAds {
  sponsored_card: AdCampaign[];
  home_hero: AdCampaign[];
  boutique_promo: AdCampaign[];
}

/**
 * The ads currently serving. RLS already restricts anonymous reads to live rows
 * within their window; we re-assert `status === 'live'` client-side so a seller
 * browsing the buyer app (who can also see their own drafts) still gets a clean
 * feed. Grouped by placement for the render sites.
 */
export async function fetchLiveAds(): Promise<LiveAds> {
  const now = Date.now();
  const { data, error } = await supabase.from('ad_campaigns').select('*');
  if (error) throw error;
  const grouped: LiveAds = { sponsored_card: [], home_hero: [], boutique_promo: [] };
  for (const row of (data ?? []) as AdCampaign[]) {
    if (row.status !== 'live') continue;
    // Serve on the real 24h×days window (migration 0037), not the calendar day.
    if (row.start_at && new Date(row.start_at).getTime() > now) continue;
    if (row.end_at && new Date(row.end_at).getTime() <= now) continue;
    (grouped[row.placement_code] ??= []).push(row);
  }
  return grouped;
}

// Session throttle: one impression per ad per page-session, like record_product_view.
const impressed = new Set<string>();

export async function trackAdImpression(id: string) {
  if (impressed.has(id)) return;
  impressed.add(id);
  try {
    await supabase.rpc('record_ad_impression', { p_id: id });
  } catch {
    /* tracking is best-effort — never surface to the buyer */
  }
}

export async function trackAdClick(id: string) {
  try {
    await supabase.rpc('record_ad_click', { p_id: id });
  } catch {
    /* best-effort */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin — review console
// ─────────────────────────────────────────────────────────────────────────────

export interface CampaignFilter {
  status?: AdStatus | 'all';
  placement?: AdPlacementCode | 'all';
}

export async function fetchAllCampaigns(filter: CampaignFilter = {}): Promise<AdCampaignAdmin[]> {
  let q = supabase
    .from('ad_campaigns')
    .select('*, boutique:boutiques(name, logo_url), product:products(title, image_url)')
    .order('created_at', { ascending: false });
  if (filter.status && filter.status !== 'all') q = q.eq('status', filter.status);
  if (filter.placement && filter.placement !== 'all') q = q.eq('placement_code', filter.placement);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as AdCampaignAdmin[];
}

export async function approveCampaign(id: string) {
  const { error } = await supabase.rpc('admin_approve_ad', { p_id: id });
  if (error) throw error;
}

export async function pauseCampaign(id: string) {
  const { error } = await supabase.rpc('admin_pause_ad', { p_id: id });
  if (error) throw error;
}

/** Send a paid ad back to the seller for rework with a note (payment held). */
export async function requestChanges(id: string, reason: string) {
  const { error } = await supabase.rpc('admin_request_ad_changes', { p_id: id, p_reason: reason });
  if (error) throw error;
}

/** Reject a paid ad and refund the seller (server-side Razorpay refund). */
export async function rejectAndRefund(id: string, reason: string) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Admin session expired. Please sign in again.');
  const res = await fetch('/api/ads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'refund', campaignId: id, reason }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Could not refund the ad.');
}
