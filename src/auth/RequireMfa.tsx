import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import { supabase } from '@/lib/supabase';
import { readMfaState } from '@/lib/mfa';
import { FullscreenLoader } from './RequireRole';

// Lazy, because `RequireRole` is a static import from App.tsx and therefore in
// the entry chunk. The gate is a QR code, a keypad and a backup-code form that
// a buyer will never see; pulling it into the bundle that has to paint the
// storefront would undo the code-splitting work this app has already paid for.
const MfaGate = lazy(() => import('@/components/auth/MfaGate').then((m) => ({ default: m.MfaGate })));

/**
 * Blocks the console until the session carries `aal2`.
 *
 * WHAT THIS IS AND IS NOT
 * It is not the lock. Migration 0100 redefines `is_admin()` and `is_staff()` to
 * require aal2, so every console policy already refuses an aal1 session at the
 * database — with or without this component, and with or without our JavaScript
 * being loaded at all. What this does is make that refusal legible: without it,
 * an admin who has not entered a code sees a console where every screen loads
 * and every screen is empty, which is indistinguishable from an outage.
 *
 * WHY THERE IS NO "REMEMBER THIS DEVICE"
 * The assurance level is a property of the JWT, not of the browser. A trusted
 * device would still be holding an aal1 token, so RLS would hand it the same
 * empty console — the trust would have to be honoured in React, over data the
 * database is refusing, which cannot work and should not.
 *
 * It costs less than it sounds. Supabase sessions persist in localStorage and
 * keep their aal2 claim across refreshes, tab closes and reboots, so a code is
 * typed on a real sign-in — not daily.
 */
export function RequireMfa({ children }: { children: ReactNode }) {
  const [verified, setVerified] = useState<boolean | null>(null);

  const check = useCallback(async () => {
    setVerified((await readMfaState()) === 'verified');
  }, []);

  useEffect(() => {
    void check();

    // MFA_CHALLENGE_VERIFIED fires when GoTrue swaps in the aal2 token, and
    // TOKEN_REFRESHED when it renews one. Both change the answer, and neither
    // re-renders this component on its own.
    const { data: sub } = supabase.auth.onAuthStateChange(() => { void check(); });
    return () => sub.subscription.unsubscribe();
  }, [check]);

  if (verified === null) return <FullscreenLoader />;
  if (verified) return <>{children}</>;

  return (
    <Suspense fallback={<FullscreenLoader />}>
      <MfaGate onVerified={() => setVerified(true)} />
    </Suspense>
  );
}
