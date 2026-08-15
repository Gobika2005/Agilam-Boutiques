# SMS plan — phone OTP sign-in + seller operational alerts

**Date:** 2026-08-15
**Status:** plan only. Nothing built, no migration written.
**Blocked on:** TRAI DLT registration (owner's hand — see Phase 0).

---

## Decisions locked before writing this

| Question | Answer |
|---|---|
| What SMS is for | Phone-number OTP sign-in + seller operational alerts. **Not** buyer order alerts, **not** promotional SMS. |
| DLT registration | Not started. This is the critical path. |
| Provider | MSG91. |
| OTP engine | Supabase phone auth, with a **Send-SMS auth hook** handing delivery to MSG91. |
| Auth shape | Phone is a **4th option alongside** Google / email-OTP / email+password. Nothing existing is retired. |
| WhatsApp | Later. The outbox is built channel-agnostic so WhatsApp drops in without a rewrite. |

---

## What already exists (verified in the repo, 2026-08-15)

- **No SMS anywhere.** No provider SDK, no `sms` table, no send path.
- **`src/pages/auth/Otp.tsx` already exists and is dead code.** A complete six-box
  OTP artboard with correct a11y (`role="group"`, per-digit labels,
  `autocomplete="one-time-code"`), whose own header comment says: *"this screen is
  presentational: it cannot create a session… Wire it to Supabase phone auth
  before putting it in a live flow."* Its button toasts
  `'Phone verification is not wired up yet'`. **This is the single biggest saving
  in the whole plan — the UI is done, only the wiring is missing.**
- **`profiles.phone`** exists (`schema.sql:11`) as plain nullable `text`. No unique
  constraint, no `phone_verified` flag, rarely populated.
- **`boutiques.phone`** exists (0002) — the shop's public contact number,
  unverified. Shiprocket already normalises it with
  `.replace(/\D/g,'').slice(-10)`.
- **`notifications` table** (0018) already pushes "new order" to the seller's
  in-app bell, written **service-role from `api/place-order.js`** with
  deliberately **no insert policy**. Seller SMS should hang off the *same* events,
  not a parallel discovery of them.
- **`api/` is at the 12-route Vercel Hobby ceiling.** A 13th route fails the
  deploy. Everything server-side here must be a Supabase Edge Function — the same
  escape hatch as `broadcast-email`, `payout-advice` and the Shiprocket pair.
- **Vercel Hobby has no spare cron slot** (recorded during the daily-report work),
  so the outbox drain cannot be a Vercel cron.

> **Note:** `CLAUDE.md` says the next migration is `0088`, but `0088` and `0089`
> both exist on disk. **The next free number is `0090`.** Worth fixing that line in
> `CLAUDE.md` while we're here.

---

## Phase 0 — DLT registration (owner's hand, blocks everything)

In India you cannot legally send transactional SMS — including OTP — without
TRAI DLT registration. This is paperwork, not code, and **nothing in Phases 1–3
can be tested end-to-end until it clears.** Start it today; build in parallel.

**Three separate approvals, in order:**

1. **Entity registration** — register Agilam/MangaiMart as a Principal Entity on
   an operator DLT portal (Jio, Vodafone-Idea and Airtel all run one; register on
   one, it propagates). Needs PAN, GST certificate, incorporation/registration
   proof, an authorised signatory letter. Yields an **Entity ID**.
   *Approximately ₹5,900 one-time (₹5,000 + GST) — confirm current pricing on the
   portal, it varies by operator.*
2. **Header (sender ID)** — a 6-character alphanumeric sender, e.g. `AGLBTQ` or
   `MNGMRT`. Must be registered as **Transactional/Service**, not Promotional —
   OTP on a promotional header is dropped for DND numbers. 1–3 working days.
3. **Content templates** — every message body pre-approved, character for
   character, with variables as `{#var#}`. **Each is its own approval cycle
   (1–3 days), so keep the list minimal.** Yields a **DLT template ID** per
   message, which MSG91 needs at send time.

**Total realistic lead time: 5–10 working days.** Rejections are common and cost
another cycle, usually for a mismatch between the template text and the header
category.

### Templates to submit (exactly four — resist adding more)

| Key | Category | Body to submit |
|---|---|---|
| `otp_login` | Service / Transactional | `{#var#} is your MangaiMart verification code. Valid for 10 minutes. Do not share it with anyone.` |
| `seller_new_order` | Transactional | `New order {#var#} on MangaiMart. Dispatch by {#var#}. Open your seller console to accept.` |
| `seller_dispatch_due` | Transactional | `Reminder: order {#var#} is due for dispatch today. Add the courier and AWB in your seller console.` |
| `seller_payout_released` | Transactional | `Payout of Rs {#var#} for order {#var#} has been released to your registered bank account. - MangaiMart` |

Notes on drafting: no URLs unless the domain is separately whitelisted on the
DLT portal (that's an extra approval — the templates above deliberately say
"open your seller console" instead of linking). Use `Rs` not `₹` — the rupee
glyph pushes the message into Unicode encoding, which cuts the segment length
from 160 to 70 characters and multiplies the cost per send.

---

## Phase 1 — MSG91 + the Send-SMS hook

**Why a hook rather than native config:** Supabase's built-in phone auth only
ships Twilio, Twilio Verify, MessageBird, Vonage and Textlocal. MSG91 is not on
that list. The **Send SMS Hook** is the sanctioned way to plug in any provider:
Supabase still generates the code, stores its hash, enforces expiry and attempt
limits, and creates the session — it just calls our function to *deliver* the
text. We keep Supabase's security-critical OTP lifecycle and only own the pipe.

This also solves a DLT problem neatly. Supabase's built-in SMS template would
send its own wording; with the hook we build the body ourselves, so we can match
the approved DLT template byte-for-byte and pass MSG91 the template ID.

**Verify before building:** confirm Auth Hooks are enabled on your Supabase
plan/project (Dashboard → Authentication → Hooks). If they are not available,
we fall back to the "MSG91 owns the OTP" architecture, which is more code and
more of our own security surface — I'd want to know this before Phase 2 starts.

### Build

**New Edge Function: `supabase/functions/sms-hook/`**
- Verifies the hook's `Standard Webhook` signature against `SEND_SMS_HOOK_SECRET`.
  **Non-negotiable** — the endpoint must be `--no-verify-jwt` (Supabase Auth calls
  it unauthenticated, same as `unsubscribe`), so the signature is the *only* thing
  standing between this and an open SMS relay for anyone who finds the URL.
- Rejects any `user.phone` that is not `+91` followed by 10 digits starting 6–9.
  This is the **single most important line in the plan**: international OTP
  pumping (fraudsters cycling premium-rate foreign numbers to farm carrier
  revenue-share) is how projects like this get a five-figure bill overnight. We
  serve Indian buyers and sellers only; there is no reason to send anywhere else.
- Calls the **MSG91 Flow API** with `template_id` = the DLT `otp_login` ID and
  the code as the variable.
- Returns 200 on success, non-2xx on provider failure so Supabase surfaces a real
  error to the user rather than a silent "code sent" that never arrives.
- Never logs the code. Logs the masked number (`+91XXXXX43210`) and the MSG91
  message ID only.

**New shared helper: `supabase/functions/_shared/msg91.ts`**
- One `sendTemplate(phone, templateId, vars)` used by both the hook and the
  Phase-3 dispatcher, so retry/timeout/error-shape logic exists once.
- Honours a `SMS_DRY_RUN` env flag that logs instead of sending — this is how we
  test the whole path before DLT clears.

**Secrets (owner sets):**
```
supabase secrets set MSG91_AUTH_KEY=... MSG91_SENDER_ID=AGLBTQ \
  MSG91_TEMPLATE_OTP=... SEND_SMS_HOOK_SECRET=... SMS_DRY_RUN=false
```

**Also set in the Supabase dashboard:** Auth → Rate limits → cap SMS sends per
hour (default is generous). Belt and braces with the `+91` filter.

---

## Phase 2 — Phone OTP sign-in, alongside the existing three

### Migration `0090_phone_identity.sql`

- `alter table profiles add column if not exists phone_verified boolean not null default false;`
- **Partial unique index** on `profiles(phone) where phone is not null and phone_verified` — stops
  two accounts claiming the same number. Partial, because the existing unverified
  `phone` values are free text typed into a profile form and almost certainly
  contain duplicates and junk; a plain unique constraint would fail to apply.
- Normalise-on-write trigger so `phone` is always stored `+91XXXXXXXXXX`.
- Extend the `handle_new_user` trigger (0030) so a user created via phone gets a
  `profiles` row with `phone`/`phone_verified` populated and `email` null —
  today it assumes email exists.
- **Re-check 0010's role-escalation guard and 0073's contact lockdown** still hold
  for a row where `email is null`. 0010 allows "normal profile edits
  (full_name/phone/city)"; we must confirm a user cannot self-set
  `phone_verified` — that flag is only ever written by the trigger from the
  auth identity, never by a client `update`. **This is the one place in Phase 2
  where a mistake is a real vulnerability**, so it gets its own review pass.

### `src/auth/AuthContext.tsx`

Two new methods, mirroring the existing shape:

```ts
sendPhoneOtp: (phone: string) => Promise<void>;          // supabase.auth.signInWithOtp({ phone })
verifyPhoneOtp: (phone: string, code: string,
                 desiredRole?: Role) => Promise<Role>;   // verifyOtp({ type: 'sms' }) → hydrate()
```

`verifyPhoneOtp` **must** route through the existing `hydrate()`, not around it.
`hydrate()` is what enforces the blocked/soft-deleted check (`isDisabled`) and
what stops the sign-in page's `desiredRole` from rewriting an existing account's
role. A phone path that bypassed it would reopen both holes at once.

### Account-linking rules (the genuinely hard part)

Supabase treats phone and email as **separate identities**. Left alone, a buyer
who has ordered for months under `she@gmail.com` and then signs in with her
mobile gets a **brand-new empty account** — no orders, no wishlist, no addresses.
That is the failure mode to design against.

| Situation | Behaviour |
|---|---|
| Number unknown to us | Create the account. `role='buyer'`, `phone_verified=true`. Normal new-user flow. |
| Number already on a verified profile | Normal sign-in. Straightforward. |
| Number matches an *unverified* `profiles.phone` on an email account | **Do not auto-merge.** Show: *"This number is on an existing MangaiMart account. Sign in with email or Google, then confirm your number in Profile."* Auto-merging would mean possession of a SIM grants takeover of an email account — including a seller's, with its payout bank details. Not worth the convenience. |
| Signed-in user wants to add their phone | `supabase.auth.updateUser({ phone })` → Supabase sends its own OTP through the same hook → `verifyOtp({ type: 'phone_change' })`. This is the sanctioned merge path, and it proves possession of *both* factors. |

### Screens

- **`src/pages/auth/Otp.tsx`** — the artboard is already built. Replace the
  `toast('Phone verification is not wired up yet')` stub with `verifyPhoneOtp`,
  take the real number via route state instead of the hardcoded
  `+91 98765 43210` in the subtitle, seed `digits` empty instead of `['4','9',…]`,
  and make Resend call `sendPhoneOtp` behind a 30-second cooldown.
- **`src/pages/auth/SignIn.tsx`** — add "Continue with mobile" as a fourth
  option, and a number-entry step (`+91` prefix fixed, 10 digits) that routes to
  `/auth/otp/:role`.
- **Buyer + seller Profile** — a "Verify your mobile" row driving the
  `updateUser({ phone })` merge path above. This is also what makes Phase 3
  deliverable, since it's how sellers get a *verified* number on file.
- Colours via `--ag-*` tokens only. Note `Otp.tsx` currently hardcodes
  `#D6336C` / `#B02454` in three places — worth fixing in the same pass since
  we're editing the file anyway.

---

## Phase 3 — Seller operational alerts

### Migration `0091_message_outbox.sql`

One table, channel-agnostic from day one so WhatsApp is a new row value and not
a rewrite:

```
message_outbox(
  id, channel text check (channel in ('sms','whatsapp')),
  to_phone text, profile_id uuid, template_key text, vars jsonb,
  status text check (status in ('queued','sent','failed','skipped')),
  attempts int, provider_msg_id text, error text,
  order_id uuid, created_at, sent_at
)
```

RLS: **no client policies at all**, exactly like `notifications` — written
service-role, read by admin only. A seller must not be able to see, forge or
re-address a queued message.

Index on `(status, created_at) where status = 'queued'` for the drain.

### Who writes rows

The paths that *already* write the seller's in-app notification, so there is one
source of truth for "a seller needs to know about this":

- `api/place-order.js` — beside the existing `notifications` insert → `seller_new_order`.
- `api/run-payouts.js` — on transfer success → `seller_payout_released`.
- `seller_dispatch_due` — a daily sweep of orders past their `dispatch_days_max`
  (0078), run by the same cron as the drain.

**Recipient resolution:** prefer the owner's **verified** `profiles.phone`; fall
back to `boutiques.phone`; if neither is a valid `+91` number, write the row as
`status='skipped'` rather than dropping it silently — the admin needs to be able
to see which sellers are unreachable.

### The dispatcher

**New Edge Function `supabase/functions/sms-dispatch/`** — drains queued rows in
a batch, calls the shared MSG91 helper, records `provider_msg_id` or `error`,
gives up after 3 attempts.

**Scheduled with Supabase `pg_cron` + `pg_net`**, not Vercel — Hobby has no spare
cron slot. Requires both extensions enabled on the project (owner's hand).

**Quiet hours:** hold non-urgent sends between 21:00 and 09:00 IST. TRAI's
scrubbing already blocks promotional traffic in that window; transactional is
exempt, but a 3am payout SMS is still a bad experience for a small boutique
owner. `seller_new_order` is the one exception worth arguing about — flag it.

---

## Cost

Confirm current rates with MSG91; these are the working numbers:

| Item | Cost |
|---|---|
| DLT entity + header (one-time) | ~₹5,900 |
| MSG91 transactional SMS | ~₹0.16–0.25 per segment (volume-tiered) |
| MSG91 minimum top-up | typically ₹1,000–₹5,000 |
| Supabase plan | ₹0 **if** Auth Hooks are on your current plan — verify first |

At a rough 500 OTPs + 300 seller alerts a month that is **under ₹200/month** in
traffic. The economics are not the risk here; the risk is entirely (a) DLT
approval delay and (b) OTP pumping if the `+91` filter is ever removed.

---

## What needs your hand

1. **Start DLT registration now** — it is the critical path and nothing else can
   be tested without it.
2. Decide the 6-character header (`AGLBTQ`? `MNGMRT`?) — needed for step 2 of the
   registration.
3. Open the MSG91 account and top it up.
4. **Check Authentication → Hooks is available on your Supabase plan.** If it
   isn't, tell me before Phase 2 — the architecture changes.
5. Enable `pg_cron` and `pg_net` extensions (Phase 3 only).
6. Set the secrets listed in Phase 1.
7. Apply migrations `0090` and `0091` when written.

## Explicitly not in this plan

Buyer order-status SMS (you chose seller-only), promotional/marketing SMS,
WhatsApp (deferred — the outbox is shaped for it), retiring any existing login
method, and international numbers.

## Suggested sequencing

Phase 0 runs in the background from today. **Phase 1 and Phase 2's migration +
`AuthContext` work can be built and unit-tested immediately under
`SMS_DRY_RUN=true`** — the only thing that genuinely blocks on DLT is the first
real send. Phase 3 should wait until Phase 2 has put verified numbers on seller
profiles, otherwise most sends resolve to the unverified `boutiques.phone` and
skip.
