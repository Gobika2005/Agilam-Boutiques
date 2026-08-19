-- City normalisation — one spelling per city in `boutiques.city`.
--
-- `city` is free text a seller types once during onboarding, so the same place
-- is stored as "Coimbatore", "coimbatore", "COIMBATORE ", "Cbe" and "Kovai".
-- Nothing downstream can tell those apart:
--
--   • the buyer directory groups shops by the raw string, so one city becomes
--     five chips holding a fifth of the shops each;
--   • `/boutiques/<city>` slugifies the raw string, so one city gets five
--     landing pages competing with each other in search — and the sitemap and
--     the Merchant Center feed inherit the split;
--   • `LocalBusiness.addressLocality` in the JSON-LD is whatever was typed.
--
-- The app now canonicalises on write and on the buyer-facing reads
-- (`src/lib/cities.ts`, `src/data/boutiques.ts`). This does the same to the rows
-- already stored, and leaves a trigger behind so a write from any other path —
-- the SQL editor, an admin tool, a future import — lands canonical too.
--
-- Deliberately not a closed list: a boutique in a town nobody has heard of must
-- still be able to sign up. Unknown names are trimmed and title-cased and kept
-- as typed; only the aliases below are rewritten.
--
-- Keep the alias list in step with `ALIASES` in src/lib/cities.ts.
--
-- Idempotent: re-runnable in the Supabase SQL editor.

-- ── The canonical name for a typed city ─────────────────────────────────────
-- Mirrors normalizeCity() in src/lib/cities.ts:
--   • take the part after the last comma ("RS Puram, Coimbatore" → "Coimbatore")
--   • trim, collapse runs of whitespace
--   • compare on letters only, lower case, so "Cbe." and "cbe" are one key
--   • return the alias if there is one, else initcap the words
-- Returns '' for the empty string and for the state/country values sellers
-- sometimes put here — filing a shop under no city is honest; filing it under
-- "India" invents a city page.
create or replace function canonical_city(raw text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  tail text;
  k    text;
begin
  if raw is null then return null; end if;

  tail := btrim(regexp_replace(raw, '[.,;/|]+\s*$', ''));
  if position(',' in tail) > 0 then
    tail := btrim(split_part(tail, ',', array_length(string_to_array(tail, ','), 1)));
  end if;
  tail := btrim(regexp_replace(tail, '\s+', ' ', 'g'));
  if tail = '' then return ''; end if;

  k := lower(regexp_replace(tail, '[^a-zA-Z]', '', 'g'));

  return case k
    -- Coimbatore, by far the most-typed variants on this marketplace.
    when 'cbe'              then 'Coimbatore'
    when 'kovai'            then 'Coimbatore'
    when 'covai'            then 'Coimbatore'
    when 'coimbature'       then 'Coimbatore'
    when 'coimbatoor'       then 'Coimbatore'
    -- Renamed cities: the official name, because that is what the city page
    -- title and the address schema have to say to be correct.
    when 'bangalore'        then 'Bengaluru'
    when 'blr'              then 'Bengaluru'
    when 'madras'           then 'Chennai'
    when 'chennaicity'      then 'Chennai'
    when 'bombay'           then 'Mumbai'
    when 'calcutta'         then 'Kolkata'
    when 'cochin'           then 'Kochi'
    when 'ernakulam'        then 'Kochi'
    when 'trivandrum'       then 'Thiruvananthapuram'
    when 'calicut'          then 'Kozhikode'
    when 'mysore'           then 'Mysuru'
    when 'gurgaon'          then 'Gurugram'
    when 'pondicherry'      then 'Puducherry'
    when 'pondy'            then 'Puducherry'
    when 'trichy'           then 'Tiruchirappalli'
    when 'tiruchirapalli'   then 'Tiruchirappalli'
    when 'tiruchi'          then 'Tiruchirappalli'
    when 'tirupur'          then 'Tiruppur'
    when 'tiruppur'         then 'Tiruppur'
    when 'tuticorin'        then 'Thoothukudi'
    when 'vizag'            then 'Visakhapatnam'
    when 'tanjore'          then 'Thanjavur'
    when 'nellai'           then 'Tirunelveli'
    when 'newdelhi'         then 'Delhi'
    when 'hyd'              then 'Hyderabad'
    -- Not a city.
    when 'india'            then ''
    when 'tamilnadu'        then ''
    when 'kerala'           then ''
    when 'karnataka'        then ''
    else initcap(tail)
  end;
end;
$$;

grant execute on function canonical_city(text) to anon, authenticated, service_role;

-- ── What the split looks like right now ─────────────────────────────────────
-- Run this on its own first if you want to see what is about to change:
--
--   select city, canonical_city(city) as becomes, count(*)
--     from boutiques
--    where city is distinct from canonical_city(city)
--    group by 1, 2
--    order by 3 desc;

-- ── Fix the rows already stored ─────────────────────────────────────────────
-- `is distinct from` rather than `<>` so a NULL city is left alone rather than
-- being rewritten to ''.
update boutiques
   set city = canonical_city(city)
 where city is distinct from canonical_city(city);

-- ── Keep future writes canonical ────────────────────────────────────────────
-- The app normalises before it writes, so this is the backstop for every other
-- path into the table. BEFORE INSERT OR UPDATE, and only when `city` actually
-- changed, so an unrelated UPDATE costs nothing.
create or replace function boutiques_canonical_city()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.city is not null then
    new.city := canonical_city(new.city);
  end if;
  return new;
end;
$$;

drop trigger if exists boutiques_canonical_city on boutiques;
create trigger boutiques_canonical_city
  before insert or update of city on boutiques
  for each row execute function boutiques_canonical_city();

-- ── Verify ──────────────────────────────────────────────────────────────────
-- After applying, this should return no rows:
--
--   select id, name, city from boutiques
--    where city is distinct from canonical_city(city);
--
-- and this is the directory the buyer will see:
--
--   select city, count(*) from boutiques
--    where status = 'approved' group by 1 order by 2 desc, 1;
