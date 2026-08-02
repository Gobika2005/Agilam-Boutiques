import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { AuthModal } from '@/components/auth/AuthModal';
import { useToast } from '@/components/ui/Toast';

/**
 * "Verify your number" artboard from the design, shown in the shared auth popup.
 *
 * The app authenticates with Supabase email/password — there is no phone/OTP
 * backend — so this screen is presentational: it cannot create a session, and
 * the real sign-in paths do not route through it. Wire it to Supabase phone
 * auth before putting it in a live flow.
 */
export function Otp() {
  const navigate = useNavigate();
  const { role = 'buyer' } = useParams();
  const toast = useToast();
  const [digits, setDigits] = useState(['4', '9', '', '', '', '']);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  const setDigit = (i: number, v: string) => {
    const d = v.replace(/\D/g, '').slice(-1);
    setDigits((prev) => prev.map((x, j) => (j === i ? d : x)));
    if (d && i < 5) inputs.current[i + 1]?.focus();
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus();
  };

  const filled = digits.every(Boolean);

  return (
    <AuthModal
      icon="sms"
      heading="Verify your number"
      sub="Enter the 6-digit code sent to +91 98765 43210"
      onBack={() => navigate(`/auth/signin/${role}`)}
    >
      {/* Six boxes are one field to a sighted user and six anonymous text inputs
          to a screen reader, which announced each as "edit, blank" with nothing
          to say which of the six it was. The group carries the instruction; each
          box says its own position. */}
      <div role="group" aria-label="6-digit verification code" style={css('display:flex;gap:10px;justify-content:center;')}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { inputs.current[i] = el; }}
            value={d}
            onChange={(e) => setDigit(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            maxLength={1}
            inputMode="numeric"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            aria-label={`Digit ${i + 1} of 6`}
            style={css(`width:48px;height:58px;text-align:center;font-size:24px;font-weight:800;border:1.5px solid ${d ? '#D6336C' : 'var(--ag-border)'};background:var(--ag-surface);border-radius:14px;color:var(--ag-ink);`)}
          />
        ))}
      </div>

      <button
        onClick={() => toast(filled ? 'Phone verification is not wired up yet' : 'Enter all 6 digits')}
        style={css('width:100%;height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);')}
      >
        Verify &amp; Continue
      </button>

      <div style={css('text-align:center;font-size:14px;color:var(--ag-muted);')}>
        Didn&apos;t get the code? <a href="#" onClick={(e) => { e.preventDefault(); toast('Code resent'); }} style={css('font-weight:700;')}>Resend</a>
      </div>
    </AuthModal>
  );
}
