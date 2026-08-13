import { useState } from 'react';
import { css } from '@/lib/css';
import { Field } from '@/components/seller/FormKit';
import { describeCoords, isMapsLink, parseMapCoords } from '@/lib/geolocate';
import { verdictForPin, type ExpectedPlace, type PinNote } from '@/lib/pinCheck';

/**
 * The boutique's exact location: the seller's own Google Maps link, pasted.
 *
 * Shared by the setup wizard's address step and the seller settings screen so
 * there is one implementation.
 *
 * There was a "use my current location" button here, and removing it is the
 * point of this version. Reading the device position looked like the strongest
 * way to pin a shopfront and was the weakest: a laptop answers from Wi-Fi,
 * accurate to kilometres, and the result is indistinguishable in the API from a
 * GPS fix. A seller in Oddanchatram tapped it, got a pin in Chennai 400km away,
 * and saved it. A link the seller picked in Google Maps — looking at their own
 * shopfront on the map — is a deliberate act rather than a guess, and it is the
 * one thing every shop owner can already produce.
 *
 * What survives from that work is the sanity check: when a pasted link carries
 * coordinates, they are reverse-geocoded and compared against the address the
 * seller typed, and a mismatch is stated plainly, in place, naming both places.
 * A shortened `maps.app.goo.gl` link carries no coordinates — then there is
 * nothing to check and the link is simply saved. It never blocks the save.
 */

export function ShopLocationPicker({
  mapUrl, lat, lng, onChange, error, expected, label = 'Google Maps location *',
}: {
  mapUrl: string;
  lat: string;
  lng: string;
  onChange: (next: { mapUrl: string; lat: string; lng: string }) => void;
  error?: string;
  /** The typed address, used to sanity-check a link that carries a pin. */
  expected?: ExpectedPlace;
  label?: string;
}) {
  const [note, setNote] = useState<PinNote | null>(null);

  /**
   * A pasted link may carry coordinates (`?q=`, `@lat,lng`); keep them when it
   * does and drop any we had when it does not — stale coordinates under a new
   * link would claim a precision the link has not got.
   */
  const setUrl = (v: string) => {
    const c = parseMapCoords(v);
    onChange({ mapUrl: v, lat: c ? String(c.lat) : '', lng: c ? String(c.lng) : '' });
    setNote(null);
    if (!c || !isMapsLink(v)) return;
    // Checked after the value is committed, never before: the link is the
    // seller's to keep either way, and this is advice about it, not a gate.
    void describeCoords(c.lat, c.lng).then((place) => {
      // Ignore a late answer for a link the seller has already replaced.
      setNote((prev) => (prev === null ? verdictForPin(place, expected) : prev));
    });
  };

  const noteColor = note?.tone === 'bad'
    ? 'var(--ag-danger-text)'
    : note?.tone === 'warn'
      ? 'var(--ag-gold-text)'
      : 'var(--ag-good)';

  return (
    <>
      <Field
        label={label}
        value={mapUrl}
        onChange={setUrl}
        placeholder="https://maps.app.goo.gl/…"
        inputMode="url"
        error={error}
        hint="Open your shop in the Google Maps app → tap Share → Copy link, and paste it here."
      />

      {note && (
        <span
          role="status"
          style={css(`display:flex;gap:6px;font-size:11.5px;font-weight:700;color:${noteColor};line-height:1.55;margin-top:-6px;`)}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;flex:none;")}>
            {note.tone === 'good' ? 'check_circle' : note.tone === 'warn' ? 'info' : 'error'}
          </span>
          {note.text}
        </span>
      )}

      {/* Opening the link is the only way to actually confirm it, so it is one
          tap away rather than something the seller has to copy back out. */}
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
