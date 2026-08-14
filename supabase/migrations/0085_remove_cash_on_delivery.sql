-- Withdraw cash on delivery from MangaiMart, permanently.
--
-- Every order is now prepaid: the buyer pays in full through Razorpay before
-- `api/place-order.js` writes a row. That endpoint refuses `paymentMethod: 'COD'`
-- outright, the checkout no longer offers it, and the seller console no longer
-- has a switch for it. This file is the database's half of that decision, and it
-- exists because the app-side change alone is not a guarantee — a stale bundle,
-- a replayed request or a direct PostgREST call must fail too.
--
-- ── What this file deliberately does NOT do ─────────────────────────────────
--
-- It drops nothing. `boutiques.cod_enabled / cod_fee / cod_max_order`,
-- `platform_settings.cod_enabled`, `orders.cod_fee`, `payouts.cod_adjustment`
-- and `cancel_cod_order()` all stay exactly where they are.
--
-- That is not laziness. Orders placed before today are still in `orders` with
-- `payment_method = 'COD'` and a real `cod_fee`, and that fee is part of what
-- the buyer actually paid. Drop the column and every one of those orders'
-- invoices, payout statements and monthly reports stops adding up — you would be
-- destroying the record of money that genuinely moved. `settle_boutique_payout`
-- still nets a legacy cash order correctly for the same reason.
--
-- ── The locks ───────────────────────────────────────────────────────────────
--
-- Enforced with TRIGGERS, not column revokes. Revoking a column from
-- `authenticated` is what made coupons 403-dead for sellers AND admins alike in
-- 0058 — the revoke applies to the role, so it takes the admin down with the
-- seller. A trigger refuses the specific write and says why.
--
--   1. `boutiques`  — cod_enabled can never become true again; the fee and cap
--                     are pinned at 0.
--   2. `platform_settings` — the master switch can never be turned back on.
--   3. `orders`     — no new row may be written with payment_method = 'COD'.
--                     UPDATEs are untouched, so a legacy cash order can still be
--                     corrected, refunded or settled.
--
-- Idempotent. Run once in the Supabase SQL editor, after 0084.

-- ── 1. Settle the existing data ─────────────────────────────────────────────
-- Every shop that had cash on delivery switched on is switched off, and its fee
-- and cap are zeroed so nothing can price from a leftover number. `boutiques`
-- has column-level grants (0021), so this runs as the migration's owner.
update boutiques
   set cod_enabled   = false,
       cod_fee       = 0,
       cod_max_order = 0
 where cod_enabled is distinct from false
    or coalesce(cod_fee, 0) <> 0
    or coalesce(cod_max_order, 0) <> 0;

alter table boutiques alter column cod_enabled   set default false;
alter table boutiques alter column cod_fee       set default 0;
alter table boutiques alter column cod_max_order set default 0;

update platform_settings set cod_enabled = false where id = 1 and cod_enabled is distinct from false;
alter table platform_settings alter column cod_enabled set default false;

comment on column boutiques.cod_enabled is
  'Retired (0085). Cash on delivery was withdrawn platform-wide; pinned false by trg_boutiques_no_cod. Kept only so historical rows and reports over them still parse.';
comment on column orders.cod_fee is
  'Cash-handling fee on a pre-0085 order. Always 0 since cash on delivery was withdrawn, but load-bearing on older rows: total + shipping_fee + cod_fee - platform_discount is what that buyer paid.';

-- ── 2. A boutique can never re-enable it ────────────────────────────────────
create or replace function boutiques_no_cod()
returns trigger
language plpgsql
as $$
begin
  -- Silently corrected rather than raised: this fires on every ordinary save of
  -- an unrelated field (a phone number, opening hours), and failing those saves
  -- because of a column the seller cannot even see would be baffling. The
  -- refusal that a human reads is in the seller console's Settings card.
  new.cod_enabled   := false;
  new.cod_fee       := 0;
  new.cod_max_order := 0;
  return new;
end;
$$;

drop trigger if exists trg_boutiques_no_cod on boutiques;
create trigger trg_boutiques_no_cod
  before insert or update on boutiques
  for each row
  execute function boutiques_no_cod();

-- ── 3. The master switch stays off ──────────────────────────────────────────
create or replace function platform_settings_no_cod()
returns trigger
language plpgsql
as $$
begin
  new.cod_enabled := false;
  return new;
end;
$$;

drop trigger if exists trg_platform_settings_no_cod on platform_settings;
create trigger trg_platform_settings_no_cod
  before insert or update on platform_settings
  for each row
  execute function platform_settings_no_cod();

-- ── 4. No new unpaid order, whatever asks for one ───────────────────────────
-- The real gate is api/place-order.js, which never takes the COD branch any
-- more. This is the backstop for everything that does not go through it: an old
-- cached bundle still posting `paymentMethod: 'COD'` to a rolled-back deploy, a
-- service-role script, a hand-rolled PostgREST call.
--
-- INSERT only. An existing cash order must remain fully updatable — collected,
-- refunded, disputed, stamped with a payout — or this migration would strand the
-- very history it set out to preserve.
create or replace function orders_no_cod()
returns trigger
language plpgsql
as $$
begin
  if new.payment_method = 'COD' then
    raise exception 'COD_WITHDRAWN: cash on delivery is no longer offered on MangaiMart. Every order must be paid online before it is placed.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_no_cod on orders;
create trigger trg_orders_no_cod
  before insert on orders
  for each row
  execute function orders_no_cod();

-- ── 5. Tell the sellers ─────────────────────────────────────────────────────
-- Sellers who deliberately switched cash on delivery on have just had a setting
-- taken away. Saying nothing means they find out from the empty toggle, or from
-- a buyer asking why the option vanished.
--
-- Type must be 'Updates' — `notifications_type_check` (0044) allows only
-- Orders / Messages / Updates / Wishlist. Guarded on the title so re-running
-- this file does not send the same message twice.
insert into notifications (profile_id, type, title, body)
select b.owner_id,
       'Updates',
       'Cash on delivery has been withdrawn',
       'From today every MangaiMart order is paid in full online — UPI, card or net banking — before it reaches you. '
       || 'You will not be asked to send stock that has not been paid for, and there is no cash to count or hand back at the door. '
       || 'The cash-on-delivery switch, handling fee and cash limit have been removed from your Settings. '
       || 'Your delivery charges, dispatch time and return window are unchanged.'
  from boutiques b
 where b.owner_id is not null
   and not exists (
     select 1 from notifications n
      where n.profile_id = b.owner_id
        and n.title = 'Cash on delivery has been withdrawn'
   );
