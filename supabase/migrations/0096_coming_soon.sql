-- ═══════════════════════════════════════════════════════════════════════════════
-- 0096 — Coming-soon mode: hide the whole public site behind one switch
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- One admin toggle that takes the storefront and the seller console off the air
-- and serves a "launching soon" page in their place. Wanted for the run-up to
-- launch, when the catalogue is half-built and nobody should be able to reach a
-- product page, place an order, or judge the shop by an empty category.
--
-- WHY THIS IS NOT `maintenance_mode`
-- That flag already exists (0048) and stays. It is the milder thing: the site
-- keeps working and a sticky banner warns that something may be slow. This one
-- replaces the site. Folding both into one boolean would mean losing the banner
-- the moment you wanted the harder mode, so they are two switches.
--
-- WHERE IT IS ENFORCED
-- `middleware.js`, at the edge — not in React. A client-side gate still ships
-- the entire application to the browser, still lets anyone past it with
-- devtools, and still answers Googlebot with HTTP 200, which is how a site
-- tells Google its real pages are gone. The edge check answers 503 with a
-- Retry-After instead, which says "temporarily unavailable, come back" and
-- leaves the existing rankings alone.
--
-- THE ADMIN CONSOLE IS EXEMPT
-- Deliberately, and it is not a nicety: the switch lives inside the console, so
-- blocking the console would leave nobody able to turn it back off.
--
-- Idempotent, like every migration in this series.

-- ── The column ───────────────────────────────────────────────────────────────
alter table platform_settings
  add column if not exists coming_soon boolean not null default false;

comment on column platform_settings.coming_soon is
  'When true, middleware.js serves the coming-soon page (HTTP 503) for every '
  'public path. The admin console is exempt so the switch stays reachable.';

-- ── Read access ──────────────────────────────────────────────────────────────
--
-- `platform_settings` is world-readable by policy (0048: "settings: public read"
-- is `using (true)`), and its grants are table-level — 0073 only ever revoked
-- ONE column (`updated_by`), which leaves every other column, including a new
-- one, covered by the table grant.
--
-- The explicit grant below is therefore belt-and-braces rather than strictly
-- required. It costs nothing and it means this migration still does the right
-- thing if the table is ever switched to column-by-column grants the way
-- `boutiques` was in 0021 — at which point a new column would otherwise arrive
-- unreadable, and the edge (which reads with the ANON key) would silently fail
-- open and serve the site while the toggle said it was hidden.
grant select (coming_soon) on platform_settings to anon, authenticated;

-- ── Verify ───────────────────────────────────────────────────────────────────
--
--   -- 1. the column exists and defaults to false:
--   select coming_soon from platform_settings where id = 1;
--
--   -- 2. anon can read it (this is what the edge does):
--   select column_name from information_schema.column_privileges
--    where table_name = 'platform_settings' and grantee = 'anon'
--      and column_name = 'coming_soon';
--
--   -- 3. flip it on, confirm the public site 503s and the console still loads,
--   --    then flip it back:
--   update platform_settings set coming_soon = true where id = 1;
--   update platform_settings set coming_soon = false where id = 1;
