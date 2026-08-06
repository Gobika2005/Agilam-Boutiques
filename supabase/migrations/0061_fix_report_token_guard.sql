-- 0061_fix_report_token_guard.sql — make set_report_token usable by the owner.
--
-- 0060 guarded rotation with is_admin(), which resolves to
--   exists (select 1 from profiles where id = auth.uid() and role = 'admin')
-- That works for a signed-in admin calling through PostgREST, but the Supabase
-- SQL Editor carries no end-user JWT at all, so auth.uid() is null, is_admin()
-- is false, and the owner is refused by their own function:
--   ERROR: P0001: only an admin may rotate the report token
--
-- Same shape as the 0028/0010 collision: a guard written for the app path also
-- caught the privileged path it was never meant to police.
--
-- The fix distinguishes the two callers by whether PostgREST set a JWT claims
-- context. A direct SQL connection (SQL Editor, psql, a service-role session)
-- has none — and that caller already holds full database access, so there is
-- nothing left for this check to protect. A request arriving through PostgREST
-- always has the context set, including anonymous ones, where the anon apikey is
-- itself a JWT with role 'anon'. So anon still cannot rotate the token: it has
-- claims, and it is not an admin.

create or replace function public.set_report_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
begin
  -- Empty claims => not a PostgREST request => a direct, already-privileged SQL
  -- session. Anything else must prove it is an admin.
  if coalesce(v_claims, '') <> '' and not is_admin() then
    raise exception 'only an admin, or a direct SQL connection, may rotate the report token';
  end if;

  if length(coalesce(p_token, '')) < 24 then
    raise exception 'report token must be at least 24 characters';
  end if;

  insert into public.report_secrets (id, token_hash, updated_at)
  values (1, extensions.crypt(p_token, extensions.gen_salt('bf')), now())
  on conflict (id) do update
    set token_hash = excluded.token_hash, updated_at = now();
end;
$$;

revoke all on function public.set_report_token(text) from anon, authenticated;
grant execute on function public.set_report_token(text) to authenticated;
