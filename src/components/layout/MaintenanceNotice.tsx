import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { css } from '@/lib/css';
import { loadSettings, useSettings } from '@/data/settings';

/**
 * The buyer-facing half of Platform Settings → "Maintenance mode".
 *
 * The admin toggle wrote `platform_settings.maintenance_mode` and nothing ever
 * read it, so switching it on changed nothing while the console reported the
 * storefront as down. This is the consumer: a persistent banner across the
 * public surface telling shoppers the shop is being worked on.
 *
 * Deliberately a banner and not a hard block — orders still complete. Taking
 * checkout offline is a bigger decision than a settings toggle should make on
 * the operator's behalf, and a half-finished bag silently failing at Pay is a
 * worse outcome than a clear warning.
 *
 * Operators are exempt: the seller and admin consoles are how you turn it back
 * off, so they never show it.
 */
export function MaintenanceNotice() {
  const { pathname } = useLocation();
  const { maintenance_mode: on } = useSettings();

  // The buyer app loads settings via ShopContext, but the notice also renders on
  // routes outside it — make sure the row is requested either way.
  useEffect(() => { void loadSettings(); }, []);

  const onOperatorSurface = pathname.startsWith('/admin') || pathname.startsWith('/seller');
  if (!on || onOperatorSurface) return null;

  return (
    <div
      role="status"
      style={css(
        'position:sticky;top:0;z-index:80;display:flex;align-items:center;justify-content:center;gap:9px;' +
          'padding:9px 14px;background:#8A5A00;color:#fff;font-size:12.5px;font-weight:700;line-height:1.4;text-align:center;',
      )}
    >
      <span style={css("font-family:'Material Symbols Outlined';font-size:18px;flex:none;")}>engineering</span>
      <span>We’re carrying out maintenance right now — some things may be slower or unavailable.</span>
    </div>
  );
}
