import { useRef, useState } from 'react';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { signInWithGoogle, sendPasswordResetCode, verifyEmailOtp, friendlyAuthError } from '@/lib/authMethods';
import { ConsentCheckbox, ConsentNotice, CONSENT_REQUIRED } from '@/components/legal/Consent';
import { GoogleIcon } from '@/components/ui/GoogleIcon';

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/**
 * Buyer sign-in / sign-up sheet.
 *
 * The sheet is one screen at a time, the way the seller and admin logins are:
 * email + password is the only way to sign in with an address (Google is the
 * other method). A blank password used to mean "email me a code instead", which
 * put two different sign-in methods behind one ambiguous field — the primary
 * button changed meaning depending on whether the field had text in it.
 *
 * The emailed 6-digit code now belongs to one flow only: forgot-password. That
 * flow is `forgot → code → newpass`, and it doubles as how a buyer who joined
 * with Google or (historically) a code sets a password for the first time.
 *
 * On success the browser holds a Supabase session and `onDone` fires so the
 * caller can sync.
 */
export function AccountSheet({
  onDone,
  onClose,
  title,
  subtitle,
}: {
  onDone: () => void;
  onClose: () => void;
  /** Override the sign-in heading/subtext so the sheet can be reused as a
   * context-specific gate (e.g. "Sign in to chat"). Every other view keeps its
   * own copy. */
  title?: string;
  subtitle?: string;
}) {
  const { signInWithPassword, signUpWithPassword, updatePassword } = useAuth();
  const [view, setView] = useState<'signin' | 'create' | 'forgot' | 'code' | 'newpass'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join('');
  const inputStyle = css('display:block;width:100%;margin-top:7px;border:1.5px solid var(--ag-border);background:var(--ag-bg);border-radius:14px;padding:0 15px;height:52px;font-size:15px;font-weight:600;color:var(--ag-ink);box-sizing:border-box;');
  const labelStyle = css('font-size:12.5px;font-weight:800;color:var(--ag-label);display:block;');
  const primaryStyle = (extra = '') => css(`width:100%;height:54px;margin-top:18px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);display:flex;align-items:center;justify-content:center;gap:8px;opacity:${busy ? 0.7 : 1};${extra}`);
  const linkStyle = css('font-weight:800;color:var(--ag-crimson);');
  const quietButton = css('width:100%;height:44px;margin-top:8px;border:none;background:none;color:var(--ag-muted);font-weight:700;font-size:14px;cursor:pointer;');

  /** Moving between views must not carry an error from the previous one. */
  const go = (next: typeof view) => { setError(''); setView(next); };

  const google = async () => {
    setBusy(true);
    setError('');
    try {
      await signInWithGoogle(); // redirects away on success
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed');
      setBusy(false);
    }
  };

  const signIn = async () => {
    if (!emailOk(email)) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setBusy(true);
    setError('');
    try {
      await signInWithPassword(email.trim(), password, 'buyer');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? friendlyAuthError(e.message) : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (name.trim().length < 2) return setError('Enter your name.');
    if (!emailOk(email)) return setError('Enter a valid email address.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (!consent) return setError(CONSENT_REQUIRED);
    setBusy(true);
    setError('');
    try {
      const { confirmationRequired } = await signUpWithPassword(email.trim(), password, { full_name: name.trim(), role: 'buyer' });
      if (confirmationRequired) { setBusy(false); return setError('Check your email to confirm, then sign in.'); }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? friendlyAuthError(e.message) : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  // Send the code. The confirmation is deliberately non-committal ("if that
  // email has an account"), so the sheet never reveals who is registered.
  const sendCode = async () => {
    if (!emailOk(email)) return setError('Enter a valid email address.');
    setBusy(true);
    setError('');
    try {
      await sendPasswordResetCode(email.trim());
      setDigits(['', '', '', '', '', '']);
      go('code');
    } catch (e) {
      setError(e instanceof Error ? friendlyAuthError(e.message) : 'Could not send the code');
    } finally {
      setBusy(false);
    }
  };

  // Verifying the code opens a real session — that is what lets updateUser set
  // the new password on the next screen.
  const verify = async () => {
    if (code.length !== 6) return setError('Enter all 6 digits.');
    setBusy(true);
    setError('');
    try {
      await verifyEmailOtp(email, code);
      setPassword('');
      setConfirm('');
      go('newpass');
    } catch (e) {
      setError(e instanceof Error ? friendlyAuthError(e.message) : 'Verification failed');
    } finally {
      setBusy(false);
    }
  };

  const savePassword = async () => {
    if (password.length < 8) return setError('Use at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    setError('');
    try {
      await updatePassword(password);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? friendlyAuthError(e.message) : 'Could not update password');
    } finally {
      setBusy(false);
    }
  };

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    setDigits((prev) => prev.map((x, j) => (j === i ? d : x)));
    if (d && i < 5) inputs.current[i + 1]?.focus();
  };
  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const HEAD: Record<typeof view, { icon: string; heading: string; sub: string }> = {
    signin: { icon: 'account_circle', heading: title ?? 'Sign in to sync', sub: subtitle ?? 'Keep your orders & details on any device.' },
    create: { icon: 'account_circle', heading: 'Create your account', sub: 'Keep your orders & details on any device.' },
    forgot: { icon: 'lock_reset', heading: 'Forgot your password?', sub: 'Enter your email and we’ll send a 6-digit code to reset it. This is also how you set a password for the first time if you joined with Google.' },
    code: { icon: 'mark_email_read', heading: 'Enter the code', sub: `If ${email} has an account, a 6-digit code is on its way.` },
    newpass: { icon: 'lock_reset', heading: 'Choose a new password', sub: 'You’re verified — pick a password you’ll use from now on.' },
  };
  const head = HEAD[view];

  const errorLine = error && <div style={css('color:#C0455E;font-size:12.5px;font-weight:700;margin-top:12px;text-align:center;line-height:1.5;')}>{error}</div>;

  return (
    <div
      onClick={onClose}
      style={css('position:fixed;inset:0;z-index:230;background:rgba(40,10,22,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={css('width:100%;max-width:440px;margin:auto;background:var(--ag-surface);border-radius:28px;padding:24px 24px 26px;box-shadow:0 30px 80px -30px rgba(107,20,54,.6);')}
      >
        <div style={css('width:56px;height:56px;border-radius:17px;background:linear-gradient(135deg,#D6336C,#B02454);display:flex;align-items:center;justify-content:center;margin:0 auto;box-shadow:0 16px 34px -16px rgba(214,51,108,.8);')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#fff;font-size:28px;")}>{head.icon}</span>
        </div>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;text-align:center;margin-top:15px;line-height:1.15;")}>{head.heading}</div>
        <div style={css('text-align:center;color:var(--ag-muted);font-size:13.5px;margin-top:8px;line-height:1.5;max-width:330px;margin-left:auto;margin-right:auto;')}>{head.sub}</div>

        {/* ─────────────── Sign in / create: email + password ─────────────── */}
        {(view === 'signin' || view === 'create') && (
          <>
            <button
              onClick={google}
              disabled={busy}
              style={css('width:100%;height:52px;margin-top:22px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;font-weight:800;font-size:15px;color:var(--ag-ink);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;')}
            >
              <GoogleIcon size={20} />Continue with Google
            </button>

            <div style={css('display:flex;align-items:center;gap:12px;color:var(--ag-muted-soft);font-size:12.5px;margin:16px 0;')}>
              <div style={css('flex:1;height:1px;background:var(--ag-border);')} />or<div style={css('flex:1;height:1px;background:var(--ag-border);')} />
            </div>

            <div style={css('display:flex;flex-direction:column;gap:13px;')}>
              {view === 'create' && (
                <label style={labelStyle}>Full name
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" style={inputStyle} />
                </label>
              )}
              <label style={labelStyle}>Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" style={inputStyle} />
              </label>
              <label style={labelStyle}>Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void (view === 'create' ? create() : signIn()); }}
                  placeholder="••••••••"
                  autoComplete={view === 'create' ? 'new-password' : 'current-password'}
                  style={inputStyle}
                />
                {view === 'create' && <span style={css('display:block;font-size:11.5px;font-weight:600;color:var(--ag-muted);margin-top:6px;')}>At least 8 characters.</span>}
              </label>
              {view === 'signin' && (
                <div style={css('display:flex;justify-content:flex-end;margin-top:-4px;')}>
                  <a href="#" onClick={(e) => { e.preventDefault(); go('forgot'); }} style={css('font-size:12.5px;font-weight:800;color:var(--ag-crimson);')}>Forgot password?</a>
                </div>
              )}
            </div>

            {view === 'create' && (
              <div style={css('margin-top:14px;')}>
                <ConsentCheckbox checked={consent} onChange={setConsent} />
              </div>
            )}

            {errorLine}

            <button onClick={view === 'create' ? create : signIn} disabled={busy} style={primaryStyle()}>
              {busy ? 'Please wait…' : view === 'create' ? 'Create account' : 'Sign in'}
              {!busy && <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>arrow_forward</span>}
            </button>

            <div style={css('text-align:center;font-size:13.5px;color:var(--ag-muted);margin-top:14px;')}>
              {view === 'signin' ? 'New to MangaiMart? ' : 'Have an account? '}
              <a href="#" onClick={(e) => { e.preventDefault(); go(view === 'signin' ? 'create' : 'signin'); }} style={linkStyle}>
                {view === 'signin' ? 'Create account' : 'Sign in'}
              </a>
            </div>

            {/* Clickwrap covering Google and returning sign-in; create mode also
                has the required tickbox. */}
            <div style={css('margin-top:14px;')}>
              <ConsentNotice />
            </div>
          </>
        )}

        {/* ─────────────── Forgot password: email → code ─────────────── */}
        {view === 'forgot' && (
          <>
            <div style={css('margin-top:22px;')}>
              <label style={labelStyle}>Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void sendCode(); }}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoFocus
                  style={inputStyle}
                />
              </label>
            </div>

            {errorLine}

            <button onClick={sendCode} disabled={busy} style={primaryStyle()}>
              {busy ? 'Sending…' : 'Email me a code'}
              {!busy && <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>mail</span>}
            </button>
            <button onClick={() => go('signin')} style={quietButton}>Back to sign in</button>
          </>
        )}

        {/* ─────────────── Forgot password: the 6-digit code ─────────────── */}
        {view === 'code' && (
          <>
            <div style={css('display:flex;gap:10px;justify-content:center;margin-top:22px;')}>
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => { inputs.current[i] = el; }}
                  value={d}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={(e) => onKeyDown(i, e)}
                  maxLength={1}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  aria-label={`Digit ${i + 1}`}
                  autoFocus={i === 0}
                  style={css(`width:46px;height:56px;text-align:center;font-size:23px;font-weight:800;border:1.5px solid ${d ? '#D6336C' : 'var(--ag-border)'};background:var(--ag-bg);border-radius:14px;color:var(--ag-ink);`)}
                />
              ))}
            </div>

            {errorLine}

            <button onClick={verify} disabled={busy} style={primaryStyle()}>
              {busy ? 'Verifying…' : 'Verify code'}
            </button>
            <button onClick={() => go('forgot')} style={quietButton}>Use a different email</button>
          </>
        )}

        {/* ─────────────── Forgot password: set the new one ─────────────── */}
        {view === 'newpass' && (
          <>
            <div style={css('display:flex;flex-direction:column;gap:13px;margin-top:22px;')}>
              <label style={labelStyle}>New password
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" autoFocus style={inputStyle} />
                <span style={css('display:block;font-size:11.5px;font-weight:600;color:var(--ag-muted);margin-top:6px;')}>At least 8 characters.</span>
              </label>
              <label style={labelStyle}>Confirm new password
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void savePassword(); }}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  style={inputStyle}
                />
              </label>
            </div>

            {errorLine}

            <button onClick={savePassword} disabled={busy} style={primaryStyle()}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
