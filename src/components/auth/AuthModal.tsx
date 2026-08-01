import { useState, type ReactNode } from 'react';
import { css } from '@/lib/css';
import { Home } from '@/pages/buyer/Home';

/**
 * Shared auth popup panel — the same centred white card as the
 * "Are you a Boutique Owner?" sheet (see SellModal), reused across every auth
 * screen (sign in, create account, OTP) so they read as one consistent popup.
 *
 * The auth screens are their own routes (the buyer app isn't mounted behind
 * them), so we render a blurred, inert copy of the buyer home as the backdrop.
 * That gives the card the same "popup floating over a blurred screen" feel as
 * the in-app sheets, instead of sitting on a flat colour.
 */
export function AuthModal({
  icon = 'storefront',
  heading,
  sub,
  onBack,
  children,
}: {
  icon?: string;
  heading: string;
  sub: string;
  onBack?: () => void;
  children: ReactNode;
}) {
  return (
    <div style={css('position:fixed;inset:0;z-index:50;overflow:hidden;')}>
      {/* Blurred, non-interactive app backdrop. */}
      <div aria-hidden style={css('position:absolute;inset:0;background:var(--ag-bg);pointer-events:none;overflow:hidden;')}>
        <div className="agx-app agx-app-main" style={css('padding:16px 18px 128px;filter:blur(11px) saturate(1.02);opacity:.85;transform:scale(1.04);transform-origin:top center;')}>
          <Home />
        </div>
      </div>
      {/* Frosted scrim over the backdrop. */}
      <div style={css('position:absolute;inset:0;background:rgba(251,241,245,.5);backdrop-filter:blur(3px);')} />

      <div style={css('position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;')}>
      <div style={css('width:100%;max-width:460px;background:var(--ag-surface);border-radius:28px;padding:22px 26px 30px;box-shadow:0 30px 80px -30px rgba(107,20,54,.6);border:1px solid var(--ag-border);margin:auto;position:relative;')}>
        {onBack && (
          <button
            onClick={onBack}
            style={css('border:none;background:var(--ag-surface-2);width:40px;height:40px;border-radius:12px;cursor:pointer;display:flex;align-items:center;justify-content:center;')}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
          </button>
        )}

        <div style={css('width:58px;height:58px;border-radius:18px;background:linear-gradient(135deg,#D6336C,#B02454);display:flex;align-items:center;justify-content:center;margin:14px auto 0;box-shadow:0 16px 34px -16px rgba(214,51,108,.8);')}>
          <span style={css("font-family:'Material Symbols Outlined';color:#fff;font-size:30px;")}>{icon}</span>
        </div>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;text-align:center;margin-top:16px;line-height:1.1;")}>{heading}</div>
        <div style={css('text-align:center;color:var(--ag-muted);font-size:14px;margin-top:9px;line-height:1.55;max-width:340px;margin-left:auto;margin-right:auto;')}>{sub}</div>

        <div style={css('display:flex;flex-direction:column;gap:15px;margin-top:22px;')}>{children}</div>
      </div>
      </div>
    </div>
  );
}

/** Password field with the design's inline visibility toggle. */
export function PasswordField({ value, onChange, label = 'Password', autoComplete = 'current-password', name = 'password' }: { value: string; onChange: (v: string) => void; label?: string; autoComplete?: string; name?: string }) {
  const [show, setShow] = useState(false);
  return (
    <label style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
      {label}
      <div style={css('display:flex;align-items:center;gap:8px;margin-top:7px;background:var(--ag-surface);border:1.5px solid var(--ag-border);border-radius:14px;padding:0 15px;height:52px;')}>
        <input
          type={show ? 'text' : 'password'}
          name={name}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={css('border:none;background:none;flex:1;font-size:15px;font-weight:600;color:var(--ag-ink);min-width:0;')}
        />
        <span onClick={() => setShow((s) => !s)} style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);cursor:pointer;")}>
          {show ? 'visibility' : 'visibility_off'}
        </span>
      </div>
    </label>
  );
}
