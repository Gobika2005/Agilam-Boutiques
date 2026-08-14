-- Restore two functions 0086 reverted by accident.
--
-- ══ THE MISTAKE ══════════════════════════════════════════════════════════════
--
-- 0086 needed six existing functions to accept staff as well as admins. It did
-- that by re-issuing each one with `create or replace function` and the gate
-- widened — the right technique. What it got wrong was WHERE it copied each body
-- from: it went to the migration that INTRODUCED the function rather than the
-- latest one that touched it.
--
-- `create or replace function` replaces the whole body. Copying an old body
-- forward therefore silently reverts every fix made to that function since —
-- no error, no warning, and the migration reports success. Two of the six had
-- been fixed after their introduction, and both fixes were undone:
--
--   guard_profile_privileges — copied from 0010, but 0029 was current.
--   broadcast_notification   — copied from 0048, but 0050 was current.
--
-- The other four were already at their latest (taxonomy_guard_decision 0024,
-- platform_feedback_publish_guard 0084, admin_pause_ad 0032,
-- admin_request_ad_changes 0033) and admin_approve_ad correctly used 0037's
-- body, not 0032's. Those need no repair.
--
-- ⚠ For anyone widening a gate this way in future: check
--   `grep -rl "function <name>" supabase/migrations/` FIRST and copy the body
--   from the HIGHEST-numbered file, not the one you found it in.
--
-- Requires 0086. Idempotent and re-runnable in the Supabase SQL editor.

-- ══ 1) guard_profile_privileges — 0029's service-role short-circuit ═══════════
--
-- SYMPTOM: changing any user to 'staff' from the admin console failed with
--   "not authorized to grant the staff role".
--
-- WHY: the console does not write the profile from the browser. It posts to
-- /api/admin-create-user, which uses the SERVICE-ROLE key, and under that key
-- `auth.uid()` is NULL — so `is_admin()` is false and the guard fires against
-- the server itself. This is the identical failure 0029 diagnosed and fixed for
-- the 'admin' role in the first place; 0086 reintroduced it and widened it to
-- 'staff' at the same time, which is why it showed up immediately.
--
-- The service-role key is never exposed to the browser, so a write made with it
-- is already privileged. The guard exists to stop a signed-in BUYER escalating
-- themselves from devtools, and must not apply to the trusted server.
--
-- Body below = 0029's short-circuit + 0086's widened role list. Both are needed:
-- without the first the console cannot grant any privileged role, without the
-- second any buyer can grant themselves 'staff'.
create or replace function guard_profile_privileges()
returns trigger
language plpgsql
as $$
begin
  -- Trusted server context (0029). Must stay FIRST — everything below assumes a
  -- browser session with a real auth.uid().
  if public.is_service_role() then
    return new;
  end if;

  -- Only an existing admin may grant a privileged role (0086). Staff cannot
  -- promote anyone — not a buyer, not another employee, not themselves —
  -- because this says is_admin(), not is_staff().
  if new.role is distinct from old.role
     and new.role in ('admin', 'staff')
     and not is_admin() then
    raise exception 'not authorized to grant the % role', new.role;
  end if;

  -- Nor may staff demote an admin out of the way (0086).
  if old.role in ('admin', 'staff')
     and new.role is distinct from old.role
     and not is_admin() then
    raise exception 'not authorized to change a privileged role';
  end if;

  -- Only an admin may change account status / soft-delete flags. For everyone
  -- else, silently pin these back to their stored values so an ordinary profile
  -- edit (name/phone/city) still succeeds without touching moderation state.
  if not is_admin() then
    if new.status is distinct from old.status then
      new.status := old.status;
    end if;
    if new.deleted_at is distinct from old.deleted_at then
      new.deleted_at := old.deleted_at;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_profile_privileges on profiles;
create trigger trg_guard_profile_privileges
  before update on profiles
  for each row
  execute function guard_profile_privileges();

-- ══ 2) broadcast_notification — 0050's audience rules ═════════════════════════
--
-- SYMPTOM (silent, and live since 0086 was applied): "Everyone" broadcasts went
-- to admin and staff accounts as well as buyers and sellers, and an unrecognised
-- audience string was accepted instead of rejected.
--
-- 0050 fixed exactly this — operators were getting "Diwali sale is live 🎉" in
-- their notification bell, and the console's Everyone tile did not equal
-- Buyers + Sellers. 0086 copied 0048's body and undid it.
--
-- Body below = 0050's + 0086's widened gate. Note the audience filter now also
-- excludes 'staff' for free: it is an allow-list of buyer and seller, so every
-- privileged role is out of a marketing broadcast by construction rather than by
-- being named.
create or replace function broadcast_notification(p_audience text, p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  -- Widened by 0086: staff send buyer updates, that is part of their job.
  if not is_staff() then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'title and body are required';
  end if;
  -- 0050. Without this an unknown audience silently matched nobody and the
  -- console reported a successful send of zero notifications.
  if p_audience not in ('all', 'buyer', 'seller') then
    raise exception 'unknown audience: %', p_audience;
  end if;

  -- Type must be one of the values allowed by notifications_type_check
  -- (Orders / Messages / Updates / Wishlist, migration 0044). A broadcast is a
  -- platform Update, which slots straight into the buyer's existing feed.
  insert into notifications (profile_id, type, title, body)
  select p.id, 'Updates', p_title, p_body
  from profiles p
  where p.deleted_at is null
    -- 0050: the audience is the marketplace, never the people running it.
    and p.role in ('buyer', 'seller')
    and (p_audience = 'all' or p.role = p_audience);

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function broadcast_notification(text, text, text) to authenticated;

-- ══ Verify ═══════════════════════════════════════════════════════════════════
--
--   -- 1. From the admin console: Users → edit a buyer → role Staff → Save.
--   --    Should succeed. Before this migration it raised
--   --    'not authorized to grant the staff role'.
--
--   -- 2. The short-circuit must be the first statement in the guard:
--   select prosrc from pg_proc where proname = 'guard_profile_privileges';
--   --    ...should contain is_service_role() before any is_admin() call.
--
--   -- 3. A broadcast must not reach privileged accounts. Send one to
--   --    "Everyone", then:
--   select p.role, count(*)
--     from notifications n join profiles p on p.id = n.profile_id
--    where n.title = '<the title you sent>'
--    group by p.role;
--   --    ...should list buyer and seller only — no admin, no staff row.
--
--   -- 4. Should raise 'unknown audience: nonsense':
--   select broadcast_notification('nonsense', 'x', 'y');
