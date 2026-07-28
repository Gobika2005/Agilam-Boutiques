import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Role } from '@/types/database';
import { useAuth } from '@/auth/AuthContext';
import { homeFor } from '@/auth/RequireRole';
import { css } from '@/lib/css';
import { AuthModal, PasswordField } from '@/components/auth/AuthModal';
import { RequestResetFields } from '@/components/auth/ResetPasswordCard';
import { ConsentNotice } from '@/components/legal/Consent';
import { useToast } from '@/components/ui/Toast';
import { signInWithGoogle } from '@/lib/authMethods';

export function SignIn() {
  const { role: roleParam } = useParams<{ role: string }>();
  const role = (roleParam === 'seller' ? 'seller' : 'buyer') as Role;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signInWithPassword } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  // Toggles the card between normal sign-in and the "email me a reset link" flow.
  const [mode, setMode] = useState<'signin' | 'reset'>('signin');

  const roleWord = role === 'seller' ? 'boutique owner' : 'buyer';
  const roleIcon = role === 'seller' ? 'storefront' : 'shopping_bag';

  useEffect(() => {
    const seededEmail = searchParams.get('email');
    if (seededEmail) setEmail(seededEmail);
  }, [searchParams]);

  // Google works for both roles: sellers land on their console (or boutique
  // onboarding if they don't have one yet), buyers on their profile.
  async function handleGoogle() {
    try {
      await signInWithGoogle(role === 'seller' ? 'seller' : 'buyer');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Google sign-in failed');
    }
  }

  async function handleSignIn() {
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return toast('Enter a valid email address');
    if (!password) return toast('Enter your password');

    setSending(true);
    try {
      // Sign in as the role this page is for (only sellers/admins authenticate;
      // buyers browse without an account), so a boutique owner reliably lands on
      // the seller console instead of the buyer app.
      const profileRole = await signInWithPassword(trimmedEmail, password, role);
      navigate(homeFor(profileRole), { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Sign in failed');
    } finally {
      setSending(false);
    }
  }

  if (mode === 'reset') {
    return (
      <AuthModal
        icon="lock_reset"
        heading="Reset your password"
        sub={`We'll email a secure link to reset your ${roleWord} account password.`}
        onBack={() => setMode('signin')}
      >
        <RequestResetFields
          email={email}
          setEmail={setEmail}
          redirectTo={`${window.location.origin}/auth/reset-password`}
        />
      </AuthModal>
    );
  }

  return (
    <AuthModal
      icon={roleIcon}
      heading="Welcome back"
      sub={`Sign in to continue to your ${roleWord} workspace.`}
      onBack={() => navigate('/buyer/home')}
    >
      <label style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
        Email or phone
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="hello@mangaimart.com"
          style={css('width:100%;margin-top:7px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;padding:0 15px;height:52px;font-size:15px;font-weight:600;color:var(--ag-ink);')}
        />
      </label>

      <PasswordField value={password} onChange={setPassword} />

      <div style={css('display:flex;align-items:center;justify-content:space-between;font-size:13px;')}>
        <label style={css('display:flex;align-items:center;gap:7px;color:var(--ag-label);font-weight:600;cursor:pointer;')}>
          <input type="checkbox" defaultChecked style={css('width:16px;height:16px;accent-color:#D6336C;')} />Remember me
        </label>
        <a href="#" onClick={(e) => { e.preventDefault(); setMode('reset'); }} style={css('font-weight:700;')}>Forgot password?</a>
      </div>

      <button
        onClick={handleSignIn}
        disabled={sending}
        style={css('width:100%;height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);display:flex;align-items:center;justify-content:center;gap:8px;')}
      >
        {sending ? 'Signing in…' : 'Login'}
        <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>arrow_forward</span>
      </button>

      <div style={css('display:flex;align-items:center;gap:12px;color:var(--ag-muted-soft);font-size:13px;')}>
        <div style={css('flex:1;height:1px;background:var(--ag-border);')} />or continue with<div style={css('flex:1;height:1px;background:var(--ag-border);')} />
      </div>
      <div style={css('display:flex;gap:12px;')}>
        <button onClick={handleGoogle} style={css('flex:1;height:50px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;font-weight:700;cursor:pointer;color:var(--ag-ink);display:flex;align-items:center;justify-content:center;gap:8px;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:#D6336C;")}>g_translate</span>Google
        </button>
        <button onClick={() => toast('Apple sign-in coming soon')} style={css('flex:1;height:50px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;font-weight:700;cursor:pointer;color:var(--ag-ink);')}>Apple</button>
      </div>

      <ConsentNotice />

      <div style={css('text-align:center;font-size:14px;color:var(--ag-muted);')}>
        New to MangaiMart?{' '}
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); navigate(role === 'seller' ? '/seller/register' : '/auth/signup/buyer'); }}
          style={css('font-weight:700;')}
        >
          {role === 'seller' ? 'Open your boutique' : 'Create an account'}
        </a>
      </div>
    </AuthModal>
  );
}
