# Staff role — a restricted admin login for employees

**Built 2026-08-14. Migration `0086_staff_role.sql` MUST be applied before any of
this works.**

Until now `profiles.role` had one privileged value, `admin`, and `is_admin()` was
the single gate on ~30 RLS policies plus every `api/` guard. There was no way to
let an employee work the orders queue without also handing them the payout
console, the commission settings and the customer list. This adds `staff`.

## The design decision that matters

`is_admin()` is **not** changed. It still means `role = 'admin'`, which is why
`0086` does not edit a single existing policy on `payouts`, `expenses`,
`coupons`, `platform_settings`, `return_requests` or `admin_activity_log`. Those
stay admin-only because they already say `is_admin()`, and staff is not an admin.

Staff access is granted the other way round: a new `is_staff()` (true for admin
**or** staff) plus new permissive policies naming exactly the tables staff may
touch. Postgres ORs permissive policies together, so the change is purely
additive — no existing role's access moves by a row. The consequence that makes
it safe: **anything added to the schema in future is invisible to staff until
someone deliberately grants it.** Fail closed.

## What staff can and cannot do

| | |
|---|---|
| **Opens** | My Work, Orders, Deliveries, Products, Approvals, Catalogue, Boutiques, Reviews, Ads, Customers, Feedback, Broadcast, Notifications, Search |
| **Blocked** | Overview, Reports, Payments, Refunds, Expenses, Settings, Coupons, Users, Audit |
| **Can do** | Move an order pending→shipped→delivered, approve/reject boutiques and products, manage catalogue vocabulary, hide reviews and reply publicly, approve/pause/rework ads, send broadcasts, publish buyer testimonials |
| **Cannot do** | Refund or cancel an order, release a payout, record an expense, change commission or any platform setting, create a coupon, create/re-role/block a user, publish a free house ad, reject-and-refund an ad, edit a product's price, stock or title, edit a review's text or rating, change a boutique's rating or payout-verification state |
| **Sees** | Order totals, delivery addresses, buyer names and cities |
| **Does not see** | Platform revenue, commission per order, seller payouts, expenses, ad revenue; buyer phone and email are masked (`98••••••42`, `s••••@gmail.com`) |

## How the contact masking actually works

RLS filters rows, not columns, so no policy can say "orders, but not
`guest_phone`". The obvious tool — `revoke select (guest_phone) from
authenticated` — is exactly the mistake `0058` made: every app user is
`authenticated`, so revoking a column from staff revokes it from sellers and
admins too, and the console goes 403-dead. `0059` was the cleanup.

So **staff hold no RLS policy on `orders` or `profiles` at all.** Both are read
through `SECURITY DEFINER` functions whose `WHERE` clause is the access check and
whose `SELECT` list is the masking — the pattern `0073` used to take seller
contact details back off the anon key:

- `staff_orders_feed()` — the `SELECT` shape `src/data/orders.ts` already
  consumes, with `guest_phone` and `buyer.phone` masked and no buyer email.
- `staff_customer_rows()` — the Customers aggregate, with `guest_phone` hashed so
  anonymous orders still group into one customer without the number leaving the
  database.
- `staff_set_order_status()` — acting on an order. An RPC rather than an UPDATE
  policy, because a policy is column-blind: `using (is_staff())` would also let
  an employee rewrite `total`, clear `refunded` or backdate `paid_at`.

A staff member calling PostgREST by hand gets nothing. The RPC is the only door
and it masks on the way out.

## The hole this opened, and closed

`0010` blocks a signed-in user from setting their own `role` to `'admin'`. It
names that one value. The moment `'staff'` became a legal value, any buyer could
have run

```js
supabase.from('profiles').update({ role: 'staff' }).eq('id', <self>)
```

from devtools and walked into the console. `0086` rewrites
`guard_profile_privileges()` to cover both privileged roles, and to stop a
non-admin changing a privileged account's role at all. This is in the same file
as the `CHECK` constraint deliberately — the two must land together.

## Write guards

Three `BEFORE UPDATE` triggers narrow what the column-blind UPDATE policies
allow. Each is a no-op for admins and for sellers (whose own policies apply):

- `products_guard_staff_writes` — staff may change visibility, not price, MRP,
  stock, title or `boutique_id`.
- `boutiques_guard_staff_writes` — the approval decision only; not `rating`,
  `positive_rating` (what `0072` closed for sellers) or payout verification.
- `reviews_guard_staff_writes` — hide and reply, not the buyer's rating or words.

## Functions widened to `is_staff()`

`broadcast_notification`, `taxonomy_guard_decision`,
`platform_feedback_publish_guard`, `admin_approve_ad`, `admin_pause_ad`,
`admin_request_ad_changes`. Bodies are reproduced verbatim from `0048`, `0024`,
`0084`, `0037`, `0032` and `0033` with only the gate changed.

Deliberately **not** widened: `settle_boutique_payout`, `set_report_token`,
`reconcile_ad_campaign`, `mark_ad_refunded`, `admin_create_ad_campaign` (free
house inventory), `orders_guard_delivery_dispute` (clearing a dispute releases a
frozen payout), and `guard_profile_privileges`.

## App changes

| File | What |
|---|---|
| `supabase/migrations/0086_staff_role.sql` | new |
| `src/lib/staffAccess.ts` | new — `STAFF_ROUTES`, `canOpen`, `canSeePlatformMoney` |
| `src/data/consoleRole.ts` | new — publishes the role to the data layer |
| `src/pages/admin/StaffHome.tsx` | new — the work-queue landing page |
| `src/types/database.ts` | `Role` += `'staff'`; the three RPC signatures |
| `src/auth/RequireRole.tsx` | `/admin` now means "a console role"; per-path check |
| `src/auth/AuthContext.tsx` | publishes/clears the console role |
| `src/pages/admin/AdminLogin.tsx` | accepts staff, routes by role |
| `src/components/layout/AdminLayout.tsx` | nav filtered by `canOpen` |
| `src/App.tsx` | `staff` route, `/admin` landing branch, `customers` route |
| `src/data/orders.ts` | staff read/act through the RPCs |
| `src/pages/admin/OrdersAdmin.tsx` | commission line, refund and cancel gated |
| `src/pages/admin/Ads.tsx` | ad revenue, per-ad amount, house ads, reject gated |
| `src/pages/admin/Users.tsx` | Staff in the role picker and the role filter |
| `api/_accessEmail.js`, `api/admin-create-user.js` | staff accepted, welcome mail copy |

No new Vercel function — the 12/12 Hobby ceiling is untouched.

## Two things to know

**`/admin/customers` changed meaning.** It used to redirect to `/admin/users`
(the page had no nav tile). It now renders the customer directory, which is what
staff get instead of the Users page. Admins still reach customers from Users;
only a stale bookmark on that exact URL behaves differently.

**Staff order paging is client-side.** `staff_orders_feed()` returns the feed
whole, so filtering, sorting and counting happen in the browser — it fetches
every order to show a page of twenty. Fine at current volume, and the first thing
to revisit as orders grow. The fix is to give the RPC limit/offset/search
arguments, **not** to hand staff a policy on `orders`.

## Verified

- `npx tsc -b` — clean.
- `npm run build` — passes (needs `VITE_ADMIN_PATH`, new this week).
- `npm run lint` — 0 errors, 32 warnings, all pre-existing.
- **Not** verified against a live database. The migration has not been applied,
  so no policy, trigger or RPC in `0086` has been executed. The verify block at
  the foot of the file lists what to check, and notes that running it in the
  Supabase SQL editor proves nothing — `auth.uid()` is null there, so
  `is_staff()` is false and every query returns empty regardless. Test from the
  browser while signed in as the employee account.

## Two defects found after `0086` was applied

Both were `0086`'s fault and both are repaired. Recorded because they share one
root cause worth not repeating.

**`0087` — the anonymous storefront went blank.** `0086` revoked `is_staff()`
from `anon` (correct) and then wrote its sixteen new policies with no `TO` clause
— which means `TO PUBLIC`, `anon` included. Postgres checks EXECUTE on a
function inside a policy expression when the expression is initialised, before
any row is tested, so every anonymous read failed outright with `42501:
permission denied for function is_staff`. Both consoles looked fine. Never write
a policy calling `is_staff()` without `to authenticated`.

**`0088` — the console could no longer grant any privileged role.** Changing a
user to Staff failed with *"not authorized to grant the staff role"*.

`0086` widened six functions by re-issuing them with `create or replace` — the
right technique, applied to the wrong source. It copied each body from the
migration that **introduced** the function instead of the latest one to touch it.
`create or replace` replaces the whole body, so this silently reverts every later
fix, with no error and a migration that reports success:

| Function | `0086` copied | Current was | Reverted |
|---|---|---|---|
| `guard_profile_privileges` | `0010` | **`0029`** | the `is_service_role()` short-circuit |
| `broadcast_notification` | `0048` | **`0050`** | audience allow-list; admins excluded from broadcasts |

The first is the visible failure: the console does not write profiles from the
browser, it posts to `/api/admin-create-user`, which uses the service-role key
where `auth.uid()` is NULL — so `is_admin()` is false and the guard fires against
the server. That is precisely the bug `0029` was written to fix, reintroduced.

The second was silent: "Everyone" broadcasts reached admin and staff accounts
again, and an unrecognised audience string was accepted instead of rejected.

The other four were already current (`taxonomy_guard_decision` 0024,
`platform_feedback_publish_guard` 0084, `admin_pause_ad` 0032,
`admin_request_ad_changes` 0033), and `admin_approve_ad` correctly used 0037's
body rather than 0032's.

> **Before widening a gate this way, run
> `grep -rl "function <name>" supabase/migrations/` and copy the body from the
> HIGHEST-numbered file.** Finding a function in one migration does not mean that
> migration still owns it.

`0086` has been corrected in place as well as repaired by `0088`, because `0086`
is documented as re-runnable — left alone, a re-run would silently undo `0088`.

## Your hand needed

1. Apply `0086`, then `0087`, then `0088` in the Supabase SQL editor, in order.
   (If you already ran `0086` and `0087`, just run `0088`.)
2. Admin → Users → Create user, role **Staff**. They get a temp password by
   email and sign in at the same console URL you do.
