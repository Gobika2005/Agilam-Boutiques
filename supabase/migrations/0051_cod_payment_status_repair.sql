-- 0051 — Online COD orders that fell through were never actually paid
--
-- `orders.payment_status` defaults to 'paid' (migration 0022). That default is
-- correct for a walk-in POS sale, where create_offline_sale() takes cash at the
-- till and inserts without the column. It is wrong for an online COD order:
-- cash is collected at the door, so an order that was rejected or cancelled was
-- never delivered and no money ever changed hands.
--
-- api/place-order.js has set payment_status = 'pending' on COD orders since
-- migration 0022, so only rows predating that (and any created by other means)
-- carry the bad value. They matter because two things trust this column:
--
--   • the Refunds workbench treats them as refundable — offering to pay back
--     money the platform never received;
--   • the payout queries in 0025/0026 settle on `payment_status = 'paid'`, so a
--     seller could be paid out for an order that was never fulfilled.
--
-- Offline sales are explicitly excluded: their cash really was collected.

update orders
   set payment_status = 'pending',
       paid_at = null
 where channel = 'online'
   and payment_method = 'COD'
   and payment_status = 'paid'
   and status in ('rejected', 'cancelled')
   and delivered_at is null;

/*
 * Keep it true going forward.
 *
 * An online COD order that moves to rejected or cancelled without ever being
 * delivered has, by definition, collected nothing. Rather than rely on every
 * caller remembering, the transition itself clears the settlement state.
 *
 * Only ever downgrades 'paid' → 'pending', and never touches offline sales, a
 * prepaid order (which has a real gateway payment behind it), or an order that
 * was genuinely delivered and later unwound — that one is a real refund.
 *
 * ORDERING MATTERS. `orders_guard_payment_state` (migration 0022) raises
 * "a collected payment cannot be reopened" on any paid → pending move by a
 * non-admin. PostgreSQL fires BEFORE triggers in alphabetical order by trigger
 * name, so this one is deliberately named to sort AFTER that guard: the guard
 * inspects the seller's own update (in which payment_status is unchanged and so
 * passes), and only then does this trigger rewrite the field. Renaming it to
 * anything sorting before "orders_guard_payment_state" would make a seller
 * rejecting their own COD order fail with that exception.
 */
create or replace function zz_cod_clear_payment_on_failure()
returns trigger
language plpgsql
as $$
begin
  if new.channel = 'online'
     and new.payment_method = 'COD'
     and new.status in ('rejected', 'cancelled')
     and new.delivered_at is null
     and new.payment_status = 'paid'
  then
    new.payment_status := 'pending';
    new.paid_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists zz_orders_cod_clear_payment on orders;
create trigger zz_orders_cod_clear_payment
  before update of status on orders
  for each row
  execute function zz_cod_clear_payment_on_failure();
