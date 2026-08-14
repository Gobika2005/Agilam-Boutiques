import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { FullscreenLoader, homeFor } from '@/auth/RequireRole';
import { isConsoleRole } from '@/lib/staffAccess';
import { adminPath } from '@/lib/adminPath';
import { css } from '@/lib/css';
import { AuthModal, PasswordField } from '@/components/auth/AuthModal';
import { RequestResetFields } from '@/components/auth/ResetPasswordCard';
import { useToast } from '@/components/ui/Toast';

const fieldStyle = 'width:100%;margin-top:7px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;padding:0 15px;height:52px;font-size:15px;font-weight:600;color:var(--ag-ink);';

export function AdminLogin() {
  const { adminSignIn, signOut, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Toggles the card between normal sign-in and the "email me a reset link" flow.
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');

  useEffect(() => {
    const seededEmail = searchParams.get('email');
    if (seededEmail) setEmail(seededEmail);
  }, [searchParams]);

  async function handleSignIn() {
    setBusy(true);
    try {
      const role = await adminSignIn(email, password);
      // Only console accounts may enter. A buyer or seller that authenticates
      // here is signed back out rather than routed elsewhere. Staff are a
      // console role (migration 0086) — they land on the work queue, not on
      // Overview, which is the revenue screen and not theirs.
      if (!isConsoleRole(role)) {
        await signOut();
        toast('This account does not have admin access.');
        return;
      }
      navigate(homeFor(role), { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  // The console has no entry point in the UI — staff arrive by typing or
  // bookmarking the URL, and /admin/login is the one they tend to keep. An admin
  // who still holds a session should land in the console rather than be asked to
  // sign in to the account they are already signed in to.
  if (loading) return <FullscreenLoader />;
  if (isConsoleRole(profile?.role)) return <Navigate to={homeFor(profile?.role)} replace />;

  if (mode === 'reset') {
    return (
      <AuthModal
        icon="lock_reset"
        heading="Reset admin password"
        sub="We'll email a secure link to reset the password for your admin account."
        onBack={() => setMode('signin')}
      >
        <RequestResetFields
          email={email}
          setEmail={setEmail}
          redirectTo={`${window.location.origin}${adminPath('reset-password')}`}
        />
      </AuthModal>
    );
  }

  return (
    <AuthModal
      icon="shield_person"
      heading="Admin sign in"
      sub="Restricted access to the MangaiMart marketplace console."
      onBack={() => navigate('/')}
    >
      <label style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@mangaimart.com" style={css(fieldStyle)} />
      </label>

      <PasswordField value={password} onChange={setPassword} />

      <div style={css('display:flex;justify-content:flex-end;font-size:13px;margin-top:-4px;')}>
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); setMode('reset'); }}
          style={css('font-weight:700;color:var(--ag-crimson);')}
        >
          Forgot password?
        </a>
      </div>

      <button
        onClick={handleSignIn}
        disabled={busy}
        style={css('width:100%;height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);')}
      >
        {busy ? 'Signing in…' : 'Sign In'}
      </button>
    </AuthModal>
  );
}
