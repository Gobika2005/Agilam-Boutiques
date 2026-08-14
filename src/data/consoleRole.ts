import type { Role } from '@/types/database';

/**
 * Which console role the current session holds, for the data layer's benefit.
 *
 * The `src/data/*` modules are deliberately role-agnostic — they build queries,
 * they don't know who is asking. Staff are the one exception: migration 0086
 * gives them no RLS policy on `orders` or `profiles`, so their reads have to go
 * through the masking RPCs instead of the table. Rather than thread a role
 * argument through every admin screen, `AuthContext` publishes it here once as
 * the profile loads.
 *
 * Safe against the obvious race: every admin route is behind `RequireRole`,
 * which does not render until `profile` is resolved, so this is always set
 * before an admin page issues its first fetch. And the failure mode if it ever
 * were not is a denied read, not a leak — the database does not consult this.
 */
let consoleRole: Role | undefined;

export function setConsoleRole(role: Role | undefined) {
  consoleRole = role;
}

/** True when reads must go through the staff RPCs rather than the tables. */
export const isStaffSession = () => consoleRole === 'staff';
