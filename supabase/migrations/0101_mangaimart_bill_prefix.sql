-- Walk-in (POS) bill numbers: 'AGB-' → 'MMB-'.
--
-- The last Agilam-era identifier a human ever reads. `AGB-YYMMDD-####` is
-- printed on the seller's POS bill card, the PNG they share over WhatsApp and
-- the PDF they download, so it sits in front of a walk-in customer under the
-- MangaiMart logo. The online counterpart moved in the same change:
-- api/place-order.js now issues `MM-…` instead of `AGL-…`.
--
-- NOT a backfill. Bills already issued keep their `AGB-` number forever — the
-- customer is holding a printout of it and the seller's books key on it.
-- Nothing looks a bill up by prefix, so old and new coexist without a reader
-- change (unlike the online numbers, where supabase/functions/wa-webhook now
-- parses both `MM-` and `AGL-`).
--
-- Otherwise a byte-for-byte replay of 0052's definition: same signature, same
-- discount clamp, same collision retry, same `security definer` +
-- `set search_path = public`. Only the prefix literal differs.
--
-- Run once in the Supabase SQL editor after 0100.

create or replace function create_offline_sale(
  p_boutique_id uuid,
  p_buyer_name text,
  p_buyer_phone text,
  p_items jsonb, -- [{product_id: uuid|null, title: text, price: numeric, qty: int}]
  p_discount numeric default 0,
  p_payment_method text default 'Cash'
)
returns table (id uuid, order_number text, total numeric, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_discount numeric := 0;
  v_item jsonb;
  v_product_id uuid;
  v_qty int;
  v_attempt int := 0;
begin
  if not exists (select 1 from boutiques b where b.id = p_boutique_id and b.owner_id = auth.uid()) then
    raise exception 'Not authorized for this boutique';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'At least one item is required';
  end if;

  select coalesce(sum((i->>'price')::numeric * (i->>'qty')::int), 0)
    into v_subtotal
    from jsonb_array_elements(p_items) as i;

  -- Clamp to the subtotal so a discount can never push the bill negative, and
  -- keep the clamped figure — that is what was actually taken off the bill.
  v_discount := least(greatest(coalesce(p_discount, 0), 0), v_subtotal);
  v_total := v_subtotal - v_discount;

  -- 'MMB-YYMMDD-' + 4 random digits gives only 9000 numbers per day across the
  -- WHOLE platform, and order_number is unique — at a few hundred bills a day a
  -- collision is a coin flip (birthday paradox), and it surfaced as a hard error
  -- that lost the seller's bill. Retry on collision instead of failing the sale.
  -- The uniqueness check spans every order, `AGB-` and `MMB-` alike, so the
  -- prefix change cannot collide with a bill issued before this migration.
  for v_attempt in 1..10 loop
    v_order_number := 'MMB-' || to_char(now(), 'YYMMDD') || '-' || floor(random() * 9000 + 1000)::text;
    exit when not exists (select 1 from orders o where o.order_number = v_order_number);
  end loop;

  insert into orders (order_number, buyer_id, boutique_id, status, total, discount,
                      guest_name, guest_phone, channel, payment_method)
  values (v_order_number, null, p_boutique_id, 'delivered', v_total, v_discount,
          p_buyer_name, p_buyer_phone, 'offline', p_payment_method)
  returning orders.id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := nullif(v_item->>'product_id', '')::uuid;
    v_qty := coalesce((v_item->>'qty')::int, 1);

    insert into order_items (order_id, product_id, title, price, qty)
    values (v_order_id, v_product_id, v_item->>'title', (v_item->>'price')::numeric, v_qty);

    if v_product_id is not null then
      update products set stock = greatest(0, stock - v_qty)
        where products.id = v_product_id and products.boutique_id = p_boutique_id;
    end if;
  end loop;

  return query select orders.id, orders.order_number, orders.total, orders.created_at
    from orders where orders.id = v_order_id;
end;
$$;

-- `create or replace` preserves the existing ACL, so this only restates what
-- 0098 §2b already set. Kept explicit so the function's grants are legible in
-- the file that last defined it, and so a fresh database built from the series
-- lands on the same permissions.
revoke all on function create_offline_sale(uuid, text, text, jsonb, numeric, text) from public, anon;
grant execute on function create_offline_sale(uuid, text, text, jsonb, numeric, text) to authenticated;
