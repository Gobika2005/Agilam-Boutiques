import { useRef, useState } from 'react';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { signInWithGoogle, sendEmailOtp, verifyEmailOtp, friendlyAuthError } from '@/lib/authMethods';
import { ConsentCheckbox, ConsentNotice, CONSENT_REQUIRED } from '@/components/legal/Consent';

const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/**
 * Buyer sign-in / sign-up sheet. Three methods, all email-based (no SMS needed):
 * Google, an emailed one-time code, or email + password. On success the browser
 * holds a Supabase session and `onDone` fires so the caller can sync.
 */
export function AccountSheet({
  onDone,
  onClose,
  title,
  subtitle,
}: {
  onDone: () => void;
  onClose: () => void;
  /** Override the form-view heading/subtext so the sheet can be reused as a
   * context-specific gate (e.g. "Sign in to chat"). The code-entry view keeps
   * its own copy. */
  title?: string;
  subtitle?: string;
}) {
  const { signInWithPassword, signUpWithPassword, sendPasswordReset } = useAuth();
  const [view, setView] = useState<'form' | 'code'>('form');
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const code = digits.join('');
  const inputStyle = css('display:block;width:100%;margin-top:7px;border:1.5px solid var(--ag-border);background:var(--ag-bg);border-radius:14px;padding:0 15px;height:52px;font-size:15px;font-weight:600;color:var(--ag-ink);box-sizing:border-box;');
  const labelStyle = css('font-size:12.5px;font-weight:800;color:var(--ag-label);display:block;');

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

  // Primary action: password when one's entered, otherwise an emailed code.
  const submit = async () => {
    if (!emailOk(email)) return setError('Enter a valid email address.');
    setBusy(true);
    setError('');
    try {
      if (password) {
        if (mode === 'create') {
          if (name.trim().length < 2) { setBusy(false); return setError('Enter your name.'); }
          if (password.length < 6) { setBusy(false); return setError('Password must be at least 6 characters.'); }
          if (!consent) { setBusy(false); return setError(CONSENT_REQUIRED); }
          const { confirmationRequired } = await signUpWithPassword(email.trim(), password, { full_name: name.trim(), role: 'buyer' });
          if (confirmationRequired) { setBusy(false); return setError('Check your email to confirm, then sign in.'); }
        } else {
          await signInWithPassword(email.trim(), password, 'buyer');
        }
        onDone();
      } else {
        await sendEmailOtp(email);
        setView('code');
      }
    } catch (e) {
      setError(e instanceof Error ? friendlyAuthError(e.message) : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  // Email a reset link. Non-committal copy so the sheet never reveals whether an
  // email has an account. (A buyer can also just leave the password blank to sign
  // in with an emailed code — this is the path for those who prefer a password.)
  const forgotPassword = async () => {
    if (!emailOk(email)) return setError('Enter your email above first.');
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await sendPasswordReset(email.trim(), `${window.location.origin}/auth/reset-password`);
      setNotice('If that email has an account, a reset link is on its way.');
    } catch (e) {
      setError(e instanceof Error ? friendlyAuthError(e.message) : 'Could not send reset email');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.length !== 6) return setError('Enter all 6 digits.');
    setBusy(true);
    setError('');
    try {
      await verifyEmailOtp(email, code);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed');
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
          <span style={css("font-family:'Material Symbols Outlined';color:#fff;font-size:28px;")}>{view === 'code' ? 'mark_email_read' : 'account_circle'}</span>
        </div>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;text-align:center;margin-top:15px;line-height:1.15;")}>
          {view === 'code' ? 'Enter the code' : mode === 'create' ? 'Create your account' : title ?? 'Sign in to sync'}
        </div>
        <div style={css('text-align:center;color:var(--ag-muted);font-size:13.5px;margin-top:8px;line-height:1.5;max-width:330px;margin-left:auto;margin-right:auto;')}>
          {view === 'code' ? `We emailed a 6-digit code to ${email}` : subtitle ?? 'Keep your orders & details on any device.'}
        </div>

        {view === 'form' ? (
          <>
            <button
              onClick={google}
              disabled={busy}
              style={css('width:100%;height:52px;margin-top:22px;border:1.5px solid #E7C6D4;background:var(--ag-surface);border-radius:14px;font-weight:800;font-size:15px;color:var(--ag-ink);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;')}
            >
              <span style={css("font-family:'Material Symbols Outlined';font-size:20px;color:#D6336C;")}>g_translate</span>Continue with Google
            </button>

            <div style={css('display:flex;align-items:center;gap:12px;color:var(--ag-muted-soft);font-size:12.5px;margin:16px 0;')}>
              <div style={css('flex:1;height:1px;background:var(--ag-border);')} />or<div style={css('flex:1;height:1px;background:var(--ag-border);')} />
            </div>

            <div style={css('display:flex;flex-direction:column;gap:13px;')}>
              {mode === 'create' && (
                <label style={labelStyle}>Full name
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" style={inputStyle} />
                </label>
              )}
              <label style={labelStyle}>Email
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={inputStyle} />
              </label>
              <label style={labelStyle}>Password <span style={css('font-weight:600;color:#A98B98;')}>· leave blank to get an email code</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={inputStyle} />
              </label>
              {mode === 'signin' && (
                <div style={css('display:flex;justify-content:flex-end;margin-top:-4px;')}>
                  <a href="#" onClick={(e) => { e.preventDefault(); forgotPassword(); }} style={css('font-size:12.5px;font-weight:800;color:var(--ag-crimson);')}>Forgot password?</a>
                </div>
              )}
            </div>

            {mode === 'create' && (
              <div style={css('margin-top:14px;')}>
                <ConsentCheckbox checked={consent} onChange={setConsent} />
              </div>
            )}

            {notice && <div style={css('color:var(--ag-label);font-size:12.5px;font-weight:700;margin-top:12px;text-align:center;line-height:1.5;')}>{notice}</div>}
            {error && <div style={css('color:#C0455E;font-size:12.5px;font-weight:700;margin-top:12px;text-align:center;')}>{error}</div>}

            <button
              onClick={submit}
              disabled={busy}
              style={css(`width:100%;height:54px;margin-top:18px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);display:flex;align-items:center;justify-content:center;gap:8px;opacity:${busy ? 0.7 : 1};`)}
            >
              {busy ? 'Please wait…' : password ? (mode === 'create' ? 'Create account' : 'Sign in') : 'Email me a code'}
              {!busy && <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>{password ? 'arrow_forward' : 'mail'}</span>}
            </button>

            <div style={css('text-align:center;font-size:13.5px;color:var(--ag-muted);margin-top:14px;')}>
              {mode === 'signin' ? 'New to Agilam? ' : 'Have an account? '}
              <a href="#" onClick={(e) => { e.preventDefault(); setMode(mode === 'signin' ? 'create' : 'signin'); setError(''); }} style={css('font-weight:800;color:var(--ag-crimson);')}>
                {mode === 'signin' ? 'Create account' : 'Sign in'}
              </a>
            </div>

            {/* Clickwrap covering the one-tap methods above (Google, email code)
                and returning sign-in; create mode also has the required tickbox. */}
            <div style={css('margin-top:14px;')}>
              <ConsentNotice />
            </div>
          </>
        ) : (
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
                  autoFocus={i === 0}
                  style={css(`width:46px;height:56px;text-align:center;font-size:23px;font-weight:800;border:1.5px solid ${d ? '#D6336C' : 'var(--ag-border)'};background:var(--ag-bg);border-radius:14px;color:var(--ag-ink);`)}
                />
              ))}
            </div>
            {error && <div style={css('color:#C0455E;font-size:12.5px;font-weight:700;margin-top:14px;text-align:center;')}>{error}</div>}
            <button
              onClick={verify}
              disabled={busy}
              style={css(`width:100%;height:54px;margin-top:20px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);opacity:${busy ? 0.7 : 1};`)}
            >
              {busy ? 'Verifying…' : 'Verify & sync'}
            </button>
            <button onClick={() => { setView('form'); setDigits(['', '', '', '', '', '']); setError(''); }} style={css('width:100%;height:44px;margin-top:8px;border:none;background:none;color:var(--ag-muted);font-weight:700;font-size:14px;cursor:pointer;')}>
              Use a different method
            </button>
          </>
        )}
      </div>
    </div>
  );
}
