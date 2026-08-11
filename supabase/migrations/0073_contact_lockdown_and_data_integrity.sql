-- Close the seller-contact over-grant, put integrity rules behind the product
-- form, and tidy the taxonomy terms that reached buyers malformed.
--
-- Idempotent and re-runnable in the Supabase SQL editor. Requires 0021
-- (boutique column grants), 0024 (taxonomy), 0027 (boutique_private widening),
-- and 0048 (platform_settings).
--
-- ══ 1) boutiques: email / phone / whatsapp are not public ════════════════════
--
-- 0021 revoked the blanket SELECT on `boutiques` and granted a column list back
-- to anon and authenticated. That list included `email`, `phone` and `whatsapp`
-- — not because the storefront needed them (it never renders any of the three;
-- the buyer's route to a shop is in-app chat) but because the SELLER console
-- reuses the same column list to read its own shop.
--
-- The consequence is that every seller's email address and mobile number were
-- readable, in bulk, by anyone holding the anon key — and that key ships inside
-- the browser bundle. One unauthenticated request returned the lot:
--
--     GET /rest/v1/boutiques?select=name,email,phone,whatsapp
--
-- That is a contact list of every boutique on the platform, free to anyone who
-- opens devtools: spam, and a ready-made poaching list for a competitor.
--
-- The fix is the pattern 0021 already established for bank details — withhold
-- the columns from both roles and hand them back through `boutique_private()`,
-- a SECURITY DEFINER function whose WHERE clause is the access check. Note this
-- touches SELECT only: the seller's UPDATE grant is unaffected, so the Settings
-- form goes on saving a new phone number exactly as before.
revoke select (email, phone, whatsapp) on boutiques from anon, authenticated;

-- Extend the private read with the three contact columns. Dropped first because
-- CREATE OR REPLACE cannot change a function's return type (SQLSTATE 42P13),
-- which is the same reason 0027 drops it.
drop function if exists boutique_private(uuid);
create function boutique_private(bid uuid)
returns table (
  gst_number text,
  business_reg_number text,
  bank_account_name text,
  bank_account_number text,
  bank_ifsc text,
  upi_id text,
  review_note text,
  -- Carried over verbatim from 0027 — a DROP + CREATE must re-declare every
  -- column the previous definition returned, or the admin's payout-verification
  -- panel silently loses two fields.
  payout_verification_status text,
  payout_verification_note text,
  -- New in 0073. Owner-or-admin only, exactly like everything above them.
  email text,
  phone text,
  whatsapp text
)
language sql
security definer
stable
set search_path = public
as $$
  select b.gst_number, b.business_reg_number, b.bank_account_name,
         b.bank_account_number, b.bank_ifsc, b.upi_id, b.review_note,
         b.payout_verification_status, b.payout_verification_note,
         b.email, b.phone, b.whatsapp
    from boutiques b
   where b.id = bid
     and (b.owner_id = auth.uid() or is_admin());
$$;

revoke all on function boutique_private(uuid) from public, anon;
grant execute on function boutique_private(uuid) to authenticated;

-- ══ 2) products: MRP can never sit below the selling price ═══════════════════
--
-- `ProductForm.validate()` enforces MRP >= price, but that is a browser check
-- and the browser is not the only writer: seed data, a CSV import and a straight
-- SQL update all bypass it. One row in production proves the point — a kurta set
-- priced 2599 against an MRP of 2199.
--
-- Nothing renders wrong (every display site guards on `mrp > price`, so the
-- strikethrough and the discount badge simply vanish), which is exactly why it
-- went unnoticed: the listing quietly loses its discount badge and no one is
-- told. A CHECK puts the rule where it cannot be skipped.
--
-- Existing bad rows are repaired first, or the constraint cannot be validated.
-- Clearing the MRP rather than raising it is deliberate: we know the price is
-- real (buyers are being charged it) and we do NOT know what the MRP should
-- have been, so inventing one would be fabricating a discount. A null MRP just
-- means "no strikethrough", which is already how the page renders today.
update products set mrp = null where mrp is not null and mrp < price;

alter table products drop constraint if exists products_mrp_gte_price;
alter table products add constraint products_mrp_gte_price
  check (mrp is null or mrp >= price);

-- ══ 3) taxonomy: terms that should never have been approved ══════════════════
--
-- Every row below is `status = 'approved'`, which means each one is a live
-- filter chip in the buyer's filter sheet AND an indexable landing page. They
-- reached buyers as-is.
--
-- Handled by name_key (0024's case- and space-insensitive identity) so a term
-- that has already been renamed by hand is not clobbered.
--
-- ⚠ WHY THE GUARD IS TURNED OFF AROUND THIS BLOCK
--
-- 0024 put a `taxonomy_guard_decision` BEFORE UPDATE trigger on this table that
-- raises 'taxonomy: approval is admin-managed' whenever `status` changes and
-- `is_admin()` is false. That guard is correct and stays — it is what stops a
-- seller approving their own requested term.
--
-- It also blocks this migration, and on the first run it did: a script in the
-- Supabase SQL editor has no `auth.uid()`, so `is_admin()` is false no matter
-- who is typing. Only the `status` line trips it; the three renames below do
-- not touch a guarded column and would pass on their own.
--
-- Restoring it is left to Postgres rather than to an exception handler.
-- `ALTER TABLE ... DISABLE TRIGGER` is transactional, and the SQL editor runs a
-- script as ONE transaction — so if anything below fails, the rollback puts the
-- trigger back along with everything else. That is also why the first failed run
-- left the database completely untouched.
--
-- Needs table ownership, which you have as `postgres` in the SQL editor. If you
-- run this file some other way, run it inside an explicit transaction, and if a
-- session ever dies between these two statements, restore it by hand with:
--
--     alter table taxonomy enable trigger taxonomy_guard_decision;
--
alter table taxonomy disable trigger taxonomy_guard_decision;

-- "Casual, Festive, Office Wear, Daily Wear" is four occasions approved as one
-- term. It cannot be split automatically — the products carrying it each need a
-- single real occasion — so it is moved back to `pending`, which takes it out of
-- the filter sheet and off the landing pages while leaving the admin the row to
-- deal with in /admin/catalogue.
update taxonomy set status = 'pending'
 where kind = 'occasion'
   and name_key = 'casual, festive, office wear, daily wear';

-- Casing. "office wear" sits in a list whose other members are Title Case, and
-- it renders as a chip exactly as typed.
update taxonomy set name = 'Office Wear'
 where kind = 'occasion' and name_key = 'office wear';

-- "Loomed  Cotton" carries a double space. 0024's name_key trigger already
-- collapses runs of whitespace for identity purposes, so this is presentation
-- only — but the chip and the slug both show it.
update taxonomy set name = 'Loomed Cotton'
 where kind = 'fabric' and name_key = 'loomed cotton';

-- Casing again, in the fabric list: "Raw silk" beside "Art Silk" and
-- "Kanchipuram Silk".
update taxonomy set name = 'Raw Silk'
 where kind = 'fabric' and name_key = 'raw silk';

alter table taxonomy enable trigger taxonomy_guard_decision;

-- ⚠ NOT changed automatically, because each needs a human decision:
--
--   • fabric "Cogchi silk" — almost certainly a misspelling, but of what?
--     Kanchi? Kora? Only the seller who typed it knows. Rename it in
--     /admin/catalogue rather than guessing.
--   • fabric "Soft Silk Sarees" — a garment type in the fabric vocabulary.
--     Merging it into "Silk" would silently re-label the products carrying it.
--   • The five products whose `color` is free text outside the approved list
--     ("Desert Rose", "Violet", "Black, vine", "Mulberry wine with Dusty blue",
--     "Olive Brown with Orange Floral Design"). These are invisible to the
--     colour filter, which matches the taxonomy exactly. ProductForm now
--     rejects an off-list colour on save, so editing each listing fixes it with
--     the one person who can see the garment. Left alone here on purpose: a
--     bulk guess would mislabel real stock.

-- ══ 4) platform_settings: stop publishing which admin last touched it ════════
--
-- The row is world-readable by design — the storefront prices a bag from it —
-- but `updated_by` is an admin's auth user id and has no business in a payload
-- served to anonymous browsers. Low severity on its own; free to remove.
revoke select (updated_by) on platform_settings from anon, authenticated;

-- ── Verify ──────────────────────────────────────────────────────────────────
--
--   -- should return zero rows:
--   select column_name from information_schema.column_privileges
--    where table_name = 'boutiques' and grantee = 'anon'
--      and column_name in ('email','phone','whatsapp');
--
--   -- should return zero rows:
--   select id, title, price, mrp from products where mrp is not null and mrp < price;
--
--   -- should show the tidied names, and no approved comma-blob:
--   select kind, name, status from taxonomy
--    where kind in ('occasion','fabric') order by kind, name;
--
--   -- tgenabled must be 'O' (enabled). 'D' means the guard is still off and
--   -- taxonomy approval is unprotected — re-enable it immediately:
--   select tgname, tgenabled from pg_trigger
--    where tgrelid = 'taxonomy'::regclass and tgname = 'taxonomy_guard_decision';
