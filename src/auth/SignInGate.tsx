import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useAuth } from './AuthContext';
import { FullscreenLoader } from './RequireRole';

/**
 * The buy-side sign-in gate.
 *
 * Browsing stays anonymous — the catalogue, search, PDPs and the bag all work
 * without an account. Placing an order does not: an order needs a real buyer
 * behind it so it can be read back, tracked, disputed and refunded, and so a
 * throwaway browser session can't file COD orders nobody can be held to. The
 * server enforces the same rule (api/create-order.js and api/place-order.js
 * both refuse an unauthenticated request); this module is the UI half, which
 * exists so the buyer is told before they pay rather than after.
 */

/**
 * Is this a real, signed-in account?
 *
 * A Supabase *anonymous* session is not one. Opening a chat calls
 * `ensureBuyerIdentity()`, which signs the browser in anonymously — so a plain
 * `!!session` is true for a buyer who has never entered a credential. Every
 * gate therefore asks this instead of testing the session for existence.
 */
export function isSignedIn(session: Session | null): boolean {
  return !!session && !session.user.is_anonymous;
}

/** True once the auth context has settled and a real account is present. */
export function useSignedIn(): { signedIn: boolean; loading: boolean } {
  const { session, loading } = useAuth();
  return { signedIn: isSignedIn(session), loading };
}

/** Buyer sign-in URL that returns them to `next` once they're in. */
export function signInPath(next: string): string {
  return `/auth/signin/buyer?next=${encodeURIComponent(next)}`;
}

/**
 * Only in-app absolute paths may be followed after sign-in. A `next` of
 * `//evil.example` or `https://…` would otherwise turn our login into an open
 * redirect that lands the buyer on someone else's page mid-checkout.
 */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}

/** Gate a route on a real account, remembering where the buyer was headed. */
export function RequireSignIn({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  // Wait for the session to load before deciding — bouncing a signed-in buyer
  // to the login screen on a refresh of /checkout would be worse than a flash
  // of the loader.
  if (loading) return <FullscreenLoader />;
  if (!isSignedIn(session)) {
    return <Navigate to={signInPath(location.pathname + location.search)} replace />;
  }
  return <>{children}</>;
}
