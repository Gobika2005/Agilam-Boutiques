-- Delivery priced by distance, and the pincode directory that decides it.
--
-- Migration 0076 made the delivery charge the seller's rather than the
-- platform's, but left it as ONE number per shop — while "delivery areas" stayed
-- a free-text box a seller could fill with "All Over Tamil Nadu" or "All India".
-- So the same rupees covered a parcel handed over the counter and a parcel
-- crossing three states, which is not a price anyone can honour.
--
-- A shop now sets a rate per ZONE, relative to itself:
--
--   local     boutiques.delivery_charge           (the existing column)
--   district  boutiques.delivery_charge_district
--   state     boutiques.delivery_charge_state
--   national  boutiques.delivery_charge_national
--
-- NULL on any of the three new ones means "I do not deliver that far", and
-- checkout refuses the address rather than inventing a price. `delivery_charge`
-- keeps its NOT NULL DEFAULT 0: every shop can serve its own town, and 0 there
-- is a real answer meaning free local delivery.
--
-- The buyer's delivery pincode picks the zone. `resolveZone()` in
-- src/lib/deliveryZone.ts and `zoneFor()` in api/_pricing.js implement identical
-- rules, and both read district/state from the `pincodes` table below — one
-- directory, so the browser's quote and the server's re-derivation cannot
-- disagree and reject a legitimate checkout.
--
-- Idempotent: re-runnable in the Supabase SQL editor.

-- ── 1) Per-zone rates ───────────────────────────────────────────────────────
alter table boutiques add column if not exists delivery_charge_district numeric(10,2);
alter table boutiques add column if not exists delivery_charge_state    numeric(10,2);
alter table boutiques add column if not exists delivery_charge_national numeric(10,2);

comment on column boutiques.delivery_charge is
  'Delivery within the shop''s own town (the "local" zone). NOT NULL: every shop serves its own town, and 0 means free. The three delivery_charge_* columns price the wider zones.';
comment on column boutiques.delivery_charge_district is
  'Delivery elsewhere in the shop''s district. NULL = this shop does not deliver outside its town.';
comment on column boutiques.delivery_charge_state is
  'Delivery elsewhere in the shop''s state. NULL = this shop does not deliver outside its district.';
comment on column boutiques.delivery_charge_national is
  'Delivery to the rest of India. NULL = this shop does not deliver outside its state.';

-- Carry the single rate onto every zone, so the day this is applied each shop
-- charges exactly what it charged the day before and still reaches everyone it
-- used to. Sellers then differentiate the zones at their own pace.
--
-- Runs once: the guard is "no shop has set a zone rate yet".
do $$
begin
  if exists (select 1 from boutiques where delivery_charge_district is not null) then
    raise notice '0077: zone rates already set — backfill skipped.';
    return;
  end if;
  update boutiques
     set delivery_charge_district = delivery_charge,
         delivery_charge_state    = delivery_charge,
         delivery_charge_national = delivery_charge;
end $$;

-- ── 2) The pincode directory ────────────────────────────────────────────────
-- Which district and state a pincode is in, and the localities it covers.
--
-- Filled lazily rather than bulk-imported: the first checkout (or seller signup)
-- that touches a pincode resolves it from India Post and writes the row, and
-- every later use is a local read. Nineteen thousand rows nobody has ordered to
-- are not worth an import, and a live external call in the payment path is not
-- worth the outage.
--
-- It exists mainly so the browser and the server read the SAME answer. Two
-- independent lookups of the same pincode can differ (a transient API failure,
-- a spelling change) and the disagreement would surface as "your payment did
-- not match the order total" on a legitimate checkout.
create table if not exists pincodes (
  pincode    text primary key check (pincode ~ '^[1-9][0-9]{5}$'),
  district   text not null default '',
  state      text not null default '',
  places     text[] not null default '{}',
  fetched_at timestamptz not null default now()
);

comment on table pincodes is
  'Lazily-populated pincode → district/state/localities directory. The shared source of truth for delivery zone resolution (src/lib/deliveryZone.ts and api/_pricing.js). Public reference data: world-readable, written only through upsert_pincode().';

alter table pincodes enable row level security;

-- Public reference data — a pincode's district is not anyone's secret, and the
-- storefront has to read it before the buyer has an account.
drop policy if exists "pincodes readable by all" on pincodes;
create policy "pincodes readable by all" on pincodes for select using (true);

-- No INSERT/UPDATE policy on purpose. Writes go through the function below, so
-- a row can only be created in the shape the resolver expects and nobody can
-- rewrite the directory to move their own address into a cheaper zone.
revoke insert, update, delete on pincodes from anon, authenticated;

/**
 * Record what India Post says about a pincode. Called by the client after a
 * successful lookup, and by the server on a cache miss.
 *
 * SECURITY DEFINER because the table takes no direct writes. First writer wins:
 * an existing row is refreshed only if it is older than 180 days, so a caller
 * cannot overwrite a good answer with a worse one on demand.
 */
create or replace function upsert_pincode(
  p_pincode  text,
  p_district text,
  p_state    text,
  p_places   text[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_pincode !~ '^[1-9][0-9]{5}$' then
    return;
  end if;
  -- A blank district or state is not an answer; storing one would pin every
  -- delivery to that pincode into the national zone for six months.
  if coalesce(btrim(p_district), '') = '' or coalesce(btrim(p_state), '') = '' then
    return;
  end if;

  insert into pincodes (pincode, district, state, places, fetched_at)
  values (p_pincode, btrim(p_district), btrim(p_state), coalesce(p_places, '{}'), now())
  on conflict (pincode) do update
     set district   = excluded.district,
         state      = excluded.state,
         places     = excluded.places,
         fetched_at = now()
   where pincodes.fetched_at < now() - interval '180 days';
end $$;

revoke all on function upsert_pincode(text, text, text, text[]) from public;
grant execute on function upsert_pincode(text, text, text, text[]) to anon, authenticated, service_role;

-- ── 3) Column grants ────────────────────────────────────────────────────────
-- 0021 revoked the blanket SELECT on `boutiques` and grants columns back one at
-- a time; a new column is invisible until named here, and naming an ungranted
-- one fails the whole query (which is why src/data/boutiques.ts keeps these in
-- their own optional group). The rates are quoted to the buyer at checkout, so
-- they are public by definition.
grant select (delivery_charge_district, delivery_charge_state, delivery_charge_national)
  on boutiques to anon, authenticated;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- Every approved shop's rate card, cheapest zone first:
--
--   select name, city, district, state,
--          delivery_charge as local, delivery_charge_district as dist,
--          delivery_charge_state as st, delivery_charge_national as india
--     from boutiques where status = 'approved' order by name;
--
-- Shops that cannot price a zone because their own address is incomplete —
-- these fall back to their national rate for everything, so fix them:
--
--   select id, name from boutiques
--    where status = 'approved'
--      and (coalesce(district,'') = '' or coalesce(state,'') = '');
--
-- The directory as it fills up:
--
--   select count(*) as pincodes_known, max(fetched_at) as newest from pincodes;
