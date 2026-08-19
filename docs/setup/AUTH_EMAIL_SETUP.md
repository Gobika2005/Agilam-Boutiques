# Auth email — Resend SMTP setup

Everything here is done in the Supabase and Resend dashboards. Nothing in this
repo can turn auth email on; the code side is already correct.

## Why this is needed

Supabase Auth sends its own mail (confirm signup, magic link, OTP, password
reset, and the six security notifications). It does **not** go through
`RESEND_API_KEY` — that key is only used by two direct HTTP calls, in
`api/admin-create-user.js` and `scripts/daily-report.mjs`.

With no custom SMTP configured, Supabase falls back to its built-in sender,
which delivers **only to members of the project's own organisation** and is
capped at roughly **2 emails/hour**. Buyers get nothing and Supabase reports no
error — which is exactly the "mail not sending" symptom.

## 1. Verify the sending domain in Resend

Resend → Domains → add `mangaimart.com`. It will generate a set of DNS records
to add at the registrar:

| Type | Purpose |
|---|---|
| MX + TXT on a sending subdomain (e.g. `send.mangaimart.com`) | return path / SPF |
| TXT at `resend._domainkey` | DKIM signature |
| TXT at `_dmarc` (recommended) | DMARC policy |

The exact hostnames and values are generated per account — copy them from the
Resend screen, don't guess. Wait for the domain to read **Verified** before
moving on.

### Where the records go — and what not to break

DNS for `mangaimart.com` is managed at **Hostinger** (hPanel → Domains →
mangaimart.com → DNS zone).

The `support@mangaimart.com` mailbox is Hostinger-hosted, so the **root domain's
MX records point at Hostinger's mail servers**. Do not touch them — they are
what makes replies to `support@` arrive. Resend deliberately asks for its MX on
a *sending subdomain* (`send.mangaimart.com`) precisely so the two coexist:
Hostinger keeps the root MX for incoming, Resend gets the subdomain for bounce
handling on outgoing.

The DKIM record (`resend._domainkey`) is a separate TXT entry and doesn't
conflict with Hostinger's own DKIM. If you later add a root-level SPF record for
Resend, **merge it into the existing Hostinger SPF** rather than adding a second
`v=spf1` TXT — two SPF records on one name is a hard failure, not a merge.

> Not verified yet: the `RESEND_API_KEY` in `.env` is a send-only restricted
> key, so the domain list can't be read through the API (`/domains` returns
> `401 restricted_api_key`). Check the status in the dashboard.

If `mangaimart.com` is not verified, SMTP will authenticate fine and then
**reject every send** — the failure looks identical to having no SMTP at all.

## 2. Point Supabase Auth at Resend SMTP

Supabase → Authentication → Emails → SMTP Settings → *Enable custom SMTP*:

| Field | Value |
|---|---|
| Sender email | `support@mangaimart.com` |
| Sender name | `MangaiMart` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` (literally the word) |
| Password | the `RESEND_API_KEY` value |

The existing send-only restricted key is the right kind — SMTP needs nothing
beyond send permission.

`support@mangaimart.com` as sender means buyer replies land in the support
inbox, which matches the "Need help?" footer in every template. Note this is
deliberately *different* from `EMAIL_FROM=noreply@mangaimart.com` in `.env`,
which stays as-is for the admin-credentials mail and the daily owner report —
those are one-way and shouldn't invite replies.

## 3. Raise the auth email rate limit

Supabase → Authentication → Rate Limits → "Rate limit for sending emails".
It defaults to **30/hour** even after custom SMTP is enabled, which a real
signup flow will hit. Set it to whatever Resend's plan allows.

## 4. Add the redirect URLs to the allow-list

The app now passes `emailRedirectTo` on signup and email-OTP
(`src/auth/AuthContext.tsx`, `src/lib/authMethods.ts`) so confirmation links
return to the host the person actually signed up on. Supabase **silently falls
back to the Site URL** for any redirect that isn't allow-listed.

Supabase → Authentication → URL Configuration → Redirect URLs must include:

```
https://mangaimart.com/auth/callback
https://mangaimart.com/auth/reset-password
https://mangaimart.com/admin/reset-password
http://localhost:5173/**
https://*-<vercel-scope>.vercel.app/**      # preview deploys, if used
```

Set **Site URL** on the same screen to `https://mangaimart.com` — that is the
fallback GoTrue uses for any redirect it won't honour, so it must be the real
domain rather than a `vercel.app` deploy URL.

If `www.mangaimart.com` is also served, add its three callback URLs too, or
redirect www → apex at the domain level (see below) so it never originates a
link.

## 5. Paste the templates

`email-templates/` holds all thirteen, each with its target dashboard slot and
variable list in a header comment. Supabase → Authentication → Emails, then
paste each into **Body (Source)**.

| File | Slot |
|---|---|
| `confirm-signup.html` | Confirm signup |
| `invite-user.html` | Invite user |
| `magic-link.html` | Magic Link |
| `otp-code.html` | Reauthentication / OTP |
| `change-email.html` | Change Email Address |
| `reset-password.html` | Reset Password |
| `password-changed.html` | Password Changed Notification |
| `email-changed.html` | Email Change Notification |
| `phone-changed.html` | Phone Change Notification |
| `identity-linked.html` | Identity Linked Notification |
| `identity-unlinked.html` | Identity Unlinked Notification |
| `mfa-factor-enrolled.html` | MFA Factor Enrolled Notification |
| `mfa-factor-unenrolled.html` | MFA Factor Unenrolled Notification |

The six notification templates only fire when their event happens — they need
no extra wiring, but they need working SMTP like everything else. The phone and
MFA ones will stay dormant: the live project has `phone: false` and
`passkeys_enabled: false`.

## 6. Confirm it works

Trigger a password reset from the app for an address you know is a registered
buyer, then check Resend → Emails for the delivery record. Resend logging the
send is the proof; a Supabase `200` is not — GoTrue returns `200` for unknown
addresses too, so a silent inbox can just mean "no such user".
