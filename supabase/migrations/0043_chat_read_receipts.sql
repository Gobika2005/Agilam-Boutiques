-- Chat read receipts (double-tick).
--
-- The chat had no notion of "read" at all — the inbox's unread badge is
-- inferred by counting trailing messages, but a sent bubble never showed
-- whether the other side had actually seen it. Adds one "I last read this
-- conversation at…" timestamp per participant, and an RPC to stamp it, so a
-- message can be marked read (blue double-tick) once the peer's last-read
-- time passes its created_at, vs merely sent (grey double-tick) until then.
--
-- A SECURITY DEFINER RPC rather than an UPDATE RLS policy: row-level security
-- can't restrict *which column* a participant changes, and the two
-- last-read-at columns must only ever be written by their own side — a buyer
-- marking the boutique's column read (or vice versa) would fake the other
-- person's read receipt.
--
-- Additive and idempotent. Run once in the Supabase SQL editor after 0001+.

alter table conversations add column if not exists buyer_last_read_at timestamptz;
alter table conversations add column if not exists boutique_last_read_at timestamptz;

create or replace function mark_conversation_read(p_conversation_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_role = 'buyer' then
    update conversations set buyer_last_read_at = now()
      where id = p_conversation_id and buyer_id = auth.uid();
  elsif p_role = 'seller' then
    update conversations c set boutique_last_read_at = now()
      from boutiques b
      where c.id = p_conversation_id and c.boutique_id = b.id and b.owner_id = auth.uid();
  else
    raise exception 'invalid role';
  end if;
end;
$$;

grant execute on function mark_conversation_read(uuid, text) to authenticated;
