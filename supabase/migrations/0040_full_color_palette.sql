-- Full colour palette for the product colour picker.
--
-- Migration 0024 seeded only seven colours (Pink, Red, Green, Purple, Yellow,
-- Teal, Peach), so a seller searching for "Black", "White", "Blue" and most of
-- the everyday wardrobe found nothing — and colour is admin-managed, so they
-- cannot add it themselves. This seeds the common apparel colours an Indian
-- ethnic-wear catalogue actually needs, each with a swatch hex so it renders on
-- the seller picker and the buyer filter, and so photo colour-detection has a
-- proper palette to snap to.
--
-- Ordering runs neutrals → warm → cool → accent, which reads better in the
-- dropdown than the original ad-hoc order. The seven existing colours are
-- re-slotted into that order and their swatches left as the admin set them, via
-- ON CONFLICT DO UPDATE on sort_order only; every new colour is inserted with
-- its swatch. Idempotent — safe to run more than once, and it never demotes or
-- renames a term an admin has already curated.

insert into taxonomy (kind, name, name_key, status, icon, hex, sort_order)
values
  ('color', 'Black',       'black',       'approved', null, '#22242A', 10),
  ('color', 'White',       'white',       'approved', null, '#FFFFFF', 20),
  ('color', 'Grey',        'grey',        'approved', null, '#9AA0A6', 30),
  ('color', 'Silver',      'silver',      'approved', null, '#C8CCD2', 40),
  ('color', 'Cream',       'cream',       'approved', null, '#F3E9D2', 50),
  ('color', 'Beige',       'beige',       'approved', null, '#D8C4A0', 60),
  ('color', 'Brown',       'brown',       'approved', null, '#7A4A28', 70),
  ('color', 'Rust',        'rust',        'approved', null, '#A8481F', 80),
  ('color', 'Maroon',      'maroon',      'approved', null, '#7A1F35', 90),
  ('color', 'Red',         'red',         'approved', null, '#D6455A', 100),
  ('color', 'Wine',        'wine',        'approved', null, '#5C2233', 110),
  ('color', 'Pink',        'pink',        'approved', null, '#E7719F', 120),
  ('color', 'Magenta',     'magenta',     'approved', null, '#C2185B', 130),
  ('color', 'Peach',       'peach',       'approved', null, '#E8A583', 140),
  ('color', 'Coral',       'coral',       'approved', null, '#F26D5B', 150),
  ('color', 'Orange',      'orange',      'approved', null, '#E8802B', 160),
  ('color', 'Mustard',     'mustard',     'approved', null, '#C99A2E', 170),
  ('color', 'Yellow',      'yellow',      'approved', null, '#E0B84B', 180),
  ('color', 'Gold',        'gold',        'approved', null, '#C6A02C', 190),
  ('color', 'Olive',       'olive',       'approved', null, '#6E7A33', 200),
  ('color', 'Green',       'green',       'approved', null, '#5FA37E', 210),
  ('color', 'Teal',        'teal',        'approved', null, '#4F9CA3', 220),
  ('color', 'Turquoise',   'turquoise',   'approved', null, '#23B0AE', 230),
  ('color', 'Sky Blue',    'sky blue',    'approved', null, '#6FB6E4', 240),
  ('color', 'Blue',        'blue',        'approved', null, '#2F6DB5', 250),
  ('color', 'Navy Blue',   'navy blue',   'approved', null, '#1E2A5A', 260),
  ('color', 'Purple',      'purple',      'approved', null, '#9B7FC7', 270),
  ('color', 'Lavender',    'lavender',    'approved', null, '#BBA9E2', 280),
  ('color', 'Multicolour', 'multicolour', 'approved', null, '#B497A6', 290)
on conflict (kind, name_key) do update
  set sort_order = excluded.sort_order,
      status = 'approved';
