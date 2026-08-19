-- 0080 — Indexes for the global search.
--
-- Buyer, seller and admin now share one search engine (src/lib/search/), and
-- every source it runs is a server-side `ilike '%term%'` across a handful of
-- text columns. Nothing in this file changes behaviour: the search works
-- without it. What it changes is cost.
--
-- A leading-wildcard LIKE cannot use a btree index — Postgres has to read every
-- row. At today's volumes that is a few milliseconds and nobody notices; at ten
-- thousand orders it is a sequential scan on the busiest table in the
-- marketplace, fired on every keystroke, by every admin at once. `pg_trgm` is
-- the fix: a GIN index over character trigrams that a `%term%` match *can* use.
--
-- Applying this is therefore not urgent, but it is not optional either — do it
-- before the catalogue or the order book grows.
--
--   Numbering note: 0077 was used twice (delivery_zones and shortlist_boards),
--   0078 is payout_delivery_gate and 0079 is chat_photos, so this is 0080.
--   The next one is 0081.
--
-- Safe to run more than once. Nothing here locks a table for long:
-- CREATE INDEX CONCURRENTLY is deliberately NOT used because it cannot run
-- inside the Supabase SQL editor's implicit transaction — these tables are
-- small enough today that a plain CREATE INDEX is a sub-second lock. If you are
-- applying this against a large live database, run each statement separately
-- with CONCURRENTLY added by hand.

create extension if not exists pg_trgm;

-- ── Products — buyer, seller and admin all search these ─────────────────
create index if not exists products_title_trgm      on products using gin (title gin_trgm_ops);
create index if not exists products_category_trgm   on products using gin (category gin_trgm_ops);
create index if not exists products_fabric_trgm     on products using gin (fabric gin_trgm_ops);
create index if not exists products_color_trgm      on products using gin (color gin_trgm_ops);
create index if not exists products_occasion_trgm   on products using gin (occasion gin_trgm_ops);

-- ── Boutiques ───────────────────────────────────────────────────────────
create index if not exists boutiques_name_trgm      on boutiques using gin (name gin_trgm_ops);
create index if not exists boutiques_city_trgm      on boutiques using gin (city gin_trgm_ops);
create index if not exists boutiques_area_trgm      on boutiques using gin (area gin_trgm_ops);
create index if not exists boutiques_owner_name_trgm on boutiques using gin (owner_name gin_trgm_ops);

-- ── Orders ──────────────────────────────────────────────────────────────
-- `payment_id` is here because when Razorpay flags a payment the only
-- identifier support has is `pay_XXXX`, and that lookup has to be fast.
create index if not exists orders_order_number_trgm on orders using gin (order_number gin_trgm_ops);
create index if not exists orders_guest_name_trgm   on orders using gin (guest_name gin_trgm_ops);
create index if not exists orders_guest_phone_trgm  on orders using gin (guest_phone gin_trgm_ops);
create index if not exists orders_guest_city_trgm   on orders using gin (guest_city gin_trgm_ops);
create index if not exists orders_payment_id_trgm   on orders using gin (payment_id gin_trgm_ops);

-- ── People (admin only) ─────────────────────────────────────────────────
create index if not exists profiles_full_name_trgm  on profiles using gin (full_name gin_trgm_ops);
create index if not exists profiles_email_trgm      on profiles using gin (email gin_trgm_ops);
create index if not exists profiles_phone_trgm      on profiles using gin (phone gin_trgm_ops);

-- ── Everything else the console searches ────────────────────────────────
create index if not exists coupons_code_trgm        on coupons using gin (code gin_trgm_ops);
create index if not exists expenses_title_trgm      on expenses using gin (title gin_trgm_ops);
create index if not exists expenses_vendor_trgm     on expenses using gin (vendor gin_trgm_ops);
create index if not exists reviews_body_trgm        on reviews using gin (body gin_trgm_ops);
create index if not exists reviews_author_name_trgm on reviews using gin (author_name gin_trgm_ops);
create index if not exists taxonomy_name_trgm       on taxonomy using gin (name gin_trgm_ops);
create index if not exists ad_campaigns_headline_trgm on ad_campaigns using gin (headline gin_trgm_ops);

-- ── Scoping indexes the search relies on ────────────────────────────────
-- Every seller source is `.eq('boutique_id', …)` before it matches text, so the
-- planner wants a cheap way to get to one shop's rows first.
create index if not exists coupons_boutique_id_idx      on coupons (boutique_id);
create index if not exists reviews_boutique_id_idx      on reviews (boutique_id);
create index if not exists ad_campaigns_boutique_id_idx on ad_campaigns (boutique_id);

-- Verify:
--   select indexname from pg_indexes where indexname like '%_trgm';
--   explain analyze select id from orders where order_number ilike '%1234%';
--     -> should say "Bitmap Index Scan on orders_order_number_trgm",
--        not "Seq Scan on orders".
