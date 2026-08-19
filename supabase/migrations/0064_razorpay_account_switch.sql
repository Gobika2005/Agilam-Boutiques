-- Razorpay account switch — emergency failover to a second merchant account.
--
-- Additive and idempotent: safe to run once in the Supabase SQL editor after
-- 0048 (which created platform_settings). Nothing here drops data or changes
-- existing behaviour — the column defaults to 'primary', which is exactly what
-- every payment path does today.
--
-- Why a DB row and not an env var: an env var change needs a redeploy, and the
-- situation this exists for (account frozen / under review / keys rotated) is
-- measured in minutes of dead checkout. Admin → Settings flips this row and the
-- very next /api/create-order opens on the other account.
--
-- The keys themselves stay in the server environment and are never stored here:
--   RAZORPAY_KEY_ID   / RAZORPAY_KEY_SECRET    → 'primary'
--   RAZORPAY_KEY_ID_B / RAZORPAY_KEY_SECRET_B  → 'backup'
--
-- Only order CREATION follows this switch. Signature verification, the
-- place-order amount binding, webhooks and refunds accept either account (see
-- api/_razorpay.js), so a buyer who was mid-checkout when the switch flipped
-- still settles on the account that took their money.

alter table platform_settings
  add column if not exists razorpay_account text not null default 'primary';

do $$ begin
  alter table platform_settings
    add constraint platform_settings_razorpay_account_check
    check (razorpay_account in ('primary', 'backup'));
exception when duplicate_object then null; end $$;

-- Read/write policies are inherited from 0048: public read (the value is not a
-- secret — it names an account slot, never a key), admin-only write.
