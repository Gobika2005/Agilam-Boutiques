-- Steer the platform toward prepaid, without removing cash on delivery.
--
-- Most shops already turn COD off for themselves — `boutiques.cod_enabled` has
-- been a per-shop switch since 0022, enforced server-side in api/place-order.js,
-- not merely hidden in the UI. That switch is doing its job; what was wrong was
-- only its DEFAULT, which opted every new boutique IN to handling cash.
--
-- Two changes, both reversible:
--
--   1. New boutiques start prepaid-only. Existing rows are untouched — a shop
--      that deliberately runs COD today keeps running it, and finds out about
--      the change from nothing at all, because nothing changed for them.
--   2. A platform-wide kill switch, so COD can be stopped everywhere from the
--      admin console without a deploy and without a data migration.
--
-- Explicitly NOT done here: removing COD. That would mean editing
-- src/lib/pricing.ts and api/_pricing.js in step (CLAUDE.md rule 2) — the one
-- change that breaks live checkouts when it drifts — and it is not needed for
-- either the goal above or the Shiprocket work, which simply declines to book
-- COD parcels. The §11 teardown in COURIER_TRACKING_PLAN.md stays available.

-- ── New boutiques are prepaid unless they opt in ────────────────────────────
-- ALTER COLUMN ... SET DEFAULT rewrites no rows and takes no meaningful lock.
alter table boutiques alter column cod_enabled set default false;

comment on column boutiques.cod_enabled is
  'Does this shop accept cash on delivery? Defaults to false since 0066; existing shops kept whatever they had.';

-- ── Platform-wide kill switch ───────────────────────────────────────────────
-- Defaults to TRUE: applying this migration must not switch COD off for the
-- shops currently running it. It is a lever for the admin to pull deliberately,
-- not a behaviour change smuggled in with a schema change.
alter table platform_settings add column if not exists cod_enabled boolean not null default true;

comment on column platform_settings.cod_enabled is
  'Master COD switch. When false, api/place-order.js refuses every COD checkout regardless of the per-boutique flag.';

-- The switch is only as real as the server-side check in api/place-order.js.
-- The client reads it too, but that is a courtesy — the same shape as the
-- existing per-boutique check, where ShopContext refuses early and the server
-- refuses authoritatively.
