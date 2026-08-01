-- Record the PLATFORM-funded coupon discount on the order it was taken off.
--
-- 0036 deliberately keeps a platform coupon out of `orders.total`: the platform
-- funds it, so the seller's payout must be computed on the FULL goods value.
-- What it never did was record the discount anywhere else — so nothing
-- downstream knew the buyer owed less than `total + shipping_fee + cod_fee`.
--
-- On a prepaid order that was invisible (Razorpay had already taken the right
-- amount). On CASH ON DELIVERY it is real money: the buyer was quoted the
-- discounted total at checkout and then asked for the undiscounted one at the
-- door.
--
--   AGL-AHA91R1B58   goods 999 · MYFRD0090 −899 · delivery 79 · cash 49
--                    quoted at checkout  ₹228
--                    shown on the order  ₹1,127        (₹899 too much)
--
-- `platform_discount` closes that: it is the slice of a platform coupon this
-- order carries, so the amount the buyer actually pays is
--
--     total + shipping_fee + cod_fee − platform_discount
--
-- while `total` — and therefore every payout calculation — stays the full goods
-- value. A SELLER coupon is unchanged: it is still netted off `total` into the
-- existing `discount` column, because that seller funds it themselves.
--
-- The one place the two must meet is COD settlement. The seller physically
-- collects the DISCOUNTED cash but is credited for the full goods value, so the
-- platform owes them the gap — settle_boutique_payout is replaced below to add
-- it back. (Automatic payouts, 0026, are prepaid-only and need no change: there
-- the money already flowed through the platform.)
--
-- Run once in the Supabase SQL editor after 0052. Idempotent.

-- ── The column ──────────────────────────────────────────────────────────────
alter table orders add column if not exists platform_discount numeric(12,2) not null default 0;

comment on column orders.platform_discount is
  'Platform-funded coupon discount on this order. NOT deducted from `total` (the seller is paid in full); subtract it from total+shipping_fee+cod_fee to get what the buyer pays.';

-- ── Repair the orders already written without it ────────────────────────────
-- Only orders that carry a coupon code, still have platform_discount 0, and
-- whose seller-funded `discount` is 0 (a seller coupon is already accounted
-- for) can be affected. The coupon has to still resolve to a PLATFORM row
-- (boutique_id is null) for the discount to have been platform-funded.
--
-- A COD order whose cash has ALREADY been collected is deliberately left alone:
-- the seller took the undiscounted amount at the door, so crediting them the
-- discount now would pay it twice. Those are a refund to the buyer, which is an
-- admin decision (/admin/refunds), not something a migration should assume. The
-- notice below counts them so they can be found and settled by hand.
--
-- A checkout spanning several boutiques becomes several orders, and a platform
-- coupon measures against the WHOLE cart, so the repair has to reassemble the
-- batch before it can share the discount out. Orders of one checkout are
-- inserted in a single loop: same coupon, same buyer, milliseconds apart. The
-- gaps-and-islands grouping below rebuilds exactly those batches (a >2 minute
-- gap starts a new one), prices the coupon against the batch's combined goods
-- value the way api/_pricing.js does, and allocates it proportionally — with
-- the rounding remainder on the largest order so the batch sums to the penny.
do $$
declare
  v_fixed int := 0;
  v_collected int := 0;
begin
  with candidate as (
    select
      o.id, o.total, o.created_at, o.boutique_id,
      upper(btrim(o.coupon_code)) as code,
      coalesce(o.buyer_id::text, o.guest_phone, '') as buyer_key
    from orders o
    where o.coupon_code is not null
      and btrim(o.coupon_code) <> ''
      and o.platform_discount = 0
      and o.discount = 0
      and coalesce(o.channel, 'online') <> 'offline'
      -- Cash already in the seller's hands can't be un-collected here.
      and not (o.payment_method = 'COD' and coalesce(o.payment_status, 'paid') <> 'pending')
  ),
  -- Only codes that are (still) platform coupons, with their pricing rules.
  priced as (
    select c.*, cp.type, cp.off, cp.min_subtotal, cp.max_discount
    from candidate c
    join coupons cp on upper(cp.code) = c.code and cp.boutique_id is null
    -- 'ship' waives the delivery fee rather than discounting goods; those orders
    -- were written with shipping_fee 0 already, so there is nothing to repair.
    where cp.type in ('pct', 'flat')
  ),
  -- Mark the first order of each checkout: a gap of more than two minutes from
  -- the previous order sharing this buyer + code cannot be the same submission.
  flagged as (
    select p.*,
      case
        when lag(p.created_at) over w is null
          or p.created_at - lag(p.created_at) over w > interval '2 minutes'
        then 1 else 0
      end as is_new_batch
    from priced p
    window w as (partition by p.code, p.buyer_key order by p.created_at)
  ),
  batched as (
    select f.*,
      sum(f.is_new_batch) over (partition by f.code, f.buyer_key order by f.created_at
                                rows between unbounded preceding and current row) as batch_no
    from flagged f
  ),
  -- The cart the coupon was measured against, and what it was worth on it.
  totals as (
    select b.*,
      sum(b.total) over bt as cart_total,
      row_number() over (partition by b.code, b.buyer_key, b.batch_no
                         order by b.total desc, b.id) as rank_in_batch,
      count(*) over bt as batch_size
    from batched b
    window bt as (partition by b.code, b.buyer_key, b.batch_no)
  ),
  saving as (
    select t.*,
      case
        when t.cart_total < t.min_subtotal then 0
        when t.type = 'pct' and t.max_discount is null then round(t.cart_total * t.off / 100)
        when t.type = 'pct' then least(round(t.cart_total * t.off / 100), t.max_discount)
        else least(t.off, t.cart_total)
      end as batch_discount
    from totals t
  ),
  -- Proportional share, remainder to the largest order so the batch adds up.
  allocated as (
    select s.id,
      case
        when s.batch_discount <= 0 or s.cart_total <= 0 then 0
        when s.batch_size = 1 then s.batch_discount
        when s.rank_in_batch = 1 then
          s.batch_discount - (
            select coalesce(sum(floor(s2.batch_discount * s2.total / s2.cart_total)), 0)
            from saving s2
            where s2.code = s.code and s2.buyer_key = s.buyer_key
              and s2.batch_no = s.batch_no and s2.rank_in_batch <> 1
          )
        else floor(s.batch_discount * s.total / s.cart_total)
      end as share
    from saving s
  )
  update orders o
     set platform_discount = least(a.share, o.total + o.shipping_fee + o.cod_fee)
    from allocated a
   where o.id = a.id
     and a.share > 0;

  get diagnostics v_fixed = row_count;

  -- COD orders already collected at the undiscounted amount: the buyer overpaid
  -- and is owed the difference. Flagged, never silently adjusted.
  select count(*) into v_collected
  from orders o
  join coupons c on upper(c.code) = upper(btrim(o.coupon_code)) and c.boutique_id is null
  where o.payment_method = 'COD'
    and coalesce(o.payment_status, 'paid') <> 'pending'
    and o.platform_discount = 0
    and o.discount = 0
    and c.type in ('pct', 'flat');

  raise notice '0053: recorded the platform discount on % order(s)', v_fixed;
  if v_collected > 0 then
    raise notice '0053: % already-collected COD order(s) were charged the undiscounted amount — refund the buyer manually', v_collected;
  end if;
end $$;

-- ── Settlement: give the seller back the cash the coupon took off ───────────
-- Identical to 0025 apart from `v_cod_platform_discount`. On a COD order the
-- seller hands over goods worth `total` but only collects
-- `total + fees − platform_discount` in cash, so settling them on `total` alone
-- would quietly make the seller fund a platform promotion. The discount is
-- added back to what the platform pays out.
--
-- Prepaid orders need no such term: the buyer paid the discounted amount to the
-- platform, and the platform still pays the seller the full goods value.
create or replace function settle_boutique_payout(p_boutique_id uuid, p_note text default null)
returns payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate constant numeric := 0.10;
  v_payout payouts;
  v_ids uuid[];
  v_count int := 0;
  v_prepaid_goods numeric := 0;
  v_prepaid_commission numeric := 0;
  v_prepaid_fees numeric := 0;
  v_cod_commission numeric := 0;
  v_cod_fees numeric := 0;
  v_cod_platform_discount numeric := 0;
  v_amount numeric := 0;
begin
  if not is_admin() then
    raise exception 'payouts: admin only';
  end if;

  select
    coalesce(array_agg(o.id), '{}'::uuid[]),
    count(*)::int,
    coalesce(sum(o.total) filter (where o.payment_method is distinct from 'COD'), 0),
    coalesce(sum(round(o.total * v_rate, 2)) filter (where o.payment_method is distinct from 'COD'), 0),
    coalesce(sum(o.cod_fee + o.shipping_fee) filter (where o.payment_method is distinct from 'COD'), 0),
    coalesce(sum(round(o.total * v_rate, 2)) filter (where o.payment_method = 'COD'), 0),
    coalesce(sum(o.cod_fee + o.shipping_fee) filter (where o.payment_method = 'COD'), 0),
    coalesce(sum(o.platform_discount) filter (where o.payment_method = 'COD'), 0)
  into v_ids, v_count, v_prepaid_goods, v_prepaid_commission, v_prepaid_fees,
       v_cod_commission, v_cod_fees, v_cod_platform_discount
  from orders o
  where o.boutique_id = p_boutique_id
    and o.payout_id is null
    and o.payment_status = 'paid'
    and o.refunded = false
    and o.status not in ('rejected', 'cancelled')
    and coalesce(o.channel, 'online') <> 'offline';

  if v_count = 0 then
    raise exception 'payouts: nothing to settle for this boutique';
  end if;

  -- Net payable = prepaid(goods − commission) − cod(commission + fees) + the
  -- platform-funded discount the seller never collected in cash.
  v_amount := (v_prepaid_goods - v_prepaid_commission)
            - (v_cod_commission + v_cod_fees)
            + v_cod_platform_discount;

  insert into payouts (
    boutique_id, amount, orders_count, gross, commission, fees, cod_adjustment,
    note, created_by, created_by_name
  ) values (
    p_boutique_id,
    round(v_amount, 2),
    v_count,
    round(v_prepaid_goods, 2),
    round(v_prepaid_commission + v_cod_commission, 2),
    round(v_prepaid_fees + v_cod_fees, 2),
    round(v_cod_commission + v_cod_fees - v_cod_platform_discount, 2),
    nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid(),
    coalesce((select full_name from profiles where id = auth.uid()), 'Admin')
  )
  returning * into v_payout;

  update orders set payout_id = v_payout.id where id = any(v_ids);

  return v_payout;
end $$;

revoke all on function settle_boutique_payout(uuid, text) from public, anon;
grant execute on function settle_boutique_payout(uuid, text) to authenticated;
