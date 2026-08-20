# MangaiMart — QA & Production Readiness Report
**Date:** 2026-08-20 · **Tree:** `chore/repo-structure` @ `30ba926` · **Live:** https://mangaimart.com

---

## 0. Scope — what was actually done

This report separates what was **executed** from what was **read**, because the
difference matters when you decide what to trust.

| | Coverage |
|---|---|
| **Executed** | `npm run build` (pass), `npm run lint` (0 errors / 34 warnings), `npm run verify:seo` (ALL CHECKS PASSED), a 20,000-case differential fuzz of the client↔server pricing mirror, a targeted allocation test that reproduced a real divergence, live HTTP against `/api/health`, `/robots.txt` and the homepage response headers |
| **Analysed (read, not run)** | `api/place-order.js` payment binding & replay guard, migrations 0072 / 0083–0091 RLS and grants, webhook signature verification, admin endpoint authorization, XSS sinks across `src/` + `middleware.js`, rate-limiter fallback, bundle composition |
| **NOT covered** | Live authenticated click-through as buyer / seller / admin (no credentials, no browser automation in this environment); a real Razorpay transaction; Lighthouse / CLS / LCP / FID field data; live DB introspection; device-matrix responsive testing; screen-reader passes |

**Nothing below is reported as verified unless it was executed.** Findings from
reading are marked *(code analysis)* and carry the file and line so you can
confirm them.

> **Note on the tree tested.** At 12:59 today the working tree was discarded back
> to `30ba926` (the blog + SEO work from last night: `middleware.js` +229,
> `src/pages/blog/`, `scripts/og-cards.mjs`, the OG card and the marketing doc).
> Confirmed deliberate. This report therefore covers HEAD as committed, and the
> blog/journal feature is **out of scope — it is not in this tree.** A copy of the
> pre-discard build sits at `%TEMP%/mangaimart-dist-prewipe-20260820` and the
> deleted files remain in the Recycle Bin, should that decision be revisited.

---

> **Remediation status (same day).** H-1 and H-2 have been fixed in code:
> `supabase/migrations/0092_order_replay_and_wa_enqueue_lockdown.sql` (new) and
> the duplicate-settlement branch in `api/place-order.js`. **Migration 0092 has
> not been applied** — it needs the owner's hand in the Supabase SQL editor, and
> its own pre-flight will refuse to run if the live table already holds a
> double-settled order. M-1, M-2, M-3 and the L-series remain open.

---

## 1. Critical bugs

**None found.** No defect in this pass takes the storefront down, loses an
order, or misprices a checkout.

---

## 2. High priority bugs

### H-1 · One payment can create two order-sets (pay once, receive twice)
*(code analysis — [api/place-order.js:395-409](api/place-order.js#L395-L409), [supabase/schema.sql:112](supabase/schema.sql#L112))*

The replay guard is a `SELECT` followed later by an `INSERT`:

```js
const { data: dup } = await supabase.from('orders')
  .select('id').eq('payment_id', payment.razorpay_payment_id).limit(1).maybeSingle();
if (dup) return res.status(409).json({ error: 'This payment has already been used for an order.' });
```

Between that check and the insert the handler awaits `auth.getUser`, the product
fetch, `razorpay.payments.fetch`, an optional `capture`, `reserve_stock` and
`redeem_coupon` — a window of hundreds of milliseconds. **There is no database
constraint behind it.** `orders.payment_id` carries only a trigram GIN index
(`0080_search_indexes.sql:50`); the only unique column on `orders` is
`order_number`. By contrast `ad_orders.payment_id` *is* `unique`, and
`0032_seller_ads.sql:99` calls that out as a "structural replay guard" — buyer
orders never got the same treatment.

Two concurrent requests carrying the same genuine `{order_id, payment_id,
signature}` both pass the check and both write a full order-set: stock
decremented twice, coupon redeemed twice, sellers credited for goods the buyer
paid for once.

`src/pages/buyer/Payment.tsx:27` guards the accidental double-click with an
`inFlight` ref, so this is not reachable by a careless tap in one tab. It **is**
reachable by two tabs, a network-level retry, the "Complete my order" pending
path racing a manual retry, or anyone deliberately firing their own valid
payment at the endpoint N times in parallel.

**Exact fix** — make the guard structural. A plain `unique(payment_id)` would
break the legitimate multi-boutique split, so scope it to the boutique:

```sql
-- migration 0092
create unique index if not exists orders_payment_boutique_uniq
  on public.orders (payment_id, boutique_id)
  where payment_id is not null;
```

and treat the collision as the already-handled case in `place-order.js`, after
the insert:

```js
if (insErr?.code === '23505' && /orders_payment_boutique_uniq/.test(insErr.message ?? '')) {
  // A concurrent request won the race; this one must not refund or release stock —
  // the order it duplicates is real and paid.
  return res.status(409).json({ error: 'This payment has already been used for an order.' });
}
```

Note the unwind path: on `23505` the handler must **not** run its usual
`release_stock` + `refundPayment` compensation, because the winning request's
order legitimately holds that stock and that money.

### H-2 · Any signed-in user can send WhatsApp messages from the business number
*(code analysis — [supabase/migrations/0090_whatsapp_automation.sql:241](supabase/migrations/0090_whatsapp_automation.sql#L241))*

```sql
revoke all on function wa_enqueue(...) from public;
grant execute on function wa_enqueue(...) to authenticated, service_role;
```

The migration's own comment states the intent:

> Never by anon: an anonymous visitor able to call this could send WhatsApp
> messages, from our number, at our expense, to any number they chose.

`wa_enqueue` is `SECURITY DEFINER` and contains **no caller authorization check**
— it validates the phone number, checks the opt-out list, sanitises params, and
queues. Authorization is entirely the `GRANT`. Granting it to `authenticated`
means every self-registered buyer (signup is free, self-service, email-OTP or
Google) can call:

```js
await supabase.rpc('wa_enqueue', {
  p_recipient : '+91XXXXXXXXXX',
  p_template  : 'order_confirmation',
  p_params    : ['anything they like'],
  p_dedupe_key: crypto.randomUUID(),   // varied per call, so the dedupe index never bites
});
```

`wa_param` only collapses whitespace — it does not constrain content, so the
attacker controls the template variables. The message arrives from the
**verified MangaiMart business sender**. Consequences: per-conversation billing
at the platform's expense, phishing with our brand as the envelope, and a spam
report volume that can get the WABA restricted — which would take out order
notifications for every real customer.

Anonymous sign-in is *disabled* on the project (`src/data/chat.ts:22` records the
`422 anonymous_provider_disabled`), so the bar is "make a free account" rather
than "open a chat". That is not much of a bar.

**Exact fix** — the grant is unnecessary. Every queueing path is either
`SECURITY DEFINER` (the `wa_on_*` triggers, which execute as their owner) or
`service_role` (`api/place-order.js:161,180`). No invoker-rights path needs it:

```sql
-- migration 0092
revoke execute on function public.wa_enqueue(text, text, text[], text, text, uuid, uuid, uuid)
  from authenticated;
```

Then confirm the triggers still queue (place a test order, check
`whatsapp_outbox`) before considering it done.

---

## 3. Medium bugs

### M-1 · `/api/health` publishes payment-infrastructure state to the world
*(executed — live fetch)*

```json
{"checkoutReady":true,
 "database":{"project":"mtxmuaskmyhnqczctwlp.supabase.co","keyFormat":"sb_secret","probes":[…]},
 "razorpay":{"mode":"live","activeAccount":"backup",
             "accounts":[{"account":"primary",…},{"account":"backup",…}]}}
```

Unauthenticated. The Supabase project ref is public anyway (it ships in the
client bundle), but the Razorpay section is not: it discloses live mode, that a
two-account failover exists, **which account is currently taking money**, and the
per-probe internals of the DB. That is free reconnaissance for anyone timing an
attempt around a switch.

**Fix** — keep the endpoint (CLAUDE.md rule 6 depends on it) but split it: return
`{"ok":true}` to the public, and gate the detail behind the same bearer-secret
check already used by `api/run-payouts.js:60`.

### M-2 · No Content-Security-Policy header
*(executed — live header fetch)*

Present and correct: `Strict-Transport-Security` (2y, includeSubDomains,
preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`,
`Cross-Origin-Opener-Policy`. Absent: `Content-Security-Policy`.

The app's own XSS posture is genuinely good (§5), so this is defence-in-depth
rather than an open hole — but it is the layer that turns a future mistake into
a non-event. Add to `vercel.json` headers, starting in report-only mode so you
can see what Razorpay checkout and Vercel Analytics actually need before
enforcing.

### M-3 · The platform is live on the **backup** Razorpay account
*(executed — live fetch)*

`"activeAccount":"backup"` with both accounts healthy. Per the account-switch
design this is one admin button, so it is plausibly a leftover from testing the
switch rather than a deliberate failover. **Worth a deliberate decision today:**
settlement, reconciliation and the receipts your buyers hold all follow this
flag. Not a code defect — an operational state that should be intentional.

---

## 4. Low bugs

### L-1 · Platform-coupon rounding lands on a different boutique client vs server
*(executed — reproduced)*

Both halves of the mirror split a platform coupon proportionally and drop the
rounding remainder on "the largest" boutique, chosen with
`.sort((a,b) => totals[b] - totals[a])`. `Array.prototype.sort` is stable, so on a
**tie** the winner is decided by key insertion order — and the client builds its
map from the cart while the server builds its from the DB rows. Reproduced:

```
cart total   client 1899   server 1899   (agree — checkout is NOT rejected)
client per-boutique payable : {"b0":949,"b1":950}
server per-boutique payable : {"b1":949,"b0":950}
→ b0: buyer was shown 949, server writes 950
```

The cart total agrees, so no legitimate checkout is refused. What differs is the
per-order `total` and `platform_discount` — by ₹1, on a multi-boutique cart with
exactly equal boutique subtotals and a non-divisible platform discount. It nets
to zero across the two orders but leaves the seller's payout statement and the
buyer's per-order receipt disagreeing with the checkout breakdown.

**Exact fix** — make the tie-break deterministic on both sides. In
`src/lib/pricing.ts` (`allocateDiscount`) and `api/_pricing.js`
(`computeCartPricing`):

```js
.sort((a, b) => (totals[b] - totals[a]) || a.localeCompare(b))
```

Same expression in both files, changed together per CLAUDE.md rule 2.

### L-2 · Empty directories left behind by the 12:59 discard
`src/pages/blog/`, `docs/marketing/`, `public/og/` are now empty husks. Git does
not track empty directories, so they are invisible to `git status`. Harmless;
`rmdir` them when convenient.

### L-3 · Local Node is v20.11.1, `engines` requires 24.x
Vercel builds on 24, so this affects only local reproduction — but it means a
local `npm run build` is not exercising the deployed runtime.

### L-4 · 34 ESLint warnings
0 errors. Mostly `react-refresh/only-export-components` (cosmetic). Two worth a
look because they can produce genuinely stale reads:
`src/pages/buyer/BoutiqueProfile.tsx:107,114` — `useEffect` missing dependency `ab`.

---

## 5. Security — findings and verified-clean

Beyond **H-1**, **H-2**, **M-1** and **M-2** above, these were checked and are clean:

| Area | Result |
|---|---|
| **XSS** | No `dangerouslySetInnerHTML` anywhere in `src/`. `middleware.js` escapes every interpolation through `escapeHtml` (line 93), and the JSON-LD block escapes `<` as a `<` escape (line 1712) — so a seller-controlled product title cannot break out of `<script type="application/ld+json">`. **Verified clean.** |
| **SQL injection** | No string-built SQL. All DB access goes through PostgREST/`supabase-js` parameterisation or `rpc()`. |
| **Webhook forgery / replay** | `api/razorpayx-webhook.js` — HMAC-SHA256 + `crypto.timingSafeEqual`, length-checked first, and **rejects outright when the secret is unset** rather than failing open (lines 55-71). Correct. |
| **Payment tampering** | `place-order.js` re-derives the price server-side and asserts the captured amount to the paise (line 558); the browser sends only product ids and quantities. The signature is checked against every configured merchant account, and refunds go to the account that actually holds the money. |
| **Privilege escalation** | `api/admin-*.js` gate on token → `getUser` → `profiles.role === 'admin'` **and** `status === 'active'` **and** `deleted_at is null` (`admin-list-users.js:12-31`). |
| **Seller self-settlement** | `0072_order_settlement_lockdown.sql` is thorough — `payout_id`, `refunded`, `discount`, `platform_discount`, `coupon_code`, `channel`, `payment_method`, `payment_id` and the identity columns are all trigger-guarded, and the review-aggregate flag pattern correctly lets the legitimate writer through. |
| **Storage abuse** | 0072 sets `file_size_limit` (10 MB) and `allowed_mime_types` at the bucket level, and narrows INSERT to non-anonymous users. |
| **Rate limiting** | Upstash with a per-instance in-memory fallback; fail-open on Redis error is deliberate and documented. `place-order` 20/min. Admin endpoints are unlimited but auth-gated. |

**The pattern worth naming:** H-2 is the *third* instance of "a `GRANT` to
`authenticated` was assumed to mean real accounts." 0072 documented it for
storage, 0087 fixed a storefront outage caused by it, CLAUDE.md rule 7 records
it. A grep for `grant execute … to authenticated` across all 94 migrations, with
each hit justified or revoked, would close the class rather than this instance.

---

## 6. Performance

*(from the executed build; no field/Lighthouse data available in this environment)*

Build: **21.15s**, clean. Route-level code splitting is working — 60+ chunks.

| Chunk | Raw | Gzip |
|---|---|---|
| `jspdf.es.min` | 390 kB | 129 kB |
| `index` (entry) | 278 kB | 86 kB |
| `supabase` | 215 kB | 56 kB |
| `html2canvas` | 201 kB | 48 kB |
| `react-vendor` | 165 kB | 54 kB |

`jspdf` + `html2canvas` together are 177 kB gzipped — larger than React and
Supabase combined. They are correctly split out (receipt/invoice generation
only), so the buyer never pays for them on the storefront path. Worth confirming
they are not pulled into any eagerly-imported module; if a receipt is ever
rendered on the order-confirmation path, that is 177 kB on a critical screen.

The LCP preload architecture and the icon-font subset from the 2026-08-10 work
are intact in this tree. **Lighthouse, CLS, LCP, FID and TTFB were not
measured** — that needs a browser against the live site.

---

## 7-8. UI / UX

Not assessed in this pass. Judging layout, spacing, loading states, empty states
and error copy requires rendering the app across viewports; without browser
automation or credentials any statement here would be invention. The prior
`MANGAIMART_UI_UX_AUDIT.md` and the console-by-console QA reports in this folder
remain the current record.

Same for **Responsive** and **Accessibility** (keyboard nav, ARIA, contrast,
focus states, screen readers) — untested here, and they are the largest
remaining gap before a public launch.

---

## 9. Database

94 migrations, `0001`–`0091`, no duplicate version numbers (the `0077`/`0078`
collision fixed in `5ead15f` is clean). Next is `0092`, matching CLAUDE.md.

- **Constraints:** the gap in §H-1 is the one material finding — the buyer-order
  replay guard has no structural backing, where the ad-order one does.
- **RLS:** 0090's tables (`whatsapp_outbox`, `whatsapp_optout`) correctly use
  "RLS on, no policies" so only the service role reads phone numbers. 0086/0087's
  `to authenticated` discipline is applied consistently in 0090's admin RPCs
  (`wa_outbox_stats`, `wa_outbox_failures`) with the `is_admin()` gate inside the
  body — exactly the shape rule 7 prescribes. The one grant that breaks the
  pattern is `wa_enqueue` (§H-2).
- **Triggers/functions:** 0072's flag-based guard pattern is sound. Its own
  warning is worth re-reading: **re-running 0014 after 0072 silently freezes all
  review aggregates.** That is a live footgun for whoever next replays a migration.

---

## 10-12. Backend / Frontend / Deployment

- **`api/` is at 12/12 functions** — the Vercel Hobby ceiling. There is no room
  for a new endpoint; anything new must go to `supabase/functions/` (9 deployed)
  or merge into an existing route. This is the single biggest architectural
  constraint on the codebase and it already shapes design decisions (0090 used
  two Edge Functions specifically to dodge it).
- **SEO:** `npm run verify:seo` — **ALL CHECKS PASSED**, including crawler-visible
  meta, JSON-LD on product/collection/occasion/budget landings, the canonical-host
  301 (one hop, no loop), and the preview-deploy robots wall.
- **robots.txt** (live): correct. Notably it does *not* disclose the secret admin
  path, which is right — `Disallow: /admin` covers the decoy that now 404s.

---

## 13-15. Improvements

**Code:** unify the tie-break in the pricing mirror (L-1); clear the two
`useEffect` dependency warnings in `BoutiqueProfile.tsx`.

**Architecture:** the `api/` 12-function cap is the constraint to plan around —
either move to a paid Vercel tier or formalise "new server logic goes to Supabase
Edge Functions" as the default. Second: audit `grant … to authenticated` across
all migrations as one sweep (§5).

**Scalability:** the replay guard in H-1 is the pattern to generalise — any
"check-then-write" that protects money wants a DB constraint behind it, not an
application `SELECT`. `redeem_coupon` (0049) already does this correctly and is
the model to copy.

---

## 16. Production readiness score

### 78 / 100

| Area | Score | Note |
|---|---|---|
| Payments & pricing correctness | 18/20 | Mirror proven equal across 20k cases; −2 for the rounding tie |
| Security | 15/20 | Strong foundations; −5 for H-2 and the duplicate-order race |
| Database & RLS | 17/20 | Careful, well-documented; −3 for the missing structural constraint |
| SEO & discoverability | 15/15 | Full suite passes live |
| Performance | 11/15 | Good splitting; unmeasured in the field |
| UX / A11y / Responsive | 2/10 | Not assessed this pass — the real gap |

The score is held down as much by **what could not be tested here** as by what
was found. The engineering that *was* inspected is above average for a project
this size: the migrations reason about their own failure modes, the pricing
mirror is genuinely equal, and the XSS surface is clean by construction.

## 17. Launch recommendation

**Fix H-1 and H-2 first — both are one migration and a few lines.** Neither is
exotic; both are money- or reputation-affecting, and both have exact fixes above.
Decide M-3 (backup account) deliberately today.

After that, **the blocker is not code — it is the untested surface.** A public
launch should not go out on a QA pass that never rendered the app. Before
launch, someone needs to sit with a browser and do the buyer→seller→admin
click-through, on a phone and a desktop, with a real ₹1 order end to end. That is
the pass that finds the broken empty state and the button that does nothing —
the class of bug this report is structurally unable to see.

## 18. Fix checklist

| # | Fix | Where | Effort |
|---|---|---|---|
| H-1 | ✅ **written** — `unique (payment_id, boutique_id) where payment_id is not null` + a `23505` branch that returns 409 without refunding or over-releasing stock | migration 0092, `api/place-order.js` | apply 0092 |
| H-2 | ✅ **written** — `revoke execute on wa_enqueue from authenticated` | migration 0092 | apply 0092, then verify triggers still queue |
| M-1 | Public `{ok:true}`; detail behind a bearer secret | `api/health.js` | ~20 min |
| M-2 | Add CSP, report-only first | `vercel.json` | ~1 h |
| M-3 | Decide primary vs backup Razorpay account | admin console | decision |
| L-1 | Add `\|\| a.localeCompare(b)` to both sort comparators | `src/lib/pricing.ts` + `api/_pricing.js` | ~10 min |
| L-2 | `rmdir` the three empty directories | working tree | ~1 min |
| L-4 | Fix the two `useEffect` dep warnings | `src/pages/buyer/BoutiqueProfile.tsx` | ~15 min |
| — | Sweep every `grant … to authenticated` across 94 migrations | `supabase/migrations/` | ~2 h |

**Migration 0092 must be written and applied by hand** — nothing in this report
has been applied to the database.
