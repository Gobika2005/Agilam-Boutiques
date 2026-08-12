import { useState } from 'react';
import { css } from '@/lib/css';
import { Field } from '@/components/seller/FormKit';
import {
  describeCoords,
  isMapsLink,
  locateShop,
  mapsLinkFromCoords,
  parseMapCoords,
  type LocateFailure,
} from '@/lib/geolocate';
import { verdictForPin, type ExpectedPlace, type PinNote } from '@/lib/pinCheck';

/**
 * The boutique's exact location: one button, one field, and an honest answer
 * about what it found.
 *
 * Shared by the setup wizard's address step and the seller settings screen so
 * there is one implementation of a control that is easy to get quietly wrong.
 *
 * The design problem it solves is not "get a coordinate" — every browser will
 * hand you one instantly. It is that the coordinate a laptop hands you is a
 * Wi-Fi/IP estimate accurate to kilometres, and it looks exactly like a GPS fix.
 * A seller in Oddanchatram tapped the button and got a pin in Chennai, saved it,
 * and nothing anywhere said a word. So:
 *
 *   • `locateShop()` waits for a fix good enough for a shopfront instead of
 *     taking the first one offered (see src/lib/geolocate.ts);
 *   • whatever it settles on is reverse-geocoded and checked against the
 *     address the seller typed (`verdictForPin`, src/lib/pinCheck.ts), and a
 *     mismatch is stated plainly, in place, naming both places — not flashed in
 *     a toast that is gone in three seconds;
 *   • a vague fix is labelled vague, with the reason and what to do instead.
 *
 * It never blocks the save. The seller knows where their own shop is; the job
 * here is to make sure they are told when the pin disagrees with them.
 */

const FAILURE_TEXT: Record<LocateFailure, string> = {
  unsupported:
    'This browser cannot read your location. Open your shop in Google Maps, tap Share → Copy link, and paste it below.',
  insecure:
    'Location only works over a secure (https) connection. Paste a Google Maps link below instead.',
  denied:
    'Location is blocked for this site. Tap the icon at the left of the address bar → Location → Allow, then try again — or paste a Google Maps link below.',
  unavailable:
    'Your device could not get a fix. Switch location on, and try again from outside or near a window — or paste a Google Maps link below.',
  timeout:
    'No location came back in time. Step outside and try again — a phone at the shop gives the best pin — or paste a Google Maps link below.',
};

export function ShopLocationPicker({
  mapUrl, lat, lng, onChange, error, expected, label = 'Google Maps location *',
}: {
  mapUrl: string;
  lat: string;
  lng: string;
  onChange: (next: { mapUrl: string; lat: string; lng: string }) => void;
  error?: string;
  /** The typed address, used to sanity-check the pin. */
  expected?: ExpectedPlace;
  label?: string;
}) {
  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<PinNote | null>(null);

  const locate = async () => {
    setLocating(true);
    setNote(null);
    try {
      const fix = await locateShop();
      if (!fix.ok) {
        setNote({ tone: 'bad', text: FAILURE_TEXT[fix.reason] });
        return;
      }
      onChange({
        mapUrl: mapsLinkFromCoords(fix.lat, fix.lng),
        lat: String(fix.lat),
        lng: String(fix.lng),
      });
      // Saved first, verified second: the pin is the seller's to keep either
      // way, and the check is advice about it, not a gate on it.
      const place = await describeCoords(fix.lat, fix.lng);
      setNote(verdictForPin(place, expected, fix.accuracyM));
    } finally {
      setLocating(false);
    }
  };

  /** A pasted link may carry coordinates (`?q=`, `@lat,lng`); keep them if so,
   *  and drop any pin we had if it does not — stale coordinates under a new
   *  link would claim a precision the link does not have. */
  const setUrl = (v: string) => {
    const c = parseMapCoords(v);
    onChange({ mapUrl: v, lat: c ? String(c.lat) : '', lng: c ? String(c.lng) : '' });
    setNote(null);
  };

  const noteColor = note?.tone === 'bad'
    ? 'var(--ag-danger-text)'
    : note?.tone === 'warn'
      ? 'var(--ag-gold-text)'
      : 'var(--ag-good)';

  return (
    <>
      <button
        type="button"
        onClick={locate}
        disabled={locating}
        style={css(`align-self:flex-start;display:inline-flex;align-items:center;gap:8px;padding:11px 15px;border-radius:13px;border:1.5px solid #D6336C;background:var(--ag-surface-2);color:var(--ag-crimson);font-weight:800;font-size:13px;cursor:${locating ? 'default' : 'pointer'};opacity:${locating ? 0.65 : 1};font-family:inherit;`)}
      >
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>
          {locating ? 'progress_activity' : 'my_location'}
        </span>
        {locating ? 'Finding your shop…' : 'Use my current location'}
      </button>
      {/* Says why it is taking time, so a fix that takes eight seconds does not
          read as a dead button and get tapped again. */}
      {locating && (
        <span style={css('font-size:11.5px;font-weight:600;color:var(--ag-muted);margin-top:-6px;')}>
          Waiting for an accurate fix — this takes a few seconds, and works best on a phone at the shop.
        </span>
      )}

      <Field
        label={label}
        value={mapUrl}
        onChange={setUrl}
        placeholder="https://maps.app.goo.gl/…"
        inputMode="url"
        error={error}
        hint="Stand in your shop and tap the button above, or open the shop in Google Maps → Share → Copy link."
      />

      {note && (
        <span
          // Assertive: this can be the difference between a courier finding the
          // shop and not, and it appears after an action the seller took.
          role="status"
          style={css(`display:flex;gap:6px;font-size:11.5px;font-weight:700;color:${noteColor};line-height:1.55;margin-top:-6px;`)}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;flex:none;")}>
            {note.tone === 'good' ? 'check_circle' : note.tone === 'warn' ? 'info' : 'error'}
          </span>
          {note.text}
        </span>
      )}

      {mapUrl.trim() && isMapsLink(mapUrl) && (
        <a
          href={mapUrl.trim()}
          target="_blank"
          rel="noreferrer noopener"
          style={css('display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:800;color:var(--ag-crimson);text-decoration:none;margin-top:-6px;')}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>open_in_new</span>
          {lat && lng ? `Check the pin (${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)})` : 'Check this opens at your shop'}
        </a>
      )}
    </>
  );
}
