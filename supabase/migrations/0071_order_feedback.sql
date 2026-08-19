-- Ask the buyer how it went, once the order actually arrives.
--
-- The review machinery has existed since 0014, but nothing ever ASKED. The only
-- route to leaving a review was to navigate back to the product page yourself,
-- which almost nobody does — so a marketplace full of delivered orders carried
-- almost no buyer-written proof that any of it was good.
--
-- Two things are collected:
--
--   • Product reviews — the existing `reviews` table, unchanged. These are also
--     the SHOP's rating: 0014's trigger recomputes `boutiques.rating` from them,
--     so rating the item is what rates the boutique. There is deliberately no
--     separate shop review.
--   • Platform feedback — new, and PRIVATE. Nothing about MangaiMart itself is
--     published or attached to any boutique; it is a signal for the operator.
--
-- Additive and idempotent. Run once in the Supabase SQL editor after 0014
-- (reviews), 0044 (notifications) and 0063 (courier tracking).

-- ── Platform feedback ───────────────────────────────────────────────────────
create table if not exists platform_feedback (
  id         uuid primary key default gen_random_uuid(),
  buyer_id   uuid not null references profiles(id) on delete cascade,
  -- Which order prompted it. Nullable so feedback can also be left outside an
  -- order later without a schema change; `on delete set null` keeps the words
  -- even if the order is ever removed.
  order_id   uuid references orders(id) on delete set null,
  rating     int not null check (rating between 1 and 5),
  body       text not null default '',
  created_at timestamptz not null default now(),
  -- One per order. Re-submitting edits rather than stacking duplicates.
  unique (buyer_id, order_id)
);

create index if not exists idx_platform_feedback_created on platform_feedback (created_at desc);
create index if not exists idx_platform_feedback_rating  on platform_feedback (rating);

alter table platform_feedback enable row level security;

-- Buyers write and read their OWN. There is no public read policy and there
-- must not be one: this is feedback about us, given in confidence, and a seller
-- being able to read "the boutique was slow" attached to a buyer's name would
-- change what buyers are willing to say.
do $$ begin
  create policy "platform_feedback: buyer insert own" on platform_feedback
    for insert with check (buyer_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "platform_feedback: buyer read own" on platform_feedback
    for select using (buyer_id = auth.uid() or is_admin());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "platform_feedback: buyer update own" on platform_feedback
    for update using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "platform_feedback: admin all" on platform_feedback
    for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- ── "Don't ask me again" ────────────────────────────────────────────────────
-- The prompt appears in four places (order screen, orders list, notification,
-- and a pop-up on next visit). Without one shared flag they would each keep
-- asking independently, which is how a helpful nudge becomes nagging.
alter table orders add column if not exists review_dismissed_at timestamptz;

-- `orders` has no buyer UPDATE policy and must not get one — a broad grant
-- would let a buyer edit status or total. Same narrow-RPC pattern as 0063's
-- report_delivery_issue.
create or replace function dismiss_order_review(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select buyer_id into v_owner from orders where id = p_order_id;
  if v_owner is null or v_owner is distinct from auth.uid() then
    raise exception 'Order not found' using errcode = 'no_data_found';
  end if;
  update orders set review_dismissed_at = now() where id = p_order_id;
end $$;

revoke all on function dismiss_order_review(uuid) from public;
grant execute on function dismiss_order_review(uuid) to authenticated;

-- ── The delivered notification now asks ─────────────────────────────────────
-- Rather than firing a second notification the moment the first one lands, the
-- existing delivered message carries both jobs — it already deep-links to the
-- order, which is where reviewing and reporting both happen. Two notifications
-- in the same second reads as a malfunction.
--
-- Everything else is 0063's body unchanged.
create or replace function notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ship record;
  v_body text;
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'shipped' then
    select courier_name, awb into v_ship from shipments where order_id = new.id;
    v_body := 'Order #' || substr(new.id::text, 1, 8) || ' is on its way.';
    if v_ship.courier_name is not null then
      v_body := v_body || ' ' || v_ship.courier_name || ' · ' || v_ship.awb;
    end if;
    perform notify(new.buyer_id, 'Orders', 'Your order has shipped', v_body, new.id);
  elsif new.status = 'delivered' then
    perform notify(
      new.buyer_id,
      'Orders',
      'How was your order?',
      'Order #' || substr(new.id::text, 1, 8) || ' has been delivered. Tell us how it was — and if it hasn’t reached you, let us know.',
      new.id
    );
  elsif new.status = 'cancelled' then
    perform notify(new.buyer_id, 'Orders', 'Order cancelled', 'Order #' || substr(new.id::text, 1, 8) || ' was cancelled.', new.id);
  elsif new.status = 'rejected' then
    perform notify(new.buyer_id, 'Orders', 'Order not accepted', 'Order #' || substr(new.id::text, 1, 8) || ' could not be accepted by the seller.', new.id);
  end if;

  if new.payment_status = 'refunded' and old.payment_status is distinct from 'refunded' then
    perform notify(new.buyer_id, 'Orders', 'Refund processed', 'Order #' || substr(new.id::text, 1, 8) || ' has been refunded.', new.id);
  end if;

  return new;
end;
$$;
