-- Seller replies to reviews.
--
-- Reviews (migration 0014, photos in 0041) were a one-way channel: a buyer left
-- a rating + words and the boutique had no way to answer. Every marketplace of
-- any maturity lets the seller respond — to thank, to apologise, to correct a
-- misunderstanding in public — and that reply is the single most-requested
-- seller capability that was missing here.
--
-- This adds a public reply owned by the boutique, written through a SECURITY
-- DEFINER RPC so the seller can touch *only* the reply columns of *their own*
-- boutique's reviews, never the buyer's rating or words. Reading the reply needs
-- nothing new — the existing "reviews: public read" policy already exposes the
-- whole row to buyers and to the owning seller.
--
-- Additive and idempotent. Run once in the Supabase SQL editor after 0014+0041.

alter table reviews add column if not exists seller_reply text;
alter table reviews add column if not exists seller_reply_at timestamptz;

-- Post, edit or clear the boutique's reply to one of its reviews. The caller
-- must own the review's boutique; an empty/blank reply clears it. SECURITY
-- DEFINER so the write lands past the buyer-only "reviews: owner write" policy,
-- but the function only ever writes the two reply columns, so a seller can never
-- rewrite the buyer's rating or body through it.
create or replace function reply_to_review(p_review_id uuid, p_reply text)
returns reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owns boolean;
  v_row reviews;
  v_clean text := nullif(btrim(coalesce(p_reply, '')), '');
begin
  select exists (
    select 1
    from reviews r
    join boutiques b on b.id = r.boutique_id
    where r.id = p_review_id and b.owner_id = auth.uid()
  ) into v_owns;

  if not v_owns then
    raise exception 'not authorised to reply to this review';
  end if;

  update reviews
     set seller_reply = v_clean,
         seller_reply_at = case when v_clean is null then null else now() end
   where id = p_review_id
   returning * into v_row;

  return v_row;
end;
$$;

grant execute on function reply_to_review(uuid, text) to authenticated;
