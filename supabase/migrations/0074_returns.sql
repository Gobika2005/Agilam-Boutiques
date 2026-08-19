-- Returns: give the buyer a way to actually ask for one.
--
-- Idempotent and re-runnable in the Supabase SQL editor. Requires 0022 (orders,
-- payment_status), 0044 (notifications), 0048 (platform_settings) and 0063
-- (delivered_at).
--
-- ── Why this exists ─────────────────────────────────────────────────────────
--
-- `platform_settings.return_window_days` has been an editable field in the admin
-- console since 0048 and was read by NOTHING. The Return & Refund Policy page
-- promised buyers a window and told them to "raise the request from My Orders";
-- there was no such control, no table behind it, and no seller-side queue. A
-- buyer whose kurta arrived torn had exactly one route — message the boutique in
-- chat and hope. Meanwhile /admin/refunds could record a refund, so the money
-- half existed while the request half did not.
--
-- This is the missing half: a request the buyer raises, the seller answers, and
-- the admin can settle against.
--
-- ── The window, and why the reason decides whether it applies ────────────────
--
-- `return_window_days` is a GOODWILL window — change of mind, doesn't suit,
-- wrong size. Setting it to 0 (as production currently has it) is a legitimate
-- commercial choice meaning "we don't take those back".
--
-- It is NOT the limit on a faulty item. A parcel that arrives damaged, defective
-- or simply not what was ordered is a different claim, and one the Consumer
-- Protection (E-Commerce) Rules 2020 do not let a marketplace switch off with a
-- settings toggle. So fault reasons are always accepted while the order is
-- recent, and only the goodwill reasons are gated on the window. That split is
-- enforced here, in `request_return`, rather than in the browser — a client-side
-- window check is a suggestion.

-- ── The request ─────────────────────────────────────────────────────────────
create table if not exists return_requests (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders(id) on delete cascade,
  -- Denormalised from the order so seller-side RLS and the console list do not
  -- need a join on every read. Set by request_return(), never by the client.
  boutique_id uuid not null references boutiques(id) on delete cascade,
  buyer_id    uuid not null references profiles(id) on delete cascade,

  -- Fault reasons (damaged/defective/wrong_item/not_as_described) bypass the
  -- goodwill window; the rest do not. Kept as a CHECK rather than an enum type
  -- so adding a reason later is one migration, not a type rewrite.
  reason text not null check (reason in (
    'damaged', 'defective', 'wrong_item', 'not_as_described',
    'size_issue', 'changed_mind'
  )),
  note   text not null default '',
  -- Buyer-supplied evidence, in the existing public review-images bucket.
  photos text[] not null default '{}',

  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'refunded')),
  -- The seller's answer, shown to the buyer. Required to reject, so nobody is
  -- refused without being told why (mirrors 0021's boutique review_note rule).
  seller_note text,

  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id) on delete set null
);

-- One open request per order. A buyer who was rejected can be allowed to raise a
-- corrected one, so the index covers only the live states.
create unique index if not exists return_requests_one_open
  on return_requests (order_id)
  where status in ('requested', 'approved');

create index if not exists return_requests_boutique_idx on return_requests (boutique_id, status, created_at desc);
create index if not exists return_requests_buyer_idx    on return_requests (buyer_id, created_at desc);

alter table return_requests enable row level security;

-- Buyer reads their own; seller reads their shop's; admin reads all.
drop policy if exists "returns: read own" on return_requests;
create policy "returns: read own" on return_requests for select
  using (
    buyer_id = auth.uid()
    or exists (select 1 from boutiques b where b.id = boutique_id and b.owner_id = auth.uid())
    or is_admin()
  );

-- Deliberately NO insert or update policy for anyone.
--
-- Both writes go through the SECURITY DEFINER functions below, because both
-- carry rules a policy cannot express: an INSERT has to re-derive the boutique
-- from the order and re-check the window server-side, and an UPDATE has to stop
-- a seller from writing `status` to anything they like on a row they own. A
-- table with RLS on and no write policy denies every direct write, which is
-- exactly what we want the anon key to hit.

-- ── Raising one ─────────────────────────────────────────────────────────────
--
-- Returns the new row's id, or raises with a message the UI shows verbatim.
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
  -- Ownership, checked here rather than trusted: this function runs as the
  -- table owner, so the caller's own RLS does not apply inside it.
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
  select coalesce(return_window_days, 0) into v_window from platform_settings where id = 1;

  if v_is_fault then
    -- A fault claim is not governed by the goodwill window, but it cannot stay
    -- open forever either — beyond a month there is no way to tell a delivery
    -- fault from ordinary wear. 30 days is the outer bound, independent of the
    -- admin setting.
    if v_order.delivered_at < now() - interval '30 days' then
      raise exception 'This order was delivered more than 30 days ago. Please message the boutique instead.'
        using errcode = 'check_violation';
    end if;
  else
    if v_window <= 0 then
      raise exception 'We don''t accept change-of-mind returns. If the item is damaged, faulty or not what you ordered, choose that reason instead.'
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

  -- Tell the seller. Best-effort by construction: notifications has its own
  -- constraints and a failure here must not lose the request.
  begin
    insert into notifications (profile_id, type, title, body, order_id)
    select b.owner_id, 'Orders',
           'Return requested',
           format('A buyer has asked to return an item from order %s. Reason: %s.',
                  (select order_number from orders where id = p_order_id),
                  replace(p_reason, '_', ' ')),
           p_order_id
      from boutiques b
     where b.id = v_order.boutique_id;
  exception when others then
    null;
  end;

  return v_id;
end;
$$;

revoke all on function request_return(uuid, text, text, text[]) from public, anon;
grant execute on function request_return(uuid, text, text, text[]) to authenticated;

-- ── Answering one ───────────────────────────────────────────────────────────
--
-- The seller (or an admin) approves or rejects. Deliberately does NOT move any
-- money: marking an order refunded stays with /admin/refunds, which is where the
-- Razorpay refund is actually issued. This only records the decision.
create or replace function resolve_return_request(
  p_request_id uuid,
  p_status     text,
  p_note       text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req record;
  v_is_owner boolean;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'A return can only be approved or rejected here.' using errcode = 'check_violation';
  end if;

  select r.*, o.order_number into v_req
    from return_requests r join orders o on o.id = r.order_id
   where r.id = p_request_id;
  if not found then
    raise exception 'Return request not found.' using errcode = 'no_data_found';
  end if;

  select exists (select 1 from boutiques b where b.id = v_req.boutique_id and b.owner_id = auth.uid())
    into v_is_owner;
  if not (v_is_owner or is_admin()) then
    raise exception 'That is not your order.' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status <> 'requested' then
    raise exception 'This request has already been answered.' using errcode = 'check_violation';
  end if;
  -- Nobody is refused without a reason.
  if p_status = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Please tell the buyer why you cannot accept this return.' using errcode = 'check_violation';
  end if;

  update return_requests
     set status = p_status,
         seller_note = nullif(btrim(coalesce(p_note, '')), ''),
         resolved_at = now(),
         resolved_by = auth.uid()
   where id = p_request_id;

  begin
    insert into notifications (profile_id, type, title, body, order_id)
    values (
      v_req.buyer_id, 'Orders',
      case when p_status = 'approved' then 'Return approved' else 'Return not accepted' end,
      case when p_status = 'approved'
        then format('Your return for order %s has been approved. The boutique will be in touch about collection.', v_req.order_number)
        else format('Your return for order %s was not accepted. %s', v_req.order_number, coalesce(p_note, ''))
      end,
      v_req.order_id
    );
  exception when others then
    null;
  end;
end;
$$;

revoke all on function resolve_return_request(uuid, text, text) from public, anon;
grant execute on function resolve_return_request(uuid, text, text) to authenticated;

-- ── Verify ──────────────────────────────────────────────────────────────────
--   select * from return_requests order by created_at desc limit 20;
--   -- as a signed-in buyer, on somebody else's order, should raise:
--   select request_return('<another buyer''s order id>', 'damaged');
