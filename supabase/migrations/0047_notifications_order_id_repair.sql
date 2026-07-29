-- Repair: notifications.order_id missing on databases that predate 0018.
--
-- 0018 created `notifications` with an `order_id` column, and the notify()
-- helper (0044) writes it on every notification. But a project whose
-- `notifications` table was created by an earlier hand-run (or by a schema
-- snapshot taken before 0018) can be missing the column. When that happens the
-- notify_new_message trigger throws
--   column "order_id" of relation "notifications" does not exist
-- inside the buyer's message INSERT, so the whole send fails ("Could not send").
--
-- Add the column (and the widened type check + FK) only if absent. Additive and
-- idempotent — safe to run on a database that already has 0018/0044 applied.

alter table notifications
  add column if not exists order_id uuid references orders(id) on delete cascade;

-- Make sure the type check allows every category the triggers write, in case an
-- older constraint (pre-0044) is still in force on this database.
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('Orders', 'Messages', 'Updates', 'Wishlist'));
