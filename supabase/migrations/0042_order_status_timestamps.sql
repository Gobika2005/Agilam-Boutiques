-- Per-milestone timestamps on orders.
--
-- The buyer's order-tracking timeline (TrackOrder.tsx) only ever had a real
-- date for "Order Placed" (orders.created_at) — every later step ("Confirmed",
-- "Shipped", "Delivered") showed no time at all, because nothing recorded when
-- the seller actually made those transitions. Adds one column per milestone and
-- a trigger that stamps it the moment `status` changes into it, so the timeline
-- can show a real date and time for each step instead of just the first one.
--
-- Only stamps forward (coalesce keeps an existing value), so re-saving an order
-- at the same status, or a correction that moves it backward, never clobbers a
-- timestamp that already happened.
--
-- Additive and idempotent. Run once in the Supabase SQL editor after 0001+.

alter table orders add column if not exists accepted_at timestamptz;
alter table orders add column if not exists shipped_at timestamptz;
alter table orders add column if not exists delivered_at timestamptz;

create or replace function stamp_order_status_timestamp()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'accepted' then
    new.accepted_at := coalesce(new.accepted_at, now());
  elsif new.status = 'shipped' then
    new.accepted_at := coalesce(new.accepted_at, now());
    new.shipped_at := coalesce(new.shipped_at, now());
  elsif new.status = 'delivered' then
    new.accepted_at := coalesce(new.accepted_at, now());
    new.shipped_at := coalesce(new.shipped_at, now());
    new.delivered_at := coalesce(new.delivered_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_stamp_order_status_timestamp on orders;
create trigger trg_stamp_order_status_timestamp
  before update of status on orders
  for each row
  when (new.status is distinct from old.status)
  execute function stamp_order_status_timestamp();
