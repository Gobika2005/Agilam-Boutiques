-- ═══════════════════════════════════════════════════════════════════════════════
-- 0091 — Record inbound WhatsApp messages, and read the log from the console
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- 0090 gave us an outbox: everything the platform SENDS is a row, with its
-- delivery receipt. Nothing recorded what came back. `wa-webhook` read each
-- inbound message, acted on it (STOP/START, fire the auto-reply) and dropped it,
-- so there was no way to answer "what did this customer actually ask us?"
--
-- This adds the other half and the read path for both, so the admin console can
-- show a threaded, read-only log of the whole conversation.
--
-- WHY A LOG AT ALL WHEN META BUSINESS SUITE EXISTS
-- Business Suite is the place replies are written, and stays so — this is
-- deliberately read-only, so there is never a question of two people answering
-- from two places. What Business Suite cannot do is put the conversation next to
-- the order it is about: it has no idea what AGL-W08JR8D12B is. That, plus not
-- needing a Meta account for every staff member who has to look something up, is
-- the whole justification.
--
-- THE MASKING IS REAL, NOT COSMETIC
-- The thread list returns numbers ALREADY masked, keyed by a hash. Revealing one
-- is a separate, deliberate call. Returning the full number and hiding it in CSS
-- would put every customer's phone number in a JSON payload that any open
-- DevTools panel shows — which is not masking, it is the appearance of masking.
--
-- Requires 0090 (whatsapp_outbox) and 0048 (is_admin).
-- Idempotent and re-runnable in the Supabase SQL editor.

-- ── 1) Inbound messages ──────────────────────────────────────────────────────
create table if not exists whatsapp_inbound (
  id            uuid primary key default gen_random_uuid(),
  msisdn        text not null,                     -- 91XXXXXXXXXX, as Meta sends it

  -- Meta retries a webhook it thinks failed, and can redeliver on its own
  -- schedule. The unique id is what stops one customer message becoming three
  -- rows in the log.
  wa_message_id text unique,

  msg_type      text not null default 'text',      -- text | image | button | interactive | …
  body          text,                              -- extracted text, or the button label
  profile_name  text,                              -- WhatsApp display name, as given
  received_at   timestamptz,                       -- Meta's timestamp, not ours
  created_at    timestamptz not null default now()
);

comment on table whatsapp_inbound is
  'Messages customers sent TO the platform number. Written by wa-webhook. Read-only log — replies are still written in Meta Business Suite.';

create index if not exists idx_wa_inbound_msisdn on whatsapp_inbound (msisdn, created_at desc);
create index if not exists idx_wa_inbound_recent on whatsapp_inbound (created_at desc);

-- Same posture as whatsapp_outbox and whatsapp_optout: RLS on, no policies at
-- all, so nothing but the service role touches it. The console reads through the
-- admin-gated functions below and never through the table.
alter table whatsapp_inbound enable row level security;

-- ── 2) Thread key ────────────────────────────────────────────────────────────
--
-- A stable, non-reversible handle for one conversation. The console addresses
-- threads by this, so a number is never in a URL, a React prop or a network tab
-- until someone explicitly asks to see it.
create or replace function wa_thread_key(p_msisdn text)
returns text
language sql
immutable
as $$
  select md5('wa:' || coalesce(p_msisdn, ''));
$$;

-- Mask helper, so the list and the message rows agree on one format.
create or replace function wa_mask(p_msisdn text)
returns text
language sql
immutable
as $$
  select case
    when length(coalesce(p_msisdn, '')) < 6 then '••••'
    else left(p_msisdn, 4) || '••••' || right(p_msisdn, 2)
  end;
$$;

-- ── 3) Thread list ───────────────────────────────────────────────────────────
--
-- One row per phone number we have ever exchanged a message with, newest
-- conversation first. Both directions are folded together so a thread appears
-- whether the customer wrote first or we did.
create or replace function wa_threads(p_limit int default 100)
returns table (
  thread_key   text,
  masked       text,
  profile_name text,
  last_at      timestamptz,
  last_body    text,
  last_dir     text,
  in_count     bigint,
  out_count    bigint,
  opted_out    boolean
)
language sql
security definer
set search_path = public
as $$
  with msgs as (
    select i.msisdn, i.created_at, i.body, 'in'::text as dir, i.profile_name
      from whatsapp_inbound i
     where is_admin()
    union all
    select o.recipient, o.created_at,
           -- An auto-reply stores its finished text; a template stores only the
           -- parameters, because the wording lives at Meta and we never held it.
           -- Showing name + parameters is honest about that rather than
           -- inventing a body we cannot reconstruct.
           case
             when o.template = 'auto_reply' then o.params ->> 0
             else o.template || ' · ' || coalesce(
               (select string_agg(v, ', ') from jsonb_array_elements_text(o.params) as t(v)), '')
           end,
           'out'::text, null
      from whatsapp_outbox o
     where is_admin()
  ),
  ranked as (
    select m.*, row_number() over (partition by m.msisdn order by m.created_at desc) as rn
      from msgs m
  )
  select wa_thread_key(r.msisdn),
         wa_mask(r.msisdn),
         -- The most recent name WhatsApp gave us for this number.
         (select i.profile_name from whatsapp_inbound i
           where i.msisdn = r.msisdn and i.profile_name is not null
           order by i.created_at desc limit 1),
         r.created_at,
         left(coalesce(r.body, ''), 160),
         r.dir,
         (select count(*) from whatsapp_inbound i where i.msisdn = r.msisdn),
         (select count(*) from whatsapp_outbox o where o.recipient = r.msisdn),
         exists (select 1 from whatsapp_optout x where x.msisdn = r.msisdn)
    from ranked r
   where r.rn = 1
   order by r.created_at desc
   limit greatest(coalesce(p_limit, 100), 1);
$$;

-- ── 4) One conversation ──────────────────────────────────────────────────────
--
-- Both directions merged in time order. Addressed by thread key, so opening a
-- conversation still does not put the number on the wire.
create or replace function wa_thread_messages(p_key text, p_limit int default 200)
returns table (
  at        timestamptz,
  dir       text,
  body      text,
  msg_type  text,
  status    text,
  delivery  text,
  err       text
)
language sql
security definer
set search_path = public
as $$
  select i.created_at, 'in'::text, i.body, i.msg_type,
         null::text, null::text, null::text
    from whatsapp_inbound i
   where is_admin() and wa_thread_key(i.msisdn) = p_key
  union all
  select o.created_at, 'out'::text,
         case
           when o.template = 'auto_reply' then o.params ->> 0
           else o.template || ' · ' || coalesce(
             (select string_agg(v, ', ') from jsonb_array_elements_text(o.params) as t(v)), '')
         end,
         o.category, o.status, o.delivery_status, o.last_error
    from whatsapp_outbox o
   where is_admin() and wa_thread_key(o.recipient) = p_key
   order by 1
   limit greatest(coalesce(p_limit, 200), 1);
$$;

-- ── 5) Reveal, deliberately ──────────────────────────────────────────────────
--
-- The only way a full customer number leaves the database. Separate call, one
-- number at a time, so it cannot be used to dump the list — and the console logs
-- each reveal to admin_activity_log, which is what makes "who looked at this
-- customer's number" answerable later.
create or replace function wa_reveal_msisdn(p_key text)
returns text
language sql
security definer
set search_path = public
as $$
  select msisdn from (
    select i.msisdn from whatsapp_inbound i where wa_thread_key(i.msisdn) = p_key
    union
    select o.recipient from whatsapp_outbox o where wa_thread_key(o.recipient) = p_key
  ) s
  where is_admin()
  limit 1;
$$;

-- Admin console only. `to authenticated` with the is_admin() gate inside — never
-- left at PUBLIC, which reaches `anon` and is the mistake that blanked the
-- storefront in 0086.
revoke all on function wa_threads(int) from public;
revoke all on function wa_thread_messages(text, int) from public;
revoke all on function wa_reveal_msisdn(text) from public;
grant execute on function wa_threads(int) to authenticated;
grant execute on function wa_thread_messages(text, int) to authenticated;
grant execute on function wa_reveal_msisdn(text) to authenticated;
