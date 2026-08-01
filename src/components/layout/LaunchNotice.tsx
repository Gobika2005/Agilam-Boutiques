import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { css } from '@/lib/css';

/**
 * A quiet "we're new" note for the public storefront.
 *
 * This used to rotate 32 in-joke messages ("Tester Alert: you're a QA team
 * member and didn't know it", "crash aana refresh pannunga") at every visitor,
 * on every page, forever — the first thing a stranger read was that the site
 * was unfinished and that they were unpaid QA. On a shop asking for ₹2,000 and
 * a cash-on-delivery address, that spends exactly the trust the design earns.
 *
 * What it does now:
 *   • one calm line, in the shop's own voice
 *   • dismissed for good, not for one page view — the card no longer reappears
 *     on every navigation and refresh
 *   • retires itself after a few seconds even if untouched, so it can never sit
 *     permanently on top of a section heading or the PDP's carousel dots
 *   • a 44px close target, per WCAG 2.5.5 — the old one was 28px
 *
 * Only shown on the public buyer surface — operators already know the status.
 */

const SEEN_KEY = 'agx:launch-notice-seen';
/** Long enough to read twice, short enough never to become furniture. */
const AUTO_HIDE_MS = 9000;

export function LaunchNotice() {
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      return false;
    }
  });

  const onOperatorSurface = pathname.startsWith('/admin') || pathname.startsWith('/seller');
  const hidden = dismissed || onOperatorSurface;

  // Retire on its own. Without this the card is a permanent overlay for anyone
  // who never presses the ×, which is how it ended up covering "Shop by
  // collection" on Home and the image-carousel dots on a product page.
  useEffect(() => {
    if (hidden) return;
    const t = window.setTimeout(() => setDismissed(true), AUTO_HIDE_MS);
    return () => window.clearTimeout(t);
  }, [hidden]);

  if (hidden) return null;

  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* private mode — it will simply auto-hide instead */
    }
  };

  return (
    <div
      role="status"
      className="agx-launch-notice"
      style={css(
        'position:fixed;left:16px;bottom:16px;z-index:70;max-width:min(340px,calc(100vw - 32px));' +
          'display:flex;gap:12px;padding:14px 8px 14px 16px;border-radius:16px;' +
          'background:rgba(42,26,32,.96);backdrop-filter:blur(12px);color:#fff;' +
          'box-shadow:0 22px 48px -18px rgba(0,0,0,.65);animation:agx-fade .35s ease;',
      )}
    >
      <span
        style={css(
          "font-family:'Material Symbols Outlined';font-size:24px;color:#F7B7CF;flex:none;line-height:1.1;",
        )}
      >
        auto_awesome
      </span>
      <div style={css('min-width:0;')}>
        <div style={css('font-size:13.5px;font-weight:800;letter-spacing:.2px;')}>Newly opened</div>
        <div style={css('font-size:12.5px;line-height:1.5;color:rgba(255,255,255,.82);margin-top:3px;')}>
          We’re a new marketplace for Tamil Nadu’s boutiques, and more shops are joining every week.
          Thank you for being early.
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss this notice"
        onClick={close}
        style={css(
          'flex:none;align-self:flex-start;display:flex;align-items:center;justify-content:center;' +
            'width:44px;height:44px;margin:-8px 0 0;border:none;cursor:pointer;border-radius:50%;' +
            'background:transparent;color:rgba(255,255,255,.6);',
        )}
      >
        <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")} aria-hidden="true">close</span>
      </button>
    </div>
  );
}
