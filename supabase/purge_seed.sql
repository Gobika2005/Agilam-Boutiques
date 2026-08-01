-- MangaiMart — remove ALL sample/seed data
-- ---------------------------------------------------------------------------
-- Undoes `supabase/seed.sql` completely: the 5 demo boutiques, their products,
-- the fake orders/messages/notifications/subscriptions/ads, and the 10 demo
-- auth accounts (including admin@mangaimart.test, whose password is published
-- in seed.sql's header — the single most important row to get rid of).
--
-- Safe to run more than once; every statement is a no-op once the rows are gone.
-- Real data is preserved: rows are matched only by the seed's fixed UUIDs and
-- its @mangaimart.test email domain, never by name or by "looks like demo".
--
-- HOW TO RUN (Supabase SQL editor — it only displays the LAST result set, so
-- this is deliberately split into three separate runs):
--
--   RUN 1 — STEP 0 below. Shows what will be deleted and lists your admins.
--   RUN 2 — STEP 1 below (from `begin;` to `commit;`). Does the deletion.
--   RUN 3 — STEP 2 below. Confirms every count came back 0.
--
-- BEFORE RUN 2:
--   * Take a backup — Supabase Dashboard → Database → Backups.
--   * Confirm STEP 0 listed an admin that is YOURS. This script deletes
--     admin@mangaimart.test; if that is your only admin you lose /admin access.
-- ---------------------------------------------------------------------------


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 0 · PRE-FLIGHT — run this on its own first, and read both results.
-- ═══════════════════════════════════════════════════════════════════════════

-- 0a. Who your admins are. At least one must be an account you can sign in as.
select p.email, p.full_name, p.created_at
  from profiles p
 where p.role = 'admin'
 order by p.email;

-- 0b. What STEP 1 will remove. Run this second (the editor shows one result).
select 'demo boutiques'  as entity, count(*) as rows_to_delete from boutiques
        where id in ('b0000001-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000002',
                     'b0000003-0000-0000-0000-000000000003','b0000004-0000-0000-0000-000000000004',
                     'b0000005-0000-0000-0000-000000000005')
union all
select 'demo products', count(*) from products
        where boutique_id in ('b0000001-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000002',
                              'b0000003-0000-0000-0000-000000000003','b0000004-0000-0000-0000-000000000004',
                              'b0000005-0000-0000-0000-000000000005')
union all
select 'demo accounts', count(*) from auth.users where email like '%@mangaimart.test'
union all
select 'orders tied to them', count(*) from orders
        where boutique_id in ('b0000001-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000002',
                              'b0000003-0000-0000-0000-000000000003','b0000004-0000-0000-0000-000000000004',
                              'b0000005-0000-0000-0000-000000000005')
           or buyer_id in (select id from auth.users where email like '%@mangaimart.test');

-- (No `ads` row here on purpose: migration 0032 dropped that table and replaced
-- it with ad_campaigns/ad_placements, so the seed's four ad rows went with it.
-- STEP 1 still clears them defensively for databases predating 0032.)


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1 · THE PURGE — run everything from `begin;` to `commit;` as one batch.
-- It is one transaction: if any statement fails, nothing is deleted.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ── Seed identifiers, in one place ──────────────────────────────────────────
-- Boutiques  b0000001..b0000005   ·   Products  c0000001..c0000008
-- Sellers 1111..-5555..  ·  Buyers a1../b2../c3../d4..  ·  Admin 9999..

create temporary table _seed_boutiques (id uuid primary key) on commit drop;
insert into _seed_boutiques values
  ('b0000001-0000-0000-0000-000000000001'),('b0000002-0000-0000-0000-000000000002'),
  ('b0000003-0000-0000-0000-000000000003'),('b0000004-0000-0000-0000-000000000004'),
  ('b0000005-0000-0000-0000-000000000005');

create temporary table _seed_products (id uuid primary key) on commit drop;
insert into _seed_products values
  ('c0000001-0000-0000-0000-000000000001'),('c0000002-0000-0000-0000-000000000002'),
  ('c0000003-0000-0000-0000-000000000003'),('c0000004-0000-0000-0000-000000000004'),
  ('c0000005-0000-0000-0000-000000000005'),('c0000006-0000-0000-0000-000000000006'),
  ('c0000007-0000-0000-0000-000000000007'),('c0000008-0000-0000-0000-000000000008');

-- Both the fixed seed UUIDs and anything on the demo email domain, so accounts
-- created by an older or edited copy of seed.sql are caught too.
create temporary table _seed_people (id uuid primary key) on commit drop;
insert into _seed_people
  select unnest(array[
    '11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222',
    '33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444',
    '55555555-5555-5555-5555-555555555555','a1111111-1111-1111-1111-1111111111a1',
    'b2222222-2222-2222-2222-2222222222b2','c3333333-3333-3333-3333-3333333333c3',
    'd4444444-4444-4444-4444-4444444444d4','99999999-9999-9999-9999-999999999999'
  ]::uuid[])
  union
  select id from auth.users where email like '%@mangaimart.test';

-- ── Refuse to run if it would leave you with no admin ──────────────────────
do $$
declare surviving int;
begin
  select count(*) into surviving
    from profiles p
   where p.role = 'admin' and p.id not in (select id from _seed_people);
  if surviving = 0 then
    raise exception 'Aborting: the only admin account(s) are seed accounts, so this purge would lock you out of /admin.'
      using hint = 'Create your own admin first (README step 4), sign in with it once, then re-run this script.';
  end if;
end $$;

-- ── 1. Detach real order lines from seeded products ─────────────────────────
-- order_items.product_id has no ON DELETE CASCADE, so a lingering reference
-- would block the product delete. The line keeps its own title/price snapshot,
-- so an order placed against a demo product stays readable after the unlink.
update order_items set product_id = null
 where product_id in (select id from _seed_products);

-- ── 2. Fake orders (seed buyer OR seed boutique on either side) ─────────────
delete from order_items
 where order_id in (
   select id from orders
    where buyer_id in (select id from _seed_people)
       or boutique_id in (select id from _seed_boutiques));

delete from orders
 where buyer_id in (select id from _seed_people)
    or boutique_id in (select id from _seed_boutiques);

-- ── 3. Chat ────────────────────────────────────────────────────────────────
-- messages.sender_id has no cascade either, so clear the demo senders first —
-- this also catches a demo seller who replied inside a real buyer's thread.
delete from messages where sender_id in (select id from _seed_people);
delete from conversations
 where boutique_id in (select id from _seed_boutiques)
    or buyer_id in (select id from _seed_people);

-- ── 4. Seeded ads, and 5. subscriptions ────────────────────────────────────
-- Both tables may be absent depending on how far the database has been
-- migrated, so these are guarded rather than written as plain DELETEs:
--   * `ads` was dropped by migration 0032, which replaced it with
--     ad_campaigns/ad_placements. On any DB at 0032+ the seeded ad rows are
--     already gone; this only matters for a database older than that.
--   * `subscriptions` is legacy too — the platform is commission + ads only,
--     so the rows the seed writes are pure noise. Deleting the boutiques below
--     would cascade them anyway; this is belt and braces.
do $$
begin
  if to_regclass('public.ads') is not null then
    execute $q$delete from ads where title in
      ('Wedding Season Edit','Festive Silk Push','Boutique Spotlight','Monsoon Clearance')$q$;
  end if;

  if to_regclass('public.subscriptions') is not null then
    execute 'delete from subscriptions where boutique_id in (select id from _seed_boutiques)';
  end if;
end $$;

-- ── 6. Boutiques ───────────────────────────────────────────────────────────
-- Cascades: products, reviews, coupons, payouts, boutique_followers,
-- ad_campaigns, and any remaining subscriptions.
delete from boutiques where id in (select id from _seed_boutiques);

-- ── 7. Audit entries written by the demo admin ─────────────────────────────
-- Guarded the same way: admin_activity_log arrives with migration 0006, so a
-- database that never got that far would otherwise fail the whole transaction.
do $$
begin
  if to_regclass('public.admin_activity_log') is not null then
    execute 'delete from admin_activity_log where actor_id in (select id from _seed_people)';
  end if;
end $$;

-- ── 8. Release "who did this" pointers held by the demo accounts ───────────
-- Three columns reference profiles with ON DELETE SET NULL, and deleting the
-- account makes Postgres perform that UPDATE for you. Two of those tables sit
-- behind guard triggers that reject the write:
--
--   * taxonomy.requested_by / .reviewed_by — `taxonomy_guard_decision` RAISES
--     'taxonomy: approval is admin-managed' unless is_admin() is true. In the
--     SQL editor auth.uid() is NULL, so is_admin() is false and the cascade
--     aborts the whole purge. The trigger is switched off for exactly these
--     two statements and switched straight back on.
--   * ad_campaigns.reviewed_by — `ad_campaigns_guard` reverts protected columns
--     instead of raising, which would silently defeat the SET NULL. It has an
--     escape hatch, `agilam.ad_privileged`, which is what the server uses.
--
-- The taxonomy and campaign ROWS are real and stay. Only the pointer to the
-- demo admin who approved them is cleared, which is what deleting that account
-- means. Both settings are transaction-local and revert at commit, and the
-- trigger is re-enabled inside the same transaction — so if anything fails, the
-- rollback restores it. (DISABLE TRIGGER needs table ownership; the SQL editor
-- runs as `postgres`, which owns the public schema, so this works there. It
-- will NOT work from the app's anon/authenticated connection, by design.)
set local agilam.ad_privileged = 'on';

do $$
begin
  if to_regclass('public.taxonomy') is not null then
    execute 'alter table taxonomy disable trigger taxonomy_guard_decision';
    execute 'update taxonomy set requested_by = null where requested_by in (select id from _seed_people)';
    execute 'update taxonomy set reviewed_by  = null where reviewed_by  in (select id from _seed_people)';
    execute 'alter table taxonomy enable trigger taxonomy_guard_decision';
  end if;

  if to_regclass('public.ad_campaigns') is not null then
    execute 'update ad_campaigns set reviewed_by = null where reviewed_by in (select id from _seed_people)';
  end if;
end $$;

-- ── 9. The demo accounts themselves ────────────────────────────────────────
-- Deleting auth.users cascades profiles, which in turn cascades cart_items,
-- wishlist, product_likes, boutique_followers and notifications.
delete from auth.identities where user_id in (select id from _seed_people);
delete from auth.users      where id      in (select id from _seed_people);

commit;


-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2 · VERIFY — run this last. Every number must be 0.
-- ═══════════════════════════════════════════════════════════════════════════

select 'demo boutiques left' as check, count(*) as n from boutiques
        where slug in ('elegance-boutique','trendz-wardrobe','pinkys-boutique','style-studio','silk-symphony')
union all
select 'demo auth accounts left', count(*) from auth.users where email like '%@mangaimart.test'
union all
select 'demo profiles left',      count(*) from profiles  where email like '%@mangaimart.test'
union all
select 'demo products left',      count(*) from products
        where id in ('c0000001-0000-0000-0000-000000000001','c0000002-0000-0000-0000-000000000002',
                     'c0000003-0000-0000-0000-000000000003','c0000004-0000-0000-0000-000000000004',
                     'c0000005-0000-0000-0000-000000000005','c0000006-0000-0000-0000-000000000006',
                     'c0000007-0000-0000-0000-000000000007','c0000008-0000-0000-0000-000000000008')
union all
select 'orphaned order lines',    count(*) from order_items oi
        where not exists (select 1 from orders o where o.id = oi.order_id);


-- ---------------------------------------------------------------------------
-- NOT touched, on purpose:
--   * platform_settings / taxonomy / ad_placements — configuration, not sample
--     data. The taxonomy list comes from migration 0024 and the app needs it.
--   * payment_events — no foreign key, and it is keyed by order NUMBER
--     (AGL-####, only 4 digits), so a blind delete could hit a real payment.
--     If you want the demo ones gone, look at them by hand first:
--       select * from payment_events where order_ref in
--         ('AGL-2481','AGL-2478','AGL-2472','AGL-2465','AGL-2460');
--
-- After the purge the admin console will show zeros and empty states until real
-- boutiques sign up and real orders arrive. That is the expected result, not a
-- bug — every admin page reads straight from these tables.
-- ---------------------------------------------------------------------------
