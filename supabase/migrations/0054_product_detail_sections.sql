-- Product detail sections — the PDP accordion set the seller now fills in.
--
-- Before this, a product carried a description and a wash-care line and nothing
-- else, so the buyer page had to invent the rest ("Handcrafted with intricate
-- zari work…" was printed for every piece whose seller left the box empty).
-- These columns let the seller answer the questions buyers actually ask before
-- they buy — what it's made for, how to wash it, whether it's nursing-friendly,
-- how it ships, how close the photo is to the real shade.
--
-- Fully additive and idempotent: safe to run once in the Supabase SQL editor
-- after 0001–0053. Every column has a default, so existing rows stay valid and
-- the buyer page simply hides the sections they haven't filled in yet.

-- Up to 6 feature badges (Breathable, Premium Fabric, …). Stored as the stable
-- badge ids from src/lib/productBadges.ts, not their labels, so renaming a badge
-- in the app never orphans a product's picks.
alter table products add column if not exists badges text[] not null default '{}';

-- Nursing/maternity access. A flag rather than free text so it can become a
-- buyer-facing filter later; the note explains *how* (concealed zip, side slit).
alter table products add column if not exists feeding_friendly boolean not null default false;
alter table products add column if not exists feeding_note text not null default '';

-- Per-product overrides. Blank means "use the boutique's delivery settings" and
-- "use the platform's standard colour wording" — the app never stores a copy of
-- the fallback text, so changing the default later reaches every old product.
alter table products add column if not exists shipping_info text not null default '';
alter table products add column if not exists color_disclaimer text not null default '';

-- Seller-written spec rows ([{ "label": "Blouse", "value": "Unstitched, 0.8m" }])
-- shown under the ones derived from category/colour/fabric/occasion.
alter table products add column if not exists specs jsonb not null default '[]'::jsonb;

-- Guard the shape at the edge: a single object or a bare string here would
-- render as garbage on the PDP, and the seller form is not the only writer.
do $$ begin
  alter table products add constraint products_specs_is_array
    check (jsonb_typeof(specs) = 'array');
exception when duplicate_object then null; end $$;

-- A product carries at most 6 badges — the buyer grid is a fixed 3×2.
do $$ begin
  alter table products add constraint products_badges_max
    check (coalesce(array_length(badges, 1), 0) <= 6);
exception when duplicate_object then null; end $$;
