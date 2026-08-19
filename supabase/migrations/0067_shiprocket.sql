-- Shiprocket: booked parcels, and delivery confirmed by a courier scan.
--
-- Phase 4 of COURIER_TRACKING_PLAN.md. 0063 recorded parcels the seller had
-- already shipped; this books them, and — the part that actually matters —
-- takes the `delivered` transition away from the party being paid for it.
--
-- Until now the chain was: seller taps "Mark delivered" → 0026 stamps
-- delivered_at → 3 days pass → api/run-payouts.js sends real money. The only
-- brakes were a clock and an admin noticing. A courier scan arriving on a
-- webhook is a fact from a third party with no stake in the payout, which is
-- the difference between corroboration and proof.
--
--   • shiprocket_auth      — the cached bearer token (their login is rate-limited
--                            and the token lasts 240h; re-authing per call gets
--                            you throttled).
--   • boutiques.*          — per-shop pickup location + opt-in.
--   • shipments.*          — provider, their ids, label, freight, last status.
--   • shipment_events      — every scan, append-only. The buyer's timeline.
--   • apply_shipment_scan  — the webhook's ONLY write path into `orders`.
--
-- WHERE THIS RUNS: api/ holds exactly 12 routes, which is the Vercel Hobby
-- ceiling, so booking and the webhook are Supabase Edge Functions
-- (supabase/functions/shiprocket-*). They authenticate with the service-role
-- key, which is why the tables below carry no anon/authenticated write policy.
--
-- COD IS NEVER BOOKED THROUGH SHIPROCKET. Their COD remittance pays the wallet
-- holder — us — which would make the platform the money handler and break the
-- model migration 0022 encodes, where the seller keeps the cash and owes the
-- commission. Enforced in the Edge Function and again by the trigger below.

-- ── Cached API token ────────────────────────────────────────────────────────
-- Singleton, same shape as courier_tracking_rollout in 0063. RLS is enabled
-- with NO policies at all: this is a bearer token with full account authority,
-- and only the service role (which bypasses RLS) has any business reading it.
create table if not exists shiprocket_auth (
  id         boolean primary key default true check (id),
  token      text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table shiprocket_auth enable row level security;
revoke all on shiprocket_auth from anon, authenticated;

-- ── Per-boutique pickup ─────────────────────────────────────────────────────
-- Shiprocket's multi-vendor pattern: one platform account, each seller a
-- registered *pickup location* under it, addressed by the nickname their panel
-- assigns. Sellers never get their own Shiprocket account or KYC — that was the
-- deciding argument in §12 of the plan, since boutique signup is already seven
-- steps plus approval.
alter table boutiques add column if not exists shiprocket_pickup_location text;
alter table boutiques add column if not exists shiprocket_enabled boolean not null default false;

comment on column boutiques.shiprocket_pickup_location is
  'Nickname of this shop''s pickup location as registered in the platform Shiprocket panel. NULL = not registered, cannot book.';

-- CLAUDE.md rule 5: boutiques lost its blanket SELECT in 0021. A column not
-- named here is invisible even to its owner.
grant select (shiprocket_pickup_location, shiprocket_enabled) on boutiques to anon, authenticated;

-- ── Shipments: who booked it, and what came back ────────────────────────────
alter table shipments add column if not exists provider text not null default 'manual';

do $$ begin
  alter table shipments add constraint shipments_provider_check
    check (provider in ('manual', 'shiprocket'));
exception when duplicate_object then null; end $$;

alter table shipments add column if not exists sr_order_id     text;
alter table shipments add column if not exists sr_shipment_id  text;
alter table shipments add column if not exists sr_courier_name text;
alter table shipments add column if not exists label_url       text;
alter table shipments add column if not exists manifest_url    text;
-- What Shiprocket charged US for this parcel. Belongs in the expense tracker
-- (0056) at reconciliation time; recorded here because it arrives per shipment.
alter table shipments add column if not exists freight_charge  numeric(10,2);
alter table shipments add column if not exists declared_weight_kg numeric(6,2);
-- Latest normalised scan, denormalised off shipment_events so an order list can
-- show status without a join per row.
alter table shipments add column if not exists last_status     text;
alter table shipments add column if not exists last_status_at  timestamptz;

create index if not exists idx_shipments_sr_shipment on shipments (sr_shipment_id)
  where sr_shipment_id is not null;
create index if not exists idx_shipments_awb on shipments (awb);

-- ── Scan history ────────────────────────────────────────────────────────────
-- Append-only. The buyer's timeline reads this; nothing updates a scan, because
-- a scan is something that happened.
create table if not exists shipment_events (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  order_id    uuid not null references orders(id) on delete cascade,
  awb         text,
  -- The courier's own wording, kept verbatim for support ("Undelivered -
  -- consignee not available"). Never parsed by the UI.
  raw_status  text not null,
  -- Our five stages. Anything unrecognised maps to 'in_transit' rather than
  -- inventing a stage: a status we have never seen must not move an order.
  stage       text not null check (stage in ('picked_up','in_transit','out_for_delivery','delivered','rto','failed')),
  location    text,
  occurred_at timestamptz,
  payload     jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists idx_shipment_events_order on shipment_events (order_id, occurred_at desc);

-- Shiprocket retries webhooks, and retries are not new scans. Two deliveries of
-- the same scan collapse to one row instead of stamping the timeline twice.
--
-- The coalesce is load-bearing twice over: a plain unique index would treat two
-- NULL occurred_at values as distinct (Postgres NULLs never collide), and
-- coalescing to created_at instead would defeat the index entirely, since
-- created_at defaults to now() and every retry would carry a fresh one. A fixed
-- sentinel makes "same shipment, same status, no timestamp" a single row.
create unique index if not exists uq_shipment_event_dedupe
  on shipment_events (shipment_id, raw_status, coalesce(occurred_at, 'epoch'::timestamptz));

alter table shipment_events enable row level security;

-- Readable by the people the parcel belongs to; written only by the service
-- role, which bypasses RLS. No insert policy exists on purpose.
do $$ begin
  create policy "shipment_events: seller read" on shipment_events for select
    using (exists (
      select 1 from shipments s join boutiques b on b.id = s.boutique_id
      where s.id = shipment_id and b.owner_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "shipment_events: buyer read" on shipment_events for select
    using (exists (select 1 from orders o where o.id = order_id and o.buyer_id = auth.uid()));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "shipment_events: admin all" on shipment_events for all
    using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- ── COD is never booked through the aggregator ──────────────────────────────
-- The Edge Function refuses first; this is the boundary that actually holds,
-- per CLAUDE.md rule 7. A COD parcel booked here would have Shiprocket's
-- remittance land in the platform wallet, silently making us the money handler.
create or replace function shipments_reject_cod_booking()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_method text;
begin
  if new.provider = 'shiprocket' then
    select payment_method into v_method from orders where id = new.order_id;
    if v_method = 'COD' then
      raise exception 'Cash-on-delivery orders cannot be booked through Shiprocket — ship them with your own courier'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_shipments_reject_cod on shipments;
create trigger trg_shipments_reject_cod
  before insert or update of provider on shipments
  for each row execute function shipments_reject_cod_booking();

-- ── The webhook's only write path ───────────────────────────────────────────
-- SECURITY DEFINER and deliberately narrow. The Edge Function hands it a scan;
-- it decides what that means for the order. Nothing else in the codebase may
-- move an order to 'delivered' from a webhook.
--
-- ON delivered_at: 0026's orders_stamp_delivered trigger stamps now() on the
-- →delivered transition and reverts any other write by a non-admin. We do NOT
-- fight it. The courier's own scan time is kept on the event row; delivered_at
-- becomes the moment we RECEIVED the scan, which is always at or after it. That
-- is the conservative direction for the payout hold — it can only ever delay
-- money, never release it early — so it is the right way to lose the argument.
create or replace function apply_shipment_scan(
  p_awb         text,
  p_raw_status  text,
  p_stage       text,
  p_location    text default null,
  p_occurred_at timestamptz default null,
  p_payload     jsonb default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ship   shipments;
  v_status text;
begin
  select * into v_ship from shipments where awb = trim(p_awb) limit 1;
  if v_ship.id is null then
    -- An AWB we never issued. Not an error worth failing the webhook over —
    -- Shiprocket will retry forever on a non-2xx — so record nothing and let
    -- the caller log it.
    return false;
  end if;

  insert into shipment_events (shipment_id, order_id, awb, raw_status, stage, location, occurred_at, payload)
  values (v_ship.id, v_ship.order_id, v_ship.awb, p_raw_status, p_stage, p_location, p_occurred_at, p_payload)
  on conflict do nothing;

  update shipments
     set last_status = p_stage,
         last_status_at = coalesce(p_occurred_at, now())
   where id = v_ship.id;

  select status into v_status from orders where id = v_ship.order_id;

  -- A scan never resurrects a finished order. Cancelled, rejected and refunded
  -- orders are closed books, and a late courier scan must not reopen one.
  if v_status in ('cancelled', 'rejected') then
    return true;
  end if;

  if p_stage = 'out_for_delivery' then
    -- Stage 4 of the buyer's timeline has been decoration since day one because
    -- nothing could honestly set it. This is the only thing that ever can.
    update orders
       set out_for_delivery_at = coalesce(out_for_delivery_at, coalesce(p_occurred_at, now()))
     where id = v_ship.order_id;

  elsif p_stage = 'delivered' then
    -- The whole point. The courier says it arrived, not the seller.
    if v_status is distinct from 'delivered' then
      update orders set status = 'delivered' where id = v_ship.order_id;
    end if;

  elsif p_stage = 'rto' then
    -- Returned to origin: it never reached the buyer, so it must never pay out.
    -- Flagged as a dispute rather than silently cancelled — the money question
    -- (who eats the RTO freight) is an admin's to settle, and 0063 already stops
    -- a disputed order from being swept.
    update orders
       set delivery_disputed = true,
           delivery_disputed_at = coalesce(delivery_disputed_at, now()),
           delivery_dispute_note = coalesce(delivery_dispute_note,
             'Returned to origin by the courier: ' || coalesce(p_raw_status, 'RTO'))
     where id = v_ship.order_id;
  end if;

  return true;
end $$;

-- Locked to the service role. Revoking from PUBLIC also removes the default
-- EXECUTE that service_role would otherwise inherit, so the grant back is not
-- redundant — without it the webhook fails with "permission denied for function".
revoke all on function apply_shipment_scan(text, text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function apply_shipment_scan(text, text, text, text, timestamptz, jsonb)
  to service_role;

-- ── Master switch ───────────────────────────────────────────────────────────
-- Off by default: applying this migration must not start booking parcels. An
-- admin turns it on once credentials are set and one test parcel has gone out.
alter table platform_settings add column if not exists shiprocket_enabled boolean not null default false;
