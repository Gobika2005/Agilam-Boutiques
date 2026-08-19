import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Role } from '@/types/database';
import { useAuth } from '@/auth/AuthContext';
import { homeFor } from '@/auth/RequireRole';
import { safeNext } from '@/auth/SignInGate';
import { css } from '@/lib/css';
import { AuthModal, PasswordField } from '@/components/auth/AuthModal';
import { RequestResetFields } from '@/components/auth/ResetPasswordCard';
import { ConsentNotice } from '@/components/legal/Consent';
import { useToast } from '@/components/ui/Toast';
import { friendlyAuthError, signInWithGoogle } from '@/lib/authMethods';
import { GoogleIcon } from '@/components/ui/GoogleIcon';

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

  // Where the buyer was headed when the sign-in gate stopped them (?next=…),
  // e.g. /checkout. Validated, because an unchecked value here is an open
  // redirect. Absent for a normal visit to the login page.
  const next = safeNext(searchParams.get('next'));
  // Ordering is the one buyer action that needs an account, so it is also the
  // one place a buyer meets this screen without asking for it — say why.
  const gated = !!next && role === 'buyer';

  useEffect(() => {
    const seededEmail = searchParams.get('email');
    if (seededEmail) setEmail(seededEmail);
  }, [searchParams]);

  // Google works for both roles: sellers land on their console (or boutique
  // onboarding if they don't have one yet), buyers on their profile.
  async function handleGoogle() {
    try {
      // `next` survives the Google round-trip in localStorage — the OAuth
      // redirect comes back to /auth/callback, not to this URL.
      await signInWithGoogle(role === 'seller' ? 'seller' : 'buyer', next);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Google sign-in failed');
    }
  }

  // Takes the submit event because the fields live in a real <form>: that is
  // what makes Enter in the email/password field sign in, the way every other
  // login on the web behaves.
  async function handleSignIn(e?: FormEvent) {
    e?.preventDefault();
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return toast('Enter a valid email address');
    if (!password) return toast('Enter your password');

    setSending(true);
    try {
      // Sign in as the role this page is for, so a boutique owner reliably
      // lands on the seller console instead of the buyer app. `role` only seeds
      // a brand-new profile — an existing account keeps its own role.
      const profileRole = await signInWithPassword(trimmedEmail, password, role);
      // Back to whatever the gate interrupted (the bag → checkout run), or the
      // account's own home when they simply came to sign in.
      navigate(next ?? homeFor(profileRole), { replace: true });
    } catch (e) {
      toast(e instanceof Error ? friendlyAuthError(e.message) : 'Sign in failed');
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
      icon={gated ? 'lock' : roleIcon}
      heading={gated ? 'Sign in to order' : 'Welcome back'}
      sub={
        gated
          ? 'Orders are placed from an account, so you can track them, chat with the boutique and raise a return. Your bag is saved.'
          : `Sign in to continue to your ${roleWord} workspace.`
      }
      onBack={() => navigate(gated ? '/cart' : '/')}
    >
      {/* A real form, so Enter submits and password managers recognise the pair. */}
      <form onSubmit={handleSignIn} style={css('display:flex;flex-direction:column;gap:15px;')}>
      <label style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
        Email or phone
        <input
          type="email"
          name="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
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
        type="submit"
        disabled={sending}
        style={css('width:100%;height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);display:flex;align-items:center;justify-content:center;gap:8px;')}
      >
        {sending ? 'Signing in…' : 'Login'}
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>arrow_forward</span>
      </button>
      </form>

      <div style={css('display:flex;align-items:center;gap:12px;color:var(--ag-muted-soft);font-size:13px;')}>
        <div style={css('flex:1;height:1px;background:var(--ag-border);')} />or continue with<div style={css('flex:1;height:1px;background:var(--ag-border);')} />
      </div>
      {/*
        Google only. There was an "Apple" button beside it that did nothing but
        toast "coming soon" — sitting next to a working provider, at the same
        size and weight, it read as a real option, and a buyer who owns an
        iPhone would reasonably have tapped it first. Apple sign-in needs a paid
        developer account and a Services ID configured in Supabase; until that
        exists the honest UI is not to offer it.
      */}
      <div style={css('display:flex;gap:12px;')}>
        <button onClick={handleGoogle} style={css('flex:1;height:50px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;font-weight:700;cursor:pointer;color:var(--ag-ink);display:flex;align-items:center;justify-content:center;gap:8px;')}>
          <GoogleIcon size={19} />Google
        </button>
      </div>

      <ConsentNotice />

      <div style={css('text-align:center;font-size:14px;color:var(--ag-muted);')}>
        New to MangaiMart?{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            // Carry `next` into signup too: a first-time buyer stopped at the
            // checkout gate must land back on checkout, not on the homepage.
            const signup = next ? `/auth/signup/buyer?next=${encodeURIComponent(next)}` : '/auth/signup/buyer';
            navigate(role === 'seller' ? '/seller/register' : signup);
          }}
          style={css('font-weight:700;')}
        >
          {role === 'seller' ? 'Open your boutique' : 'Create an account'}
        </a>
      </div>
    </AuthModal>
  );
}
