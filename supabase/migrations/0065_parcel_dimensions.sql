-- Parcel weight and dimensions — the data no courier API can be called without.
--
-- Manual AWB entry (0063) never needed this: the seller weighed the parcel at
-- the courier counter and the courier priced it. Booking through an aggregator
-- inverts that — WE declare the weight and box, they price it from our numbers,
-- and then reconcile against what their hub actually measures. A wrong
-- declaration is not a validation error, it is a weight-discrepancy charge
-- appearing on the wallet weeks later, which is far more expensive to chase.
--
-- Shape of the answer:
--   • products.weight_grams   — per item, because a dupatta and a bridal lehenga
--                               are not the same parcel. NULL means "use the
--                               boutique default" so no existing row is broken
--                               and no seller is blocked mid-catalogue.
--   • boutiques.default_*     — the fallback weight and the box the shop packs
--                               in. Dimensions live here, not on the product:
--                               you cannot meaningfully SUM two boxes, and a
--                               boutique realistically ships one or two sizes.
--   • order_parcel_metrics()  — one place that turns an order into
--                               (weight, l, b, h). The Edge Function calls this
--                               rather than reimplementing the fallback chain.
--
-- Additive and idempotent. Nothing reads these columns until the Shiprocket
-- work lands, so applying this early is safe and changes no behaviour.

-- ── Per-product weight ──────────────────────────────────────────────────────
alter table products add column if not exists weight_grams int;

do $$ begin
  alter table products add constraint products_weight_positive
    check (weight_grams is null or (weight_grams > 0 and weight_grams <= 50000));
exception when duplicate_object then null; end $$;

comment on column products.weight_grams is
  'Packed weight of one unit in grams. NULL falls back to boutiques.default_weight_grams.';

-- ── Boutique fallback weight + the box it packs in ──────────────────────────
-- Defaults are a 500 g garment in a 30×24×6 cm poly bag — a realistic saree/
-- kurta parcel and, not coincidentally, inside the 0.5 kg base slab most
-- aggregator plans price from. A seller who ships bulkier goods raises them once
-- in Settings rather than on every product.
alter table boutiques add column if not exists default_weight_grams int not null default 500;
alter table boutiques add column if not exists package_length_cm  numeric(6,2) not null default 30;
alter table boutiques add column if not exists package_breadth_cm numeric(6,2) not null default 24;
alter table boutiques add column if not exists package_height_cm  numeric(6,2) not null default 6;

do $$ begin
  alter table boutiques add constraint boutiques_parcel_sane check (
    default_weight_grams between 1 and 50000
    and package_length_cm  between 1 and 200
    and package_breadth_cm between 1 and 200
    and package_height_cm  between 1 and 200
  );
exception when duplicate_object then null; end $$;

-- CLAUDE.md rule 5: `boutiques` lost its blanket SELECT in 0021, so a new column
-- is invisible — including to its own owner — until it is named in the grant.
-- These four are not secret (they describe a parcel, not a bank account), so
-- they join the public list rather than boutique_private().
grant select (default_weight_grams, package_length_cm, package_breadth_cm, package_height_cm)
  on boutiques to anon, authenticated;

-- ── One order → one parcel ──────────────────────────────────────────────────
-- SECURITY DEFINER so the Edge Function can call it with the anon key on behalf
-- of a verified seller without needing SELECT on every joined table; the guard
-- is the explicit ownership check, mirroring how report_delivery_issue() in 0063
-- validates rather than trusting its caller.
--
-- Returns weight in KILOGRAMS because that is the unit every aggregator API
-- takes, and converting once here beats converting at three call sites.
create or replace function order_parcel_metrics(p_order_id uuid)
returns table (
  weight_kg   numeric,
  length_cm   numeric,
  breadth_cm  numeric,
  height_cm   numeric,
  is_estimated boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_boutique uuid;
  v_default  int;
  v_grams    numeric := 0;
  v_missing  boolean := false;
begin
  select o.boutique_id into v_boutique from orders o where o.id = p_order_id;
  if v_boutique is null then
    raise exception 'Order not found' using errcode = 'no_data_found';
  end if;

  -- Only the boutique that owns the order, or an admin, may ask. A parcel's
  -- weight is commercially uninteresting on its own, but the RPC is executable
  -- by any signed-in account and there is no reason to make it an oracle.
  if not is_admin() and not exists (
    select 1 from boutiques b where b.id = v_boutique and b.owner_id = auth.uid()
  ) then
    raise exception 'Not your order' using errcode = 'insufficient_privilege';
  end if;

  select b.default_weight_grams into v_default from boutiques b where b.id = v_boutique;

  -- Sum the line items. A product deleted since the order was placed, or one the
  -- seller never weighed, falls back to the boutique default — the order must
  -- still be bookable. `is_estimated` tells the caller a fallback was used, so
  -- the seller can be warned before they commit to a declared weight.
  select
    coalesce(sum(coalesce(p.weight_grams, v_default) * oi.qty), 0),
    coalesce(bool_or(p.weight_grams is null), true)
  into v_grams, v_missing
  from order_items oi
  left join products p on p.id = oi.product_id
  where oi.order_id = p_order_id;

  -- An order with no line items still has to produce a bookable parcel.
  if v_grams <= 0 then
    v_grams   := v_default;
    v_missing := true;
  end if;

  return query
  select
    -- Two decimals: aggregators round to 10 g and reject more precision.
    -- The 0.05 kg floor keeps a mis-entered 1 g product from failing validation.
    greatest(round(v_grams / 1000.0, 2), 0.05),
    b.package_length_cm,
    b.package_breadth_cm,
    b.package_height_cm,
    coalesce(v_missing, true)
  from boutiques b
  where b.id = v_boutique;
end $$;

revoke all on function order_parcel_metrics(uuid) from public, anon;
grant execute on function order_parcel_metrics(uuid) to authenticated;
