-- Persist a buyer's delivery pincode on their profile.
--
-- `profiles` already carries name/phone/city/address (0005_profile_address.sql)
-- but not the pincode, so a signed-in buyer's pincode never round-tripped
-- across devices/refresh — it only lived in memory. Add it here so the full
-- delivery address syncs. Covered by the existing "profiles: self update/select"
-- policies.
--
-- Idempotent and safe to re-run in the Supabase SQL editor.
alter table profiles add column if not exists pincode text;
