-- Platform expense tracker — what the business itself spends, with proof.
--
-- The console could already see every rupee coming IN (GMV, commission, payouts,
-- refunds) but nothing going OUT: ad spend, salaries, hosting, gateway fees.
-- This adds the other half of the ledger, with the receipt attached to the row
-- so a claim is never just a number somebody typed.
--
-- Additive and idempotent. Run once in the Supabase SQL editor after 0006
-- (is_admin + admin_activity_log).
--
--   • expenses               — one row per spend, admin-only under RLS.
--   • expense-proofs bucket  — PRIVATE storage for the receipts.
--
-- Note the bucket is private, unlike product-images/review-images: an invoice
-- carries vendor names, bank references and amounts, so it is read through
-- short-lived signed URLs (see src/lib/privateUpload.ts) rather than a public
-- URL anyone who ever saw the link can keep.

-- ── Table ───────────────────────────────────────────────────────────────────
create table if not exists expenses (
  id          uuid primary key default gen_random_uuid(),
  -- The date the money actually left, which is rarely the date it was entered.
  spent_on    date not null default current_date,
  -- Free text on purpose, driven by the fixed list in src/data/expenses.ts —
  -- adding a category should not need a migration.
  category    text not null default 'other',
  title       text not null,
  vendor      text not null default '',
  amount      numeric(12,2) not null check (amount > 0),
  payment_method text not null default 'upi',
  reference   text not null default '',
  notes       text not null default '',
  -- Storage paths inside `expense-proofs` (NOT URLs — they are signed on read).
  proofs      text[] not null default '{}',
  created_by  uuid references profiles(id) on delete set null,
  -- Denormalised so the ledger still names who filed it after the admin account
  -- is removed, exactly like admin_activity_log.actor_name.
  created_by_name text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table expenses enable row level security;

-- Company books: admins only, for every operation. No public or seller read.
do $$ begin
  create policy "expenses: admin all" on expenses for all using (is_admin()) with check (is_admin());
exception when duplicate_object then null; end $$;

create index if not exists idx_expenses_spent_on on expenses (spent_on desc);
create index if not exists idx_expenses_category on expenses (category);

-- `updated_at` has to be maintained server-side, or an edit that forgets to set
-- it leaves the row looking untouched.
create or replace function touch_expense_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_expenses_updated_at on expenses;
create trigger trg_expenses_updated_at before update on expenses
  for each row execute function touch_expense_updated_at();

-- ── Proof storage (private) ─────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('expense-proofs', 'expense-proofs', false)
on conflict (id) do update set public = false;

drop policy if exists "expense-proofs: admin read"   on storage.objects;
drop policy if exists "expense-proofs: admin upload" on storage.objects;
drop policy if exists "expense-proofs: admin delete" on storage.objects;

-- public.is_admin() is schema-qualified because these policies are evaluated in
-- the storage schema, where `public` is not on the search_path.
create policy "expense-proofs: admin read" on storage.objects for select
  to authenticated
  using (bucket_id = 'expense-proofs' and public.is_admin());

create policy "expense-proofs: admin upload" on storage.objects for insert
  to authenticated
  with check (bucket_id = 'expense-proofs' and public.is_admin());

create policy "expense-proofs: admin delete" on storage.objects for delete
  to authenticated
  using (bucket_id = 'expense-proofs' and public.is_admin());
