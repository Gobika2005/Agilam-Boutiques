-- Repair the wishlist price-drop notification trigger.
--
-- 0044 added `notify_wishlist_price_drop()`, an AFTER UPDATE OF price trigger on
-- products that alerts everyone who wishlisted an item when it gets cheaper. The
-- body builds that alert from `new.name` — but products has no `name` column and
-- never has: the column is `title` (schema.sql). Every other trigger in 0044 that
-- uses `new.name` fires on `taxonomy` or `boutiques`, which do have it, so this
-- one line is the only mismatch.
--
-- PL/pgSQL resolves record fields when the statement is executed, not when the
-- function is created, so the mistake is invisible until a price actually drops.
-- At that moment the trigger raises
--
--     record "new" has no field "name"   (SQLSTATE 42703)
--
-- and, because the trigger is AFTER UPDATE inside the same transaction, it takes
-- the whole UPDATE down with it. The blast radius:
--
--   • Seller studio → My Products → edit → lowering the price fails.
--   • Admin → Products → Edit → lowering the price fails.
--   • Anything else that reduces a product's price (offers/sales manager,
--     scripted corrections) fails the same way.
--
-- Raising a price is fine (the `if new.price < old.price` branch is skipped) and
-- so is any edit that leaves price alone (the trigger's WHEN clause filters it
-- out), which is why this reads as an intermittent "could not update product"
-- rather than a dead page. Zero wishlist rows does not save it either — the
-- INSERT ... SELECT still has to resolve `new.name` before it can return no rows.
--
-- Fix: use `new.title`. Same trigger, same semantics, correct column.
--
-- While here, route the insert through `notify()` (0044's shared writer) for the
-- one thing the hand-rolled INSERT was missing: a NULL profile_id guard. It stays
-- a set-based loop over the wishlist rather than one statement, which is fine —
-- the row count is the number of buyers who saved this exact product.
--
-- Additive and idempotent. Run in the Supabase SQL editor after 0001-0067.

create or replace function notify_wishlist_price_drop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if new.price < old.price then
    for r in select w.buyer_id from wishlist w where w.product_id = new.id loop
      perform notify(
        r.buyer_id,
        'Wishlist',
        'Price drop',
        new.title || ' is now ₹' || new.price::text || ' (was ₹' || old.price::text || ').'
      );
    end loop;
  end if;
  return new;
end;
$$;

-- Recreate the trigger too, so a database that never got 0044 (or got it before
-- the WHEN clause) ends up in exactly the same state as one that did.
drop trigger if exists trg_notify_wishlist_price_drop on products;
create trigger trg_notify_wishlist_price_drop
  after update of price on products
  for each row
  when (new.price is distinct from old.price)
  execute function notify_wishlist_price_drop();
