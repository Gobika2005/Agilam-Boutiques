-- Restore the anonymous storefront, broken by 0086.
--
-- ══ WHAT BROKE ═══════════════════════════════════════════════════════════════
--
-- 0086 revoked its new gate function from the anonymous role, correctly:
--
--     revoke all on function is_staff() from public, anon;
--     grant execute on function is_staff() to authenticated;
--
-- ...and then wrote sixteen policies that call it with no TO clause:
--
--     create policy "products: staff read" on products for select using (is_staff());
--
-- A policy with no TO clause is TO PUBLIC — it is attached to EVERY role, `anon`
-- included. Postgres checks EXECUTE on a function inside a policy expression
-- when the expression is initialised, before a single row is tested and
-- regardless of whether the OR against the public-read policy would have
-- short-circuited. So an anonymous `select` on products did not return fewer
-- rows; it failed outright with
--
--     42501: permission denied for function is_staff
--
-- Buyers browse anonymously, so the whole storefront — catalogue, PDP, search,
-- Inspire, shop pages, reviews, ads, the Home testimonials, order tracking —
-- returned nothing. Signed-in users are `authenticated`, which HAD the grant, so
-- the seller and admin consoles looked perfectly healthy and hid the outage.
--
-- ══ WHY IT WAS NOT CAUGHT ════════════════════════════════════════════════════
--
-- Every policy function this schema had before 0086 is `is_admin()`, declared in
-- schema.sql and never revoked, so it kept the default EXECUTE TO PUBLIC that
-- Postgres grants on function creation. `is_staff()` is the first policy
-- function here that anon genuinely cannot execute — the pattern "policy calls a
-- helper" had simply never been load-bearing on that grant before.
--
-- ══ THE FIX ══════════════════════════════════════════════════════════════════
--
-- Add `to authenticated` to each of them. The policy is then never attached to
-- anon at all, so its expression is never initialised for an anonymous query and
-- the missing grant stops mattering.
--
-- Deliberately NOT the other available fix — `grant execute on function
-- is_staff() to anon`. That would make the whole thing work again while handing
-- the anonymous key a probe for whether a session is staff, and it would leave
-- the policies still nominally applying to a role they were never meant for.
-- 0086's revoke is correct and stays.
--
-- No access changes for anyone who could already see these rows: staff and
-- admins are `authenticated`, and `anon` was only ever meant to read through the
-- public policies, which are untouched.
--
-- Requires 0086. Idempotent and re-runnable in the Supabase SQL editor.

-- ── Catalogue ────────────────────────────────────────────────────────────────
drop policy if exists "products: staff read" on products;
create policy "products: staff read" on products for select
  to authenticated using (is_staff());

drop policy if exists "products: staff moderate" on products;
create policy "products: staff moderate" on products for update
  to authenticated using (is_staff()) with check (is_staff());

drop policy if exists "boutiques: staff read" on boutiques;
create policy "boutiques: staff read" on boutiques for select
  to authenticated using (is_staff());

drop policy if exists "boutiques: staff decide" on boutiques;
create policy "boutiques: staff decide" on boutiques for update
  to authenticated using (is_staff()) with check (is_staff());

-- `taxonomy: staff writes` was `for all`, which includes SELECT — so this one
-- took the category / occasion / fabric vocabulary down with it, and with it
-- every browse-by-category surface on the storefront.
drop policy if exists "taxonomy: staff reads all" on taxonomy;
create policy "taxonomy: staff reads all" on taxonomy for select
  to authenticated using (is_staff());

drop policy if exists "taxonomy: staff writes" on taxonomy;
create policy "taxonomy: staff writes" on taxonomy for all
  to authenticated using (is_staff()) with check (is_staff());

-- ── Moderation ───────────────────────────────────────────────────────────────
drop policy if exists "reviews: staff read" on reviews;
create policy "reviews: staff read" on reviews for select
  to authenticated using (is_staff());

drop policy if exists "reviews: staff moderate" on reviews;
create policy "reviews: staff moderate" on reviews for update
  to authenticated using (is_staff()) with check (is_staff());

drop policy if exists "ad_campaigns: staff read" on ad_campaigns;
create policy "ad_campaigns: staff read" on ad_campaigns for select
  to authenticated using (is_staff());

-- ── Fulfilment ───────────────────────────────────────────────────────────────
drop policy if exists "shipments: staff read" on shipments;
create policy "shipments: staff read" on shipments for select
  to authenticated using (is_staff());

drop policy if exists "couriers: staff read" on couriers;
create policy "couriers: staff read" on couriers for select
  to authenticated using (is_staff());

drop policy if exists "shipment_events: staff read" on shipment_events;
create policy "shipment_events: staff read" on shipment_events for select
  to authenticated using (is_staff());

-- ── Buyer feedback (0084 publishes these on the Home page) ───────────────────
drop policy if exists "platform_feedback: staff read" on platform_feedback;
create policy "platform_feedback: staff read" on platform_feedback for select
  to authenticated using (is_staff());

drop policy if exists "platform_feedback: staff moderate" on platform_feedback;
create policy "platform_feedback: staff moderate" on platform_feedback for update
  to authenticated using (is_staff()) with check (is_staff());

-- ── Storage ──────────────────────────────────────────────────────────────────
-- INSERT/UPDATE only, so these never fired on an anonymous read — fixed for the
-- same reason all the same: a policy should not be attached to a role whose
-- grants cannot satisfy it.
drop policy if exists "catalogue-images: staff upload" on storage.objects;
create policy "catalogue-images: staff upload" on storage.objects for insert
  to authenticated with check (bucket_id = 'catalogue-images' and is_staff());

drop policy if exists "catalogue-images: staff update" on storage.objects;
create policy "catalogue-images: staff update" on storage.objects for update
  to authenticated
  using (bucket_id = 'catalogue-images' and is_staff())
  with check (bucket_id = 'catalogue-images' and is_staff());

-- ══ Verify ═══════════════════════════════════════════════════════════════════
--
-- 1) Nothing is left attached to PUBLIC. This must return ZERO rows — it is the
--    check that catches the same mistake in any future migration:
--
--      select tablename, policyname, roles
--        from pg_policies
--       where schemaname in ('public', 'storage')
--         and qual  || coalesce(with_check, '') like '%is_staff%'
--         and 'public' = any (roles);
--
-- 2) The storefront read, AS ANON. Run it signed out from the browser console —
--    the SQL editor runs as postgres, which bypasses RLS and would pass either
--    way, telling you nothing:
--
--      await supabase.from('products').select('id').limit(1)
--      await supabase.from('taxonomy').select('id').limit(1)
--
--    Both should return a row. Before this file they returned
--    `42501: permission denied for function is_staff`.
--
-- 3) Staff access is unchanged — signed in as the employee account:
--
--      await supabase.from('products').select('id, status').limit(5)
