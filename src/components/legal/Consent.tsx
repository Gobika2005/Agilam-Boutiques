import { css } from '@/lib/css';

/**
 * Shared legal-consent UI for Terms & Conditions + Privacy Policy acceptance.
 *
 * Two variants, one source of truth for the link targets:
 *  - <ConsentCheckbox> — a required, unchecked-by-default tickbox that must gate
 *    the primary action on every account/shop *creation* surface. Explicit
 *    opt-in (never pre-ticked) is what the DPDP Act 2023 expects.
 *  - <ConsentNotice> — a passive "By continuing you agree to…" clickwrap line for
 *    pure sign-in surfaces and one-tap providers (Google / email code), where a
 *    checkbox on every returning sign-in would be hostile.
 *
 * The policy pages open in a new tab so a half-filled signup/onboarding form is
 * never destroyed by navigating away.
 */

const TERMS_HREF = '/buyer/policy/terms';
const PRIVACY_HREF = '/buyer/policy/privacy-policy';

/** The two linked policy names, shared by both variants. Exported so callers
 * with bespoke wording (e.g. a seller agreement) reuse the same link targets. */
export function PolicyLinks({ color = 'var(--ag-crimson)' }: { color?: string }) {
  const link = css(`font-weight:800;color:${color};text-decoration:underline;`);
  return (
    <>
      <a href={TERMS_HREF} target="_blank" rel="noopener noreferrer" style={link}>Terms &amp; Conditions</a>
      {' '}and{' '}
      <a href={PRIVACY_HREF} target="_blank" rel="noopener noreferrer" style={link}>Privacy Policy</a>
    </>
  );
}

export function ConsentCheckbox({
  checked,
  onChange,
  /** Overrides the default lead-in — e.g. the Seller Agreement wording. */
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <label style={css('display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:12.5px;line-height:1.55;color:var(--ag-label);font-weight:600;')}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={css('width:18px;height:18px;flex:none;margin-top:1px;accent-color:#D6336C;cursor:pointer;')}
      />
      <span style={css('flex:1;')}>
        {children ?? (<>I agree to the <PolicyLinks />.</>)}
      </span>
    </label>
  );
}

export function ConsentNotice({ align = 'center' }: { align?: 'center' | 'left' }) {
  return (
    <div style={css(`text-align:${align};font-size:12px;line-height:1.55;color:#9A8088;font-weight:600;`)}>
      By continuing, you agree to our <PolicyLinks />.
    </div>
  );
}

/** Reusable message when a required checkbox is left unticked. */
export const CONSENT_REQUIRED = 'Please accept the Terms & Conditions and Privacy Policy to continue';
