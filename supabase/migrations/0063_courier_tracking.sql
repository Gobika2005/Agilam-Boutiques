-- Courier tracking, and the payout validation it makes possible.
--
-- Sellers already ship by courier; the platform just never recorded it. The
-- buyer's tracking screen has drawn six stages since day one but only four were
-- ever real — "Packed" and "Out for Delivery" had no source of truth, so they
-- rendered as decoration with no timestamp.
--
-- The second half matters more than the first. Today `api/run-payouts.js`
-- releases real money on the strength of a seller tapping "Mark delivered" —
-- self-attestation by the party being paid, held back only by a 3-day window.
-- This adds two independent brakes:
--
--   1. No shipment row, no payout. A courier-issued AWB doesn't prove delivery,
--      but it proves a real parcel left the shop, and an admin can check it on
--      the courier's own site.
--   2. A dispute the BUYER can raise. Until now a buyer had no way to say "it
--      never arrived" that stopped the money.
--
-- Additive and idempotent. Run once in the Supabase SQL editor after 0026
-- (delivered_at + payouts) and 0006 (is_admin).
--
--   • couriers    — admin-managed list, mirrors the taxonomy pattern in 0024.
--   • shipments   — one per dispatched order: courier, AWB, tracking link.
--   • orders.*    — packed_at / out_for_delivery_at + the dispute columns.
--   • triggers    — tracking required to ship; a seller cannot clear a dispute.
--   • RPC         — report_delivery_issue(), the buyer's only write path.

-- ── Couriers ────────────────────────────────────────────────────────────────
create table if not exists couriers (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique,
  -- '{awb}' is substituted at render time. NULL is a first-class value: most
  -- Indian courier tracking pages are form-POST with no addressable GET URL, so
  -- a guessed template would hand buyers dead links. Null renders as courier +
  -- AWB with no link, and the seller can still paste a URL per shipment.
  tracking_url_template text,
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table couriers enable row level security;

-- Readable by everyone including anon: the buyer's tracking card names the
-- courier, and guests are never signed in.
do $$ begin
  create policy "couriers: public read active" on couriers for select
    using (active or is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "couriers: admin write" on couriers for all
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- Seeded from the couriers Indian boutiques actually use. Templates are set
-- ONLY where the tracking page takes the AWB in the URL; the rest are left null
-- deliberately (see the column comment) and should be filled in from
-- /admin/couriers once verified against each courier's own site.
insert into couriers (name, tracking_url_template, sort_order) values
  ('Delhivery',            'https://www.delhivery.com/track/package/{awb}', 10),
  ('XpressBees',           'https://www.xpressbees.com/shipment/tracking?awb={awb}', 20),
  ('Ekart Logistics',      'https://ekartlogistics.com/track/{awb}', 30),
  ('DTDC',                 null, 40),
  ('Blue Dart',            null, 50),
  ('India Post',           null, 60),
  ('Trackon Couriers',     null, 70),
  ('Professional Couriers', null, 80),
  ('ST Courier',           null, 90)
on conflict (name) do nothing;

-- ── Shipments ───────────────────────────────────────────────────────────────
create table if not exists shipments (
  id          uuid primary key default gen_random_uuid(),
  -- One parcel per order for now. Orders never span boutiques (orders.boutique_id
  -- is singular), so a split shipment is rare; dropping this is additive later.
  order_id    uuid not null unique references orders(id) on delete cascade,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  courier_id  uuid references couriers(id) on delete set null,
  -- Denormalised on purpose: an admin renaming or deactivating a courier must
  -- never rewrite the history of parcels already sent. Also carries the
  -- free-text name when the seller picked "Other".
  courier_name text not null check (length(trim(courier_name)) > 0),
  awb          text not null check (length(trim(awb)) > 0),
  -- Built from the template, or pasted by the seller. Nullable: courier + AWB
  -- with no link beats a dead link.
  tracking_url text,
  shipped_at   timestamptz not null default now(),
  created_by   uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_shipments_order    on shipments (order_id);
create index if not exists idx_shipments_boutique on shipments (boutique_id);

alter table shipments enable row level security;

-- Seller: their own boutique's parcels. No delete — a dispatched parcel is a
-- fact, and letting a seller erase it would undo the payout gate below.
do $$ begin
  create policy "shipments: seller read" on shipments for select
    using (exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "shipments: seller insert" on shipments for insert
    with check (exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "shipments: seller update" on shipments for update
    using (exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid()));
exception when duplicate_object then null; end $$;

-- Signed-in buyer: their own order's parcel. Guests have buyer_id null and are
-- unreachable by RLS at all — they need the public lookup planned separately.
do $$ begin
  create policy "shipments: buyer read" on shipments for select
    using (exists (select 1 from orders o where o.id = order_id and o.buyer_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "shipments: admin all" on shipments for all
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

create or replace function touch_shipment_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_shipments_updated_at on shipments;
create trigger trg_shipments_updated_at before update on shipments
  for each row execute function touch_shipment_updated_at();

-- ── Orders: the two dead timeline stages, and the dispute ───────────────────
alter table orders add column if not exists packed_at           timestamptz;
-- Only ever set by a courier webhook. Until that exists nothing can honestly
-- set it, and the buyer's stage 4 stays dim rather than being faked off a timer.
alter table orders add column if not exists out_for_delivery_at timestamptz;

alter table orders add column if not exists delivery_disputed     boolean not null default false;
alter table orders add column if not exists delivery_disputed_at  timestamptz;
alter table orders add column if not exists delivery_dispute_note text;
alter table orders add column if not exists delivery_resolved_at  timestamptz;

create index if not exists idx_orders_delivery_disputed
  on orders (delivery_disputed) where delivery_disputed;

-- ── Tracking is required to ship ────────────────────────────────────────────
-- Enforced here, not in the form: RLS and the database are the security
-- boundary, and the payout gate below is only as good as this.
--
-- ORDERING NOTE: 0042's trg_stamp_order_status_timestamp is also a BEFORE
-- UPDATE OF status trigger. Postgres runs same-timing triggers in ALPHABETICAL
-- order, so trg_orders_require_shipment runs first and its exception aborts the
-- statement before any timestamp is stamped. That is the behaviour we want, but
-- it depends on the names — do not rename these casually.
create or replace function orders_require_shipment_on_ship()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' then
    if not exists (select 1 from shipments s where s.order_id = new.id) then
      raise exception 'Add the courier and tracking number before marking this order shipped'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_require_shipment on orders;
create trigger trg_orders_require_shipment
  before update of status on orders
  for each row execute function orders_require_shipment_on_ship();

-- ── A seller cannot clear a dispute against themselves ──────────────────────
-- Same shape as 0026's guard on delivered_at: a seller may report facts, never
-- un-report an accusation. Silently reverted rather than raised, so a seller
-- saving an unrelated field on the order doesn't hit a wall.
create or replace function orders_guard_delivery_dispute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.delivery_disputed and not new.delivery_disputed and not is_admin() then
    new.delivery_disputed    := old.delivery_disputed;
    new.delivery_disputed_at := old.delivery_disputed_at;
    new.delivery_resolved_at := old.delivery_resolved_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_guard_dispute on orders;
create trigger trg_orders_guard_dispute
  before update on orders
  for each row execute function orders_guard_delivery_dispute();

-- ── The buyer's write path ──────────────────────────────────────────────────
-- `orders` has no buyer UPDATE policy (see schema.sql) and it should stay that
-- way — a broad grant would let a buyer edit status or total. This RPC is the
-- narrow exception: it verifies ownership and writes only the dispute columns.
create or replace function report_delivery_issue(p_order_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_status text;
begin
  select buyer_id, status into v_owner, v_status from orders where id = p_order_id;
  if v_owner is null or v_owner is distinct from auth.uid() then
    raise exception 'Order not found' using errcode = 'no_data_found';
  end if;
  -- Only meaningful once the seller claims it arrived. Before that the order is
  -- simply still in transit and there is nothing to contest.
  if v_status is distinct from 'delivered' then
    raise exception 'This order has not been marked delivered yet' using errcode = 'check_violation';
  end if;
  update orders
     set delivery_disputed    = true,
         delivery_disputed_at = coalesce(delivery_disputed_at, now()),
         delivery_dispute_note = coalesce(nullif(trim(p_note), ''), delivery_dispute_note)
   where id = p_order_id;
end $$;

revoke all on function report_delivery_issue(uuid, text) from public;
grant execute on function report_delivery_issue(uuid, text) to authenticated;

-- ── Shipped notification now carries the tracking ───────────────────────────
-- 0044 already notified the buyer on 'shipped'; it just had nothing to tell
-- them beyond "it's on its way". The shipment row is written BEFORE the status
-- flip (see the seller console), so by the time this fires the courier and
-- docket are available. Everything else is 0044's body unchanged.
--
-- Only reaches signed-in buyers — `notify` no-ops on a null profile_id, and a
-- guest order has buyer_id null. Guests have no in-app inbox to deliver to.
create or replace function notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ship record;
  v_body text;
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'shipped' then
    select courier_name, awb into v_ship from shipments where order_id = new.id;
    v_body := 'Order #' || substr(new.id::text, 1, 8) || ' is on its way.';
    if v_ship.courier_name is not null then
      v_body := v_body || ' ' || v_ship.courier_name || ' · ' || v_ship.awb;
    end if;
    perform notify(new.buyer_id, 'Orders', 'Your order has shipped', v_body, new.id);
  elsif new.status = 'delivered' then
    perform notify(new.buyer_id, 'Orders', 'Order delivered', 'Order #' || substr(new.id::text, 1, 8) || ' has been delivered. Not received? Open the order to tell us.', new.id);
  elsif new.status = 'cancelled' then
    perform notify(new.buyer_id, 'Orders', 'Order cancelled', 'Order #' || substr(new.id::text, 1, 8) || ' was cancelled.', new.id);
  elsif new.status = 'rejected' then
    perform notify(new.buyer_id, 'Orders', 'Order not accepted', 'Order #' || substr(new.id::text, 1, 8) || ' could not be accepted by the seller.', new.id);
  end if;

  if new.payment_status = 'refunded' and old.payment_status is distinct from 'refunded' then
    perform notify(new.buyer_id, 'Orders', 'Refund processed', 'Order #' || substr(new.id::text, 1, 8) || ' has been refunded.', new.id);
  end if;

  return new;
end;
$$;

-- ── Payout gating ───────────────────────────────────────────────────────────
-- Filtering the eligibility query in api/run-payouts.js is NOT enough: that
-- query only decides which boutiques get a payout opened, and the function
-- below then sweeps every outstanding order for that boutique. The brakes have
-- to live here, where the amount is actually computed.
--
-- Orders already delivered when this migration ran can never have a shipment
-- row — nobody ever asked the seller for one. Requiring it retroactively would
-- strand money that is legitimately owed, and 0026 hit the same problem with
-- delivered_at. This records the cutover so the requirement applies only to
-- deliveries from here on; anything older is settled on the old rules.
create table if not exists courier_tracking_rollout (
  id         boolean primary key default true check (id),
  started_at timestamptz not null default now()
);
-- `do nothing` is load-bearing: re-running this migration must not move the
-- cutover forward and strand a second batch of orders.
insert into courier_tracking_rollout (id) values (true) on conflict (id) do nothing;

alter table courier_tracking_rollout enable row level security;
do $$ begin
  create policy "courier_tracking_rollout: admin read" on courier_tracking_rollout
    for select using (is_admin());
exception when duplicate_object then null; end $$;

-- Automatic payouts (0026). Adds the shipment requirement and the dispute
-- exclusion; everything else is 0026's body unchanged.
create or replace function open_auto_payout(
  p_boutique_id uuid,
  p_cutoff timestamptz,
  p_method text default null
)
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
  v_goods numeric := 0;
  v_commission numeric := 0;
  v_fees numeric := 0;
  v_amount numeric := 0;
  v_rollout timestamptz;
begin
  select started_at into v_rollout from courier_tracking_rollout limit 1;

  select
    coalesce(array_agg(o.id), '{}'::uuid[]),
    count(*)::int,
    coalesce(sum(o.total), 0),
    coalesce(sum(round(o.total * v_rate, 2)), 0),
    coalesce(sum(o.cod_fee + o.shipping_fee), 0)
  into v_ids, v_count, v_goods, v_commission, v_fees
  from orders o
  where o.boutique_id = p_boutique_id
    and o.payout_id is null
    and o.payment_method is distinct from 'COD'   -- prepaid only
    and o.payment_status = 'paid'
    and o.refunded = false
    and o.status = 'delivered'
    and o.delivered_at is not null
    and o.delivered_at <= p_cutoff
    and coalesce(o.channel, 'online') <> 'offline'
    -- The buyer says it never arrived: hold the money until an admin rules.
    and coalesce(o.delivery_disputed, false) = false
    -- A courier docket, or a delivery that predates this rule.
    and (
      exists (select 1 from shipments s where s.order_id = o.id)
      or (v_rollout is not null and o.delivered_at < v_rollout)
    );

  if v_count = 0 then
    return null;
  end if;

  v_amount := v_goods - v_commission;

  insert into payouts (
    boutique_id, amount, orders_count, gross, commission, fees, cod_adjustment,
    status, provider, method
  ) values (
    p_boutique_id, round(v_amount, 2), v_count, round(v_goods, 2),
    round(v_commission, 2), round(v_fees, 2), 0,
    'processing', 'razorpayx', p_method
  )
  returning * into v_payout;

  update orders set payout_id = v_payout.id where id = any(v_ids);
  return v_payout;
end $$;

-- Manual settlement (0025). A disputed order must not be settled by hand
-- either — the admin resolves the dispute first, which is a deliberate act.
-- No shipment requirement here: manual settlement is where an admin handles
-- exactly the awkward cases the automatic path refuses.
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
    coalesce(sum(o.cod_fee + o.shipping_fee) filter (where o.payment_method = 'COD'), 0)
  into v_ids, v_count, v_prepaid_goods, v_prepaid_commission, v_prepaid_fees, v_cod_commission, v_cod_fees
  from orders o
  where o.boutique_id = p_boutique_id
    and o.payout_id is null
    and o.payment_status = 'paid'
    and o.refunded = false
    and o.status not in ('rejected', 'cancelled')
    and coalesce(o.channel, 'online') <> 'offline'
    and coalesce(o.delivery_disputed, false) = false;

  if v_count = 0 then
    raise exception 'payouts: nothing to settle for this boutique';
  end if;

  -- Net payable = prepaid(goods − commission) − cod(commission + fees).
  v_amount := (v_prepaid_goods - v_prepaid_commission) - (v_cod_commission + v_cod_fees);

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
    round(v_cod_commission + v_cod_fees, 2),
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
