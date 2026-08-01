-- ── "New message" notifications showed the raw card payload ─────────────────
--
-- When a buyer taps "Chat about this order"/"Chat about this product" we post a
-- context card into the thread as a normal message, encoded as a marker plus
-- JSON (see encodeOrderCard/encodeProductCard in src/data/chat.ts). ChatView
-- knows how to render that; nothing else does.
--
-- 0044's notify_new_message() copied the message body verbatim, so the seller's
-- notification read:
--   @@ORDER@@{"orderId":"#AGL-ALRHEZ0B59","title":"Unstitched Striped Organza
--   Suit","image":"https://…supabase.co/…"}
--
-- This summarises card bodies the same way the app's inbox preview does, and
-- repairs the notifications already stored that way.

-- Mirrors messagePreview() in src/data/chat.ts — keep the two in step.
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

create or replace function notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer_id uuid;
  v_owner_id uuid;
  v_body text;
begin
  select c.buyer_id, b.owner_id into v_buyer_id, v_owner_id
  from conversations c
  join boutiques b on b.id = c.boutique_id
  where c.id = new.conversation_id;

  v_body := left(message_preview(new.body), 140);

  if new.sender_id = v_buyer_id then
    perform notify(v_owner_id, 'Messages', 'New message', v_body);
  else
    perform notify(v_buyer_id, 'Messages', 'New message', v_body);
  end if;

  return new;
end;
$$;

-- The trigger definition itself is unchanged (0044 already points at this
-- function name), so it does not need recreating.

-- Repair the rows already written with a raw payload.
update notifications
set body = left(message_preview(body), 140)
where body like '@@ORDER@@%' or body like '@@PRODUCT@@%';
