-- Seller ads — the self-serve advertising product.
--
-- Monetization is commission + ads only. The commission side is fully built
-- (orders → payouts, 0025/0026); the ads side was a placeholder `ads` table with
-- no seller flow, no payment, no buyer rendering and no automation. This
-- migration replaces it with a real, automated ad product:
--
--   • A seller buys a placement (a slot on the buyer app) for N days at a flat
--     daily rate, and pays online through the same Razorpay path as checkout.
--   • The purchase is priced by the SERVER from `ad_placements` — never a figure
--     the browser sends — exactly like create-order/place-order.
--   • After one admin approval the ad goes live on its start date, rotates on the
--     buyer app, counts impressions/clicks, and expires on its end date. A daily
--     cron (`expire_and_activate_ads`) keeps the status column honest.
--
-- The money model: ad spend is platform ad revenue and does NOT flow through the
-- seller payout ledger — it is the seller paying the platform, not the reverse.
--
-- Idempotent: re-runnable in the Supabase SQL editor. Requires 0006 (is_admin,
-- profiles), 0021 (boutiques.owner_id/status) and the base products table.

-- ── Retire the placeholder ──────────────────────────────────────────────────
-- The old `ads` table (title/placement/status/impressions/clicks, no migration
-- of its own) was never wired to a seller, a payment or the buyer app. Nothing
-- real depends on it, so it is dropped in favour of the schema below.
drop table if exists ads cascade;

-- ── Rate card / sellable inventory (admin-managed) ──────────────────────────
-- One row per placement the marketplace sells. `daily_rate` is the flat price a
-- seller pays per day; `max_active` is how many campaigns may serve that slot at
-- once (its scarcity). Admin edits these on /admin/ads; the price a seller is
-- charged is always read from here server-side.
create table if not exists ad_placements (
  code text primary key,                 -- 'sponsored_card' | 'home_hero' | 'boutique_promo'
  name text not null,
  description text not null default '',
  daily_rate numeric(10,2) not null default 0,
  max_active int not null default 1,
  active boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

-- Seed the three placements from the plan. `on conflict do nothing` so a re-run
-- never overwrites rates an admin has since edited.
insert into ad_placements (code, name, description, daily_rate, max_active, sort) values
  ('sponsored_card', 'Sponsored product', 'Your product shown at the top of Home rails and search results, labelled “Sponsored”.', 149, 8, 1),
  ('home_hero',      'Home hero banner',  'A rotating full-width hero slide on the buyer home screen — the most visible slot.', 499, 3, 2),
  ('boutique_promo', 'Boutique promotion','Your boutique boosted to the top of the Boutiques page with a “Promoted” tag.', 199, 6, 3)
on conflict (code) do nothing;

alter table ad_placements enable row level security;

-- Anyone may read the rate card (the seller's Promote screen shows live prices);
-- only an admin may change it.
do $$ begin
  create policy "ad_placements: public read" on ad_placements for select using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "ad_placements: admin write" on ad_placements for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- ── Campaigns (one seller purchase) ─────────────────────────────────────────
create table if not exists ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  boutique_id uuid not null references boutiques(id) on delete cascade,
  placement_code text not null references ad_placements(code),

  -- What is being promoted. boutique_promo has no product.
  subject_type text not null default 'product',        -- 'product' | 'boutique'
  product_id uuid references products(id) on delete cascade,

  -- Creative. Product/boutique promos default these from the subject; the hero
  -- slide is authored here.
  headline text not null default '',
  subtext text not null default '',
  image_url text not null default '',
  cta_label text not null default '',

  -- Lifecycle. See the guard trigger below for who may move this.
  status text not null default 'pending_payment',
  --  pending_payment  draft, seller still to pay
  --  pending_review   paid, awaiting admin approval
  --  scheduled        approved, start_date still in the future
  --  live             approved and currently serving
  --  paused           admin-paused (does not serve)
  --  rejected         admin rejected (pre-refund)
  --  refunded         rejected and money returned
  --  expired          past its end_date

  -- Schedule + price (snapshotted at activation so a later rate change never
  -- rewrites what a seller already paid — same principle as payouts in 0025).
  start_date date,
  end_date date,
  days int not null default 1,
  daily_rate_snapshot numeric(10,2) not null default 0,
  amount numeric(10,2) not null default 0,             -- total charged (rupees)

  -- Payment (Razorpay). payment_id is unique → structural replay guard.
  payment_order_id text,
  payment_id text unique,
  paid_at timestamptz,

  -- Review trail.
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  reject_reason text,

  -- Engagement counters (maintained only by the privileged RPCs below).
  impressions int not null default 0,
  clicks int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint ad_campaigns_status_check check (status in (
    'pending_payment','pending_review','scheduled','live','paused','rejected','refunded','expired'
  )),
  constraint ad_campaigns_subject_check check (subject_type in ('product','boutique')),
  constraint ad_campaigns_days_check check (days >= 1 and days <= 90)
);

create index if not exists idx_ad_campaigns_boutique on ad_campaigns (boutique_id, created_at desc);
create index if not exists idx_ad_campaigns_status on ad_campaigns (status);
-- The buyer-side "what is serving right now" query: placement + status + window.
create index if not exists idx_ad_campaigns_serving on ad_campaigns (placement_code, status, start_date, end_date);

alter table ad_campaigns enable row level security;

-- Admin sees and does everything.
do $$ begin
  create policy "ad_campaigns: admin all" on ad_campaigns for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

-- A seller reads/creates/edits only their own boutique's campaigns. What they may
-- actually change is narrowed by the guard trigger (they can edit a draft, never
-- approve it or touch payment/counters). Deleting is allowed only while unpaid.
do $$ begin
  create policy "ad_campaigns: seller read own" on ad_campaigns for select using (
    exists (select 1 from boutiques b where b.id = ad_campaigns.boutique_id and b.owner_id = auth.uid())
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "ad_campaigns: seller insert own" on ad_campaigns for insert with check (
    exists (select 1 from boutiques b where b.id = ad_campaigns.boutique_id and b.owner_id = auth.uid())
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "ad_campaigns: seller update own" on ad_campaigns for update using (
    exists (select 1 from boutiques b where b.id = ad_campaigns.boutique_id and b.owner_id = auth.uid())
  );
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "ad_campaigns: seller delete draft" on ad_campaigns for delete using (
    status = 'pending_payment'
    and exists (select 1 from boutiques b where b.id = ad_campaigns.boutique_id and b.owner_id = auth.uid())
  );
exception when duplicate_object then null; end $$;

-- Buyers browse without an account, so anon/authenticated may read only the rows
-- that are actually serving this instant. This single policy is the whole of the
-- buyer-side visibility rule — a paused, scheduled or expired ad is invisible.
do $$ begin
  create policy "ad_campaigns: public read serving" on ad_campaigns for select using (
    status = 'live' and current_date between start_date and end_date
  );
exception when duplicate_object then null; end $$;

-- ── Privileged-write flag ───────────────────────────────────────────────────
-- Same shape as 0031's engagement flag, on its own key. The SECURITY DEFINER
-- functions below flip it around their writes; a plain seller UPDATE never does,
-- so the guard trigger reverts any protected column they try to set.
create or replace function ad_privileged_begin() returns void
language sql security definer set search_path = public
as $$ select set_config('agilam.ad_privileged', 'on', true) $$;

create or replace function ad_privileged_end() returns void
language sql security definer set search_path = public
as $$ select set_config('agilam.ad_privileged', 'off', true) $$;

revoke execute on function ad_privileged_begin() from public, anon, authenticated;
revoke execute on function ad_privileged_end() from public, anon, authenticated;

-- ── Guard · which columns a seller may move ─────────────────────────────────
-- Without this, a seller who owns the row (and so passes the RLS update policy)
-- could set status='live', zero the price, or inflate impressions with a plain
-- UPDATE. When the privileged flag is off:
--   • INSERT is forced to a clean draft (no self-granted status/payment/counters).
--   • a draft may have its creative/schedule edited, but never its protected columns.
--   • once paid (status ≠ pending_payment) the row is fully locked to the seller.
create or replace function ad_campaigns_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('agilam.ad_privileged', true), 'off') = 'on' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending_payment';
    new.impressions := 0;
    new.clicks := 0;
    new.amount := 0;
    new.daily_rate_snapshot := 0;
    new.payment_order_id := null;
    new.payment_id := null;
    new.paid_at := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    new.reject_reason := null;
    return new;
  end if;

  -- UPDATE. A paid campaign is untouchable by the seller.
  if old.status <> 'pending_payment' then
    return old;
  end if;

  -- Draft edit: keep every protected column at its stored value; the seller only
  -- gets to change placement/subject/creative/days/start_date.
  new.status := old.status;
  new.impressions := old.impressions;
  new.clicks := old.clicks;
  new.amount := old.amount;
  new.daily_rate_snapshot := old.daily_rate_snapshot;
  new.payment_order_id := old.payment_order_id;
  new.payment_id := old.payment_id;
  new.paid_at := old.paid_at;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  new.reject_reason := old.reject_reason;
  new.end_date := old.end_date;          -- derived at activation, not seller-set
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists ad_campaigns_guard on ad_campaigns;
create trigger ad_campaigns_guard
  before insert or update on ad_campaigns
  for each row execute function ad_campaigns_guard();

-- ── Settle a paid ad (called by the server after a verified payment) ────────
-- The activate-ad serverless function verifies the Razorpay signature, binds the
-- amount and captures the payment, then calls this to move the campaign to
-- pending_review with its price/schedule snapshotted. Guarded by status so a
-- replayed call is a harmless no-op (the unique payment_id backs this up too).
create or replace function activate_ad_campaign(
  p_id uuid,
  p_order_id text,
  p_payment_id text,
  p_rate numeric,
  p_days int,
  p_start date
) returns ad_campaigns
language plpgsql security definer set search_path = public
as $$
declare v_row ad_campaigns;
begin
  perform ad_privileged_begin();
  update ad_campaigns set
    status = 'pending_review',
    payment_order_id = p_order_id,
    payment_id = p_payment_id,
    paid_at = now(),
    daily_rate_snapshot = p_rate,
    days = p_days,
    amount = round(p_rate * p_days, 2),
    start_date = p_start,
    end_date = p_start + (p_days - 1),
    updated_at = now()
  where id = p_id and status = 'pending_payment'
  returning * into v_row;
  perform ad_privileged_end();

  if v_row.id is null then
    raise exception 'activate_ad_campaign: campaign % is not an unpaid draft', p_id;
  end if;
  return v_row;
end $$;

-- ── Stamp a draft with its Razorpay order id (before checkout opens) ────────
-- Lets the webhook backstop below find the right draft if the browser dies after
-- capture but before activate-ad runs. Called by create-ad-order (service role).
create or replace function set_ad_order_ref(p_id uuid, p_order_id text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform ad_privileged_begin();
  update ad_campaigns set payment_order_id = p_order_id, updated_at = now()
   where id = p_id and status = 'pending_payment';
  perform ad_privileged_end();
end $$;

-- ── Webhook backstop · settle a paid draft the browser never confirmed ──────
-- Mirrors activate_ad_campaign, but keyed on the Razorpay order id (which the
-- webhook carries) rather than passed-in figures: it reads the draft's own
-- days/start_date and the live placement rate. Idempotent — a draft already
-- moved on is skipped.
create or replace function reconcile_ad_campaign(p_order_id text, p_payment_id text) returns ad_campaigns
language plpgsql security definer set search_path = public
as $$
declare
  v_row ad_campaigns;
  v_rate numeric;
begin
  select * into v_row from ad_campaigns
   where payment_order_id = p_order_id and status = 'pending_payment' limit 1;
  if v_row.id is null then
    return null;   -- no unpaid draft for this order (already settled, or unknown)
  end if;

  select daily_rate into v_rate from ad_placements where code = v_row.placement_code;
  return activate_ad_campaign(
    v_row.id, p_order_id, p_payment_id,
    coalesce(v_rate, 0), v_row.days, coalesce(v_row.start_date, current_date)
  );
end $$;

-- ── Admin: approve ──────────────────────────────────────────────────────────
-- Approval decides the go-live state from the schedule: serve now if the start
-- date has arrived, otherwise wait for the cron to flip it on the day.
create or replace function admin_approve_ad(p_id uuid) returns ad_campaigns
language plpgsql security definer set search_path = public
as $$
declare v_row ad_campaigns;
begin
  if not is_admin() then raise exception 'ads: admin only'; end if;
  perform ad_privileged_begin();
  update ad_campaigns set
    status = case when start_date <= current_date then 'live' else 'scheduled' end,
    reviewed_by = auth.uid(),
    reviewed_at = now(),
    reject_reason = null,
    updated_at = now()
  where id = p_id and status in ('pending_review','paused')
  returning * into v_row;
  perform ad_privileged_end();
  if v_row.id is null then raise exception 'ads: nothing to approve for %', p_id; end if;
  return v_row;
end $$;

-- ── Admin: pause / resume a live campaign ───────────────────────────────────
create or replace function admin_pause_ad(p_id uuid) returns ad_campaigns
language plpgsql security definer set search_path = public
as $$
declare v_row ad_campaigns;
begin
  if not is_admin() then raise exception 'ads: admin only'; end if;
  perform ad_privileged_begin();
  update ad_campaigns set status = 'paused', updated_at = now()
  where id = p_id and status in ('live','scheduled')
  returning * into v_row;
  perform ad_privileged_end();
  if v_row.id is null then raise exception 'ads: nothing to pause for %', p_id; end if;
  return v_row;
end $$;

-- ── Mark a rejected/refunded ad (server calls this after the Razorpay refund) ─
-- Used by both the admin reject path (money returned) and any manual refund. The
-- refund itself happens in the serverless function; this only records the state.
create or replace function mark_ad_refunded(p_id uuid, p_reason text default null) returns ad_campaigns
language plpgsql security definer set search_path = public
as $$
declare v_row ad_campaigns;
begin
  perform ad_privileged_begin();
  update ad_campaigns set
    status = 'refunded',
    reject_reason = nullif(btrim(coalesce(p_reason, '')), ''),
    reviewed_at = coalesce(reviewed_at, now()),
    updated_at = now()
  where id = p_id
  returning * into v_row;
  perform ad_privileged_end();
  if v_row.id is null then raise exception 'ads: campaign % not found', p_id; end if;
  return v_row;
end $$;

-- ── Daily lifecycle · activate what has started, expire what has ended ──────
-- Buyers already only SEE serving rows (the public RLS policy), but the status
-- column is what the seller/admin consoles read and what frees a placement's
-- max_active slot. The cron endpoint calls this once a day.
create or replace function expire_and_activate_ads() returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform ad_privileged_begin();
  update ad_campaigns set status = 'live', updated_at = now()
    where status = 'scheduled' and start_date <= current_date and end_date >= current_date;
  update ad_campaigns set status = 'expired', updated_at = now()
    where status in ('live','scheduled') and end_date < current_date;
  perform ad_privileged_end();
end $$;

-- ── Impression / click tracking (buyers browse anonymously) ─────────────────
-- Like the product view/share RPCs in 0031: SECURITY DEFINER so an anon buyer
-- can bump the counter, and only ever on a currently-serving campaign, so a
-- paused/expired id can't be spammed. The client throttles to once per session.
create or replace function record_ad_impression(p_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform ad_privileged_begin();
  update ad_campaigns set impressions = impressions + 1
   where id = p_id and status = 'live' and current_date between start_date and end_date;
  perform ad_privileged_end();
end $$;

create or replace function record_ad_click(p_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform ad_privileged_begin();
  update ad_campaigns set clicks = clicks + 1
   where id = p_id and status = 'live' and current_date between start_date and end_date;
  perform ad_privileged_end();
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Buyer tracking is open to anon; the admin/server functions are locked down.
grant execute on function record_ad_impression(uuid) to anon, authenticated;
grant execute on function record_ad_click(uuid)      to anon, authenticated;

revoke execute on function activate_ad_campaign(uuid, text, text, numeric, int, date) from public, anon, authenticated;
revoke execute on function set_ad_order_ref(uuid, text) from public, anon, authenticated;
revoke execute on function reconcile_ad_campaign(text, text) from public, anon, authenticated;
revoke execute on function mark_ad_refunded(uuid, text) from public, anon, authenticated;
revoke execute on function expire_and_activate_ads() from public, anon, authenticated;
grant execute on function activate_ad_campaign(uuid, text, text, numeric, int, date) to service_role;
grant execute on function set_ad_order_ref(uuid, text) to service_role;
grant execute on function reconcile_ad_campaign(text, text) to service_role;
grant execute on function mark_ad_refunded(uuid, text) to service_role;
grant execute on function expire_and_activate_ads() to service_role;

-- admin_* run under is_admin() and are called with the admin's own JWT.
grant execute on function admin_approve_ad(uuid) to authenticated;
grant execute on function admin_pause_ad(uuid)   to authenticated;
