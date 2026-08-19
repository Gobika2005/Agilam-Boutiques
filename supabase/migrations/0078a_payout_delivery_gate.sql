-- Payouts: pay for delivered goods only, on an 8-hour clock, and tell the seller.
--
-- Idempotent and re-runnable in the Supabase SQL editor. Requires 0022
-- (payment_status/method), 0025 (payouts), 0044 (notifications), 0048
-- (platform_settings), 0053 (platform_discount) and 0063 (delivered_at).
--
-- ── Why this exists ─────────────────────────────────────────────────────────
--
-- Three separate problems, all in the same function.
--
-- 1. MANUAL SETTLEMENT NEVER CHECKED DELIVERY.
--    The automatic sweep (api/run-payouts.js) has always required
--    `status = 'delivered'` and a hold window. `settle_boutique_payout` — the
--    function the admin console actually uses, because automatic payouts are
--    switched off — required only `payment_status = 'paid'`. A prepaid order
--    placed an hour ago, still sitting unaccepted in the seller's queue, was
--    therefore payable. That is money out of the door for goods that may never
--    ship, against a buyer who can still cancel.
--
--    From here, an order is settleable only once it is `delivered` and carries a
--    `delivered_at` stamp. This is the same bar the automatic path already used,
--    so the two paths finally agree.
--
-- 2. 0063 QUIETLY REVERTED 0053's COD COUPON CREDIT.
--    0053 added `v_cod_platform_discount`: on a COD order carrying a
--    platform-funded coupon the seller collects `total − discount` in cash but
--    is settled on the full `total`, so the platform owes that gap back. 0063
--    re-declared the whole function to add the dispute guard and dropped the
--    variable, silently reinstating the 0025 arithmetic. Since then the admin
--    console has DISPLAYED the credit (src/data/payouts.ts computes
--    `codPlatformDiscount`) while the database has not PAID it — the screen and
--    the money disagreed, and the seller was short. Restored below.
--
-- 3. A HAND-SETTLED SELLER WAS NEVER TOLD.
--    0044's `notify_payout_paid` fires `after update of status` — correct for
--    the automatic path, which opens a payout as 'processing' and later flips it
--    to 'paid'. A manual settlement INSERTs a row that is already 'paid', so the
--    trigger never fired and the seller learned about their money from their
--    bank statement. The trigger now covers insert as well, and says what the
--    payment was actually for.
--
-- ── The 8-hour promise ──────────────────────────────────────────────────────
--
-- `payout_sla_hours` (default 8) is the commitment the seller console publishes:
-- money leaves within 8 hours of delivery. It is deliberately NOT a lock on
-- settlement. Paying a seller EARLY harms nobody, whereas refusing to settle
-- until a timestamp matures would strand real money whenever a courier scan
-- lands late or a delivery is marked by hand. So the hours drive the countdown
-- and the overdue flag in /admin/payments, and delivery drives what is payable.
--
-- `payout_hold_days` is left alone: it still governs api/run-payouts.js if
-- automatic transfers are ever switched back on.

-- ── The SLA setting ─────────────────────────────────────────────────────────
alter table platform_settings
  add column if not exists payout_sla_hours int not null default 8;

comment on column platform_settings.payout_sla_hours is
  'Hours after delivery within which a seller payout is promised. Drives the countdown and the overdue flag in the admin Payouts console and the commitment published in the seller console. Not a settlement lock — an admin may pay earlier.';

-- ── What is payable ─────────────────────────────────────────────────────────
-- Kept as a function rather than inlined so the admin console, the statement
-- view and the settlement all read from ONE definition of "settleable". A
-- boutique's outstanding list and the amount it settles to can then never drift.
create or replace function is_settleable(o orders)
returns boolean
language sql
stable
as $$
  select o.payout_id is null
     and o.payment_status = 'paid'
     and o.refunded = false
     and o.status = 'delivered'
     and o.delivered_at is not null
     and coalesce(o.channel, 'online') <> 'offline'
     and coalesce(o.delivery_disputed, false) = false;
$$;

comment on function is_settleable(orders) is
  'One order, ready to be paid out? Delivered with a timestamp, money real and un-reversed, not disputed, not a walk-in POS sale.';

-- ── Settle a boutique''s outstanding balance ────────────────────────────────
-- Supersedes 0063. Same shape, three changes: delivery is required, 0053''s COD
-- coupon credit is restored, and the "nothing to settle" message now explains
-- which rule excluded the orders rather than implying the boutique has none.
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
  v_undelivered int := 0;
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
    and is_settleable(o);

  if v_count = 0 then
    -- Distinguish "nothing owed" from "owed but not delivered yet". Before this,
    -- an admin who could see money on the dashboard got a flat "nothing to
    -- settle" and no way to tell whether the balance was gone or merely held.
    select count(*)::int into v_undelivered
    from orders o
    where o.boutique_id = p_boutique_id
      and o.payout_id is null
      and o.payment_status = 'paid'
      and o.refunded = false
      and o.status not in ('rejected', 'cancelled')
      and coalesce(o.channel, 'online') <> 'offline'
      and (o.status <> 'delivered' or o.delivered_at is null);

    if v_undelivered > 0 then
      raise exception 'payouts: % paid order(s) are not delivered yet — payouts are released only after delivery', v_undelivered;
    end if;
    raise exception 'payouts: nothing to settle for this boutique';
  end if;

  -- Net payable = prepaid(goods − commission) − cod(commission + fees) + the
  -- platform-funded discount the seller never collected in cash (0053).
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

-- ── Tell the seller, whichever path paid them ───────────────────────────────
-- Replaces 0044's update-only trigger. The message carries the numbers a seller
-- needs to reconcile a bank credit without opening the app: what arrived, for
-- how many orders, and what was deducted.
create or replace function notify_payout_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_body text;
begin
  if new.status <> 'paid' then
    return new;
  end if;

  -- OLD is UNASSIGNED on INSERT — touching old.status there raises "record
  -- 'old' is not assigned yet", and SQL's AND does not promise to short-circuit,
  -- so this must be a nested IF rather than one combined condition.
  if tg_op = 'UPDATE' then
    if old.status = 'paid' then
      return new; -- already announced when it first flipped to paid
    end if;
  end if;

  select owner_id into v_owner_id from boutiques where id = new.boutique_id;
  if v_owner_id is null then
    return new;
  end if;

  v_body := '₹' || trim(to_char(new.amount, 'FM999999990.00'))
         || ' has been transferred for ' || new.orders_count || ' delivered order'
         || case when new.orders_count = 1 then '' else 's' end || '.';

  if new.commission > 0 then
    v_body := v_body || ' Commission deducted: ₹' || trim(to_char(new.commission, 'FM999999990.00')) || '.';
  end if;
  if new.cod_adjustment <> 0 then
    v_body := v_body || ' COD cash you hold, netted off: ₹' || trim(to_char(new.cod_adjustment, 'FM999999990.00')) || '.';
  end if;
  if new.utr is not null then
    v_body := v_body || ' Reference: ' || new.utr || '.';
  elsif new.note is not null then
    v_body := v_body || ' Reference: ' || new.note || '.';
  end if;
  v_body := v_body || ' See Earnings for the order-by-order statement.';

  perform notify(
    v_owner_id,
    'Updates',
    case when new.amount < 0 then 'Payout statement ready' else 'Payout sent' end,
    v_body
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_payout_paid on payouts;
create trigger trg_notify_payout_paid
  after insert or update of status on payouts
  for each row
  execute function notify_payout_paid();

-- ── Index for the statement screens ─────────────────────────────────────────
-- Both the admin drawer ("what is in this boutique's outstanding balance") and
-- the seller statement ("which orders did this payout cover") filter orders by
-- boutique and delivery state.
create index if not exists idx_orders_settlement
  on orders (boutique_id, status, delivered_at)
  where payout_id is null;
