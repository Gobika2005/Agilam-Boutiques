-- 0050 — Broadcast audience means buyers + sellers, not literally every row
--
-- "Everyone" selected every non-deleted profile, which includes admin accounts.
-- The console therefore showed Everyone = 19 while Buyers (4) + Sellers (13)
-- came to 17: the two admins were a silent third audience receiving marketing
-- broadcasts meant for the marketplace.
--
-- 'all' now resolves to the buyer and seller roles, so the audience tiles add up
-- and operators stop getting "Diwali sale is live 🎉" in their notification bell.

create or replace function broadcast_notification(p_audience text, p_title text, p_body text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not is_admin() then
    raise exception 'not authorized';
  end if;
  if coalesce(trim(p_title), '') = '' or coalesce(trim(p_body), '') = '' then
    raise exception 'title and body are required';
  end if;
  if p_audience not in ('all', 'buyer', 'seller') then
    raise exception 'unknown audience: %', p_audience;
  end if;

  -- Type must be one of the values allowed by notifications_type_check
  -- (Orders / Messages / Updates / Wishlist, migration 0044). A broadcast is a
  -- platform Update, which slots straight into the buyer's existing feed.
  insert into notifications (profile_id, type, title, body)
  select p.id, 'Updates', p_title, p_body
  from profiles p
  where p.deleted_at is null
    and p.role in ('buyer', 'seller')
    and (p_audience = 'all' or p.role = p_audience);

  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function broadcast_notification(text, text, text) to authenticated;
