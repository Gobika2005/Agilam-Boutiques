-- Ad hero creative + rework flow.
--
-- Extends the seller-ads product (migration 0032) with what the hero slot needs
-- to be a real, seller-authored banner and what the review needs to be a
-- conversation rather than a yes/no:
--
--   • ad_campaigns.tag — an editable eyebrow line (e.g. "Festive Edit") shown
--     ABOVE the headline. The mandatory "Sponsored" disclosure stays on the
--     buyer render regardless; this is the seller's own label, not a replacement
--     for it.
--   • A hero can now point at the seller's BOUTIQUE, not only a product
--     (subject_type already allows 'boutique'; the CTA label + link differ), so
--     the button reads "Visit store" and opens the shop profile.
--   • status 'changes_requested' — the admin can send a paid ad back for rework
--     with a note; the seller edits the creative and resubmits WITHOUT paying
--     again (the payment is held), and it returns to 'pending_review'.
--
-- Idempotent: re-runnable in the Supabase SQL editor. Requires 0032.

-- ── Editable eyebrow tag ────────────────────────────────────────────────────
alter table ad_campaigns add column if not exists tag text not null default '';

-- ── New lifecycle state: changes_requested ──────────────────────────────────
do $$ begin
  alter table ad_campaigns drop constraint if exists ad_campaigns_status_check;
exception when undefined_object then null; end $$;

alter table ad_campaigns add constraint ad_campaigns_status_check check (status in (
  'pending_payment','pending_review','scheduled','live','paused',
  'rejected','refunded','expired','changes_requested'
));

-- ── Guard · widen what a seller may edit ────────────────────────────────────
-- 0032 locked any paid campaign entirely. A campaign the admin has sent back for
-- rework ('changes_requested') must be creative-editable again — but only the
-- creative, never the price/schedule the seller already paid for, and never the
-- payment/counter/review columns. An unpaid draft keeps its wider edit rights.
create or replace function ad_campaigns_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('agilam.ad_privileged', true), 'off') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending_payment';
    new.impressions := 0;
    new.clicks := 0;
    new.amount := 0;
    new.daily_rate_snapshot := 0;
    new.payment_order_id := null;
    new.payment_id := null;
    new.paid_at := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.reject_reason := null;
    return new;
  end if;

  -- Unpaid draft: everything but the protected columns is the seller's to set.
  if old.status = 'pending_payment' then
    new.status := old.status;
    new.impressions := old.impressions;
    new.clicks := old.clicks;
    new.amount := old.amount;
    new.daily_rate_snapshot := old.daily_rate_snapshot;
    new.payment_order_id := old.payment_order_id;
    new.payment_id := old.payment_id;
    new.paid_at := old.paid_at;
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.reject_reason := old.reject_reason;
    new.end_date := old.end_date;
    new.created_at := old.created_at;
    new.updated_at := now();
    return new;
  end if;

  -- Any paid campaign is locked at the table level. A seller edits its creative
  -- through seller_edit_ad_creative() below, which re-enters review — so changed
  -- creative is always re-moderated and the price/schedule can't be touched.
  return old;
end $$;

-- ── Admin: request changes (rework) ─────────────────────────────────────────
create or replace function admin_request_ad_changes(p_id uuid, p_reason text default null) returns ad_campaigns
language plpgsql security definer set search_path = public
as $$
declare v_row ad_campaigns;
begin
  if not is_admin() then raise exception 'ads: admin only'; end if;
  perform ad_privileged_begin();
  update ad_campaigns set
    status = 'changes_requested',
    reject_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at = now()
  where id = p_id and status in ('pending_review','scheduled','live','paused')
  returning * into v_row;
  perform ad_privileged_end();
  if v_row.id is null then raise exception 'ads: nothing to send back for %', p_id; end if;
  return v_row;
end $$;

-- ── Seller: edit creative → back to review ──────────────────────────────────
-- The one seller-edit path for a PAID campaign (in review, sent back for rework,
-- scheduled, live or paused). Owner-gated. It writes only the creative fields —
-- never price, schedule or counters — and drops the campaign to 'pending_review'
-- so an admin re-approves the new creative before it (re)serves. Editing a live
-- ad therefore takes it out of rotation until approved again. Unpaid drafts are
-- edited directly (the guard above allows it) and don't come through here.
create or replace function seller_edit_ad_creative(
  p_id uuid,
  p_subject_type text,
  p_product_id uuid,
  p_headline text,
  p_subtext text,
  p_image_url text,
  p_tag text,
  p_cta_label text
) returns ad_campaigns
language plpgsql security definer set search_path = public
as $$
declare v_row ad_campaigns;
begin
  perform ad_privileged_begin();
  update ad_campaigns c set
    subject_type = coalesce(nullif(p_subject_type, ''), c.subject_type),
    product_id = p_product_id,
    headline = coalesce(p_headline, c.headline),
    subtext = coalesce(p_subtext, c.subtext),
    image_url = coalesce(p_image_url, c.image_url),
    tag = coalesce(p_tag, c.tag),
    cta_label = coalesce(p_cta_label, c.cta_label),
    status = 'pending_review',
    reject_reason = null,
    updated_at = now()
  where c.id = p_id
    and c.status in ('pending_review','changes_requested','scheduled','live','paused')
    and exists (select 1 from boutiques b where b.id = c.boutique_id and b.owner_id = auth.uid())
  returning * into v_row;
  perform ad_privileged_end();
  if v_row.id is null then raise exception 'ads: nothing to edit for %', p_id; end if;
  return v_row;
end $$;

revoke execute on function admin_request_ad_changes(uuid, text) from public, anon;
revoke execute on function seller_edit_ad_creative(uuid, text, uuid, text, text, text, text, text) from public, anon;
grant execute on function admin_request_ad_changes(uuid, text) to authenticated;
grant execute on function seller_edit_ad_creative(uuid, text, uuid, text, text, text, text, text) to authenticated;
