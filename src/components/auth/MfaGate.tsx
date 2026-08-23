import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { css } from '@/lib/css';
import { useToast } from '@/components/ui/Toast';
import {
  backupCodesRemaining,
  generateBackupCodes,
  readMfaState,
  redeemBackupCode,
  startEnrollment,
  verifiedFactorId,
  verifyChallenge,
  type EnrollStart,
  type MfaState,
} from '@/lib/mfa';

/**
 * The two-factor screen: enrol an authenticator, or enter a code to unlock the
 * session.
 *
 * Deliberately NOT built on `AuthModal`. That shell renders the buyer Home
 * blurred behind the card, which would pull the entire storefront bundle into
 * the console's code-split chunk and read as a strange backdrop for an employee
 * signing in to do refunds.
 *
 * This screen is a courtesy, not the lock. After migration 0100 the database
 * refuses console data to an aal1 session whether or not this component ever
 * renders — what it prevents is an admin staring at an inexplicably empty
 * console with no way to fix it.
 */

const CARD =
  'width:100%;max-width:440px;background:var(--ag-surface);border:1px solid var(--ag-border);border-radius:24px;padding:26px 26px 30px;box-shadow:0 30px 80px -30px rgba(107,20,54,.45);';
const PRIMARY =
  'width:100%;height:52px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-size:15px;font-weight:800;cursor:pointer;';
const LINK =
  'background:none;border:none;color:var(--ag-crimson);font-size:13.5px;font-weight:700;cursor:pointer;padding:0;';

function Shell({ icon, heading, sub, children }: { icon: string; heading: string; sub: string; children: ReactNode }) {
  return (
    <div style={css('position:fixed;inset:0;z-index:60;background:var(--ag-bg);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;')}>
      <div style={css(CARD)}>
        <div style={css('width:56px;height:56px;border-radius:18px;background:linear-gradient(135deg,#D6336C,#B02454);display:flex;align-items:center;justify-content:center;margin:0 auto;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#fff;font-size:29px;")}>{icon}</span>
        </div>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;text-align:center;margin-top:15px;line-height:1.15;color:var(--ag-ink);")}>{heading}</div>
        <div style={css('text-align:center;color:var(--ag-muted);font-size:13.5px;margin-top:9px;line-height:1.55;')}>{sub}</div>
        <div style={css('display:flex;flex-direction:column;gap:14px;margin-top:22px;')}>{children}</div>
      </div>
    </div>
  );
}

/**
 * Six-digit input.
 *
 * `inputMode=numeric` rather than `type=number`: a spinner on an auth code is
 * absurd, and iOS shows the same keypad either way. Submits itself on the sixth
 * digit, because nobody wants to reach for a button after typing a code they
 * are already racing a 30-second clock to use.
 */
function CodeField({
  value,
  onChange,
  onComplete,
  disabled,
  label = 'Six-digit code',
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: () => void;
  disabled?: boolean;
  label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  return (
    <label style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
      {label}
      <input
        ref={ref}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        disabled={disabled}
        value={value}
        onChange={(e) => {
          const next = e.target.value.replace(/\D/g, '').slice(0, 6);
          onChange(next);
          if (next.length === 6) onComplete();
        }}
        placeholder="000000"
        style={css('width:100%;margin-top:7px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;padding:0 15px;height:56px;font-size:24px;font-weight:800;letter-spacing:.35em;text-align:center;color:var(--ag-ink);')}
      />
    </label>
  );
}

/** The one-time reveal of the backup codes. There is no second chance to read them. */
function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const toast = useToast();
  const [confirmed, setConfirmed] = useState(false);

  return (
    <Shell
      icon="key"
      heading="Save your backup codes"
      sub="If you lose your phone, one of these gets you back in. Each works once. This is the only time they are shown."
    >
      <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:8px;background:var(--ag-surface-2);border:1px solid var(--ag-border);border-radius:16px;padding:16px;')}>
        {codes.map((code) => (
          <div key={code} style={css("font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:13.5px;font-weight:700;color:var(--ag-ink);letter-spacing:.02em;")}>
            {code}
          </div>
        ))}
      </div>

      <div style={css('display:flex;gap:10px;')}>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(codes.join('\n')).then(
              () => toast('Backup codes copied'),
              () => toast('Could not copy — write them down instead'),
            );
          }}
          style={css('flex:1;height:46px;border:1.5px solid var(--ag-border);border-radius:14px;background:var(--ag-surface);color:var(--ag-ink);font-size:14px;font-weight:700;cursor:pointer;')}
        >
          Copy
        </button>
        <button
          type="button"
          onClick={() => {
            // A file download, not a print dialog: these want to end up in a
            // password manager or a drawer, and a printer is neither.
            const blob = new Blob([`MangaiMart backup codes\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'mangaimart-backup-codes.txt';
            a.click();
            URL.revokeObjectURL(url);
          }}
          style={css('flex:1;height:46px;border:1.5px solid var(--ag-border);border-radius:14px;background:var(--ag-surface);color:var(--ag-ink);font-size:14px;font-weight:700;cursor:pointer;')}
        >
          Download
        </button>
      </div>

      <label style={css('display:flex;gap:10px;align-items:flex-start;font-size:13.5px;color:var(--ag-muted);line-height:1.5;cursor:pointer;')}>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          style={css('margin-top:3px;width:17px;height:17px;accent-color:#D6336C;cursor:pointer;')}
        />
        I have saved these somewhere safe.
      </label>

      <button type="button" disabled={!confirmed} onClick={onDone} style={css(`${PRIMARY}${confirmed ? '' : 'opacity:.5;cursor:not-allowed;'}`)}>
        Continue
      </button>
    </Shell>
  );
}

export function MfaGate({ onVerified }: { onVerified: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<MfaState | 'loading'>('loading');
  const [enrollment, setEnrollment] = useState<EnrollStart | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const load = useCallback(async () => {
    const next = await readMfaState();
    setState(next);
    if (next === 'enroll') {
      try {
        setEnrollment(await startEnrollment());
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Could not start setup');
      }
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  // Guard against a double submit from the auto-submit-on-sixth-digit above
  // racing the user's own click on the button.
  async function submitCode(e?: FormEvent) {
    e?.preventDefault();
    if (busy || code.length !== 6) return;
    setBusy(true);
    try {
      if (state === 'enroll') {
        if (!enrollment) throw new Error('Setup was interrupted. Reload and try again.');
        await verifyChallenge(enrollment.factorId, code);
        // Only now is the session aal2, which is what lets the RPC issue codes.
        setCodes(await generateBackupCodes());
      } else {
        const factorId = await verifiedFactorId();
        if (!factorId) throw new Error('No authenticator is registered on this account.');
        await verifyChallenge(factorId, code);
        // An account with no codes left — every one spent, or reset by an admin —
        // is one lost phone away from a support call. Top it up silently.
        if ((await backupCodesRemaining()) === 0) setCodes(await generateBackupCodes());
        else onVerified();
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That code did not work');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function submitBackupCode(e?: FormEvent) {
    e?.preventDefault();
    if (busy || !backupCode.trim()) return;
    setBusy(true);
    try {
      await redeemBackupCode(backupCode);
      toast('Authenticator cleared — set up a new one now');
      setRecovering(false);
      setBackupCode('');
      setCode('');
      setState('loading');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'That code is not valid');
    } finally {
      setBusy(false);
    }
  }

  if (codes) {
    return <BackupCodes codes={codes} onDone={onVerified} />;
  }

  if (state === 'loading') {
    return (
      <Shell icon="lock" heading="Checking your session" sub="One moment.">
        <div />
      </Shell>
    );
  }

  if (recovering) {
    return (
      <Shell
        icon="key"
        heading="Use a backup code"
        sub="Enter one of the codes you saved when you set up two-factor authentication. It will clear the lost authenticator so you can register a new one."
      >
        <form onSubmit={submitBackupCode} style={css('display:flex;flex-direction:column;gap:14px;')}>
          <label style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
            Backup code
            <input
              value={backupCode}
              onChange={(e) => setBackupCode(e.target.value)}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              style={css("width:100%;margin-top:7px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;padding:0 15px;height:52px;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:15px;font-weight:700;text-align:center;color:var(--ag-ink);")}
            />
          </label>
          <button type="submit" disabled={busy} style={css(`${PRIMARY}${busy ? 'opacity:.6;' : ''}`)}>
            {busy ? 'Checking…' : 'Use this code'}
          </button>
          <div style={css('text-align:center;color:var(--ag-muted);font-size:12.5px;line-height:1.55;')}>
            Out of codes too? An admin can reset two-factor authentication for you from the Users screen.
          </div>
          <button type="button" onClick={() => setRecovering(false)} style={css(`${LINK}text-align:center;`)}>
            Back
          </button>
        </form>
      </Shell>
    );
  }

  if (state === 'enroll') {
    return (
      <Shell
        icon="encrypted"
        heading="Set up two-factor authentication"
        sub="Scan this with Google Authenticator, Authy or your password manager, then enter the six-digit code it shows."
      >
        {enrollment ? (
          <>
            {/* GoTrue returns the QR as an SVG data URL, so there is no QR
                library in the bundle. White plate behind it because a QR on a
                dark background does not scan. */}
            <div style={css('display:flex;justify-content:center;')}>
              <img
                src={enrollment.qrCode}
                alt="Two-factor setup QR code"
                width={188}
                height={188}
                style={css('width:188px;height:188px;background:#fff;border-radius:16px;padding:10px;border:1px solid var(--ag-border);')}
              />
            </div>

            <button type="button" onClick={() => setShowSecret((s) => !s)} style={css(`${LINK}text-align:center;`)}>
              {showSecret ? 'Hide setup key' : 'Can’t scan? Enter a key instead'}
            </button>
            {showSecret && (
              <div style={css("background:var(--ag-surface-2);border:1px solid var(--ag-border);border-radius:12px;padding:12px;font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:13px;font-weight:700;word-break:break-all;text-align:center;color:var(--ag-ink);")}>
                {enrollment.secret}
              </div>
            )}

            <form onSubmit={submitCode} style={css('display:flex;flex-direction:column;gap:14px;')}>
              <CodeField value={code} onChange={setCode} onComplete={() => void submitCode()} disabled={busy} />
              <button type="submit" disabled={busy || code.length !== 6} style={css(`${PRIMARY}${busy || code.length !== 6 ? 'opacity:.5;' : ''}`)}>
                {busy ? 'Verifying…' : 'Turn on two-factor'}
              </button>
            </form>
          </>
        ) : (
          <div style={css('text-align:center;color:var(--ag-muted);font-size:13.5px;')}>Preparing your QR code…</div>
        )}
      </Shell>
    );
  }

  return (
    <Shell
      icon="lock"
      heading="Enter your code"
      sub="Open your authenticator app and enter the six-digit code for MangaiMart."
    >
      <form onSubmit={submitCode} style={css('display:flex;flex-direction:column;gap:14px;')}>
        <CodeField value={code} onChange={setCode} onComplete={() => void submitCode()} disabled={busy} />
        <button type="submit" disabled={busy || code.length !== 6} style={css(`${PRIMARY}${busy || code.length !== 6 ? 'opacity:.5;' : ''}`)}>
          {busy ? 'Verifying…' : 'Unlock'}
        </button>
        <button type="button" onClick={() => setRecovering(true)} style={css(`${LINK}text-align:center;`)}>
          Lost your phone? Use a backup code
        </button>
      </form>
    </Shell>
  );
}
