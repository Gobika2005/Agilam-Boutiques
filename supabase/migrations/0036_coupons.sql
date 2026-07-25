-- Coupons — buyer discount codes, created from the admin console (platform-wide)
-- or by a seller for their own boutique.
--
-- Until now coupons were a hardcoded list mirrored in src/data/demo.ts (client)
-- and api/_pricing.js (server); there was no way to add one without a code
-- change. This migration makes them real, editable rows:
--
--   • A row with boutique_id = NULL is a PLATFORM coupon (admin-created). It
--     discounts the whole cart. The platform funds it — exactly as the hardcoded
--     coupons did — so it never touches a seller's payout.
--   • A row with boutique_id SET is a SELLER coupon. It only discounts that
--     boutique's items in the cart, and the SELLER funds it: place-order.js
--     stores that boutique's order `total` net of the discount, so the existing
--     payout math (0025) settles — and takes commission on — the discounted
--     amount with no change to the settlement function.
--
-- The buyer still enters ONE code at checkout; the server (api/_pricing.js) looks
-- it up here, decides the applicable base (whole cart vs the owning boutique's
-- lines) and re-derives the exact paise the payment must carry — the same
-- amount-binding guard create-order/place-order already use. So a coupon still
-- cannot be forged from the browser.
--
-- Idempotent: re-runnable in the Supabase SQL editor. Requires 0006 (is_admin,
-- profiles) and 0021 (boutiques.owner_id), and the base orders table.

-- ── The coupon rows ─────────────────────────────────────────────────────────
create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  -- NULL = platform (admin) coupon; set = this boutique's own coupon.
  boutique_id uuid references boutiques(id) on delete cascade,
  type text not null default 'pct',            -- 'pct' | 'flat' | 'ship'
  -- The discount value: percent for 'pct', rupees for 'flat', ignored for 'ship'.
  off numeric(12,2) not null default 0,
  min_subtotal numeric(12,2) not null default 0, -- applicable base must reach this
  max_discount numeric(12,2),                  -- cap for 'pct' (null = uncapped)
  description text not null default '',
  expires_at date not null,
  active boolean not null default true,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint coupons_type_check check (type in ('pct', 'flat', 'ship')),
  -- Free-delivery ('ship') is a cart-level, platform-funded lever only — a seller
  -- coupon must be a goods discount so it can be netted off that boutique's order.
  constraint coupons_seller_type_check check (boutique_id is null or type in ('pct', 'flat')),
  constraint coupons_off_check check (off >= 0),
  constraint coupons_min_check check (min_subtotal >= 0),
  constraint coupons_cap_check check (max_discount is null or max_discount >= 0)
);

-- One code across the whole marketplace: the buyer types a bare code and the
-- server resolves it by code alone, so two boutiques can't both own 'SALE10'.
-- Case-insensitive — codes are entered and matched uppercased.
create unique index if not exists coupons_code_unique on coupons (upper(code));
create index if not exists idx_coupons_boutique on coupons (boutique_id);
create index if not exists idx_coupons_active on coupons (active, expires_at);

alter table coupons enable row level security;

-- Admin sees and does everything (create/edit platform coupons, moderate any).
do $$ begin
  create policy "coupons: admin all" on coupons for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- A seller fully manages ONLY their own boutique's coupons. The check also blocks
-- a seller from creating a platform coupon (boutique_id null never matches an
-- owned boutique) or one for a boutique they don't own.
do $$ begin
  create policy "coupons: seller manage own" on coupons for all using (
    boutique_id is not null
    and exists (select 1 from boutiques b where b.id = coupons.boutique_id and b.owner_id = auth.uid())
  ) with check (
    boutique_id is not null
    and exists (select 1 from boutiques b where b.id = coupons.boutique_id and b.owner_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

-- Buyers browse anonymously, so anon/authenticated may READ any currently-valid
-- coupon (to list offers). Expired/deactivated rows stay hidden. This also lets a
-- seller see the platform coupons on their read-only "platform offers" list.
do $$ begin
  create policy "coupons: public read active" on coupons for select using (
    active and expires_at >= current_date
  );
exception when duplicate_object then null; end $$;

-- Keep updated_at honest no matter who writes (admin console, seller app).
create or replace function coupons_touch_updated_at()
returns trigger language plpgsql set search_path = public
as $$ begin new.updated_at := now(); return new; end $$;

drop trigger if exists coupons_touch on coupons;
create trigger coupons_touch before update on coupons
  for each row execute function coupons_touch_updated_at();

-- ── Per-order discount record ───────────────────────────────────────────────
-- The rupee value a SELLER coupon took off this boutique's order. Informational:
-- `total` is already stored net of it, so payouts (0025) need no change. Kept so
-- the order can show "you saved ₹X" and analytics can separate goods from
-- discount. Platform-coupon discounts are cart-level and never land here.
alter table orders add column if not exists discount numeric(12,2) not null default 0;
