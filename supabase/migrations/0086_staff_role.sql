-- Staff role — a second, restricted way into the admin console.
--
-- Until now `profiles.role` had one privileged value, 'admin', and `is_admin()`
-- was the single gate on roughly thirty RLS policies plus every `api/` guard.
-- There was no way to let an employee work the orders queue without also handing
-- them the payout console, the commission settings and the customer list.
--
-- This adds 'staff': everything an employee needs to run fulfilment, moderation
-- and comms, and nothing that touches money, platform configuration or user
-- management.
--
-- ══ THE DESIGN DECISION THAT MATTERS ═════════════════════════════════════════
--
-- `is_admin()` is NOT changed. It still means `role = 'admin'`, exactly as it
-- did, which is why this file does not edit a single existing policy on
-- payouts, expenses, coupons, platform_settings, return_requests or
-- admin_activity_log. Those stay admin-only because they already say
-- `is_admin()` and staff is not an admin.
--
-- Staff access is granted the other way round: a new `is_staff()` (true for
-- admin OR staff) plus NEW permissive policies naming exactly the tables staff
-- may touch. Postgres ORs permissive policies together, so this is purely
-- additive — no existing role's access changes by so much as a row. The
-- consequence that makes it safe: anything added to this schema in future is
-- invisible to staff until someone deliberately grants it. Fail closed.
--
-- ══ HOW BUYER CONTACT DETAILS ARE WITHHELD ═══════════════════════════════════
--
-- Staff may see a delivery address (they cannot chase a parcel without one) but
-- not a buyer's phone or email — the difference between doing the job and
-- walking out with the customer list.
--
-- RLS filters rows, not columns, so a policy cannot express that. The obvious
-- tool, `revoke select (guest_phone) ... from authenticated`, is exactly the
-- mistake 0058 made: every app user is `authenticated`, so revoking a column
-- from staff revokes it from sellers and admins too, and the console goes
-- 403-dead. 0059 was the cleanup.
--
-- So staff get NO direct policy on `orders` or `profiles` at all. Both are read
-- through SECURITY DEFINER functions whose WHERE clause is the access check and
-- whose SELECT list is the masking — the same pattern 0073 used to take seller
-- contact details back off the anon key. A staff member calling PostgREST by
-- hand gets nothing; the RPC is the only door, and it masks on the way out.
--
-- ⚠ EVERY policy below is `to authenticated`, and that is load-bearing, not
-- decoration. As first shipped they had no TO clause — which means TO PUBLIC,
-- i.e. attached to `anon` as well. Postgres checks EXECUTE on a policy's
-- function when the expression is initialised, so with `is_staff()` revoked from
-- anon (below) every anonymous read of products/boutiques/taxonomy/reviews/ads
-- failed with `42501: permission denied for function is_staff` and the buyer
-- storefront went completely blank while both consoles looked fine. 0087 is the
-- repair for databases that already ran the broken version. Never add a policy
-- calling is_staff() without `to authenticated`.
--
-- Requires 0006 (profiles.status/deleted_at), 0010 (privilege guard), 0024
-- (taxonomy), 0032/0033/0037 (ads), 0038 (auto_hidden), 0045 (seller_reply),
-- 0048 (reviews.hidden, broadcast), 0063 (shipments), 0084 (feedback guard).
--
-- Idempotent and re-runnable in the Supabase SQL editor.

-- ══ 1) The role itself ═══════════════════════════════════════════════════════
--
-- The constraint is auto-named `profiles_role_check` — it was declared inline in
-- schema.sql (`role text not null check (role in (...))`) and no migration has
-- ever renamed it. Dropped by discovery rather than by that name anyway: a
-- `drop constraint if exists <wrong name>` is a silent no-op, and the failure it
-- produces is baffling — the console still refuses `staff`, the migration
-- reports success, and nothing says the two are related.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%role%'
       and pg_get_constraintdef(oid) ilike '%buyer%'
  loop
    execute format('alter table profiles drop constraint %I', c.conname);
  end loop;
end $$;

alter table profiles add constraint profiles_role_check
  check (role in ('buyer', 'seller', 'admin', 'staff'));

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  -- Admins are staff for every purpose in this file, so a policy written as
  -- `is_staff()` never has to be written as `is_staff() or is_admin()`.
  --
  -- Unlike is_admin(), this also insists the account is live: a suspended or
  -- soft-deleted employee loses console access the moment the row is updated,
  -- without anyone having to remember to also change their role. (is_admin()
  -- is deliberately left alone rather than "improved" here — it is load-bearing
  -- in thirty policies and this migration is not the place to change what it
  -- means.)
  select exists (
    select 1 from profiles
     where id = auth.uid()
       and role in ('admin', 'staff')
       and coalesce(status, 'active') = 'active'
       and deleted_at is null
  );
$$;

revoke all on function is_staff() from public, anon;
grant execute on function is_staff() to authenticated;

-- ══ 2) CRITICAL — close the self-promotion hole this role opens ═══════════════
--
-- 0010 blocks a signed-in user from setting their own `role` to 'admin'. It
-- names that one value:
--
--     if new.role is distinct from old.role and new.role = 'admin' ...
--
-- The moment 'staff' becomes a legal value that check has a gap wide enough to
-- drive through. The app talks to Supabase with the anon key and an ordinary
-- user session, so any buyer could open devtools and run
--
--     supabase.from('profiles').update({ role: 'staff' }).eq('id', <self>)
--
-- and walk straight into the console with every grant below. This must be
-- applied in the same breath as the CHECK constraint above, which is why it is
-- in the same file rather than a follow-up.
--
-- ⚠ CORRECTED — this body was originally copied from 0010, which was NOT the
-- current version: 0029 had since added the service-role short-circuit below.
-- Losing it broke the admin console's own role editor, because that writes
-- through /api/admin-create-user with the service-role key, where auth.uid() is
-- NULL and is_admin() is therefore false. See 0088, which is the repair for
-- databases that ran the original. Fixed here as well so re-running this
-- (re-runnable by design) cannot undo 0088.
create or replace function guard_profile_privileges()
returns trigger
language plpgsql
as $$
begin
  -- Trusted server context (0029). Must stay FIRST — everything below assumes a
  -- browser session with a real auth.uid().
  if public.is_service_role() then
    return new;
  end if;

  -- Only an existing admin may grant a privileged role. Staff cannot promote
  -- anyone — not a buyer, not another employee, and not themselves — because
  -- this says is_admin(), not is_staff().
  if new.role is distinct from old.role
     and new.role in ('admin', 'staff')
     and not is_admin() then
    raise exception 'not authorized to grant the % role', new.role;
  end if;

  -- Nor may staff demote an admin out of the way. Any change to a privileged
  -- account's role is the admin's alone.
  if old.role in ('admin', 'staff')
     and new.role is distinct from old.role
     and not is_admin() then
    raise exception 'not authorized to change a privileged role';
  end if;

  -- Only an admin may change account status / soft-delete flags. For everyone
  -- else, silently pin these back to their stored values so an ordinary profile
  -- edit (name/phone/city) still succeeds without touching moderation state.
  if not is_admin() then
    if new.status is distinct from old.status then
      new.status := old.status;
    end if;
    if new.deleted_at is distinct from old.deleted_at then
      new.deleted_at := old.deleted_at;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_profile_privileges on profiles;
create trigger trg_guard_profile_privileges
  before update on profiles
  for each row
  execute function guard_profile_privileges();

-- ══ 3) Masking helper ════════════════════════════════════════════════════════
create or replace function mask_contact(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when p is null or btrim(p) = '' then null
    -- Email: keep the first character and the domain, so support can still
    -- confirm "yes, that's the gmail address you gave us" without reading it.
    when position('@' in p) > 0
      then left(btrim(p), 1) || '••••' || substring(btrim(p) from position('@' in btrim(p)))
    -- Phone: first two and last two digits. Enough to match against what a
    -- customer reads out on a call; useless as an export.
    when length(regexp_replace(p, '\D', '', 'g')) >= 6
      then left(regexp_replace(p, '\D', '', 'g'), 2) || '••••••' ||
           right(regexp_replace(p, '\D', '', 'g'), 2)
    else '••••••'
  end;
$$;

-- ══ 4) Orders — read and act, through the door that masks ════════════════════
--
-- No policy on `orders` for staff. This function is the whole of their access.
-- The shape it returns is the one `src/data/orders.ts` already consumes
-- (BASE_SELECT + TRACKING_COLUMNS, with the embedded buyer/boutique/items
-- resources PostgREST would have produced), so the admin order screens render
-- it without knowing which role fetched it — except that `guest_phone` and the
-- buyer's `phone` arrive masked and the buyer's email never arrives at all.
create or replace function staff_orders_feed()
returns jsonb
language sql stable security definer set search_path = public as $$
  -- Aliased `o_json`, not `row`: ROW is a constructor keyword in Postgres and
  -- using it as the aggregate's argument is asking for a parse error.
  select coalesce(jsonb_agg(o_json order by o_json->>'created_at' desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'buyer_id', o.buyer_id,
        'boutique_id', o.boutique_id,
        'status', o.status,
        'total', o.total,
        'created_at', o.created_at,
        'accepted_at', o.accepted_at,
        'shipped_at', o.shipped_at,
        'delivered_at', o.delivered_at,
        'guest_name', o.guest_name,
        -- Address, city and pincode are NOT masked. Staff are expected to chase
        -- a parcel, and a masked address makes that impossible.
        'guest_city', o.guest_city,
        'guest_address', o.guest_address,
        'guest_pincode', o.guest_pincode,
        'guest_phone', mask_contact(o.guest_phone),
        'payment_id', o.payment_id,
        'refunded', o.refunded,
        'channel', o.channel,
        'payment_method', o.payment_method,
        'payment_status', o.payment_status,
        'paid_at', o.paid_at,
        'cod_fee', o.cod_fee,
        'shipping_fee', o.shipping_fee,
        'platform_discount', o.platform_discount,
        'cancelled_at', o.cancelled_at,
        'cancel_reason', o.cancel_reason,
        'packed_at', o.packed_at,
        'out_for_delivery_at', o.out_for_delivery_at,
        'delivery_disputed', o.delivery_disputed,
        'delivery_disputed_at', o.delivery_disputed_at,
        'buyer', (
          select jsonb_build_object(
            'full_name', p.full_name,
            'phone', mask_contact(p.phone),
            'city', p.city)
            from profiles p where p.id = o.buyer_id
        ),
        'boutique', (
          select jsonb_build_object('name', b.name, 'tone', b.tone)
            from boutiques b where b.id = o.boutique_id
        ),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', oi.id,
            'product_id', oi.product_id,
            'title', oi.title,
            'price', oi.price,
            'qty', oi.qty,
            'size', oi.size,
            'color', oi.color,
            'product', (
              select jsonb_build_object('image_url', pr.image_url, 'tone', pr.tone)
                from products pr where pr.id = oi.product_id
            )))
            from order_items oi where oi.order_id = o.id
        ), '[]'::jsonb)
      ) as o_json
      from orders o
      -- The access check. A buyer or seller who calls this gets an empty array,
      -- not someone else's orders.
      where is_staff()
    ) t;
$$;

revoke all on function staff_orders_feed() from public, anon;
grant execute on function staff_orders_feed() to authenticated;

-- Acting on an order. A narrow RPC rather than an UPDATE policy, because a
-- policy is column-blind: `using (is_staff())` would also let an employee edit
-- `total`, clear `refunded` or backdate `paid_at` straight from the browser.
--
-- 'rejected' is absent from the allowed list on purpose — rejecting an order is
-- a refund decision, and refunds are not staff's.
create or replace function staff_set_order_status(p_id uuid, p_status text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_old text;
begin
  if not is_staff() then raise exception 'orders: staff only'; end if;
  if p_status not in ('pending', 'shipped', 'delivered') then
    raise exception 'orders: staff may not set status %', p_status;
  end if;

  select status into v_old from orders where id = p_id;
  if v_old is null then raise exception 'orders: no such order %', p_id; end if;
  -- A delivered order is settled ground: its delivered_at starts the payout
  -- hold clock (0026) and moving it backwards would re-open money that has
  -- already been released.
  if v_old = 'delivered' then
    raise exception 'orders: a delivered order can only be changed by an admin';
  end if;
  if v_old = 'rejected' then
    raise exception 'orders: a rejected order can only be changed by an admin';
  end if;

  update orders set status = p_status where id = p_id;

  -- The audit line is best effort, and its EXCEPTION block is scoped to the
  -- INSERT alone on purpose. A handler around the whole function would roll the
  -- UPDATE back too — plpgsql unwinds to the start of the block that catches —
  -- and then return success for a status change that never happened. Every
  -- staff action being logged matters, but not more than the action itself.
  begin
    insert into admin_activity_log (actor_id, actor_name, action, entity_type, entity_id, meta)
    values (auth.uid(),
            coalesce((select full_name from profiles where id = auth.uid()), 'staff'),
            'order.status', 'order', p_id::text,
            jsonb_build_object('from', v_old, 'to', p_status, 'by', 'staff'));
  exception when others then
    raise warning 'staff_set_order_status: audit log write failed (%)', sqlerrm;
  end;

  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;

revoke all on function staff_set_order_status(uuid, text) from public, anon;
grant execute on function staff_set_order_status(uuid, text) to authenticated;

-- ══ 5) Customers — the same aggregate, without the contact list ══════════════
--
-- `fetchCustomersAdmin()` groups orders client-side, and it groups anonymous
-- rows by `guest_phone`. Staff must not receive that column, but they still
-- need the grouping to come out right — so they get a stable hash of it
-- instead. Two orders from one phone number still collapse into one customer;
-- the number itself does not leave the database.
create or replace function staff_customer_rows()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'buyer_id', o.buyer_id,
    'total', o.total,
    'status', o.status,
    'refunded', o.refunded,
    'guest_name', o.guest_name,
    'guest_phone', md5(coalesce(o.guest_phone, '')),
    'guest_city', o.guest_city,
    'buyer', (
      select jsonb_build_object('full_name', p.full_name, 'city', p.city)
        from profiles p where p.id = o.buyer_id
    )
  )), '[]'::jsonb)
  from orders o
  where is_staff();
$$;

revoke all on function staff_customer_rows() from public, anon;
grant execute on function staff_customer_rows() to authenticated;

-- ══ 6) Catalogue & moderation — plain policies, no PII involved ══════════════

-- Products. Read everything (including listings from unapproved shops, which is
-- the point of a moderation queue).
do $$ begin
  create policy "products: staff read" on products for select
    to authenticated using (is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "products: staff moderate" on products for update
    to authenticated using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

-- ...but that UPDATE policy is column-blind, so a trigger says which columns a
-- staff edit may actually change. Without it "can moderate products" would also
-- mean "can reprice the catalogue".
create or replace function products_guard_staff_writes()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_admin() then return new; end if;
  if not is_staff() then return new; end if;   -- sellers: their own policies apply

  if new.price is distinct from old.price
  or new.mrp is distinct from old.mrp
  or new.stock is distinct from old.stock
  or new.boutique_id is distinct from old.boutique_id
  or new.title is distinct from old.title then
    raise exception 'products: staff may change visibility, not price, stock or identity';
  end if;
  return new;
end $$;

drop trigger if exists trg_products_guard_staff_writes on products;
create trigger trg_products_guard_staff_writes
  before update on products
  for each row
  execute function products_guard_staff_writes();

-- Boutiques. The approvals queue needs to see pending and rejected shops, which
-- the public policy does not show. Bank details, GST and contact numbers are
-- unaffected — they live behind `boutique_private()`, which is owner-or-admin
-- and stays that way, so an employee approving a shop sees the shop, not its
-- bank account.
do $$ begin
  create policy "boutiques: staff read" on boutiques for select
    to authenticated using (is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "boutiques: staff decide" on boutiques for update
    to authenticated using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

create or replace function boutiques_guard_staff_writes()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_admin() then return new; end if;
  if not is_staff() then return new; end if;

  -- The approval decision and its note. Nothing else — in particular not
  -- `rating` or `positive_rating` (0072 closed sellers doing exactly that) and
  -- not the payout verification fields, which gate real money.
  if new.name is distinct from old.name
  or new.owner_id is distinct from old.owner_id
  or new.rating is distinct from old.rating
  or new.positive_rating is distinct from old.positive_rating
  or new.payout_verification_status is distinct from old.payout_verification_status then
    raise exception 'boutiques: staff may set the approval decision only';
  end if;
  return new;
end $$;

drop trigger if exists trg_boutiques_guard_staff_writes on boutiques;
create trigger trg_boutiques_guard_staff_writes
  before update on boutiques
  for each row
  execute function boutiques_guard_staff_writes();

-- Taxonomy (the category / occasion / fabric vocabulary).
do $$ begin
  create policy "taxonomy: staff reads all" on taxonomy for select
    to authenticated using (is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "taxonomy: staff writes" on taxonomy for all
    to authenticated using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

-- 0024's guard raises unless is_admin(), which would block a staff approval.
-- Body is 0024's, with the gate widened.
create or replace function taxonomy_guard_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_staff() then
    return new;
  end if;
  if new.status is distinct from old.status
  or new.review_note is distinct from old.review_note
  or new.reviewed_at is distinct from old.reviewed_at
  or new.reviewed_by is distinct from old.reviewed_by then
    raise exception 'taxonomy: approval is admin-managed';
  end if;
  return new;
end $$;

-- Reviews. Moderation and the public reply.
do $$ begin
  create policy "reviews: staff read" on reviews for select
    to authenticated using (is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "reviews: staff moderate" on reviews for update
    to authenticated using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

create or replace function reviews_guard_staff_writes()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_admin() then return new; end if;
  if not is_staff() then return new; end if;

  -- Hide/unhide and reply. Not the rating, not the buyer's words — rewriting a
  -- customer's review is not moderation.
  if new.rating is distinct from old.rating
  or new.body is distinct from old.body
  or new.buyer_id is distinct from old.buyer_id then
    raise exception 'reviews: staff may hide or reply, not edit the review';
  end if;
  return new;
end $$;

drop trigger if exists trg_reviews_guard_staff_writes on reviews;
create trigger trg_reviews_guard_staff_writes
  before update on reviews
  for each row
  execute function reviews_guard_staff_writes();

-- Ads. Read the queue; the three review actions are RPCs, relaxed below.
do $$ begin
  create policy "ad_campaigns: staff read" on ad_campaigns for select
    to authenticated using (is_staff());
exception when duplicate_object then null; end $$;

-- Catalogue artwork, so a staff member approving a term can give it a tile.
do $$ begin
  create policy "catalogue-images: staff upload" on storage.objects for insert
    to authenticated with check (bucket_id = 'catalogue-images' and is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "catalogue-images: staff update" on storage.objects for update
    to authenticated
    using (bucket_id = 'catalogue-images' and is_staff())
    with check (bucket_id = 'catalogue-images' and is_staff());
exception when duplicate_object then null; end $$;

-- ══ 7) Fulfilment — shipments and couriers ═══════════════════════════════════
do $$ begin
  create policy "shipments: staff read" on shipments for select
    to authenticated using (is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "couriers: staff read" on couriers for select
    to authenticated using (is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "shipment_events: staff read" on shipment_events for select
    to authenticated using (is_staff());
exception when duplicate_object then null; end $$;

-- ══ 8) Comms — broadcast and buyer feedback ══════════════════════════════════
--
-- Body is 0048's, with the gate widened. A broadcast cannot be recalled, so
-- this one was a deliberate decision rather than a default.
create or replace function broadcast_notification(p_audience text, p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not is_staff() then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'title and body are required';
  end if;
  -- 0050. Without this an unknown audience silently matched nobody and the
  -- console reported a successful send of zero notifications.
  if p_audience not in ('all', 'buyer', 'seller') then
    raise exception 'unknown audience: %', p_audience;
  end if;

  insert into notifications (profile_id, type, title, body)
  select p.id, 'Updates', p_title, p_body
  from profiles p
  where p.deleted_at is null
    -- 0050: the audience is the marketplace, never the people running it.
    and p.role in ('buyer', 'seller')
    and (p_audience = 'all' or p.role = p_audience);

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function broadcast_notification(text, text, text) to authenticated;

-- Platform feedback: read the queue and approve a testimonial for the homepage.
do $$ begin
  create policy "platform_feedback: staff read" on platform_feedback
    for select to authenticated using (is_staff());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "platform_feedback: staff moderate" on platform_feedback
    for update to authenticated using (is_staff()) with check (is_staff());
exception when duplicate_object then null; end $$;

-- Body is 0084's, with the two gates widened. Consent still overrides everyone:
-- withdrawing it unpublishes regardless of who is editing.
create or replace function platform_feedback_publish_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if not is_staff() then
      new.published := false;
    end if;
    new.published_at := case when new.published then now() else null end;
    return new;
  end if;

  if not is_staff() then
    new.published := old.published;
  end if;

  if not new.publish_consent then
    new.published := false;
  end if;

  new.published_at := case
    when new.published and not old.published then now()
    when not new.published                   then null
    else old.published_at
  end;

  return new;
end $$;

drop trigger if exists trg_platform_feedback_publish_guard on platform_feedback;
create trigger trg_platform_feedback_publish_guard
  before insert or update on platform_feedback
  for each row execute function platform_feedback_publish_guard();

-- ══ 9) Ad review actions ═════════════════════════════════════════════════════
--
-- Bodies are 0037's / 0032's / 0033's, with the gate widened. Deliberately NOT
-- widened: `admin_create_ad_campaign` (0070) hands out free house inventory,
-- `reconcile_ad_campaign` and `mark_ad_refunded` move money. Those stay admin.
create or replace function admin_approve_ad(p_id uuid) returns ad_campaigns
language plpgsql security definer set search_path = public
as $$
declare v_row ad_campaigns;
begin
  if not is_staff() then raise exception 'ads: admin only'; end if;
  perform ad_privileged_begin();
  update ad_campaigns c set
    status = case when c.start_date <= current_date then 'live' else 'scheduled' end,
    start_at = case when c.start_date <= current_date then coalesce(c.start_at, now()) else c.start_at end,
    end_at = case when c.start_date <= current_date then coalesce(c.end_at, now() + c.days * interval '24 hours') else c.end_at end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    reject_reason = null,
    updated_at = now()
  where c.id = p_id and c.status in ('pending_review','paused')
  returning * into v_row;
  perform ad_privileged_end();
  if v_row.id is null then raise exception 'ads: nothing to approve for %', p_id; end if;
  return v_row;
end $$;

create or replace function admin_pause_ad(p_id uuid) returns ad_campaigns
language plpgsql security definer set search_path = public
as $$
declare v_row ad_campaigns;
begin
  if not is_staff() then raise exception 'ads: admin only'; end if;
  perform ad_privileged_begin();
  update ad_campaigns set status = 'paused', updated_at = now()
  where id = p_id and status in ('live','scheduled')
  returning * into v_row;
  perform ad_privileged_end();
  if v_row.id is null then raise exception 'ads: nothing to pause for %', p_id; end if;
  return v_row;
end $$;

create or replace function admin_request_ad_changes(p_id uuid, p_reason text default null) returns ad_campaigns
language plpgsql security definer set search_path = public
as $$
declare v_row ad_campaigns;
begin
  if not is_staff() then raise exception 'ads: admin only'; end if;
  perform ad_privileged_begin();
  update ad_campaigns set
    status = 'changes_requested',
    reject_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    updated_at = now()
  where id = p_id and status in ('pending_review','scheduled','live','paused')
  returning * into v_row;
  perform ad_privileged_end();
  if v_row.id is null then raise exception 'ads: nothing to send back for %', p_id; end if;
  return v_row;
end $$;

-- ══ Verify ═══════════════════════════════════════════════════════════════════
--
-- Run these AS A STAFF USER (Supabase SQL editor runs as postgres, where
-- auth.uid() is null and is_staff() is false — so from the editor every one of
-- these returns empty, which tells you nothing). The honest test is from the
-- browser console while signed in as the employee account:
--
--   -- should be true for staff, false for a buyer:
--   select is_staff(), is_admin();
--
--   -- should return orders, with guest_phone looking like '98••••••42':
--   select staff_orders_feed();
--
--   -- should all return zero rows / raise — the money and config tables:
--   select * from payouts;
--   select * from expenses;
--   select * from coupons;
--   select * from return_requests;
--   select * from admin_activity_log;
--   select * from profiles where id <> auth.uid();
--   select * from orders;                       -- no policy: empty, by design
--
--   -- should raise 'not authorized to grant the staff role':
--   update profiles set role = 'staff' where id = auth.uid();   -- as a buyer
--
--   -- should raise 'products: staff may change visibility...':
--   update products set price = 1 where id = '<any>';
--
-- And from the SQL editor, confirm the constraint took:
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conname = 'profiles_role_check';
