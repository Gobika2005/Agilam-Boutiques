-- Dispatch time and the return window become the seller's, not the platform's.
--
-- The buyer's "Shipping Information" panel showed three things it presented as
-- facts about the shop, two of which were compile-time constants in the app:
--
--   • "3–7 working days" — one dispatch-and-transit estimate for every shop on
--     the marketplace. A ready-stock boutique ships next morning; one that
--     stitches to order takes a fortnight. Both claimed the same thing.
--   • "7-day easy returns" — read from `POLICY_TERMS` in the source, NOT from
--     `platform_settings.return_window_days`. It was the only surface in the app
--     still doing that, so with returns configured to 0 (as production is), the
--     product page promised a 7-day window that `request_return()` then refused.
--
-- Both now live on the boutique:
--
--   dispatch_days_min / dispatch_days_max  how long this shop takes to pack an
--                                          order, before transit
--   return_window_days                     this shop's goodwill return window;
--                                          0 = no change-of-mind returns
--
-- Transit time is deliberately NOT moved: how long the courier takes is not
-- something a seller can promise, so the "3–7 working days in transit" estimate
-- stays platform copy. What the seller owns is the part they control — the days
-- between the order arriving and the parcel leaving.
--
-- `request_return()` (migration 0074) is replaced below so the goodwill window
-- it enforces is the one the buyer was shown on the product page. Before this,
-- the buyer read one shop's promise and the server checked a different number.
--
-- Idempotent: re-runnable in the Supabase SQL editor.

-- ── Columns ─────────────────────────────────────────────────────────────────
alter table boutiques add column if not exists dispatch_days_min  int not null default 1;
alter table boutiques add column if not exists dispatch_days_max  int not null default 2;
alter table boutiques add column if not exists return_window_days int not null default 7;

-- A range that runs backwards would print "Dispatched in 5–2 days".
alter table boutiques drop constraint if exists boutiques_dispatch_days_ck;
alter table boutiques add  constraint boutiques_dispatch_days_ck
  check (dispatch_days_min >= 0 and dispatch_days_max >= dispatch_days_min and dispatch_days_max <= 60);

alter table boutiques drop constraint if exists boutiques_return_window_ck;
alter table boutiques add  constraint boutiques_return_window_ck
  check (return_window_days >= 0 and return_window_days <= 30);

comment on column boutiques.dispatch_days_min is
  'Working days this shop takes to pack an order before it goes to the courier (lower bound). Shown to buyers as "Dispatched in N–M working days"; transit time is added on top and remains platform copy.';
comment on column boutiques.dispatch_days_max is
  'Upper bound of the same. Must be >= dispatch_days_min. A made-to-order shop sets a wide range here rather than disappointing the buyer.';
comment on column boutiques.return_window_days is
  'Days after delivery this shop accepts a CHANGE-OF-MIND return. 0 = none. Fault claims (damaged, defective, wrong item, not as described) are never governed by this — see request_return(), which allows those for 30 days whatever this says.';

-- ── Carry the platform's current promise onto every existing shop ───────────
-- Runs once, guarded on nothing having been customised yet, so re-running the
-- file cannot overwrite a seller's own choice. The dispatch default (1–2 days)
-- is already the column default and matches the wording the app shipped with,
-- so only the return window needs reading across.
do $$
declare
  v_window int;
begin
  if to_regclass('public.platform_settings') is null then
    return;
  end if;
  if exists (select 1 from boutiques where return_window_days <> 7) then
    raise notice '0078: return windows already customised — backfill skipped.';
    return;
  end if;

  select coalesce(return_window_days, 0) into v_window from platform_settings where id = 1;
  if v_window is not null then
    -- Whatever the marketplace was enforcing yesterday is what every shop
    -- promises today, including 0. Nothing changes for a buyer on day one.
    update boutiques set return_window_days = least(greatest(v_window, 0), 30);
  end if;
exception
  when undefined_column then
    null;
end $$;

-- ── Column grants ───────────────────────────────────────────────────────────
-- 0021 revoked the blanket SELECT and grants columns back one at a time. All
-- three are quoted to the buyer on the product page, so they are public by
-- definition.
grant select (dispatch_days_min, dispatch_days_max, return_window_days)
  on boutiques to anon, authenticated;

-- ── request_return(): gate on the SHOP's window, not the platform's ─────────
-- Byte-for-byte the function from 0074 apart from where `v_window` comes from
-- and the message when returns are closed. Everything else — the ownership
-- check, the delivered-only rule, the 30-day outer bound on fault claims, the
-- seller notification — is unchanged.
create or replace function request_return(
  p_order_id uuid,
  p_reason   text,
  p_note     text default '',
  p_photos   text[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   record;
  v_window  int;
  v_shop    text;
  v_is_fault boolean;
  v_id      uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to request a return.' using errcode = 'insufficient_privilege';
  end if;

  select o.id, o.buyer_id, o.boutique_id, o.status, o.delivered_at, o.refunded
    into v_order
    from orders o
   where o.id = p_order_id;

  if not found then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;
  if v_order.buyer_id is distinct from auth.uid() then
    raise exception 'That is not your order.' using errcode = 'insufficient_privilege';
  end if;
  if v_order.status <> 'delivered' or v_order.delivered_at is null then
    raise exception 'You can request a return once the order has been delivered.' using errcode = 'check_violation';
  end if;
  if v_order.refunded then
    raise exception 'This order has already been refunded.' using errcode = 'check_violation';
  end if;

  v_is_fault := p_reason in ('damaged', 'defective', 'wrong_item', 'not_as_described');

  -- The window the BUYER was shown on the product page: this boutique's own.
  -- Falls back to the platform setting only if the shop row has somehow gone —
  -- the column is NOT NULL, so in practice the first branch always answers.
  select coalesce(b.return_window_days, 0), b.name
    into v_window, v_shop
    from boutiques b
   where b.id = v_order.boutique_id;

  if not found then
    select coalesce(return_window_days, 0) into v_window from platform_settings where id = 1;
    v_shop := 'This boutique';
  end if;

  if v_is_fault then
    if v_order.delivered_at < now() - interval '30 days' then
      raise exception 'This order was delivered more than 30 days ago. Please message the boutique instead.'
        using errcode = 'check_violation';
    end if;
  else
    if v_window <= 0 then
      raise exception '% does not accept change-of-mind returns. If the item is damaged, faulty or not what you ordered, choose that reason instead.', coalesce(v_shop, 'This boutique')
        using errcode = 'check_violation';
    end if;
    if v_order.delivered_at < now() - make_interval(days => v_window) then
      -- RAISE carries its own format string with `%` placeholders and takes the
      -- arguments after a comma. Wrapping the message in format() instead makes
      -- PL/pgSQL read the first token as a CONDITION NAME — "unrecognized
      -- exception condition format" — and it is a compile-time failure of the
      -- whole function, not a runtime one, so it takes the migration down.
      raise exception 'The %-day return window for this order has closed.', v_window
        using errcode = 'check_violation';
    end if;
  end if;

  insert into return_requests (order_id, boutique_id, buyer_id, reason, note, photos)
  values (p_order_id, v_order.boutique_id, auth.uid(), p_reason, coalesce(p_note, ''), coalesce(p_photos, '{}'))
  returning id into v_id;

  begin
    insert into notifications (profile_id, type, title, body, order_id)
    select b.owner_id, 'Orders',
           'Return requested',
           'A buyer has requested a return. Open the order to review it.',
           p_order_id
      from boutiques b
     where b.id = v_order.boutique_id;
  exception when others then
    null;
  end;

  return v_id;
end $$;

revoke all on function request_return(uuid, text, text, text[]) from public, anon;
grant execute on function request_return(uuid, text, text, text[]) to authenticated;

-- ── Verify ──────────────────────────────────────────────────────────────────
-- What every shop now promises:
--
--   select name, dispatch_days_min || '–' || dispatch_days_max || ' days' as dispatch,
--          return_window_days as returns
--     from boutiques where status = 'approved' order by name;
--
-- Shops accepting no change-of-mind returns (fault claims still work):
--
--   select name from boutiques where status = 'approved' and return_window_days = 0;
