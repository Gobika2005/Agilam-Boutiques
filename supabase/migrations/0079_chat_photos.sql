-- Chat photos — the attach button in the composer, made real.
--
-- The button has always been there and has always answered "Photo sharing is
-- coming soon". It is the most-asked-for thing in a boutique conversation: a
-- buyer photographs a design she wants copied, a seller replies with the fabric
-- she has. Both sides can now send one.
--
-- Two decisions are encoded here, and they are the reason this needs SQL at all:
--
--  1. **The bucket is PRIVATE.** Product and review photos are public because
--     they are advertisements. A chat photo is not: buyers send pictures of
--     themselves, of their homes, of a receipt, of a wedding invitation with an
--     address on it. A public bucket makes every one of those readable by
--     anyone who ever sees the URL, forever. Images are served through
--     short-lived signed URLs instead — the same pattern as the expense proofs
--     in 0056.
--
--  2. **The path IS the access rule.** An object is stored at
--     `<conversation_id>/<random>.<ext>`, and the policies below resolve that
--     first segment back to the conversation and check the reader is one of its
--     two participants. Nothing else can read it — not another buyer, not
--     another boutique.
--
-- `messages` needs no new column: the body carries an `@@IMAGE@@{…}` marker,
-- exactly like the product and order cards already do (see src/data/chat.ts).
-- What it does need is the preview function below, or the raw marker leaks into
-- the inbox list and the "New message" notification.
--
-- Idempotent: re-runnable in the Supabase SQL editor.

-- ── The bucket ──────────────────────────────────────────────────────────────
-- Limits are set here rather than trusted to the client, because bucket rules
-- are enforced by storage itself on every path in — the reasoning in 0072.
-- 8 MB is generous for a photo the client has already downscaled to 1600px and
-- re-encoded as JPEG — the allowlist is deliberately narrower than what a phone
-- produces, because everything goes through that canvas step (see
-- src/lib/chatPhoto.ts). HEIC is absent on purpose: it would let a hand-rolled
-- client store a file most browsers cannot display. No PDFs either — this is a
-- photo control, and an arbitrary-file channel between strangers is a malware
-- vector nobody asked for.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images', 'chat-images', false, 8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
   set public = false,
       file_size_limit = 8388608,
       allowed_mime_types = excluded.allowed_mime_types;

-- ── Who may touch an object ─────────────────────────────────────────────────
-- The first path segment is the conversation id. `storage.foldername(name)`
-- returns the path as a text[], so element 1 is that segment; it is cast
-- defensively because a hand-crafted upload path is attacker-controlled and a
-- bad cast would raise instead of simply denying.
create or replace function public.chat_object_conversation(object_name text)
returns uuid
language plpgsql
immutable
set search_path = public
as $$
declare
  v_first text := (storage.foldername(object_name))[1];
begin
  return v_first::uuid;
exception when others then
  return null;
end;
$$;

grant execute on function public.chat_object_conversation(text) to authenticated;

-- Is the caller one of the two people in this conversation? Deliberately NOT
-- `is_admin()`-inclusive: an admin can moderate a reported message through the
-- service role, but the ordinary admin console has no business quietly reading
-- private photographs.
create or replace function public.can_use_chat_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from conversations c
      left join boutiques b on b.id = c.boutique_id
     where c.id = p_conversation
       and (c.buyer_id = auth.uid() or b.owner_id = auth.uid())
  )
$$;

grant execute on function public.can_use_chat_conversation(uuid) to authenticated;

drop policy if exists "chat-images: participants read"   on storage.objects;
drop policy if exists "chat-images: participants upload" on storage.objects;
drop policy if exists "chat-images: sender delete"       on storage.objects;

-- `public.` qualified because these run in the storage schema, where `public`
-- is not on the search_path (same note as 0056).
create policy "chat-images: participants read" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-images'
    and public.can_use_chat_conversation(public.chat_object_conversation(name))
  );

create policy "chat-images: participants upload" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-images'
    and public.can_use_chat_conversation(public.chat_object_conversation(name))
  );

-- Only the uploader can delete, and only their own object — a seller must not
-- be able to erase what a buyer sent them (or the reverse) after the fact.
create policy "chat-images: sender delete" on storage.objects for delete
  to authenticated
  using (bucket_id = 'chat-images' and owner = auth.uid());

-- ── Previews ────────────────────────────────────────────────────────────────
-- Extends 0055. A photo message's body is a marker plus JSON, which is
-- meaningless outside ChatView's renderer: without this case the conversation
-- list and the "New message" notification both read
-- `@@IMAGE@@{"path":"…"}`.
--
-- The path is NOT included in the preview text. A notification email is the one
-- place a private object path could travel outside the two participants.
create or replace function message_preview(p_body text)
returns text
language plpgsql
immutable
as $$
declare
  v_card jsonb;
begin
  if p_body like '@@PRODUCT@@%' then
    begin
      v_card := substr(p_body, length('@@PRODUCT@@') + 1)::jsonb;
    exception when others then
      -- A body that only looks like a card still must not reach a buyer's
      -- notification as raw JSON.
      return 'Shared a product';
    end;
    return '🛍️ ' || coalesce(v_card ->> 'title', 'a product');

  elsif p_body like '@@ORDER@@%' then
    begin
      v_card := substr(p_body, length('@@ORDER@@') + 1)::jsonb;
    exception when others then
      return 'Shared an order';
    end;
    return '🧾 ' || concat_ws(' · ', v_card ->> 'orderId', v_card ->> 'title');

  elsif p_body like '@@IMAGE@@%' then
    -- Any caption the sender typed is theirs to show; the path never is.
    begin
      v_card := substr(p_body, length('@@IMAGE@@') + 1)::jsonb;
    exception when others then
      return '📷 Photo';
    end;
    return trim(concat('📷 ', coalesce(nullif(v_card ->> 'caption', ''), 'Photo')));
  end if;

  return p_body;
end;
$$;

-- ── Verify ──────────────────────────────────────────────────────────────────
--   select message_preview('@@IMAGE@@{"path":"abc/1.jpg"}');            -- 📷 Photo
--   select message_preview('@@IMAGE@@{"path":"abc/1.jpg","caption":"this one"}');
--   select id, name, public, file_size_limit from storage.buckets where id = 'chat-images';
