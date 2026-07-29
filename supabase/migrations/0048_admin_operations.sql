-- Admin operations — backend for the new admin console sections.
--
-- Fully additive and idempotent: safe to run once in the Supabase SQL editor
-- after 0006 (admin foundation), 0014 (reviews) and 0044 (notification centre).
-- Nothing here drops data or changes existing buyer/seller behaviour.
--
--   • platform_settings        — a single-row, admin-editable settings store
--                                (commission %, delivery/COD fees, hold window…).
--   • reviews.hidden           — admin moderation flag (buyer/seller reads skip it).
--   • reviews admin policies    — admin can read every review and hide/delete abuse.
--   • broadcast_notification()  — SECURITY DEFINER RPC so an admin can fan a
--                                notification out to all buyers/sellers.

-- ── Platform settings (singleton row, id is forced to 1) ────────────────────
create table if not exists platform_settings (
  id                int primary key default 1 check (id = 1),
  commission_pct    numeric(5,2) not null default 10,
  cod_fee           int not null default 49,
  cod_max_order     int not null default 10000,
  free_delivery_over int not null default 2000,
  standard_shipping int not null default 79,
  return_window_days int not null default 7,
  payout_hold_days  int not null default 3,
  maintenance_mode  boolean not null default false,
  support_email     text not null default '',
  updated_at        timestamptz not null default now(),
  updated_by        uuid references profiles(id) on delete set null
);

insert into platform_settings (id) values (1) on conflict (id) do nothing;

alter table platform_settings enable row level security;

-- Commission etc. also appear in the public policy pages, so a public read is
-- harmless and lets the buyer/seller apps consume these later without a policy
-- change. Only admins may write.
do $$ begin
  create policy "settings: public read" on platform_settings for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "settings: admin write" on platform_settings for update using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- ── Reviews: admin moderation ───────────────────────────────────────────────
alter table reviews add column if not exists hidden boolean not null default false;

do $$ begin
  create policy "reviews: admin read" on reviews for select using (is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "reviews: admin update" on reviews for update using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "reviews: admin delete" on reviews for delete using (is_admin());
exception when duplicate_object then null; end $$;

-- ── Broadcast a notification to a whole audience ────────────────────────────
-- SECURITY DEFINER so the insert lands past the per-owner notification policies,
-- but the admin gate means only an admin can fan out, and only the four safe
-- columns are written.
create or replace function broadcast_notification(p_audience text, p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'title and body are required';
  end if;

  -- Type must be one of the values allowed by notifications_type_check
  -- (Orders / Messages / Updates / Wishlist, migration 0044). A broadcast is a
  -- platform Update, which slots straight into the buyer's existing feed.
  insert into notifications (profile_id, type, title, body)
  select p.id, 'Updates', p_title, p_body
  from profiles p
  where p.deleted_at is null
    and (p_audience = 'all' or p.role = p_audience);

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function broadcast_notification(text, text, text) to authenticated;

create index if not exists idx_reviews_hidden on reviews (hidden);
create index if not exists idx_reviews_created_at on reviews (created_at desc);
