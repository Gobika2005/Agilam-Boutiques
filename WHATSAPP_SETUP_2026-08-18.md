# WhatsApp Automation — build log and setup sheet

**Date:** 2026-08-18
**Plan this implements:** `WHATSAPP_AUTOMATION_PLAN.md` (2026-08-09)
**Migration:** `0090_whatsapp_automation.sql` — renumbered from the plan's `0061`,
because 0061–0089 shipped in the meantime.

---

## Answer the screen you are on right now

Meta app → WhatsApp → Configuration → **Configure Webhooks**:

| Field | Value |
|---|---|
| **Callback URL** | `https://mtxmuaskmyhnqczctwlp.supabase.co/functions/v1/wa-webhook` |
| **Verify token** | `UBto1ct_7VPqvlGWfEwQMitfrtBROKUY` |

Press **Verify and save**. It will succeed — the function is deployed and the token
is already set as a Supabase secret, and all three responses were checked against
the live URL:

```
GET  ?hub.verify_token=<correct>   → 12345   (echoes the challenge)
GET  ?hub.verify_token=wrong       → forbidden
POST with no signature             → bad signature
```

Then, on the same screen, **subscribe to the `messages` field**. That single field
carries both halves of what we need: delivery receipts and the inbound STOP.

> The orange banner on your screenshot — "apps will only receive test webhooks
> while unpublished" — is expected and not a blocker now. It has to be cleared
> before real buyers get messages, but not before you finish this screen.

---

## What is built and deployed

| Piece | State |
|---|---|
| `supabase/migrations/0090_whatsapp_automation.sql` | **Applied** — confirmed live 2026-08-19 |
| `supabase/functions/wa-webhook` | **Deployed** (`--no-verify-jwt`) and responding correctly |
| `supabase/functions/wa-drain` | **Deployed**, auth gate fixed 2026-08-19, returns `{claimed:0,sent:0,failed:0}` |
| `WA_VERIFY_TOKEN` secret | **Set** |
| `WA_PHONE_NUMBER_ID` / `WA_ACCESS_TOKEN` / `WA_APP_SECRET` | **Set 2026-08-19 and verified live** — see below |
| Webhook registered in Meta | **Done** — `active: true`, subscribed to `messages` |
| `api/place-order.js` | Queues `order_confirmed` + `seller_new_order`; now requires a mobile number |
| `src/pages/buyer/Checkout.tsx` | Consent line under the phone field |
| `src/pages/admin/Settings.tsx` | Kill switch + queue counts + last 20 failures |
| Inbound auto-reply | **Live and tested 2026-08-19** — see below |
| Meta account, templates, real number | **Yours.** See "What is left" below |

`npm run build` and `npm run lint` both pass.

### The architecture, briefly

Order status is a client-side `update({ status })` in `src/data/orders.ts`, so
there is no server hop to hang a send off — and `api/` is at 12 of the 12
functions Vercel Hobby allows. So Postgres triggers queue into `whatsapp_outbox`,
and `wa-drain` empties it on a pg_cron tick. That catches a status change from
*any* source, including a manual SQL edit, and keeps the whole feature off Vercel.

Two things worth knowing:

- **It ships dormant.** `platform_settings.whatsapp_enabled` defaults false and
  `wa_claim_batch` returns nothing while it is. Applying 0090 messages nobody; it
  only starts filling the queue, which is exactly what you want to inspect first.
- **No trigger can break an order.** Every trigger body is wrapped in an
  exception handler, so a bad phone number or a missing boutique cannot abort a
  seller's "mark shipped" tap.

### One change worth flagging before you deploy the site

`api/place-order.js` now **rejects an order with no valid 10-digit mobile**. Until
COD was withdrawn this rule existed only on the cash path; it left with 0085 and
nothing replaced it, so a scripted request could place a prepaid order with no way
to reach the buyer at all. The checkout form has always enforced the same rule
client-side, so in practice only a tampered or hand-rolled request is turned away.
You approved this in the original plan (Phase 4.2) — repeating it here because it
is the one change that can reject a checkout that previously went through.

---

## What is left — all of it yours

### ~~1. Apply the migration~~ — DONE, confirmed live 2026-08-19

`whatsapp_outbox`, `whatsapp_optout`, `platform_settings.whatsapp_enabled` (false)
and `wa_claim_batch` all exist and answer. The queueing path was exercised
end-to-end against the live database and behaved as designed:

| Input | Result |
|---|---|
| `+91 98765 43210` | stored `919876543210` — normalised to Meta's bare E.164 |
| `"  Priya  "` | `"Priya"` — trimmed |
| `"Shop
Name    With   Gaps"` | `"Shop Name With Gaps"` — the newline and space-runs squeezed, which is what prevents Meta error 132012 |
| Same `dedupe_key` twice | second call returned null, nothing queued |
| Recipient `"12345"` | returned null, nothing queued — an unusable number never becomes a row that fails five times at Meta |
| Drain with a row queued, switch **off** | `claimed:0` and the row untouched — the kill switch holds |

The test row was deleted afterwards; the outbox is empty.

### 1b. The bug this actually surfaced — `wa-drain` returned 403 to its own cron

The first version of `wa-drain` authorised callers by comparing the bearer token
against `SUPABASE_SERVICE_ROLE_KEY` as a string. That broke: `SUPABASE_*` secrets
are injected and rotated by the platform, not by us, and the value the deployed
function saw had drifted from the project's service-role key (Supabase re-injected
that whole block on 2026-08-18 and the project now also carries the newer
`SUPABASE_SECRET_KEYS`). Every cron tick would have been a silent 403 — the exact
invisible failure this design exists to prevent, and it would have looked like a
bug in the drainer rather than a key rotation.

Fixed and redeployed: the function now checks the **`role` claim** on the token.
That is sound because the platform gate verifies the signature before our code
runs (`wa-drain` is deployed *with* JWT verification, unlike `wa-webhook`), so an
unsigned or self-signed token never reaches it. A buyer's token does reach it, and
is turned away for carrying `role: authenticated`. Verified after redeploy:

```
service-role bearer → {"claimed":0,"sent":0,"failed":0}
anon bearer         → {"error":"forbidden"}
```

### ~~2. Set the three remaining secrets~~ — DONE 2026-08-19

All three are set, and each was checked against the live Graph API rather than
assumed:

| Check | Result |
|---|---|
| Token type | `SYSTEM_USER`, **never expires** — the right kind, not the 24-hour one |
| Token scopes | `whatsapp_business_messaging`, `whatsapp_business_management`, `business_management` |
| App id behind it | `1078110141480805` ("MangaiMart") |
| `WA_PHONE_NUMBER_ID` resolves to | **+91 93442 94969**, verified name "MangaiMart", `code_verification_status: VERIFIED`, `platform_type: CLOUD_API` |
| App secret | Valid — an app access token built from it authenticates |
| Webhook subscription | `callback_url` = our function, `active: true`, `messages` subscribed |
| HMAC gate, end to end | Correctly-signed POST → `200 ok`; forged signature → `401`; unsigned → `401` |

> **⚠ You are on the LIVE number, not the test number.** `WA_PHONE_NUMBER_ID`
> resolves to +91 93442 94969 — the published support line — already registered
> and verified. Plan step 0.8, the irreversible one, has therefore already
> happened: that number is off the WhatsApp Business phone app, its chat history
> is gone, and inbound replies now land in Meta Business Suite. Make sure whoever
> handles support knows, and that they have Business Suite access.
>
> The practical consequence for the rest of this setup is that **there is no free
> safety net left on this number**. Every test send is a real message from the
> real support line, billed, and counting against a number whose
> `quality_rating` is still `UNKNOWN` on `STANDARD` throughput — a new number on
> the starting tier, where a burst of rejected or unanswered sends throttles you.
> Keep the first walkthrough to your own mobile.

> **⚠ Rotate the access token before real traffic.** It was pasted into a chat
> transcript on 2026-08-19. It is permanent and can send messages as your
> business at your expense, so treat it as disclosed: Business Settings → Users →
> System Users → the user → **Generate new token** (same two scopes), then
> re-run the `supabase secrets set` below with the new value. Nothing needs
> redeploying afterwards.

<details>
<summary>The original instructions, kept for when you rotate</summary>

### Setting the three secrets

Do this yourself; do not paste them into a chat. A System User token can send
messages as your business.

```bash
supabase secrets set --project-ref mtxmuaskmyhnqczctwlp \
  WA_PHONE_NUMBER_ID=... \
  WA_ACCESS_TOKEN=... \
  WA_APP_SECRET=...
```

- `WA_PHONE_NUMBER_ID` — API Setup screen. The **test** number's ID at first.
- `WA_ACCESS_TOKEN` — Business Settings → Users → **System Users** → Admin role →
  assign the app → generate with `whatsapp_business_messaging` and
  `whatsapp_business_management`. **Not** the 24-hour token from the API Setup
  screen: it expires, and the drain then fails silently. Shown once.
- `WA_APP_SECRET` — app → Settings → Basic → App Secret.

Until `WA_APP_SECRET` is set, `wa-webhook` refuses every POST with `bad signature`.
That is deliberate — it fails closed rather than trusting an unsigned body — but it
means delivery receipts and STOP replies are dropped until you set it.

</details>

### 2. Enable the extensions and schedule the drain

Supabase Dashboard → Database → Extensions: enable **`pg_cron`** and **`pg_net`**.
Then once in the SQL editor:

```sql
select cron.schedule('wa-drain', '* * * * *', $$
  select net.http_post(
    url := 'https://mtxmuaskmyhnqczctwlp.supabase.co/functions/v1/wa-drain',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <WA_DRAIN_SECRET>"}'::jsonb
  );
$$);
```

Re-running this with the same job name replaces the existing job; no unschedule
needed. One minute is pg_cron's floor, so worst-case latency is ~60s — well
inside what a buyer expects of a shipping notice.

**The bearer is `WA_DRAIN_SECRET`, not a Supabase key.** That is the third
iteration of this check, and the reason is worth recording because it cost most
of a day:

| Attempt | Why it failed |
|---|---|
| `bearer === SUPABASE_SERVICE_ROLE_KEY` | The platform injects and rotates `SUPABASE_*` itself; the value the deployed function saw had drifted from the project key. Silent 403 every minute. |
| Decode the JWT and check `role === 'service_role'` | This project is on Supabase's newer API keys, where the dashboard hands you an `sb_secret_...` string that is not a JWT. The platform gate rejected it with `UNAUTHORIZED_INVALID_JWT_FORMAT` before our code ran. Silent 401 every minute. |
| **`bearer === WA_DRAIN_SECRET`** | Ours. Changes only when we change it. Same shape as `SHIPROCKET_WEBHOOK_TOKEN` elsewhere in this project. |

Both earlier failures looked identical from outside — a cron job erroring every
minute while orders queued and nothing sent. Authorisation here must not depend
on a credential someone else owns.

Because of that, `wa-drain` is deployed **`--no-verify-jwt`** and the secret is
the ONLY gate, exactly as the HMAC is the only gate on `wa-webhook`. Verified
after deploy: drain secret → `{"claimed":0,"sent":0,"failed":0}`; no auth, wrong
secret, and the anon key → `forbidden`.

### 3. Submit the nine templates

WhatsApp Manager → Message Templates. Settings that are the same for all nine:

| Field | Value |
|---|---|
| Category | **Utility** |
| Language | **English** — that is `en`, which is what `whatsapp_outbox.lang` defaults to. NOT "English (US)" (`en_US`); a language mismatch is Meta error 132001 |
| Type of variable | **Number** (positional `{{1}}`, `{{2}}` — the code sends parameters positionally) |
| Header / Footer / Buttons | leave all empty |
| Message validity period | leave off. The default is ample: the cron drains within ~60s |

Approval is usually minutes; budget a day.

**Variable samples are mandatory** — Meta will not accept a submission without one
per variable. They are used for review only and never sent. The samples below are
deliberately hyphenated rather than em-dashed: some reviewers flag unusual
punctuation in sample text, though the bodies themselves are fine either way.

The variable order below is what the code sends. **If you reword a body, keep the
numbering** — Meta rejects a mismatched parameter count with error 132000, and
`wa-drain` treats that as permanent and fails the row without retrying.

#### `order_confirmed` — {{1}} name, {{2}} order no., {{3}} items, {{4}} amount, {{5}} boutique
> Hi {{1}}, your MangaiMart order {{2}} is confirmed. {{3}}, {{4}} paid. {{5}} will pack and dispatch it shortly. You can follow it in the app under My Orders. Reply STOP to opt out of order updates.

**Samples:** `Priya` · `AGL-M8K2P4A1B2` · `2 items - Kanchipuram silk saree +1 more` · `₹4,250` · `Meenakshi Silks`

#### `order_shipped` — {{1}} name, {{2}} order no., {{3}} boutique
> Hi {{1}}, good news — your MangaiMart order {{2}} has been dispatched by {{3}}. Follow it in the app under My Orders. Reply STOP to opt out of order updates.

**Samples:** `Priya` · `AGL-M8K2P4A1B2` · `Meenakshi Silks`

#### `order_delivered` — {{1}} name, {{2}} order no.
> Hi {{1}}, your MangaiMart order {{2}} has been delivered. We hope you love it — a quick rating in the app helps the boutique and other shoppers. Reply STOP to opt out of order updates.

**Samples:** `Priya` · `AGL-M8K2P4A1B2`

#### `order_cancelled` — {{1}} name, {{2}} order no., {{3}} reason
> Hi {{1}}, your MangaiMart order {{2}} has been cancelled. Reason: {{3}}. Anything you paid is returned to your original payment method within 5-7 working days. Reply STOP to opt out of order updates.

**Samples:** `Priya` · `AGL-M8K2P4A1B2` · `the item is out of stock`

#### `order_refunded` — {{1}} name, {{2}} order no., {{3}} amount
> Hi {{1}}, the refund for your MangaiMart order {{2}} has been processed — {{3}} is on its way back to your original payment method, and reaches it within 5-7 working days. Reply STOP to opt out of order updates.

**Samples:** `Priya` · `AGL-M8K2P4A1B2` · `₹4,250`

#### `seller_new_order` — {{1}} boutique, {{2}} order no., {{3}} units, {{4}} amount
> New MangaiMart order for {{1}}. Order {{2}}, {{3}} item(s), {{4}} prepaid. Open your seller console to accept and dispatch it.

**Samples:** `Meenakshi Silks` · `AGL-M8K2P4A1B2` · `2` · `₹4,250`

#### `seller_payout_paid` — {{1}} boutique, {{2}} amount, {{3}} reference
> Payout update for {{1}}: MangaiMart has transferred {{2}} to your registered bank account. Reference: {{3}}. The itemised statement is in your seller console under Payouts.

**Samples:** `Meenakshi Silks` · `₹3,825` · `N24081912345678`

#### `seller_boutique_decision` — {{1}} boutique, {{2}} decision, {{3}} note
> Update on your MangaiMart shop {{1}} — your application has been {{2}}. {{3}} Open your seller console for the full details.

**Samples:** `Meenakshi Silks` · `approved` · `You can start listing right away.`

#### `seller_low_stock` — {{1}} boutique, {{2}} product, {{3}} units left
> Stock alert for {{1}}: your listing {{2}} is down to {{3}} left. Restock it in your seller console so it keeps selling.

**Samples:** `Meenakshi Silks` · `Kanchipuram silk saree - maroon` · `2`

**Two Meta rules these bodies already respect**, and that a rewrite easily breaks:
a body may not begin or end with a variable, and the variables must appear in
ascending order. That is why `seller_new_order` opens with "New MangaiMart order
for" rather than the shop name, and why `seller_payout_paid` leads with "Payout
update for {{1}}".

### 4. ~~The irreversible step~~ — already done

+91 93442 94969 is already registered and verified on the Cloud API, so this step
is behind you. Two consequences to keep in mind rather than actions to take:

- Replies to that number now arrive **only** in Meta Business Suite. Whoever
  answers support needs access to it.
- `wa.me/919344294969` links in `src/data/company.ts` keep working unchanged, as
  planned. No code change was needed.

### 5. Flip the switch

Admin console → Settings → **WhatsApp order updates**. The same card shows
Waiting / Sent / Failed / Opted out / Expired and the last 20 failures with Meta's
own error text. Check it after going live: an expired access token breaks nothing
visible — orders place, statuses change, messages just stop — and a rising Failed
count with the same error on every row is the only signal you get.

---

## Going-live walkthrough

1. ~~Apply 0090~~ — done and verified 2026-08-19.
2. ~~Set the three secrets~~ — done and verified 2026-08-19.
3. ~~Register the webhook + subscribe to `messages`~~ — done, `active: true`.
4. Enable pg_cron + pg_net, schedule the drain. **[you]**
5. Submit and get the nine templates approved. **[you]**
6. With the switch still **off**, place a real order and confirm `whatsapp_outbox`
   fills with `queued` rows carrying the right recipient and params. Nothing sends.
7. Flip the switch on and walk ONE order pending → shipped → delivered, with your
   own mobile as the buyer. All three should arrive. Not a stranger's number —
   every send from here is real and billed.
8. Reply **STOP** from that number. Confirm `whatsapp_optout` gains a row and the
   next message for it lands `suppressed`, not `sent`. Reply **START** to undo.
9. Watch the Failed count for 48h before calling it done.
10. Rotate the access token (see the warning above) and re-set the secret.

## Costs and limits

- ~₹0.10–0.15 per utility message in India — under ₹1 per order across four buyer
  messages. Verify against the live rate card; Meta has re-cut it twice.
- Unverified businesses are capped near 250 business-initiated conversations per
  24h. Business verification, not money, is the real gate — start it early, it is
  the slowest step.
- Supabase free tier covers 500k Edge Function invocations/month; a per-minute
  cron uses ~43k.

## Still out of scope, as agreed

POS bill auto-send, marketing and abandoned-cart campaigns, per-seller WABA
numbers, and Tamil templates. The last is worth revisiting for a Tamil-branded
storefront — templates are per-language, so it means re-submitting the nine
bodies, not re-architecting anything.


---

## Inbound auto-reply (added 2026-08-19)

Someone who messages +91 93442 94969 now gets an immediate answer, built into
`wa-webhook` rather than a separate tool.

**Why not n8n.** It was considered. The logic is ~120 lines inside a function that
already receives every inbound message, so n8n would have meant a VPS to run and
patch (~₹400-800/mo, against ~₹20/mo of actual message cost), a second copy of the
permanent Meta token, and — because **Meta allows exactly one callback URL per
WABA** — either n8n in front of our webhook or vice versa. Putting n8n in front
would make opt-out recording depend on it being up, and a silently-lost STOP is
the one failure here with a compliance consequence.

**What it answers.** It looks up the sender's most recent order by the last ten
digits of their number (`orders.guest_phone` predates 0090's normalisation, so
trailing-digit matching is what reconciles old rows with Meta's `91XXXXXXXXXX`)
and states its status. Then it says a person will follow up.

**Status only — no amount, no address.** Possession of a handset is weak proof of
identity; a borrowed phone should not reveal what was bought or where it ships.

**What it deliberately will not do:** interpret the question, quote a policy,
promise a date, or discuss money. Each of those is a statement the business would
be making on WhatsApp, and a wrong one about a refund is worse than no answer.

**It is free.** Replies only ever follow an inbound message, which opens a 24-hour
customer service window where plain text is allowed and not billed. That is also
why it shipped before the nine templates were approved.

### Guards, all verified live

| Guard | Behaviour |
|---|---|
| Burst cooldown | One reply per sender per 5 minutes. Three further messages produced no second reply |
| Reactions / system messages | Ignored — a 👍 is not a question |
| STOP | Still silent, and still recorded. Auto-replying to an opt-out is rude and pointless |
| Opt-out list | **Not** consulted. It suppresses business-INITIATED notifications, which is what checkout promises; someone who writes in is asking us something |
| Failures | Logged to `whatsapp_outbox` as `failed`, so a broken auto-reply shows in the admin Failed count instead of vanishing |

Every auto-reply is logged in `whatsapp_outbox` with `template: 'auto_reply'` and
`category: 'service'` — the audit trail is the same one the order messages use,
which is also what the cooldown reads, so no extra table and no migration.

### Behaviour change: `cancel` no longer opts anyone out

`cancel` used to sit in the STOP word list. A buyer typing "cancel" on WhatsApp
almost always means cancel my ORDER — treating it as an opt-out silently cut them
off from updates about the very order they were asking about, with no way for
them to know why the messages stopped. It now falls through to the auto-reply and
to a human. `optout` was added in its place.

### The one promise you have to keep

The reply ends "someone from our team will reply here shortly". That is only true
if a person is watching **Meta Business Suite** — messages no longer reach the
WhatsApp phone app. If nobody is monitoring it, the auto-reply is making a
commitment the business does not keep, which is worse than saying nothing.


---

## Admin message log (added 2026-08-19) — needs migration 0091

A read-only, threaded view of every WhatsApp message sent and received, at
**console → WhatsApp**. Admin only; it is deliberately NOT in `STAFF_ROUTES`, and
the RPCs are `is_admin()`-gated so the two layers agree.

**Migration `0091_whatsapp_inbound_log.sql` must be applied.** Until it is, the
page shows an explanatory card instead of crashing, and `wa-webhook` logs a
failed insert while still handling STOP and auto-replies normally — inbound
messages simply are not recorded yet.

**Read-only on purpose.** Replies stay in Meta Business Suite, so a customer is
never answered from two places. What Business Suite cannot do — and the whole
reason this screen exists — is show the conversation next to the order it is
about, and let someone look a thread up without a Meta account of their own.

**The masking is real, not cosmetic.** `wa_threads` returns numbers already
masked, keyed by an md5 hash, so the full number is not in the payload behind the
list — an open DevTools panel shows nothing. `wa_reveal_msisdn` returns one
number at a time and the console writes an `admin_activity_log` entry for each
reveal, so "who looked up this customer" stays answerable.

**What an outbound row can show.** An auto-reply stores its finished text and
renders verbatim. A template send stores only the parameters — the wording lives
at Meta and we never held it — so those render as the template name plus the
values passed. That is honest about what we have rather than reconstructing a
body we do not.
