import { css } from '@/lib/css';
import { useTheme, type Theme } from '@/state/ThemeContext';

/**
 * Appearance switch — a two-segment Light / Dark control wired to ThemeContext.
 * Styled entirely with the `--ag-*` token layer so it looks right in either
 * theme. Used on the buyer, seller and admin account/settings screens.
 *
 * `variant="card"` renders a titled panel (buyer Profile); `variant="inline"`
 * renders just the segmented control for embedding in an existing settings row.
 */
function Segment({ value, label, icon }: { value: Theme; label: string; icon: string }) {
  const { theme, setTheme } = useTheme();
  const active = theme === value;
  return (
    <button
      onClick={() => setTheme(value)}
      aria-pressed={active}
      style={css(
        `flex:1;display:flex;align-items:center;justify-content:center;gap:7px;padding:10px 12px;border:none;cursor:pointer;border-radius:12px;font-family:inherit;font-weight:800;font-size:13.5px;transition:background .25s ease,color .25s ease,box-shadow .25s ease;background:${
          active ? 'linear-gradient(135deg,#E14A7E,#B02454 70%,#8E1C44)' : 'transparent'
        };color:${active ? '#fff' : 'var(--ag-muted)'};box-shadow:${
          active ? '0 1px 0 rgba(255,255,255,.3) inset,0 10px 22px -12px rgba(176,36,84,.9)' : 'none'
        };`,
      )}
    >
      <span style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>{icon}</span>
      {label}
    </button>
  );
}

function Control() {
  return (
    <div style={css('display:flex;gap:4px;background:var(--ag-surface-2);border:1px solid var(--ag-border-soft);border-radius:15px;padding:4px;')}>
      <Segment value="light" label="Light" icon="light_mode" />
      <Segment value="dark" label="Dark" icon="dark_mode" />
    </div>
  );
}

export function ThemeToggle({ variant = 'card' }: { variant?: 'card' | 'inline' }) {
  if (variant === 'inline') return <Control />;
  return (
    <>
      <div className="agx-eyebrow" style={css('font-size:9.5px;color:var(--ag-muted);margin:20px 26px 8px;')}>Appearance</div>
      <div style={css('margin:0 20px;background:var(--ag-surface);border-radius:20px;padding:14px;box-shadow:0 12px 30px -22px var(--ag-shadow);')}>
        <div style={css('display:flex;align-items:center;gap:13px;margin-bottom:12px;')}>
          <span style={css('width:40px;height:40px;flex:none;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
            <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:21px;")}>contrast</span>
          </span>
          <span style={css('flex:1;min-width:0;')}>
            <span style={css('display:block;font-weight:800;font-size:14.5px;color:var(--ag-ink);')}>Theme</span>
            <span style={css('display:block;font-size:12px;color:var(--ag-muted);margin-top:1px;')}>Dark is easy on the eyes at night</span>
          </span>
        </div>
        <Control />
      </div>
    </>
  );
}
