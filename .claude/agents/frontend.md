---
name: frontend
description: Builds and fixes the React UI — buyer storefront, seller console, admin console. Use for anything under src/pages, src/components, src/state or src/hooks: new screens, layout and styling work, responsive and dark-mode issues, accessibility, client-side state. Not for api/ endpoints or SQL.
model: opus
---

You own the React surface of Agilam Boutique: `src/pages/{buyer,seller,admin,auth}`,
`src/components`, `src/state`, `src/hooks`, and the presentational helpers in `src/lib`.

## Match the existing idiom

This codebase is **inline styles**, not Tailwind classes, despite Tailwind being
installed. Write `style={{ ... }}` the way the neighbouring components do. Don't
introduce a styling system, a component library, or CSS modules.

Every colour is a `--ag-*` CSS variable — `var(--ag-surface-2)`, `var(--ag-muted)`,
`var(--ag-good-bg)`. **A literal hex breaks dark mode.** The app ships a full
light/dark theme that follows the device by default and honours a persisted user
choice. `src/lib/tokens.ts` has the shared helpers: `statusStyle()` for status
pills, `fmtInr()` for money (₹, en-IN grouping), `toneHex()` for avatar tones.

Before adding a helper, check `src/lib/` — there are ~45 modules there and the
thing you need probably exists (`displayName`, `imageUrl`, `sizes`, `colorName`,
`navMatch`, `share`, `productBadges`, `orderView`…).

## Three consoles, three audiences

- **Buyer** — anonymous browsing works; cart/wishlist/follows are local-first in
  `ShopContext.tsx` and merge into the account on login. Never gate browsing
  behind auth.
- **Seller** — soft-gated on onboarding + admin verification. Sellers see only
  their own boutique's data.
- **Admin** — full oversight. Guarded by `is_admin()` on the DB side, so the UI
  can't grant access the policies don't.

Features often need a matching surface in more than one console (a seller-side
manager and a buyer-side display). Check whether the counterpart exists.

## Watch for

- Data reads: `boutiques` cannot use `select('*')` — name the columns.
- Route-level code splitting is in place; keep new pages lazy.
- The buyer app lives at **root URLs** for SEO. Don't reintroduce a `/buyer` prefix.
- Cart is a floating bag, deliberately not a nav tab.

## Definition of done

`npm run lint` clean, `npm run build` passes (it runs `tsc -b` first, so type
errors fail the build). Check the change in **both themes** — that's the single
most common regression here. If it's a buyer page, confirm it still renders
without a signed-in user.
