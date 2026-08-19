-- 0060_daily_digest.sql — the daily owner report, as a token-guarded RPC.
--
-- Why an RPC instead of a serverless function: this project is on Vercel's Hobby
-- plan. `api/` already holds 12 routable functions and the single cron slot is
-- spent on the ads lifecycle sweep, so there is room for neither a new endpoint
-- nor a new cron. The report is therefore scheduled outside Vercel (a Claude Code
-- cloud routine), which needs some way to read cross-boutique figures.
--
-- It must NOT be handed the service-role key to do that — that key bypasses RLS
-- on every table in the project. Instead this function is SECURITY DEFINER and
-- gated on a shared token, so the caller authenticates with the ordinary anon
-- key (already public in the browser bundle) and proves authorisation with a
-- secret that grants exactly one thing: read these aggregates, nothing else.
--
-- The token is stored hashed. Set it once after applying this migration:
--   select public.set_report_token('<a long random string>');
-- then give that same string to the routine as REPORT_TOKEN.

create extension if not exists pgcrypto;

create table if not exists public.report_secrets (
  id          int primary key default 1 check (id = 1),
  token_hash  text not null,
  updated_at  timestamptz not null default now()
);

alter table public.report_secrets enable row level security;
-- No policies at all: no client role may read or write this table directly.
-- Only the SECURITY DEFINER functions below touch it.

revoke all on public.report_secrets from anon, authenticated;

create or replace function public.set_report_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not is_admin() then
    raise exception 'only an admin may rotate the report token';
  end if;
  if length(coalesce(p_token, '')) < 24 then
    raise exception 'report token must be at least 24 characters';
  end if;
  insert into public.report_secrets (id, token_hash, updated_at)
  values (1, extensions.crypt(p_token, extensions.gen_salt('bf')), now())
  on conflict (id) do update
    set token_hash = excluded.token_hash, updated_at = now();
end;
$$;

revoke all on function public.set_report_token(text) from anon, authenticated;
grant execute on function public.set_report_token(text) to authenticated;

/**
 * Yesterday's trading figures, in IST.
 *
 * Mirrors scripts/daily-report.mjs. Cancelled orders ('rejected') are excluded
 * from every money figure, matching the rest of the app's analytics, and
 * commission is taken on GOODS value from order_items — order.total also carries
 * shipping and the COD fee, which the platform takes no cut of (src/data/payouts.ts).
 */
create or replace function public.daily_digest(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
  v_hash        text;
  v_day_start   timestamptz;
  v_day_end     timestamptz;
  v_prev_start  timestamptz;
  v_pct         numeric;
  v_result      jsonb;
begin
  select token_hash into v_hash from public.report_secrets where id = 1;
  if v_hash is null then
    raise exception 'no report token configured — run set_report_token() first';
  end if;
  if extensions.crypt(coalesce(p_token, ''), v_hash) <> v_hash then
    raise exception 'invalid report token';
  end if;

  -- Yesterday, 00:00–24:00 Asia/Kolkata, expressed as UTC instants.
  v_day_start := date_trunc('day', (now() at time zone 'Asia/Kolkata') - interval '1 day')
                 at time zone 'Asia/Kolkata';
  v_day_end   := v_day_start + interval '1 day';
  v_prev_start := v_day_start - interval '1 day';

  select coalesce(commission_pct, 10) into v_pct from public.platform_settings limit 1;
  v_pct := coalesce(v_pct, 10);

  with live as (
    select o.* from public.orders o
    where o.created_at >= v_day_start and o.created_at < v_day_end
      and o.status <> 'rejected'
  ),
  prev as (
    select o.* from public.orders o
    where o.created_at >= v_prev_start and o.created_at < v_day_start
      and o.status <> 'rejected'
  ),
  goods as (
    select coalesce(sum(oi.price * oi.qty), 0) as value
    from public.order_items oi
    where oi.order_id in (select id from live)
  )
  select jsonb_build_object(
    'day', to_char(v_day_start at time zone 'Asia/Kolkata', 'Dy DD Mon YYYY'),
    'orders', jsonb_build_object(
      'count',     (select count(*) from live),
      'prevCount', (select count(*) from prev),
      'cancelled', (select count(*) from public.orders o
                    where o.created_at >= v_day_start and o.created_at < v_day_end
                      and o.status = 'rejected'),
      'offline',   (select count(*) from live where channel = 'offline')
    ),
    'money', jsonb_build_object(
      'gmv',               (select coalesce(sum(total), 0) from live),
      'prevGmv',           (select coalesce(sum(total), 0) from prev),
      'goods',             (select value from goods),
      'commissionPct',     v_pct,
      'commission',        round((select value from goods) * v_pct / 100, 2),
      'platformDiscount',  (select coalesce(sum(platform_discount), 0) from live),
      'codCount',          (select count(*) from live where payment_status <> 'paid'),
      'codValue',          (select coalesce(sum(total), 0) from live where payment_status <> 'paid')
    ),
    'actions', jsonb_build_object(
      'boutiquesPending', (select count(*) from public.boutiques where status = 'pending'),
      'boutiqueNames',    (select coalesce(jsonb_agg(name), '[]'::jsonb)
                           from (select name from public.boutiques
                                 where status = 'pending' order by created_at limit 5) b),
      'adsPending',       (select count(*) from public.ad_campaigns where status = 'pending_review'),
      'payoutsDueCount',  (select count(*) from public.orders
                           where status = 'delivered' and payment_status = 'paid' and payout_id is null),
      'payoutsDueValue',  (select coalesce(sum(total), 0) from public.orders
                           where status = 'delivered' and payment_status = 'paid' and payout_id is null)
    )
  ) into v_result;

  return v_result;
end;
$$;

-- anon may CALL it, but gets nothing without the token.
grant execute on function public.daily_digest(text) to anon, authenticated;
