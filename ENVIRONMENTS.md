# Environments — Test → Production

Two isolated environments, promoted by a git merge. Nothing you do in **test**
can touch real buyers, sellers, orders, or money.

```
 feature branch ──PR──▶  staging branch ──merge──▶  main branch
                          │                          │
                    Vercel Preview             Vercel Production
                    TEST Supabase project      PROD Supabase project
                    Razorpay TEST keys         Razorpay LIVE keys
                    corner "TEST" ribbon        (no ribbon)
```

| | **Production** | **Test / Staging** |
|---|---|---|
| Git branch | `main` | `staging` (and every PR preview) |
| Vercel env scope | **Production** | **Preview** |
| Supabase | prod project | **separate** test project |
| Razorpay | live keys (`rzp_live_…`) | test keys (`rzp_test_…`) |
| Emails (Resend) | real, verified domain | off / throwaway inbox |
| `VITE_APP_ENV` | `production` | `staging` |
| Visible marker | none | orange **TEST** corner ribbon |

Why a **separate Supabase project** and not one shared DB: with a single
project, test orders, seed data, and — worst — an untested migration all land on
the same tables real users depend on. A second project is free on Supabase's
tier and gives complete isolation. This is the recommended setup.

---

## One-time setup

Steps 1–4 use the Vercel and Supabase dashboards and can only be done by you
(the account owner). Everything in the repo is already wired.

### 1. Create the TEST Supabase project
1. https://supabase.com → **New project** (name it e.g. `agilam-test`).
2. **SQL editor** → bring the schema up to date. Either:
   - paste `supabase/schema.sql`, run it, then paste `supabase/seed.sql` for demo data; **or**
   - run `npm run bundle-migrations` and paste the generated `supabase/_bundle.sql` (all 48 migrations in order), then `supabase/seed.sql`.
3. **Authentication → Providers**: enable Email (and Google, if you use it) just like prod.
4. Create a test admin (README step 4) so you can reach `/admin` on staging.
5. Copy **Project Settings → API**: the project URL, the `anon` key, and the `service_role` key — these are the TEST values below.

### 2. Create the `staging` branch
Already created locally. Push it once:
```bash
git push -u origin staging
```

### 3. Point Vercel Preview at the test project
Vercel Project → **Settings → Environment Variables**. For **each** variable
below, add the value twice — once scoped to **Production** (prod value) and once
scoped to **Preview** (test value):

| Variable | Production scope | Preview scope |
|---|---|---|
| `VITE_APP_ENV` | `production` | `staging` |
| `VITE_SUPABASE_URL` | prod URL | **test** URL |
| `VITE_SUPABASE_ANON_KEY` | prod anon | **test** anon |
| `SUPABASE_URL` | prod URL | **test** URL |
| `SUPABASE_SERVICE_ROLE_KEY` | prod service role | **test** service role |
| `RAZORPAY_KEY_ID` | `rzp_live_…` | `rzp_test_…` |
| `RAZORPAY_KEY_SECRET` | live secret | test secret |
| `VITE_RAZORPAY_KEY_ID` | `rzp_live_…` | `rzp_test_…` |
| `RAZORPAY_WEBHOOK_SECRET` | live webhook secret | test webhook secret |
| `RESEND_API_KEY` | real key | blank / test key |
| `EMAIL_FROM` | verified domain | test sender |
| `APP_URL` | prod domain | staging URL |
| `UPSTASH_REDIS_REST_URL` | prod (optional) | separate test (optional) |
| `UPSTASH_REDIS_REST_TOKEN` | prod (optional) | separate test (optional) |

> The **Preview** scope applies to every non-production branch, so `staging`
> (and any PR) automatically gets the test values. `main` uses Production.

### 4. Point Razorpay & webhooks at test
- In the Razorpay **Test Mode** dashboard, add a webhook to
  `https://<your-staging-url>/api/razorpay-webhook` for `payment.captured` +
  `order.paid`, and use its secret as the Preview `RAZORPAY_WEBHOOK_SECRET`.
- Note: `vercel.json` crons (`/api/run-payouts`, `/api/ads`) run on the
  **Production** deployment only — they will not fire against the test project.

---

## Day-to-day workflow

```bash
# 1. build a change
git checkout staging && git pull
git checkout -b feature/whatever
# ...code...

# 2. open a PR into staging  -> Vercel builds a Preview on the TEST project
git push -u origin feature/whatever
#    verify on the preview URL — the orange TEST ribbon confirms it's not prod

# 3. merge the PR into staging -> the staging Preview updates
#    do end-to-end testing here (test Razorpay cards, test orders, etc.)

# 4. promote to production
git checkout main && git pull
git merge --no-ff staging
git push origin main        # -> Vercel deploys Production on the PROD project
```

### If the change includes a new DB migration
Migrations are applied by hand (SQL editor), in this order:
1. Apply it to the **test** project first and verify on staging.
   `npm run bundle-migrations -- --from 00NN` bundles only the new ones to paste.
2. Only after prod code is about to ship, apply the **same** SQL to the **prod**
   project. Apply the migration *before* (or together with) the `main` deploy so
   the new code never hits an old schema.

---

## Local testing against the test DB
```bash
cp .env.staging.example .env.staging   # fill in the TEST project values
npm run dev:staging                    # loads .env.staging, shows the TEST ribbon
```
`npm run dev` still uses `.env` (whatever you point it at). `.env.staging` and
`.env.production` are gitignored; only the `*.example` templates are committed.

## Safety checks
- The orange **TEST** corner ribbon means you're NOT on production. No ribbon on a
  deploy that should be test = a misconfigured `VITE_APP_ENV` — stop and fix it.
- `GET /api/health` reports which Supabase project the server functions resolved
  (guards against `SUPABASE_URL` vs `VITE_SUPABASE_URL` pointing at different
  projects). Check it after wiring each environment.
