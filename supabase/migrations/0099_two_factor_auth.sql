-- 0099: two-factor authentication — foundation. ENFORCES NOTHING.
--
-- Apply this one now. It is safe on a live database: it adds a table, five
-- functions and their grants, and changes no existing policy, function body or
-- row. Nobody's access changes the moment it runs.
--
-- The companion migration 0100 is what actually demands a second factor, and it
-- REFUSES TO APPLY until every console account has enrolled. Run this, enrol,
-- then run that. See the header of 0100.
--
-- == WHY SUPABASE'S NATIVE MFA AND NOT AN EMAILED CODE ========================
--
-- The obvious build — email a 6-digit code, check it in React, set a flag — is
-- security theatre in this app, and it is worth writing down why so nobody
-- "simplifies" to it later.
--
-- Rule 7 of CLAUDE.md: RLS is the security boundary. The browser holds a real
-- Supabase JWT; anything the React app can read, a stolen password can read by
-- calling PostgREST directly with that token and never loading our JavaScript
-- at all. A second factor checked in React is a padlock on a door with no wall
-- beside it — it gates the UI, not the data.
--
-- Supabase's own TOTP factor is different in exactly one way that matters: on a
-- successful challenge GoTrue re-mints the JWT with `aal: "aal2"`. That claim
-- reaches Postgres in `request.jwt.claims`, which means a POLICY can test it.
-- That is the whole difference between 2FA and the appearance of 2FA, and it is
-- why the second factor here is TOTP (an authenticator app) rather than an
-- email or SMS code. It also costs nothing to run: no SMS provider, no Edge
-- Function on the hot path, and no new `api/` route — which is just as well,
-- because `api/` is at the 12/12 Vercel Hobby function ceiling.
--
-- == WHY BACKUP CODES CLEAR THE FACTOR INSTEAD OF LOGGING YOU IN ==============
--
-- Supabase has no native backup codes, and we cannot invent them: only GoTrue
-- can mint an aal2 JWT, and it will only do that for a real TOTP challenge. A
-- backup code that "logs you in" would therefore have to be honoured by us, in
-- React, at aal1 — the exact theatre described above.
--
-- So a backup code here does the one thing it honestly can: it proves you are
-- the owner well enough to REMOVE the lost factor, after which you enrol a new
-- authenticator and challenge normally. Redeeming one is a service-role
-- operation (deleting a factor needs the Admin API), so it lives in the
-- `mfa-recovery` Edge Function and reaches this file through
-- `mfa_backup_code_consume`, which no browser can call.
--
-- == THE TABLE ================================================================

create extension if not exists pgcrypto;

create table if not exists mfa_backup_codes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- sha256 of the code, uppercased with separators stripped. Never the code
  -- itself: this table is a list of things that bypass 2FA, and it has to be
  -- worthless to anyone who manages to read it.
  code_hash  text not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists mfa_backup_codes_user_idx
  on mfa_backup_codes (user_id) where used_at is null;

-- Scoped to the user, not global. A global unique index would be a slightly
-- tighter constraint and a real failure mode: two accounts drawing the same
-- 64-bit code is astronomically unlikely, but if it ever happened the second
-- one's enrolment would fail with a constraint error at the worst moment. The
-- double-spend it might have guarded is already handled properly, by the
-- `for update skip locked` in mfa_backup_code_consume.
create unique index if not exists mfa_backup_codes_user_hash_key
  on mfa_backup_codes (user_id, code_hash);

alter table mfa_backup_codes enable row level security;

-- Deliberately NO policy and NO grant. Not even to the owner of the row.
--
-- RLS with no permissive policy denies everything, which is the intent: there
-- is no legitimate reason for a browser to SELECT this table. A user needs
-- exactly two facts about it — how many codes are left, and (once) what they
-- are — and both come from the SECURITY DEFINER functions below. Redemption
-- never happens in a browser at all.
--
-- The explicit revoke matters as much as the missing grant: a future
-- `grant ... on all tables in schema public` would otherwise hand this table
-- to `authenticated` without anyone noticing.
revoke all on table mfa_backup_codes from public, anon, authenticated;

-- == HELPERS ==================================================================

-- The assurance level of the caller's session: 'aal1' = password only,
-- 'aal2' = password plus a verified TOTP challenge.
--
-- Absent for anything with no JWT — service_role, pg_cron, a psql session —
-- which coalesces to 'aal1'. That is the safe direction: those callers either
-- bypass RLS entirely (service_role) or have no auth.uid() to match anything
-- (cron), so this never becomes the thing standing between a background job and
-- its work.
create or replace function mfa_aal() returns text
language sql stable
set search_path = public as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', 'aal1');
$$;

create or replace function mfa_verified() returns boolean
language sql stable
set search_path = public as $$
  select mfa_aal() = 'aal2';
$$;

grant execute on function mfa_aal() to authenticated;
grant execute on function mfa_verified() to authenticated;
-- Not to anon. An anonymous caller has no session to have secured — and 0087 is
-- the standing lesson about what a policy calling an anon-forbidden function
-- does to a page: it fails the entire read 42501 rather than returning less.
-- Neither of these is reachable from an anon-facing policy; keep it that way.

-- Hashing lives in one place so the generator and the consumer cannot drift.
-- `extensions` is on the search_path because Supabase installs pgcrypto there,
-- while a locally created one lands in `public` — naming both resolves either.
create or replace function mfa_hash_code(p_code text) returns text
language sql immutable
set search_path = public, extensions as $$
  select encode(
    digest(upper(regexp_replace(coalesce(p_code, ''), '[^0-9A-Za-z]', '', 'g')), 'sha256'),
    'hex');
$$;

revoke all on function mfa_hash_code(text) from public, anon, authenticated;

-- == ISSUING CODES ============================================================

-- Replaces the caller's whole set with ten fresh codes and returns them in
-- clear text — the only moment they exist in readable form anywhere.
--
-- Requires aal2, so you can only mint bypass codes for a factor you have just
-- proved you hold. Without that check a stolen password could quietly issue
-- itself a permanent set of skeleton keys before the owner ever enrolled.
create or replace function mfa_backup_codes_generate() returns text[]
language plpgsql security definer
set search_path = public as $$
declare
  v_codes text[] := '{}';
  v_code  text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = 'insufficient_privilege';
  end if;
  if not mfa_verified() then
    raise exception 'Verify your authenticator app before generating backup codes.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Issuing a new set invalidates the old one, used or not. That is the point:
  -- "regenerate" has to mean the codes on the paper in the drawer stop working.
  delete from mfa_backup_codes where user_id = auth.uid();

  for i in 1..10 loop
    -- 16 hex characters, i.e. 64 bits. Not gen_random_bytes: that lives in the
    -- `extensions` schema on Supabase and would not resolve under this
    -- search_path (the same reasoning as 0077b's board tokens).
    --
    -- The length is a security parameter, not cosmetics. These hashes are
    -- unsalted sha256, so a short code would be an offline brute-force in
    -- seconds if the table ever leaked. 64 bits is not.
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
    insert into mfa_backup_codes (user_id, code_hash) values (auth.uid(), mfa_hash_code(v_code));
    -- Grouped for a human transcribing it under stress: XXXX-XXXX-XXXX-XXXX.
    v_codes := v_codes || regexp_replace(v_code, '(.{4})(?=.)', '\1-', 'g');
  end loop;

  return v_codes;
end $$;

grant execute on function mfa_backup_codes_generate() to authenticated;

-- How many unused codes remain, for the "3 of 10 left" line in Security
-- settings. Deliberately the only readable fact about the table.
create or replace function mfa_backup_codes_remaining() returns integer
language sql security definer stable
set search_path = public as $$
  select count(*)::int from mfa_backup_codes where user_id = auth.uid() and used_at is null;
$$;

grant execute on function mfa_backup_codes_remaining() to authenticated;

-- == REDEEMING A CODE =========================================================

-- Spends one code for a named user and reports whether it was valid. Called by
-- the `mfa-recovery` Edge Function, which then deletes that user's TOTP factors
-- through the Admin API; the user enrols a new authenticator on the next screen.
--
-- NOT granted to `authenticated`, and it takes p_user rather than reading
-- auth.uid() — the caller is service_role acting for somebody who, by
-- definition, cannot complete a challenge right now. Those two facts together
-- are exactly why it must never reach a browser: it would be an oracle for
-- spending other people's codes.
create or replace function mfa_backup_code_consume(p_user uuid, p_code text) returns boolean
language plpgsql security definer
set search_path = public as $$
declare
  v_id uuid;
begin
  -- `for update skip locked` so two concurrent redemptions of the same code
  -- cannot both succeed; the loser sees no row and is told the code is invalid.
  select id into v_id
    from mfa_backup_codes
   where user_id = p_user and used_at is null and code_hash = mfa_hash_code(p_code)
   for update skip locked
   limit 1;

  if v_id is null then return false; end if;

  update mfa_backup_codes set used_at = now() where id = v_id;
  return true;
end $$;

revoke all on function mfa_backup_code_consume(uuid, text) from public, anon, authenticated;

-- == WHO HAS ENROLLED =========================================================

-- `auth.mfa_factors` is not readable from the browser, so the admin Users page
-- and migration 0100's pre-flight check both need this narrow view of it.
--
-- Returns only whether a verified factor exists and when it was verified. No
-- secrets, no factor ids — nothing that helps an attacker, and nothing a
-- support screen needs beyond "enrolled / not enrolled".
create or replace function mfa_enrollment_status()
returns table (user_id uuid, verified_at timestamptz)
language sql security definer stable
set search_path = public as $$
  select f.user_id, min(f.updated_at)
    from auth.mfa_factors f
   where f.status = 'verified'
   group by f.user_id
$$;

revoke all on function mfa_enrollment_status() from public, anon, authenticated;
-- Granted to every signed-in account rather than guarded with is_admin(), and
-- that is deliberate: 0100 makes is_admin() itself require aal2, so an admin
-- who is locked out at aal1 must still be able to load the screen that fixes a
-- colleague. What it returns is a list of user ids that have 2FA on, which is
-- not a secret worth a lockout risk — but that is the reasoning, so re-read it
-- before adding anything to the return type.
grant execute on function mfa_enrollment_status() to authenticated;

-- == AUDIT ====================================================================
--
-- Recovery is the interesting event: it is the one path that removes a second
-- factor. `admin_activity_log` (0006) already exists and the admin Audit screen
-- already renders it, so recovery writes there rather than growing a second
-- trail. The Edge Function inserts with the service role, so there is nothing
-- to add here beyond saying where to look.
