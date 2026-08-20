-- ═══════════════════════════════════════════════════════════════════════════════
-- 0092 — Four more WhatsApp events, and the moderation note a seller was never given
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- 0090 wired seven events; this adds the ones the coverage review found missing.
-- Everything here follows that file's pattern exactly: a trigger calls
-- `wa_enqueue`, the body is wrapped so it can never abort the write that fired
-- it, and a dedupe key makes a double send impossible.
--
-- WHAT THIS ADDS
--   · order_accepted           buyer, orders.status → accepted
--   · seller_boutique_decision now also fires on `changes_requested` (a bug fix,
--                              see below) — no new template, the existing one
--                              already takes the decision as a variable
--   · seller_ad_decision       seller, ad_campaigns.status → live/rejected/changes_requested
--   · seller_product_rejected  seller, products.status → rejected
--   · seller_dispatch_overdue  seller, a SWEEP not a trigger — see §6
--
-- THE BUG THIS CLOSES
-- `BoutiqueStatus` has five values and 0090's trigger handled two. A seller whose
-- application was sent back with `changes_requested` received nothing at all and
-- simply stalled, holding a shop they could not open and no idea why. That is the
-- most expensive possible place in the funnel to go silent, and it was silent.
--
-- Requires 0090 (wa_enqueue, whatsapp_outbox), 0032 (ad_campaigns),
-- 0078b (boutiques.dispatch_days_max).
-- Idempotent and re-runnable in the Supabase SQL editor.

-- ── 1) Somewhere to record WHY a listing was refused ─────────────────────────
--
-- `boutiques.review_note` has existed since 0021 and is exactly this, for shops.
-- Products never got the equivalent, so moderation could reject a listing and the
-- seller was told only that it failed. A rejection with no reason is not feedback,
-- it is a support ticket — the seller has no option but to ask a human what to fix.
alter table products add column if not exists review_note text;

comment on column products.review_note is
  'Why a listing was rejected or hidden by moderation. Shown to the seller in their console and quoted in the seller_product_rejected WhatsApp message. Mirrors boutiques.review_note.';

-- ── 2) Buyer: the boutique accepted your order ───────────────────────────────
--
-- Folded into 0090's existing `wa_on_order_status` rather than given a trigger of
-- its own: that function already fires on every status change and branches, so a
-- second trigger on the same column would be two functions to keep in step for no
-- gain. Replaced wholesale here because CREATE OR REPLACE cannot add a branch.
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
  begin
    v_name := wa_param(split_part(coalesce(new.guest_name, ''), ' ', 1), 'there');
    select wa_param(b.name, 'the boutique') into v_boutique
      from boutiques b where b.id = new.boutique_id;
    v_boutique := coalesce(v_boutique, 'the boutique');

    if new.status = 'accepted' then
      perform wa_enqueue(
        new.guest_phone, 'order_accepted',
        array[v_name, wa_param(new.order_number), v_boutique],
        'order:' || new.id || ':accepted', 'buyer', new.id, new.boutique_id, new.buyer_id);

    elsif new.status = 'shipped' then
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

-- ── 3) Seller: the shop decision, now including "sent back" ──────────────────
create or replace function wa_on_boutique_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_decision text;
  v_fallback text;
begin
  begin
    -- `draft` and `pending` are states the shop passes THROUGH on its own; only
    -- the three an admin decides are worth a message.
    if new.status not in ('approved', 'rejected', 'changes_requested') then
      return new;
    end if;

    v_decision := case new.status
      when 'approved'          then 'approved'
      when 'rejected'          then 'not approved'
      else                          'sent back for changes'
    end;

    v_fallback := case new.status
      when 'approved' then 'You can start listing right away.'
      when 'rejected' then 'Open your console for the details.'
      -- The one that matters: a seller sent back needs to know something is
      -- required of them, not merely that the status moved.
      else 'Please update the details asked for and resubmit.'
    end;

    perform wa_enqueue(
      coalesce(new.whatsapp, new.phone), 'seller_boutique_decision',
      array[wa_param(new.name, 'Seller'), v_decision, wa_param(new.review_note, v_fallback)],
      'boutique:' || new.id || ':' || new.status, 'seller', null, new.id, new.owner_id);
  exception when others then
    raise warning 'wa_on_boutique_decision: %', sqlerrm;
  end;
  return new;
end;
$$;

-- ── 4) Seller: ad campaign decisions ─────────────────────────────────────────
--
-- Three of AdStatus's eight values. `pending_payment` and `pending_review` are
-- waiting states, `scheduled` is the seller's own choice, and `paused`/`refunded`
-- are usually admin housekeeping — none of them is a decision the seller must act
-- on. These three are.
create or replace function wa_on_ad_decision()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
  v_decision text;
  v_note     text;
begin
  begin
    if new.status not in ('live', 'rejected', 'changes_requested') then
      return new;
    end if;

    select name, whatsapp, phone, owner_id into b
      from boutiques where id = new.boutique_id;
    if not found then return new; end if;

    v_decision := case new.status
      when 'live'    then 'live now'
      when 'rejected' then 'not approved'
      else                 'needs changes'
    end;

    -- reject_reason (0032) is filled on refusal and cleared on approval, so a
    -- live campaign correctly falls through to the positive line.
    v_note := case
      when new.status = 'live' then 'It is showing on the storefront now.'
      else coalesce(nullif(btrim(coalesce(new.reject_reason, '')), ''),
                    'Open your console to see what needs changing.')
    end;

    perform wa_enqueue(
      coalesce(b.whatsapp, b.phone), 'seller_ad_decision',
      array[wa_param(b.name, 'Seller'), wa_param(new.headline, 'your campaign'),
            v_decision, wa_param(v_note)],
      'ad:' || new.id || ':' || new.status, 'seller', null, new.boutique_id, b.owner_id);
  exception when others then
    raise warning 'wa_on_ad_decision: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_wa_ad_decision on ad_campaigns;
create trigger trg_wa_ad_decision
  after update of status on ad_campaigns
  for each row
  when (old.status is distinct from new.status)
  execute function wa_on_ad_decision();

-- ── 5) Seller: a listing was refused ─────────────────────────────────────────
--
-- Only a deliberate moderation refusal. `auto_hidden` marks the products 0038's
-- cascade pulled when a boutique was rejected — the seller is already being told
-- about the boutique, and a message per listing on top of that would be a burst
-- of identical bad news for one decision.
create or replace function wa_on_product_rejected()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b record;
begin
  begin
    if coalesce(new.auto_hidden, false) then return new; end if;

    select name, whatsapp, phone, owner_id into b
      from boutiques where id = new.boutique_id;
    if not found then return new; end if;

    perform wa_enqueue(
      coalesce(b.whatsapp, b.phone), 'seller_product_rejected',
      array[wa_param(b.name, 'Seller'), wa_param(new.title, 'your listing'),
            wa_param(new.review_note, 'Open your console to see what needs changing.')],
      'product:' || new.id || ':rejected', 'seller', null, new.boutique_id, b.owner_id);
  exception when others then
    raise warning 'wa_on_product_rejected: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_wa_product_rejected on products;
create trigger trg_wa_product_rejected
  after update of status on products
  for each row
  when (new.status = 'rejected' and old.status is distinct from 'rejected')
  execute function wa_on_product_rejected();

-- ── 6) Seller: dispatch overdue ──────────────────────────────────────────────
--
-- WHY THIS ONE IS A SWEEP AND NOT A TRIGGER
-- Every other event here is a row changing. This one is a row NOT changing: the
-- deadline passes and the database is completely still. There is nothing to hang
-- a trigger on, so something has to come looking.
--
-- ONCE PER ORDER, EVER. The dedupe key carries no date, so however many times the
-- sweep runs, an order can produce exactly one overdue message. A seller who is
-- travelling gets one firm nudge, not a daily accumulation that ends with them
-- muting the number — and a muted seller also stops seeing new-order alerts,
-- which costs everyone more than the late parcel did.
--
-- The deadline is the shop's OWN published promise (`dispatch_days_max`, 0078b),
-- plus a day's grace. We are enforcing what the seller told the buyer, not a
-- number the platform invented.
create or replace function wa_sweep_dispatch_overdue(p_grace_days int default 1)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r     record;
  n     int := 0;
  v_id  uuid;
begin
  for r in
    select o.id, o.order_number, o.boutique_id,
           b.name, b.whatsapp, b.phone, b.owner_id, b.dispatch_days_max
      from orders o
      join boutiques b on b.id = o.boutique_id
     where o.status in ('pending', 'accepted')      -- not yet handed to a courier
       and o.payment_status = 'paid'
       and o.created_at < now()
           - make_interval(days => coalesce(b.dispatch_days_max, 2)
                                 + greatest(coalesce(p_grace_days, 1), 0))
       -- Cheap pre-filter. wa_enqueue's unique dedupe_key is the actual guarantee;
       -- this only keeps the sweep from re-walking orders it has already handled.
       and not exists (
         select 1 from whatsapp_outbox w
          where w.dedupe_key = 'dispatch:' || o.id
       )
  loop
    v_id := wa_enqueue(
      coalesce(r.whatsapp, r.phone), 'seller_dispatch_overdue',
      array[wa_param(r.name, 'Seller'), wa_param(r.order_number),
            coalesce(r.dispatch_days_max, 2)::text],
      'dispatch:' || r.id, 'seller', r.id, r.boutique_id, r.owner_id);
    if v_id is not null then n := n + 1; end if;
  end loop;

  return n;
end;
$$;

revoke all on function wa_sweep_dispatch_overdue(int) from public;
grant execute on function wa_sweep_dispatch_overdue(int) to service_role;

comment on function wa_sweep_dispatch_overdue(int) is
  'Queues one seller_dispatch_overdue message per late order, once ever. Schedule daily via pg_cron; see the comment block below.';

-- ── 7) Schedule the sweep ────────────────────────────────────────────────────
--
-- Run ONCE by hand after applying this file. Kept out of the migration body on
-- purpose: cron.schedule is not idempotent in a useful way here, and a migration
-- that silently rewrites a scheduled job is a migration nobody can re-run safely.
--
--   select cron.schedule('wa-dispatch-overdue', '30 4 * * *', $sweep$
--     select wa_sweep_dispatch_overdue(1);
--   $sweep$);
--
-- 04:30 UTC is 10:00 IST — a seller reads a "you are late" message at the start
-- of a working day, when they can act on it, rather than at 3am. Daily, because
-- the dedupe key makes repetition harmless and a fixed hour keeps it predictable.
