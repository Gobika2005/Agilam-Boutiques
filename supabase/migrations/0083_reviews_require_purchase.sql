-- Only buyers may review — a review requires a delivered order for that piece.
--
-- Until now `"reviews: owner write"` checked one thing: `buyer_id = auth.uid()`.
-- That means any signed-in account could post a five-star review on any product
-- in the catalogue, or a one-star on a competitor's, without ever having bought
-- anything. On a marketplace where the rating is the main thing a buyer has to
-- judge an unknown boutique by, that is the rating system's whole value sitting
-- behind a free signup.
--
-- The app has always *prompted* for a review only after delivery
-- (src/hooks/useOrderFeedback.ts). This makes the database agree, which is what
-- makes it a rule rather than a suggestion — RLS is the security boundary here,
-- and a client-side check is a courtesy to honest users, not a control.
--
-- The bar is DELIVERED, not "ordered". A review is a report on a piece someone
-- has actually received, so an order still in `pending` or `shipped` does not
-- earn one — and that also closes the obvious abuse, which would otherwise be
-- to place an order, review, and cancel.
--
-- Second bug fixed here: `verified_purchase` has never been written by anything.
-- It defaults to false, nothing in the app or the database ever set it, so the
-- "Verified" badge rendered in five places has never once appeared. It is now
-- stamped by a trigger from the same rule, and backfilled for existing rows.
--
-- Idempotent: re-runnable in the Supabase SQL editor.

-- ── The rule, in one place ──────────────────────────────────────────────────
-- Deliberately NOT `security definer`. It reads `orders`, which is already
-- protected by RLS: a buyer sees their own orders and an admin sees all, so
-- evaluating this as the caller gives exactly the right answer with no elevated
-- path to abuse. A definer version would also answer "did buyer X buy product
-- Y?" for anyone who asked, which is nobody's business.
create or replace function has_purchased_product(p_buyer uuid, p_product uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
      from orders o
      join order_items oi on oi.order_id = o.id
     where o.buyer_id = p_buyer
       and oi.product_id = p_product
       -- Widen here if the bar ever needs to move; this is the only place that
       -- decides what "bought it" means.
       and o.status = 'delivered'
  )
$$;

grant execute on function has_purchased_product(uuid, uuid) to authenticated;

-- ── Write policies ──────────────────────────────────────────────────────────
-- The old `for all` policy is replaced by three, because the three verbs no
-- longer share a rule: inserting needs a purchase, editing needs one too (so a
-- refunded-and-removed order cannot leave an editable review behind), and
-- deleting your own review must always be possible — a buyer who wants their
-- words gone should never be told they are stuck.
drop policy if exists "reviews: owner write"  on reviews;
drop policy if exists "reviews: buyer insert" on reviews;
drop policy if exists "reviews: buyer update" on reviews;
drop policy if exists "reviews: buyer delete" on reviews;

create policy "reviews: buyer insert" on reviews for insert
  to authenticated
  with check (
    buyer_id = auth.uid()
    and has_purchased_product(auth.uid(), product_id)
  );

create policy "reviews: buyer update" on reviews for update
  to authenticated
  using (buyer_id = auth.uid())
  with check (
    buyer_id = auth.uid()
    and has_purchased_product(auth.uid(), product_id)
  );

create policy "reviews: buyer delete" on reviews for delete
  to authenticated
  using (buyer_id = auth.uid());

-- Admin moderation is unaffected: `adminReviews` goes through `is_admin()`
-- surfaces, and the admin console's own policies (0048) are not touched here.

-- ── The Verified badge, made true ───────────────────────────────────────────
-- Stamped by the database rather than sent by the client, for the same reason
-- as everything else on this page: a client-supplied "I really bought this" is
-- worth nothing. BEFORE INSERT OR UPDATE so it cannot be set by hand either.
--
-- Computed only when the (buyer, product) pair is new or has changed; every
-- other UPDATE carries the stored value forward. That is not an optimisation —
-- `has_purchased_product` answers as whoever is running the statement, and the
-- rows are updated from three places with three different views of `orders`:
-- the buyer editing their own review, an admin moderating (0048), and the
-- boutique posting a public reply through the definer function in 0045.
-- Recomputing on each of those would let an UPDATE made by someone who cannot
-- see the buyer's orders quietly erase a badge that is true.
create or replace function stamp_review_verified()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT'
     or new.buyer_id is distinct from old.buyer_id
     or new.product_id is distinct from old.product_id then
    new.verified_purchase := has_purchased_product(new.buyer_id, new.product_id);
  else
    -- Also what stops a client sending `verified_purchase: true` in an edit.
    new.verified_purchase := old.verified_purchase;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_reviews_verified on reviews;
create trigger trg_reviews_verified
  before insert or update on reviews
  for each row execute function stamp_review_verified();

-- Existing rows, written before any of this existed. This runs as the migration
-- owner and so sees every order — the badge becomes true for the reviews that
-- genuinely followed a delivery and stays false for the rest, which is the
-- honest reading of the ones already published.
update reviews r
   set verified_purchase = exists (
     select 1
       from orders o
       join order_items oi on oi.order_id = o.id
      where o.buyer_id = r.buyer_id
        and oi.product_id = r.product_id
        and o.status = 'delivered'
   )
 where true;

-- Note on what is deliberately NOT done: existing unverified reviews are left
-- published. They were written under the rules of the time, deleting a buyer's
-- words retroactively is not ours to do, and the badge now tells them apart.

-- ── Verify ──────────────────────────────────────────────────────────────────
--   select count(*) filter (where verified_purchase) as verified,
--          count(*) as total
--     from reviews;
--
-- As a signed-in buyer, on a product you have NOT had delivered, this must fail
-- with a row-level security error:
--   insert into reviews (product_id, boutique_id, buyer_id, rating, body)
--   values ('<product>', '<boutique>', auth.uid(), 5, 'test');
