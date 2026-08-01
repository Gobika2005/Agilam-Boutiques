-- ============================================================================
-- MangaiMart — QA pass 2 remediation.  CORRECTED after the first run failed.
--
-- ⚠️ RUN ONE SECTION AT A TIME. Select a section, press Run, check it, move on.
--
-- The previous version was pasted as a single script. The Supabase SQL editor
-- sends a multi-statement script to Postgres as ONE implicit transaction, so
-- the error in the last section rolled back the earlier ones too — sections 2
-- and 3 reported nothing and changed nothing. Running section by section means
-- one failure can no longer undo work that already succeeded.
--
-- Sections:
--   1. Coupons — cap the two 90%-off codes            (money leak, do first)
--   2. Restore stock consumed by the QA pass          (cleanup)
--   3. Unpublish the QA boutique                      (cleanup, needs §3a)
--   4. Optional — repair the one mispriced COD order
--   5. Verification
--
-- ALREADY DONE, do not re-run: migration 0052. The four walk-in orders now
-- carry discount = 200 and reconcile correctly.
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. COUPONS  ← the one that is actively costing money. Run this first.
--
-- There are now TWO 90%-off platform-funded coupons, both listed on the public
-- coupons page to anonymous visitors, and BOTH HAVE ALREADY BEEN USED ONCE:
--
--   LANCHOFF    90% off · no max discount · no usage limit · used 1
--   MYFRD0090   90% off · max ₹5,000      · no usage limit · used 1   (new since
--                                                             the QA audit)
--
-- "Platform-funded" means the seller's order keeps its FULL goods total and
-- they are paid on it — every rupee of the discount comes out of MangaiMart.
--
-- ⚠️ EDIT THE NUMBERS BELOW BEFORE RUNNING. These reflect the cap you chose for
--    LANCHOFF; MYFRD0090 is your call and I have not assumed it.
-- ─────────────────────────────────────────────────────────────────────────────

-- LANCHOFF → 20% off, capped at ₹300, minimum bag ₹999, 500 redemptions.
--   ₹1,499 bag: ₹300 off (was ₹1,349) · ₹50,000 bag: ₹300 off (was ₹45,000)
--   Maximum remaining exposure: 500 × ₹300 = ₹1,50,000, versus unbounded.
update coupons
   set off          = 20,
       max_discount = 300,
       min_subtotal = 999,
       usage_limit  = 500
 where code = 'LANCHOFF';

-- MYFRD0090 — currently 90% off capped at ₹5,000 per order with NO usage limit,
-- so total exposure is unbounded. At minimum give it a redemption cap. If it is
-- a referral code, 1 use per referral is the usual shape.
-- Adjust or delete this statement to match what you intended it to be.
update coupons
   set usage_limit  = 100,
       max_discount = 500,
       min_subtotal = 999
 where code = 'MYFRD0090';

-- The two flat codes have no redemption cap either. Far less dangerous
-- (a flat discount can never exceed its own value) but still unbounded in total.
update coupons set usage_limit = 1000 where code in ('AGILAM100', 'RITARYA200') and usage_limit is null;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RESTORE STOCK CONSUMED BY THE PREVIOUS QA PASS
--
-- The earlier run's abuse probes wrote two real orders against a genuine
-- seller's product, taking it from stock 2 to 0 — it reads "sold out" to real
-- buyers right now.
-- ─────────────────────────────────────────────────────────────────────────────

update products
   set stock = 2
 where title = 'Indigo Floral Co-Ord Set'
   and stock = 0;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. UNPUBLISH THE QA BOUTIQUE   ← this is what failed last time
--
-- Why it failed:
--   ERROR: boutiques: verified/featured are admin-managed
--
-- Migration 0021 puts a BEFORE UPDATE trigger on `boutiques` that blocks any
-- write to `verified`, `featured`, `review_note`, `reviewed_at`, or a status
-- outside ('draft','pending') — UNLESS is_admin() returns true. is_admin()
-- reads the request's JWT, and the SQL editor has no JWT, so auth.uid() is null
-- and the guard treats the SQL editor as an untrusted seller. The guard is
-- working correctly; it just cannot tell that you are the admin.
--
-- ✅ EASIEST ALTERNATIVE: skip this section entirely and reject the boutique
--    through the admin console at /admin/approvals. That path runs as a real
--    signed-in admin, so the trigger passes and the action is written to the
--    audit log. Prefer that if you can.
--
-- Otherwise, run the three statements below TOGETHER, as one selection, so the
-- trigger is never left disabled if something goes wrong in between.
-- ─────────────────────────────────────────────────────────────────────────────

alter table boutiques disable trigger boutiques_guard_admin_fields;

update boutiques
   set status = 'rejected', verified = false
 where id = '9bb47d6c-2511-4dae-b339-1ed06a62260e';

alter table boutiques enable trigger boutiques_guard_admin_fields;

-- Migration 0038's cascade then auto-hides the boutique's product. Nothing is
-- deleted: the QA orders, counters and audit log are untouched, and approving
-- the boutique again would restore it.


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. OPTIONAL — repair the one COD order that was mispriced by LANCHOFF
--
-- Order AGL-A2MDZCD136 (1 Aug, COD, delivered, marked paid) used LANCHOFF
-- before migration 0053 existed, so its platform_discount is 0:
--
--   goods ₹999 · delivery ₹79 · cash handling ₹49
--   quoted to the buyer at checkout   ₹228     (999 − 899 + 79 + 49)
--   recorded on the order             ₹1,127   (999 + 79 + 49)
--
-- The buyer was quoted ₹228 and the order says ₹1,127 — a ₹899 gap. Setting
-- platform_discount records what the coupon actually took off, so the payout
-- maths (0053) settles the seller on the full ₹999 while the platform absorbs
-- the ₹899, which is what a platform-funded coupon means.
--
-- ⚠️ ONLY run this once you know what the seller actually collected at the door.
--    If they collected ₹1,127, the buyer was overcharged by ₹899 and owes a
--    refund. If they collected ₹228, this statement makes the books match.
-- ─────────────────────────────────────────────────────────────────────────────

-- update orders set platform_discount = 899 where order_number = 'AGL-A2MDZCD136';


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. VERIFICATION — run this last, check every line
-- ─────────────────────────────────────────────────────────────────────────────

-- (a) No coupon should be both steeply discounting and uncapped/unlimited.
--     Expect ZERO rows.
select code, type, off, min_subtotal, max_discount, usage_limit, used_count, active,
       case when boutique_id is null then 'PLATFORM-FUNDED' else 'seller-funded' end as funded_by
  from coupons
 where active
   and (usage_limit is null or (type = 'pct' and off >= 50 and max_discount is null));

-- (b) Full coupon list, for the record.
select code, type, off, min_subtotal, max_discount, usage_limit, used_count, active, expires_at
  from coupons order by code;

-- (c) The QA boutique is off the storefront and its product is hidden.
--     Expect status='rejected', verified=false, product not 'active'.
select b.name, b.status, b.verified, p.title, p.status as product_status, p.auto_hidden
  from boutiques b
  left join products p on p.boutique_id = b.id
 where b.id = '9bb47d6c-2511-4dae-b339-1ed06a62260e';

-- (d) The real seller's product is back in stock. Expect 2.
select title, stock from products where title = 'Indigo Floral Co-Ord Set';

-- (e) The guard trigger is enabled again. Expect tgenabled = 'O'.
select tgname, tgenabled from pg_trigger
 where tgrelid = 'boutiques'::regclass and tgname = 'boutiques_guard_admin_fields';

-- (f) Walk-in orders still reconcile (migration 0052). Expect ZERO rows.
select o.order_number, sub.goods as items, o.discount, o.total
  from orders o
  join (select order_id, sum(price * qty) as goods from order_items group by order_id) sub
    on sub.order_id = o.id
 where o.channel = 'offline'
   and abs(sub.goods - coalesce(o.discount, 0) - o.total) > 0.5;

-- (g) What buyers can see now.
select (select count(*) from boutiques where status = 'approved') as live_boutiques,
       (select count(*) from products  where status = 'active' and deleted_at is null) as live_products;
