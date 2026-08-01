import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from './AuthContext';
import type { Role } from '@/types/database';

export function homeFor(role: Role | undefined) {
  if (role === 'seller') return '/seller/dashboard';
  if (role === 'admin') return '/admin/overview';
  if (role === 'buyer') return '/';
  return '/';
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { session, profile, loading } = useAuth();

  if (loading) return <FullscreenLoader />;
  if (!session) return <Navigate to={role === 'admin' ? '/admin/login' : '/'} replace />;
  if (!profile) return <FullscreenLoader />;
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
