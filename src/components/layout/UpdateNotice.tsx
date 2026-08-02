import { useEffect, useRef, useState } from 'react';
import { css } from '@/lib/css';
import { isUpdateAvailable } from '@/lib/appUpdate';
import { canRefreshNow, onRevalidate } from '@/lib/liveRefresh';

/** Don't ask the server about deploys more than this often. */
const CHECK_EVERY_MS = 10 * 60_000;
/** After "not now", stay quiet this long. */
const SNOOZE_MS = 30 * 60_000;
/**
 * How long the tab must have been in the background before a returning user is
 * reloaded onto the new build without being asked. Coming back to an app after
 * five minutes away already looks like a fresh start, so swapping the build in
 * at that moment costs the user nothing — nothing is half-typed, nothing is
 * mid-scroll, and cart/wishlist live in storage that survives the reload.
 */
const AWAY_LONG_ENOUGH_MS = 5 * 60_000;

/**
 * Tells the user, once and quietly, that a newer version of the site is live.
 *
 * Deliberately not a modal and never a surprise reload: it's a slim bar under
 * the header with a Refresh button, and it waits for them. The one case it acts
 * on its own is a tab that's been in the background long enough that a reload
 * is invisible.
 */
export function UpdateNotice() {
  const [ready, setReady] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  const lastCheck = useRef(0);
  const hiddenSince = useRef(0);

  // A snooze expires on its own, so the offer comes back later in the session
  // rather than being lost until the next reload.
  useEffect(() => {
    if (!snoozed) return;
    const t = setTimeout(() => setSnoozed(false), SNOOZE_MS);
    return () => clearTimeout(t);
  }, [snoozed]);

  // Poll for a new deploy on the shared schedule — so this rides the same
  // "tab is visible, user isn't typing" gate as every other refresh.
  useEffect(() => {
    const controller = new AbortController();

    const check = () => {
      if (ready) return;
      if (Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
      lastCheck.current = Date.now();
      void isUpdateAvailable(controller.signal).then((available) => {
        if (available && !controller.signal.aborted) setReady(true);
      });
    };

    // One check shortly after boot catches the user who opened a tab that had
    // been sitting in the background since before the deploy.
    const initial = setTimeout(check, 15_000);
    const unsubscribe = onRevalidate(check);

    return () => {
      clearTimeout(initial);
      unsubscribe();
      controller.abort();
    };
  }, [ready]);

  // Track how long the tab has been away, and take the free reload if the user
  // comes back after a long absence with an update pending.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSince.current = Date.now();
        return;
      }
      const away = hiddenSince.current ? Date.now() - hiddenSince.current : 0;
      hiddenSince.current = 0;
      if (ready && away > AWAY_LONG_ENOUGH_MS && canRefreshNow()) window.location.reload();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [ready]);

  if (!ready || snoozed) return null;

  return (
    <div
      role="status"
      style={css(
        'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:80;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 24px);padding:9px 10px 9px 16px;border-radius:999px;background:rgba(42,26,32,.94);backdrop-filter:blur(12px);color:#fff;font-size:13px;font-weight:600;box-shadow:0 18px 40px -16px rgba(0,0,0,.6);animation:agx-fade .3s ease;',
      )}
    >
      <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;color:#F7B7CF;")}>auto_awesome</span>
      <span style={css('white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>A new version of MangaiMart is ready</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={css('flex:none;border:none;cursor:pointer;padding:7px 15px;border-radius:999px;background:linear-gradient(140deg,#C62A60,#B02454 70%);color:#fff;font-family:inherit;font-size:13px;font-weight:700;')}
      >
        Refresh
      </button>
      <button
        type="button"
        aria-label="Not now"
        onClick={() => setSnoozed(true)}
        style={css('flex:none;display:flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;cursor:pointer;border-radius:50%;background:transparent;color:rgba(255,255,255,.65);')}
      >
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>close</span>
      </button>
    </div>
  );
}
