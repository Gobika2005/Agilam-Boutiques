-- MangaiMart — sample data seed  ·  LOCAL / PREVIEW ENVIRONMENTS ONLY
-- ---------------------------------------------------------------------------
-- ⚠  NEVER run this against the production database.
--
-- It creates ten real, email-confirmed auth accounts with one published
-- password — including an ADMIN account — plus fake boutiques, products and
-- orders that are indistinguishable from real rows in the admin console.
--
-- It is locked. To use it on a throwaway database, uncomment the `set` on the
-- line marked UNLOCK below and run the file as a single batch.
-- To undo a seed that already happened, run `supabase/scripts/purge_seed.sql`.
--
-- Run AFTER schema.sql, in the Supabase SQL editor (New query -> paste -> Run).
-- Safe to run more than once: it deletes its own seed rows first, then reinserts.
--
-- It creates real auth accounts so the whole app works end-to-end. Log in with:
--
--   Sellers  (password: MangaiMart@123)
--     elegance@mangaimart.test   -> Elegance Boutique   (Coimbatore)
--     trendz@mangaimart.test     -> Trendz Wardrobe     (Chennai)
--     pinkys@mangaimart.test     -> Pinky's Boutique    (Madurai)
--     style@mangaimart.test      -> Style Studio        (Salem)
--     silk@mangaimart.test       -> Silk Symphony       (Coimbatore)
--
--   Buyers   (password: MangaiMart@123)
--     priya@mangaimart.test, anitha@mangaimart.test, neha@mangaimart.test, divya@mangaimart.test
--
--   Admin    (password: MangaiMart@123)
--     admin@mangaimart.test
-- ---------------------------------------------------------------------------

-- ── UNLOCK ──────────────────────────────────────────────────────────────────
-- Uncomment exactly this line to allow the seed to run. Keep it commented in
-- the repo so a paste-and-run never plants demo data in production. The `set`
-- is session-scoped, so it must be in the SAME batch as the rest of the file.
-- set app.allow_seed = 'yes';

do $$
begin
  if coalesce(current_setting('app.allow_seed', true), '') <> 'yes' then
    raise exception 'seed.sql is locked — it plants demo accounts (including an admin with a published password) and fake catalogue data.'
      using hint = 'Local/preview DB only: uncomment the "set app.allow_seed" line at the top of this file and run the whole file in one batch. Already seeded production by mistake? Run supabase/scripts/purge_seed.sql.';
  end if;
end $$;

create extension if not exists "pgcrypto";

-- ── Fixed identifiers so re-runs are idempotent ──────────────────────────────
-- Sellers
--   11111111 Elegance · 22222222 Trendz · 33333333 Pinky's · 44444444 Style · 55555555 Silk
-- Buyers
--   a1..-Priya · b2..-Anitha · c3..-Neha · d4..-Divya
-- Admin
--   99999999
-- Boutiques  b0000001..b0000005
-- Products   c0000001..c0000008

-- ── 1. Clean up previous seed rows (children first) ─────────────────────────
delete from order_items where order_id in (
  select id from orders where boutique_id in (
    'b0000001-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000002',
    'b0000003-0000-0000-0000-000000000003','b0000004-0000-0000-0000-000000000004',
    'b0000005-0000-0000-0000-000000000005'));
delete from messages where conversation_id in (
  select id from conversations where boutique_id in (
    'b0000001-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000002',
    'b0000003-0000-0000-0000-000000000003','b0000004-0000-0000-0000-000000000004',
    'b0000005-0000-0000-0000-000000000005'));
delete from conversations where boutique_id in (
  'b0000001-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000002',
  'b0000003-0000-0000-0000-000000000003','b0000004-0000-0000-0000-000000000004',
  'b0000005-0000-0000-0000-000000000005');
delete from orders where boutique_id in (
  'b0000001-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000002',
  'b0000003-0000-0000-0000-000000000003','b0000004-0000-0000-0000-000000000004',
  'b0000005-0000-0000-0000-000000000005');
delete from subscriptions where boutique_id in (
  'b0000001-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000002',
  'b0000003-0000-0000-0000-000000000003','b0000004-0000-0000-0000-000000000004',
  'b0000005-0000-0000-0000-000000000005');
delete from wishlist where product_id in (
  'c0000001-0000-0000-0000-000000000001','c0000005-0000-0000-0000-000000000005');
delete from products where boutique_id in (
  'b0000001-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000002',
  'b0000003-0000-0000-0000-000000000003','b0000004-0000-0000-0000-000000000004',
  'b0000005-0000-0000-0000-000000000005');
delete from boutiques where id in (
  'b0000001-0000-0000-0000-000000000001','b0000002-0000-0000-0000-000000000002',
  'b0000003-0000-0000-0000-000000000003','b0000004-0000-0000-0000-000000000004',
  'b0000005-0000-0000-0000-000000000005');
delete from ads where title in (
  'Wedding Season Edit','Festive Silk Push','Boutique Spotlight','Monsoon Clearance');

-- ── 2. Auth users + identities + profiles ───────────────────────────────────
-- One helper block: for each row, upsert an auth.users record (confirmed email,
-- bcrypt password), a matching auth.identities row, and a public.profiles row.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- id, email, full_name, role, city
      ('11111111-1111-1111-1111-111111111111','elegance@mangaimart.test','Elegance Boutique','seller','Coimbatore'),
      ('22222222-2222-2222-2222-222222222222','trendz@mangaimart.test','Trendz Wardrobe','seller','Chennai'),
      ('33333333-3333-3333-3333-333333333333','pinkys@mangaimart.test','Pinky''s Boutique','seller','Madurai'),
      ('44444444-4444-4444-4444-444444444444','style@mangaimart.test','Style Studio','seller','Salem'),
      ('55555555-5555-5555-5555-555555555555','silk@mangaimart.test','Silk Symphony','seller','Coimbatore'),
      ('a1111111-1111-1111-1111-1111111111a1','priya@mangaimart.test','Priya Sharma','buyer','Coimbatore'),
      ('b2222222-2222-2222-2222-2222222222b2','anitha@mangaimart.test','Anitha R','buyer','Chennai'),
      ('c3333333-3333-3333-3333-3333333333c3','neha@mangaimart.test','Neha Verma','buyer','Madurai'),
      ('d4444444-4444-4444-4444-4444444444d4','divya@mangaimart.test','Divya K','buyer','Salem'),
      ('99999999-9999-9999-9999-999999999999','admin@mangaimart.test','MangaiMart Admin','admin','Coimbatore')
    ) as t(id, email, full_name, role, city)
  loop
    -- auth.users
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', r.id::uuid, 'authenticated', 'authenticated', r.email,
      crypt('MangaiMart@123', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}',
      jsonb_build_object('full_name', r.full_name, 'role', r.role, 'city', r.city),
      '', '', '', ''
    )
    on conflict (id) do update set
      encrypted_password = excluded.encrypted_password,
      email_confirmed_at = excluded.email_confirmed_at,
      raw_user_meta_data = excluded.raw_user_meta_data;

    -- auth.identities (email provider). provider_id required on recent Supabase.
    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), r.id::uuid, r.id,
      jsonb_build_object('sub', r.id, 'email', r.email, 'email_verified', true),
      'email', now(), now(), now()
    )
    on conflict (provider, provider_id) do nothing;

    -- public.profiles
    insert into profiles (id, role, full_name, email, city)
    values (r.id::uuid, r.role, r.full_name, r.email, r.city)
    on conflict (id) do update set
      role = excluded.role, full_name = excluded.full_name,
      email = excluded.email, city = excluded.city;
  end loop;
end $$;

-- ── 3. Boutiques ────────────────────────────────────────────────────────────
insert into boutiques (id, owner_id, name, slug, city, area, description, tone, cover_url, phone, instagram, established_year, verified, status, featured, rating, reviews_count, followers_count, positive_rating) values
  ('b0000001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Elegance Boutique','elegance-boutique','Coimbatore','RS Puram','Elegant ethnic wear for every occasion. Curated with love and elegance.',0,'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?auto=format&fit=crop&w=800&q=80','+91 98430 12345','elegance.boutique',2018,true,'approved',true,4.7,128,1240,99),
  ('b0000002-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','Trendz Wardrobe','trendz-wardrobe','Chennai','T. Nagar','Contemporary ethnic fusion for the modern woman.',7,'https://images.unsplash.com/photo-1555529771-835f59fc5efe?auto=format&fit=crop&w=800&q=80','+91 98410 23456','trendz.wardrobe',2019,true,'approved',false,4.6,96,860,96),
  ('b0000003-0000-0000-0000-000000000003','33333333-3333-3333-3333-333333333333','Pinky''s Boutique','pinkys-boutique','Madurai','KK Nagar','Luxury bridal lehengas and heirloom sarees.',2,'https://images.unsplash.com/photo-1521335629791-ce4aec67dd15?auto=format&fit=crop&w=800&q=80','+91 90470 34567','pinkys.boutique',2014,true,'approved',true,4.9,212,2100,98),
  ('b0000004-0000-0000-0000-000000000004','44444444-4444-4444-4444-444444444444','Style Studio','style-studio','Salem','Fairlands','Everyday elegance in kurtis, gowns and daily wear.',4,'https://images.unsplash.com/photo-1525562723836-dca67a71d5f1?auto=format&fit=crop&w=800&q=80','+91 94430 45678','style.studio',2020,false,'approved',false,4.4,54,430,92),
  ('b0000005-0000-0000-0000-000000000005','55555555-5555-5555-5555-555555555555','Silk Symphony','silk-symphony','Coimbatore','Gandhipuram','Pure silk sarees, direct from the loom.',3,'https://images.unsplash.com/photo-1595991209266-5ff5a3a2f008?auto=format&fit=crop&w=800&q=80','+91 90030 56789','silk.symphony',2012,true,'approved',false,4.8,171,1710,97);

-- ── 4. Products ─────────────────────────────────────────────────────────────
insert into products (id, boutique_id, title, category, price, stock, fabric, color, occasion, image_url, tone, featured, rating, reviews_count) values
  ('c0000001-0000-0000-0000-000000000001','b0000001-0000-0000-0000-000000000001','Rose Zari Silk Saree','Sarees',4899,12,'Kanchipuram Silk','Pink','Wedding','https://images.unsplash.com/photo-1618901185975-d59f7091bcfe?auto=format&fit=crop&w=640&q=80',0,true,4.7,128),
  ('c0000002-0000-0000-0000-000000000002','b0000003-0000-0000-0000-000000000003','Emerald Bridal Lehenga','Lehengas',12999,4,'Velvet','Green','Bridal','https://images.unsplash.com/photo-1746372283841-dbb3838f9935?auto=format&fit=crop&w=640&q=80',3,true,4.9,96),
  ('c0000003-0000-0000-0000-000000000003','b0000002-0000-0000-0000-000000000002','Blush Georgette Gown','Gowns',6499,8,'Georgette','Pink','Reception','https://images.unsplash.com/photo-1679006831648-7c9ea12e5807?auto=format&fit=crop&w=640&q=80',0,false,4.6,74),
  ('c0000004-0000-0000-0000-000000000004','b0000004-0000-0000-0000-000000000004','Mustard Cotton Kurti','Kurtis',1899,24,'Cotton','Yellow','Casual','https://images.unsplash.com/photo-1727430228383-aa1fb59db8bf?auto=format&fit=crop&w=640&q=80',1,false,4.5,203),
  ('c0000005-0000-0000-0000-000000000005','b0000001-0000-0000-0000-000000000001','Lavender Anarkali Gown','Gowns',5299,6,'Net','Purple','Party','https://images.unsplash.com/photo-1617627143750-d86bc21e42bb?auto=format&fit=crop&w=640&q=80',2,false,4.8,61),
  ('c0000006-0000-0000-0000-000000000006','b0000002-0000-0000-0000-000000000002','Maroon Kanjivaram Saree','Sarees',8999,9,'Silk','Red','Festive','https://images.unsplash.com/photo-1610030469983-98e550d6193c?auto=format&fit=crop&w=640&q=80',7,true,4.7,154),
  ('c0000007-0000-0000-0000-000000000007','b0000004-0000-0000-0000-000000000004','Peach Party Lehenga','Lehengas',7499,0,'Organza','Peach','Party','https://images.unsplash.com/photo-1668371679302-a8ec781e876e?auto=format&fit=crop&w=640&q=80',4,false,4.4,47),
  ('c0000008-0000-0000-0000-000000000008','b0000003-0000-0000-0000-000000000003','Teal Silk Kurti Set','Kurtis',2499,15,'Art Silk','Teal','Festive','https://images.unsplash.com/photo-1641699862936-be9f49b1c38d?auto=format&fit=crop&w=640&q=80',3,false,4.6,88);

-- ── 5. Wishlist (Priya) ─────────────────────────────────────────────────────
insert into wishlist (buyer_id, product_id) values
  ('a1111111-1111-1111-1111-1111111111a1','c0000001-0000-0000-0000-000000000001'),
  ('a1111111-1111-1111-1111-1111111111a1','c0000005-0000-0000-0000-000000000005')
on conflict do nothing;

-- ── 6. Orders + items ───────────────────────────────────────────────────────
insert into orders (id, order_number, buyer_id, boutique_id, status, total, created_at) values
  ('01000001-0000-0000-0000-000000000001','AGL-2481','a1111111-1111-1111-1111-1111111111a1','b0000001-0000-0000-0000-000000000001','delivered',4899, now() - interval '3 days'),
  ('01000002-0000-0000-0000-000000000002','AGL-2478','b2222222-2222-2222-2222-2222222222b2','b0000002-0000-0000-0000-000000000002','shipped',8999, now() - interval '4 days'),
  ('01000003-0000-0000-0000-000000000003','AGL-2472','c3333333-3333-3333-3333-3333333333c3','b0000003-0000-0000-0000-000000000003','delivered',4998, now() - interval '6 days'),
  ('01000004-0000-0000-0000-000000000004','AGL-2465','a1111111-1111-1111-1111-1111111111a1','b0000003-0000-0000-0000-000000000003','shipped',12999, now() - interval '2 days'),
  ('01000005-0000-0000-0000-000000000005','AGL-2460','d4444444-4444-4444-4444-4444444444d4','b0000001-0000-0000-0000-000000000001','pending',5299, now() - interval '1 day');

insert into order_items (order_id, product_id, title, price, qty, size, color) values
  ('01000001-0000-0000-0000-000000000001','c0000001-0000-0000-0000-000000000001','Rose Zari Silk Saree',4899,1,'M','Pink'),
  ('01000002-0000-0000-0000-000000000002','c0000006-0000-0000-0000-000000000006','Maroon Kanjivaram Saree',8999,1,'Free','Red'),
  ('01000003-0000-0000-0000-000000000003','c0000008-0000-0000-0000-000000000008','Teal Silk Kurti Set',2499,2,'L','Teal'),
  ('01000004-0000-0000-0000-000000000004','c0000002-0000-0000-0000-000000000002','Emerald Bridal Lehenga',12999,1,'M','Green'),
  ('01000005-0000-0000-0000-000000000005','c0000005-0000-0000-0000-000000000005','Lavender Anarkali Gown',5299,1,'M','Purple');

-- ── 7. Conversations + messages ─────────────────────────────────────────────
insert into conversations (id, buyer_id, boutique_id, created_at) values
  ('c1000001-0000-0000-0000-000000000001','a1111111-1111-1111-1111-1111111111a1','b0000001-0000-0000-0000-000000000001', now() - interval '2 hours'),
  ('c1000002-0000-0000-0000-000000000002','b2222222-2222-2222-2222-2222222222b2','b0000002-0000-0000-0000-000000000002', now() - interval '1 day')
on conflict (buyer_id, boutique_id) do nothing;

insert into messages (conversation_id, sender_id, body, created_at) values
  ('c1000001-0000-0000-0000-000000000001','a1111111-1111-1111-1111-1111111111a1','Hi! Is the Rose Zari Silk Saree still available?', now() - interval '2 hours'),
  ('c1000001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Hello Priya! Yes it is, in blouse sizes S–XL.', now() - interval '118 minutes'),
  ('c1000001-0000-0000-0000-000000000001','a1111111-1111-1111-1111-1111111111a1','Lovely. Can you do a custom blouse?', now() - interval '117 minutes'),
  ('c1000001-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Absolutely. Custom stitching adds ₹450. Shall I reserve it for you?', now() - interval '116 minutes'),
  ('c1000002-0000-0000-0000-000000000002','b2222222-2222-2222-2222-2222222222b2','Please share the price for the maroon saree.', now() - interval '1 day'),
  ('c1000002-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','It''s ₹8,999 with free shipping across Tamil Nadu.', now() - interval '23 hours');

-- ── 8. Notifications (for the Elegance seller) ──────────────────────────────
insert into notifications (profile_id, type, title, body, read, created_at) values
  ('11111111-1111-1111-1111-111111111111','Orders','New order received','Priya Sharma ordered Rose Zari Silk Saree · ₹4,899', false, now() - interval '2 minutes'),
  ('11111111-1111-1111-1111-111111111111','Messages','New message','Priya Sharma: Can you do a custom blouse?', false, now() - interval '40 minutes'),
  ('11111111-1111-1111-1111-111111111111','Updates','Order shipped','Order #AGL-2478 marked as shipped.', true, now() - interval '3 hours'),
  ('11111111-1111-1111-1111-111111111111','Updates','Payment received','₹12,999 credited for order #AGL-2465.', true, now() - interval '5 hours'),
  ('11111111-1111-1111-1111-111111111111','Updates','New review','Neha Verma rated Teal Silk Kurti Set 5 ★.', true, now() - interval '1 day');

-- ── 9. Subscriptions (one per boutique) ─────────────────────────────────────
insert into subscriptions (boutique_id, plan, status, price, renewal_date) values
  ('b0000001-0000-0000-0000-000000000001','featured','active',799, (now() + interval '20 days')::date),
  ('b0000002-0000-0000-0000-000000000002','boutique','active',299, (now() + interval '25 days')::date),
  ('b0000003-0000-0000-0000-000000000003','boutique','active',299, (now() + interval '12 days')::date),
  ('b0000004-0000-0000-0000-000000000004','boutique','due',299, (now() + interval '3 days')::date),
  ('b0000005-0000-0000-0000-000000000005','boutique','active',299, (now() + interval '18 days')::date)
on conflict (boutique_id) do update set
  plan = excluded.plan, status = excluded.status, price = excluded.price, renewal_date = excluded.renewal_date;

-- ── 10. Ads (admin-managed) ─────────────────────────────────────────────────
insert into ads (title, placement, status, impressions, clicks) values
  ('Wedding Season Edit','Home hero · carousel slot 1','live',48200,3100),
  ('Festive Silk Push','Results · top banner','live',31700,2400),
  ('Boutique Spotlight','Boutiques · featured row','draft',0,0),
  ('Monsoon Clearance','Home · mid-page strip','paused',22900,1200);

-- Done. Refresh the app — the buyer catalogue now reads these rows.
