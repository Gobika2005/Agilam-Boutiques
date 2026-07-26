import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { css } from '@/lib/css';

/**
 * A gentle "we're still building" notice for the public storefront.
 *
 * Agilam is live but not officially launched, so first-time visitors get a small
 * slide-in card telling them the site is a preview and the real launch is coming.
 * It's deliberately low-key: bottom-left (the floating cart bag owns bottom-right),
 * dismissible for this visit — not persisted, so it shows again on refresh.
 *
 * Only shown on the public buyer surface — the seller and admin consoles are for
 * operators who already know the site's status, so they never see it.
 */

const NOTICE_MESSAGES = [
  "🚧 Developer Request: Konjam porumai... innum build pannitu irukom. Bug kanda screenshot anuppunga, developer-a illa. 😂🏗️",
  "👨‍💻 Dear Tester: Developer ah disturb pannadheenga... code compile aagitu iruku. Konjam wait pannunga! 😅",
  "😂 Heads Up: Idhu production illa boss... testing ground! Edhavadhu odanja, adhu expected dhaan. 🏗️",
  "🚀 Welcome Tester! Features innum cooking... bugs taste pannadheenga. 🤣",
  "⚠️ Tester-ku Oru Request: Button ellathayum ore time-la click pannadheenga... developer heart attack vandhudum. 😂",
  "🥱 Friendly Reminder: Dummy products dhaan. Order pannadheenga... developer-ku unnecessary tension kudukadheenga. 😆",
  "👷 Site Under Construction: Developer coffee kudichitu build pannitu irukaru. Konjam support pannunga. ☕🏗️",
  "🐞 Bug Notice: Bug paatha bayapadadheenga... adha dhaan neenga kandupidikka vandhurukeenga. 😂",
];

function pickMessage() {
  return NOTICE_MESSAGES[Math.floor(Math.random() * NOTICE_MESSAGES.length)];
}

export function LaunchNotice() {
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [message] = useState(pickMessage);

  // Operator consoles and the bare auth/landing routes don't need the notice.
  const onOperatorSurface = pathname.startsWith('/admin') || pathname.startsWith('/seller');
  if (dismissed || onOperatorSurface) return null;

  const close = () => setDismissed(true);

  return (
    <div
      role="status"
      style={css(
        'position:fixed;left:16px;bottom:16px;z-index:70;max-width:min(340px,calc(100vw - 32px));' +
          'display:flex;gap:12px;padding:14px 14px 14px 16px;border-radius:16px;' +
          'background:rgba(42,26,32,.96);backdrop-filter:blur(12px);color:#fff;' +
          'box-shadow:0 22px 48px -18px rgba(0,0,0,.65);animation:agx-fade .35s ease;',
      )}
    >
      <span
        style={css(
          "font-family:'Material Symbols Outlined';font-size:24px;color:#F7B7CF;flex:none;line-height:1.1;",
        )}
      >
        rocket_launch
      </span>
      <div style={css('min-width:0;')}>
        <div style={css('font-size:13.5px;font-weight:800;letter-spacing:.2px;')}>Launching soon</div>
        <div style={css('font-size:12.5px;line-height:1.5;color:rgba(255,255,255,.82);margin-top:3px;')}>
          {message}
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={close}
        style={css(
          'flex:none;align-self:flex-start;display:flex;align-items:center;justify-content:center;' +
            'width:28px;height:28px;border:none;cursor:pointer;border-radius:50%;background:transparent;color:rgba(255,255,255,.6);',
        )}
      >
        <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>close</span>
      </button>
    </div>
  );
}
