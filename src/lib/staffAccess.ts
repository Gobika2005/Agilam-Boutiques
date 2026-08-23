import { adminPath } from '@/lib/adminPath';
import type { Role } from '@/types/database';

/**
 * What an employee may open in the admin console.
 *
 * ⚠ This list is convenience, not security. Hiding a nav tile stops a staff
 * member wandering into the payout screen; it does not stop anyone who opens
 * devtools. The boundary that actually holds is RLS — migration 0086 gives
 * staff no policy at all on payouts, expenses, coupons, return_requests,
 * admin_activity_log, orders or profiles, so a blocked page fetches nothing
 * even if it is reached. Keep the two in step, but never rely on this file
 * alone when adding a screen that shows money or PII.
 */
/**
 * Console sub-paths, WITHOUT the base segment — the console's address is a
 * deploy-time secret (`@/lib/adminPath`), so hardcoding `/admin/...` here would
 * silently lock every staff member out the moment it changed.
 */
export const STAFF_ROUTES = [
  'staff',
  'orders',
  'deliveries',
  'products',
  'approvals',
  'catalogue',
  'boutiques',
  'reviews',
  'ads',
  // NOT users. That page is account management — create, re-role, block —
  // and its "Customer 360" tab is a buyer's full history including contact
  // details. Staff get customers instead: the same directory with no
  // account controls, fed by the masking RPC.
  'customers',
  'feedback',
  'broadcast',
  'notifications',
  'search',
  // Their OWN account page — name, password, theme, sign out. Nothing on it is
  // platform data, and the avatar that opens it lives in the shared console
  // header, so leaving it off this list would give every employee a header
  // button that bounces them out of the page they just asked for.
  'profile',
] as const;

/** Console roles. Both land in the admin console; they see different amounts. */
export const isConsoleRole = (role: Role | undefined): boolean =>
  role === 'admin' || role === 'staff';

/** True when `role` may open `path` (a full pathname). Admins may open everything. */
export function canOpen(role: Role | undefined, path: string): boolean {
  if (role === 'admin') return true;
  if (role !== 'staff') return false;
  return STAFF_ROUTES.some((r) => {
    const full = adminPath(r);
    return path === full || path.startsWith(`${full}/`);
  });
}

/**
 * Whether platform money figures — revenue, commission earned, seller payouts,
 * expenses — may be rendered. Order totals are NOT covered by this: staff can
 * see what a buyer paid, because they cannot handle an order otherwise.
 */
export const canSeePlatformMoney = (role: Role | undefined): boolean => role === 'admin';
