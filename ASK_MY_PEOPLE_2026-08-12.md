# "Ask my people" — shareable shortlist boards

**Built 2026-08-12.** Buyer-side engagement feature. Complete end to end.

**Migration `0077_shortlist_boards.sql` must be applied before any of this
works.** Nothing else needs your hand — no env vars, no keys, no Vercel
functions (the `api/` 12-function ceiling is untouched; every server call is a
Supabase RPC).

---

## What it does

Nobody in India buys a ₹6,000 saree alone. Today the buyer screenshots three
pieces into a family WhatsApp group and asks "which one?" — so the decision
happens outside the app, the screenshots are dead images nobody can tap, and the
four relatives who saw our catalogue never reach it.

This moves that conversation inside Agilam without asking a single relative to
sign up:

1. She taps **Ask my people** on the wishlist or a product page, picks what
   she's torn between, and gets a link.
2. It goes into WhatsApp with the first piece's photo attached and the caption
   "Help me pick 👇 — 4 options".
3. Her family opens it — **no login, no signup wall** — types a first name, taps
   ❤️ or 👎, and leaves a line ("the green one — the blouse suits you").
4. She gets one notification per person, taps it, sees the tally and the notes,
   and picks the winner.
5. Everyone who voted sees **"She went with the green Kanjivaram"** when they
   open the link again.

Every piece on the board links to its real product page, so a relative who came
to judge four sarees is a shopper standing in the shop.

## Why it earns its place

- It doesn't teach a new behaviour, it absorbs one that already happens on every
  ethnic-wear purchase.
- It removes the actual blocker on a ₹6,000 piece — not price, but *"am I
  sure?"*. Four hearts from her family is what closes the sale.
- **It's the only feature here that grows the user base by itself.** Each
  shortlist puts the storefront in front of ~4 new people, pre-warmed by someone
  they trust, at zero acquisition cost. Expect a second revenue line too: a
  relative who fell for a *different* piece and bought it.

---

## What was built

### Database — `supabase/migrations/0077_shortlist_boards.sql`

Four tables (`shortlist_boards`, `shortlist_items`, `shortlist_votes`,
`shortlist_comments`), eight functions, two notification triggers. Idempotent
and re-runnable.

**The token is the credential.** A relative is an anonymous visitor and RLS
cannot see a URL, so there is no policy that could express "readable by whoever
holds this link" — and the wrong fix, granting `anon` SELECT, would expose every
board on the platform to anyone with the anon key. Instead:

- The four tables have RLS on and **no `anon` grant of any kind**. The owner
  reads her own rows through ordinary select policies; nobody else reads them at
  all.
- Exactly three SECURITY DEFINER functions are granted to `anon` —
  `get_shared_board`, `cast_board_vote`, `post_board_comment` — each taking the
  token as its first argument and resolving the board itself.
- The token is 32 hex characters from `gen_random_uuid()` (~122 bits). Not
  enumerable, and no dependency on pgcrypto's `gen_random_bytes`, which lives in
  the `extensions` schema and would not resolve under `search_path = public`.

**No insert or update policy on any of the four tables.** 0072 is the lesson: a
column-blind UPDATE policy on a row you own lets you write columns the feature
never meant you to (there, sellers un-settling their own payouts). Here the
equivalents are `token` and `buyer_id` on a board, and `verdict` on someone
else's vote. Every write goes through a definer function that names the columns
it moves.

Other server-side rules, all enforced in the function rather than the browser:

| Rule | Why |
|---|---|
| Board expires after 60 days | A share link that lives forever leaks forever |
| Item must belong to *this* board | Otherwise one valid token would let a caller vote on any board's items |
| Caps: 30 pieces, 20 open boards, 60 voters, 300 comments | Bounds on an endpoint anonymous visitors can reach |
| Hidden/deleted products silently skipped at creation | A board must never confirm that a hidden product exists |
| `profile_id` stamped from `auth.uid()`, never from input | What earns the "you" badge on the thread |
| `get_shared_board` returns the owner's **first name only** | Never her id, email, phone or full name — the link gets forwarded |

**Notification debounce.** Four relatives across five pieces is twenty vote
rows. Twenty notifications is a reason to turn notifications off, so she is told
once per *person* — on their first vote — not once per vote.

**One shared-table change:** `notifications.link` (nullable, additive). The inbox
could only ever deep-link on `order_id`, which is why the price-drop alerts from
0044 have always been unclickable. "Amma voted on your shortlist" that goes
nowhere when tapped is worse than no notification. Existing rows are untouched
and still route through `order_id`.

### App

| File | What |
|---|---|
| `src/data/shortlists.ts` | Data layer, both sides, plus the tally and family-favourite maths |
| `src/lib/voterIdentity.ts` | The relative's localStorage name + voter key |
| `src/lib/share.ts` | `shareBoard()` — image-attached WhatsApp share |
| `src/components/buyer/AskMyPeopleSheet.tsx` | Pick → name → share, in one sheet |
| `src/pages/buyer/SharedBoard.tsx` | **The public board.** `/shortlist/:token` |
| `src/pages/buyer/Shortlists.tsx` | Her boards. `/shortlists` |
| `src/pages/buyer/ShortlistDetail.tsx` | Votes as they land. `/shortlists/:id` |

Entry points: the wishlist (once there are 2+ saved pieces), the product page
directly under the buy actions, and the profile menu.

`voter_key` is **not** authentication and the migration does not treat it as
any. It lets one person change their mind instead of voting twice, and shows
them their own choices when they return. Someone who clears it can vote again —
on a private link shared with four relatives that isn't a threat model, and the
per-board voter cap bounds it.

---

## Verified

| Check | Result |
|---|---|
| `npx tsc -b` | clean |
| `npm run lint` | 0 errors; 0 warnings in the new files |
| `npm run build` | passes; `SharedBoard` 13.5 kB and `ShortlistDetail` 12.7 kB code-split |
| SQL parsed against the real PostgreSQL grammar (`libpg-query`) | 56/56 statements OK |
| The 5 intricate statements re-parsed standalone | OK — the CTE inserts, the chained data-modifying CTE, the upsert, and the 2.4 kB JSON projection |
| `npm run verify:seo` | ALL CHECKS PASSED |

**Not verified:** nothing has been run against a live database — 0077 has not
been applied. The SQL is syntactically valid per Postgres's own parser, but
semantics (that the policies behave as described, that the triggers fire) are
unproven until it runs.

`verify-seo.mjs` now asserts both `/shortlist/:token` and `/shortlists` are
`noindex` + `x-robots-tag`. Asserted rather than trusted to the prefix list,
because the cost of someone reordering `NOINDEX_PREFIXES` later is not a ranking
wobble — it's every buyer's private family conversation in a search index.

## To do on your side

1. Run `0077_shortlist_boards.sql` in the Supabase SQL editor.
2. Smoke test: save two pieces → Wishlist → **Ask my people** → open the link in
   a private window (you'll be anonymous, as a relative would be) → vote, leave
   a note → check the notification arrives and opens the board.
3. The verify block at the bottom of the migration includes the negative tests
   worth running as `anon`: `select * from shortlist_boards` must return 0 rows,
   and `get_shared_board` on a junk token must raise.

## Deliberately not built

**Letting a relative buy it for her.** For weddings this is a genuinely large
idea — the aunt buying the gift is a real customer we currently cannot reach —
but it needs checkout to another person's address, changes what owning an order
means, and touches `place-order.js`'s paise-exact pricing assertion. That is its
own feature with its own migration, not a rider on this one.
