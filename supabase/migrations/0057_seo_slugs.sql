-- ── SEO slugs — stable, indexed, URL-safe identifiers ──────────────────────
--
-- Two bugs, one root cause: nothing in the database owns a URL slug.
--
--  1. `boutiques.slug` is NULL for every row created since migration 0021.
--     0003 added the column and backfilled the rows that existed then, but the
--     onboarding wizard 0021 introduced never populates it and no trigger
--     maintains it. The consequences reach past SEO: the buyer app builds its
--     shareable link as `/b/<slug>`, so every "share this boutique" produced
--     `/b/null`, and the sitemap skipped every shop on the platform.
--
--  2. `products` has no slug at all. The product URL carries an 8-character
--     prefix of the id (`/products/<title>-4c5c667b`), which the browser can
--     resolve because it already holds the whole catalogue in memory — but the
--     edge middleware cannot: PostgREST has to filter in SQL, and Postgres
--     refuses `uuid LIKE 'text%'` ("operator does not exist: uuid ~~ unknown").
--     So every product page fell back to the generic shell for exactly the
--     crawlers the middleware exists to serve — WhatsApp, Bing, GPTBot.
--
-- After this migration both tables carry a real, unique, indexed slug that a
-- single equality lookup resolves, and triggers keep them correct forever.
--
-- The URL format does not change: the generated product slug is byte-identical
-- to what `productSlug()` in src/lib/seo.ts already produces, so every link
-- already shared stays valid.
--
-- Safe to re-run.

-- ── The slug function ───────────────────────────────────────────────────────
-- Mirrors `slugify()` in src/lib/seo.ts: lowercase, every run of non-alphanumeric
-- collapsed to one hyphen, trimmed, capped at 60 characters. Keep the two in
-- step — the client builds the URL and this resolves it.
create or replace function seo_slugify(input text, max_length int default 60)
returns text
language sql
immutable
as $$
  select nullif(
    trim(both '-' from
      left(
        trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g')),
        max_length
      )
    ),
    ''
  );
$$;

-- ── Products ────────────────────────────────────────────────────────────────
alter table products add column if not exists slug text;

-- `<title-slug>-<first 8 hex of the id>`. The id suffix is what makes it
-- unique without a counter, and what lets a retitled product keep resolving:
-- the old URL still carries the same suffix.
create or replace function products_build_slug(p_title text, p_id uuid)
returns text
language sql
immutable
as $$
  select coalesce(seo_slugify(p_title) || '-', '') || left(replace(p_id::text, '-', ''), 8);
$$;

update products
   set slug = products_build_slug(title, id)
 where slug is null
    or slug is distinct from products_build_slug(title, id);

alter table products alter column slug set not null;

create unique index if not exists products_slug_key on products (slug);

create or replace function products_set_slug()
returns trigger
language plpgsql
as $$
begin
  -- Recomputed whenever the title changes, so the URL always reflects the
  -- current name. The id suffix is stable, so old links keep resolving through
  -- the middleware's id fallback.
  new.slug := products_build_slug(new.title, new.id);
  return new;
end $$;

drop trigger if exists products_set_slug_trg on products;
create trigger products_set_slug_trg
  before insert or update of title on products
  for each row execute function products_set_slug();

-- ── Boutiques ───────────────────────────────────────────────────────────────
-- Backfill the NULLs left by the onboarding wizard. A shop whose name collides
-- with one already taken gets a short id suffix rather than failing the insert.
create or replace function boutiques_build_slug(p_name text, p_id uuid)
returns text
language plpgsql
stable
as $$
declare
  base text := seo_slugify(p_name);
  candidate text;
begin
  if base is null then
    base := 'boutique';
  end if;
  candidate := base;
  if exists (select 1 from boutiques where slug = candidate and id <> p_id) then
    candidate := base || '-' || left(replace(p_id::text, '-', ''), 6);
  end if;
  return candidate;
end $$;

update boutiques
   set slug = boutiques_build_slug(name, id)
 where slug is null or trim(slug) = '';

create unique index if not exists boutiques_slug_key on boutiques (slug);

create or replace function boutiques_set_slug()
returns trigger
language plpgsql
as $$
begin
  -- Only ever fills a blank. A boutique's slug is its public address and is
  -- deliberately immutable once set — renaming the shop must not break every
  -- link its customers have saved.
  if new.slug is null or trim(new.slug) = '' then
    new.slug := boutiques_build_slug(new.name, new.id);
  end if;
  return new;
end $$;

drop trigger if exists boutiques_set_slug_trg on boutiques;
create trigger boutiques_set_slug_trg
  before insert or update of name on boutiques
  for each row execute function boutiques_set_slug();

-- ── Grants ──────────────────────────────────────────────────────────────────
-- 0021 revoked the blanket SELECT on boutiques and grants columns one by one;
-- `slug` was already in that list, so nothing to add there. `products` keeps a
-- table-level grant, so its new column is readable automatically. Stated
-- explicitly so a future column-level lockdown does not silently drop it.
grant select (slug) on boutiques to anon, authenticated;
