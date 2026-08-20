-- 0093_daily_report_v2.sql — the daily owner report, rebuilt.
--
-- Three things change, all additive:
--
--   1. WHO GETS IT. The report used to go to one hard-coded address in the
--      sender's REPORT_TO. It now goes to every admin account, resolved at send
--      time by `report_recipients()`, so adding an admin in the console is all
--      it takes to put them on the list — and blocking or deleting one takes
--      them off it the same moment they lose console access.
--
--   2. WHAT IT SAYS. `daily_digest()` gains two blocks: `status` (is the
--      platform actually working right now) and `catalogue` (how big the
--      marketplace is), plus a longer action queue. Every existing key stays
--      exactly where it was — the old sender keeps working against the new
--      function, which matters because the Windows task and the cloud function
--      will not be upgraded in the same instant.
--
--   3. WHO SENDS IT. A Supabase Edge Function on pg_cron is now the primary
--      sender and the Windows Scheduled Task is the fallback. Two senders means
--      a double-send is possible, so `claim_report_run()` makes the day's send a
--      row that exactly one caller can win. The fallback does not need to know
--      whether the cloud ran; it asks to claim, and only sends if it gets it.
--
-- Guarded reads: the digest touches tables that arrived in later migrations
-- (whatsapp_outbox in 0090, return_requests in 0074, ad_campaigns in 0032). Each
-- is probed with to_regclass first, so this function still answers on a database
-- where one of them has not been applied rather than failing the whole report.
--
-- Conventions carried over from 0060/0062 and unchanged:
--   * 'rejected' is this schema's cancelled state, excluded from every money figure.
--   * Commission is taken on GOODS value from order_items, never orders.total.
--   * All day boundaries are Asia/Kolkata calendar days.

-- ── 1) Token check, factored out ────────────────────────────────────────────
-- 0060 inlined this in one function; there are now four that need it. SECURITY
-- DEFINER because report_secrets is readable by no client role, and executable
-- by nobody: the callers below are themselves definer-owned, so Postgres checks
-- EXECUTE on this as the owner, not as anon.

create or replace function public.report_token_ok(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  v_hash text;
begin
  select token_hash into v_hash from public.report_secrets where id = 1;
  if v_hash is null then
    raise exception 'no report token configured — run set_report_token() first';
  end if;
  return extensions.crypt(coalesce(p_token, ''), v_hash) = v_hash;
end;
$fn$;

revoke all on function public.report_token_ok(text) from public;

-- ── 2) Who the report goes to ───────────────────────────────────────────────
-- Deliberately its own function rather than another key on the digest: the
-- digest JSON is printed to the console by `--json` and pasted into reports, and
-- a list of admin email addresses has no business travelling with it.
--
-- 'staff' is NOT included. Staff are deliberately kept away from money and
-- configuration (0086) and this mail leads with revenue and payouts due.

create or replace function public.report_recipients(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
begin
  if not public.report_token_ok(p_token) then
    raise exception 'invalid report token';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('email', lower(trim(p.email)), 'name', p.full_name)
                     order by lower(trim(p.email)))
    from public.profiles p
    where p.role = 'admin'
      and coalesce(p.status, 'active') = 'active'
      and p.deleted_at is null
      and p.email is not null
      and trim(p.email) <> ''
      and position('@' in p.email) > 1
  ), '[]'::jsonb);
end;
$fn$;

grant execute on function public.report_recipients(text) to anon, authenticated;

-- ── 3) One send per day, whoever gets there first ───────────────────────────
-- The primary key on `day` is the whole mechanism: the cloud function and the
-- Windows task both try to insert the same row and exactly one of them wins.

create table if not exists public.report_runs (
  day         date primary key,
  source      text not null,                  -- 'cloud' | 'local' | 'manual'
  claimed_at  timestamptz not null default now(),
  sent_at     timestamptz,
  recipients  int not null default 0,
  ok          boolean,
  detail      text
);

comment on table public.report_runs is
  'One row per day of the owner report. Claimed before sending so the cloud function and the local fallback can never both send.';

alter table public.report_runs enable row level security;

-- Admins can look at it ("did today go out?"); nobody else, and no client role
-- writes it — only the definer functions below. `to authenticated` is required:
-- an untyped policy is TO PUBLIC, and anon cannot execute is_admin()'s
-- prerequisites without failing the read outright (see 0087).
do $do$ begin
  create policy "report_runs: admin read" on public.report_runs
    for select to authenticated using (public.is_admin());
exception when duplicate_object then null; end $do$;

/**
 * Try to become today's sender.
 *
 * Returns true if the caller should send. A claim that never reported success
 * within p_stale_minutes is taken over — otherwise a cloud function that died
 * between claiming and sending would suppress the fallback too, which is the
 * exact failure the fallback exists for.
 */
create or replace function public.claim_report_run(
  p_token text,
  p_source text,
  p_day date default null,
  p_stale_minutes int default 25
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_day date;
  v_n   int;
begin
  if not public.report_token_ok(p_token) then
    raise exception 'invalid report token';
  end if;

  v_day := coalesce(p_day, ((now() at time zone 'Asia/Kolkata')::date - 1));

  insert into public.report_runs (day, source)
  values (v_day, coalesce(nullif(trim(p_source), ''), 'unknown'))
  on conflict (day) do nothing;

  get diagnostics v_n = row_count;
  if v_n > 0 then
    return true;
  end if;

  -- Someone holds it. Take it over only if they claimed it, never reported a
  -- successful send, and have since gone quiet.
  update public.report_runs
     set detail = 'retaken from ' || source,
         source = coalesce(nullif(trim(p_source), ''), 'unknown'),
         claimed_at = now()
   where day = v_day
     and coalesce(ok, false) = false
     and claimed_at < now() - make_interval(mins => greatest(coalesce(p_stale_minutes, 25), 1));

  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$fn$;

grant execute on function public.claim_report_run(text, text, date, int) to anon, authenticated;

/** Record how the send went. A failed send is stored, not raised. */
create or replace function public.finish_report_run(
  p_token text,
  p_ok boolean,
  p_recipients int default 0,
  p_detail text default null,
  p_day date default null
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_day date;
begin
  if not public.report_token_ok(p_token) then
    raise exception 'invalid report token';
  end if;

  v_day := coalesce(p_day, ((now() at time zone 'Asia/Kolkata')::date - 1));

  update public.report_runs
     set ok = coalesce(p_ok, false),
         sent_at = case when coalesce(p_ok, false) then now() else sent_at end,
         recipients = greatest(coalesce(p_recipients, 0), 0),
         detail = left(coalesce(p_detail, ''), 500)
   where day = v_day;
end;
$fn$;

grant execute on function public.finish_report_run(text, boolean, int, text, date) to anon, authenticated;

-- ── 4) The digest itself ────────────────────────────────────────────────────

create or replace function public.daily_digest(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, extensions
as $fn$
declare
  v_day_start  timestamptz;
  v_day_end    timestamptz;
  v_prev_start timestamptz;
  v_week_start timestamptz;
  v_today      timestamptz;
  v_pct        numeric;
  v_result     jsonb;

  -- Optional tables, probed below. NULL means "this migration is not applied
  -- here", which the template renders as "—" rather than as a zero.
  v_wa_queued   int := null;
  v_wa_failed   int := null;
  v_returns     int := null;
  v_refunds_due int := null;
  v_ads_live    int := null;
  v_ads_pending int := null;
begin
  if not public.report_token_ok(p_token) then
    raise exception 'invalid report token';
  end if;

  v_day_start  := date_trunc('day', (now() at time zone 'Asia/Kolkata') - interval '1 day')
                  at time zone 'Asia/Kolkata';
  v_day_end    := v_day_start + interval '1 day';
  v_prev_start := v_day_start - interval '1 day';
  v_week_start := v_day_start - interval '6 days';   -- 7 days inclusive of yesterday
  v_today      := v_day_end;                          -- IST midnight that just passed

  select coalesce(commission_pct, 10) into v_pct from public.platform_settings limit 1;
  v_pct := coalesce(v_pct, 10);

  -- WhatsApp outbox (0090). A backlog here means buyers stopped getting order
  -- updates — invisible everywhere else in the platform.
  if to_regclass('public.whatsapp_outbox') is not null then
    execute $q$select count(*) filter (where status = 'queued'),
                    count(*) filter (where status = 'failed' and created_at >= now() - interval '48 hours')
             from public.whatsapp_outbox$q$
      into v_wa_queued, v_wa_failed;
  end if;

  -- Returns (0074).
  if to_regclass('public.return_requests') is not null then
    execute $q$select count(*) filter (where status = 'requested'),
                    count(*) filter (where status = 'approved')
             from public.return_requests$q$
      into v_returns, v_refunds_due;
  end if;

  -- Ads (0032).
  if to_regclass('public.ad_campaigns') is not null then
    execute $q$select count(*) filter (where status = 'live'),
                    count(*) filter (where status = 'pending_review')
             from public.ad_campaigns$q$
      into v_ads_live, v_ads_pending;
  end if;

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
  items as (
    select oi.* from public.order_items oi
    where oi.order_id in (select id from live)
  ),
  goods as (select coalesce(sum(price * qty), 0) as value from items),

  -- Seven consecutive IST days ending yesterday. Days with no trading still
  -- appear, as a zero — a gap in the series would misread as missing data.
  span as (
    select generate_series(v_week_start, v_day_start, interval '1 day') as d
  ),
  trend as (
    select jsonb_agg(jsonb_build_object(
             'date',   to_char(s.d at time zone 'Asia/Kolkata', 'DD Mon'),
             'orders', coalesce(t.n, 0),
             'gmv',    coalesce(t.gmv, 0)
           ) order by s.d) as rows
    from span s
    left join lateral (
      select count(*) as n, coalesce(sum(o.total), 0) as gmv
      from public.orders o
      where o.status <> 'rejected'
        and o.created_at >= s.d and o.created_at < s.d + interval '1 day'
    ) t on true
  ),

  by_boutique as (
    select jsonb_agg(x order by x_gmv desc) as rows
    from (
      select jsonb_build_object('name', b.name, 'orders', count(*), 'gmv', sum(l.total)) as x,
             sum(l.total) as x_gmv
      from live l join public.boutiques b on b.id = l.boutique_id
      group by b.name
      order by sum(l.total) desc
      limit 5
    ) q
  ),
  by_product as (
    select jsonb_agg(x order by x_qty desc) as rows
    from (
      select jsonb_build_object('title', i.title, 'qty', sum(i.qty),
                                'revenue', sum(i.price * i.qty)) as x,
             sum(i.qty) as x_qty
      from items i
      group by i.title
      order by sum(i.qty) desc
      limit 5
    ) q
  )

  select jsonb_build_object(
    'day', to_char(v_day_start at time zone 'Asia/Kolkata', 'Dy DD Mon YYYY'),
    'generatedAt', to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') || ' IST',

    'orders', jsonb_build_object(
      'count',     (select count(*) from live),
      'prevCount', (select count(*) from prev),
      'cancelled', (select count(*) from public.orders
                    where created_at >= v_day_start and created_at < v_day_end
                      and status = 'rejected'),
      'offline',   (select count(*) from live where channel = 'offline'),
      'units',     (select coalesce(sum(qty), 0) from items)
    ),

    'money', jsonb_build_object(
      'gmv',              (select coalesce(sum(total), 0) from live),
      'prevGmv',          (select coalesce(sum(total), 0) from prev),
      'goods',            (select value from goods),
      'commissionPct',    v_pct,
      'commission',       round((select value from goods) * v_pct / 100, 2),
      'platformDiscount', (select coalesce(sum(platform_discount), 0) from live),
      'aov',              (select case when count(*) = 0 then 0
                                  else round(sum(total) / count(*), 2) end from live),
      'codCount',         (select count(*) from live where payment_status <> 'paid'),
      'codValue',         (select coalesce(sum(total), 0) from live where payment_status <> 'paid'),
      'prepaidCount',     (select count(*) from live where payment_status = 'paid'),
      'prepaidValue',     (select coalesce(sum(total), 0) from live where payment_status = 'paid')
    ),

    -- Yesterday's orders by where they have reached, not lifetime totals.
    'pipeline', jsonb_build_object(
      'pending',   (select count(*) from live where status = 'pending'),
      'shipped',   (select count(*) from live where status = 'shipped'),
      'delivered', (select count(*) from live where status = 'delivered')
    ),

    'trend',     coalesce((select rows from trend), '[]'::jsonb),
    'boutiques', coalesce((select rows from by_boutique), '[]'::jsonb),
    'products',  coalesce((select rows from by_product), '[]'::jsonb),

    'growth', jsonb_build_object(
      'newBuyers',   (select count(*) from public.profiles
                      where created_at >= v_day_start and created_at < v_day_end
                        and role = 'buyer'),
      'newSellers',  (select count(*) from public.boutiques
                      where created_at >= v_day_start and created_at < v_day_end),
      'newProducts', (select count(*) from public.products
                      where created_at >= v_day_start and created_at < v_day_end),
      'newReviews',  (select count(*) from public.reviews
                      where created_at >= v_day_start and created_at < v_day_end)
    ),

    -- ── NEW: is the platform working right now ──────────────────────────────
    -- Everything here is "as of this moment", not "yesterday". The report is
    -- read first thing in the morning and the first question it has to answer
    -- is whether anything is broken, not what happened while everyone slept.
    'status', jsonb_build_object(
      'maintenanceMode',  (select coalesce(maintenance_mode, false)
                           from public.platform_settings limit 1),
      'ordersToday',      (select count(*) from public.orders
                           where created_at >= v_today and status <> 'rejected'),
      'lastOrderAt',      (select to_char(max(created_at) at time zone 'Asia/Kolkata',
                                          'DD Mon HH24:MI') from public.orders),
      'hoursSinceOrder',  (select case when max(created_at) is null then null
                             else round(extract(epoch from (now() - max(created_at))) / 3600)
                           end from public.orders),
      -- A paid order nobody has moved in three days. The buyer has been charged
      -- and is waiting; this is the most expensive thing on the page.
      'stuckOrders',      (select count(*) from public.orders
                           where status = 'pending'
                             and payment_status = 'paid'
                             and created_at < now() - interval '3 days'),
      -- Should be zero since 0085 withdrew cash on delivery. A non-zero number
      -- means an order was written without payment, which is a defect, not a sale.
      'unpaidOrders',     (select count(*) from public.orders
                           where payment_status <> 'paid'
                             and status <> 'rejected'
                             and created_at >= now() - interval '7 days'),
      'waQueued',         v_wa_queued,
      'waFailed',         v_wa_failed
    ),

    -- ── NEW: the size and shape of the marketplace ─────────────────────────
    'catalogue', jsonb_build_object(
      'liveProducts',    (select count(*) from public.products p
                          where coalesce(p.status, 'active') = 'active'
                            and p.deleted_at is null
                            and exists (select 1 from public.boutiques b
                                        where b.id = p.boutique_id and b.status = 'approved')),
      'outOfStock',      (select count(*) from public.products
                          where stock = 0 and deleted_at is null
                            and coalesce(status, 'active') = 'active'),
      'lowStock',        (select count(*) from public.products
                          where stock > 0 and stock <= 3 and deleted_at is null
                            and coalesce(status, 'active') = 'active'),
      'hiddenProducts',  (select count(*) from public.products
                          where coalesce(status, 'active') in ('hidden', 'rejected')
                            and deleted_at is null),
      'boutiquesLive',   (select count(*) from public.boutiques where status = 'approved'),
      'boutiquesPending',(select count(*) from public.boutiques where status = 'pending'),
      'buyers',          (select count(*) from public.profiles
                          where role = 'buyer' and deleted_at is null),
      'adsLive',         v_ads_live
    ),

    'actions', jsonb_build_object(
      'boutiquesPending', (select count(*) from public.boutiques where status = 'pending'),
      'boutiqueNames',    (select coalesce(jsonb_agg(name), '[]'::jsonb)
                           from (select name from public.boutiques
                                 where status = 'pending' order by created_at limit 5) b),
      'adsPending',       coalesce(v_ads_pending, 0),
      'productsPending',  (select count(*) from public.products
                           where coalesce(status, 'active') = 'pending' and deleted_at is null),
      'returnsPending',   coalesce(v_returns, 0),
      'refundsDue',       coalesce(v_refunds_due, 0),
      'payoutsDueCount',  (select count(*) from public.orders
                           where status = 'delivered' and payment_status = 'paid'
                             and payout_id is null),
      'payoutsDueValue',  (select coalesce(sum(total), 0) from public.orders
                           where status = 'delivered' and payment_status = 'paid'
                             and payout_id is null),
      -- Stock that is costing sales right now: a live listing nobody can buy.
      'outOfStock',       (select count(*) from public.products where stock = 0),
      'lowStock',         (select count(*) from public.products where stock > 0 and stock <= 3)
    )
  ) into v_result;

  return v_result;
end;
$fn$;

grant execute on function public.daily_digest(text) to anon, authenticated;
