-- Remove chat photos — reverses 0079.
--
-- Photo sharing in conversations was built and then withdrawn by decision. The
-- app no longer has an attach control, no longer writes `@@IMAGE@@` bodies and
-- no longer reads them, so everything 0079 created is now unreachable.
--
-- 0079 is deliberately left in place rather than deleted: it is in the commit
-- history and may already have been applied, and a migration that ran is a fact
-- about the database, not a draft to be edited away. This is the reversal.
--
-- Safe to run whether or not 0079 was ever applied — every statement is
-- conditional, and nothing here fails if the bucket is missing, already gone or
-- refuses to be dropped. Idempotent: re-runnable in the Supabase SQL editor.

-- ── Storage ─────────────────────────────────────────────────────────────────
drop policy if exists "chat-images: participants read"   on storage.objects;
drop policy if exists "chat-images: participants upload" on storage.objects;
drop policy if exists "chat-images: sender delete"       on storage.objects;

-- The bucket itself.
--
-- Deliberately NOT preceded by `delete from storage.objects` — Supabase guards
-- that table with a `storage.protect_delete()` trigger and rejects direct
-- deletes ("Use the Storage API instead"), which aborts the whole script.
-- Emptying a bucket is a Storage-API job, not a SQL one.
--
-- So this drops the bucket only, and only if it is already empty. Wrapped
-- because that is the realistic outcome either way and neither is worth failing
-- the migration over: the feature never reached a buyer, so the bucket should
-- have nothing in it — but if a test photo was sent while it was live, the
-- delete raises, this catches it, and the rest of the file still applies.
--
-- An orphaned bucket is inert once the policies above are gone: nothing can
-- read it, write it or list it. Remove it from Storage in the Supabase
-- dashboard if you want it tidy.
do $$
begin
  delete from storage.buckets where id = 'chat-images';
exception when others then
  raise notice
    'chat-images bucket left in place (%). It is inert now its policies are dropped; delete it from Storage in the dashboard if you want it gone.',
    sqlerrm;
end $$;

drop function if exists public.can_use_chat_conversation(uuid);
drop function if exists public.chat_object_conversation(text);

-- ── Previews ────────────────────────────────────────────────────────────────
-- Back to 0055's version, without the image branch. Restored in full rather
-- than patched, so this file alone says what the function is.
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
  end if;

  return p_body;
end;
$$;

-- ── Verify ──────────────────────────────────────────────────────────────────
--   select message_preview('@@ORDER@@broken');    -- Shared an order
--   select count(*) from pg_policies
--    where schemaname = 'storage' and policyname like 'chat-images%';   -- 0
--
-- The bucket, and whether anything was ever put in it:
--   select b.id, count(o.id) as objects
--     from storage.buckets b
--     left join storage.objects o on o.bucket_id = b.id
--    where b.id = 'chat-images'
--    group by b.id;
-- No rows = the bucket is gone, which is the expected result. A row with
-- objects > 0 means a photo was sent while the feature was live; delete the
-- bucket from Storage in the dashboard, which removes its files with it.
