-- Close the seller's write access to settlement columns on `orders`, and put
-- real limits on the public storage buckets.
--
-- Idempotent and re-runnable in the Supabase SQL editor. Requires 0022, 0025,
-- 0026, 0049, 0053, 0063.
--
-- ══ 1) orders: the settlement columns are not the seller's to write ══════════
--
-- schema.sql grants a seller UPDATE on their own orders:
--
--     create policy "orders: seller or admin update" on orders for update
--       using (exists (select 1 from boutiques b
--                      where b.id = boutique_id and b.owner_id = auth.uid())
--              or is_admin());
--
-- There is no WITH CHECK and no column list, so that policy authorises writing
-- EVERY column of the row. Three later triggers narrowed it, each closing the
-- hole in front of it at the time:
--
--     0022  payment_status (prepaid), total, cod_fee, shipping_fee
--     0026  delivered_at (no back-dating)
--     0063  delivery_disputed (a seller cannot clear a dispute against itself)
--
-- That is a denylist, and it missed the columns the payout run actually keys
-- on. `payout_id` is the stamp that says "this order has been settled" and
-- `refunded` is the flag that says "this money was reversed" — both are how
-- src/data/payouts.ts (fetchPayoutSummaries) and migration 0025's
-- `open_auto_payout` decide what the platform still owes:
--
--     .is('payout_id', null).eq('payment_status','paid').eq('refunded', false)
--
-- Neither was guarded, and the seller app talks to PostgREST directly with the
-- anon key, so from the browser console of any signed-in seller:
--
--     await supabase.from('orders')
--       .update({ payout_id: null, refunded: false })
--       .eq('boutique_id', '<their own boutique>');
--
-- Every order they have ALREADY been paid for reappears as an outstanding
-- balance in /admin/payments, and the admin settles it a second time. The same
-- policy also left `platform_discount` writable (it is added back to the
-- seller's COD net in fetchPayoutSummaries, so inflating it invents money the
-- platform owes) and `channel` (flipping an offline POS sale to 'online' pulls
-- the seller's own till receipts into the payout).
--
-- The fix is an explicit, complete enumeration of the columns that decide who
-- is owed what, plus the identity columns that say which order this even is.
-- Nothing in the seller console writes any of them — the seller app writes only
-- `status`, `packed_at`, and `payment_status`/`paid_at` on a COD order — so this
-- takes away no working flow. Admins are exempt: the refund console
-- (/admin/refunds) and the payout console legitimately write `refunded` and
-- `payout_id`.
--
-- Raised rather than silently reverted, deliberately. 0026 and 0063 pin their
-- columns back to OLD because a seller saving an unrelated field should not hit
-- a wall. Here there is no such case — no legitimate seller write touches these
-- columns at all — so an attempt is an anomaly worth surfacing in the logs
-- rather than swallowing.

create or replace function orders_guard_settlement_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if is_admin() then
    return new;
  end if;

  -- ── Settlement state: what the platform owes, and whether it already paid ──
  if new.payout_id is distinct from old.payout_id then
    raise exception 'orders: payout_id is settlement state and is admin-managed';
  end if;
  if new.refunded is distinct from old.refunded
  or new.refunded_at is distinct from old.refunded_at then
    raise exception 'orders: refunded is admin-managed';
  end if;

  -- ── The money breakdown ───────────────────────────────────────────────────
  -- `total`, `cod_fee` and `shipping_fee` are already covered by 0022; these are
  -- the two it missed. Both are priced server-side at checkout and both feed the
  -- payout arithmetic.
  if new.discount is distinct from old.discount then
    raise exception 'orders: discount is set at checkout and is immutable';
  end if;
  if new.platform_discount is distinct from old.platform_discount then
    raise exception 'orders: platform_discount is set at checkout and is immutable';
  end if;
  if new.coupon_code is distinct from old.coupon_code then
    raise exception 'orders: coupon_code is set at checkout and is immutable';
  end if;

  -- ── How the money arrived ─────────────────────────────────────────────────
  -- `channel` decides whether an order is a marketplace sale (settled through
  -- the platform) or the seller's own walk-in till (excluded from payouts).
  if new.channel is distinct from old.channel then
    raise exception 'orders: channel is set when the order is created';
  end if;
  if new.payment_method is distinct from old.payment_method then
    raise exception 'orders: payment_method is set when the order is created';
  end if;
  if new.payment_id is distinct from old.payment_id then
    raise exception 'orders: payment_id is the gateway''s reference and is immutable';
  end if;

  -- ── Which order this is ───────────────────────────────────────────────────
  -- Re-pointing an order at another boutique or buyer would move both the money
  -- and the buyer's order history.
  if new.id is distinct from old.id
  or new.order_number is distinct from old.order_number
  or new.buyer_id is distinct from old.buyer_id
  or new.boutique_id is distinct from old.boutique_id
  or new.created_at is distinct from old.created_at then
    raise exception 'orders: order identity is immutable';
  end if;

  return new;
end $$;

-- Sorts after `orders_guard_payment_state` and before `orders_stamp_delivered`,
-- but the ordering does not matter here: every column this touches is one no
-- other trigger writes.
drop trigger if exists orders_guard_settlement_columns on orders;
create trigger orders_guard_settlement_columns
  before update on orders
  for each row execute function orders_guard_settlement_columns();


-- ══ 2) products/boutiques: a seller cannot rate themselves ═══════════════════
--
-- Same root cause as part 1, on the other over-broad policy from schema.sql:
--
--     create policy "products: owner or admin update" on products for update
--       using (exists (select 1 from boutiques b
--                      where b.id = boutique_id and b.owner_id = auth.uid())
--              or is_admin());
--
-- No WITH CHECK, no column list. 0023 and 0031 guarded the counters they added
-- (`sold_count`, `views_count`, `shares_count`, `wishlist_count`), but
-- `rating` and `reviews_count` — which pre-date them, in schema.sql — were left
-- writable by the owning seller.
--
-- Those two columns are 40% of discovery ranking. From src/lib/ranking.ts:
--
--     score = 0.55·sales + 0.25·rating + 0.15·reviews + 0.05·freshness
--
-- The 0.55 sales term is safe (0023 guards `sold_count`). The 0.25 and 0.15
-- terms are not, so:
--
--     await supabase.from('products')
--       .update({ rating: 5, reviews_count: 9999 })
--       .eq('boutique_id', MY_BOUTIQUE_ID);
--
-- pushes that seller's catalogue to the top of every "See all" page, collection
-- and search result — and paints a fake "5.0 ★ (9999)" on each product page as
-- social proof. `boutiques.rating`, `reviews_count` and `positive_rating` are
-- the same story via the boutique update policy, and feed the boutique ranking.
--
-- These columns have exactly one legitimate writer: `recompute_review_aggregates`
-- (0014), the SECURITY DEFINER trigger on `reviews`. It is SECURITY DEFINER so
-- it can write past the owner-only policies — but `is_admin()` still resolves
-- against the *calling* buyer's auth.uid(), so it is not an admin and a naive
-- guard would revert its writes too.
--
-- 0023 and 0031 already solved this exact problem: the legitimate writer raises
-- a transaction-local flag, and the guard stands down while it is set. Reuse
-- that pattern rather than inventing a second one — `set_config(..., true)` is
-- transaction-scoped, so the window closes on its own.
--
-- ⚠ This REPLACES the function body from 0014. If 0014 is ever re-run AFTER this
--   migration it restores the old body, which does not raise the flag — the
--   guards below would then silently revert every review aggregate, and ratings
--   would freeze at their current values with no error anywhere. If you re-run
--   0014, re-run 0072 after it.

create or replace function recompute_review_aggregates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product uuid := coalesce(new.product_id, old.product_id);
  v_boutique uuid := coalesce(new.boutique_id, old.boutique_id);
begin
  -- Transaction-local: tells the guards below that THIS write is the review
  -- aggregate and not a seller editing their own score. Cleared automatically
  -- at the end of the transaction.
  perform set_config('agilam.review_aggregate', 'on', true);

  update products p
    set rating = coalesce((select round(avg(r.rating)::numeric, 1) from reviews r where r.product_id = v_product), 0),
        reviews_count = (select count(*) from reviews r where r.product_id = v_product)
    where p.id = v_product;

  update boutiques b
    set rating = coalesce((select round(avg(r.rating)::numeric, 1) from reviews r where r.boutique_id = v_boutique), 0),
        reviews_count = (select count(*) from reviews r where r.boutique_id = v_boutique),
        positive_rating = coalesce((
          select round(100.0 * count(*) filter (where r.rating >= 4) / nullif(count(*), 0))
          from reviews r where r.boutique_id = v_boutique
        ), 0)
    where b.id = v_boutique;

  perform set_config('agilam.review_aggregate', 'off', true);

  return null;
end;
$$;

-- Silently pinned back to the stored value rather than raised, matching 0023 and
-- 0031: the seller console saves a whole product row at once, so a stale
-- `rating` field in that payload must not fail the entire save.
create or replace function products_guard_rating()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('agilam.review_aggregate', true), 'off') <> 'on' then
    new.rating := old.rating;
    new.reviews_count := old.reviews_count;
  end if;
  return new;
end $$;

drop trigger if exists products_guard_rating on products;
create trigger products_guard_rating
  before update on products
  for each row execute function products_guard_rating();

create or replace function boutiques_guard_rating()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('agilam.review_aggregate', true), 'off') <> 'on' then
    new.rating := old.rating;
    new.reviews_count := old.reviews_count;
    new.positive_rating := old.positive_rating;
  end if;
  return new;
end $$;

-- Sorts before `boutiques_guard_admin_fields` (0021) and
-- `boutiques_guard_sales_counters` (0023); all three pin disjoint column sets,
-- so the order between them does not matter.
drop trigger if exists boutiques_guard_rating on boutiques;
create trigger boutiques_guard_rating
  before update on boutiques
  for each row execute function boutiques_guard_rating();


-- ══ 3) Storage: the public buckets accept anything, from anyone ══════════════
--
-- 0034 fixed cross-tenant UPDATE/DELETE, but INSERT is still "any authenticated
-- user" on the public buckets, and — this is the part that makes it reachable by
-- the general public — `authenticated` includes an ANONYMOUS Supabase user.
-- Opening a chat calls signInAnonymously() (src/data/chat.ts), so any visitor
-- can obtain a session that satisfies the upload policy without ever creating an
-- account.
--
-- What they can upload is unbounded in both directions: no bucket declares
-- `allowed_mime_types` or `file_size_limit`, and the only validation is in the
-- browser (src/lib/uploadImage.ts checks `file.type.startsWith('image/')` and a
-- 10 MB cap — both trivially bypassed by calling storage.upload() directly).
-- The upload also passes `contentType: file.type`, so the attacker chooses the
-- Content-Type the bucket serves the object back with. That is arbitrary file
-- hosting on the project's own storage domain — phishing pages, malware, and
-- unbounded storage billing.
--
-- Bucket-level limits are the right place for this because they are enforced by
-- storage itself, on every path into the bucket, regardless of RLS or client.
-- The MIME list matches what the app actually uploads; the size caps match the
-- limits the UI already claims to enforce.

update storage.buckets
   set file_size_limit = 10485760,  -- 10 MB, matching uploadImage.ts
       allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif','image/gif']
 where id in ('product-images', 'boutique-images', 'review-images', 'catalogue-images');

-- Expense proofs are a private, admin-only bucket (0056) and are legitimately
-- PDFs as well as photos.
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
 where id = 'expense-proofs';

-- Uploads still come from the browser, so an anonymous session can burn a
-- bucket's quota with 10 MB JPEGs. Narrowing INSERT to non-anonymous users
-- costs nothing the app does — every real upload happens in the seller console
-- or a review form, both of which require a real account.
do $$
declare
  b text;
begin
  foreach b in array array['product-images', 'boutique-images'] loop
    execute format('drop policy if exists %I on storage.objects', b || ': authed upload');
    execute format($f$
      create policy %I on storage.objects for insert to authenticated
        with check (
          bucket_id = %L
          and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
        )
    $f$, b || ': authed upload', b);
  end loop;
end $$;


-- ══ Verify ══════════════════════════════════════════════════════════════════
--
-- 1) As a SELLER (not an admin), against one of your own delivered orders that
--    has already been settled — both should fail:
--
--      update orders set payout_id = null where id = '<own order>';
--      -- ERROR: orders: payout_id is settlement state and is admin-managed
--      update orders set refunded = false where id = '<own order>';
--      -- ERROR: orders: refunded is admin-managed
--
--    And the normal fulfilment write should still succeed:
--
--      update orders set status = 'shipped' where id = '<own order>';
--
-- 2) Buckets now declare limits (five rows, none with a null mime list):
--
--      select id, file_size_limit, allowed_mime_types from storage.buckets;
