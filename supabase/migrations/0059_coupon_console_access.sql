-- 0059 — Give the seller and admin coupon consoles their columns back
--
-- Migration 0058 revoked SELECT on `coupons` and granted back only the
-- buyer-safe columns, on this reasoning from its own header:
--
--   "None of the three is read by the buyer app: `src/data/coupons.ts` selects
--    them for the seller and admin consoles, which run as the owner or an admin."
--
-- That reasoning does not hold, and the consoles have been dead in production
-- ever since. A signed-in seller IS the `authenticated` role — "owner of the
-- boutique" is a row-level fact that RLS evaluates, while column privileges are
-- checked *before* RLS and know nothing about it. So `revoke select … from
-- authenticated` locked out the two surfaces the columns exist for:
--
--   • /seller/coupons  — list returned 42501, and `Coupons.tsx` renders
--     `mine ?? []`, so every seller saw a permanent "No coupons yet".
--   • creating a coupon — the INSERT is permitted, but its RETURNING clause
--     asked for the revoked columns, so the whole statement aborted. The form
--     sat there with no error and no row written.
--   • /admin/coupons — same code path, same role, same 403.
--
-- 0058 anticipated this and shipped `coupon_private(uuid)` as the way back in.
-- Nothing ever called it, and per-row it would be an N+1 anyway. This adds the
-- set-returning form the consoles actually need: one round trip, same
-- entitlement check, buyer exposure unchanged.
--
-- Idempotent and re-runnable in the Supabase SQL editor.

-- ── The withheld columns, for every coupon the caller is entitled to ─────────
-- SECURITY DEFINER runs as the table owner, so 0058's column revoke does not
-- apply inside the body; the WHERE clause is the access check, and it is the
-- same one `coupon_private(uuid)` uses. An admin gets every row; a seller gets
-- only their own boutiques'; a buyer gets nothing.
--
-- Dropped first so a later migration can re-shape the return type without
-- CREATE OR REPLACE failing on it (SQLSTATE 42P13).
drop function if exists coupon_private_all();
create function coupon_private_all()
returns table (
  id uuid,
  created_by uuid,
  usage_limit int,
  used_count int
)
language sql
security definer
stable
set search_path = public
as $$
  select c.id, c.created_by, c.usage_limit, c.used_count
    from coupons c
   where is_admin()
      or (
        c.boutique_id is not null
        and exists (
          select 1 from boutiques b
           where b.id = c.boutique_id and b.owner_id = auth.uid()
        )
      );
$$;

revoke all on function coupon_private_all() from public, anon;
grant execute on function coupon_private_all() to authenticated;
