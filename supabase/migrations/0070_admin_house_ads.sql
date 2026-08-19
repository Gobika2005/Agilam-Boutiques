-- Admin-created ads ("house ads") — published without a payment.
--
-- Idempotent: re-runnable in the Supabase SQL editor. Requires 0032 + 0033 +
-- 0037 (start_at/end_at) + 0046.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
-- Every ad slot on the buyer app can only be filled by a seller buying it: the
-- one insert path is a seller draft, and the only way out of 'pending_payment'
-- is activate_ad_campaign(), which needs a captured Razorpay payment. Nobody is
-- buying ads yet, so the hero rail, the sponsored cards and the boutique promo
-- sit empty — the most valuable space on the storefront, blank, because the
-- platform itself has no way to put anything in it.
--
-- This adds the missing path: an admin composes a campaign for any boutique and
-- publishes it directly. No order, no payment, no review step (the admin IS the
-- reviewer). Everything downstream — serving, the 24h×days window, impressions,
-- clicks, pause/expire, the nightly lifecycle cron — is unchanged, because the
-- row it writes is an ordinary campaign row.
--
-- `house_ad` marks these so they read as free placements rather than sales:
-- ad revenue is summed from `amount`, which stays 0, and the admin console shows
-- a "House ad" chip instead of a price.

alter table ad_campaigns add column if not exists house_ad boolean not null default false;

comment on column ad_campaigns.house_ad is
  'True when an admin published this campaign directly (no payment). Amount stays 0 and it is excluded from ad revenue.';

-- ── Admin: create and publish a campaign, no payment ────────────────────────
-- Writes the row the seller purchase flow would have produced, minus the money:
--   • status goes straight to 'live' (window opens now) or 'scheduled' (the
--     nightly expire_and_activate_ads opens it on the start day), never
--     'pending_payment' — there is nothing to pay.
--   • amount / daily_rate_snapshot stay 0 and payment_id stays null, so an
--     accidental "Reject & refund" finds no payment to refund and says so.
--   • reviewed_by/at are stamped with the admin who created it: it has already
--     been reviewed, by definition.
--
-- The placement's `max_active` IS enforced. A house ad occupies real estate the
-- same way a paid one does, and the buyer app renders whatever is live — three
-- heroes is a design, seven is a mistake. To fit more, raise Max active slots on
-- the rate card (admin → Ads → Rate card), which is the one place that decision
-- belongs.
create or replace function admin_create_ad_campaign(
  p_boutique_id uuid,
  p_placement_code text,
  p_subject_type text,
  p_product_id uuid,
  p_headline text,
  p_subtext text,
  p_image_url text,
  p_tag text,
  p_cta_label text,
  p_days int,
  p_start date,
  p_go_live boolean
) returns ad_campaigns
language plpgsql security definer set search_path = public
as $$
declare
  v_row ad_campaigns;
  v_placement ad_placements;
  v_days int := greatest(1, least(90, coalesce(p_days, 1)));
  v_start date := coalesce(p_start, current_date);
  v_now boolean;
  v_occupied int;
begin
  if not is_admin() then raise exception 'ads: admin only'; end if;

  select * into v_placement from ad_placements where code = p_placement_code;
  if v_placement.code is null then
    raise exception 'ads: unknown placement %', p_placement_code;
  end if;

  if not exists (select 1 from boutiques b where b.id = p_boutique_id) then
    raise exception 'ads: unknown boutique %', p_boutique_id;
  end if;

  -- A sponsored card and a product hero both point at a product; it must belong
  -- to the boutique being promoted, or the ad links a shop to someone else's
  -- piece.
  if p_product_id is not null and not exists (
    select 1 from products p where p.id = p_product_id and p.boutique_id = p_boutique_id
  ) then
    raise exception 'ads: product % does not belong to boutique %', p_product_id, p_boutique_id;
  end if;

  -- Serve now, or wait for the start day. A back-dated start is treated as now.
  v_now := coalesce(p_go_live, true) and v_start <= current_date;

  -- Same occupancy rule as api/_ads.js: count only campaigns still holding the
  -- slot, trusting `end_at` over a status the nightly cron has yet to catch up
  -- with (a null end_at — e.g. a scheduled ad with no window yet — still counts).
  select count(*) into v_occupied from ad_campaigns c
   where c.placement_code = p_placement_code
     and c.status in ('pending_review','scheduled','live','paused')
     and (c.end_at is null or c.end_at > now());
  if v_occupied >= v_placement.max_active then
    raise exception 'ads: the % slot is full (% of % in use). Raise "Max active slots" on the rate card to fit another.',
      v_placement.name, v_occupied, v_placement.max_active;
  end if;

  perform ad_privileged_begin();
  insert into ad_campaigns (
    boutique_id, placement_code, subject_type, product_id,
    headline, subtext, image_url, tag, cta_label,
    days, start_date, end_date, status, start_at, end_at,
    house_ad, amount, daily_rate_snapshot,
    reviewed_by, reviewed_at
  ) values (
    p_boutique_id, p_placement_code,
    coalesce(nullif(p_subject_type, ''), 'product'), p_product_id,
    coalesce(p_headline, ''), coalesce(p_subtext, ''), coalesce(p_image_url, ''),
    coalesce(p_tag, ''), coalesce(p_cta_label, ''),
    v_days, v_start, v_start + (v_days - 1),
    case when v_now then 'live' else 'scheduled' end,
    case when v_now then now() else null end,
    case when v_now then now() + v_days * interval '24 hours' else null end,
    true, 0, 0,
    auth.uid(), now()
  )
  returning * into v_row;
  perform ad_privileged_end();

  return v_row;
end $$;

revoke execute on function admin_create_ad_campaign(uuid, text, text, uuid, text, text, text, text, text, int, date, boolean) from public, anon;
-- Runs under the admin's own JWT; is_admin() above is the gate.
grant execute on function admin_create_ad_campaign(uuid, text, text, uuid, text, text, text, text, text, int, date, boolean) to authenticated;

-- ── Verify ──────────────────────────────────────────────────────────────────
--   select code, name, max_active from ad_placements order by sort;
--   select id, placement_code, status, house_ad, amount, start_at, end_at
--     from ad_campaigns where house_ad order by created_at desc;
-- A non-admin calling admin_create_ad_campaign must fail with "ads: admin only".
