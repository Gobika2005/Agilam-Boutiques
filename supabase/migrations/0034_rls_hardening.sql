-- RLS hardening (audit follow-up).
--
-- Two fixes, both idempotent and re-runnable in the Supabase SQL editor.
--
-- ── 1) Storage: stop cross-tenant image tampering (H-1) ──────────────────────
-- 0017 (product-images) and 0019 (boutique-images) opened UPDATE and DELETE on
-- the whole bucket to ANY authenticated user, to get past an owner-scoped WITH
-- CHECK that was rejecting uploads at the time. Because buyers can sign in
-- (account sync), that means any logged-in user — a buyer or a rival seller —
-- can overwrite or delete another boutique's product photos and logos.
--
-- The app already writes every object under `{boutique_id}/...`
--   • product image path:  `${boutiqueId}/${uuid}.ext`          (products.ts)
--   • boutique image path: `${boutiqueId}/${kind}/${uuid}.ext`  (boutiques.ts)
-- so `(storage.foldername(name))[1]` is the owning boutique id, and we can scope
-- UPDATE/DELETE to the boutique's owner without touching the upload path.
--
-- INSERT is deliberately LEFT as "any authenticated user" — uploads use
-- upsert:false, so INSERT can never overwrite an existing object, and this is the
-- exact policy 0017 proved works in practice. Only UPDATE (upsert-overwrite) and
-- DELETE are the vandalism vectors, and those are what we lock down here.

do $$
declare
  b text;
begin
  foreach b in array array['product-images', 'boutique-images'] loop
    execute format('drop policy if exists %I on storage.objects', b || ': authed update');
    execute format('drop policy if exists %I on storage.objects', b || ': authed delete');
    execute format('drop policy if exists %I on storage.objects', b || ': owner update');
    execute format('drop policy if exists %I on storage.objects', b || ': owner delete');

    execute format($f$
      create policy %I on storage.objects for update to authenticated
        using (
          bucket_id = %L
          and exists (
            select 1 from boutiques bt
            where bt.owner_id = auth.uid()
              and (storage.foldername(name))[1] = bt.id::text
          )
        )
        with check (
          bucket_id = %L
          and exists (
            select 1 from boutiques bt
            where bt.owner_id = auth.uid()
              and (storage.foldername(name))[1] = bt.id::text
          )
        )
    $f$, b || ': owner update', b, b);

    execute format($f$
      create policy %I on storage.objects for delete to authenticated
        using (
          bucket_id = %L
          and exists (
            select 1 from boutiques bt
            where bt.owner_id = auth.uid()
              and (storage.foldername(name))[1] = bt.id::text
          )
        )
    $f$, b || ': owner delete', b);
  end loop;
end $$;

-- ── 1b) Products: hide moderation-hidden / soft-deleted from buyers (DD-1) ────
-- 0006 added products.status ('pending'|'active'|'hidden'|'rejected') and
-- products.deleted_at, but the public-read policy (schema.sql) still only checks
-- that the boutique is approved — so a hidden/rejected/pending or soft-deleted
-- product stays readable to anonymous buyers, and hiding is enforced only by
-- each query remembering to add the filter. Tighten the policy so the DB is
-- correct on its own: buyers see only live products; the OWNER still sees all of
-- their own (so the seller's ProductAnalytics keeps working), and admins see all.
-- The server (place-order/create-order) bypasses RLS, so it applies the same
-- filter explicitly in code — this is the defense-in-depth backstop.
drop policy if exists "products: public read from approved boutiques" on products;
create policy "products: public read from approved boutiques" on products for select
  using (
    (
      status = 'active' and deleted_at is null
      and exists (select 1 from boutiques b where b.id = boutique_id and b.status = 'approved')
    )
    or exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid())
    or is_admin()
  );

-- ── 2) Profiles: restrict role at self-insert (M-1, defense-in-depth) ─────────
-- 0010 already blocks role escalation on UPDATE via a trigger. The self-INSERT
-- policy, however, only checks `id = auth.uid()`, so a first-time user could
-- insert their own row with role='admin'. Today that's blocked only because
-- handle_new_user (0028/0030) pre-creates the row (PK conflict). If that trigger
-- is ever dropped, this becomes privilege escalation. Pin the self-claimable
-- roles here so RLS is correct on its own. handle_new_user (security definer) and
-- the service-role admin endpoints both bypass RLS, so this cannot break them.
drop policy if exists "profiles: self insert" on profiles;
create policy "profiles: self insert" on profiles for insert
  with check (id = auth.uid() and role in ('buyer', 'seller'));
