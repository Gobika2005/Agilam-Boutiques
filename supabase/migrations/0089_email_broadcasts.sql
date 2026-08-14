-- ═══════════════════════════════════════════════════════════════════════════════
-- 0089 — Email broadcasts: marketing consent, unsubscribe, and a send log
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- The admin console could already fan a message out to every buyer and seller,
-- but only into the in-app notification bell (`broadcast_notification`, 0048 →
-- 0050 → 0088). This adds the second channel: real email, sent by the
-- `broadcast-email` Edge Function.
--
-- WHY CONSENT NEEDS A TABLE CHANGE AND NOT JUST A FOOTER LINK
-- Order confirmations, payout advices and access-change notices all leave from
-- the same sending domain as a "Diwali sale is live" blast. Marketing mail with
-- no working opt-out collects spam complaints, and a complaint rate high enough
-- to get that domain throttled takes the transactional mail down with it — the
-- buyer stops receiving the receipt for money they already paid. So the opt-out
-- is stored, honoured by the sender, and reachable in one click with no login.
--
-- THE TOKEN IS THE CREDENTIAL
-- An unsubscribe link is opened from a mail client by someone who is not signed
-- in, often on a different device. The same shape as the shortlist links (0077):
-- a random per-profile uuid, no table grants to `anon`, and one SECURITY DEFINER
-- function that takes the token and does exactly one thing. Guessing a v4 uuid
-- is not feasible, and the worst a leaked token can do is stop marketing email
-- to that address — it exposes nothing and changes nothing else.
--
-- TRANSACTIONAL MAIL IGNORES THE FLAG, ON PURPOSE
-- `marketing_opt_out` gates the Announcement / New arrivals / Festival templates.
-- It does NOT gate order, payout, access-change or service-update mail: those are
-- not marketing, and a buyer cannot opt out of being told their order shipped.
-- The Edge Function encodes that split; see MARKETING_TEMPLATES there.
--
-- Requires 0048 (notifications + admin_activity_log) and 0086 (is_staff).
-- Idempotent and re-runnable in the Supabase SQL editor.

-- ── 1) Consent columns on profiles ───────────────────────────────────────────
--
-- Default false = opted IN, which matches how these accounts were collected:
-- everyone here created an account to shop or to sell, and the mail is about the
-- service they signed up for. Opting out is one click and permanent until they
-- choose otherwise.
alter table profiles
  add column if not exists marketing_opt_out boolean not null default false;

alter table profiles
  add column if not exists marketing_opt_out_at timestamptz;

-- gen_random_uuid() is volatile, so this evaluates per row: every existing
-- profile gets its own distinct token in the same statement, no backfill needed.
alter table profiles
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create unique index if not exists profiles_unsubscribe_token_key
  on profiles (unsubscribe_token);

comment on column profiles.marketing_opt_out is
  'True = do not send marketing email (announcements, new arrivals, festival greetings). Never gates transactional mail: orders, payouts, access changes, service updates.';
comment on column profiles.unsubscribe_token is
  'Bearer credential for the one-click unsubscribe link. Never expose it in any query a client can reach — the two RPCs below are the only intended readers.';

-- ── 2) Unsubscribe / resubscribe, by token, without an account ───────────────
--
-- Returns the masked address so the page can say WHICH email it just stopped,
-- without turning a guessed token into an address-harvesting oracle. An unknown
-- token returns not-found rather than raising, so the page shows a calm message
-- instead of a 500.
create or replace function unsubscribe_by_token(p_token uuid)
returns table (ok boolean, masked_email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  update profiles
     set marketing_opt_out = true,
         marketing_opt_out_at = now(),
         updated_at = now()
   where unsubscribe_token = p_token
  returning email into v_email;

  if v_email is null then
    return query select false, null::text;
  else
    -- p••••a@example.com — enough to recognise, not enough to enumerate.
    return query select
      true,
      case
        when position('@' in v_email) > 2
          then left(v_email, 1) || '••••' ||
               substr(v_email, position('@' in v_email) - 1)
        else '••••' || substr(v_email, position('@' in v_email))
      end;
  end if;
end;
$$;

-- The mirror image, for the "unsubscribed by mistake?" link on the same page.
create or replace function resubscribe_by_token(p_token uuid)
returns table (ok boolean, masked_email text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  update profiles
     set marketing_opt_out = false,
         marketing_opt_out_at = null,
         updated_at = now()
   where unsubscribe_token = p_token
  returning email into v_email;

  if v_email is null then
    return query select false, null::text;
  else
    return query select
      true,
      case
        when position('@' in v_email) > 2
          then left(v_email, 1) || '••••' ||
               substr(v_email, position('@' in v_email) - 1)
        else '••••' || substr(v_email, position('@' in v_email))
      end;
  end if;
end;
$$;

-- Anonymous BY DESIGN — the reader is holding a mail client, not a session.
-- These two functions are the entire anon surface this migration opens; no
-- table grant accompanies them, so a token buys nothing else.
grant execute on function unsubscribe_by_token(uuid) to anon, authenticated;
grant execute on function resubscribe_by_token(uuid) to anon, authenticated;

-- ── 3) Send log ──────────────────────────────────────────────────────────────
--
-- Every blast is recorded before the first message leaves, then updated with the
-- result. Three reasons: an email broadcast cannot be recalled, so what was said
-- and to whom has to survive; the console needs a history so nobody sends the
-- same festival greeting twice; and a bounce/complaint spike needs a send to
-- point at.
create table if not exists email_broadcasts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  -- 'selected' is a hand-picked list rather than a whole role: the admin searched
  -- for people by name or address and chose them. Same templates, same consent
  -- rules, different resolution — see recipient_ids below.
  audience text not null check (audience in ('all', 'buyer', 'seller', 'selected')),
  template text not null check (template in ('announcement', 'arrivals', 'festival', 'feature', 'service')),
  subject text not null,
  preheader text,
  heading text,
  body text not null,
  cta_label text,
  cta_url text,
  product_ids uuid[] not null default '{}',
  -- Only populated when audience = 'selected'. Who exactly was mailed matters
  -- more here than for a role blast: a hand-picked send is the one somebody will
  -- later ask "did you email that seller?" about.
  recipient_ids uuid[] not null default '{}',
  -- Recipients resolved at send time vs what the provider actually accepted.
  -- They differ when someone has no address on file or a send fails, and the
  -- gap is the thing worth looking at later.
  recipients integer not null default 0,
  sent integer not null default 0,
  failed integer not null default 0,
  skipped_opt_out integer not null default 0,
  also_notified boolean not null default false,
  status text not null default 'sending' check (status in ('sending', 'sent', 'partial', 'failed')),
  error text
);

create index if not exists email_broadcasts_created_idx on email_broadcasts (created_at desc);

alter table email_broadcasts enable row level security;

-- Admins only, not staff. Staff may send the in-app bell broadcast — that is in
-- their job description (0086 widened `broadcast_notification` to is_staff for
-- exactly that reason) — but email to the entire customer base is a brand-level,
-- unrecallable act, so both the send and its history stop at admin. The Edge
-- Function enforces the same rule with is_admin() on the caller's own JWT.
--
-- ⚠ `to authenticated` is not decoration even with is_admin(). A policy with no
-- TO clause is TO PUBLIC, which attaches it to `anon` as well; Postgres checks
-- EXECUTE on any function a policy calls before it tests a single row, so a
-- helper anon cannot execute fails the whole read 42501 rather than returning
-- nothing. That is what blanked the storefront in 0086; see 0087.
drop policy if exists email_broadcasts_read on email_broadcasts;
create policy email_broadcasts_read on email_broadcasts
  for select to authenticated
  using (is_admin());

-- No insert/update/delete policy on purpose: only the Edge Function writes here,
-- and it holds the service-role key, which bypasses RLS. A console session must
-- not be able to forge or edit a send record.

comment on table email_broadcasts is
  'One row per admin email blast. Written only by the broadcast-email Edge Function (service role). Readable by admins.';

-- ═══════════════════════════════════════════════════════════════════════════════
-- Verify
-- ═══════════════════════════════════════════════════════════════════════════════
--
--   -- 1. Every profile has its own token, and no two share one:
--   select count(*) = count(distinct unsubscribe_token) as tokens_unique,
--          count(*) filter (where unsubscribe_token is null) as nulls
--     from profiles;
--   --    ...expect tokens_unique = true, nulls = 0.
--
--   -- 2. Round-trip the opt-out with a real token (safe on your own row):
--   select * from unsubscribe_by_token(
--     (select unsubscribe_token from profiles where email = 'you@example.com'));
--   --    ...expect ok = true and a masked address. Then check it stuck:
--   select marketing_opt_out, marketing_opt_out_at from profiles
--    where email = 'you@example.com';
--   --    ...and put it back:
--   select * from resubscribe_by_token(
--     (select unsubscribe_token from profiles where email = 'you@example.com'));
--
--   -- 3. A junk token must be a calm miss, not an error:
--   select * from unsubscribe_by_token('00000000-0000-0000-0000-000000000000');
--   --    ...expect ok = false, masked_email = null.
--
--   -- 4. anon must be able to call the RPCs but read nothing:
--   set role anon;
--   select * from unsubscribe_by_token('00000000-0000-0000-0000-000000000000'); -- works
--   select count(*) from email_broadcasts;  -- expect: permission denied / 0 rows
--   reset role;
