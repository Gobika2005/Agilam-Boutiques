-- 0081 — Give every notification somewhere to go.
--
-- The inbox has always been able to open a row: `order_id` since 0018, and an
-- explicit `link` since 0077. The problem was that most of the triggers writing
-- notifications set neither, so tapping the row did nothing at all:
--
--   • "New message"                 no link, no order → dead
--   • "Price drop"                  no link           → dead
--   • "Ad campaign approved"        no link           → dead
--   • "Boutique approved/rejected"  no link           → dead
--   • "Catalogue request …"         no link           → dead
--   • "Payout sent"                 no link           → dead
--   • "New catalogue request" (admin) / "New boutique signup" (admin) → dead
--
-- Every one of those is now written through `notify_linked` (0077) with the
-- in-app path it is about. The client validates the path is same-origin before
-- following it, so a bad value degrades to "does nothing" rather than becoming
-- an open redirect — but nothing here is user-authored in the first place.
--
-- A note on which console a path points at: a notification row belongs to
-- exactly one profile, and each trigger below knows whether it is telling the
-- buyer or the boutique owner, so the path can be absolute and unambiguous.
-- `notify_new_message` is the one that has to choose, and it does so on the same
-- branch it already used to pick a recipient.
--
-- Backfill: the static-destination rows (everything that opens a *page* rather
-- than one specific record) are repaired at the bottom by title. "New message"
-- and "Price drop" cannot be — those triggers never recorded which conversation
-- or product they were about, so there is nothing to recover from. The client
-- falls back to the Messages inbox and the Wishlist for them, which is why old
-- rows still do something sensible.
--
-- Additive and idempotent. Run in the Supabase SQL editor after 0001-0080.

-- ── Messages: open the thread, not nothing ──────────────────────────────────
-- Body building is unchanged from 0055 (the `message_preview` sanitisation that
-- keeps @@ORDER@@/@@PRODUCT@@ card payloads out of the notification text —
-- see the chat card preview leak). Only the destination is new.
create or replace function notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid;
  v_owner_id uuid;
  v_body text;
begin
  select c.buyer_id, b.owner_id into v_buyer_id, v_owner_id
  from conversations c
  join boutiques b on b.id = c.boutique_id
  where c.id = new.conversation_id;

  v_body := left(message_preview(new.body), 140);

  if new.sender_id = v_buyer_id then
    -- The buyer wrote it, so the boutique owner is being told: seller console.
    perform notify_linked(
      v_owner_id, 'Messages', 'New message', v_body,
      '/seller/chat/' || new.conversation_id::text
    );
  else
    perform notify_linked(
      v_buyer_id, 'Messages', 'New message', v_body,
      '/chat/' || new.conversation_id::text
    );
  end if;

  return new;
end;
$$;

-- ── Wishlist price drop: open the product ───────────────────────────────────
-- `new.title`, not `new.name` — see 0068a, which is the version this replaces.
-- The PDP route accepts either the slug or the id, and slug is nullable
-- (migration 0057 backfilled it but nothing enforces it), so coalesce.
create or replace function notify_wishlist_price_drop()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_path text;
begin
  if new.price < old.price then
    v_path := '/products/' || coalesce(nullif(new.slug, ''), new.id::text);
    for r in select w.buyer_id from wishlist w where w.product_id = new.id loop
      perform notify_linked(
        r.buyer_id,
        'Wishlist',
        'Price drop',
        new.title || ' is now ₹' || new.price::text || ' (was ₹' || old.price::text || ').',
        v_path
      );
    end loop;
  end if;
  return new;
end;
$$;

-- ── Ad campaign decision: open the seller's Promote screen ──────────────────
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
    perform notify_linked(v_owner_id, 'Updates', 'Ad campaign approved',
      'Your "' || new.headline || '" ad is approved.', '/seller/promote');
  elsif new.status = 'rejected' then
    perform notify_linked(v_owner_id, 'Updates', 'Ad campaign rejected',
      'Your "' || new.headline || '" ad was rejected.', '/seller/promote');
  end if;

  return new;
end;
$$;

-- ── Taxonomy: the admin's queue, and the seller's answer ────────────────────
create or replace function notify_taxonomy_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (profile_id, type, title, body, link)
  select id, 'Updates', 'New catalogue request',
         new.kind || ' "' || new.name || '" needs review.',
         -- Deliberately not `?q=<name>`: plpgsql has no URL encoder, and a term
         -- containing `&` or `#` would silently truncate the query string. The
         -- catalogue console already surfaces pending requests at the top, and
         -- the body names the term.
         '/admin/catalogue'
  from profiles where role = 'admin';
  return new;
end;
$$;

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
    -- Approved means the seller can now tag products with it, so the useful
    -- destination is their catalogue, not a read-only vocabulary screen.
    perform notify_linked(new.requested_by, 'Updates', 'Catalogue request approved',
      new.kind || ' "' || new.name || '" was approved.', '/seller/products');
  elsif new.status = 'rejected' then
    perform notify_linked(new.requested_by, 'Updates', 'Catalogue request rejected',
      new.kind || ' "' || new.name || '" was rejected.', '/seller/products');
  end if;
  return new;
end;
$$;

-- ── Boutiques: the admin's approvals queue, and the owner's status page ─────
create or replace function notify_boutique_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into notifications (profile_id, type, title, body, link)
  select id, 'Updates', 'New boutique signup',
         new.name || ' is awaiting review.',
         '/admin/approvals'
  from profiles where role = 'admin';
  return new;
end;
$$;

-- The function is `notify_boutique_decision` (0044) — replaced in place. Giving
-- it a new name would leave 0044's trigger pointing at the old body and the
-- owner would get the notification twice.
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
    perform notify_linked(new.owner_id, 'Updates', 'Boutique approved',
      new.name || ' is live on the marketplace.', '/seller/verification');
  elsif new.status = 'rejected' then
    perform notify_linked(new.owner_id, 'Updates', 'Boutique rejected',
      new.name || ' was not approved.', '/seller/verification');
  end if;
  return new;
end;
$$;

-- ── Payouts: open the seller's Earnings screen ──────────────────────────────
-- This is 0078's body verbatim — the reconciliation detail, the INSERT-vs-UPDATE
-- guard around `old` (which is UNASSIGNED on INSERT), and the conditional title
-- for a negative amount — with `notify` swapped for `notify_linked`. The trigger
-- is left exactly as 0078 created it; only the function body changes.
create or replace function notify_payout_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_body text;
begin
  if new.status <> 'paid' then
    return new;
  end if;

  -- OLD is UNASSIGNED on INSERT — touching old.status there raises "record
  -- 'old' is not assigned yet", and SQL's AND does not promise to short-circuit,
  -- so this must be a nested IF rather than one combined condition.
  if tg_op = 'UPDATE' then
    if old.status = 'paid' then
      return new; -- already announced when it first flipped to paid
    end if;
  end if;

  select owner_id into v_owner_id from boutiques where id = new.boutique_id;
  if v_owner_id is null then
    return new;
  end if;

  v_body := '₹' || trim(to_char(new.amount, 'FM999999990.00'))
         || ' has been transferred for ' || new.orders_count || ' delivered order'
         || case when new.orders_count = 1 then '' else 's' end || '.';

  if new.commission > 0 then
    v_body := v_body || ' Commission deducted: ₹' || trim(to_char(new.commission, 'FM999999990.00')) || '.';
  end if;
  if new.cod_adjustment <> 0 then
    v_body := v_body || ' COD cash you hold, netted off: ₹' || trim(to_char(new.cod_adjustment, 'FM999999990.00')) || '.';
  end if;
  if new.utr is not null then
    v_body := v_body || ' Reference: ' || new.utr || '.';
  elsif new.note is not null then
    v_body := v_body || ' Reference: ' || new.note || '.';
  end if;
  v_body := v_body || ' See Earnings for the order-by-order statement.';

  perform notify_linked(
    v_owner_id,
    'Updates',
    case when new.amount < 0 then 'Payout statement ready' else 'Payout sent' end,
    v_body,
    '/seller/earnings'
  );
  return new;
end;
$$;

-- ── Backfill the rows already written ───────────────────────────────────────
--
-- Only where the destination is a fixed page. Matching on `title` is safe
-- because these titles are literals in the trigger bodies above, never user
-- text, and `link is null` keeps it from touching anything already correct.
update notifications set link = '/seller/promote'
  where link is null and title in ('Ad campaign approved', 'Ad campaign rejected');

update notifications set link = '/seller/verification'
  where link is null and title in ('Boutique approved', 'Boutique rejected');

update notifications set link = '/seller/products'
  where link is null and title in ('Catalogue request approved', 'Catalogue request rejected');

update notifications set link = '/seller/earnings'
  where link is null and title in ('Payout sent', 'Payout statement ready');

update notifications set link = '/admin/approvals'
  where link is null and title = 'New boutique signup';

update notifications set link = '/admin/catalogue'
  where link is null and title = 'New catalogue request';

-- Deliberately NOT backfilled:
--   'New message'  — the conversation was never recorded on the row.
--   'Price drop'   — the product was never recorded on the row.
-- Both fall back client-side to the Messages inbox / Wishlist. New rows written
-- after this migration carry the exact path.
--
-- Verify:
--   select type, title, count(*), count(link) as linked, count(order_id) as ordered
--     from notifications group by type, title order by 3 desc;
--   -- every row should have a link, an order_id, or be a broadcast/'New
--   -- message'/'Price drop' row written before this migration.
