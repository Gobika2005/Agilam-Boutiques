import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { FullscreenLoader } from '@/auth/RequireRole';
import { fetchMyBoutique } from '@/data/boutiques';
import { readPendingOAuthRole, readPendingOAuthNext, clearPendingOAuthRole } from '@/lib/authMethods';
import { safeNext } from '@/auth/SignInGate';
import { useToast } from '@/components/ui/Toast';

/**
 * Landing route for Google OAuth. Supabase exchanges the code for a session on
 * load; once the auth context has it we route by the role the sign-in was
 * started for: buyers to their profile, sellers to their console — or to
 * boutique onboarding if they signed up as a seller but have no boutique yet.
 */
export function AuthCallback() {
  const navigate = useNavigate();
  const { session, loading, claimRole } = useAuth();
  const toast = useToast();
  const ran = useRef(false);

  useEffect(() => {
    if (loading || ran.current) return;
    // Session should be set by now; if there is none, the exchange either failed
    // or the account was blocked/deleted (signed out by AuthContext) — surface
    // that reason if one was left.
    if (!session) {
      let notice = '';
      try {
        notice = sessionStorage.getItem('agx-auth-notice') || '';
        sessionStorage.removeItem('agx-auth-notice');
      } catch { /* storage unavailable */ }
      if (notice) toast(notice);
      navigate('/', { replace: true });
      return;
    }
    ran.current = true;

    (async () => {
      const role = readPendingOAuthRole();
      // Set when Google was reached through a gate (the checkout sign-in
      // requirement), and validated the same way as the ?next= query param so a
      // poisoned localStorage value can't redirect off-site.
      const next = safeNext(readPendingOAuthNext());
      clearPendingOAuthRole();
      if (role === 'seller') {
        await claimRole('seller');
        // A boutique row can exist while the 7-step setup is still unfinished,
        // so completion — not mere existence — decides where they land.
        const boutique = await fetchMyBoutique(session.user.id).catch(() => null);
        const home = boutique?.onboarding_complete ? '/seller/dashboard' : '/seller/onboarding';
        navigate(next ?? home, { replace: true });
      } else {
        navigate(next ?? '/profile', { replace: true });
      }
    })();
  }, [session, loading, claimRole, navigate, toast]);

  return <FullscreenLoader />;
}
