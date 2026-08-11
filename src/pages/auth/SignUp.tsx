import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Role } from '@/types/database';
import { useAuth } from '@/auth/AuthContext';
import { homeFor } from '@/auth/RequireRole';
import { safeNext } from '@/auth/SignInGate';
import { css } from '@/lib/css';
import { AuthModal, PasswordField } from '@/components/auth/AuthModal';
import { ConsentCheckbox, CONSENT_REQUIRED } from '@/components/legal/Consent';
import { useToast } from '@/components/ui/Toast';

const fieldStyle = 'width:100%;margin-top:7px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;padding:0 15px;height:52px;font-size:15px;font-weight:600;color:var(--ag-ink);';
const labelStyle = 'font-size:13px;font-weight:700;color:var(--ag-label);';

export function SignUp() {
  const { role: roleParam } = useParams<{ role: string }>();
  const role = (roleParam === 'seller' ? 'seller' : 'buyer') as Role;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { signUpWithPassword } = useAuth();
  const toast = useToast();

  // Set when the buyer got here from the checkout sign-in gate (see
  // @/auth/SignInGate) — they finish the account and carry on to their order.
  const next = safeNext(searchParams.get('next'));
  const signInHref = next
    ? `/auth/signin/${role}?next=${encodeURIComponent(next)}`
    : `/auth/signin/${role}`;

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [city, setCity] = useState('');
  const [consent, setConsent] = useState(false);
  const [sending, setSending] = useState(false);

  const roleWord = role === 'seller' ? 'boutique owner' : 'buyer';
  const roleIcon = role === 'seller' ? 'storefront' : 'shopping_bag';

  // Sellers register through the boutique wizard, which creates the account as
  // its own first step — this card would only ask for the same details twice.
  // The route is kept so old links and the seller sign-in page still resolve.
  useEffect(() => {
    if (role === 'seller') navigate('/seller/register', { replace: true });
  }, [role, navigate]);

  async function handleSignUp() {
    const trimmedEmail = email.trim();
    if (!fullName.trim()) return toast('Enter your full name');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return toast('Enter a valid email address');
    if (password.length < 6) return toast('Password must be at least 6 characters');
    if (!consent) return toast(CONSENT_REQUIRED);

    setSending(true);
    try {
      const { confirmationRequired, role: newRole } = await signUpWithPassword(trimmedEmail, password, {
        full_name: fullName,
        role,
        city,
      });
      if (confirmationRequired) {
        toast('Check your email to confirm your account, then sign in');
        navigate(signInHref);
      } else {
        navigate(next ?? homeFor(newRole), { replace: true });
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not create account');
    } finally {
      setSending(false);
    }
  }

  return (
    <AuthModal
      icon={roleIcon}
      heading="Create account"
      sub={`Join MangaiMart as a ${roleWord}.`}
      onBack={() => navigate(signInHref)}
    >
      <label style={css(labelStyle)}>
        Full name
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Priya Sharma" style={css(fieldStyle)} />
      </label>

      <label style={css(labelStyle)}>
        Email address
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="priya@example.com" style={css(fieldStyle)} />
      </label>

      <PasswordField value={password} onChange={setPassword} autoComplete="new-password" />

      <label style={css(labelStyle)}>
        City
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Coimbatore" style={css(fieldStyle)} />
      </label>

      <ConsentCheckbox checked={consent} onChange={setConsent} />

      <button
        onClick={handleSignUp}
        disabled={sending || !consent}
        style={css(`width:100%;height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);display:flex;align-items:center;justify-content:center;gap:8px;opacity:${sending || !consent ? 0.6 : 1};`)}
      >
        {sending ? 'Creating account…' : 'Create Account'}
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>arrow_forward</span>
      </button>

      <div style={css('text-align:center;font-size:14px;color:var(--ag-muted);')}>
        Have an account? <a href="#" onClick={(e) => { e.preventDefault(); navigate(signInHref); }} style={css('font-weight:700;')}>Sign in</a>
      </div>
    </AuthModal>
  );
}
