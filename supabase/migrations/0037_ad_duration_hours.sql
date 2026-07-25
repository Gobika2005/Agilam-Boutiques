-- Ad duration in hours, not calendar days.
--
-- 0032 tracked an ad's run with two `date` columns and served it while
-- `current_date between start_date and end_date`. That makes "1 day" mean "the
-- rest of this calendar day": an ad bought at 11pm ran for one hour, and a
-- 1-day ad never got a real 24 hours. This migration moves the live window to
-- timestamps so N days == N × 24h, measured from the moment the ad goes LIVE
-- (approval, or the scheduled start) — so a slow review never eats into the
-- paid time either.
--
--   start_at / end_at (timestamptz) — the real serving window. Set when the ad
--   goes live; end_at = start_at + days × 24h. start_date/end_date stay as the
--   seller's requested start day + a rough display end, but no longer gate
--   serving.
--
-- Idempotent: re-runnable in the Supabase SQL editor. Requires 0032 + 0033.

alter table ad_campaigns add column if not exists start_at timestamptz;
alter table ad_campaigns add column if not exists end_at timestamptz;

-- Backfill any campaign already past purchase so it keeps serving/expiring
-- sensibly: begin at the start day (or when it was created), end 24h × days after.
update ad_campaigns
   set start_at = coalesce(start_at, start_date::timestamptz, created_at),
       end_at = coalesce(end_at, (coalesce(start_date::timestamptz, created_at) + days * interval '24 hours'))
 where end_at is null
   and status in ('scheduled', 'live', 'paused', 'expired');

-- ── Buyer visibility · the timestamp window ─────────────────────────────────
drop policy if exists "ad_campaigns: public read serving" on ad_campaigns;
do $$ begin
  create policy "ad_campaigns: public read serving" on ad_campaigns for select using (
    status = 'live' and start_at is not null and end_at is not null
    and now() >= start_at and now() < end_at
  );
exception when duplicate_object then null; end $$;

-- ── Approve · stamp the live window when it starts serving now ───────────────
create or replace function admin_approve_ad(p_id uuid) returns ad_campaigns
language plpgsql security definer set search_path = public
as $$
declare v_row ad_campaigns;
begin
  if not is_admin() then raise exception 'ads: admin only'; end if;
  perform ad_privileged_begin();
  update ad_campaigns c set
    status = case when c.start_date <= current_date then 'live' else 'scheduled' end,
    -- Going live now → open a fresh 24h×days window (coalesce keeps a resumed
    -- ad's remaining window rather than restarting it). A future start stays
    -- scheduled and gets its window from the cron on the day.
    start_at = case when c.start_date <= current_date then coalesce(c.start_at, now()) else c.start_at end,
    end_at = case when c.start_date <= current_date then coalesce(c.end_at, now() + c.days * interval '24 hours') else c.end_at end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    reject_reason = null,
    updated_at = now()
  where c.id = p_id and c.status in ('pending_review','paused')
  returning * into v_row;
  perform ad_privileged_end();
  if v_row.id is null then raise exception 'ads: nothing to approve for %', p_id; end if;
  return v_row;
end $$;

-- ── Daily lifecycle · start scheduled ads, expire finished ones ─────────────
create or replace function expire_and_activate_ads() returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform ad_privileged_begin();
  -- Scheduled → live on its start day; the 24h×days window opens now.
  update ad_campaigns set
    status = 'live',
    start_at = coalesce(start_at, now()),
    end_at = coalesce(end_at, now() + days * interval '24 hours'),
    updated_at = now()
   where status = 'scheduled' and start_date <= current_date;
  -- Live → expired once the window has fully elapsed.
  update ad_campaigns set status = 'expired', updated_at = now()
   where status = 'live' and end_at is not null and now() >= end_at;
  perform ad_privileged_end();
end $$;

-- ── Tracking · only count a currently-serving ad ────────────────────────────
create or replace function record_ad_impression(p_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform ad_privileged_begin();
  update ad_campaigns set impressions = impressions + 1
   where id = p_id and status = 'live' and end_at is not null and now() >= start_at and now() < end_at;
  perform ad_privileged_end();
end $$;

create or replace function record_ad_click(p_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform ad_privileged_begin();
  update ad_campaigns set clicks = clicks + 1
   where id = p_id and status = 'live' and end_at is not null and now() >= start_at and now() < end_at;
  perform ad_privileged_end();
end $$;
