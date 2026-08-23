import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { canOpen, isConsoleRole } from '@/lib/staffAccess';
import { adminPath } from '@/lib/adminPath';
import { RequireMfa } from './RequireMfa';
import type { Role } from '@/types/database';

export function homeFor(role: Role | undefined) {
  if (role === 'seller') return '/seller/dashboard';
  if (role === 'admin') return adminPath('overview');
  // Staff cannot open Overview — it is the revenue screen. Their landing page
  // is the work queue instead (migration 0086).
  if (role === 'staff') return adminPath('staff');
  if (role === 'buyer') return '/';
  return '/';
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullscreenLoader />;
  if (!session) return <Navigate to={isConsoleRole(role) ? adminPath('login') : '/'} replace />;
  if (!profile) return <FullscreenLoader />;

  // The console is shared by two roles. `role="admin"` on the /admin route
  // therefore means "a console role", and which pages within it are reachable
  // is decided per-path below rather than by an equality check.
  if (isConsoleRole(role)) {
    if (!isConsoleRole(profile.role)) return <Navigate to={homeFor(profile.role)} replace />;
    // Defence in depth only — RLS is what actually withholds the data. This
    // just stops an employee landing on a screen that would render empty.
    if (!canOpen(profile.role, location.pathname)) {
      return <Navigate to={homeFor(profile.role)} replace />;
    }
    // Two-factor is required for the whole console. Like the check above this is
    // presentation, not protection — after migration 0100 `is_admin()` and
    // `is_staff()` both require aal2, so an unverified session gets an empty
    // console from the database whether or not it reaches this line. Rendering
    // the gate is what turns that into a QR code instead of a mystery.
    return <RequireMfa>{children}</RequireMfa>;
  }

  if (profile.role !== role) return <Navigate to={homeFor(profile.role)} replace />;

  return <>{children}</>;
}

export function FullscreenLoader() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-rose-bg">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-rose-border border-t-rose-primary" />
    </div>
  );
}
