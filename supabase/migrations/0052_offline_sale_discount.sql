-- Record the walk-in (POS) discount on the order it belongs to.
--
-- create_offline_sale() has always SUBTRACTED p_discount when computing the
-- order total, but never STORED it. `orders.discount` stayed 0 while `total`
-- came in below sum(order_items), so a POS bill silently failed to reconcile:
--
--   AGB-260720-8367  order_items 4899  ·  discount 0  ·  total 4699   (₹200 gap)
--
-- Four live orders currently carry that shape. The money charged was correct —
-- only the record of WHY was lost, which is exactly what a seller needs when a
-- customer queries a bill, and what any books/GST reconciliation keys on.
--
-- This is a drop-in replacement: same signature, same behaviour, one extra
-- column written. Existing rows are repaired below.
--
-- Run once in the Supabase SQL editor after 0051.

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

  -- 'AGB-YYMMDD-' + 4 random digits gives only 9000 numbers per day across the
  -- WHOLE platform, and order_number is unique — at a few hundred bills a day a
  -- collision is a coin flip (birthday paradox), and it surfaced as a hard error
  -- that lost the seller's bill. Retry on collision instead of failing the sale.
  for v_attempt in 1..10 loop
    v_order_number := 'AGB-' || to_char(now(), 'YYMMDD') || '-' || floor(random() * 9000 + 1000)::text;
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

grant execute on function create_offline_sale(uuid, text, text, jsonb, numeric, text) to authenticated;

-- Repair the existing offline orders whose discount was dropped. Only touches
-- rows that are demonstrably short (offline, discount 0, total < sum of items),
-- and only ever writes the difference that is already implied by the two.
update orders o
   set discount = sub.goods - o.total
  from (
    select oi.order_id, sum(oi.price * oi.qty) as goods
      from order_items oi
     group by oi.order_id
  ) sub
 where sub.order_id = o.id
   and o.channel = 'offline'
   and coalesce(o.discount, 0) = 0
   and sub.goods > o.total;
