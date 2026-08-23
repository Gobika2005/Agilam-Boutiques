# Two-factor authentication

Built 2026-08-23. TOTP (authenticator app) as a second factor, enforced by
Postgres rather than by React.

**Nothing here is live until migrations 0099 and 0100 are applied and the
`mfa-recovery` Edge Function is deployed.** The order matters — see the runbook.

---

## What was decided

| Question | Answer |
|---|---|
| Who | Admin + staff (whole console), sellers (bank/payout details only) |
| Method | TOTP authenticator app — Google Authenticator, Authy, a password manager |
| Enforcement | Required. No "remember this device" — see below |
| Recovery | Ten single-use backup codes, plus an admin reset from the Users page |
| Rollout | Two migrations: enrol on 0099, enforce with 0100 |

Buyers are untouched. Ordering already requires an account (0069); it does not
require an authenticator, and forcing one on a shopping account would cost
conversion for no meaningful gain.

---

## Why TOTP and not an emailed code

This is the load-bearing decision, and it follows directly from rule 7 of
`CLAUDE.md`: **RLS is the security boundary.**

The browser holds a real Supabase JWT. Anything our React app can read, a
stolen password can read by calling PostgREST directly with that token —
without ever loading our JavaScript. So a second factor checked in React gates
the UI, not the data. It is a padlock with no wall beside it.

Supabase's own TOTP factor is different in one way that matters: on a successful
challenge GoTrue **re-mints the JWT with `aal: "aal2"`**. That claim arrives in
Postgres as part of `request.jwt.claims`, which means a *policy* can test it.
That is the whole difference between 2FA and the appearance of 2FA.

It is also free — no SMS provider — and needs no new `api/` route, which matters
because `api/` sits at the 12/12 Vercel Hobby function ceiling.

## Why there is no "remember this device"

The assurance level is a property of the JWT, not of the browser. A remembered
device is still holding an `aal1` token, so RLS would hand it an empty console.
The trust would have to be honoured in React, over data the database is
refusing — which cannot work.

It costs less than it sounds. Supabase sessions persist in `localStorage` and
keep their `aal2` claim across refreshes, tab closes and reboots. A code gets
typed on a real sign-in, not daily.

## Why backup codes clear the factor instead of logging you in

Only GoTrue can mint an `aal2` JWT, and only for a real TOTP challenge. A backup
code that "logged you in" would have to be honoured by us at aal1 — the theatre
described above.

So a backup code does the one thing it honestly can: it proves ownership well
enough to **remove** the lost factor. The user then enrols a new authenticator
and challenges normally. Same mechanism as the admin reset.

---

## How ~72 policy clauses got 2FA from a two-function change

Every console-visible table in this series is gated by a policy saying
`is_admin()` or `is_staff()` — roughly seventy clauses across thirty migrations.

0100 does not touch a single policy. It changes what those two functions
**mean**: an admin is now an admin-who-has-completed-a-challenge. Every policy
that already trusts them inherits the requirement at once, and so does every
trigger and RPC guarding on them (the role-change guard from 0010/0086, the
settlement lockdown in 0072, coupon writes, all of it).

Rewriting seventy clauses by hand would have been a large mechanical diff over
the exact surface that has already taken the site down twice (0086 blanked the
storefront, 0087 fixed it). Each edit would have been a fresh chance to repeat
it.

The assurance level is read **inline** in both functions rather than through the
`mfa_verified()` helper. That is 0087's lesson applied: Postgres checks EXECUTE
on every function a policy touches *before* testing a single row, so a helper
the caller cannot execute fails the whole read `42501` instead of returning
fewer rows. `is_admin()` is reachable from policies `anon` evaluates
(`profiles: self select` among them) and `mfa_verified()` is revoked from anon.
`current_setting` is callable by every role, so inlining removes that entire
failure class.

### The one way this silently undoes itself

`is_admin()` is originally defined in `supabase/schema.sql`. Anything replaying
that file — notably `supabase db push`, which rule 1 forbids — restores the old
body and switches enforcement off across the console **with no error message**.

Check with:

```sql
select prosrc from pg_proc where proname in ('is_admin','is_staff');
```

The fix is to re-run 0100, which is idempotent.

---

## The seller side is deliberately weaker

Sellers are asked for a code at exactly one place: the bank account MangaiMart
pays them into, and only once an account is already on file.

The fraud worth stopping is a stolen password quietly repointing an established
seller's settlements at someone else's bank — silent, and by the time it surfaces
the money has moved. A seller entering details for the first time has nothing to
redirect, so gating that would buy no security and would drop a QR code into the
middle of a seven-step registration.

**This one is enforced by the app, not the database.** A seller's boutique row is
owner-scoped by `owner_id = auth.uid()`; the policy carries no assurance level.
Someone with the password who knows how to call PostgREST directly can still
write the column. Closing that means adding `aal2` to the boutiques UPDATE
policy, which would break every seller who has not enrolled. That is a trade for
the day sellers are universally enrolled — not before.

---

## Runbook

### 1. Apply 0099

```
supabase/migrations/0099_two_factor_auth.sql
```

Safe on a live database. Adds one table and five functions; changes no existing
policy, function body or row. **Nobody's access changes when it runs.**

### 2. Deploy the Edge Function

```bash
supabase functions deploy mfa-recovery
```

With JWT verification **on** (the default) — unlike `unsubscribe`. Every caller
must already hold a session; an anonymous request has nothing to recover.

### 3. Deploy the app

The console now shows the enrolment screen to anyone at aal1. At this stage it
is a prompt, not a wall: the database is not yet enforcing anything, so an
account that dismisses it still works.

### 4. Every admin and staff member enrols

Sign in to the console → the gate appears → scan the QR → enter the six-digit
code → **save the ten backup codes**. They are shown once and stored only as
sha256 hashes; there is nowhere to read them back from.

### 5. Apply 0100

```
supabase/migrations/0100_two_factor_enforcement.sql
```

This is the one with teeth. It **refuses to apply** unless every active
admin/staff profile has a verified factor, and names whoever is missing:

```
0100 not applied: 1 console account(s) have not enrolled in 2FA yet.
  staff@example.com
Applying now would lock them out of the admin console entirely.
```

It also refuses if there is no active admin at all.

### Rollback

Two `create or replace` statements at the bottom of 0100, ready to paste into
the SQL editor. They restore pre-0100 behaviour on the next statement — no
sign-out needed. Rolling back leaves the app's 2FA screens working, so the
console keeps asking for a code; it just stops being the database that insists.

---

## Recovery paths, in the order to try them

1. **Backup code** — on the challenge screen, "Lost your phone? Use a backup
   code". Clears the authenticator; they enrol a new one immediately.
2. **Admin reset** — console → Users → the `lock_reset` action on a console
   account that has 2FA on. Clears their factor *and* their unused backup codes
   (those were tied to a factor that no longer exists). Lands in the audit trail
   as `mfa.admin_reset`; the Edge Function re-checks the caller is a live admin
   at aal2 rather than trusting the screen.
3. **Nothing left** — if the sole admin loses phone and codes with 0100 applied,
   the way back is the rollback snippet in the Supabase SQL editor. This is the
   argument for a second admin account existing.

A user who runs their backup codes down to zero is topped up with a fresh set
automatically on their next successful challenge.

---

## Files

| Path | What |
|---|---|
| `supabase/migrations/0099_two_factor_auth.sql` | Table, helpers, backup-code RPCs. Enforces nothing |
| `supabase/migrations/0100_two_factor_enforcement.sql` | Pre-flight + the `is_admin()`/`is_staff()` change |
| `supabase/functions/mfa-recovery/index.ts` | Backup-code redemption and admin reset |
| `src/lib/mfa.ts` | Client wrapper over `supabase.auth.mfa` |
| `src/components/auth/MfaGate.tsx` | Enrol / challenge / recover screen |
| `src/components/auth/MfaStepUp.tsx` | Inline gate for the seller bank block |
| `src/auth/RequireMfa.tsx` | Console gate, wired into `RequireRole` |

The gate is lazily loaded and builds to its own ~8.8 kB chunk, so none of it
lands in the storefront's entry bundle.
