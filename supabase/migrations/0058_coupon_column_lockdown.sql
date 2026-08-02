-- 0058 — Coupons: stop handing out the operator's columns
--
-- `coupons: public read active` (migration 0036) is correct in spirit: the buyer
-- /coupons screen exists to show every live offer, so anonymous read of the
-- active rows is the product, not a leak.
--
-- What was not intended is that `select *` on that table also returns:
--
--   • created_by  — the auth user id of the admin or seller who wrote the code.
--                   An internal identifier, of no use to a buyer, and the same
--                   id that appears in profiles / boutiques.owner_id. A live
--                   probe with nothing but the public anon key returned it for
--                   every coupon on the site.
--   • used_count  — how many redemptions a code has taken
--   • usage_limit — how many it is allowed
--
-- The last two are worse than untidy. 0049 added them to ration platform-funded
-- discounts; published, they tell anyone exactly how close a code is to its cap,
-- which is the one fact needed to race the remaining redemptions of a limited
-- offer before the buyers it was meant for arrive.
--
-- None of the three is read by the buyer app: `src/data/coupons.ts` selects them
-- for the seller and admin consoles, which run as the owner or an admin. So this
-- follows the pattern migration 0021 established for `boutiques` — withdraw the
-- blanket SELECT, hand back the buyer-safe columns by name, and let the two
-- privileged surfaces reach the rest through a definer function.
--
-- Idempotent and re-runnable in the Supabase SQL editor.

-- ── Column-level lockdown ───────────────────────────────────────────────────
revoke select on coupons from anon, authenticated;

do $$
declare
  cols constant text := '
    id, code, boutique_id, type, off, min_subtotal, max_discount,
    description, expires_at, active, created_at, updated_at
  ';
begin
  execute format('grant select (%s) on coupons to anon', cols);
  execute format('grant select (%s) on coupons to authenticated', cols);
end $$;

-- ── The withheld columns, for the people entitled to them ───────────────────
-- SECURITY DEFINER runs as the table owner, so the grants above do not apply
-- inside the body; the WHERE clause is the access check. An admin sees every
-- row; a seller sees only their own boutique's.
--
-- Dropped first so the function can be re-shaped by a later migration without
-- CREATE OR REPLACE failing on a changed return type (SQLSTATE 42P13).
drop function if exists coupon_private(uuid);
create function coupon_private(cid uuid)
returns table (
  created_by uuid,
  usage_limit int,
  used_count int
)
language sql
security definer
stable
set search_path = public
as $$
  select c.created_by, c.usage_limit, c.used_count
    from coupons c
   where c.id = cid
     and (
       is_admin()
       or (
         c.boutique_id is not null
         and exists (
           select 1 from boutiques b
            where b.id = c.boutique_id and b.owner_id = auth.uid()
         )
       )
     );
$$;

revoke all on function coupon_private(uuid) from public, anon;
grant execute on function coupon_private(uuid) to authenticated;

-- `redeem_coupon` (0049) is SECURITY DEFINER and still increments `used_count`
-- from inside the database, so rationing is unaffected by the revoke above.
