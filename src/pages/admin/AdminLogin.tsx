import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { css } from '@/lib/css';
import { AuthModal, PasswordField } from '@/components/auth/AuthModal';
import { useToast } from '@/components/ui/Toast';

const fieldStyle = 'width:100%;margin-top:7px;border:1.5px solid #F0D8E2;background:#fff;border-radius:14px;padding:0 15px;height:52px;font-size:15px;font-weight:600;color:#2A1A20;';

export function AdminLogin() {
  const { adminSignIn, signOut, sendPasswordReset } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Toggles the card between normal sign-in and the "email me a reset link" flow.
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const seededEmail = searchParams.get('email');
    if (seededEmail) setEmail(seededEmail);
  }, [searchParams]);

  async function handleSignIn() {
    setBusy(true);
    try {
      const role = await adminSignIn(email, password);
      // Only admins may enter the console. A non-admin account (seller/buyer)
      // that authenticates here is signed back out rather than routed elsewhere.
      if (role !== 'admin') {
        await signOut();
        toast('This account does not have admin access.');
        return;
      }
      navigate('/admin/overview', { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSendReset() {
    if (!email.trim()) {
      toast('Enter your admin email first.');
      return;
    }
    setBusy(true);
    try {
      // The link returns to the admin reset screen, where the new password is set
      // and admin access is re-verified before the change is accepted.
      await sendPasswordReset(email.trim(), `${window.location.origin}/admin/reset-password`);
      setSent(true);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not send reset email');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'reset') {
    return (
      <AuthModal
        icon="lock_reset"
        heading="Reset admin password"
        sub="We'll email a secure link to reset the password for your admin account."
        onBack={() => { setMode('signin'); setSent(false); }}
      >
        {sent ? (
          <div style={css('text-align:center;color:#7A5C67;font-size:14px;line-height:1.6;')}>
            If <strong style={css('color:#2A1A20;')}>{email}</strong> has admin access, a reset link is on its way.
            Open it on this device and set a new password.
          </div>
        ) : (
          <>
            <label style={css('font-size:13px;font-weight:700;color:#7A5C67;')}>
              Email
              <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@agilam.in" style={css(fieldStyle)} />
            </label>

            <button
              onClick={handleSendReset}
              disabled={busy}
              style={css('width:100%;height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);')}
            >
              {busy ? 'Sending…' : 'Email reset link'}
            </button>
          </>
        )}
      </AuthModal>
    );
  }

  return (
    <AuthModal
      icon="shield_person"
      heading="Admin sign in"
      sub="Restricted access to the Agilam marketplace console."
      onBack={() => navigate('/')}
    >
      <label style={css('font-size:13px;font-weight:700;color:#7A5C67;')}>
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@agilam.in" style={css(fieldStyle)} />
      </label>

      <PasswordField value={password} onChange={setPassword} />

      <div style={css('display:flex;justify-content:flex-end;font-size:13px;margin-top:-4px;')}>
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); setMode('reset'); }}
          style={css('font-weight:700;color:#B02454;')}
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
