# Public seller site — `/sell`

Built 2026-08-14. A five-page marketing site for boutique owners, in the shape of
`supplier.meesho.com` but on MangaiMart's own terms and MangaiMart's own data.

There was no public seller-facing page before this. A boutique owner's only entry
was `/seller/register`, which drops her straight into an 8-step wizard asking for
her bank IFSC before anything has told her what the commission is, when she gets
paid, or who delivers the parcel. The footer's "Sell on MangaiMart" link pointed
at `/about`, which is the buyer-facing story of the company.

## What shipped

| URL | What it answers |
|---|---|
| `/sell` | Why sell here. Mechanics, a worked payout, real live shops, what you need to start |
| `/sell/how-it-works` | The nine real steps, split into setup and the per-order loop |
| `/sell/pricing` | Every charge, worked on three real price points, plus the live ad rate card |
| `/sell/delivery-and-payouts` | The four distance bands, dispatch, returns, and how money is released |
| `/sell/faq` | 25 questions in four groups, with `FAQPage` schema |

New files under `src/pages/sell/` — `sellContent.ts` (all copy), `useSellerTerms.ts`
(live terms), `parts.tsx` (the typographic kit), `SellShell.tsx` (its own header
and footer), and one component per page.

Touched: `src/App.tsx` (routes), `middleware.js` (meta + sitemap),
`src/index.css` (`.agx-sell-*` grids), `src/components/buyer/SiteFooter.tsx`
(the "For boutiques" column now points at `/sell` and `/sell/pricing`),
`scripts/verify-seo.mjs` (three new checks).

No migration. No new API function — `api/` is still at the 12-function cap and
this needed none of it.

## How it is worded

**"Platform fee", never "commission."** Same number, same row
(`platform_settings.commission_pct`) — but "commission" is what a middleman calls
the cut he takes, and to a boutique owner weighing this up it reads as exactly
that. The code keeps the database's word (`commissionPct` in `useSellerTerms`, so
the trail from page to row stays obvious); every line a seller can read uses hers.
That includes the `middleware.js` meta descriptions and the `/sell/pricing` title,
which is now "Free to List, Pay Only on Delivery".

**The number is explained, not softened.** A percentage looks large right up until
you know what sits behind it, and burying it would be worse than the number — a
seller who finds it later feels tricked, and rightly. So the rate stays in plain
sight in the hero, and `/sell` carries a section ("Where your X% goes") listing
what it genuinely covers: the gateway charge and the tax on it, discovery,
holding and moving the money, the 30-day buyer cover, and the console. The FAQ
asks the question in the seller's own words — *"Why X%? That sounds like a lot."*
— and answers it. Every line in that list is a real cost the platform carries;
nothing is padded to make it look longer.

The tone throughout is a person explaining something to a neighbour rather than a
company issuing terms. Warm, plain, and never at the cost of leaving a number out.

## Two rules the pages are built on

**Every number is live.** The commission, the payout hold, the payout promise and
the ad rates are read at render from `platform_settings` and `ad_placements` via
`useSellerTerms`. Nothing is typed into the copy. This is the direct lesson of the
2026-08-11 functional test, where the buyer policy pages published a ₹79 delivery
fee while checkout charged ₹89 — the same defect aimed at sellers would be worse.
The meta descriptions in `middleware.js` carry no rate for the same reason.

**Nothing is claimed that cannot be shown.** No invented seller count, no invented
GMV, no invented quotes. The hero sells on mechanics. The proof section renders
real approved boutiques out of the live catalogue, with their real logos, cities
and product counts, each linking to its real storefront — and hides itself when
the catalogue is empty.

## The hero

One contained gradient card, type only, no photographs. It borrows the shape
language of the storefront's own home hero — the same crimson gradient, the same
`clamp(26px,3.2vw,44px)` radius, the same thin gold inset ring — so a seller who
has seen the shop recognises the house.

It started as a two-column layout with a collage of three live product photos.
Removed on your call, and the page is better without it: this hero has one job,
which is to say what the offer is and put a button under it. Photographs of other
people's sarees also sell the wrong thing here — the reader is not shopping. As a
side effect the section now fetches nothing at all, so it paints on the first
frame with no layout shift and no dependency on the catalogue having loaded.
The dead `.agx-sell-hero` / `.agx-sell-collage` CSS is gone with it.

## Needs your hand

### 1. Testimonials — the section is built and empty

`SELLER_STORIES` in `src/pages/sell/sellContent.ts` is an empty array, and
`SellerVoices` on `/sell` returns `null` while it is. The page is complete without
it; the section appears the moment there is something real in it.

I did not write placeholder quotes. A fabricated testimonial on the page asking
people to trust us with their income undermines every other claim on it, including
the money. Send me three real ones — the seller's words, their name, shop and city,
with their permission — and it is a one-line change each:

```ts
{ quote: '…', name: '…', shop: '…', city: '…', boutiqueSlug: '…' }
```

`boutiqueSlug` is optional; when it matches a live boutique the quote links to that
shop's real page, which is what makes it checkable.

### 2. Who gets the delivery charge — an open decision, and it blocks one paragraph

Found while grounding the pricing copy. Migration **0076** made delivery the
seller's: the seller sets four rates by distance and arranges the courier.
`settle_boutique_payout` — still on the 0025 model, last redefined in **0078** —
does not agree:

```
v_amount := (v_prepaid_goods - v_prepaid_commission) - (v_cod_commission + v_cod_fees) + v_cod_platform_discount
```

`v_prepaid_goods` is `sum(orders.total)`, which excludes `shipping_fee`.
`shipping_fee` is summed into `v_prepaid_fees` and written to `payouts.fees` —
**recorded, but never added to the seller's payout.**

So today: the buyer pays the seller's delivery charge, MangaiMart keeps it, and
the seller pays the courier out of the goods money. That reads as 0076 having
outrun the payout function rather than a decision anyone took — before 0076 the
delivery fee genuinely was the platform's, and the sentence in 0025 that says so
was never revisited.

I have written both pages so they state only what is certainly true — commission
is charged on the goods value, and the delivery charge is billed to the buyer
separately on top of it. Neither page says who ends up with the delivery money,
because "you keep it" is false today and "we keep it" publishes what is probably
a bug. The reasoning is in a comment at the point of edit in `SellPricing.tsx`.

**Your call:**
- *Seller keeps it* (what 0076 reads like it intended) — needs a migration adding
  `v_prepaid_fees` to `v_amount`, and then both pages should say so plainly, which
  is a strong selling point.
- *Platform keeps it* — then the seller console has to say so too, because
  `Earnings.tsx` currently explains the payout as "goods − commission" and never
  mentions it.

### 3. Courier booking copy depends on the Edge Functions being live

`/sell/how-it-works` and `/sell/delivery-and-payouts` both say a seller can book a
courier and print a label from the dashboard. That is `shiprocket-book` /
`shiprocket-pickup` in `supabase/functions/`, which per the Shiprocket work still
need deploying along with migrations 0065–0067. If they are not deployed when
these pages go live, that sentence is a promise the console cannot keep — the
fallback wording is to describe self-arranged delivery only.

## Verified

- `npx tsc -b` — clean.
- `npm run lint` — 0 errors; no warnings in any new file.
- `npm run build` — clean; the seller site code-splits into its own chunks
  (`SellHome`, `SellPricing`, `sellContent`, `useSellerTerms`, …), so no buyer
  downloads any of it.
- `npm run verify:seo` — ALL CHECKS PASSED, including three new ones asserting
  `/sell`, `/sell/pricing` and `/sell/faq` return 200, are `index, follow`, carry
  their own titles and self-canonical, and appear in `sitemap-pages.xml`.

That last check exists for a specific reason: `/seller` is a noindex prefix and
`isNoIndex` matches on prefixes, so anything that widened that rule — or a rename
of these routes under `/seller` — would silently make the recruitment pages
`noindex, nofollow` while still rendering perfectly in a browser.

**Not verified:** how it looks. There is no browser automation in this repo, so
nothing here has been seen rendered. Layout, the hero collage, dark mode and the
phone breakpoints are reasoned from the code, not observed. Run `npm run dev` and
open `/sell` before this goes anywhere near production.
