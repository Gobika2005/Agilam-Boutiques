-- 0049 — Coupon redemption limits
--
-- Coupons could be redeemed an unlimited number of times and nothing recorded
-- how often a code had been used. A live 90%-off platform coupon with no cap
-- and no usage limit was therefore unbounded platform-funded spend, invisible
-- from the console.
--
-- This adds:
--   • coupons.usage_limit  — total redemptions allowed (null = unlimited)
--   • coupons.used_count   — redemptions so far, maintained by the checkout
--   • orders.coupon_code   — which code an order was placed with, so the count
--                            is auditable rather than a number nobody can check
--   • redeem_coupon()      — atomic claim; the limit is enforced in one
--                            statement so two concurrent checkouts cannot both
--                            take the last redemption.

alter table coupons
  add column if not exists usage_limit int,
  add column if not exists used_count  int not null default 0;

alter table coupons
  drop constraint if exists coupons_usage_limit_check;
alter table coupons
  add constraint coupons_usage_limit_check check (usage_limit is null or usage_limit >= 1);

alter table coupons
  drop constraint if exists coupons_used_count_check;
alter table coupons
  add constraint coupons_used_count_check check (used_count >= 0);

alter table orders
  add column if not exists coupon_code text;

create index if not exists orders_coupon_code_idx on orders (coupon_code) where coupon_code is not null;

/*
 * Claim one redemption of a coupon.
 *
 * Returns true when the redemption was taken, false when the code is inactive,
 * expired or already at its limit. The UPDATE ... WHERE does the check and the
 * increment in a single atomic statement, so the limit holds under concurrency
 * without an explicit lock.
 *
 * Deliberately does NOT verify the cart — pricing is api/_pricing.js's job. This
 * only rations how many times a code may be used.
 */
create or replace function redeem_coupon(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ok boolean;
begin
  update coupons
     set used_count = used_count + 1,
         updated_at = now()
   where upper(code) = upper(p_code)
     and active
     and expires_at >= (now() at time zone 'utc')::date
     and (usage_limit is null or used_count < usage_limit)
  returning true into v_ok;

  return coalesce(v_ok, false);
end;
$$;

revoke all on function redeem_coupon(text) from public, anon, authenticated;
grant execute on function redeem_coupon(text) to service_role;

comment on column coupons.usage_limit is 'Total redemptions allowed across all buyers; null = unlimited.';
comment on column coupons.used_count is 'Redemptions taken so far. Maintained by redeem_coupon() at checkout.';
comment on column orders.coupon_code is 'The discount code this order was placed with, if any.';
