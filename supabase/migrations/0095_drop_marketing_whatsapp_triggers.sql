-- ═══════════════════════════════════════════════════════════════════════════════
-- 0095 — Stop queueing WhatsApp messages for two deleted templates
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- `seller_low_stock` (queued by 0090) and `seller_ad_decision` (queued by 0092)
-- were re-categorised by Meta from UTILITY to MARKETING, reworded to remove the
-- promotional framing, and then deleted at the owner's decision on 2026-08-21.
-- Their triggers were left behind, and a trigger that queues a message for a
-- template Meta no longer has is worse than no trigger at all.
--
-- WHY THIS IS NOT MERELY UNTIDY
-- Nothing dangerous happens on the wire: the send fails with 132001 ("template
-- name does not exist"), `wa-drain` treats that as permanent and gives up after
-- one attempt, and Meta does not bill for a message it never delivered. The harm
-- is to the monitoring. Every stock crossing and every ad decision would leave a
-- `failed` row in `whatsapp_outbox`, and the admin panel's Failed count is the
-- one signal anybody watches to notice a real breakage — an expired access
-- token, a revoked number. Burying that signal under permanent, expected noise
-- is how the next genuine failure goes unnoticed.
--
-- WHAT IS NOT LOST
-- Neither event was ever surfaced any other way by these functions, so nothing
-- else regresses. Sellers still see stock levels in their console, and ad
-- campaign status on the Advertisements screen — which is where both were
-- visible before 0090 and 0092 added the WhatsApp copy.
--
-- WHY MARKETING WAS WORTH AVOIDING, RECORDED FOR THE NEXT TIME
-- Not the price, though marketing runs several times utility. Marketing messages
-- attract more blocks and mutes, and a degraded quality rating throttles the
-- WHOLE number — including the order messages that actually matter. Two
-- low-volume seller conveniences were not worth putting that at risk. If either
-- is ever wanted again, submit it under a NEW name: an edit inherits the old
-- category, while a fresh submission is categorised from scratch.
--
-- Requires 0090 and 0092. Idempotent and re-runnable in the Supabase SQL editor.

-- ── Low stock (added 0090) ───────────────────────────────────────────────────
drop trigger if exists trg_wa_low_stock on products;
drop function if exists wa_on_low_stock();

-- ── Ad campaign decisions (added 0092) ───────────────────────────────────────
drop trigger if exists trg_wa_ad_decision on ad_campaigns;
drop function if exists wa_on_ad_decision();

-- ── Verify ───────────────────────────────────────────────────────────────────
--
--   -- should return zero rows:
--   select tgname from pg_trigger
--    where tgname in ('trg_wa_low_stock', 'trg_wa_ad_decision');
--
--   -- should return zero rows:
--   select proname from pg_proc
--    where proname in ('wa_on_low_stock', 'wa_on_ad_decision');
--
--   -- nothing new should accumulate here for these two:
--   select template, status, count(*) from whatsapp_outbox
--    where template in ('seller_low_stock', 'seller_ad_decision')
--    group by template, status;
