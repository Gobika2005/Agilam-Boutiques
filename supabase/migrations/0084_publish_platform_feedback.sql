-- Let buyers put their MangaiMart feedback on the front page — if they choose to.
--
-- The Home page has a "What shoppers say about MangaiMart" section, but it was
-- fed by `reviews` — product reviews, printed with a "Saree · Boutique" line
-- under the buyer's name. So a section about the platform was really showing
-- opinions about a garment and a shop.
--
-- The right source already exists: `platform_feedback` (0071), where buyers rate
-- MangaiMart itself after delivery. 0071 made it private on purpose, and that
-- comment still stands — it is collected in confidence, and a buyer who wrote
-- "the courier was hopeless" did not agree to have it framed as a testimonial.
--
-- So publication is opt-in AND approved, never retroactive:
--
--   • `publish_consent` — the buyer ticked the box in the feedback sheet. Every
--     row that exists today keeps the default `false`, which is the whole point:
--     nothing already given in confidence becomes public because of this file.
--   • `published` — an admin then approved it at /admin/feedback. Consent alone
--     does not put words on the front page.
--
-- Both must be true, and the read goes through a definer RPC rather than a
-- public read policy, so `buyer_id` and `order_id` never leave the database.
--
-- Additive and idempotent. Run once in the Supabase SQL editor, after 0071.

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table platform_feedback add column if not exists publish_consent boolean not null default false;
alter table platform_feedback add column if not exists published        boolean not null default false;
alter table platform_feedback add column if not exists published_at     timestamptz;

-- Snapshotted at consent time rather than joined from `profiles` at read time:
-- the name shown is the one the buyer saw next to the tickbox. Renaming an
-- account later must not silently re-attribute a published quote.
alter table platform_feedback add column if not exists author_name text;

-- The Home feed: approved rows, best first. Partial, because the published rows
-- will always be a small slice of the table.
create index if not exists idx_platform_feedback_published
  on platform_feedback (rating desc, created_at desc)
  where published;

-- ── Only an admin publishes, and only with consent ──────────────────────────
-- 0071 gave buyers a broad `for update using (buyer_id = auth.uid())` policy.
-- Policies are row-level, not column-level, so without this guard a buyer could
-- simply set `published = true` on their own row — the same column-blind-UPDATE
-- shape that let sellers set their own rating before 0072.
--
-- A trigger rather than a column revoke: revoking columns from `authenticated`
-- is what made coupons 403-dead for sellers and admins alike in 0058.
create or replace function platform_feedback_publish_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Nothing arrives pre-published. Consent may be given at insert; approval
    -- is always a separate, later act.
    if not is_admin() then
      new.published := false;
    end if;
    new.published_at := case when new.published then now() else null end;
    return new;
  end if;

  -- Buyers may edit their words, their rating and their consent. Whether it is
  -- published is not theirs to set.
  if not is_admin() then
    new.published := old.published;
  end if;

  -- Withdrawing consent unpublishes immediately, whoever makes the edit. Consent
  -- is revocable or it is not consent.
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

-- Belt and braces: even a service-role write cannot produce a published row
-- without consent recorded against it.
do $$ begin
  alter table platform_feedback
    add constraint platform_feedback_publish_needs_consent
    check (published = false or publish_consent = true);
exception when duplicate_object then null; end $$;

-- ── The public read ─────────────────────────────────────────────────────────
-- Deliberately NOT a public select policy. `platform_feedback` rows carry
-- `buyer_id` and `order_id`, and a policy grants the whole row — an anonymous
-- visitor could read who ordered what. This returns the four fields a
-- testimonial needs and nothing else.
--
-- `verified` is derived, not stored: every row is tied to the delivered order
-- that prompted it, so the badge is a fact rather than a decoration. 0071 made
-- `order_id` nullable for feedback left outside an order later; such a row is
-- publishable but not verified.
create or replace function public_platform_reviews(p_limit int default 3)
returns table (
  id          uuid,
  rating      int,
  body        text,
  author_name text,
  city        text,
  verified    boolean,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.id,
    f.rating,
    f.body,
    coalesce(nullif(btrim(f.author_name), ''), 'MangaiMart buyer'),
    p.city,
    f.order_id is not null,
    f.created_at
  from platform_feedback f
  left join profiles p on p.id = f.buyer_id
  where f.published
    and f.publish_consent
    and btrim(f.body) <> ''      -- a bare star rating reads as filler in a quote
  order by f.rating desc, f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 3), 24));
$$;

revoke all on function public_platform_reviews(int) from public;
grant execute on function public_platform_reviews(int) to anon, authenticated;
