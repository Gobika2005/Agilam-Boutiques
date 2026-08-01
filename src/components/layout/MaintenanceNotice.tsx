import { useEffect, useRef } from 'react';
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
  const ref = useRef<HTMLDivElement>(null);

  // The buyer app loads settings via ShopContext, but the notice also renders on
  // routes outside it — make sure the row is requested either way.
  useEffect(() => { void loadSettings(); }, []);

  const onOperatorSurface = pathname.startsWith('/admin') || pathname.startsWith('/seller');
  const visible = on && !onOperatorSurface;

  /**
   * Publish the banner's height as `--ag-banner-h`.
   *
   * This banner is in the normal document flow, which a full-screen
   * `position:fixed` surface knows nothing about — so on the chat it painted
   * over the header (banner z-index 80, chat 40) and the height it added to the
   * document pushed the composer past the bottom of the viewport. Surfaces that
   * cover the screen reserve this height at the top instead; see
   * `.agx-chat-root` in index.css.
   *
   * Measured rather than hard-coded because the sentence wraps to two lines on
   * a narrow screen, which is exactly where the overlap hurt most.
   */
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!visible || !el) {
      root.style.removeProperty('--ag-banner-h');
      return;
    }
    const publish = () => root.style.setProperty('--ag-banner-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    publish();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publish) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty('--ag-banner-h');
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      ref={ref}
      role="status"
      className="agx-maintenance-notice"
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
