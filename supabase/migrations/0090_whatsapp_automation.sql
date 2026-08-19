-- ═══════════════════════════════════════════════════════════════════════════════
-- 0090 — WhatsApp automation: outbox, opt-out, and the triggers that fill them
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Buyer order-lifecycle messages and seller alerts, sent through Meta's Cloud
-- API. Planned in WHATSAPP_AUTOMATION_PLAN.md (2026-08-09); this is Phase 1 of
-- that plan, renumbered from 0061 because migrations 0061–0089 shipped first.
--
-- WHY THE QUEUE LIVES IN POSTGRES AND NOT IN `api/`
-- An order's status is changed by a CLIENT-SIDE `update({ status })` in
-- src/data/orders.ts — the seller console talks to PostgREST directly, so there
-- is no server hop to hang a send off. And `api/` is at exactly 12 of the 12
-- functions Vercel Hobby allows, so a thirteenth route fails the deploy outright
-- (the same wall the Shiprocket and email work hit). Triggers therefore write a
-- row here, and a Supabase Edge Function (`wa-drain`) empties it on a pg_cron
-- tick. The upside is that this catches a status change from ANY source —
-- seller console, admin console, a webhook, or an admin's manual SQL edit.
--
-- IT SHIPS DORMANT
-- `platform_settings.whatsapp_enabled` defaults FALSE and `wa_claim_batch`
-- returns nothing while it is false. Applying this migration therefore sends
-- nobody anything: it only starts filling the outbox, which is exactly what
-- Phase 5 step 3 wants to inspect before a single message leaves.
--
-- CONSENT IS ORDER-IMPLIED, AND OPT-OUT IS PHONE-KEYED
-- The buyer is told at checkout that order updates go to that number and that
-- STOP opts out. The opt-out table is keyed by phone, not by profile, because a
-- number is the only handle we have — `orders.guest_phone` is captured per order
-- and need not match any profile row.
--
-- NOTHING HERE MAY BREAK AN ORDER
-- Every trigger body is wrapped in an exception handler. A malformed phone
-- number, a missing boutique, a full disk — none of it is allowed to abort the
-- seller's "mark shipped" tap. Messaging is strictly best-effort, the same
-- contract notifySellers() keeps in api/place-order.js.
--
-- Requires 0021 (boutiques.whatsapp), 0025+0026 (payouts.status, payouts.utr),
-- 0048 (is_admin), 0085 (no COD — every order is prepaid).
-- Idempotent and re-runnable in the Supabase SQL editor.

-- ── 1) Kill switch ───────────────────────────────────────────────────────────
--
-- A commercial toggle, so it lives on platform_settings and is admin-editable,
-- per the house rule — not a constant in the Edge Function where flipping it
-- would mean a redeploy.
alter table platform_settings
  add column if not exists whatsapp_enabled boolean not null default false;

comment on column platform_settings.whatsapp_enabled is
  'Master switch for WhatsApp sends. False = wa_claim_batch returns nothing; triggers still queue, so the outbox can be inspected before going live.';

-- ── 2) Opt-out list ──────────────────────────────────────────────────────────
--
-- Written by wa-webhook when someone replies STOP, and consulted before every
-- enqueue AND again at send time — twice on purpose, because a row can sit
-- queued for a minute and someone who says STOP in that minute must not still
-- receive the message already waiting for them.
create table if not exists whatsapp_optout (
  -- E.164 without the '+', which is the shape Meta's API wants: 91XXXXXXXXXX.
  msisdn      text primary key,
  reason      text not null default 'stop',
  created_at  timestamptz not null default now()
);

comment on table whatsapp_optout is
  'Numbers that replied STOP. Phone-keyed, not profile-keyed: orders.guest_phone is the only handle we reliably have on a buyer.';

-- RLS on with no policies at all = service role only. Deliberate: this is a list
-- of who asked us to stop, and neither a buyer nor a seller has any business
-- reading it.
alter table whatsapp_optout enable row level security;

-- ── 3) The outbox ────────────────────────────────────────────────────────────
create table if not exists whatsapp_outbox (
  id            uuid primary key default gen_random_uuid(),
  recipient     text not null,                       -- 91XXXXXXXXXX
  template      text not null,                       -- approved Meta template name
  lang          text not null default 'en',          -- template language code
  params        jsonb not null default '[]'::jsonb,  -- ordered {{1}}, {{2}}, … body variables
  category      text not null default 'utility',
  audience      text not null default 'buyer' check (audience in ('buyer', 'seller')),

  -- Idempotency. The unique index is what makes a double send physically
  -- impossible: two concurrent updates racing an order to 'shipped' both compute
  -- the same key, and the second insert is swallowed by ON CONFLICT DO NOTHING.
  dedupe_key    text unique,

  order_id      uuid references orders(id)     on delete set null,
  boutique_id   uuid references boutiques(id)  on delete set null,
  profile_id    uuid references profiles(id)   on delete set null,

  -- stale = queued so long it is no longer worth sending (see wa_claim_batch).
  status        text not null default 'queued'
                check (status in ('queued', 'sent', 'failed', 'suppressed', 'stale')),
  attempts      int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error    text,
  wa_message_id text,
  delivery_status text,                              -- sent|delivered|read|failed, from the webhook
  sent_at       timestamptz,
  created_at    timestamptz not null default now()
);

comment on table whatsapp_outbox is
  'Queue of WhatsApp template messages. Filled by the triggers below and by api/place-order.js, drained by the wa-drain Edge Function on a pg_cron tick.';
comment on column whatsapp_outbox.dedupe_key is
  'Idempotency key, unique. order:<id>:<status>, payout:<id>, boutique:<id>:<status>, lowstock:<product>:<isoweek>. NULL opts a row out of dedupe.';

-- The drainer's only hot query: oldest claimable rows first. Partial, so the
-- index stays small no matter how much sent history accumulates behind it.
create index if not exists idx_wa_outbox_claim
  on whatsapp_outbox (next_attempt_at)
  where status = 'queued';

create index if not exists idx_wa_outbox_recent
  on whatsapp_outbox (created_at desc);

-- The webhook's lookup when Meta reports a delivery/read/failure.
create index if not exists idx_wa_outbox_message
  on whatsapp_outbox (wa_message_id)
  where wa_message_id is not null;

-- Same reasoning as whatsapp_optout: RLS on, no policies. This table holds every
-- customer's phone number next to what they bought.
alter table whatsapp_outbox enable row level security;

-- ── 4) Normalisation helpers ─────────────────────────────────────────────────
--
-- Meta wants a bare E.164 number: no '+', no spaces, no domestic trunk zero.
-- What we actually hold is whatever a seller typed into their profile or a buyer
-- typed at checkout — '+91 93442 94969', '093442 94969', '9344294969'. Anything
-- that cannot be resolved to a plausible Indian mobile returns NULL, and a NULL
-- recipient means the message is never queued at all, which is far better than
-- queueing a row that will fail five times at Meta before giving up.
create or replace function wa_msisdn(p_phone text)
returns text
language plpgsql
immutable
as $$
declare
  d text;
begin
  d := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');

  -- 12 digits, already country-coded.
  if length(d) = 12 and left(d, 2) = '91' and substr(d, 3, 1) between '6' and '9' then
    return d;
  end if;

  -- 11 digits with the domestic trunk '0'.
  if length(d) = 11 and left(d, 1) = '0' and substr(d, 2, 1) between '6' and '9' then
    return '91' || right(d, 10);
  end if;

  -- Plain 10-digit Indian mobile.
  if length(d) = 10 and left(d, 1) between '6' and '9' then
    return '91' || d;
  end if;

  return null;
end;
$$;

comment on function wa_msisdn(text) is
  'Normalise a stored phone to Meta''s 91XXXXXXXXXX form. NULL when it is not a plausible Indian mobile — the caller then queues nothing.';

-- Meta rejects a template variable that is empty, contains a newline, or holds
-- four or more consecutive spaces, and the rejection is a hard error that burns
-- all five retries. Squeeze the whitespace and substitute a dash rather than let
-- a seller's multi-line shop name poison the send.
create or replace function wa_param(p_text text, p_fallback text default '-')
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')), ''),
    p_fallback
  );
$$;

-- ── 5) Enqueue ───────────────────────────────────────────────────────────────
--
-- SECURITY DEFINER because the callers are triggers running as whoever moved the
-- row — a seller marking an order shipped, an admin approving a boutique, the
-- service role placing an order. None of them can write to a table with no
-- policies, and none of them should be granted the ability to.
create or replace function wa_enqueue(
  p_recipient   text,
  p_template    text,
  p_params      text[],
  p_dedupe_key  text,
  p_audience    text default 'buyer',
  p_order_id    uuid default null,
  p_boutique_id uuid default null,
  p_profile_id  uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msisdn text;
  v_id     uuid;
begin
  v_msisdn := wa_msisdn(p_recipient);
  if v_msisdn is null then
    return null;              -- no usable number: nothing to queue
  end if;

  -- First of the two opt-out checks; wa_claim_batch does the second at send time.
  if exists (select 1 from whatsapp_optout where msisdn = v_msisdn) then
    return null;
  end if;

  -- Every parameter is squeezed here, at the single door into the queue, rather
  -- than trusting each caller to have done it. The triggers pass their values
  -- through wa_param already — for the fallback text, not the sanitising — but
  -- api/place-order.js queues rows too, and a product title with a line break in
  -- it must not become a 132012 whichever way it arrived.
  insert into whatsapp_outbox (recipient, template, params, dedupe_key, audience,
                               order_id, boutique_id, profile_id)
  values (v_msisdn, p_template,
          coalesce(
            (select jsonb_agg(wa_param(p) order by ord)
               from unnest(coalesce(p_params, array[]::text[])) with ordinality as t(p, ord)),
            '[]'::jsonb),
          p_dedupe_key, p_audience, p_order_id, p_boutique_id, p_profile_id)
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  return v_id;
end;
$$;

-- Callable by the triggers' invokers and by the service role. Never by anon: an
-- anonymous visitor able to call this could send WhatsApp messages, from our
-- number, at our expense, to any number they chose.
revoke all on function wa_enqueue(text, text, text[], text, text, uuid, uuid, uuid) from public;
grant execute on function wa_enqueue(text, text, text[], text, text, uuid, uuid, uuid) to authenticated, service_role;

-- ── 6) Buyer triggers, on orders ─────────────────────────────────────────────
--
-- Recipient is orders.guest_phone — the number captured at checkout for THIS
-- order, which is the one the buyer expects to hear on even if their profile
-- carries a different one.
create or replace function wa_on_order_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name     text;
  v_boutique text;
begin
  -- Nothing below may abort the seller's status update.
  begin
    v_name := wa_param(split_part(coalesce(new.guest_name, ''), ' ', 1), 'there');
    select wa_param(b.name, 'the boutique') into v_boutique
      from boutiques b where b.id = new.boutique_id;
    v_boutique := coalesce(v_boutique, 'the boutique');

    if new.status = 'shipped' then
      perform wa_enqueue(
        new.guest_phone, 'order_shipped',
        array[v_name, wa_param(new.order_number), v_boutique],
        'order:' || new.id || ':shipped', 'buyer', new.id, new.boutique_id, new.buyer_id);

    elsif new.status = 'delivered' then
      perform wa_enqueue(
        new.guest_phone, 'order_delivered',
        array[v_name, wa_param(new.order_number)],
        'order:' || new.id || ':delivered', 'buyer', new.id, new.boutique_id, new.buyer_id);

    elsif new.status in ('cancelled', 'rejected') then
      perform wa_enqueue(
        new.guest_phone, 'order_cancelled',
        array[v_name, wa_param(new.order_number),
              wa_param(new.cancel_reason, 'the order could not be fulfilled')],
        -- One key for both terminal states: an order that is rejected and later
        -- recorded as cancelled is one piece of news, not two.
        'order:' || new.id || ':cancelled', 'buyer', new.id, new.boutique_id, new.buyer_id);
    end if;
  exception when others then
    raise warning 'wa_on_order_status: % (order % kept its new status)', sqlerrm, new.id;
  end;

  return new;
end;
$$;

drop trigger if exists trg_wa_order_status on orders;
create trigger trg_wa_order_status
  after update of status on orders
  for each row
  when (old.status is distinct from new.status)
  execute function wa_on_order_status();

create or replace function wa_on_order_refunded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  begin
    v_name := wa_param(split_part(coalesce(new.guest_name, ''), ' ', 1), 'there');
    perform wa_enqueue(
      new.guest_phone, 'order_refunded',
      array[v_name, wa_param(new.order_number),
            -- What the buyer was actually billed: goods plus the fees they paid,
            -- less the platform-funded discount they never paid for. The same
            -- arithmetic as the receipt in api/_receipt.js.
            '₹' || to_char(round(coalesce(new.total, 0) + coalesce(new.shipping_fee, 0)
                                 + coalesce(new.cod_fee, 0) - coalesce(new.platform_discount, 0)),
                           'FM999G999G999')],
      'order:' || new.id || ':refunded', 'buyer', new.id, new.boutique_id, new.buyer_id);
  exception when others then
    raise warning 'wa_on_order_refunded: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_wa_order_refunded on orders;
create trigger trg_wa_order_refunded
  after update of refunded on orders
  for each row
  when (new.refunded and not coalesce(old.refunded, false))
  execute function wa_on_order_refunded();

-- ── 7) Seller triggers ───────────────────────────────────────────────────────
--
-- Seller recipient is boutiques.whatsapp, falling back to boutiques.phone. Both
-- are withheld from the browser by 0021/0073's column grants, which is no
-- obstacle here because these run SECURITY DEFINER.
create or replace function wa_on_payout_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
begin
  begin
    select name, whatsapp, phone, owner_id into b
      from boutiques where id = new.boutique_id;
    if not found then return new; end if;

    -- A negative payout is the seller owing US for the cycle (pre-0085 cash
    -- orders still net off, deliberately). Telling them "we have transferred
    -- ₹-1,240" would be plainly wrong, so that case gets no message — their
    -- statement in the console explains it properly.
    if coalesce(new.amount, 0) <= 0 then return new; end if;

    perform wa_enqueue(
      coalesce(b.whatsapp, b.phone), 'seller_payout_paid',
      array[wa_param(b.name, 'Seller'),
            '₹' || to_char(round(new.amount), 'FM999G999G999'),
            wa_param(new.utr, 'see your payout statement')],
      'payout:' || new.id, 'seller', null, new.boutique_id, b.owner_id);
  exception when others then
    raise warning 'wa_on_payout_paid: %', sqlerrm;
  end;
  return new;
end;
$$;

-- INSERT as well as UPDATE: settle_boutique_payout (0026) inserts the row and
-- then stamps it 'paid', and payouts.status defaults to 'paid' anyway, so a
-- directly-inserted payout would otherwise never fire. The shared dedupe key
-- 'payout:<id>' is what stops the two paths from both landing.
drop trigger if exists trg_wa_payout_paid on payouts;
create trigger trg_wa_payout_paid
  after insert or update of status on payouts
  for each row
  when (new.status = 'paid')
  execute function wa_on_payout_paid();

create or replace function wa_on_boutique_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.status not in ('approved', 'rejected') then return new; end if;

    perform wa_enqueue(
      coalesce(new.whatsapp, new.phone), 'seller_boutique_decision',
      array[wa_param(new.name, 'Seller'),
            case when new.status = 'approved' then 'approved' else 'sent back for changes' end,
            wa_param(new.review_note,
                     case when new.status = 'approved'
                          then 'You can start listing right away.'
                          else 'Open your console for the details.' end)],
      'boutique:' || new.id || ':' || new.status, 'seller', null, new.id, new.owner_id);
  exception when others then
    raise warning 'wa_on_boutique_decision: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_wa_boutique_decision on boutiques;
create trigger trg_wa_boutique_decision
  after update of status on boutiques
  for each row
  when (old.status is distinct from new.status)
  execute function wa_on_boutique_decision();

-- Low stock. Fires on the crossing only (was above three, now at or below), so a
-- shop selling its last three units one at a time is told once, not three times.
-- The ISO-week component of the dedupe key is the real spam guard: restocking to
-- ten and selling back down inside the same week stays silent.
create or replace function wa_on_low_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
begin
  begin
    if new.status <> 'active' or new.deleted_at is not null then return new; end if;

    select name, whatsapp, phone, owner_id, status into b
      from boutiques where id = new.boutique_id;
    if not found or b.status <> 'approved' then return new; end if;

    perform wa_enqueue(
      coalesce(b.whatsapp, b.phone), 'seller_low_stock',
      array[wa_param(b.name, 'Seller'), wa_param(new.title, 'a listing'), new.stock::text],
      'lowstock:' || new.id || ':' || to_char(now() at time zone 'Asia/Kolkata', 'IYYY-IW'),
      'seller', null, new.boutique_id, b.owner_id);
  exception when others then
    raise warning 'wa_on_low_stock: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_wa_low_stock on products;
create trigger trg_wa_low_stock
  after update of stock on products
  for each row
  when (new.stock <= 3 and old.stock > 3)
  execute function wa_on_low_stock();

-- ── 8) The drainer's claim ───────────────────────────────────────────────────
--
-- FOR UPDATE SKIP LOCKED is what makes overlapping cron ticks safe: a slow batch
-- still running when the next minute fires simply cannot see the rows the first
-- one holds, so nothing goes out twice.
--
-- Three things are settled here rather than in TypeScript, so they hold no
-- matter who calls the function:
--   · the kill switch — false returns zero rows;
--   · the second opt-out check, catching a STOP that arrived while queued;
--   · staleness — "your order has shipped" that has sat in the queue for a day
--     is not worth sending, and a backlog built up while the switch was off must
--     not flood everyone the moment it is flipped.
create or replace function wa_claim_batch(p_limit int default 20, p_stale_hours int default 24)
returns setof whatsapp_outbox
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
begin
  select whatsapp_enabled into v_enabled from platform_settings where id = 1;
  if not coalesce(v_enabled, false) then
    return;
  end if;

  update whatsapp_outbox o
     set status = 'stale'
   where o.status = 'queued'
     and o.created_at < now() - make_interval(hours => greatest(coalesce(p_stale_hours, 24), 1));

  update whatsapp_outbox o
     set status = 'suppressed', last_error = 'recipient opted out'
   where o.status = 'queued'
     and exists (select 1 from whatsapp_optout x where x.msisdn = o.recipient);

  return query
  with claimed as (
    select o.id
      from whatsapp_outbox o
     where o.status = 'queued'
       and o.next_attempt_at <= now()
     order by o.next_attempt_at
     limit greatest(coalesce(p_limit, 20), 1)
     for update skip locked
  )
  update whatsapp_outbox o
     set attempts = o.attempts + 1,
         -- Held off the queue for two minutes. If the drainer dies mid-batch —
         -- a timeout, a redeploy — the row comes back on its own rather than
         -- being stranded in a 'sending' state with nobody to clear it.
         next_attempt_at = now() + interval '2 minutes'
    from claimed c
   where o.id = c.id
  returning o.*;
end;
$$;

revoke all on function wa_claim_batch(int, int) from public;
grant execute on function wa_claim_batch(int, int) to service_role;

-- ── 9) Admin visibility ──────────────────────────────────────────────────────
--
-- The tables have no policies, so the admin console cannot read them directly —
-- and should not, since that would mean handing the browser a view of every
-- customer's phone number. These two functions answer the only operational
-- questions instead: is it moving, and what is failing. Without them an expired
-- access token is invisible until somebody notices nobody has been messaged.
-- The output columns are `bucket`/`total`, not `status`/`count`. A RETURNS TABLE
-- column is an OUT parameter, and naming one `count` next to a `count(*)` in the
-- body is exactly the kind of ambiguity that turns into a runtime error nobody
-- sees until an admin opens the page.
create or replace function wa_outbox_stats()
returns table (bucket text, total bigint, newest timestamptz)
language sql
security definer
set search_path = public
as $$
  select o.status, count(*)::bigint, max(o.created_at)
    from whatsapp_outbox o
   where is_admin()
   group by o.status;
$$;

create or replace function wa_outbox_failures(p_limit int default 20)
returns table (
  id uuid, template text, audience text, recipient_masked text,
  attempts int, last_error text, created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select o.id, o.template, o.audience,
         -- Enough to recognise a number you already know, not enough to harvest
         -- one you do not.
         left(o.recipient, 4) || '••••' || right(o.recipient, 2),
         o.attempts, o.last_error, o.created_at
    from whatsapp_outbox o
   where is_admin()
     and o.status = 'failed'
   order by o.created_at desc
   limit greatest(coalesce(p_limit, 20), 1);
$$;

-- `to authenticated`, with the is_admin() gate inside the body — never left to
-- PUBLIC, which reaches `anon` and is the mistake that blanked the storefront in
-- 0086. is_admin() is itself safe to call from anon (it is never revoked), but
-- an anonymous visitor has no reason to reach these at all.
revoke all on function wa_outbox_stats() from public;
revoke all on function wa_outbox_failures(int) from public;
grant execute on function wa_outbox_stats() to authenticated;
grant execute on function wa_outbox_failures(int) to authenticated;
