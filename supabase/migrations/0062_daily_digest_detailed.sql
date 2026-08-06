-- 0062_daily_digest_detailed.sql — expand the daily owner report.
--
-- 0060 returned headline figures and an action queue. This adds the detail the
-- owner asked for: a 7-day trend, per-boutique and per-product breakdowns, the
-- order pipeline, growth counters, and stock warnings.
--
-- Same guard, same signature, same token — only the returned jsonb grows, so the
-- client stays compatible and nothing else needs re-granting.
--
-- Conventions carried over from 0060 and unchanged here:
--   * 'rejected' is this schema's cancelled state and is excluded from every
--     money figure, matching the rest of the app's analytics.
--   * Commission is taken on GOODS value from order_items, never on orders.total
--     — the total also carries shipping and the COD fee, which the platform takes
--     no cut of. See src/data/payouts.ts.
--   * All day boundaries are Asia/Kolkata calendar days, converted to UTC.

create or replace function public.daily_digest(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public, extensions
as $$
declare
  v_hash       text;
  v_day_start  timestamptz;
  v_day_end    timestamptz;
  v_prev_start timestamptz;
  v_week_start timestamptz;
  v_pct        numeric;
  v_result     jsonb;
begin
  select token_hash into v_hash from public.report_secrets where id = 1;
  if v_hash is null then
    raise exception 'no report token configured — run set_report_token() first';
  end if;
  if extensions.crypt(coalesce(p_token, ''), v_hash) <> v_hash then
    raise exception 'invalid report token';
  end if;

  v_day_start  := date_trunc('day', (now() at time zone 'Asia/Kolkata') - interval '1 day')
                  at time zone 'Asia/Kolkata';
  v_day_end    := v_day_start + interval '1 day';
  v_prev_start := v_day_start - interval '1 day';
  v_week_start := v_day_start - interval '6 days';   -- 7 days inclusive of yesterday

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

    'actions', jsonb_build_object(
      'boutiquesPending', (select count(*) from public.boutiques where status = 'pending'),
      'boutiqueNames',    (select coalesce(jsonb_agg(name), '[]'::jsonb)
                           from (select name from public.boutiques
                                 where status = 'pending' order by created_at limit 5) b),
      'adsPending',       (select count(*) from public.ad_campaigns where status = 'pending_review'),
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
$$;

grant execute on function public.daily_digest(text) to anon, authenticated;
