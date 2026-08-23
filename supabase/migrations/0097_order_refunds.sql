-- 0097: refunds that actually reach Razorpay.
--
-- Idempotent and re-runnable in the Supabase SQL editor. Requires 0006 (the
-- `refunded` / `refunded_at` flag) and 0072 (the settlement guard this replaces).
--
-- ══ The gap ═════════════════════════════════════════════════════════════════
--
-- /admin/refunds has always been bookkeeping only. Pressing "Refund" ran
--
--     update orders set refunded = true, refunded_at = now() where id = ...
--
-- and nothing else. No call to Razorpay, no gateway reference stored. The
-- console then displayed "Refunded", the payout run correctly stopped counting
-- the order as owed to the seller — and the buyer's money was still sitting in
-- the merchant account until somebody remembered to open the Razorpay dashboard
-- and refund it by hand. Every part of the flow looked complete except the part
-- that moves the money.
--
-- `api/_refunds.js` now issues the real refund. This migration gives it
-- somewhere to record what the gateway did, and a way to write it.
--
-- ══ 1) What the gateway did ═════════════════════════════════════════════════
--
-- `refunded` stays what it always was: the platform's own position on whether
-- this order's money has been given back. These four record the gateway's side
-- of it, which is a different fact — a refund can be accepted by Razorpay and
-- still be days from the buyer's statement.

alter table public.orders add column if not exists refund_id text;
alter table public.orders add column if not exists refund_amount numeric(12,2);
alter table public.orders add column if not exists refund_status text;
alter table public.orders add column if not exists refund_reason text;

comment on column public.orders.refund_id is
  'Razorpay refund id (rfnd_...). NULL on an order refunded by hand before 0097, which is exactly how the console tells the two apart.';
comment on column public.orders.refund_amount is
  'What was actually sent back, in rupees: total + shipping_fee - platform_discount, the amount the buyer really paid for THIS order.';
comment on column public.orders.refund_status is
  'The gateway''s state: pending (accepted, not yet settled to the buyer), processed (done), failed (money never left).';

-- A gateway refund belongs to exactly one order. This is the structural half of
-- the idempotency — the API checks `refund_id is null` before calling Razorpay,
-- but a check-then-write is a race, and the H-1 duplicate-order bug was the same
-- shape. Here the constraint is what actually makes a double-refund impossible.
create unique index if not exists orders_refund_id_uniq
  on public.orders (refund_id) where refund_id is not null;

alter table public.orders drop constraint if exists orders_refund_status_chk;
alter table public.orders add constraint orders_refund_status_chk
  check (refund_status is null or refund_status in ('pending', 'processed', 'failed'));

-- ══ 2) The only writer ══════════════════════════════════════════════════════
--
-- The refund is issued by a Vercel function holding the SERVICE-ROLE key, and
-- the service role is not an admin: `is_admin()` (schema.sql:17) resolves
-- against `auth.uid()`, which is NULL on a service-role connection. So the 0072
-- guard below would raise 'orders: refunded is admin-managed' at a plain
-- service-role update, and the refund would move real money and then fail to
-- record it — the worst possible outcome for this particular flow.
--
-- 0072 already solved this shape of problem for `recompute_review_aggregates`:
-- the legitimate writer raises a transaction-local flag and the guard stands
-- down while it is set. Reuse that rather than inventing a second mechanism.
--
-- `set_config(..., true)` is transaction-scoped, so the window closes on its own
-- and cannot leak into the next statement on a pooled connection.

create or replace function mark_order_refunded(
  p_order_id uuid,
  p_refund_id text,
  p_amount numeric,
  p_status text,
  p_reason text default null
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order orders;
begin
  if p_status is null or p_status not in ('pending', 'processed', 'failed') then
    raise exception 'mark_order_refunded: unknown refund status %', p_status;
  end if;

  perform set_config('agilam.order_refund', 'on', true);

  -- `refunded` goes true for BOTH pending and processed. A pending refund has
  -- already been accepted by Razorpay — the money is committed and is no longer
  -- the platform's to settle — and `refunded = false` is what migration 0025's
  -- payout query keys on. Leaving it false until the gateway finishes would pay
  -- the seller for goods the buyer has been refunded for.
  update orders o
     set refund_id     = coalesce(p_refund_id, o.refund_id),
         refund_amount = coalesce(p_amount, o.refund_amount),
         refund_status = p_status,
         refund_reason = coalesce(p_reason, o.refund_reason),
         refunded      = (p_status <> 'failed'),
         refunded_at   = case when p_status <> 'failed'
                              then coalesce(o.refunded_at, now())
                              else null end
   where o.id = p_order_id
     -- Never let a second gateway refund overwrite the first one's reference —
     -- unless the first one FAILED, which is the one case where a fresh attempt
     -- is exactly what should happen. Without that exemption a failed refund
     -- would be permanently unretryable and the buyer permanently out of pocket.
     and (o.refund_id is null
          or p_refund_id is null
          or o.refund_id = p_refund_id
          or o.refund_status = 'failed')
  returning o.* into v_order;

  if v_order.id is null then
    raise exception 'mark_order_refunded: order % not found, or already carries a different refund', p_order_id;
  end if;

  return v_order;
end $$;

-- Rule 7 territory. This function writes settlement state, so it is granted to
-- the service role ONLY — not to `authenticated`, and never to `anon`. Nothing
-- in the browser calls it; the admin console goes through /api/verify-payment
-- with action 'refund-order', which authenticates the admin and then uses the
-- service-role key server-side.
revoke all on function mark_order_refunded(uuid, text, numeric, text, text) from public;
grant execute on function mark_order_refunded(uuid, text, numeric, text, text) to service_role;

-- ══ 3) The guard, with the refund columns closed ════════════════════════════
--
-- ⚠ This REPLACES the function body from 0072. If 0072 is ever re-run AFTER this
--   migration it restores the old body, which does not know about the flag —
--   every refund would then move money at Razorpay and raise
--   'orders: refunded is admin-managed' when recording it. If you re-run 0072,
--   re-run 0097 after it.
--
-- Changes from 0072, both additive:
--   • stands down for mark_order_refunded's transaction-local flag;
--   • guards refund_id / refund_amount / refund_status, which are new columns
--     the seller's over-broad UPDATE policy from schema.sql would otherwise
--     reach — forging a refund_id on a delivered order would take it out of the
--     payout run, so it is settlement state exactly like `refunded` is.

create or replace function orders_guard_settlement_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The refund writer, mid-write. Service-role only, transaction-scoped.
  if current_setting('agilam.order_refund', true) = 'on' then
    return new;
  end if;

  if is_admin() then
    return new;
  end if;

  -- ── Settlement state: what the platform owes, and whether it already paid ──
  if new.payout_id is distinct from old.payout_id then
    raise exception 'orders: payout_id is settlement state and is admin-managed';
  end if;
  if new.refunded is distinct from old.refunded
  or new.refunded_at is distinct from old.refunded_at then
    raise exception 'orders: refunded is admin-managed';
  end if;
  if new.refund_id is distinct from old.refund_id
  or new.refund_amount is distinct from old.refund_amount
  or new.refund_status is distinct from old.refund_status then
    raise exception 'orders: refund state is written only by mark_order_refunded';
  end if;

  -- ── The money breakdown ───────────────────────────────────────────────────
  -- `total`, `cod_fee` and `shipping_fee` are already covered by 0022; these are
  -- the two it missed. Both are priced server-side at checkout and both feed the
  -- payout arithmetic.
  if new.discount is distinct from old.discount then
    raise exception 'orders: discount is set at checkout and is immutable';
  end if;
  if new.platform_discount is distinct from old.platform_discount then
    raise exception 'orders: platform_discount is set at checkout and is immutable';
  end if;
  if new.coupon_code is distinct from old.coupon_code then
    raise exception 'orders: coupon_code is set at checkout and is immutable';
  end if;

  -- ── How the money arrived ─────────────────────────────────────────────────
  -- `channel` decides whether an order is a marketplace sale (settled through
  -- the platform) or the seller's own walk-in till (excluded from payouts).
  if new.channel is distinct from old.channel then
    raise exception 'orders: channel is set when the order is created';
  end if;
  if new.payment_method is distinct from old.payment_method then
    raise exception 'orders: payment_method is set when the order is created';
  end if;
  if new.payment_id is distinct from old.payment_id then
    raise exception 'orders: payment_id is the gateway''s reference and is immutable';
  end if;

  -- ── Which order this is ───────────────────────────────────────────────────
  -- Re-pointing an order at another boutique or buyer would move both the money
  -- and the buyer's order history.
  if new.id is distinct from old.id
  or new.order_number is distinct from old.order_number
  or new.buyer_id is distinct from old.buyer_id
  or new.boutique_id is distinct from old.boutique_id
  or new.created_at is distinct from old.created_at then
    raise exception 'orders: order identity is immutable';
  end if;

  return new;
end $$;

drop trigger if exists orders_guard_settlement_columns on orders;
create trigger orders_guard_settlement_columns
  before update on orders
  for each row execute function orders_guard_settlement_columns();

-- ══ 4) Finding the ones done by hand ════════════════════════════════════════
--
-- Orders refunded before this migration carry `refunded = true` with no
-- refund_id. They are not wrong — the money really was sent back through the
-- dashboard — but the console must not offer to refund them again, and their
-- "Reverse" button stays, because a hand-flagged row is the only kind that can
-- still legitimately be un-flagged.
create index if not exists orders_refunded_legacy_idx
  on public.orders (refunded_at desc) where refunded and refund_id is null;
