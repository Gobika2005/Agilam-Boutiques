-- 0101 — the daily report's payout line, told the same way the console tells it
--
-- WHAT WAS WRONG
-- The 07:00 report said "₹1,718 across 5 delivered order(s) awaiting payout"
-- on a morning when /admin/payments showed ₹115 across 3. Neither number was
-- a rounding difference — they were two different questions:
--
--   * The digest counted EVERY order that was delivered, paid and unsettled.
--     The console counts `is_settleable(o)` (0078a), which additionally throws
--     out refunded orders, orders with a disputed delivery, and walk-in POS
--     sales — a shop's own counter sale is not money the platform is holding.
--   * The digest summed `orders.total`, the gross the buyer paid. The console
--     shows what actually leaves the bank: goods minus the 10% commission.
--
-- An owner reading a figure fifteen times the real one either stops trusting
-- the report or transfers against it. Both are worse than no line at all.
--
-- WHAT THIS DOES
-- Redefines `daily_digest()` (supersedes 0093) so the payout action line is
-- computed from `is_settleable()` and netted at the same rate
-- `settle_boutique_payout()` uses, and adds the two facts the console has that
-- the email never carried:
--
--   * `payoutsOverdue*` — sellers past `platform_settings.payout_sla_hours`,
--     the 8-hour promise the seller console publishes. Nothing else alerts on
--     a broken promise; the console only shows it to whoever opens the page.
--   * `payoutsBlocked*` — money owed to sellers with no bank account on file.
--     A chase-the-seller job, not a settle job, so the template links it
--     elsewhere.
--
-- Everything else in the digest is carried over from 0093 unchanged.
--
-- WHY 10% AND NOT `platform_settings.commission_pct`
-- Because this line has to agree with the payout, and the payout is hard-coded
-- to 0.10 in `settle_boutique_payout()` (0078a) and in `PAYOUT_RATE`
-- (src/data/payouts.ts) — commission, gateway and tax bundled. Reading the
-- editable percentage here would make the email disagree with the console the
-- day someone edits it. `money.commissionPct` above still reports the real
-- setting; that is a revenue figure, not a settlement.
--
-- Idempotent: create or replace only.

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

  -- The settlement rate, matching settle_boutique_payout() (0078a). See the
  -- header: deliberately not platform_settings.commission_pct.
  v_payout_rate constant numeric := 0.10;
  -- The published payout promise. Falls back to 8 exactly as the console does
  -- when settings are unreadable, so an outage cannot mark every seller late.
  v_sla_hours   int := 8;
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

  select coalesce(payout_sla_hours, 8) into v_sla_hours from public.platform_settings limit 1;
  v_sla_hours := coalesce(v_sla_hours, 8);

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
  ),

  -- ── What is actually owed to sellers, right now ─────────────────────────
  -- One definition of payable for the console, the settlement and this email:
  -- is_settleable() (0078a). Anything else here would be a fourth opinion.
  settleable as (
    select o.boutique_id, o.total, o.delivered_at
    from public.orders o
    where is_settleable(o)
  ),
  -- Per boutique, because that is the unit an admin settles in: the clock runs
  -- from a boutique's OLDEST delivered order, and a boutique either has a bank
  -- account or it does not.
  payout_sellers as (
    select s.boutique_id,
           count(*)                                          as order_count,
           round(sum(s.total) - sum(round(s.total * v_payout_rate, 2)), 2) as net,
           min(s.delivered_at)                               as oldest_delivered_at,
           -- Both halves or neither: MangaiMart settles by bank transfer, so an
           -- account number without an IFSC cannot be paid. Same test as
           -- `hasBank` in src/data/payouts.ts.
           nullif(btrim(coalesce(b.bank_account_number, '')), '') is not null
             and nullif(btrim(coalesce(b.bank_ifsc, '')), '') is not null as has_bank,
           coalesce(b.name, 'Unknown boutique')              as name
    from settleable s
    -- Left join: a settleable order whose boutique row has gone missing is
    -- still money owed, and must not silently vanish from the total.
    left join public.boutiques b on b.id = s.boutique_id
    group by s.boutique_id, b.bank_account_number, b.bank_ifsc, b.name
  ),
  payout_overdue as (
    select * from payout_sellers
    where net > 0
      and oldest_delivered_at + make_interval(hours => v_sla_hours) < now()
  ),
  payout_blocked as (
    select * from payout_sellers where net > 0 and not has_bank
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
      -- Settleable orders only, netted at the payout rate: the same ₹ the
      -- Payouts console offers to transfer. See the header.
      'payoutsDueCount',      (select coalesce(sum(order_count), 0) from payout_sellers where net > 0),
      'payoutsDueValue',      (select coalesce(sum(net), 0) from payout_sellers where net > 0),
      -- Past the published 8-hour promise.
      'payoutsOverdueSellers',(select count(*) from payout_overdue),
      'payoutsOverdueValue',  (select coalesce(sum(net), 0) from payout_overdue),
      'payoutsOverdueNames',  (select coalesce(jsonb_agg(name order by oldest_delivered_at), '[]'::jsonb)
                               from (select name, oldest_delivered_at from payout_overdue
                                     order by oldest_delivered_at limit 5) o),
      -- Owed, but there is nowhere to send it.
      'payoutsBlockedSellers',(select count(*) from payout_blocked),
      'payoutsBlockedValue',  (select coalesce(sum(net), 0) from payout_blocked),
      'payoutsBlockedNames',  (select coalesce(jsonb_agg(name order by net desc), '[]'::jsonb)
                               from (select name, net from payout_blocked
                                     order by net desc limit 5) o),
      -- Stock that is costing sales right now: a live listing nobody can buy.
      'outOfStock',       (select count(*) from public.products where stock = 0),
      'lowStock',         (select count(*) from public.products where stock > 0 and stock <= 3)
    )
  ) into v_result;

  return v_result;
end;
$fn$;

grant execute on function public.daily_digest(text) to anon, authenticated;

comment on function public.daily_digest(text) is
  'Everything the 07:00 admin report renders, as one jsonb. Payout figures mirror the admin Payouts console exactly: is_settleable() (0078a) decides which orders count, and the value is net of the 10% settlement rate — never gross.';
