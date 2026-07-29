-- Notification centre: buyer, seller and admin all get live, DB-backed alerts.
--
-- Until now the `notifications` table (0018) only ever received rows for one
-- event — a seller being told about a new order — written by hand from
-- api/place-order.js. Everything else (order status changes, chat messages,
-- wishlist price drops, ad/catalogue/boutique approvals) had no notification
-- at all. Rather than hunting down every client call site that can move one
-- of these rows, this migration adds `security definer` triggers on the
-- source tables themselves, so a notification fires no matter which code path
-- (client update, admin RPC, webhook) caused the change — the same pattern
-- already used for the boutique-rejection cascade (0038) and the follower
-- counter (0013).
--
-- Additive and idempotent. Run once in the Supabase SQL editor after 0001–0043.

-- ── Widen the type check ─────────────────────────────────────────────────────
-- Wishlist price-drop alerts are a new category alongside the existing
-- Orders/Messages/Updates tabs in the notification inbox.
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('Orders', 'Messages', 'Updates', 'Wishlist'));

-- ── Shared writer ─────────────────────────────────────────────────────────────
-- Every trigger below calls this instead of inserting directly. security
-- definer means it bypasses notifications' RLS (still deliberately
-- insert-policy-free — see 0018) without each trigger function needing its
-- own definer/search_path boilerplate.
create or replace function notify(
  p_profile_id uuid,
  p_type text,
  p_title text,
  p_body text default '',
  p_order_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile_id is null then
    return;
  end if;
  insert into notifications (profile_id, type, title, body, order_id)
  values (p_profile_id, p_type, p_title, p_body, p_order_id);
end;
$$;

-- ── Orders: notify the buyer on fulfilment milestones ───────────────────────
create or replace function notify_order_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'shipped' then
    perform notify(new.buyer_id, 'Orders', 'Your order has shipped', 'Order #' || substr(new.id::text, 1, 8) || ' is on its way.', new.id);
  elsif new.status = 'delivered' then
    perform notify(new.buyer_id, 'Orders', 'Order delivered', 'Order #' || substr(new.id::text, 1, 8) || ' has been delivered.', new.id);
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

drop trigger if exists trg_notify_order_status on orders;
create trigger trg_notify_order_status
  after update of status, payment_status on orders
  for each row
  execute function notify_order_status_change();

-- ── Chat: notify whichever side didn't just send the message ────────────────
create or replace function notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid;
  v_owner_id uuid;
begin
  select c.buyer_id, b.owner_id into v_buyer_id, v_owner_id
  from conversations c
  join boutiques b on b.id = c.boutique_id
  where c.id = new.conversation_id;

  if new.sender_id = v_buyer_id then
    perform notify(v_owner_id, 'Messages', 'New message', left(new.body, 140));
  else
    perform notify(v_buyer_id, 'Messages', 'New message', left(new.body, 140));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_new_message on messages;
create trigger trg_notify_new_message
  after insert on messages
  for each row
  execute function notify_new_message();

-- ── Wishlist: notify on a price drop ─────────────────────────────────────────
-- There is no stock/quantity column on products anywhere in the schema, so
-- "back in stock" isn't trackable today — only a price drop is.
create or replace function notify_wishlist_price_drop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.price < old.price then
    insert into notifications (profile_id, type, title, body)
    select w.buyer_id, 'Wishlist', 'Price drop', new.name || ' is now ₹' || new.price::text || ' (was ₹' || old.price::text || ').'
    from wishlist w
    where w.product_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_wishlist_price_drop on products;
create trigger trg_notify_wishlist_price_drop
  after update of price on products
  for each row
  when (new.price is distinct from old.price)
  execute function notify_wishlist_price_drop();

-- ── Ad campaigns: notify the boutique owner on the admin's decision ─────────
create or replace function notify_ad_campaign_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status not in ('live', 'scheduled', 'rejected') then
    return new;
  end if;

  select owner_id into v_owner_id from boutiques where id = new.boutique_id;

  if new.status in ('live', 'scheduled') then
    perform notify(v_owner_id, 'Updates', 'Ad campaign approved', 'Your "' || new.headline || '" ad is approved.');
  elsif new.status = 'rejected' then
    perform notify(v_owner_id, 'Updates', 'Ad campaign rejected', 'Your "' || new.headline || '" ad was rejected.');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_notify_ad_campaign_status on ad_campaigns;
create trigger trg_notify_ad_campaign_status
  after update of status on ad_campaigns
  for each row
  execute function notify_ad_campaign_status();

-- ── Taxonomy requests: notify admins of a new request, the seller of a decision
create or replace function notify_taxonomy_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (profile_id, type, title, body)
  select id, 'Updates', 'New catalogue request', new.kind || ' "' || new.name || '" needs review.'
  from profiles where role = 'admin';
  return new;
end;
$$;

drop trigger if exists trg_notify_taxonomy_request on taxonomy;
create trigger trg_notify_taxonomy_request
  after insert on taxonomy
  for each row
  when (new.status = 'pending')
  execute function notify_taxonomy_request();

create or replace function notify_taxonomy_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status = 'approved' then
    perform notify(new.requested_by, 'Updates', 'Catalogue request approved', new.kind || ' "' || new.name || '" was approved.');
  elsif new.status = 'rejected' then
    perform notify(new.requested_by, 'Updates', 'Catalogue request rejected', new.kind || ' "' || new.name || '" was rejected.');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_taxonomy_decision on taxonomy;
create trigger trg_notify_taxonomy_decision
  after update of status on taxonomy
  for each row
  execute function notify_taxonomy_decision();

-- ── Boutiques: notify admins of a new signup, the owner of the decision ─────
create or replace function notify_boutique_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (profile_id, type, title, body)
  select id, 'Updates', 'New boutique signup', new.name || ' is awaiting review.'
  from profiles where role = 'admin';
  return new;
end;
$$;

drop trigger if exists trg_notify_boutique_signup on boutiques;
create trigger trg_notify_boutique_signup
  after insert on boutiques
  for each row
  when (new.status = 'pending')
  execute function notify_boutique_signup();

create or replace function notify_boutique_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;
  if new.status = 'approved' then
    perform notify(new.owner_id, 'Updates', 'Boutique approved', new.name || ' is live on the marketplace.');
  elsif new.status = 'rejected' then
    perform notify(new.owner_id, 'Updates', 'Boutique rejected', new.name || ' was not approved.');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_boutique_decision on boutiques;
create trigger trg_notify_boutique_decision
  after update of status on boutiques
  for each row
  execute function notify_boutique_decision();

-- ── Payouts: notify the seller once money actually moves ────────────────────
-- mark_auto_payout_paid is called from three places (the fast-settle branch in
-- run-payouts.js, the RazorpayX webhook, and admin's manual settle_boutique_payout)
-- — a trigger on the row catches all three without touching any of that code.
create or replace function notify_payout_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    select owner_id into v_owner_id from boutiques where id = new.boutique_id;
    perform notify(v_owner_id, 'Updates', 'Payout sent', 'Your payout of ₹' || new.amount::text || ' has been transferred.');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_payout_paid on payouts;
create trigger trg_notify_payout_paid
  after update of status on payouts
  for each row
  execute function notify_payout_paid();
