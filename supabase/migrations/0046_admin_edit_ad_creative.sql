-- Admin: edit an ad's creative in place.
--
-- The seller edits a paid ad through seller_edit_ad_creative() (migration 0033),
-- which is owner-gated and always drops the ad back to 'pending_review'. The
-- admin console had no equivalent — a reviewer could only Approve / Pause /
-- Rework / Reject, never fix the creative themselves.
--
-- This adds an admin-gated twin that rewrites the same creative fields (subject,
-- linked product, headline, subtext, banner image, tag, CTA) for ANY campaign,
-- WITHOUT changing its lifecycle status: the admin IS the reviewer, so an edit
-- they make to a live ad keeps it live, an edit to one in review keeps it in
-- review. Price, schedule and counters remain untouchable — only the creative.
--
-- Idempotent: re-runnable in the Supabase SQL editor. Requires 0032 + 0033.

create or replace function admin_edit_ad_creative(
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
  if not is_admin() then raise exception 'ads: admin only'; end if;
  perform ad_privileged_begin();
  update ad_campaigns c set
    subject_type = coalesce(nullif(p_subject_type, ''), c.subject_type),
    product_id   = p_product_id,
    headline     = coalesce(p_headline, c.headline),
    subtext      = coalesce(p_subtext, c.subtext),
    image_url    = coalesce(p_image_url, c.image_url),
    tag          = coalesce(p_tag, c.tag),
    cta_label    = coalesce(p_cta_label, c.cta_label),
    reviewed_by  = auth.uid(),
    reviewed_at  = now(),
    updated_at   = now()
  where c.id = p_id
    and c.status in ('pending_payment','pending_review','changes_requested','scheduled','live','paused')
  returning * into v_row;
  perform ad_privileged_end();
  if v_row.id is null then raise exception 'ads: nothing to edit for %', p_id; end if;
  return v_row;
end $$;

revoke execute on function admin_edit_ad_creative(uuid, text, uuid, text, text, text, text, text) from public, anon;
grant execute on function admin_edit_ad_creative(uuid, text, uuid, text, text, text, text, text) to authenticated;
