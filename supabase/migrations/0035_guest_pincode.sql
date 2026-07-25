-- Guest delivery pincode (H-1).
--
-- The buyer checkout collects a 6-digit PIN code, but the orders table had no
-- column for it, so the value was silently dropped and sellers/couriers had no
-- pincode to ship against. Add the column alongside the other guest_* delivery
-- fields (guest_name / guest_phone / guest_city / guest_address). Nullable so
-- historical orders (and any signed-in flow that doesn't set it) stay valid.
--
-- Idempotent and safe to re-run in the Supabase SQL editor.
alter table orders add column if not exists guest_pincode text;
