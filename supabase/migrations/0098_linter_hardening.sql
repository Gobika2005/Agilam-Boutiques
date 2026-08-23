-- 0098: clear the Supabase database linter — mutable search_path, anon-callable
-- SECURITY DEFINER RPCs, and bucket listing.
--
-- Idempotent and re-runnable in the Supabase SQL editor. Touches no table data
-- and no function body: every change here is a privilege or an attribute.
--
-- The linter run of 2026-08-23 raised four WARN classes. Three are fixed below.
-- The fourth (pg_trgm in `public`) is deliberately left alone — see section 4.
--
-- == 1) Functions with a mutable search_path =================================
--
-- 24 functions were created without a `set search_path` clause, so they run
-- with whatever path the caller has. The default path puts `pg_temp` FIRST,
-- which is the whole problem: any role that can create a temp object can
-- shadow a table or function the body names unqualified, and the body then
-- reads the attacker's object instead of ours.
--
-- That is not theoretical for this list. `guard_profile_privileges`,
-- `orders_no_cod`, `boutiques_no_cod`, `platform_settings_no_cod` and
-- `zz_cod_clear_payment_on_failure` are the triggers that enforce the role
-- lockdown (0010/0086) and the no-cash rule (0085). They are SECURITY INVOKER,
-- so they run as the user whose write they are meant to be policing — exactly
-- the user who controls the search_path.
--
-- Pinning to `public` alone (not `public, pg_temp`) drops pg_temp out of the
-- path entirely, which is what we want: nothing here has any business reading
-- a temp object. This matches the 149 existing `set search_path = public`
-- clauses elsewhere in the series.
--
-- `alter function` only sets an attribute — no body is rewritten, so there is
-- no risk of reviving an older definition of a function that later migrations
-- replaced. The `to_regprocedure` guard makes it a no-op for anything already
-- dropped, which is what keeps this re-runnable.
--
-- Cost, stated honestly: a SQL function carrying a SET clause can no longer be
-- inlined by the planner. Of these 24, only `order_counts_as_sale(text)` and
-- `is_settleable(orders)` are ever called from a query rather than from
-- procedural code (0023's counter backfill, 0078a's payout gate), both over
-- order-sized row counts. That is the right trade against a guard trigger the
-- guarded user can redirect.

do $$
declare
  fn text;
  sigs constant text[] := array[
    'public.boutiques_set_slug()',
    'public.boutiques_build_slug(text, uuid)',
    'public.products_set_slug()',
    'public.products_build_slug(text, uuid)',
    'public.seo_slugify(text, int)',
    'public.boutiques_no_cod()',
    'public.platform_settings_no_cod()',
    'public.orders_no_cod()',
    'public.zz_cod_clear_payment_on_failure()',
    'public.guard_profile_privileges()',
    'public.is_service_role()',
    'public.is_settleable(public.orders)',
    'public.order_counts_as_sale(text)',
    'public.reserve_stock(jsonb)',
    'public.release_stock(jsonb)',
    'public.stamp_order_status_timestamp()',
    'public.shortlist_limits()',
    'public.message_preview(text)',
    'public.touch_expense_updated_at()',
    'public.touch_shipment_updated_at()',
    'public.wa_msisdn(text)',
    'public.wa_param(text, text)',
    'public.wa_thread_key(text)',
    'public.wa_mask(text)'
  ];
begin
  foreach fn in array sigs loop
    if to_regprocedure(fn) is not null then
      execute format('alter function %s set search_path = public', fn);
    else
      raise notice '0098: skipped %, not present', fn;
    end if;
  end loop;
end $$;

-- == 2) SECURITY DEFINER functions the anonymous role could call =============
--
-- Postgres grants EXECUTE to PUBLIC on every new function. `anon` is a member
-- of PUBLIC, so a function is reachable at /rest/v1/rpc/<name> unless the
-- grant is revoked — the `grant ... to authenticated` these functions already
-- carry adds nothing, because the default grant was never taken away first.
--
-- 2a) `notify` and `notify_linked` are the real finding. Both are SECURITY
-- DEFINER, both insert straight into `notifications`, and neither checks the
-- caller at all — they were written as internal helpers for the trigger
-- functions in 0044/0081/0077b and never locked down. Any anonymous visitor
-- could POST /rest/v1/rpc/notify with someone else's profile_id and put an
-- arbitrary title and body into their notification centre, which is a phishing
-- surface pointed at our own users ("Refund processed", "Order cancelled").
--
-- Revoking from `authenticated` too is safe and is the point: every caller is
-- itself SECURITY DEFINER (all 19 call sites checked), so they execute as the
-- function owner and need no grant. Nothing in src/, api/ or
-- supabase/functions/ calls either by RPC.
revoke all on function public.notify(uuid, text, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.notify_linked(uuid, text, text, text, text)
  from public, anon, authenticated;

-- 2b) The rest below each have a real guard inside — `is_staff()` for the two
-- ad decisions and the broadcast, `auth.uid()` ownership for the other three —
-- so anonymous calls already fail. They fail with an unhelpful error though
-- (`is_staff()` is revoked from anon by 0086, so anon gets 42501 "permission
-- denied for function is_staff" rather than a clean refusal), and relying on a
-- body check when the grant can carry it is the wrong way round. Revoke the
-- default, keep the `authenticated` grant every console actually uses.
do $$
declare
  fn text;
  sigs constant text[] := array[
    'public.admin_approve_ad(uuid)',
    'public.admin_pause_ad(uuid)',
    'public.broadcast_notification(text, text, text)',
    'public.create_offline_sale(uuid, text, text, jsonb, numeric, text)',
    'public.mark_conversation_read(uuid, text)',
    'public.reply_to_review(uuid, text)'
  ];
begin
  foreach fn in array sigs loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon', fn);
      execute format('grant execute on function %s to authenticated', fn);
    else
      raise notice '0098: skipped %, not present', fn;
    end if;
  end loop;
end $$;

-- 2c) NOT revoked, on purpose. The linter flags these too and it is wrong
-- about them:
--
--   is_admin()                    — rule 7. Policies with no TO clause are TO
--                                   PUBLIC and call it; revoking from anon
--                                   would fail the whole anonymous read with
--                                   42501 and blank the storefront, which is
--                                   what 0086 did and 0087 undid.
--   toggle_boutique_follow        — anonymous browsing is the product.
--   toggle_product_like             0004/0020/0031/0037 grant these to anon
--   record_product_view/_share      deliberately.
--   record_ad_impression/_click
--   unsubscribe_by_token          — reached from an email link by someone with
--   resubscribe_by_token            no session. The token is the credential.
--   daily_digest, report_recipients,
--   claim_report_run, finish_report_run
--                                 — same shape: guarded by a report token
--                                   compared inside the body (0093).
--
-- The token-guarded four are an accepted risk, not a clean bill of health: a
-- leaked report token is a full read of the day's business numbers. That is a
-- secret-rotation question, not a grant question.

-- == 3) Public buckets that allow listing ====================================
--
-- `product-images`, `boutique-images`, `catalogue-images` and `review-images`
-- are public buckets, so their objects are served from
-- /storage/v1/object/public/... without consulting RLS at all. The broad SELECT
-- policy on storage.objects therefore does nothing for image display — its
-- only effect is to let any caller enumerate every file in the bucket,
-- including the boutique-id folder structure and every photo ever uploaded to
-- a since-deleted product.
--
-- Verified before dropping: nothing in the app lists these buckets. The only
-- storage calls are upload(), getPublicUrl() (pure string building, no request)
-- and remove() in src/lib/uploadImage.ts, plus createSignedUrl() in
-- src/lib/privateUpload.ts against the private `expense-proofs` bucket, which
-- keeps its own policy and is not touched here.
--
-- To roll back, recreate any one of them as:
--   create policy "<bucket>: public read" on storage.objects
--     for select using (bucket_id = '<bucket>');
drop policy if exists "product-images: public read"   on storage.objects;
drop policy if exists "boutique-images: public read"  on storage.objects;
drop policy if exists "catalogue-images: public read" on storage.objects;
drop policy if exists "review-images: public read"    on storage.objects;

-- == 4) pg_trgm stays in `public` — deliberate ===============================
--
-- The linter wants `alter extension pg_trgm set schema extensions`. Not worth
-- it here. 0080 built ~20 GIN indexes on `gin_trgm_ops` across products,
-- boutiques, orders, profiles and coupons; those indexes survive the move
-- (they bind the operator class by OID), but every function in this series
-- that pins `set search_path = public` — which after section 1 is essentially
-- all of them — loses the ability to name a trgm operator, and any future
-- `%` similarity query silently stops resolving.
--
-- The warning itself is about namespace hygiene, not access: pg_trgm exposes
-- no privileged operation. Trading a live-database extension move plus a
-- search_path audit of 170-odd functions against that is a bad deal. Revisit
-- only if the schema is ever rebuilt from scratch.
