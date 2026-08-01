# MangaiMart — Full QA Report

**Date:** 2026-08-01
**Build:** `main` @ `0a98f00`, app version 0.1.0
**Targets:** local dev `http://localhost:5173` (primary) + deployed `https://agilam-boutiques.vercel.app` (smoke)
**Database:** Supabase project `mtxmuaskmyhnqczctwlp`, migrations 0001–0051 applied
**Method:** real browser automation (headless Chromium via Playwright) driving the real UI against the real API and the real database, plus direct DB verification of every write. No credentials appear in this report.

---

## Executive summary

MangaiMart is a **substantially better-built product than a pre-launch marketplace usually is at this stage.** The core commercial loop genuinely works: I placed a real COD order through the real UI as a real signed-in buyer, and watched it land correctly in the database, in the seller's console, and in the admin console, with correct money, correct stock decrement, and a correct seller notification. I then accepted it as the seller and watched the status, the sales counters and the buyer's tracking timeline all update correctly.

The security posture is the strongest part of the system. **31 of 31 tenant-isolation and privilege-escalation probes passed with zero failures** — sellers cannot see or touch each other's orders, products, bank details or payouts; buyers cannot enumerate other customers, rewrite their own order totals, mint coupons or promote themselves to admin; the admin APIs correctly refuse anonymous, buyer and seller tokens. Checkout re-derives all pricing server-side, so a tampered client cannot dictate a price, and forged Razorpay signatures are rejected.

The problems that exist are **operational and financial-reporting problems, not architectural ones.** The single most serious finding is not a code bug at all: **production and "test" are the same Supabase project**, so this QA run's orders are live on the public site and there is no safe place to rehearse a migration. Beyond that I found and fixed a buyer-facing dead end (order notifications led to "Order not found"), a seller cash figure that under-reported by the delivery fee, an admin GMV that counted cancelled orders, and a health endpoint that reported payments healthy while they were completely broken.

**Prepaid payment could not be tested at all** — the configured Razorpay test credentials are rejected by Razorpay itself (401). Since UPI is the default-selected payment method, this is a launch blocker wherever those keys are in force.

### Scores

| Area | Score | Basis |
|---|---:|---|
| **Buyer** | 82 / 100 | Core journey works end to end and looks premium; lost points for the notification dead end (fixed), search/checkout state lost on refresh, and prepaid being untestable. |
| **Seller** | 88 / 100 | Console is complete and accurate; the cash-to-collect defect was real and is fixed. The full new-seller journey — wizard, image upload, product create/edit, inventory, approval gating — passed end to end. |
| **Admin** | 86 / 100 | 18 surfaces, all load clean, metrics verified against DB and correct after the GMV fix. Admin *actions* not exercised. |
| **Mobile** | 88 / 100 | Zero horizontal overflow at 7 viewports across 8 pages — genuinely good. Lost points for sub-32px tap targets and a toast that covers content. |
| **Security** | 93 / 100 | 31/31 isolation probes passed; server-side pricing; forged signatures rejected. Lost points for the shared prod/test database and the service-role key exposure risk. |
| **Performance** | 80 / 100 | Deployed routes ~2.8 s to interactive, 0 broken images, code-split bundles, clean network. Lost points for no measured budget and repeated `/api/geo` calls. |
| **Production readiness** | 68 / 100 | Held down almost entirely by the shared database, the broken payment credentials, and maintenance mode being on in public. |
| **Overall** | **80 / 100** | |

### Launch classification

> ## 🔴 NOT READY — IMPORTANT ISSUES
>
> Not because the software is weak — it is good — but because three
> **configuration** facts would each cause real damage on day one: production and
> test share a database, prepaid payment is dead with the current Razorpay
> credentials, and the public site is showing a maintenance banner and a joking
> beta notice. All three are hours of work, not weeks. Fix those and this moves
> to **READY WITH MINOR FIXES**.

---

## Issues

### P0 — Critical

#### P0-1 · Production and "test" are the same Supabase project — there is no test environment
- **Role:** Operations / all
- **Surface:** Deployment topology
- **Steps to reproduce:**
  1. Read `.env` → `VITE_SUPABASE_URL` = project `mtxmuaskmyhnqczctwlp`.
  2. `curl https://agilam-boutiques.vercel.app/api/health` → `"project":"mtxmuaskmyhnqczctwlp.supabase.co"`.
  3. Load the deployed `/buyer/results` → **17 pieces, 9 boutiques** — identical to local.
- **Expected:** Per `ENVIRONMENTS.md`, production uses a prod Supabase project and staging a **separate** test project, so "nothing you do in test can touch real buyers, sellers, orders, or money."
- **Actual:** One project serves both. The three QA orders this run placed, and the QA buyer account, are live on the public site right now. An untested migration would be applied directly to the data real users depend on.
- **Root cause:** The documented two-project setup (`ENVIRONMENTS.md` §1) was never completed — the test Supabase project does not exist, so Vercel's Preview scope resolves to the same project as Production.
- **Files/DB involved:** `ENVIRONMENTS.md`, Vercel environment variables, Supabase project list.
- **Fix implemented:** None — this is infrastructure provisioning that only the account owner can perform.
- **Retest result:** n/a
- **Status:** **MANUAL ACTION REQUIRED** — create the test Supabase project, apply `supabase/_bundle.sql` + `seed.sql`, and point Vercel's Preview scope at it exactly as `ENVIRONMENTS.md` already specifies.

#### P0-2 · Razorpay credentials are rejected — all prepaid payment is dead
- **Role:** Buyer
- **Surface:** `/buyer/payment` → `/api/create-order`
- **Steps to reproduce:**
  1. Add any item to the bag, reach the payment step, leave the default **UPI** selected, press Pay.
  2. `POST /api/create-order` → `401 {"error":"Could not create payment order"}`.
  3. Confirm it is the credentials, not the code: call Razorpay directly with the configured key pair → `401 {"error":{"code":"BAD_REQUEST_ERROR","description":"Authentication failed"}}`.
- **Expected:** A Razorpay order is created and the checkout modal opens.
- **Actual:** Every prepaid checkout fails. UPI is the **default-selected** method, so this is the path most buyers take. Only buyers who actively switch to Cash on Delivery can complete a purchase.
- **Root cause:** The `rzp_test_…` key id / secret pair in the environment is invalid, revoked or mismatched. Not an application defect.
- **Files/DB involved:** `.env` (local), Vercel env vars (deployed), `api/create-order.js`.
- **Fix implemented:** None possible from code. **Related fix shipped** — see P2-2: `/api/health` now detects this instead of reporting healthy.
- **Retest result:** Re-ran after the health fix — `/api/health` now returns `503` with `razorpay: {ok:false, mode:"test", status:401, error:"Authentication failed"}`, correctly surfacing the failure.
- **Status:** **MANUAL ACTION REQUIRED** — issue fresh Razorpay keys and confirm `/api/health` returns `checkoutReady: true` in each environment. Until then prepaid must be assumed broken in production too: the deployed health check reported `razorpay.ok: true` only because the old check merely tested that the strings were non-empty.

---

### P1 — High

#### P1-1 · Every buyer order notification led to "Order not found" — **FIXED**
- **Role:** Buyer
- **Surface:** `/buyer/notifications` → `/buyer/orders/:id`
- **Steps to reproduce (before fix):**
  1. Sign in as a buyer with an order.
  2. Open `/buyer/orders/<order uuid>` — the URL an order notification builds.
  3. Screen shows *"Order not found — We couldn't find that order on this device."* Waited 9 s; never resolved.
- **Expected:** The buyer's own order opens with its tracking timeline.
- **Actual:** A permanent dead end. Confirmed on a cold context too, so it was not a hydration race.
- **Root cause:** `NotificationsInbox.tsx:51` navigates using `notifications.order_id` — the **DB uuid**. But the buyer's order model (`PlacedOrder`) was keyed only by the display id (`#AGL-…`) and the bare order number, and `TrackOrder` matched on just those two. The uuid matched neither. The orders *list* worked because it links with the display id, which masked the bug.
- **Files involved:** `src/lib/orderHistory.ts`, `src/pages/buyer/TrackOrder.tsx`, `src/components/notifications/NotificationsInbox.tsx` (caller).
- **DB involved:** `orders.id`, `notifications.order_id`.
- **Fix implemented:** Carried the row uuid through the buyer order model as `rowId` (`fromBuyerOrder` now sets it from `o.id`; `BuyerDbOrder` gained `id`), and `TrackOrder` now resolves an order by display id **or** order number **or** `rowId`.
- **Retest result:** ✅ All three entry paths resolve — click-through from the list (no regression), direct load of the uuid URL, and a cold context with localStorage cleared. `tsc -b` clean.
- **Status:** **FIXED**

#### P1-2 · Seller's "Cash to collect" under-reported by the delivery fee — **FIXED**
- **Role:** Seller
- **Surface:** `/seller/dashboard` vs `/seller/orders`
- **Steps to reproduce (before fix):**
  1. Place a COD order of ₹1,899 goods + ₹79 delivery + ₹49 handling = **₹2,027**.
  2. `/seller/dashboard` → "Cash to collect **₹1,948**".
  3. `/seller/orders` → "**₹2,027** still to collect in cash".
  4. The printed invoice on the order also said **PAY ON DELIVERY ₹2,027**.
- **Expected:** One figure everywhere — the amount actually counted out at the door.
- **Actual:** The dashboard was ₹79 short **per order**. For a cash business this is the number a seller reconciles their till against; at scale it silently drifts.
- **Root cause:** `src/lib/orderView.ts` defines the canonical `collectAmount` as goods + delivery + handling, but `Dashboard.tsx` re-implemented it locally as `total + cod_fee`, dropping `shipping_fee`. The `orderView` comment even documents an *earlier* divergence between these same two screens — the duplication was the real defect.
- **Files involved:** `src/pages/seller/Dashboard.tsx`.
- **Fix implemented:** Deleted the bespoke reduce; the tile now sums `collectAmount` from the shared order view the Orders page already uses, so the two cannot diverge again.
- **Retest result:** ✅ Dashboard **₹2,027**, Orders banner **₹2,027**, invoice ₹2,027 — all three agree. `tsc -b` clean.
- **Status:** **FIXED**

---

### P2 — Medium

#### P2-1 · Admin GMV, Revenue and Platform earning counted cancelled orders — **FIXED**
- **Role:** Admin
- **Surface:** `/admin/overview`
- **Steps to reproduce (before fix):** Open the overview → "GMV (all time) **₹17.9k**, 13 earned orders", while the database contains one cancelled order worth ₹1,500.
- **Expected:** A cancelled order earned the marketplace nothing and must not appear in GMV, Revenue, Avg. order or the 10% Platform earning tile.
- **Actual:** GMV overstated by ₹1,500 and the platform booked ₹150 of commission on an order nobody paid for.
- **Root cause:** `isEarned` in `src/data/admin.ts` excluded `rejected` and `refunded` but **not** `cancelled`.
- **Files involved:** `src/data/admin.ts`.
- **Fix implemented:** `isEarned` now also excludes `cancelled`.
- **Retest result:** ✅ GMV **₹16.4k**, **12** earned orders — matches an independent DB query exactly. `tsc -b` clean.
- **Status:** **FIXED**

#### P2-2 · `/api/health` reported payments healthy while they were entirely broken — **FIXED**
- **Role:** Operations
- **Surface:** `GET /api/health`
- **Steps to reproduce (before fix):** With the invalid Razorpay keys of P0-2 in place, call `/api/health` → `200 {"checkoutReady":true,"razorpay":{"ok":true}}` — while every prepaid checkout 401s.
- **Expected:** The endpoint exists specifically so that "hit it after any deploy or key rotation and it says, in one line, whether orders can be written" (its own docstring). It must not give false assurance.
- **Actual:** `razorpay.ok` only tested that both env vars were non-empty strings. An invalid or rotated key is a perfectly well-formed string, so the check could never fail for the reason that actually matters. **The deployed production health endpoint was reporting `razorpay.ok: true` on exactly this basis, so production's payment credentials remain unverified.**
- **Files involved:** `api/health.js`.
- **Fix implemented:** Added `checkRazorpay()`, which performs the cheapest authenticated read Razorpay offers (`GET /v1/payments?count=1` — moves no money, creates nothing) and reports the gateway's own error text and the key mode (`test`/`live`), never the key. A network failure is reported as unreachable rather than as invalid credentials.
- **Retest result:** ✅ `503` with `razorpay: {ok:false, mode:"test", status:401, error:"Authentication failed"}` and `checkoutReady:false`. The invisible failure is now a one-line diagnosis.
- **Status:** **FIXED**

#### P2-3 · `/api/health` and `/api/geo` served their own JavaScript source in dev — **FIXED**
- **Role:** Developer / operations
- **Surface:** local `npm run dev`
- **Steps to reproduce (before fix):** `curl http://localhost:5173/api/health` → returns the contents of `api/health.js` as an ES module, HTTP 200.
- **Expected:** JSON from the handler.
- **Actual:** Neither route was in the dev-server route table, so Vite treated them as source modules. `/api/health` — the endpoint `ENVIRONMENTS.md` tells you to check first — was unusable locally, and the presence tracker parsed JavaScript as JSON on every navigation.
- **Root cause:** `devApi()`'s `routes` map in `vite.config.ts` omitted both.
- **Files involved:** `vite.config.ts`.
- **Fix implemented:** Added both (read-only, side-effect-free, so safe to expose in dev). Deliberately did **not** add `/api/run-payouts`.
- **Retest result:** ✅ `/api/health` returns real JSON with live DB probes; `/api/geo` returns `{"city":"","region":"","country":"","label":""}`.
- **Status:** **FIXED**

#### P2-4 · Refreshing search results silently discards the query
- **Role:** Buyer
- **Surface:** `/buyer/results`
- **Steps to reproduce:**
  1. Search "saree" from the header → *"SEARCH RESULTS 'saree' · 3 pieces"*, URL stays `/buyer/results`.
  2. Press F5.
  3. Page now reads **"All collections · 17 pieces"** — the query is gone, with no warning.
- **Expected:** A refresh keeps the search; a search is a shareable, bookmarkable place.
- **Actual:** Search state lives only in React context. `Results.tsx` never reads `useSearchParams`, and `GlobalSearch.tsx` navigates to `/buyer/results` with no query string. So searches cannot be shared, bookmarked, or survive a reload, and the browser back button cannot restore one.
- **Root cause:** Search/filter/sort state is held in memory rather than in the URL.
- **Files involved:** `src/pages/buyer/Results.tsx`, `src/components/buyer/GlobalSearch.tsx`, `src/pages/buyer/FilterSheet.tsx`, `src/state/ShopContext.tsx`.
- **Fix implemented:** **None.** Doing this properly means making the URL the source of truth for query + filters + sort across four files, which is a real refactor with regression risk across every discovery surface. I judged that too broad to land unreviewed at the end of a QA pass rather than genuinely unsafe.
- **Recommended fix:** Mirror query/filters/sort into `useSearchParams`, read them on mount, and keep `ShopContext` as a derived cache. Same change also fixes P2-5.
- **Status:** **OPEN**

#### P2-5 · Refreshing or deep-linking `/buyer/checkout` bounces the buyer back to the bag
- **Role:** Buyer
- **Surface:** `/buyer/checkout`
- **Steps to reproduce:**
  1. Sign in, add an item (bag shows 1 item, ₹1,978).
  2. Navigate directly to `/buyer/checkout` — or reach checkout and press F5.
  3. Lands on `/buyer/cart`, having lost the delivery details already typed.
- **Expected:** A buyer who refreshes mid-checkout stays in checkout.
- **Actual:** Bounced to the bag. Mid-checkout refresh is common on flaky mobile connections, and this is the highest-value moment in the funnel to lose someone.
- **Root cause:** Same class as P2-4 — the checkout guard evaluates before the DB-backed cart has hydrated, and no checkout state is addressable.
- **Files involved:** `src/pages/buyer/Checkout.tsx`, `src/state/ShopContext.tsx`.
- **Fix implemented:** **None** — same refactor as P2-4.
- **Recommended fix:** Hold the redirect until the cart has finished hydrating (a `loading` state on the cart), rather than treating "not yet loaded" as "empty".
- **Status:** **OPEN**

#### P2-6 · Admin and seller disagree on whether uncollected COD is revenue
- **Role:** Admin / seller
- **Surface:** `/admin/overview` vs `/seller/dashboard`
- **Steps to reproduce:** With three unpaid COD orders placed today, `/seller/dashboard` shows "Total Revenue **₹0**" while `/admin/overview` shows "Revenue · Today **₹4.9k**" and "Platform earning · Today **₹490**".
- **Expected:** One revenue-recognition rule across the platform.
- **Actual:** The seller console deliberately excludes uncollected COD ("*a COD order whose cash the seller has not yet collected is a promise, not revenue*"), while the admin console counts it and books 10% commission on it.
- **Root cause:** Two independent definitions — `earned()` in `Dashboard.tsx` tests `payment_status === 'paid'` for COD; `isEarned()` in `admin.ts` does not.
- **Files involved:** `src/data/admin.ts`, `src/pages/seller/Dashboard.tsx`.
- **Fix implemented:** **None — deliberately.** Unlike the cancelled-order case (P2-1, unambiguously wrong), this is a revenue-recognition *policy* decision: GMV conventionally counts placed orders, while "Revenue" and "Platform earning" arguably should not count cash nobody has collected. Changing platform accounting semantics is explicitly on your stop-and-ask list.
- **Status:** **OPEN — needs your decision.** Tell me which definition is authoritative and I will make both consoles agree. (`admin.ts`'s query would also need `payment_status` added to its select.)

#### P2-8 · Buyers saw a boutique's join date presented as its founding year — **FIXED**
- **Role:** Buyer / seller
- **Surface:** `/buyer/boutique/:id` and boutique cards vs `/seller/dashboard`
- **Steps to reproduce (before fix):**
  1. Onboard a boutique that enters "Years in business: **3**" and leaves the optional established-year blank.
  2. Seller console shows **"Since 2023"**.
  3. Buyer-facing boutique profile shows **"Since 2026"**.
- **Expected:** One founding year, everywhere.
- **Actual:** The buyer mapping skipped `years_in_business` and fell straight through to the row's `created_at` — i.e. the date they joined MangaiMart, dressed up as the date the business was founded. A boutique trading since 2023 was advertised to buyers as brand new. On a marketplace where "established" is exactly the signal a buyer weighs trust on, this consistently understates every seller who doesn't fill in the optional field.
- **Root cause:** `src/state/CatalogContext.tsx` used `established_year ?? created_at.getFullYear()`, missing the middle fallback the seller console applies (`src/pages/seller/Dashboard.tsx:95-97`). `years_in_business` was already being fetched — just unused.
- **Files involved:** `src/state/CatalogContext.tsx`.
- **Fix implemented:** Buyer mapping now mirrors the seller chain: `established_year` → derived from `years_in_business` → `created_at`.
- **Retest result:** ✅ Buyer profile now reads **"Since 2023"**, matching the seller console. `tsc -b` clean.
- **Status:** **FIXED**

#### P2-7 · Maintenance mode and a joking beta notice are live on the public site
- **Role:** First-time visitor
- **Surface:** every buyer page, including deployed
- **Steps to reproduce:** Load `/buyer/home` → a gold banner reads *"We're carrying out maintenance right now — some things may be slower or unavailable"*, plus a floating card cycling messages such as *"Tester Alert: Ungaluku theriyama neenga QA team member ah irukeenga. Thanks for the free testing!"* and *"Idhu beta version... crash aana refresh pannunga."*
- **Expected:** A premium fashion marketplace's first impression.
- **Actual:** `platform_settings.maintenance_mode = true`. The first thing a prospective customer reads is that the site is broken and that they are unpaid QA. It directly contradicts the (genuinely lovely) storefront design and undermines the trust a payment page needs.
- **Root cause:** Configuration — `platform_settings.maintenance_mode`, plus the `LaunchNotice` copy.
- **Fix implemented:** None — this is your content and go-live decision, not a defect.
- **Status:** **MANUAL ACTION REQUIRED** — turn maintenance mode off in `/admin/settings` before launch and replace the jokes with a plain, confident "launching soon" line.

---

### P3 — Low

| ID | Role | Surface | Issue | Status |
|---|---|---|---|---|
| P3-1 | Buyer | `/api/place-order` | `qty: -5` is silently **clamped to 1** and a real order is written, rather than rejected as invalid input. No money or stock harm (price re-derived, stock decremented correctly), but it creates an order the buyer never asked for. Should be a 400. | OPEN |
| P3-2 | Buyer | Product data | One product has **MRP ₹2,199 below its price ₹2,599**. The PDP defensively hides the bad discount (good), but the seller form allowed it. Add a `mrp >= price` validation. | OPEN |
| P3-3 | Buyer | `/buyer/home` mobile | The "Launching soon" card **overlaps the "Shop by collection" heading** at 1440×900 and on mobile. | OPEN |
| P3-4 | All | Mobile a11y | 29 controls on Home and 33 on Inspire are under the 32px tap-target floor — the toast close button is 28×28, "VIEW ALL →" is 84×15, carousel dots are 6×6. | OPEN |
| P3-5 | Admin | `/admin/login` | The email field is `type="text"`, so mobile keyboards don't switch to email layout and browser validation is skipped. | OPEN |
| P3-6 | All | Console | Two React Router v7 future-flag warnings on every page load. Adding `v7_startTransition` and `v7_relativeSplatPath` clears them and de-risks the upgrade. | OPEN |
| P3-7 | Admin | `src/data/admin.ts` | `fetchOverviewMetrics()` and `fetchGmvBars()` are **dead code** with a different, wrong GMV definition (sums *all* orders → ₹88.8k vs the correct ₹16.4k, and 5× the platform revenue). Harmless today, a trap if ever wired up. Delete them. | OPEN |
| P3-8 | Buyer | `/buyer/coupons` | The coupons screen shows the correct COD-inclusive total (₹2,027) but omits the "Cash handling ₹49" line from its itemisation, so the lines don't visibly add to the total. | OPEN |
| P3-9 | Ops | Repo | `vite-dev.out.log` is tracked in git and changes on every dev run. Add to `.gitignore`. | OPEN |
| P3-10 | Buyer | Catalogue | Home shows category chips (e.g. **Lehengas**) that return **0 results**, because the only lehengas belong to rejected boutiques. Hide empty categories. | OPEN |
| P3-11 | Data | `boutiques` | `Littleshop dpm`'s slug is `"Littleshop-dpm\r\n"` — a stored CRLF. Harmless today (links resolve via client-side name slugification) but it will break any future slug-based lookup. Trim it. | OPEN |
| P3-12 | New seller | `/auth/signin/seller` | After signing up, a brand-new seller is bounced to a sign-in screen headed **"Welcome back"** — wrong tone for someone who has never signed in. The only explanation ("Check your email to confirm your account, then sign in to finish setting up") is a **transient toast**; miss it and there is no on-screen reason why signup appeared to fail. Make the notice persistent and reword the heading for the post-signup case. | OPEN |
| P3-13 | New seller | onboarding step 2 | The `Lakshmi Priya` placeholder is reused for "Your full name", "Owner name" **and** "Account holder name". Harmless for a human, but it makes the three fields look like the same field. | OPEN |

---

## Security assessment

**31 of 31 permission-boundary probes passed. Zero failures.** All were non-destructive: each asserts that an unauthorised request is *refused*.

| Boundary | Probes | Result |
|---|---|---|
| Anonymous visitor | 6 | Cannot list profiles, orders, payouts or the admin audit log; cannot insert an order; cannot change platform commission. ✅ |
| Seller → another boutique | 8 | Cannot read others' orders, re-price/delete their products, rename their boutique, read their **bank/GST details** via `boutique_private`, or see their payouts. Cannot promote self to admin. Cannot inflate own `sold_count` (migration 0023 guard holds). ✅ |
| Buyer | 8 | Sees only own orders; cannot enumerate other customers; cannot read payouts or the audit log; cannot promote self to admin; **cannot rewrite their own order's total or status**; cannot change commission; cannot mint a coupon. ✅ |
| Admin APIs | 9 | `admin-list-users`, `admin-create-user`, `admin-delete-user` each return 401 with no token and 403 with a buyer or seller token. ✅ |

**Checkout integrity, separately verified:**
- `/api/place-order` accepts only `product_id`, `qty`, `size` — price is re-derived server-side. A client-supplied `price`/`total`/`amount` is ignored.
- Out-of-stock → `409 "Sorry, some items just sold out."`
- COD above the ₹10,000 cap → `400` with the correct message.
- Forged Razorpay signature → `400 "Payment could not be verified"`.
- Prepaid with no payment object → `400 "Payment is required to place an order"`.
- Invalid coupon code → priced as a ₹0 discount rather than failing checkout.

**Top security risks (all configuration, none code):**
1. **Shared prod/test database** (P0-1) — the largest risk in the system.
2. **Service-role key handling** — the key was pasted into the git-tracked `.env.example` during this session. It was moved to `.env` and the template restored before any commit, so it never entered history, **but it should be rotated**, as it also passed through a chat transcript.
3. **Unverified production payment credentials** (P0-2 / P2-2).

---

## Feature matrix

| Feature | Buyer | Seller | Admin | Frontend | Backend | Database | Tested | Result |
|---|---|---|---|---|---|---|---|---|
| Browse / catalogue | ✔ | — | ✔ | ✔ | ✔ | ✔ | Yes | **PASS** |
| Search | ✔ | — | — | ✔ | ✔ | ✔ | Yes | **PARTIAL** (P2-4 refresh) |
| Filters / sort | ✔ | — | — | ✔ | ✔ | ✔ | Renders only | **PARTIAL** |
| Product detail | ✔ | — | — | ✔ | ✔ | ✔ | Yes, 5 products | **PASS** |
| Boutique profile + share | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Yes | **PASS** |
| Wishlist | ✔ | — | — | ✔ | ✔ | ✔ | Yes, incl. reload | **PASS** |
| Cart + pricing | ✔ | — | — | ✔ | ✔ | ✔ | Yes | **PASS** |
| Checkout / address validation | ✔ | — | — | ✔ | ✔ | ✔ | Yes | **PASS** |
| **COD order** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Yes, end to end | **PASS** |
| **Prepaid (Razorpay)** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | **BLOCKED** | **BLOCKED** (P0-2) |
| Order history + tracking | ✔ | — | — | ✔ | ✔ | ✔ | Yes | **PASS** (after P1-1 fix) |
| Seller order inbox + accept | — | ✔ | ✔ | ✔ | ✔ | ✔ | Yes | **PASS** |
| Stock / overselling guard | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Yes | **PASS** |
| Sales counters | — | ✔ | ✔ | ✔ | — | ✔ | Yes | **PASS** |
| Seller cash-to-collect | — | ✔ | — | ✔ | — | ✔ | Yes | **PASS** (after P1-2 fix) |
| Notifications (in-app) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Yes | **PASS** (after P1-1 fix) |
| Notifications (email) | ✔ | ✔ | ✔ | — | ✔ | — | No — `RESEND_API_KEY` empty | **NOT TESTED** |
| Admin dashboard metrics | — | — | ✔ | ✔ | ✔ | ✔ | Yes, vs DB | **PASS** (after P2-1 fix) |
| Admin console (18 routes) | — | — | ✔ | ✔ | ✔ | ✔ | Load-tested | **PASS** |
| Payouts console | — | ✔ | ✔ | ✔ | ✔ | ✔ | Read only | **PARTIAL** |
| Refunds console | — | — | ✔ | ✔ | ✔ | ✔ | Read only | **PARTIAL** |
| Coupons | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Pricing only | **PARTIAL** |
| RLS / tenant isolation | ✔ | ✔ | ✔ | — | ✔ | ✔ | 31 probes | **PASS** |
| **New-seller onboarding (8-step wizard)** | — | ✔ | ✔ | ✔ | ✔ | ✔ | Yes, end to end | **PASS** |
| **Boutique approval gating** | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Yes | **PASS** |
| **Image upload (Storage)** | — | ✔ | — | ✔ | ✔ | ✔ | Yes, 3 images | **PASS** |
| Seller product CRUD | — | ✔ | ✔ | ✔ | ✔ | ✔ | Yes (create + edit) | **PASS** |
| Inventory / sold-out state | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Yes | **PASS** |
| Buyer ↔ seller messaging | ✔ | ✔ | — | ✔ | ✔ | ✔ | No | **NOT TESTED** |
| Inspire engagement | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | Load only | **NOT TESTED** |
| Returns / refund lifecycle | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | No | **NOT TESTED** |
| Seller ads / promote | — | ✔ | ✔ | ✔ | ✔ | ✔ | Load only | **NOT TESTED** |

---

## End-to-end journey verdict

| # | Stage | Result | Evidence |
|---|---|---|---|
| 1 | Visitor lands | **PASS** | `/` → `/buyer/home`, 34 images, 0 broken, fonts loaded, no page errors |
| 2 | Buyer signs up + logs in | **PASS** | Account created via app signup; auto-profile trigger set role `buyer`; session survives reload |
| 3 | Search | **PARTIAL** | "saree"→3, "kurta"→6, nonsense→0 with empty state; query lost on refresh (P2-4) |
| 4 | Product detail | **PASS** | ₹1,899 / MRP ₹1,999 / 5% off / "Low · 5 left" — all match the DB row exactly |
| 5 | Wishlist | **PASS** | Saved, survived reload |
| 6 | Cart | **PASS** | ₹1,899 + ₹79 delivery = ₹1,978 ✓ |
| 7 | Checkout | **PASS** | Empty and malformed input both rejected with a clear message |
| 8 | Order placed (COD) | **PASS** | `#AGL-9B69O3F86D`, ₹1,899 + ₹79 + ₹49 = **₹2,027** ✓ |
| 8b | Order placed (prepaid) | **BLOCKED** | Razorpay 401 (P0-2) |
| 9 | Seller receives it | **PASS** | Order inbox, dashboard "1 order waiting", notification, customer record — all correct |
| 10 | Seller accepts | **PASS** | `pending → accepted`, `accepted_at` set, `sold_count` 0→1, `units_sold` 0→1 |
| 11 | Buyer tracks | **PASS** | "Confirmed", timeline with real timestamps, "Keep ₹2,027 ready", ETA 5–10 Aug |
| 12 | Packed → shipped → delivered | **NOT TESTED** | "Mark shipped" present and correct; not exercised |
| 13 | Return / completion | **NOT TESTED** | Refunds console loads; lifecycle not exercised |
| 14 | Commission | **PASS (calculation)** | 10% from `platform_settings`; payouts console shows COD net-off ("seller owes us ₹378") correctly |
| 15 | Seller settlement | **NOT TESTED** | Console read-only; no payout triggered (correctly — requires your approval) |
| 16 | Admin reconciliation | **PASS** | Order visible with correct buyer, boutique, amount and status; GMV correct after P2-1 |

**Verdict: the marketplace loop works.** Stages 1–11 and 14–16 are proven on real data across all three roles. Stages 12–13 and prepaid are unproven.

---

## New-seller journey verdict

Walked in full as a first-time visitor with a brand-new account. **Every stage passed.**

| # | Stage | Result | Evidence |
|---|---|---|---|
| 1 | Land on `/seller/register` | **PASS** | 8-step wizard, clear promise of what's ahead |
| 2 | Account step validation | **PASS** | Empty submit → inline errors on name, email, password (min 6) and the T&C consent |
| 3 | Account created | **PASS** | Auth user written with `role: "seller"` in metadata |
| 4 | Email confirmation gate | **PASS (with P3-12)** | Bounced to sign-in with a toast explaining why; heading reads "Welcome back" |
| 5 | Profile auto-created on confirm | **PASS** | Trigger honoured the metadata → `profiles.role = 'seller'` |
| 6 | Sign in while unverified | **PASS** | Lands on a **soft-gated** dashboard: "Your boutique setup is not finished — buyers cannot see you yet" |
| 7 | Wizard steps 2–7 | **PASS** | Boutique info, contact, address, business, store settings, payout — all saved as you go |
| 8 | Logo + cover upload | **PASS** | Crop dialog ("Frame your logo/cover" → Use photo), both stored in Supabase Storage with public URLs |
| 9 | Payout: UPI **or** bank | **PASS** | UPI alone accepted, exactly as the hint promises; a half-filled bank block correctly demands completion |
| 10 | Review & submit | **PASS** | Full read-only summary with per-section Edit; consent required before submit |
| 11 | Submitted | **PASS** | `draft → pending`, `onboarding_step 6 → 7`, lands on a clear "UNDER REVIEW" screen |
| 12 | **Gating while pending** | **PASS** | Not in the directory (9 boutiques), not in the catalogue (17 pieces), direct boutique URL → "Boutique not found", product PDP → unavailable |
| 13 | Add a product while pending | **PASS** | Allowed, with an honest banner: "Products you add now go live as soon as you are approved" |
| 14 | Product form validation | **PASS** | Empty publish → Category, Colour, Fabric, Occasion, Price, Stock all flagged Required |
| 15 | Product published | **PASS** | Correct row: ₹1,234 / MRP ₹1,999 / stock 7 / Anarkali / Black / Kanchipuram Silk / Bridal + image in Storage; seller shown "Not visible to buyers yet" |
| 16 | Admin sees it in Approvals | **PASS** | Queue row with city, owner, submitted date; Review drawer shows every field the seller entered |
| 17 | Admin approves | **PASS** | `approved`, `verified: true`, `reviewed_at` set; queue 2 → 1, Approved 9 → 10 |
| 18 | **Goes live to buyers** | **PASS** | Directory 9 → **10 boutiques**, catalogue 17 → **18 pieces**, PDP live with a correct 38% off, boutique profile shows the verified badge |
| 19 | Edit product | **PASS** | Invalid (negative price, empty title) rejected with DB unchanged; valid edit ₹1,234→₹1,499, stock 7→3 propagated to the seller list *and* the buyer PDP (25% off recomputed) |
| 20 | Inventory → 0 | **PASS** | Buyer's Add to Bag correctly disappears; restoring stock brings it back |

The one defect this journey surfaced (P2-8, the founding-year mismatch) was fixed
and retested. The rest is P3 copy polish.

## Coverage — what I did not test

Stated plainly, because the brief asked for 44 phases and I prioritised the commercial core and security.

**NOT TESTED:** buyer↔seller messaging round trip (24); seller Inspire posting (25); Inspire engagement persistence — likes/save/share (11); the shipped→delivered transitions (23 tail); the return/refund lifecycle (33); payout execution (34); email/push notification delivery (35) — `RESEND_API_KEY` is empty so no email can send; admin *write* actions on users and products, and boutique **rejection** (29–31); product deletion; full accessibility audit (41); exhaustive dead-control click-through (43).

**Now tested** (was NOT TESTED in the first pass): the entire new-seller journey — onboarding wizard, Storage image upload, product create and edit, inventory/sold-out, approval gating, and the admin approve action. See the journey table above.

**Load-tested only** (route renders, no errors, but interactions not exercised): all 18 admin surfaces, 17 seller surfaces, the filter/sort sheets, ads, coupons, broadcast and audit.

Everything marked PASS above was actually executed and observed.

---

## Recommendations

### Top 10 must-fix before launch
1. **Create the separate test Supabase project** (P0-1). Nothing else on this list is safe to iterate on until there is somewhere to rehearse.
2. **Issue working Razorpay keys** and confirm `/api/health` reports `checkoutReady: true` in every environment (P0-2).
3. **Rotate the service-role key** — it passed through a chat transcript.
4. **Turn off maintenance mode** and replace the joking beta copy (P2-7).
5. Fix the **checkout refresh bounce** (P2-5) — it loses buyers at the moment of payment.
6. Decide the **COD revenue-recognition rule** and make admin and seller agree (P2-6).
7. Make **search URL-addressable** (P2-4).
8. Add **`mrp >= price`** validation to the product form (P3-2).
9. **Reject negative/zero quantities** at the API instead of clamping (P3-1).
10. Configure **`RESEND_API_KEY`** or remove the email promises from the UI — order confirmation emails currently cannot send.

### Top 10 buyer improvements
1. Keep search, filters and sort in the URL so results are shareable and survive refresh.
2. Add a **Buy Now** button — the PDP only offers Add to Bag.
3. Hide category chips that return zero results (P3-10).
4. Show the "Cash handling ₹49" line on the coupons screen (P3-8).
5. Move the "Launching soon" card so it stops covering the collections heading (P3-3).
6. Enlarge tap targets to 44px on mobile (P3-4).
7. Preserve typed delivery details across a checkout refresh.
8. Surface delivery ETA on the PDP, not only at checkout.
9. Let a buyer re-order from a past order in one tap.
10. Add order-confirmation email once Resend is configured.

### Top 10 seller improvements
1. Exercise and harden product create/edit — the one core seller flow this run could not verify.
2. Add a bulk stock-update action (8 products are already low-stock).
3. Warn on `mrp < price` in the product form.
4. Surface the ₹79 delivery component explicitly in the cash-to-collect tile.
5. Add packed / ready-for-pickup states if that matches real operations — only `pending → accepted → shipped → delivered` exist today.
6. Let sellers export orders for a date range (Export exists; scope it).
7. Show a payout ETA against the 3-day hold window.
8. Push notification when a new order arrives, not just an in-app badge.
9. Low-stock digest email.
10. Let sellers set their own slug for a vanity `/b/…` link.

### Top 10 admin improvements
1. Single source of truth for revenue definitions shared with the seller console.
2. Delete the dead `fetchOverviewMetrics`/`fetchGmvBars` (P3-7).
3. Reconcile the Refunds tile — "₹66.6k owed to buyers" against ₹16.4k GMV needs an explanation or a fix.
4. Add an environment banner naming the Supabase project the console is reading.
5. Make the audit log filterable by actor and date.
6. Add confirm-with-reason on destructive user actions.
7. Show pending-approval age so nothing sits unreviewed.
8. Add CSV export to Reports.
9. Alert when `/api/health` degrades.
10. Use `type="email"` on the admin login field (P3-5).

### Top 10 performance improvements
1. Cache `/api/geo` per session — it fired four times in one checkout.
2. Add `v7_startTransition` / `v7_relativeSplatPath` to cut per-render work and warnings.
3. Set an explicit performance budget; deployed routes settle ~2.8 s.
4. Preload the hero image (largest above-the-fold paint).
5. Serve product images as responsive `srcset` + AVIF/WebP.
6. Paginate `/admin/orders` — it currently selects every order with joins.
7. Index `orders(boutique_id, created_at desc)` for the seller inbox.
8. Debounce the live-presence channel.
9. Lazy-load the Inspire carousel below the fold.
10. Precompute admin dashboard aggregates rather than reducing all orders client-side.

### Missing features
Buy Now; re-order; guest order lookup by number + phone; buyer-initiated returns UI; delivery partner / AWB tracking integration; email + SMS/WhatsApp order notifications; seller payout statements (PDF); product variants beyond size/colour; review moderation queue automation; abandoned-cart recovery.

### Unnecessary / risky
The joking beta notice; the dead `fetchOverviewMetrics`/`fetchGmvBars`; the tracked `vite-dev.out.log`; the vestigial `boutiques.slug` column (12 of 17 rows are null and links resolve by name anyway) — either populate it on create or drop it.

### Marketplace flow problems
1. **No test environment** — the whole promotion workflow in `ENVIRONMENTS.md` is currently fictional (P0-1).
2. **Prepaid dead, COD alive** — the marketplace can only take cash today (P0-2).
3. **Order status vocabulary is thinner than operations will need** — no packed / ready-for-pickup, no courier handoff, no AWB.
4. **Revenue is defined twice** and the two definitions disagree (P2-6).
5. **Returns exist as a console but not as a buyer-initiated flow** — a buyer cannot request a return in the UI.
6. **One account = one role**, so a seller who wants to shop needs a second account. Worth an explicit decision.

---

## Appendix — evidence

Verified by direct database read after each UI action:

```
order faff02ae-f79b-4de3-b8d5-0ac800e1447d  (#AGL-9B69O3F86D)
  buyer_id       b5392947…  = the signed-in QA buyer          ✓
  boutique_id    9f6f34b6…  = Studio Mahil                    ✓
  total 1899 | shipping_fee 79 | cod_fee 49  → ₹2,027         ✓
  payment_method COD | payment_status pending                 ✓
  status pending → accepted, accepted_at set                  ✓
order_items      title/price/qty/size/color all correct       ✓
products         stock 5 → 4, sold_count 0 → 1 (on accept)    ✓
boutiques        units_sold 0 → 1                             ✓
notifications    1 row → seller cf00834f…, correct title/body ✓
```

Screenshots and raw run logs are in the session scratchpad
(`…/scratchpad/shots/`, 40+ captures across 7 viewports and all three roles).

---

*No test result in this report was written without executing it. Items that
could not be executed are marked BLOCKED, NOT TESTED or MANUAL ACTION REQUIRED
with the reason.*
