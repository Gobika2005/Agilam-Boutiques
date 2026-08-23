import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import { css } from '@/lib/css';
import { supabase } from '@/lib/supabase';
import { readMfaState } from '@/lib/mfa';

const MfaGate = lazy(() => import('@/components/auth/MfaGate').then((m) => ({ default: m.MfaGate })));

/**
 * Hides a block of the page until the session is verified with a second factor.
 *
 * WHERE THIS IS USED AND WHY IT IS NARROW
 * Sellers are not asked for 2FA to run their shop — to add a product, answer a
 * buyer, or print a bill. They are asked for it at exactly one place: the bank
 * account MangaiMart pays them into.
 *
 * That is where the money actually leaks. The fraud this stops is not somebody
 * reading a seller's order list; it is somebody with a stolen seller password
 * quietly changing the payout destination to their own account and waiting for
 * the next settlement run. Everything else a stolen seller session can do is
 * visible and reversible. This is not.
 *
 * Putting the prompt anywhere wider would mean forcing an authenticator app on
 * every boutique owner on the platform, which is a real drop-off cost for a
 * real security gain of roughly nothing.
 *
 * HOW STRONG IS IT
 * Weaker than the console gate, and honestly so. `is_admin()`/`is_staff()` carry
 * the aal2 requirement into RLS (migration 0100), but a seller's own boutique
 * row is owner-scoped by `owner_id = auth.uid()` — the policy has no assurance
 * level in it, so this prompt is enforced by the app rather than the database.
 * Someone who has the password and knows how to call PostgREST directly can
 * still write the column.
 *
 * Making it airtight would mean adding aal2 to the boutiques UPDATE policy,
 * which would break every seller who has not enrolled — including the ones
 * mid-onboarding. That is a trade for the day sellers are universally enrolled,
 * not before, and the honest thing is to write down which side of the line this
 * currently sits on rather than let a future reader assume the stronger one.
 */
export function MfaStepUp({
  reason,
  disabled = false,
  children,
}: {
  /** One line explaining why this particular block is asking. */
  reason: string;
  /**
   * Pass through without asking. For the case where there is nothing to protect
   * yet — a seller entering bank details for the first time has no established
   * payout destination to redirect.
   */
  disabled?: boolean;
  children: ReactNode;
}) {
  const [verified, setVerified] = useState<boolean | null>(null);
  const [prompting, setPrompting] = useState(false);

  const check = useCallback(async () => {
    setVerified((await readMfaState()) === 'verified');
  }, []);

  useEffect(() => {
    if (disabled) return;
    void check();
    const { data: sub } = supabase.auth.onAuthStateChange(() => { void check(); });
    return () => sub.subscription.unsubscribe();
  }, [check, disabled]);

  if (disabled) return <>{children}</>;

  if (verified === null) {
    return <div style={css('color:var(--ag-muted);font-size:13.5px;padding:18px 0;')}>Checking…</div>;
  }

  if (verified) return <>{children}</>;

  if (prompting) {
    return (
      <Suspense fallback={<div style={css('color:var(--ag-muted);font-size:13.5px;padding:18px 0;')}>Loading…</div>}>
        <MfaGate
          onVerified={() => {
            setPrompting(false);
            setVerified(true);
          }}
        />
      </Suspense>
    );
  }

  return (
    <div style={css('background:var(--ag-surface-2);border:1px solid var(--ag-border);border-radius:18px;padding:22px 20px;text-align:center;')}>
      <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:34px;color:var(--ag-crimson);")}>
        encrypted
      </span>
      <div style={css('font-size:15.5px;font-weight:800;color:var(--ag-ink);margin-top:8px;')}>
        Confirm it’s you
      </div>
      <div style={css('font-size:13.5px;color:var(--ag-muted);margin-top:7px;line-height:1.55;max-width:340px;margin-left:auto;margin-right:auto;')}>
        {reason}
      </div>
      <button
        type="button"
        onClick={() => setPrompting(true)}
        style={css('margin-top:16px;height:46px;padding:0 22px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-size:14.5px;font-weight:800;cursor:pointer;')}
      >
        Verify
      </button>
    </div>
  );
}
