-- Seller-set delivery & cash-on-delivery, and the shop's map pin.
--
-- Two changes that both live on `boutiques`:
--
-- 1. DELIVERY AND COD BECOME THE SELLER'S TERMS.
--
--    The buyer used to be charged a platform delivery fee (`standard_shipping`,
--    waived over `free_delivery_over`) and a platform COD fee (`cod_fee`, capped
--    at `cod_max_order`), all four set in the admin console's Platform Settings.
--    Meanwhile every seller had been typing a `delivery_charge` into onboarding
--    since migration 0021 that nothing ever charged.
--
--    That is inverted here: `boutiques.delivery_charge` is what the buyer pays,
--    and three new columns beside it complete the picture. The admin console no
--    longer offers any of the four platform fields.
--
--    Because a cart spanning two boutiques is already two orders, shipped and
--    collected separately, delivery and cash handling are now charged PER
--    BOUTIQUE — see the note on `ShopTerms` in src/lib/pricing.ts. Each order
--    row stores the fees it actually carried, exactly as before.
--
-- 2. THE SHOP'S EXACT LOCATION.
--
--    `map_url` existed and was optional. It is now required by the seller wizard
--    and settings screen, and `latitude`/`longitude` store the pin itself when
--    the seller drops one with GPS (a shortened maps.app.goo.gl link carries no
--    coordinates, so the link alone cannot be relied on to hold the point).
--
-- The platform_settings columns these replace (`standard_shipping`,
-- `free_delivery_over`, `cod_fee`, `cod_max_order`) are deliberately NOT
-- dropped: nothing reads them any more, and dropping live columns to tidy up is
-- not worth the risk of an older deploy still selecting one. `cod_enabled` on
-- platform_settings (migration 0066) is untouched and still works — it is the
-- kill switch for cash across the whole marketplace, which is a different
-- decision from what one shop charges.
--
-- Idempotent: re-runnable in the Supabase SQL editor.

-- ── Columns ─────────────────────────────────────────────────────────────────
-- Defaults are the conservative reading of "the seller has not told us yet":
-- charge nothing extra, never waive automatically, do not cap. `cod_max_order`
-- is the exception — a new shop starts at the ₹10,000 limit the platform used
-- to apply, because "no limit" is a bad thing to acquire by accident.
alter table boutiques add column if not exists free_delivery_over numeric(10,2) not null default 0;
alter table boutiques add column if not exists cod_fee            numeric(10,2) not null default 0;
alter table boutiques add column if not exists cod_max_order      numeric(10,2) not null default 10000;
alter table boutiques add column if not exists latitude           double precision;
alter table boutiques add column if not exists longitude          double precision;

comment on column boutiques.delivery_charge is
  'What this boutique charges the buyer to deliver its own order. Charged once per order from this shop (a multi-boutique cart pays one per shop), waived when this shop''s goods in the bag reach free_delivery_over. Mirrored by shopShipFee() in src/lib/pricing.ts and api/_pricing.js.';
comment on column boutiques.free_delivery_over is
  'This boutique''s goods value in the bag that earns free delivery from it. 0 = never waived.';
comment on column boutiques.cod_fee is
  'Cash-handling fee this boutique adds per cash delivery. 0 = no fee. Stored on the order as orders.cod_fee.';
comment on column boutiques.cod_max_order is
  'Largest order (goods − discount + delivery + handling) this boutique will send unpaid. 0 = no cap.';
comment on column boutiques.latitude is
  'Shop map pin, set from the seller''s device with GPS. Null when only a shortened Maps share link was given.';
comment on column boutiques.longitude is
  'See boutiques.latitude.';

-- ── Carry the platform''s current terms over to every existing shop ──────────
-- Without this, applying the migration would silently drop the COD fee every
-- live boutique was charging to zero. The delivery charge is deliberately NOT
-- backfilled from `standard_shipping`: sellers already entered their own, and
-- overwriting it would charge buyers a number no seller chose.
--
-- Runs at most once. The guard is "no boutique has set a fee of its own yet":
-- once any shop has, this migration has already done its job (or a seller has
-- made a deliberate choice), and re-running the file must not overwrite either.
do $$
declare
  v_cod_fee numeric;
  v_cod_cap numeric;
begin
  if to_regclass('public.platform_settings') is null then
    return;
  end if;
  if exists (select 1 from boutiques where cod_fee <> 0) then
    raise notice '0076: COD fees already set per boutique — backfill skipped.';
    return;
  end if;

  execute 'select cod_fee, cod_max_order from platform_settings where id = 1'
     into v_cod_fee, v_cod_cap;

  if v_cod_fee is not null then
    update boutiques set cod_fee = v_cod_fee;
  end if;
  if v_cod_cap is not null then
    update boutiques set cod_max_order = v_cod_cap;
  end if;
exception
  when undefined_column then
    -- platform_settings predates 0048's fee columns: nothing to carry over.
    null;
end $$;

-- ── Column grants ───────────────────────────────────────────────────────────
-- Migration 0021 revoked the blanket SELECT on `boutiques` and grants columns
-- back one at a time, so a new column is invisible until it is named here — and
-- naming an ungranted column fails the WHOLE query, which is why
-- src/data/boutiques.ts keeps these in their own optional group.
--
-- All five are safe to publish: the delivery terms are quoted to the buyer at
-- checkout, and the map pin is the location the boutique page already links to.
grant select (free_delivery_over, cod_fee, cod_max_order, latitude, longitude)
  on boutiques to anon, authenticated;

-- No UPDATE grant is needed: unlike SELECT, update on `boutiques` was never
-- narrowed to a column list — a seller writes their own row through the RLS
-- policy from 0021, with the guard triggers (0021 admin fields, 0023 counters,
-- 0072 rating) pinning the columns they must not touch. None of them covers
-- these five, which is correct: they are the seller's to set.

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After applying, this is what every shop now charges:
--
--   select name, delivery_charge, free_delivery_over, cod_enabled, cod_fee,
--          cod_max_order, (latitude is not null) as pinned
--     from boutiques
--    where status = 'approved'
--    order by name;
--
-- And this should return no rows — an approved shop with no map location:
--
--   select id, name from boutiques
--    where status = 'approved' and coalesce(map_url, '') = '';
