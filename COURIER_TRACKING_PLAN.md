# Courier Delivery, Tracking & Payout Validation — Complete Plan

**Date:** 2026-08-09
**Status:** **Phases 1 and 2 are built.** `npm run build` and `npm run lint` pass (0 errors).
Nothing has been run against a live database, and migration **0063 is written but NOT applied** —
until you run it, the app degrades to its old behaviour and automatic payouts hold rather than
release. Phase 3 (guest tracking) and phase 4 (aggregator) are not built. Email and WhatsApp
notifications are not built — see §8.
**Supersedes:** the first draft of this file (2026-08-09, same day).

---

## 0. The plan in one paragraph

Sellers already ship by courier; the platform just doesn't know about it. We add a `shipments`
record carrying courier + AWB + tracking link, make it **mandatory to mark an order shipped**
(enforced in the database, not the UI), surface it to the buyer, and — the part that actually
matters — use it to close the hole where a seller's unverified tap releases real money. No
aggregator, no COD removal, no new Vercel functions.

---

## 1. Decisions

### Settled

| Decision | Value |
|---|---|
| Who advances a delivery | **Seller only.** No delivery agents, no agent logins, no agent app. |
| Fulfilment method | **Courier.** Not own riders. |
| Tracking entry | Seller picks a courier from an admin-managed list and types the AWB; we build the link. Free-text "Other" for local couriers. |
| Tracking mandatory | **Yes — enforced by DB trigger**, not a form check. |
| Buyer sees | Courier name, AWB, "Track shipment" link, and real timestamps on the two timeline stages that have always been dead. |

### Changed from the questionnaire — my recommendation, and why

You initially picked *aggregator booking now* and *COD off*. This plan does **neither**, because
those two answers were coupled: COD only had to die because a **platform** Shiprocket account
would put buyers' cash in **our** wallet and make us the money handler. Drop the aggregator from
phase one and that pressure disappears entirely — the seller's own courier collects COD and
remits to the seller, the seller holds the cash and owes the 10%, which is exactly what
migration 0022 already models. Only the timing shifts.

**Consequence: `src/lib/pricing.ts` and `api/_pricing.js` are not touched by this work at all.**
The mirror that breaks live checkouts when it drifts (CLAUDE.md rule 2) stays out of the blast
radius. That is worth a great deal on its own.

> **Still yours to overrule.** If you want prepaid-only as a deliberate commercial decision,
> §11 keeps the full COD-removal checklist intact so nothing is lost. I'm recommending against
> it — COD is the trust mechanism for boutiques buyers have never heard of, and it is typically
> 50–60% of Indian ethnic-wear volume — but it is your call, not mine.

### Deferred (not abandoned)

Aggregator booking (Shiprocket/NimbusPost) — see §12. The trigger to revisit is volume, and the
real prize is **payout integrity** (§7), not label printing.

---

## 2. Where the code stands today

- Lifecycle `pending → accepted → shipped → delivered` (+ `rejected`, `cancelled`), driven from
  `src/pages/seller/OrderDetail.tsx:319-323`, stamped by the trigger in migration 0042.
- The buyer timeline (`src/pages/buyer/TrackOrder.tsx:104`) renders **six** stages from
  `TRACK_STAGES`, but `STATUS_STAGE` only maps four. **"Packed" (index 2) and "Out for Delivery"
  (index 4) have never carried a timestamp** — they are painted decoration. Courier data fills
  precisely those holes.
- **No shipment data exists anywhere.** No courier, no AWB, no tracking URL.
- Boutiques already hold a full pickup address — `address_line`, `district`, `state`, `pincode`,
  `phone` (`src/data/boutiques.ts:15-27`). Nothing new to collect from sellers.
- **Guest checkout captures name, phone, city, address, pincode — and no email**
  (`api/place-order.js:446-451`). This is load-bearing; see §6.

---

## 3. Data model — migration `0063_courier_tracking.sql`

Next number is **0063**. (0062 is the last on disk — CLAUDE.md rule 1 still says "next is 0060"
and needs correcting.) Writing this file does **not** apply it; you run it in Supabase.

### 3.1 `couriers` — admin-managed list

Same pattern as the catalogue vocabulary in migration 0024, so it will feel native.

```sql
create table if not exists couriers (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null unique,
  tracking_url_template text,          -- 'https://www.delhivery.com/track/package/{awb}'
  logo_url              text,
  active                boolean not null default true,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now()
);
```

Seed with the couriers your sellers actually use — Delhivery, DTDC, Blue Dart, XpressBees,
Ekart, India Post, Professional, ST Courier, Trackon. `{awb}` is substituted at render time.

RLS: **anyone** may read `active` rows (the buyer needs the courier name; the seller needs the
dropdown). Insert/update/delete is `is_admin()` only.

### 3.2 `shipments` — one per dispatched order

```sql
create table if not exists shipments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null unique references orders(id) on delete cascade,
  boutique_id  uuid not null references boutiques(id),
  courier_id   uuid references couriers(id),          -- null when 'Other'
  courier_name text not null,                          -- denormalised: survives courier edits,
                                                       -- and carries the free-text 'Other' name
  awb          text not null check (length(trim(awb)) > 0),
  tracking_url text,
  shipped_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_shipments_order on shipments (order_id);
create index if not exists idx_shipments_boutique on shipments (boutique_id);
```

`unique (order_id)` means **one parcel per order** in v1. Split shipments are a real thing but
rare for a single-boutique order; dropping the constraint later is additive and cheap.

`courier_name` is denormalised deliberately — an admin renaming or deactivating a courier row
must never rewrite the history of parcels already sent.

### 3.3 `orders` — timeline + dispute columns

```sql
alter table orders add column if not exists packed_at            timestamptz;
alter table orders add column if not exists out_for_delivery_at  timestamptz;

alter table orders add column if not exists delivery_disputed      boolean not null default false;
alter table orders add column if not exists delivery_disputed_at   timestamptz;
alter table orders add column if not exists delivery_dispute_note  text;
alter table orders add column if not exists delivery_resolved_at   timestamptz;
create index if not exists idx_orders_delivery_disputed
  on orders (delivery_disputed) where delivery_disputed;
```

### 3.4 Trigger — tracking is required to ship

The UI will also block this, but the UI is not the boundary (CLAUDE.md rule 7):

```sql
create or replace function orders_require_shipment_on_ship()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'shipped' and old.status is distinct from 'shipped' then
    if not exists (select 1 from shipments s where s.order_id = new.id) then
      raise exception 'Add the courier and tracking number before marking this order shipped'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_require_shipment on orders;
create trigger trg_orders_require_shipment
  before update of status on orders
  for each row execute function orders_require_shipment_on_ship();
```

Note the ordering hazard: migration 0042's `trg_stamp_order_status_timestamp` also fires
`before update of status`. Postgres runs same-timing triggers **in alphabetical order** —
`trg_orders_require_shipment` before `trg_stamp_order_status_timestamp` — so the exception
aborts the statement before any timestamp is stamped. That is the behaviour we want, but it is
alphabetical luck, so **do not rename these triggers casually**.

### 3.5 Trigger — a seller cannot clear a dispute

```sql
create or replace function orders_guard_delivery_dispute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.delivery_disputed and not new.delivery_disputed and not is_admin() then
    new.delivery_disputed    := old.delivery_disputed;
    new.delivery_disputed_at := old.delivery_disputed_at;
    new.delivery_resolved_at := old.delivery_resolved_at;
  end if;
  return new;
end $$;
```

Mirrors how 0026 already stops a seller back-dating `delivered_at`. Same idea: the seller may
report facts, never un-report an accusation against themselves.

### 3.6 RLS on `shipments`

- **Seller:** select/insert/update where the parent order's `boutique_id` is a boutique they own.
  No delete — a dispatched parcel is a fact.
- **Signed-in buyer:** select where the parent order's `buyer_id = auth.uid()`.
- **Anonymous:** no direct access. Guests go through the RPC in §6.
- **Admin:** full, via the existing `is_admin()` grant.

---

## 4. Seller flow

`src/pages/seller/OrderDetail.tsx` — "Mark shipped" stops being a one-tap action and opens a
sheet:

```
Ship this order
─────────────────────────────
Courier      [ Delhivery        ▾ ]
AWB / docket [ 1234567890123      ]
             ↳ preview: delhivery.com/track/package/1234567890123

[ Cancel ]            [ Ship order ]
```

- Picking **Other** reveals free-text courier name + a paste-the-URL field. A local ST Courier
  docket must never block a dispatch.
- Confirm writes `shipments`, then flips status → `shipped`. If the trigger rejects it, show its
  message rather than a generic failure.
- Once shipped, the order shows a shipment panel with courier, AWB, a copy button, and the link.
  Editing is allowed (typos happen) and rewrites `updated_at`; it does not re-notify.
- **Optional "Packed"**: a light "Mark packed" action stamps `packed_at` and lights timeline
  stage 2. Nice, not required — if you'd rather not add a button, `packed_at` can simply be left
  null and the stage stays dim.

Styling: inline styles, `--ag-*` variables only, no literal hex (rule 4).

---

## 5. Buyer flow

`src/pages/buyer/TrackOrder.tsx` and `MyOrders.tsx`:

- A tracking card once shipped — courier name, AWB (tap to copy), **Track shipment ↗** opening
  the courier's page in a new tab.
- `STATUS_STAGE` stays as it is; the timeline gains real times from the new columns:

| Stage | Source |
|---|---|
| 0 Order Placed | `created_at` |
| 1 Confirmed | `accepted_at` (0042) |
| 2 Packed | **`packed_at`** (new) |
| 3 Shipped | `shipped_at` (0042) |
| 4 Out for Delivery | **`out_for_delivery_at`** (new — only ever set by a courier webhook, so it stays dim until §12 lands) |
| 5 Delivered | `delivered_at` (0042/0026) |

Be honest about stage 4: without the aggregator webhook nothing can legitimately set it. Leave
it dim rather than faking it from a timer. A fabricated "Out for delivery" is worse than a blank
one.

- **Delivered orders get a dispute affordance:** *"Not received? Let us know"* → sets
  `delivery_disputed` + note. See §7.

---

## 6. The guest problem — and the RPC that solves it

Guests check out anonymously. Their orders have `buyer_id = null`, so **RLS can never show them
their own order**, and `src/lib/orderHistory.ts` mirrors it in memory for the current visit only.
A seller adds tracking hours later — by then the guest has closed the tab and **the local mirror
is never refreshed from the server.**

Email is not the escape hatch: **guest checkout does not collect one** — only a phone number.

Fix, at zero cost to the 12/12 Vercel function budget, as a Postgres RPC called through
`supabase-js`:

```sql
create or replace function track_order_public(p_order_number text, p_phone text)
returns table (...)                      -- status, milestone timestamps, courier_name, awb,
                                          -- tracking_url. NO address, NO totals, NO PII.
language sql security definer set search_path = public as $$
  select ... from orders o
  left join shipments s on s.order_id = o.id
  where o.order_number = p_order_number
    and right(regexp_replace(o.guest_phone, '\D', '', 'g'), 4) = right(regexp_replace(p_phone,'\D','','g'), 4)
$$;
```

Order number **plus** the last 4 digits of the phone. Guarded points:

- Return **only** tracking fields. A `security definer` function bypasses RLS, so anything it
  selects is effectively public — keep address, totals and contact details out of it.
- Rate-limit it. Order numbers are sequential-ish and 4 digits is 10,000 guesses; without a
  limiter this is an enumeration oracle. Upstash is already wired for the API layer, but an RPC
  doesn't pass through it — so add a simple per-IP throttle at the call site **and** treat a
  fixed short delay on failure as the minimum bar. Flagged as the one genuine security decision
  in this plan.
- Feed it from a `/track` page taking order number + phone.

**Do not skip this.** Without it, every guest — likely the majority of first-time buyers — gets
no tracking at all, which is most of the point of the feature.

---

## 7. Validation: how we know delivery happened before money moves

### 7.1 What the chain is today

1. Seller taps "Mark delivered".
2. `orders_stamp_delivered` (0026) stamps `delivered_at = now()` and **blocks non-admins from
   back-dating it** — a seller controls *whether* the clock starts, never *when*.
3. Hold window elapses: `platform_settings.payout_hold_days`, **currently 3**.
4. `api/run-payouts.js:268-278` sweeps orders with `payment_status='paid'`, `status='delivered'`,
   `delivered_at <= cutoff`, `refunded = false`.
5. RazorpayX penny-drops the bank account (or validates the UPI) before money moves.
6. COD is never auto-paid — the seller already holds that cash.

**Stated plainly: delivery is self-attested by the party who gets paid for it.** The only things
between a false "delivered" and real money leaving are a 3-day clock and an admin noticing in
time to refund.

### 7.2 The controls this plan adds

**(a) No shipment, no payout.** Add to the eligibility query in `api/run-payouts.js`:

```sql
and exists (select 1 from shipments s where s.order_id = o.id)
```

Doesn't prove delivery — proves a real parcel with a courier-issued AWB left the shop. It kills
the cheapest fraud outright (marking orders delivered that were never shipped), and every AWB is
independently checkable by an admin on the courier's own site. **This is the real argument for
making tracking mandatory; the buyer-experience argument is the weaker one.**

**(b) A dispute the buyer can actually raise.** Today a buyer has *no way to say "it never
arrived" that stops the money.* On the delivered transition, notify them (migration 0044 exists);
the notification and the order screen both offer *"Not received?"*. Setting `delivery_disputed`
excludes the order from payout exactly as `refunded` already does:

```sql
and o.delivery_disputed = false
```

An admin adjudicates with the AWB as evidence and clears it (§3.5 stops the seller doing so).
Guests raise it through the §6 tracking page or the existing chat; an admin sets the flag.

**(c) Lengthen the hold: `payout_hold_days` 3 → 5–7.** Three days is thin when nothing prompts
the buyer — a parcel arriving Friday and opened Monday is already paid for. It's an
admin-editable setting, so this is a value change, not code.

**(d) Stalled-shipment report.** The opposite failure: a seller who *never* marks delivered
strands their own money. That costs them, not us, so it isn't fraud — but it rots silently.
Admin list: shipped more than N days ago, still not delivered.

### 7.3 What we still can't do, honestly

Even with all of the above, **delivery remains the seller's assertion**, corroborated by an AWB
rather than proven. Two things would actually close it, and neither is available in phase one:

- **Courier webhook** (§12) — the scan, not the seller, moves the order to delivered. This is
  the real fix and the strongest reason to eventually do the aggregator.
- **Delivery OTP** — not ours to build. Once a courier is at the door and we are not, the OTP is
  the *courier's* service (Delhivery and others offer OTP-verified delivery). We would consume
  the flag, never generate it. Worth asking about when you open an aggregator account.

Until then (a)+(b)+(c) is the right risk posture for the volume: cheap, no false precision, and
it makes the fraud path require an actual courier docket.

### 7.4 Asymmetry worth remembering

**All of this risk is prepaid-only.** On a COD order there is nothing to send — the seller holds
the cash and owes the platform. Auto-payout fraud exists solely on the prepaid side, which is
also why removing COD would *not* have simplified this part.

---

## 8. Notifications

On the shipped transition, and again on delivered:

| Channel | Status |
|---|---|
| In-app | **Built.** 0044 already notified on `shipped`; 0063 rewrites `notify_order_status_change` so the message now carries the courier and docket, and the delivered message points at the dispute action. Signed-in buyers only — `notify` no-ops on a null `profile_id` and a guest order has none. |
| Email | **Not built.** There is no client-side mail path, and `api/` is at 12/12 — so a shipped email means either `pg_net` from the trigger or an Edge Function. Deliberately deferred rather than half-wired. |
| WhatsApp | **Not built.** It is the only channel that reaches guests (they give a phone, never an email), but it is blocked on the outbox in migration 0061, which does not exist. §6's tracking page is the guest's route until then. |

Include courier, AWB and the link in the payload. Keep the card body out of chat previews if it
ever routes through messaging — `messagePreview()` / `message_preview()`, per migration 0055.

---

## 9. Admin

- **Catalogue → Couriers**: CRUD the courier list and URL templates (mirrors `/admin/catalogue`).
- **Orders**: shipment panel — courier, AWB, link — on the admin order view.
- **Disputes queue**: delivered-but-disputed orders, with the AWB to check and a Resolve action.
- **Stalled shipments**: §7.2(d).
- **Audit**: log ship, edit-tracking, dispute-raised and dispute-resolved. The
  2026-08-04 admin audit already found the trail missing boutique/payout/coupon/ad actions —
  don't add a sixth gap.

---

## 10. Edge cases

| Case | Behaviour |
|---|---|
| Wrong AWB typed | Seller edits the shipment; no re-notify. Audit-logged. |
| Order cancelled after shipping | Shipment row is kept — the parcel exists. Payout eligibility already excludes non-delivered. |
| Courier deactivated by admin | Existing shipments keep their denormalised `courier_name`; only the dropdown changes. |
| "Other" courier with no URL | Show courier + AWB, no link. Better than a dead link. |
| Seller marks shipped, DB rejects | Surface the trigger's message verbatim in the sheet. |
| Guest loses the tab | §6 tracking page (order number + phone last 4). |
| Order with items from two boutiques | Not possible — orders carry a single `boutique_id`. |
| Dispute raised after payout already sent | Payout is gone; becomes a refund/recovery decision for the admin. **Argues for (c), the longer hold.** |

---

## 11. If you overrule me and remove COD

Kept intact so the decision stays available. All of it moves **in one commit**:

| File | Change |
|---|---|
| `src/lib/pricing.ts` | Drop the COD fee from the client derivation |
| `api/_pricing.js` | Same, server side — **must move together or checkouts fail the paise assertion** |
| `api/place-order.js` | Reject `payment_method: 'COD'` |
| `src/pages/buyer/Checkout.tsx`, `Payment.tsx` | Remove the COD option and the ₹10,000 cap notice |
| `src/data/payouts.ts`, `src/pages/admin/Payouts.tsx` | Remove the cash net-off |
| `src/pages/seller/OrderDetail.tsx` | Drop "Collect on delivery" / "Cash collected" |
| `platform_settings` | `cod_fee`, `cod_cap` go inert — leave the columns, stop reading them |

**In-flight COD orders must finish under the old rules.** New checkouts only. `boutiques.cod_enabled`
stays in the schema, ignored — it's the switch if COD ever comes back.

---

## 12. Deferred: aggregator booking

**Revisit when** manual AWB entry visibly costs sellers time, or monthly shipment volume makes
negotiated rates beat what sellers get locally.

- **Use one platform account, not per-seller.** This is Shiprocket's own documented multi-vendor
  pattern — vendors don't need their own account, they get a pickup location under ours, and
  boutique addresses already exist to backfill from. Per-seller fails on onboarding: each
  boutique would need its own KYC (2–3 business days if manual, plus GSTIN and bank details)
  before it could ship anything, bolted onto a signup that is already seven steps plus approval.
  *(An earlier draft claimed per-seller meant storing sellers' Shiprocket passwords. That was
  wrong — Shiprocket has a scoped **API User** under a separate email. The recommendation stands
  on onboarding cost, which was always the stronger ground.)*
- **Auth:** `POST /v1/external/auth/login` with API-user credentials returns a bearer token valid
  **240 hours**. Cache it in the DB and refresh on expiry; never re-auth per call.
- **Where it runs:** `api/` holds **exactly 12 routes — the Vercel Hobby ceiling.** Booking and
  webhook both go in **Supabase Edge Functions**, the same dodge planned for WhatsApp (0061).
- **Costs:** surface floor ₹20–26/500g by plan tier — *base slab only*, climbing with weight,
  zone and volumetric weight. Wallet is prepaid, min recharge ₹500 in multiples of ₹100. **RTO
  charges both legs, and who eats it is an unanswered commercial question.** Freight and RTO
  belong in the expense tracker (migration 0056).
- **The prize is §7.3** — the delivered webhook removes self-attestation from the payout trigger.

---

## 13. Phases

| Phase | Scope | Depends on |
|---|---|---|
| **1** | Migration 0063; courier list + admin CRUD; seller ship sheet; buyer tracking card; timeline stages 2–3; in-app + email notify | Nothing |
| **2** | §7.2 (a)(b)(c)(d) — payout gating, dispute flow, hold window, stalled report | Phase 1 |
| **3** | §6 guest tracking RPC + `/track` page + rate limiting | Phase 1 |
| **4** | Aggregator booking + webhook + auto-delivered + freight in payouts | An account (§12) |

Phases 1–3 are roughly a week. Phase 2 is where the money-safety actually lands, so **it is not
optional polish** — if anything slips, slip phase 3 ahead of it only because guests are currently
getting nothing at all either way.

---

## 14. Acceptance tests

Nothing here is "verified" until it's run (CLAUDE.md working style).

1. Marking shipped with no shipment row → **rejected by the database**, not just the form.
2. Seller ships with a listed courier → buyer's link resolves on the courier's own site.
3. Seller ships with "Other" + no URL → courier + AWB shown, no dead link.
4. Buyer timeline shows real times at Packed and Shipped; Out for Delivery stays dim.
5. Guest with order number + phone last 4 → tracking. Wrong phone → nothing, and repeated
   attempts are throttled.
6. Delivered order with no shipment row → **not** swept by `run-payouts`.
7. Delivered + disputed → **not** swept by `run-payouts`.
8. Seller attempts to clear `delivery_disputed` → silently reverted; admin succeeds.
9. Seller attempts to back-date `delivered_at` → reverted (0026 regression check).
10. COD order still checks out, still nets off, **pricing mirror unchanged** — the regression
    that matters most, since it's the one that breaks live payments.

---

## 15. Needs your hand

1. **Confirm §1** — keep COD, defer the aggregator. Everything below assumes yes.
2. **Apply migration 0063** when phase 1 lands. Writing it does not apply it.
3. **Seed the courier list** with the couriers your sellers actually use — you know them, I don't.
4. **Set `payout_hold_days`** to 5 or 7 (admin setting, no deploy).
5. Later, if phase 4: pick an aggregator, open the account, and decide **who eats RTO**.
6. **CLAUDE.md rule 1 is stale** — migrations are at 0062 on disk, not 0059.
