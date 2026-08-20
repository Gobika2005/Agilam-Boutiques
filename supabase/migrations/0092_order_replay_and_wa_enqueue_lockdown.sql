-- ═══════════════════════════════════════════════════════════════════════════════
-- 0092 — Make the order replay guard structural, and take wa_enqueue away from
--        `authenticated`
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Two findings from the 2026-08-20 QA pass
-- (docs/archive/2026-08/MANGAIMART_QA_REPORT_2026-08-20.md). Both are about a
-- guard that was written as a check when it needed to be a constraint.
--
-- Requires 0053 (orders.platform_discount), 0063 (orders.payment_id) and 0090
-- (wa_enqueue). Idempotent and re-runnable in the Supabase SQL editor.


-- ══ 1) One payment, one order per boutique ══════════════════════════════════
--
-- api/place-order.js opens with a replay guard:
--
--     select id from orders where payment_id = $1 limit 1;
--     if (dup) return 409;
--
-- and then, several hundred milliseconds later, inserts the order rows. In
-- between it verifies the buyer's token, reads the products, fetches the payment
-- from Razorpay, sometimes captures it, reserves stock and claims the coupon.
-- Two requests carrying the same genuine {order_id, payment_id, signature} can
-- both clear that SELECT inside the window and both write a full order-set:
-- stock decremented twice, the coupon redeemed twice, and the sellers credited
-- for goods the buyer paid for once.
--
-- The browser cannot cause this by accident — src/pages/buyer/Payment.tsx holds
-- an `inFlight` ref, so a double-tap in one tab is already refused. Two tabs, a
-- network-level retry, the "Complete my order" recovery path racing a manual
-- retry, or anyone deliberately replaying their own valid payment in parallel
-- all reach it.
--
-- `ad_orders` has had the structural version of this since 0032, where the
-- column is declared `payment_id text unique` and the comment calls it exactly
-- what it is — "structural replay guard". Buyer orders never got the same
-- treatment; `orders.payment_id` carries only the trigram index from 0080,
-- which is for admin search and enforces nothing.
--
-- WHY NOT unique(payment_id)
-- A cart spanning two boutiques is deliberately ONE payment and TWO orders —
-- that split is what makes each seller see only their own items. A unique on
-- payment_id alone would break every multi-boutique checkout. Scoping it to
-- (payment_id, boutique_id) permits exactly the intended split and forbids the
-- thing we actually want forbidden: a second order for the same boutique from
-- the same payment.
--
-- The partial WHERE matters. Offline POS sales (channel = 'offline', migration
-- 0052) carry no payment_id, and NULLs are distinct in a Postgres unique index
-- anyway — being explicit keeps the index small and says so out loud.

-- Pre-flight. A duplicate already in the table would make the index creation
-- fail with a bare "could not create unique index", which tells you nothing
-- about which orders to reconcile. Fail early instead, and name them.
do $$
declare
  v_dupes text;
begin
  select string_agg(format('payment_id=%s boutique_id=%s (%s orders)', payment_id, boutique_id, n), E'\n  ')
    into v_dupes
    from (
      select payment_id, boutique_id, count(*) as n
        from public.orders
       where payment_id is not null
       group by payment_id, boutique_id
      having count(*) > 1
    ) d;

  if v_dupes is not null then
    raise exception E'0092: existing duplicate orders block this index.\n  %\n\nThese are real double-settlements. Decide which order of each pair is the keeper, refund/cancel the other, then re-run this migration.', v_dupes;
  end if;
end $$;

create unique index if not exists orders_payment_boutique_uniq
  on public.orders (payment_id, boutique_id)
  where payment_id is not null;

-- api/place-order.js matches on this index name to tell "someone else already
-- settled this payment" (409, keep the money, release only the stock this
-- request reserved and did not write) apart from a genuine write failure
-- (refund and release everything). Renaming the index without changing that
-- branch would silently turn the first case back into a refund of a live order.
comment on index public.orders_payment_boutique_uniq is
  'Structural replay guard: one order per (payment, boutique). api/place-order.js matches this name on 23505 — see migration 0092.';


-- ══ 2) wa_enqueue is not the buyer's to call ════════════════════════════════
--
-- 0090 created the WhatsApp outbox and wrote, above the grant:
--
--     -- Callable by the triggers' invokers and by the service role. Never by
--     -- anon: an anonymous visitor able to call this could send WhatsApp
--     -- messages, from our number, at our expense, to any number they chose.
--     grant execute on function wa_enqueue(...) to authenticated, service_role;
--
-- The intent is right and the grant does not achieve it. `wa_enqueue` is
-- SECURITY DEFINER and holds no caller check of its own — it normalises the
-- number, honours the opt-out list, sanitises the params and queues. The GRANT
-- *is* the authorization. And `authenticated` is not "staff" or even "a buyer
-- with an order": it is every self-registered account, and signing up is free,
-- self-service and instant.
--
-- So from the browser console of any account:
--
--     await supabase.rpc('wa_enqueue', {
--       p_recipient  : '+91XXXXXXXXXX',
--       p_template   : 'order_confirmation',
--       p_params     : ['anything they like'],
--       p_dedupe_key : crypto.randomUUID(),   -- fresh each call, so the dedupe index never bites
--     });
--
-- `wa_param` only collapses whitespace, so the caller controls the template
-- variables, and the message lands from the VERIFIED MangaiMart business
-- sender. That is per-conversation billing at our expense, phishing wearing our
-- brand, and the kind of spam volume that gets a WABA restricted — which would
-- take out order notifications for every real customer at once.
--
-- Anonymous sign-in happens to be disabled on this project (src/data/chat.ts
-- records the 422 anonymous_provider_disabled), so the bar today is "make an
-- account" rather than "open a chat". That is not a bar.
--
-- WHY REVOKING BREAKS NOTHING
-- Nothing that legitimately queues a message needs an invoker-rights grant:
--
--   • the wa_on_* triggers (0090 §6-7) are all SECURITY DEFINER, so they call
--     wa_enqueue as their owner, not as the seller or buyer whose write fired
--     them — EXECUTE is checked against the definer;
--   • api/place-order.js (lines ~161 and ~180) calls it over the service role,
--     which keeps its grant below.
--
-- No path in src/ calls it at all — the browser has never needed it.
--
-- This is the third time this project has been bitten by reading a grant to
-- `authenticated` as "a real, trusted user": 0072 documented it for the storage
-- buckets, 0087 fixed the storefront outage it caused, and rule 7 in CLAUDE.md
-- writes it down. Worth a sweep of every `grant ... to authenticated` across the
-- series rather than waiting for the fourth.

revoke execute on function public.wa_enqueue(text, text, text[], text, text, uuid, uuid, uuid)
  from authenticated;

-- Restated rather than assumed, so this migration leaves the grant in a known
-- state whichever order things ran in.
grant execute on function public.wa_enqueue(text, text, text[], text, text, uuid, uuid, uuid)
  to service_role;


-- ══ Verify ══════════════════════════════════════════════════════════════════
--
-- 1) The index exists and is unique + partial:
--
--      select indexdef from pg_indexes
--       where schemaname = 'public' and indexname = 'orders_payment_boutique_uniq';
--      -- CREATE UNIQUE INDEX ... ON public.orders USING btree (payment_id, boutique_id)
--      --   WHERE (payment_id IS NOT NULL)
--
-- 2) A replayed payment is refused by the DATABASE, not just by the handler.
--    Against any real settled order (this must ERROR with 23505):
--
--      insert into orders (order_number, buyer_id, boutique_id, total, payment_id, status)
--      select 'AGL-DUPTEST', buyer_id, boutique_id, total, payment_id, 'pending'
--        from orders where payment_id is not null limit 1;
--      -- ERROR: duplicate key value violates unique constraint "orders_payment_boutique_uniq"
--
--    A genuine multi-boutique checkout must still be allowed — same payment_id,
--    different boutique_id — which the (payment_id, boutique_id) pair permits by
--    construction.
--
-- 3) wa_enqueue is no longer reachable from a buyer session. As a signed-in,
--    non-admin buyer in the browser console:
--
--      await supabase.rpc('wa_enqueue', { p_recipient: '+919000000000',
--        p_template: 'order_confirmation', p_params: ['x'], p_dedupe_key: 'probe-1' });
--      -- { code: '42501', message: 'permission denied for function wa_enqueue' }
--
-- 4) The triggers still queue. Move a test order to 'shipped' and confirm a row
--    appears — this is the check that proves the revoke took nothing real away:
--
--      update orders set status = 'shipped' where id = '<test order>';
--      select template, audience, status, created_at
--        from whatsapp_outbox order by created_at desc limit 5;
--
-- 5) And the grants read as intended (service_role only):
--
--      select grantee, privilege_type
--        from information_schema.role_routine_grants
--       where routine_name = 'wa_enqueue';
