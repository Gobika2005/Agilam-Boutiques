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
| `supabase/migrations/0090_whatsapp_automation.sql` | **Written, NOT applied.** You must run it. |
| `supabase/functions/wa-webhook` | **Deployed** (`--no-verify-jwt`) and responding correctly |
| `supabase/functions/wa-drain` | **Deployed**. Inert: no credentials, and the kill switch is off |
| `WA_VERIFY_TOKEN` secret | **Set** |
| `api/place-order.js` | Queues `order_confirmed` + `seller_new_order`; now requires a mobile number |
| `src/pages/buyer/Checkout.tsx` | Consent line under the phone field |
| `src/pages/admin/Settings.tsx` | Kill switch + queue counts + last 20 failures |
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

### 1. Apply the migration

Run `supabase/migrations/0090_whatsapp_automation.sql` in the Supabase SQL editor.
It is idempotent. **Until you do, `wa-drain` fails on a missing `wa_claim_batch`
and `place-order` logs a failed queue** — neither breaks an order, but nothing
queues either.

### 2. Set the three remaining secrets

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

### 3. Enable the extensions and schedule the drain

Supabase Dashboard → Database → Extensions: enable **`pg_cron`** and **`pg_net`**.
Then once in the SQL editor:

```sql
select cron.schedule('wa-drain', '* * * * *', $$
  select net.http_post(
    url := 'https://mtxmuaskmyhnqczctwlp.supabase.co/functions/v1/wa-drain',
    headers := '{"Authorization":"Bearer <SERVICE-ROLE-KEY>"}'::jsonb
  );
$$);
```

One minute is pg_cron's floor, so worst-case latency is ~60s — well inside what a
buyer expects of a shipping notice. `wa-drain` compares that bearer against the
service-role key itself, not merely "is this a valid JWT": any signed-in buyer
holds a valid JWT, and this endpoint spends money.

### 4. Submit the nine templates

WhatsApp Manager → Message Templates. All **Utility**, language **English (`en`)**.
Approval is usually minutes; budget a day.

The variable order below is what the code sends. **If you reword a body, keep the
numbering** — Meta rejects a mismatched parameter count with error 132000, and
`wa-drain` treats that as permanent and fails the row without retrying.

#### `order_confirmed` — {{1}} name, {{2}} order no., {{3}} items, {{4}} amount, {{5}} boutique
> Hi {{1}}, your MangaiMart order {{2}} is confirmed. {{3}}, {{4}} paid. {{5}} will pack and dispatch it shortly. You can follow it in the app under My Orders. Reply STOP to opt out of order updates.

#### `order_shipped` — {{1}} name, {{2}} order no., {{3}} boutique
> Hi {{1}}, good news — your MangaiMart order {{2}} has been dispatched by {{3}}. Follow it in the app under My Orders. Reply STOP to opt out of order updates.

#### `order_delivered` — {{1}} name, {{2}} order no.
> Hi {{1}}, your MangaiMart order {{2}} has been delivered. We hope you love it — a quick rating in the app helps the boutique and other shoppers. Reply STOP to opt out of order updates.

#### `order_cancelled` — {{1}} name, {{2}} order no., {{3}} reason
> Hi {{1}}, your MangaiMart order {{2}} has been cancelled. Reason: {{3}}. Anything you paid is returned to your original payment method within 5-7 working days. Reply STOP to opt out of order updates.

#### `order_refunded` — {{1}} name, {{2}} order no., {{3}} amount
> Hi {{1}}, the refund for your MangaiMart order {{2}} has been processed — {{3}} is on its way back to your original payment method, and reaches it within 5-7 working days. Reply STOP to opt out of order updates.

#### `seller_new_order` — {{1}} boutique, {{2}} order no., {{3}} units, {{4}} amount
> New MangaiMart order for {{1}}. Order {{2}}, {{3}} item(s), {{4}} prepaid. Open your seller console to accept and dispatch it.

#### `seller_payout_paid` — {{1}} boutique, {{2}} amount, {{3}} reference
> Payout update for {{1}}: MangaiMart has transferred {{2}} to your registered bank account. Reference: {{3}}. The itemised statement is in your seller console under Payouts.

#### `seller_boutique_decision` — {{1}} boutique, {{2}} decision, {{3}} note
> Update on your MangaiMart shop {{1}} — your application has been {{2}}. {{3}} Open your seller console for the full details.

#### `seller_low_stock` — {{1}} boutique, {{2}} product, {{3}} units left
> Stock alert for {{1}}: your listing {{2}} is down to {{3}} left. Restock it in your seller console so it keeps selling.

**Two Meta rules these bodies already respect**, and that a rewrite easily breaks:
a body may not begin or end with a variable, and the variables must appear in
ascending order. That is why `seller_new_order` opens with "New MangaiMart order
for" rather than the shop name, and why `seller_payout_paid` leads with "Payout
update for {{1}}".

### 5. The irreversible step — only after the above is proven

Everything so far can be done on the **test number**, which sends to five
recipients you nominate, free, with no verification. Prove the whole pipeline on
it first.

Only then: export the chat history from +91 93442 94969 (it does **not** migrate),
tell whoever handles support that replies now arrive in Meta Business Suite, delete
the WhatsApp Business account on that number, register it in API Setup, and update
`WA_PHONE_NUMBER_ID`. Do it at a quiet hour — between deletion and successful
registration, inbound messages can be lost.

`wa.me/919344294969` links in `src/data/company.ts` keep working throughout. No
code change.

### 6. Flip the switch

Admin console → Settings → **WhatsApp order updates**. The same card shows
Waiting / Sent / Failed / Opted out / Expired and the last 20 failures with Meta's
own error text. Check it after going live: an expired access token breaks nothing
visible — orders place, statuses change, messages just stop — and a rising Failed
count with the same error on every row is the only signal you get.

---

## Going-live walkthrough

1. Apply 0090. **[you]**
2. Set the three secrets, enable pg_cron + pg_net, schedule the drain. **[you]**
3. Register the webhook + subscribe to `messages`. **[you — the screen you are on]**
4. Submit and get the nine templates approved. **[you]**
5. With the switch still **off**, place a real order and confirm `whatsapp_outbox`
   fills with `queued` rows carrying the right recipient and params. Nothing sends.
6. Add your own number as a test recipient, flip the switch on, and walk one order
   pending → shipped → delivered. All three should arrive.
7. Reply **STOP** from that number. Confirm `whatsapp_optout` gains a row and the
   next message for it lands `suppressed`, not `sent`. Reply **START** to undo.
8. Watch the Failed count for 48h before calling it done.

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
