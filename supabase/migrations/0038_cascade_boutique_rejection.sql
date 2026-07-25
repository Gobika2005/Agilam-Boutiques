-- Cascade a boutique's rejection to its products.
--
-- When an admin rejects a boutique its whole shopfront must disappear from the
-- buyer app. RLS (migration 0034) already hides any product whose boutique is
-- not 'approved', so buyers stop seeing them the moment the status flips —
-- however the product ROWS keep status='active', so they still read as "live"
-- in the seller studio and the admin Products table, and the hiding depends
-- entirely on 0034 being applied.
--
-- This makes the intent explicit and DB-owned: rejecting a boutique flips its
-- currently-live products to 'hidden', and re-approving the boutique restores
-- exactly those products — so a seller who is sent back and later cleared does
-- not have to re-list every item by hand.
--
-- A marker column, `auto_hidden`, separates products this cascade hid from ones
-- an admin or the seller hid on purpose (status 'hidden'/'rejected' with
-- auto_hidden=false). Only cascade-hidden rows are brought back on approval, so
-- a deliberate moderation decision is never silently undone.
--
-- Idempotent and re-runnable in the Supabase SQL editor.

-- ── Marker column ────────────────────────────────────────────────────────────
alter table products add column if not exists auto_hidden boolean not null default false;

-- ── Cascade function ─────────────────────────────────────────────────────────
-- security definer so the product writes run regardless of who moved the
-- boutique's status (the admin update, place-order's service role, etc.) and are
-- not re-checked against products' own RLS.
create or replace function cascade_boutique_status_to_products()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'rejected' and old.status is distinct from 'rejected' then
    -- Boutique newly rejected → pull its live catalogue out of the buyer app.
    update products
       set status = 'hidden', auto_hidden = true
     where boutique_id = new.id
       and status = 'active'
       and deleted_at is null;

  elsif new.status = 'approved' and old.status is distinct from 'approved' then
    -- Boutique (re)approved → restore only what this cascade hid.
    update products
       set status = 'active', auto_hidden = false
     where boutique_id = new.id
       and auto_hidden = true
       and deleted_at is null;
  end if;

  return new;
end;
$$;

-- ── Trigger ──────────────────────────────────────────────────────────────────
-- AFTER the row is written, and only when the status actually changed, so a
-- plain boutique edit (name, timings, logo) never touches the catalogue. This is
-- independent of 0021's BEFORE trigger that guards who may set the status.
drop trigger if exists trg_cascade_boutique_status on boutiques;
create trigger trg_cascade_boutique_status
  after update of status on boutiques
  for each row
  when (old.status is distinct from new.status)
  execute function cascade_boutique_status_to_products();

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Any product still reading 'active' under a boutique that is already rejected
-- pre-dates this trigger — hide it now so existing rejected shops are clean.
update products p
   set status = 'hidden', auto_hidden = true
 where p.status = 'active'
   and p.deleted_at is null
   and exists (select 1 from boutiques b where b.id = p.boutique_id and b.status = 'rejected');
