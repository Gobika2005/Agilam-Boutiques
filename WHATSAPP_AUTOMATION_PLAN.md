# WhatsApp Automation — Step-by-Step Plan

**Date:** 2026-08-09
**Scope agreed:** buyer order-lifecycle messages + seller alerts. No marketing, no POS
auto-send. One platform number, Meta Cloud API called directly.
**Migration number:** `0061` (0060 from the daily-report work must be applied first).

---

## Architecture in one paragraph

Order status is changed by a **client-side** `update({ status })` in
`src/data/orders.ts:53`, so there is no server hop to hang a send off. Instead, Postgres
triggers queue a row in a new `whatsapp_outbox` table whenever something message-worthy
happens, and a **Supabase Edge Function** drains that queue on a `pg_cron` tick and calls
Meta's Graph API. This catches status changes from *any* source — seller console, admin
console, webhook, or a manual SQL edit — and it keeps the whole feature off Vercel, which
matters because `api/` is at exactly 12 of 12 functions allowed on Hobby.

```
seller/admin console ─┐
place-order.js ───────┼──▶ orders / payouts / boutiques / products
razorpayx-webhook ────┘              │ (AFTER UPDATE triggers)
                                     ▼
                            whatsapp_outbox (queued)
                                     │  pg_cron every minute
                                     ▼
                    Edge Function: wa-drain ──▶ Meta Graph API ──▶ buyer / seller
                                     ▲
                    Edge Function: wa-webhook ◀── Meta (delivery status + STOP replies)
```

Legend below: **[you]** = needs your hands or your credentials. **[me]** = I write it.

---

## Phase 0 — Meta setup  **[you]**

This phase blocks everything that actually sends. Nothing else depends on it, so I can
build Phases 1–4 in parallel.

**0.1 Free up +91 93442 94969.** You chose to migrate the live support number. Before it
can be registered on the API it must be **deleted from the WhatsApp Business app** on the
phone (Settings → Account → Delete account). Export chat history first if you want to keep
it — it does not come across. The number must be able to receive an SMS or voice OTP
during registration.

> Your existing `wa.me/919344294969` links in `src/data/company.ts:82` keep working after
> migration. Incoming messages just land in Meta Business Suite's inbox instead of on the
> phone. No code change needed for that.

**0.2** Create a Meta Business account at `business.facebook.com` (skip if you have one).

**0.3** At `developers.facebook.com` create an app of type **Business**, then add the
**WhatsApp** product to it. This auto-creates a WhatsApp Business Account (WABA) and a
test number — ignore the test number.

**0.4** In the app's WhatsApp → API Setup, add +91 93442 94969 as a real phone number and
complete the OTP verification. Note the **Phone Number ID** and **WABA ID** shown there.

**0.5 Business verification.** Business Settings → Security Centre → Start Verification.
Needs your registered business documents (GST certificate / incorporation proof matching
the name). Until this clears you are capped at roughly 250 business-initiated
conversations per 24h — fine for testing, not for production.

**0.6 Payment method** on the WABA (Business Settings → WhatsApp Accounts → Payment
Settings). India utility messages are in the ballpark of ₹0.10–0.15 each — verify the
current rate card, Meta has re-cut it twice. Utility templates sent inside an open 24-hour
service window are currently free.

**0.7 Permanent access token.** Business Settings → Users → **System Users** → add a
system user with Admin role → Generate token, scoped to your app, with
`whatsapp_business_messaging` and `whatsapp_business_management`. **Do not use the
temporary 24-hour token** from the API Setup screen — it expires and the drain silently
starts failing.

**0.8** Give me these four values, or set them as Supabase secrets yourself in 2.3:

| Secret | Where it comes from |
|---|---|
| `WA_PHONE_NUMBER_ID` | step 0.4 |
| `WA_ACCESS_TOKEN` | step 0.7 (system user, permanent) |
| `WA_VERIFY_TOKEN` | you invent it — any random string, used in 2.5 |
| `WA_APP_SECRET` | app → Settings → Basic (to verify webhook signatures) |

Meta's UI labels shift; if a screen name doesn't match, the nouns above (System User,
Phone Number ID, WABA) are stable.

---

## Phase 1 — Migration `0061`  **[me to write, you to apply]**

One migration file, five parts.

**1.1 `whatsapp_outbox`** — the queue.

```
id, recipient (E.164 no '+'), template, params jsonb, category,
dedupe_key text unique,      -- idempotency, see below
order_id, profile_id,        -- nullable back-references
status  queued|sent|failed|suppressed,
attempts, next_attempt_at, last_error, wa_message_id, sent_at, created_at
```

RLS **on with no policies** — service role only. Buyers and sellers have no business
reading a queue of everyone's phone numbers.

**1.2 `whatsapp_optout`** — phone-keyed (not profile-keyed), because guests order without
an account and `orders.guest_phone` is the only handle we have on them. The drainer checks
this table before every send.

**1.3 The triggers.** Each mirrors the house style of `cascade_boutique_status_to_products()`
in `0038` — `after update of <col> ... when (old is distinct from new)`.

| Event | Table / condition | Template |
|---|---|---|
| Order shipped | `orders`, status → `shipped` | `order_shipped` |
| Order delivered | `orders`, status → `delivered` | `order_delivered` |
| Order cancelled | `orders`, status → `cancelled` or `rejected` | `order_cancelled` |
| Refund flagged | `orders`, `refunded` → true | `order_refunded` |
| Payout paid | `payouts`, status → `paid` | `seller_payout_paid` |
| Boutique decision | `boutiques`, status → `approved`/`rejected` | `seller_boutique_decision` |
| Low stock | `products`, `stock` crosses ≤ 3 | `seller_low_stock` |

Order confirmation is *not* a trigger — it is queued directly in `place-order.js` (4.1),
where the full basket and the guest fields are already in hand.

Buyer recipient comes from `orders.guest_phone`, normalised to `91XXXXXXXXXX` in SQL.
Seller recipient comes from `boutiques.whatsapp`, falling back to `boutiques.phone`.

**1.4 `dedupe_key` is the safety net.** `'order:'||id||':'||status`, `'payout:'||id`,
`'lowstock:'||product_id||':'||to_char(now(),'IYYY-IW')`. The unique index makes a double
send physically impossible, and the weekly key on low stock is what stops a
sell-out-and-restock cycle turning into spam. Threshold 3 units, at most one message per
product per ISO week — say if you want it tighter.

**1.5 Kill switch** — `whatsapp_enabled boolean default false` on `platform_settings`, per
the house rule that commercial toggles are admin-editable, not constants. The drainer
no-ops while it is false, so I can ship all of this dormant and you flip it when Phase 0
clears.

> Writing this file does not put it in the database. You run it in Supabase, and I'll say
> "migration 0061 must be applied" until you tell me it's done.

---

## Phase 2 — Edge Functions  **[me to write, you to deploy]**

**2.1 Enable the extensions** (Supabase Dashboard → Database → Extensions):
`pg_cron` and `pg_net`.

**2.2** Two functions, `supabase/functions/wa-drain/` and `supabase/functions/wa-webhook/`.
Supabase Edge Functions are not capped in count and the free tier covers 500k invocations
a month, so a per-minute cron (~43k/month) fits comfortably.

**2.3 Set the secrets** (yours, never in git):

```
supabase secrets set WA_PHONE_NUMBER_ID=... WA_ACCESS_TOKEN=... \
                     WA_VERIFY_TOKEN=... WA_APP_SECRET=...
```

**2.4 `wa-drain`** — claims a batch of `queued` rows whose `next_attempt_at` has passed
(`for update skip locked`, so overlapping ticks can't double-send), drops any whose
recipient is in `whatsapp_optout` to `suppressed`, POSTs each to
`graph.facebook.com/v21.0/<phone_number_id>/messages`, and records `wa_message_id` on
success. On failure it increments `attempts` and backs off exponentially, giving up at 5
tries. Meta error 131047 (outside the service window) and 470 are permanent for that row —
fail immediately rather than retrying pointlessly.

**2.5 `wa-webhook`** — deployed with `--no-verify-jwt`, because Meta calls it unauthenticated.
Two jobs: answer Meta's `GET` verification challenge by echoing `hub.challenge` when
`hub.verify_token` matches `WA_VERIFY_TOKEN`, and on `POST` verify the
`X-Hub-Signature-256` HMAC against `WA_APP_SECRET` before trusting a single byte. Then
record delivery/read statuses, and treat an inbound `STOP` / `UNSUBSCRIBE` as an insert
into `whatsapp_optout`.

**2.6** Deploy: `supabase functions deploy wa-drain` and
`supabase functions deploy wa-webhook --no-verify-jwt`. Needs your CLI login.

**2.7** Register the webhook URL in the Meta app (WhatsApp → Configuration → Webhooks):
`https://<project-ref>.supabase.co/functions/v1/wa-webhook`, with your `WA_VERIFY_TOKEN`,
subscribed to the **messages** field.

**2.8 Schedule the drain** — run once in the SQL editor:

```sql
select cron.schedule('wa-drain', '* * * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/wa-drain',
    headers := '{"Authorization":"Bearer <service-role-key>"}'::jsonb
  );
$$);
```

One minute is `pg_cron`'s floor, so worst-case latency is ~60s. That is well inside what a
buyer expects from a shipping notification.

---

## Phase 3 — Message templates  **[me to draft, you to submit]**

Templates must be approved *before* they can be sent. I'll write the exact bodies with
numbered variables; you paste them into Meta Business Suite → WhatsApp Manager → Message
Templates. All in the **Utility** category (cheap, near-automatic approval) — none of these
are marketing, which is what keeps this out of rejection territory.

| Template | Category | Variables |
|---|---|---|
| `order_confirmed` | Utility | name, order number, item summary, total, boutique |
| `order_shipped` | Utility | name, order number, boutique |
| `order_delivered` | Utility | name, order number, review link |
| `order_cancelled` | Utility | name, order number, reason |
| `order_refunded` | Utility | name, order number, amount |
| `seller_new_order` | Utility | boutique, order number, units, amount-or-cash-to-collect |
| `seller_payout_paid` | Utility | boutique, amount, UTR |
| `seller_boutique_decision` | Utility | boutique, decision, note |
| `seller_low_stock` | Utility | boutique, product title, units left |
| `order_accepted` *(optional)* | Utility | name, order number — say if you want it |

Nine, plus one optional. Approval is usually minutes; budget a day.

---

## Phase 4 — App changes  **[me]**

**4.1 Queue the confirmation at placement** — extend `notifySellers()` in
`api/place-order.js:86` into a shared fan-out that writes the existing in-app notification
*and* a `whatsapp_outbox` row, for both the buyer confirmation and `seller_new_order`.
Stays strictly best-effort: the order is already paid for by the time this runs, so a
WhatsApp failure must never surface to the buyer. That is already how `notifySellers`
behaves — I keep the same contract.

**4.2 Require the prepaid phone.** `api/place-order.js:448` currently accepts
`guest?.phone ?? null` on the prepaid path; only COD enforces `/^[6-9]\d{9}$/`. I extend
the strict check to every order. You approved this knowing it rejects prepaid orders that
previously went through — the checkout form already validates the same rule client-side, so
in practice only a scripted or tampered request is affected.

**4.3 Consent notice at checkout** — one line under the phone field in
`src/pages/buyer/Checkout.tsx`: order updates go to this number on WhatsApp, reply STOP to
opt out. This is what makes order-implied consent defensible. `--ag-*` tokens only, no
literal hex.

**4.4 Admin visibility** — a small panel on the existing admin Settings page: the
`whatsapp_enabled` toggle, queued/sent/failed counts, and the last 20 failures with their
Meta error. Without this a broken token is invisible until someone notices nobody got
messaged.

---

## Phase 5 — Go live

1. Apply `0061`. **[you]**
2. Deploy the functions, set secrets, register the webhook, schedule the cron. **[you]**
3. With `whatsapp_enabled` still **false**, place a real order on the live site and confirm
   `whatsapp_outbox` fills with `queued` rows carrying the right recipient and params — no
   messages go out yet. **[me, from the DB]**
4. Add your own number as a template test recipient and flip `whatsapp_enabled` true. Walk
   one order pending → shipped → delivered and check all three arrive. **[both]**
5. Reply STOP from that number, confirm `whatsapp_optout` gains a row and the next message
   for it lands as `suppressed`, not `sent`. **[me]**
6. Watch failed counts for 48h before considering it done. **[me]**

---

## Costs and limits, honestly

- Roughly ₹0.10–0.15 per utility message in India — under ₹1 per order across four buyer
  messages. Verify against the live rate card; Meta re-prices this.
- Unverified businesses are capped near 250 business-initiated conversations/24h. Phase 0.5
  is the real gate, not money.
- New numbers start on a low messaging tier and scale up automatically with quality
  ratings. Keeping strictly to utility templates protects that rating; a low rating throttles
  the number.
- Supabase free tier: 500k Edge Function invocations/month vs ~43k used by the cron.

## What I am not doing (agreed out of scope)

POS bill auto-send, marketing and abandoned-cart campaigns, per-seller WABA numbers, and
Tamil-language templates. The last one is worth revisiting for a Tamil-branded storefront —
templates are per-language, so it means re-submitting the nine bodies, not re-architecting.
