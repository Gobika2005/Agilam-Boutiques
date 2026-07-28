-- MangaiMart schema
-- Run this once against a fresh Supabase project (SQL editor -> New query -> paste -> Run).

create extension if not exists "pgcrypto";

-- ── Profiles ────────────────────────────────────────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('buyer','seller','admin')) default 'buyer',
  full_name text not null default '',
  phone text,
  email text,
  city text,
  created_at timestamptz not null default now()
);

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

alter table profiles enable row level security;

create policy "profiles: self select" on profiles for select
  using (id = auth.uid() or is_admin());
create policy "profiles: self insert" on profiles for insert
  with check (id = auth.uid());
create policy "profiles: self update" on profiles for update
  using (id = auth.uid() or is_admin());

-- ── Boutiques ───────────────────────────────────────────────────────────
create table if not exists boutiques (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  slug text unique,
  city text not null default '',
  area text not null default '',
  description text not null default '',
  tone int not null default 0,
  cover_url text,
  phone text,
  instagram text,
  established_year int,
  verified boolean not null default false,
  status text not null check (status in ('pending','approved','rejected')) default 'pending',
  featured boolean not null default false,
  rating numeric(2,1) not null default 0,
  reviews_count int not null default 0,
  followers_count int not null default 0,
  positive_rating int not null default 0 check (positive_rating between 0 and 100),
  created_at timestamptz not null default now()
);

alter table boutiques enable row level security;

create policy "boutiques: public read approved" on boutiques for select
  using (status = 'approved' or owner_id = auth.uid() or is_admin());
create policy "boutiques: owner insert" on boutiques for insert
  with check (owner_id = auth.uid());
create policy "boutiques: owner or admin update" on boutiques for update
  using (owner_id = auth.uid() or is_admin());

-- ── Products ────────────────────────────────────────────────────────────
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  boutique_id uuid not null references boutiques(id) on delete cascade,
  title text not null,
  category text not null default '',
  price numeric(10,2) not null default 0,
  stock int not null default 0,
  fabric text default '',
  color text default '',
  occasion text default '',
  image_url text,
  tone int not null default 0,
  featured boolean not null default false,
  rating numeric(2,1) not null default 0,
  reviews_count int not null default 0,
  created_at timestamptz not null default now()
);

alter table products enable row level security;

create policy "products: public read from approved boutiques" on products for select
  using (
    exists (select 1 from boutiques b where b.id = boutique_id and b.status = 'approved')
    or exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid())
    or is_admin()
  );
create policy "products: owner insert" on products for insert
  with check (exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid()));
create policy "products: owner or admin update" on products for update
  using (exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid()) or is_admin());
create policy "products: owner or admin delete" on products for delete
  using (exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid()) or is_admin());

-- ── Wishlist ────────────────────────────────────────────────────────────
create table if not exists wishlist (
  buyer_id uuid not null references profiles(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (buyer_id, product_id)
);

alter table wishlist enable row level security;

create policy "wishlist: owner manage" on wishlist for all
  using (buyer_id = auth.uid()) with check (buyer_id = auth.uid());

-- ── Orders ──────────────────────────────────────────────────────────────
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  buyer_id uuid not null references profiles(id),
  boutique_id uuid not null references boutiques(id),
  status text not null check (status in ('pending','shipped','delivered','rejected')) default 'pending',
  total numeric(10,2) not null default 0,
  created_at timestamptz not null default now()
);

alter table orders enable row level security;

create policy "orders: buyer or seller or admin read" on orders for select
  using (
    buyer_id = auth.uid()
    or exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid())
    or is_admin()
  );
create policy "orders: buyer insert" on orders for insert
  with check (buyer_id = auth.uid());
create policy "orders: seller or admin update" on orders for update
  using (exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid()) or is_admin());

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id),
  title text not null,
  price numeric(10,2) not null default 0,
  qty int not null default 1,
  size text,
  color text
);

alter table order_items enable row level security;

create policy "order_items: via order access" on order_items for select
  using (exists (
    select 1 from orders o where o.id = order_id and (
      o.buyer_id = auth.uid()
      or exists (select 1 from boutiques b where b.id = o.boutique_id and b.owner_id = auth.uid())
      or is_admin()
    )
  ));
create policy "order_items: buyer insert with own order" on order_items for insert
  with check (exists (select 1 from orders o where o.id = order_id and o.buyer_id = auth.uid()));

-- ── Conversations & messages ───────────────────────────────────────────
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references profiles(id) on delete cascade,
  boutique_id uuid not null references boutiques(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (buyer_id, boutique_id)
);

alter table conversations enable row level security;

create policy "conversations: participants read" on conversations for select
  using (
    buyer_id = auth.uid()
    or exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid())
    or is_admin()
  );
create policy "conversations: buyer create" on conversations for insert
  with check (buyer_id = auth.uid());

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

alter table messages enable row level security;

create policy "messages: participants read" on messages for select
  using (exists (
    select 1 from conversations c where c.id = conversation_id and (
      c.buyer_id = auth.uid()
      or exists (select 1 from boutiques b where b.id = c.boutique_id and b.owner_id = auth.uid())
      or is_admin()
    )
  ));
create policy "messages: participants send" on messages for insert
  with check (exists (
    select 1 from conversations c where c.id = conversation_id and (
      c.buyer_id = auth.uid()
      or exists (select 1 from boutiques b where b.id = c.boutique_id and b.owner_id = auth.uid())
    )
  ) and sender_id = auth.uid());

-- A seller may read the profile of any buyer they share a conversation with,
-- so the Messages inbox shows the buyer's real name instead of "Customer".
-- (Declared here because it references conversations/boutiques, defined above.)
create policy "profiles: seller reads chat buyers" on profiles for select
  using (
    exists (
      select 1 from conversations c
      join boutiques b on b.id = c.boutique_id
      where c.buyer_id = profiles.id and b.owner_id = auth.uid()
    )
  );

-- ── Notifications ──────────────────────────────────────────────────────
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  type text not null default 'Updates',
  title text not null,
  body text not null default '',
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table notifications enable row level security;

create policy "notifications: owner read" on notifications for select
  using (profile_id = auth.uid() or is_admin());
create policy "notifications: owner update" on notifications for update
  using (profile_id = auth.uid());

-- ── Subscriptions (boutique billing plan) ─────────────────────────────
create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  boutique_id uuid not null unique references boutiques(id) on delete cascade,
  plan text not null check (plan in ('boutique','featured')) default 'boutique',
  status text not null check (status in ('active','due','expired')) default 'active',
  price numeric(10,2) not null default 299,
  renewal_date date,
  created_at timestamptz not null default now()
);

alter table subscriptions enable row level security;

create policy "subscriptions: owner or admin read" on subscriptions for select
  using (exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid()) or is_admin());
create policy "subscriptions: admin manage" on subscriptions for all
  using (is_admin()) with check (is_admin());

-- ── Ads (admin-managed campaigns) ─────────────────────────────────────
create table if not exists ads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  placement text not null default '',
  status text not null check (status in ('live','paused','draft')) default 'draft',
  impressions int not null default 0,
  clicks int not null default 0,
  created_at timestamptz not null default now()
);

alter table ads enable row level security;

create policy "ads: public read live" on ads for select using (status = 'live' or is_admin());
create policy "ads: admin manage" on ads for all using (is_admin()) with check (is_admin());

-- ── Realtime ────────────────────────────────────────────────────────────
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table notifications;
