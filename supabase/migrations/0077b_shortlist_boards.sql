-- "Ask my people" — shareable shortlist boards a buyer's family can vote on.
--
-- Idempotent and re-runnable in the Supabase SQL editor. Requires 0001
-- (profiles, products, wishlist), 0038 (products.status / auto_hidden), 0044
-- (notifications + the shared notify() writer) and 0057 (products.slug).
--
-- ── Why this exists ─────────────────────────────────────────────────────────
--
-- Nobody in India buys a ₹6,000 saree alone. What actually happens today is
-- that the buyer screenshots three pieces, drops them into a family WhatsApp
-- group and asks "which one?". The group answers; she decides; she comes back
-- and buys. That entire deciding step happens OUTSIDE the app: we lose the
-- conversation, the screenshots are dead images nobody can tap, and the four
-- relatives who saw our catalogue never reach it.
--
-- A board moves that conversation inside Agilam without asking a single
-- relative to sign up. She picks pieces, gets a link, shares it; they open it,
-- tap ❤️ or 👎, leave a line; she sees the tally and buys the winner.
--
-- ── The token IS the credential ─────────────────────────────────────────────
--
-- A relative is an anonymous visitor. RLS cannot see a URL, so there is no
-- policy that could express "readable by whoever holds this link", and the
-- wrong fix — granting `anon` SELECT on the tables — would expose every board
-- on the platform to anyone with the anon key.
--
-- So the four tables below have RLS on and NO anon grant of any kind. The three
-- public entry points are SECURITY DEFINER functions that take the token as
-- their first argument and resolve the board themselves. `anon` is granted
-- EXECUTE on exactly those three and nothing else: without a valid, unexpired
-- token there is no board, no products and no votes. The token is 32 hex
-- characters from gen_random_uuid() — ~122 bits, not enumerable.
--
-- The same reasoning as 0074's request_return(): rules a policy cannot express
-- belong in a definer function, not in the browser.

-- ── The board ───────────────────────────────────────────────────────────────
create table if not exists shortlist_boards (
  id       uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references profiles(id) on delete cascade,

  -- What she's deciding: "Divya's wedding", "Diwali sarees for amma".
  title text not null check (length(btrim(title)) between 1 and 80),
  -- The question she's asking her people, shown under the title on the board.
  note  text not null default '' check (length(note) <= 300),

  -- The share credential. Not a uuid column on purpose: it is a secret, and
  -- typing it as text keeps it from being confused with an id anywhere that
  -- takes one.
  token text not null unique,

  status text not null default 'open' check (status in ('open', 'closed')),
  -- Which one she went with. Closes the loop for the people who voted, and is
  -- the only honest measure of whether this feature sells anything.
  decided_product_id uuid references products(id) on delete set null,

  created_at timestamptz not null default now(),
  -- A share link that lives forever is a share link that leaks forever. Sixty
  -- days is far longer than any wedding-shopping decision takes.
  expires_at timestamptz not null default now() + interval '60 days'
);

create index if not exists shortlist_boards_buyer_idx on shortlist_boards (buyer_id, created_at desc);

-- ── What's on it ────────────────────────────────────────────────────────────
create table if not exists shortlist_items (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references shortlist_boards(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  unique (board_id, product_id)
);

create index if not exists shortlist_items_board_idx on shortlist_items (board_id, position);

-- ── The votes ───────────────────────────────────────────────────────────────
--
-- `voter_key` is a uuid the browser generates and keeps in localStorage. It is
-- NOT authentication and is not treated as any: all it does is let one person
-- change their mind instead of voting twice, and let the board show "you" their
-- own choices when they come back. A determined visitor can clear it and vote
-- again — which is fine, because this is a private link shared with four
-- relatives, and the per-board voter cap below bounds the damage anyway.
create table if not exists shortlist_votes (
  id       uuid primary key default gen_random_uuid(),
  -- Denormalised from the item so the tally, the caps and the notification
  -- trigger never need a join.
  board_id uuid not null references shortlist_boards(id) on delete cascade,
  item_id  uuid not null references shortlist_items(id) on delete cascade,

  voter_key  text not null check (length(voter_key) between 8 and 64),
  voter_name text not null check (length(btrim(voter_name)) between 1 and 40),

  verdict text not null check (verdict in ('love', 'no')),
  -- "the green one — the blouse suits you". The single most valuable field on
  -- this table and the reason people enjoy the feature.
  note text not null default '' check (length(note) <= 300),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One vote per person per piece, changeable — cast_board_vote() upserts on it.
  unique (item_id, voter_key)
);

create index if not exists shortlist_votes_board_idx on shortlist_votes (board_id);

-- ── The conversation ────────────────────────────────────────────────────────
--
-- Board-level, distinct from the per-item note: this is where the family argues
-- about the whole set ("all three are lovely, but not for a morning muhurtham")
-- and where the buyer answers them. `profile_id` is set only when the signed-in
-- owner posts, which is what earns the "her" badge on the thread.
create table if not exists shortlist_comments (
  id       uuid primary key default gen_random_uuid(),
  board_id uuid not null references shortlist_boards(id) on delete cascade,

  voter_key  text not null check (length(voter_key) between 8 and 64),
  voter_name text not null check (length(btrim(voter_name)) between 1 and 40),
  profile_id uuid references profiles(id) on delete set null,

  body text not null check (length(btrim(body)) between 1 and 500),

  created_at timestamptz not null default now()
);

create index if not exists shortlist_comments_board_idx on shortlist_comments (board_id, created_at);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table shortlist_boards   enable row level security;
alter table shortlist_items    enable row level security;
alter table shortlist_votes    enable row level security;
alter table shortlist_comments enable row level security;

-- The OWNER reads her own boards directly (this is what /shortlists renders,
-- nested through PostgREST). Everyone else — including every holder of the
-- link — reads only through get_shared_board().
drop policy if exists "shortlist boards: owner read" on shortlist_boards;
create policy "shortlist boards: owner read" on shortlist_boards for select
  using (buyer_id = auth.uid() or is_admin());

drop policy if exists "shortlist items: owner read" on shortlist_items;
create policy "shortlist items: owner read" on shortlist_items for select
  using (exists (select 1 from shortlist_boards b where b.id = board_id and (b.buyer_id = auth.uid() or is_admin())));

drop policy if exists "shortlist votes: owner read" on shortlist_votes;
create policy "shortlist votes: owner read" on shortlist_votes for select
  using (exists (select 1 from shortlist_boards b where b.id = board_id and (b.buyer_id = auth.uid() or is_admin())));

drop policy if exists "shortlist comments: owner read" on shortlist_comments;
create policy "shortlist comments: owner read" on shortlist_comments for select
  using (exists (select 1 from shortlist_boards b where b.id = board_id and (b.buyer_id = auth.uid() or is_admin())));

-- Deleting a whole board she owns is safe to express as a policy — there is no
-- column to tamper with, and the FKs cascade the items, votes and comments.
drop policy if exists "shortlist boards: owner delete" on shortlist_boards;
create policy "shortlist boards: owner delete" on shortlist_boards for delete
  using (buyer_id = auth.uid());

-- Deliberately NO insert or update policy on any of the four.
--
-- 0072 is the lesson: a column-blind UPDATE policy on a row the user owns lets
-- them write columns the feature never meant them to (there, sellers un-settling
-- their own payouts). Here the equivalents are `token` and `buyer_id` on a
-- board, and `verdict` on somebody else's vote. Every write goes through a
-- definer function below that decides which columns move.

-- ── Caps ────────────────────────────────────────────────────────────────────
-- Bounds on an endpoint anonymous visitors can reach. Generous for the real use
-- (a family picking between a handful of sarees), tight enough that a scripted
-- caller cannot turn a board into free storage.
create or replace function shortlist_limits()
returns table (max_items int, max_open_boards int, max_voters int, max_comments int)
language sql immutable as $$ select 30, 20, 60, 300 $$;

-- ── Creating one ────────────────────────────────────────────────────────────
--
-- Returns { id, token } so the caller can build the share link without a second
-- round trip — the share sheet opens on the same tap.
create or replace function create_shortlist_board(
  p_title       text,
  p_note        text default '',
  p_product_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board  shortlist_boards;
  v_open   int;
  v_lim    record;
  v_count  int;
begin
  if auth.uid() is null then
    raise exception 'Please sign in to make a shortlist.' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(btrim(p_title), '') = '' then
    raise exception 'Give this shortlist a name.' using errcode = 'check_violation';
  end if;

  select * into v_lim from shortlist_limits();

  select count(*) into v_open
    from shortlist_boards
   where buyer_id = auth.uid() and status = 'open' and expires_at > now();
  if v_open >= v_lim.max_open_boards then
    raise exception 'You already have % shortlists open. Close one before starting another.', v_lim.max_open_boards
      using errcode = 'check_violation';
  end if;

  insert into shortlist_boards (buyer_id, title, note, token)
  values (
    auth.uid(),
    btrim(p_title),
    coalesce(btrim(p_note), ''),
    -- 32 hex characters of a random uuid. Unguessable, and no dependency on
    -- pgcrypto's gen_random_bytes, which lives in the `extensions` schema on
    -- Supabase and would not resolve under `search_path = public`.
    replace(gen_random_uuid()::text, '-', '')
  )
  returning * into v_board;

  -- Silently skips anything not currently visible to a buyer, so a board can
  -- never be used to confirm the existence of a hidden or deleted product.
  --
  -- The source rows are selected in a CTE rather than inline. `INSERT … SELECT
  -- … LIMIT … ON CONFLICT` does parse, but it reads as though the LIMIT might
  -- bind to the conflict clause; naming the set first removes the question. The
  -- ORDER BY matters on its own account — without it, which pieces survive the
  -- cap is whatever order the join happened to emit.
  with wanted as (
    select p.id as product_id, t.ord
      from unnest(p_product_ids) with ordinality as t(pid, ord)
      join products p on p.id = t.pid
      join boutiques b on b.id = p.boutique_id
     where p.status = 'active' and p.deleted_at is null and b.status = 'approved'
     order by t.ord
     limit v_lim.max_items
  )
  insert into shortlist_items (board_id, product_id, position)
  select v_board.id, w.product_id, w.ord from wanted w
  on conflict (board_id, product_id) do nothing;

  select count(*) into v_count from shortlist_items where board_id = v_board.id;
  if v_count = 0 then
    -- Nothing to vote on is not a board. Raising rolls the whole function back,
    -- the board row included, so no empty one is left behind for her to wonder
    -- about.
    raise exception 'Pick at least one piece to ask about.' using errcode = 'check_violation';
  end if;

  return jsonb_build_object('id', v_board.id, 'token', v_board.token);
end;
$$;

revoke all on function create_shortlist_board(text, text, uuid[]) from public, anon;
grant execute on function create_shortlist_board(text, text, uuid[]) to authenticated;

-- ── Editing one ─────────────────────────────────────────────────────────────
create or replace function update_shortlist_board(
  p_board_id uuid,
  p_title    text default null,
  p_note     text default null,
  p_status   text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select buyer_id into v_owner from shortlist_boards where id = p_board_id;
  if not found then
    raise exception 'Shortlist not found.' using errcode = 'no_data_found';
  end if;
  if v_owner is distinct from auth.uid() then
    raise exception 'That is not your shortlist.' using errcode = 'insufficient_privilege';
  end if;
  if p_status is not null and p_status not in ('open', 'closed') then
    raise exception 'Unknown status.' using errcode = 'check_violation';
  end if;

  -- Names the columns it moves. `token` and `buyer_id` are not among them.
  update shortlist_boards
     set title  = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
         note   = coalesce(p_note, note),
         status = coalesce(p_status, status)
   where id = p_board_id;
end;
$$;

revoke all on function update_shortlist_board(uuid, text, text, text) from public, anon;
grant execute on function update_shortlist_board(uuid, text, text, text) to authenticated;

-- ── Adding and removing pieces ──────────────────────────────────────────────
create or replace function add_shortlist_items(p_board_id uuid, p_product_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_have  int;
  v_lim   record;
  v_added int;
begin
  select buyer_id into v_owner from shortlist_boards where id = p_board_id;
  if not found then
    raise exception 'Shortlist not found.' using errcode = 'no_data_found';
  end if;
  if v_owner is distinct from auth.uid() then
    raise exception 'That is not your shortlist.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_lim from shortlist_limits();
  select count(*) into v_have from shortlist_items where board_id = p_board_id;
  if v_have >= v_lim.max_items then
    raise exception 'A shortlist holds up to % pieces.', v_lim.max_items using errcode = 'check_violation';
  end if;

  with wanted as (
    select p.id as product_id, t.ord
      from unnest(p_product_ids) with ordinality as t(pid, ord)
      join products p on p.id = t.pid
      join boutiques b on b.id = p.boutique_id
     where p.status = 'active' and p.deleted_at is null and b.status = 'approved'
     order by t.ord
     limit (v_lim.max_items - v_have)
  ),
  fresh as (
    insert into shortlist_items (board_id, product_id, position)
    select p_board_id, w.product_id, v_have + w.ord from wanted w
    on conflict (board_id, product_id) do nothing
    returning 1
  )
  select count(*) into v_added from fresh;

  return v_added;
end;
$$;

revoke all on function add_shortlist_items(uuid, uuid[]) from public, anon;
grant execute on function add_shortlist_items(uuid, uuid[]) to authenticated;

create or replace function remove_shortlist_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select b.buyer_id into v_owner
    from shortlist_items i join shortlist_boards b on b.id = i.board_id
   where i.id = p_item_id;
  if not found then
    return; -- Already gone. Removing it twice is not an error worth surfacing.
  end if;
  if v_owner is distinct from auth.uid() then
    raise exception 'That is not your shortlist.' using errcode = 'insufficient_privilege';
  end if;

  delete from shortlist_items where id = p_item_id;
end;
$$;

revoke all on function remove_shortlist_item(uuid) from public, anon;
grant execute on function remove_shortlist_item(uuid) to authenticated;

-- ── Closing the loop ────────────────────────────────────────────────────────
--
-- She tells everyone which one she went with. The board flips to closed, voting
-- stops, and the people who helped see the result when they open the link again
-- — which is the whole reason anyone bothers to vote a second time.
create or replace function decide_shortlist(p_board_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
begin
  select buyer_id into v_owner from shortlist_boards where id = p_board_id;
  if not found then
    raise exception 'Shortlist not found.' using errcode = 'no_data_found';
  end if;
  if v_owner is distinct from auth.uid() then
    raise exception 'That is not your shortlist.' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from shortlist_items where board_id = p_board_id and product_id = p_product_id) then
    raise exception 'That piece is not on this shortlist.' using errcode = 'check_violation';
  end if;

  update shortlist_boards
     set decided_product_id = p_product_id,
         status = 'closed'
   where id = p_board_id;
end;
$$;

revoke all on function decide_shortlist(uuid, uuid) from public, anon;
grant execute on function decide_shortlist(uuid, uuid) to authenticated;

-- ── Reading a shared board (the anonymous entry point) ──────────────────────
--
-- One round trip returns everything the public page renders: the board, the
-- pieces with a product snapshot, every vote and the comment thread.
--
-- What it deliberately does NOT return: the owner's id, email, phone or full
-- name. Only a first name, because "Help Priya pick" is the entire social
-- context the page needs and anything more is a leak to whoever the link got
-- forwarded to.
create or replace function get_shared_board(p_token text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_board shortlist_boards;
  v_owner text;
begin
  select * into v_board from shortlist_boards where token = p_token;
  if not found then
    raise exception 'This shortlist link is not valid.' using errcode = 'no_data_found';
  end if;
  if v_board.expires_at <= now() then
    raise exception 'This shortlist link has expired.' using errcode = 'no_data_found';
  end if;

  select split_part(btrim(coalesce(full_name, '')), ' ', 1) into v_owner
    from profiles where id = v_board.buyer_id;

  return jsonb_build_object(
    'board', jsonb_build_object(
      'id',         v_board.id,
      'title',      v_board.title,
      'note',       v_board.note,
      'status',     v_board.status,
      'owner_name', nullif(v_owner, ''),
      'decided_product_id', v_board.decided_product_id,
      'created_at', v_board.created_at,
      'expires_at', v_board.expires_at
    ),
    'items', coalesce((
      -- Ordered by the int, not by the JSON text of it: `x->>'position'` sorts
      -- lexically, which puts piece 10 ahead of piece 2.
      select jsonb_agg(x order by pos)
        from (
          select i.position as pos, jsonb_build_object(
            'id',            i.id,
            'product_id',    p.id,
            'position',      i.position,
            'title',         p.title,
            'price',         p.price,
            'mrp',           p.mrp,
            'image_url',     p.image_url,
            'slug',          p.slug,
            'tone',          p.tone,
            'boutique_name', b.name,
            -- A piece the boutique has since hidden, deleted or sold out still
            -- shows on the board (the votes cast on it have to stay legible) —
            -- greyed, with the reason, rather than vanishing mid-conversation.
            'available',     (p.status = 'active' and p.deleted_at is null and b.status = 'approved' and p.stock > 0)
          ) as x
          from shortlist_items i
          join products p  on p.id = i.product_id
          join boutiques b on b.id = p.boutique_id
         where i.board_id = v_board.id
        ) s
    ), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_id',    v.item_id,
        'voter_key',  v.voter_key,
        'voter_name', v.voter_name,
        'verdict',    v.verdict,
        'note',       v.note,
        'created_at', v.created_at
      ))
      from shortlist_votes v where v.board_id = v_board.id
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',         c.id,
        'voter_key',  c.voter_key,
        'voter_name', c.voter_name,
        'is_owner',   (c.profile_id is not null and c.profile_id = v_board.buyer_id),
        'body',       c.body,
        'created_at', c.created_at
      ) order by c.created_at)
      from shortlist_comments c where c.board_id = v_board.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function get_shared_board(text) from public;
grant execute on function get_shared_board(text) to anon, authenticated;

-- ── Voting (the anonymous write) ────────────────────────────────────────────
create or replace function cast_board_vote(
  p_token      text,
  p_item_id    uuid,
  p_voter_key  text,
  p_voter_name text,
  p_verdict    text,
  p_note       text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board  shortlist_boards;
  v_lim    record;
  v_voters int;
begin
  select * into v_board from shortlist_boards where token = p_token;
  if not found or v_board.expires_at <= now() then
    raise exception 'This shortlist link is not valid.' using errcode = 'no_data_found';
  end if;
  if v_board.status <> 'open' then
    raise exception 'Voting on this shortlist has closed.' using errcode = 'check_violation';
  end if;
  -- The item must belong to THIS board. Without this check a valid token from
  -- any board would let a caller vote on an item id from someone else's.
  if not exists (select 1 from shortlist_items where id = p_item_id and board_id = v_board.id) then
    raise exception 'That piece is not on this shortlist.' using errcode = 'check_violation';
  end if;
  if p_verdict not in ('love', 'no') then
    raise exception 'Unknown vote.' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_voter_name), '') = '' then
    raise exception 'Please add your name so she knows who voted.' using errcode = 'check_violation';
  end if;

  select * into v_lim from shortlist_limits();
  select count(distinct voter_key) into v_voters from shortlist_votes where board_id = v_board.id;
  if v_voters >= v_lim.max_voters
     and not exists (select 1 from shortlist_votes where board_id = v_board.id and voter_key = p_voter_key) then
    raise exception 'This shortlist has reached its limit of % people.', v_lim.max_voters
      using errcode = 'check_violation';
  end if;

  insert into shortlist_votes (board_id, item_id, voter_key, voter_name, verdict, note)
  values (v_board.id, p_item_id, p_voter_key, btrim(p_voter_name), p_verdict, coalesce(btrim(p_note), ''))
  on conflict (item_id, voter_key) do update
     set verdict    = excluded.verdict,
         note       = excluded.note,
         voter_name = excluded.voter_name,
         updated_at = now();
end;
$$;

revoke all on function cast_board_vote(text, uuid, text, text, text, text) from public;
grant execute on function cast_board_vote(text, uuid, text, text, text, text) to anon, authenticated;

-- ── Commenting (the anonymous write) ────────────────────────────────────────
create or replace function post_board_comment(
  p_token      text,
  p_voter_key  text,
  p_voter_name text,
  p_body       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board shortlist_boards;
  v_lim   record;
  v_count int;
  v_id    uuid;
begin
  select * into v_board from shortlist_boards where token = p_token;
  if not found or v_board.expires_at <= now() then
    raise exception 'This shortlist link is not valid.' using errcode = 'no_data_found';
  end if;
  if v_board.status <> 'open' then
    raise exception 'This shortlist has closed.' using errcode = 'check_violation';
  end if;
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write something first.' using errcode = 'check_violation';
  end if;

  select * into v_lim from shortlist_limits();
  select count(*) into v_count from shortlist_comments where board_id = v_board.id;
  if v_count >= v_lim.max_comments then
    raise exception 'This shortlist has reached its comment limit.' using errcode = 'check_violation';
  end if;

  insert into shortlist_comments (board_id, voter_key, voter_name, profile_id, body)
  values (
    v_board.id,
    p_voter_key,
    btrim(p_voter_name),
    -- Set only for the owner, and only from auth.uid() — never from anything
    -- the caller passed in. This is what the "her" badge on the thread means.
    case when auth.uid() = v_board.buyer_id then auth.uid() else null end,
    btrim(p_body)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function post_board_comment(text, text, text, text) from public;
grant execute on function post_board_comment(text, text, text, text) to anon, authenticated;

-- ── Telling her ─────────────────────────────────────────────────────────────
--
-- `notifications` could only ever deep-link to an order: the inbox navigates on
-- `order_id` and nothing else, so a row without one is inert — which is why the
-- price-drop alerts from 0044 have always been unclickable. "Amma voted on your
-- shortlist" that goes nowhere when tapped is worse than no notification, so
-- this adds the general case rather than another dead row.
--
-- Additive and nullable: every existing row keeps working through `order_id`,
-- and the inbox prefers `link` only when it is set.
alter table notifications add column if not exists link text;

comment on column notifications.link is
  'Optional in-app path this notification opens (e.g. /shortlists/<id>). '
  'Preferred over order_id by the inbox when both are present.';

-- notify() cannot carry it without changing a signature four migrations call,
-- so linked notifications get their own writer alongside it.
create or replace function notify_linked(
  p_profile_id uuid,
  p_type text,
  p_title text,
  p_body text,
  p_link text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_profile_id is null then
    return;
  end if;
  insert into notifications (profile_id, type, title, body, link)
  values (p_profile_id, p_type, p_title, p_body, p_link);
end;
$$;

-- Debounced to the FIRST vote each person casts on a board. Four relatives
-- across five pieces is twenty rows; twenty notifications would be a reason to
-- turn notifications off. "Amma voted on Divya's wedding" once is the message.
create or replace function notify_shortlist_vote()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board shortlist_boards;
begin
  if exists (
    select 1 from shortlist_votes v
     where v.board_id = new.board_id and v.voter_key = new.voter_key and v.id <> new.id
  ) then
    return new;
  end if;

  select * into v_board from shortlist_boards where id = new.board_id;
  if found then
    perform notify_linked(
      v_board.buyer_id,
      'Wishlist',
      new.voter_name || ' voted on your shortlist',
      format('See what your people picked for “%s”.', v_board.title),
      '/shortlists/' || v_board.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_shortlist_vote on shortlist_votes;
create trigger trg_notify_shortlist_vote
  after insert on shortlist_votes
  for each row execute function notify_shortlist_vote();

create or replace function notify_shortlist_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_board shortlist_boards;
begin
  select * into v_board from shortlist_boards where id = new.board_id;
  -- Her own replies are not news to her.
  if found and new.profile_id is distinct from v_board.buyer_id then
    perform notify_linked(
      v_board.buyer_id,
      'Wishlist',
      new.voter_name || ' left a note',
      format('On “%s”: %s', v_board.title, left(new.body, 90)),
      '/shortlists/' || v_board.id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_notify_shortlist_comment on shortlist_comments;
create trigger trg_notify_shortlist_comment
  after insert on shortlist_comments
  for each row execute function notify_shortlist_comment();

-- ── Verify ──────────────────────────────────────────────────────────────────
--   -- as a signed-in buyer:
--   select create_shortlist_board('Divya''s wedding', 'Which one?', array[
--     (select id from products where status = 'active' limit 1)
--   ]);
--   -- as anon (SQL editor: set role anon), with the token that returned:
--   select get_shared_board('<token>');            -- should return the board
--   select get_shared_board('00000000000000000000000000000000'); -- should raise
--   select * from shortlist_boards;                -- should return 0 rows as anon
