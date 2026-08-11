-- ⚠ NUMBERING: this file and its sibling both shipped as `0068_`. See
-- `0068a_fix_price_drop_trigger.sql`. Apply 0068a before this one. Both are
-- idempotent, and both were already applied in production before the rename —
-- re-running either is a no-op.
--
-- Register a shop's pickup address with Shiprocket automatically on approval.
--
-- 0067 stored `shiprocket_pickup_location` but expected an admin to create the
-- address by hand in the Shiprocket panel and paste the nickname back. That is
-- three minutes per boutique, forever, and it scales badly: at fifty shops it is
-- an afternoon, and it is exactly the kind of copy-paste that gets a digit wrong
-- in a phone number nobody checks until a pickup fails.
--
-- Now: approving a boutique calls the `shiprocket-pickup` Edge Function, which
-- POSTs the shop's own address to Shiprocket and writes the nickname back here.
--
-- WHAT THIS CANNOT DO, AND IT MATTERS:
-- Shiprocket's *panel* makes you confirm a pin on a map. Their API takes no
-- coordinates at all — it geocodes the text address instead. So an
-- auto-registered address is only as good as `address_line` + `pincode`, and a
-- vague address yields a pin the pickup rider cannot find. That failure is
-- invisible until a parcel is not collected. Hence `shiprocket_pickup_error`
-- and the registered_at stamp below: the admin console shows which shops were
-- registered automatically, so a failed pickup has an obvious first suspect,
-- and the manual panel route stays available for fixing a bad pin.

-- Null until Shiprocket accepts the address. Together with
-- shiprocket_pickup_location (0067) this distinguishes the three real states:
--   location null, registered null  → never attempted
--   location set,  registered null  → an admin pasted it by hand
--   location set,  registered set   → created through the API
alter table boutiques add column if not exists shiprocket_pickup_registered_at timestamptz;

-- The last failure, kept verbatim. Shiprocket's validation messages are specific
-- ("phone must be 10 digits", "pin code not serviceable") and are the whole
-- diagnosis; collapsing them to a boolean would throw away the useful part.
alter table boutiques add column if not exists shiprocket_pickup_error text;

comment on column boutiques.shiprocket_pickup_registered_at is
  'When Shiprocket accepted this shop as a pickup address via the API. NULL with a pickup_location set means an admin registered it by hand in the panel.';

-- CLAUDE.md rule 5: boutiques lost its blanket SELECT in 0021, so a new column
-- is invisible — including to its owner — until it is named in the grant.
grant select (shiprocket_pickup_registered_at, shiprocket_pickup_error)
  on boutiques to anon, authenticated;
