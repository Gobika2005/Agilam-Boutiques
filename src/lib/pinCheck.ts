import { type PlaceAtCoords } from '@/lib/geolocate';
import { namesAgree } from '@/lib/nameMatch';

/**
 * Deciding whether a map link can plausibly point at the shop the seller
 * described.
 *
 * Pure, and kept out of the component that renders it so the rules can be read
 * — and exercised — on their own. The wording lives here too: the severity and
 * the sentence are one decision, and splitting them is how you end up with a
 * red icon over reassuring text.
 *
 * This only ever runs on a link that CARRIES coordinates (`?q=12.9,80.2`,
 * `@12.9,80.2`). A shortened `maps.app.goo.gl` link carries none, and then there
 * is nothing to check — the link is simply saved. Best-effort by design: the
 * check catches the obvious mistake, it does not gate the save.
 */

/** The address the seller typed, which the pin is checked against. */
export type ExpectedPlace = {
  pincode?: string;
  city?: string;
  district?: string;
  state?: string;
};

export type PinNote = { tone: 'good' | 'warn' | 'bad'; text: string };

/**
 * What to tell the seller about the link they just pasted.
 *
 * Built around what this geocoder actually answers with in India, which is not
 * what you would guess: `postcode` comes back EMPTY for Indian coordinates, so
 * comparing it against the typed pincode — the obvious check, and the first one
 * written here — would have quietly never fired. The signals that do arrive are
 * the locality, the town and the state, so those are what this leans on, and
 * the pincode is used only on the rare point that carries one.
 *
 * The severity ladder puts the unambiguous mistakes in red and the ambiguous
 * ones in amber. A different state or country cannot be a near-miss. A different
 * TOWN often can: a hamlet is routinely filed under the nearest taluk town, and
 * a false "this is not your town" on a correct link is worse than no check at
 * all — so that one asks rather than accuses.
 */
export function verdictForPin(
  place: PlaceAtCoords | null,
  expected: ExpectedPlace | undefined,
): PinNote {
  if (!place) {
    return {
      tone: 'good',
      text: 'Link saved. Open it once to make sure it lands on your shop.',
    };
  }

  const where = [place.locality, place.city, place.state].filter(Boolean).join(', ') || 'an unknown area';
  const typedWhere = [expected?.city, expected?.district].filter(Boolean).join(', ');

  if (place.countryCode && place.countryCode !== 'IN') {
    return {
      tone: 'bad',
      text: `This link points at ${where} (${place.countryCode}), outside India — that is not your shop. Open your shop in Google Maps and copy the link from there.`,
    };
  }

  if (expected?.state && place.state && !namesAgree(expected.state, place.state)) {
    return {
      tone: 'bad',
      text: `This link points at ${where} — but your address says ${expected.state}. Open your own shop in Google Maps and copy that link instead.`,
    };
  }

  const typedPlaces = [expected?.city, expected?.district].filter(Boolean) as string[];
  const foundPlaces = [place.locality, place.city].filter(Boolean);
  const namesDisagree =
    typedPlaces.length > 0 &&
    foundPlaces.length > 0 &&
    !typedPlaces.some((t) => foundPlaces.some((f) => namesAgree(t, f)));

  if (namesDisagree) {
    return {
      tone: 'warn',
      text: `This link points at ${where}, which does not look like ${typedWhere}. Open it and check it lands on your shop.`,
    };
  }

  // Only reached where the geocoder gave a postcode at all — uncommon in India.
  const typedPin = (expected?.pincode ?? '').replace(/\D/g, '');
  const foundPin = (place.postcode ?? '').replace(/\D/g, '');
  if (typedPin.length === 6 && foundPin.length === 6 && typedPin !== foundPin) {
    return {
      tone: 'warn',
      text: `Points at ${where}, but under pincode ${foundPin} rather than the ${typedPin} you entered. Fine if your shop is near the boundary — otherwise check it.`,
    };
  }

  return { tone: 'good', text: `Points at ${where} — matches the address you entered.` };
}
