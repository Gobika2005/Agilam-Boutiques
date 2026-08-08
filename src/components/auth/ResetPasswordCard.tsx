import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Role } from '@/types/database';
import { useAuth } from '@/auth/AuthContext';
import { supabase } from '@/lib/supabase';
import { friendlyAuthError } from '@/lib/authMethods';
import { css } from '@/lib/css';
import { AuthModal, PasswordField } from '@/components/auth/AuthModal';
import { useToast } from '@/components/ui/Toast';

const primaryButton =
  'width:100%;height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);';

/**
 * Reusable "set a new password" screen shared by every login flow. Supabase
 * opens a short-lived recovery session from the reset-email link (detected from
 * the URL); this card waits for that session, collects a new password, applies
 * it via updateUser, and hands the account's DB role back to `onComplete` so the
 * host page can route (or gate) as it sees fit.
 */
export function ResetPasswordCard({
  heading,
  sub,
  backTo,
  onComplete,
}: {
  heading: string;
  sub: string;
  /** Where the back arrow and the expired-link button return to. */
  backTo: string;
  /** Called after a successful password change, with the account's DB role. */
  onComplete: (role: Role) => void;
}) {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  // Until the recovery session is confirmed we don't know the link is valid.
  const [ready, setReady] = useState<'checking' | 'ok' | 'invalid'>('checking');

  useEffect(() => {
    // The recovery token in the URL is exchanged for a session asynchronously;
    // wait for that session (or the PASSWORD_RECOVERY event) before enabling the
    // form so an expired/already-used link shows a clear message instead.
    let settled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) { settled = true; setReady('ok'); }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) { settled = true; setReady('ok'); }
    });
    const timer = setTimeout(() => { if (!settled) setReady('invalid'); }, 4000);
    return () => { clearTimeout(timer); sub.subscription.unsubscribe(); };
  }, []);

  async function handleReset() {
    if (password.length < 8) return toast('Use at least 8 characters.');
    if (password !== confirm) return toast('Passwords do not match.');

    setBusy(true);
    try {
      const role = await updatePassword(password);
      onComplete(role);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update password');
    } finally {
      setBusy(false);
    }
  }

  if (ready === 'invalid') {
    return (
      <AuthModal
        icon="link_off"
        heading="Reset link expired"
        sub="This password reset link is invalid or has already been used."
        onBack={() => navigate(backTo, { replace: true })}
      >
        <button onClick={() => navigate(backTo, { replace: true })} style={css(primaryButton)}>
          Back to sign in
        </button>
      </AuthModal>
    );
  }

  return (
    <AuthModal icon="lock_reset" heading={heading} sub={sub} onBack={() => navigate(backTo, { replace: true })}>
      {ready === 'checking' ? (
        <div style={css('text-align:center;color:var(--ag-muted);font-size:14px;')}>Verifying your reset link…</div>
      ) : (
        <>
          <PasswordField value={password} onChange={setPassword} label="New password" name="new-password" autoComplete="new-password" />
          <PasswordField value={confirm} onChange={setConfirm} label="Confirm new password" name="confirm-password" autoComplete="new-password" />

          <button onClick={handleReset} disabled={busy} style={css(primaryButton)}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </>
      )}
    </AuthModal>
  );
}

/**
 * Reusable "email me a reset link" mini-form used inside a login card. Keeps the
 * non-committal confirmation copy (it never reveals whether an email has an
 * account) consistent across every sign-in page.
 */
export function RequestResetFields({
  email,
  setEmail,
  redirectTo,
}: {
  email: string;
  setEmail: (v: string) => void;
  redirectTo: string;
}) {
  const { sendPasswordReset } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSend() {
    const trimmed = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return toast('Enter a valid email address first.');
    setBusy(true);
    try {
      await sendPasswordReset(trimmed, redirectTo);
      setSent(true);
    } catch (e) {
      toast(e instanceof Error ? friendlyAuthError(e.message) : 'Could not send reset email');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div style={css('text-align:center;color:var(--ag-label);font-size:14px;line-height:1.6;')}>
        If <strong style={css('color:var(--ag-ink);')}>{email}</strong> has an account, a reset link is on its way.
        Open it on this device and set a new password.
      </div>
    );
  }

  return (
    <>
      <label style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="hello@mangaimart.com"
          style={css('width:100%;margin-top:7px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;padding:0 15px;height:52px;font-size:15px;font-weight:600;color:var(--ag-ink);')}
        />
      </label>

      <button
        onClick={handleSend}
        disabled={busy}
        style={css('width:100%;height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);')}
      >
        {busy ? 'Sending…' : 'Email reset link'}
      </button>
    </>
  );
}
