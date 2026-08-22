# Team git workflow

How code reaches production once someone other than the owner is committing.

Decided 2026-08-22. This **supersedes** the old "commit straight to main, no
branches, no PRs" rule, which assumed a single author.

---

## The branch model

```
  employee  --push-->  work/<name>  --PR-->  |
                                             +-->  Selvakumar  --owner pushes-->  main  -->  production
  Claude session ---------commits----------> |        (staging)                             (Vercel)
```

| Branch | Who writes to it | What it is |
|---|---|---|
| `main` | **owner only** | Production. Vercel deploys it. Every commit here is live. |
| `Selvakumar` | owner + Claude session | Staging. All in-progress work accumulates here. |
| `work/<name>` | the employee | One branch per person or per feature. PRs into `Selvakumar`. |

**Nothing reaches `main` except by the owner pushing it.** That is the whole
point of the arrangement — review happens before the push, not after.

---

## One-time setup (owner)

`gh` (the GitHub CLI) is **not installed on this machine**, so these are UI
steps. Install it with `winget install GitHub.cli` if you would rather script them.

### 1. Add the employee

`Settings -> Collaborators -> Add people` -> **Write** access.

Write access lets them push branches. The ruleset below is what stops them
reaching `main` — the access level alone does not.

### 2. Protect `main`

`Settings -> Rules -> Rulesets -> New branch ruleset`

| Setting | Value |
|---|---|
| Name | `protect-main` |
| Enforcement | Active |
| Target branches | Include by pattern: `main` |
| Bypass list | **your own account** (`ssk6379007829-beep`), Role: Repository admin |
| Restrict deletions | on |
| Block force pushes | on |
| Require a pull request before merging | on |
| Require status checks | on, then add `eslint`, `typecheck + build`, `migration numbering` |

The bypass entry is what preserves `git push origin main` for you while
rejecting it for the employee.

> **If the repo is PRIVATE on the GitHub Free plan, rulesets are unavailable.**
> Check `Settings -> General` for the visibility, and the account plan under
> `Settings -> Billing`. Options if so: upgrade to Pro (~$4/mo), or run on
> convention only — CI still reports, but nothing physically blocks a push
> to `main`.

### 3. Add the two CI secrets

`Settings -> Secrets and variables -> Actions -> New repository secret`

| Secret | Value | Why it is safe here |
|---|---|---|
| `VITE_SUPABASE_URL` | your live Supabase URL | Already public in the shipped bundle |
| `VITE_SUPABASE_ANON_KEY` | the anon key | Public by design; RLS is the boundary |

**Never** add `SUPABASE_SERVICE_ROLE_KEY`, any `RAZORPAY_*` secret, or the real
`VITE_ADMIN_PATH` as an Actions secret. A collaborator with write access can
open a PR containing a workflow that prints them. CI uses a throwaway admin
path (`ci-build-only`) because it only needs to prove the code compiles.

### 4. Point Vercel at the right branches

`Vercel -> Project -> Settings -> Git`

- **Production Branch: `main`.** Confirm this. If it is anything else, the wrong
  branch is live right now.
- You chose to give `Selvakumar` a **preview** deployment. Before enabling it:

  > **Vercel preview deployments inherit Production environment variables
  > unless you scope them.** Left alone, the preview URL is wired to the real
  > Supabase project, real Razorpay, and the real admin path — a branch build
  > that can take real orders and move real money.
  >
  > Fix: `Settings -> Environment Variables`, and for every secret set a
  > **Preview**-scoped value pointing at a dev Supabase project and Razorpay
  > **test** keys. Only then turn the preview on.

---

## The employee's daily loop

```bash
git checkout Selvakumar
git pull origin Selvakumar

git checkout -b work/ram-cart-fix     # one branch per piece of work
# ...edit, test locally...
npm run lint && npm run build         # must pass before pushing

git add -A
git commit -m "fix: cart total ignored the district delivery band"
git push -u origin work/ram-cart-fix
```

Then open a PR **into `Selvakumar`** (not `main`) on github.com and fill in the
template. CI runs automatically; a red check means fix it before asking for review.

---

## The owner's review + release loop

**Review a PR** on github.com — read the diff, leave line comments, merge into
`Selvakumar` with **Squash and merge** (one commit per feature, so a bad change
is one clean revert).

**Pull it down for a deeper look** when it touches money, RLS, or migrations:

```bash
git fetch origin
git checkout Selvakumar && git pull origin Selvakumar
npm run lint && npm run build
# then ask Claude: "review the diff between main and Selvakumar"
```

**Release to production** when you are satisfied:

```bash
git checkout main
git pull origin main
git merge --no-ff Selvakumar -m "release: <what shipped>"
git push origin main          # <-- this is the moment it goes live
git checkout Selvakumar && git merge main && git push origin Selvakumar
```

That last line keeps `Selvakumar` level with `main` so the next diff is clean.

---

## Rules the employee must be told

1. **A merged migration is not a live migration.** Migrations are numbered and
   applied **by hand** by the owner in the Supabase dashboard. Never say a
   schema change is live; say "migration 00XX must be applied". Never run
   `supabase db push` — `schema_migrations` has no record of the hand-applied
   history, so a push replays the entire series over the live database.
2. **Take the next free migration number, and rebase before pushing.** CI fails
   the PR on a duplicate number. `0092` is already duplicated in history from a
   solo-author collision — do not add to that.
3. **Pricing is mirrored.** `src/lib/pricing.ts` (client) and `api/_pricing.js`
   (server) must change together; `api/place-order.js` asserts they agree to the
   paise. Change one alone and legitimate checkouts start failing.
4. **RLS is the security boundary**, not client-side checks. A policy with no
   `TO` clause attaches to `anon`. `is_staff()` is revoked from `anon`, so every
   policy using it MUST say `to authenticated` — that mistake blanked the entire
   storefront once.
5. **Colours are `--ag-*` CSS variables, never literal hex** — a hardcoded
   colour breaks dark mode.
6. **`boutiques` cannot be read with `select('*')`** — column-level grants. Name
   the columns.
7. **There is no cash on delivery.** Do not add one, and do not "tidy away" the
   COD columns — they hold real pre-0085 money that still has to add up.
8. **Never commit a secret.** `.env` is gitignored and has never been committed.
   Keep it that way. Need a new env var? Name it in the PR, send the value to
   the owner privately.

---

## Open decision: what environment the employee gets

Still undecided. They cannot run the app without an `.env`, and the choice is a
real security call:

| Option | Trade-off |
|---|---|
| **Separate Supabase dev project** (recommended) | Costs an afternoon to set up and apply migrations. Removes any chance of a dev laptop wiping live orders. |
| Live project, anon key only | Storefront browses against real data; `api/` routes and the admin console will not work locally. |
| Full live keys | Fastest for them. Puts the service-role key — which bypasses **all** RLS — plus live payment credentials on an employee laptop. |

Whatever is chosen, the employee should never receive:
`SUPABASE_SERVICE_ROLE_KEY`, `RAZORPAY_KEY_SECRET`(`_B`),
`RAZORPAY_WEBHOOK_SECRET`(`_B`), `RESEND_API_KEY`, the Meta/WhatsApp tokens, or
the real `VITE_ADMIN_PATH`.

---

## Stale branches to delete

These are all fully merged into `main` (0 unique commits) and only add noise:

`Ram` (dead 2026-07-20), `chore/repo-structure`, `feat/seller-landing-site`,
`fix/seller-console-audit-2026-08`, `staging`

```bash
git push origin --delete Ram chore/repo-structure feat/seller-landing-site fix/seller-console-audit-2026-08
```

Check `android-capacitor` before deleting — keep it if the Capacitor work is
still wanted.
