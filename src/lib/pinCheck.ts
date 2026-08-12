import { VAGUE_ACCURACY_M, type PlaceAtCoords } from '@/lib/geolocate';

/**
 * Deciding whether a map pin can plausibly be the shop the seller described.
 *
 * Pure, and kept out of the component that renders it so the rules can be read
 * — and exercised — on their own. The wording lives here too: the severity and
 * the sentence are one decision, and splitting them is how you end up with a
 * red icon over reassuring text.
 */

/** The address the seller typed, which the pin is checked against. */
export type ExpectedPlace = {
  pincode?: string;
  city?: string;
  district?: string;
  state?: string;
};

export type PinNote = { tone: 'good' | 'warn' | 'bad'; text: string };

const nameKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** Edit distance, capped — only used on short place names. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[n];
}

/**
 * Do two place names refer to the same place?
 *
 * Deliberately forgiving, because the two sides are transliterations of a Tamil
 * name typed by different people: the seller writes "Oddanchatram", the
 * geocoder answers "Oddanchathiram". Exact and substring matching both miss
 * that — one silent letter — and a false "this is not your town" on a correct
 * pin is worse than no check at all. Two edits of slack covers the usual
 * th/t, aa/a and -ur/-oor variations without letting Chennai match Coimbatore.
 */
function namesAgree(a: string, b: string): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return Math.min(x.length, y.length) >= 6 && editDistance(x, y) <= 2;
}

/**
 * What to tell the seller about the pin we just took.
 *
 * Built around what this geocoder actually answers with in India, which is not
 * what you would guess: `postcode` comes back EMPTY for Indian coordinates, so
 * comparing it against the typed pincode — the obvious check, and the first one
 * written here — would have quietly never fired. The signals that do arrive are
 * the locality, the town and the state, so those are what this leans on, and
 * the pincode is used only on the rare point that carries one.
 *
 * The severity ladder is chosen so a false alarm is cheap and a real one is
 * loud. A wrong town on a WIDE fix is the Wi-Fi-estimate fingerprint — the
 * seller is at home on a laptop, hundreds of kilometres from the shop — and is
 * reported in red. A wrong town on a TIGHT fix is more likely a hamlet the
 * geocoder files under the nearest taluk town, so it asks rather than accuses.
 * Nothing here blocks the save: the seller knows where their shop is.
 */
export function verdictForPin(
  place: PlaceAtCoords | null,
  expected: ExpectedPlace | undefined,
  accuracyM: number,
): PinNote {
  const vague = accuracyM > VAGUE_ACCURACY_M;
  const accuracyText = accuracyM >= 1000 ? `${(accuracyM / 1000).toFixed(1)} km` : `${accuracyM} m`;
  const vagueLine =
    ` The fix is only accurate to about ${accuracyText}, which usually means it came from Wi-Fi rather than GPS —` +
    ' for an exact pin, use a phone while standing in the shop.';

  if (!place) {
    return {
      tone: vague ? 'warn' : 'good',
      text: `Location saved. We could not check which area it falls in, so open the link and make sure it points at your shop.${vague ? vagueLine : ''}`,
    };
  }

  const where = [place.locality, place.city, place.state].filter(Boolean).join(', ') || 'an unknown area';
  const typedWhere = [expected?.city, expected?.district].filter(Boolean).join(', ');

  if (place.countryCode && place.countryCode !== 'IN') {
    return {
      tone: 'bad',
      text: `This pin is in ${where} (${place.countryCode}), outside India — that is not your shop. Try again from the shop, or paste a Google Maps link.`,
    };
  }

  // A different state is unambiguous however tight the fix is.
  if (expected?.state && place.state && !namesAgree(expected.state, place.state)) {
    return {
      tone: 'bad',
      text: `This pin is in ${where} — but your address says ${expected.state}. If you are not at the shop right now, don’t save this: use a phone at the shop, or paste a Google Maps link.`,
    };
  }

  const typedPlaces = [expected?.city, expected?.district].filter(Boolean) as string[];
  const foundPlaces = [place.locality, place.city].filter(Boolean);
  const namesDisagree =
    typedPlaces.length > 0 &&
    foundPlaces.length > 0 &&
    !typedPlaces.some((t) => foundPlaces.some((f) => namesAgree(t, f)));

  if (namesDisagree) {
    return vague
      ? {
        tone: 'bad',
        text: `This pin is at ${where}, ${accuracyText} wide — but your address says ${typedWhere}. That is a Wi-Fi estimate of where this device is, not your shop. Don’t save it: use a phone at the shop, or paste a Google Maps link.`,
      }
      : {
        tone: 'warn',
        text: `Pinned at ${where}, which does not look like ${typedWhere}. Open the link and check it lands on your shop.`,
      };
  }

  // Only reached where the geocoder gave a postcode at all — uncommon in India.
  const typedPin = (expected?.pincode ?? '').replace(/\D/g, '');
  const foundPin = (place.postcode ?? '').replace(/\D/g, '');
  if (typedPin.length === 6 && foundPin.length === 6 && typedPin !== foundPin) {
    return {
      tone: 'warn',
      text: `Pinned at ${where}, but under pincode ${foundPin} rather than the ${typedPin} you entered. Fine if your shop is near the boundary — otherwise check it.${vague ? vagueLine : ''}`,
    };
  }

  if (vague) return { tone: 'warn' as const, text: `Pinned at ${where}, matching your address.${vagueLine}` };
  return { tone: 'good', text: `Pinned at ${where} — matches the address you entered.` };
}
