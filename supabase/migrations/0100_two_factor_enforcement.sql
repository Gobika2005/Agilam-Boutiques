-- 0100: require a verified second factor for the entire admin console.
--
-- DO NOT RUN THIS UNTIL EVERY ADMIN AND STAFF ACCOUNT HAS ENROLLED.
-- It will refuse to apply if they have not — see the pre-flight block below,
-- which is the whole reason this is a separate migration from 0099.
--
-- Order of operations:
--   1. apply 0099, deploy the app
--   2. every admin/staff signs in and enrols an authenticator app
--      (console -> Security, or the screen the console now shows them)
--   3. apply this file. It checks step 2 actually happened and stops if not.
--
-- == HOW THIS ENFORCES 2FA ACROSS ~72 POLICY CLAUSES BY CHANGING TWO FUNCTIONS =
--
-- Every console-visible table in this series is gated the same way: a policy
-- that says `is_admin()` or `is_staff()`. There are around seventy such clauses
-- across thirty migrations. Rewriting them one by one would be a large, mostly
-- mechanical diff over the exact surface that has twice taken the site down
-- (0086 blanked the storefront, 0087 fixed it), and every one of those edits
-- would be a fresh chance to make the same mistake.
--
-- So neither the policies nor their names change here. What changes is what the
-- two functions MEAN: an admin is now an admin-who-has-completed-a-challenge.
-- Every policy that already trusts them inherits the requirement at once, and
-- so does every trigger and RPC that guards on them (the role-change guard from
-- 0010/0086, the settlement lockdown in 0072, the coupon writes, all of it).
--
-- The corollary is the risk, stated plainly: this is one statement that
-- switches off the whole console for anyone at aal1. That is exactly why the
-- pre-flight refuses to run without universal enrolment, and why the rollback
-- at the bottom of this file is two `create or replace` statements you can
-- paste into the SQL editor.
--
-- == WHAT IS DELIBERATELY *NOT* CHANGED =======================================
--
-- Buyers and sellers are untouched. `is_admin()` was already false for them, so
-- making it stricter cannot narrow what they can reach — the storefront, the
-- seller console, checkout and the anon browse path do not call either function
-- on their own behalf. (Seller payout and bank details get their own,
-- separate 2FA step in the app; that one is a UI gate on a screen whose data is
-- already owner-scoped by RLS, not a change to these functions.)
--
-- `is_admin()` also keeps its old shape in every other respect. 0086 pointedly
-- declined to "improve" it with the status/deleted_at checks that `is_staff()`
-- carries, on the grounds that it is load-bearing in thirty policies and that
-- was not the migration to change its meaning. Same discipline here: the ONLY
-- new condition is the assurance level.
--
-- == THE ONE WAY THIS SILENTLY UNDOES ITSELF ==================================
--
-- `is_admin()` is originally defined in supabase/schema.sql. Anything that
-- replays that file — notably `supabase db push`, which CLAUDE.md rule 1
-- forbids for exactly this class of reason — restores the old two-line body and
-- turns 2FA enforcement off across the console without a single error message.
-- If you ever suspect that has happened, the check is:
--
--   select prosrc from pg_proc where proname in ('is_admin','is_staff');
--
-- and the fix is to re-run this file, which is idempotent.
--
-- == 1) PRE-FLIGHT — refuse to lock anybody out ===============================

do $$
declare
  v_missing text;
  v_count   int;
begin
  select count(*), string_agg(coalesce(nullif(p.email, ''), p.id::text), ', ' order by p.email)
    into v_count, v_missing
    from profiles p
   where p.role in ('admin', 'staff')
     and coalesce(p.status, 'active') = 'active'
     and p.deleted_at is null
     and not exists (
       select 1 from auth.mfa_factors f
        where f.user_id = p.id and f.status = 'verified'
     );

  if v_count > 0 then
    -- One E-string, not several adjacent literals: only an E'' literal treats
    -- \n as a newline, and a continuation line without its own E prefix would
    -- print a literal backslash-n into the middle of the message.
    raise exception E'0100 not applied: % console account(s) have not enrolled in 2FA yet.\n  %\nApplying now would lock them out of the admin console entirely.\nHave each of them sign in and enrol an authenticator app first, then re-run this file.',
      v_count, v_missing
      using errcode = 'check_violation';
  end if;

  -- The other direction of the same mistake: enforcing 2FA when nobody can
  -- satisfy it. An empty admin table means the profiles rows are not what this
  -- migration thinks they are, and pressing on would leave the console with no
  -- way in at all.
  select count(*) into v_count
    from profiles
   where role = 'admin' and coalesce(status, 'active') = 'active' and deleted_at is null;

  if v_count = 0 then
    raise exception '0100 not applied: no active admin account found. Refusing to lock the console.'
      using errcode = 'check_violation';
  end if;
end $$;

-- == 2) THE CHANGE ============================================================
--
-- The assurance level is read inline rather than through `mfa_verified()`, and
-- that is not stylistic. 0087's lesson is that Postgres checks EXECUTE on every
-- function a policy touches BEFORE it tests a single row, so a helper the
-- caller cannot execute fails the whole read with 42501 instead of returning
-- fewer rows. `is_admin()` is reachable from policies that `anon` evaluates
-- (`profiles: self select` among them) and `mfa_verified()` is revoked from
-- anon. Inlining `current_setting`, which every role may call, removes that
-- entire class of failure from the blast radius.

create or replace function is_admin() returns boolean
language sql stable security definer
set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin')
     and coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal',
           'aal1'
         ) = 'aal2';
$$;

create or replace function is_staff() returns boolean
language sql stable security definer
set search_path = public as $$
  -- Admins are staff for every purpose, so a policy written as `is_staff()`
  -- never has to be written as `is_staff() or is_admin()`. Unlike is_admin(),
  -- this also insists the account is live: a suspended or soft-deleted employee
  -- loses console access the moment the row is updated. Both of those are
  -- 0086's behaviour, carried forward unchanged.
  select exists (
    select 1 from profiles
     where id = auth.uid()
       and role in ('admin', 'staff')
       and coalesce(status, 'active') = 'active'
       and deleted_at is null
  )
  and coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal',
        'aal1'
      ) = 'aal2';
$$;

-- 0086's grants, restated because `create or replace` on a function does not
-- reset them but a future `drop`/`create` would, and because leaving them
-- implicit is how 0087 happened.
revoke all on function is_staff() from public, anon;
grant execute on function is_staff() to authenticated;

-- == 3) ROLLBACK ==============================================================
--
-- If enforcement has to come off in a hurry — a locked-out owner, a bad
-- interaction nobody predicted — paste these two into the Supabase SQL editor.
-- They restore the pre-0100 behaviour exactly and take effect on the next
-- statement; no session needs to be signed out and back in.
--
--   create or replace function is_admin() returns boolean
--   language sql stable security definer set search_path = public as $fn$
--     select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
--   $fn$;
--
--   create or replace function is_staff() returns boolean
--   language sql stable security definer set search_path = public as $fn$
--     select exists (
--       select 1 from profiles
--        where id = auth.uid()
--          and role in ('admin', 'staff')
--          and coalesce(status, 'active') = 'active'
--          and deleted_at is null
--     );
--   $fn$;
--
-- Rolling back leaves 0099 in place and the app's own 2FA screens working, so
-- the console keeps asking for a code — it just stops being the database that
-- insists. Re-run this file to put the teeth back.
