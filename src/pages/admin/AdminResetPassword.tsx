import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { supabase } from '@/lib/supabase';
import { css } from '@/lib/css';
import { AuthModal, PasswordField } from '@/components/auth/AuthModal';
import { useToast } from '@/components/ui/Toast';

/**
 * Lands here from the password-reset email link. Supabase opens a short-lived
 * recovery session (detected from the URL), which lets the user set a new
 * password via updateUser. The change is only accepted for admin accounts —
 * a non-admin who somehow reaches this flow is signed out, matching the rule
 * that only those with admin access may use the admin console.
 */
export function AdminResetPassword() {
  const { updatePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  // Until the recovery session is confirmed we don't know the link is valid.
  const [ready, setReady] = useState<'checking' | 'ok' | 'invalid'>('checking');

  useEffect(() => {
    // The recovery token in the URL is exchanged for a session asynchronously;
    // wait for that session (or the PASSWORD_RECOVERY event) before enabling
    // the form so an expired/opened-elsewhere link shows a clear message.
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
    if (password.length < 8) {
      toast('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      toast('Passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      const role = await updatePassword(password);
      if (role !== 'admin') {
        await signOut();
        toast('This account does not have admin access.');
        navigate('/admin/login', { replace: true });
        return;
      }
      toast('Password updated. You are signed in.');
      navigate('/admin/overview', { replace: true });
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
        onBack={() => navigate('/admin/login', { replace: true })}
      >
        <button
          onClick={() => navigate('/admin/login', { replace: true })}
          style={css('width:100%;height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);')}
        >
          Back to sign in
        </button>
      </AuthModal>
    );
  }

  return (
    <AuthModal
      icon="lock_reset"
      heading="Set a new password"
      sub="Choose a new password for your admin account."
    >
      {ready === 'checking' ? (
        <div style={css('text-align:center;color:#8A7078;font-size:14px;')}>Verifying your reset link…</div>
      ) : (
        <>
          <PasswordField value={password} onChange={setPassword} label="New password" />
          <PasswordField value={confirm} onChange={setConfirm} label="Confirm new password" />

          <button
            onClick={handleReset}
            disabled={busy}
            style={css('width:100%;height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);')}
          >
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </>
      )}
    </AuthModal>
  );
}
