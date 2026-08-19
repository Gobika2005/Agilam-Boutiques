/**
 * Resolve a human-readable location label for the current visitor, best-first:
 *
 *   1. Browser GPS (navigator.geolocation) → reverse-geocoded to the actual
 *      *area* (locality/neighbourhood), e.g. "T. Nagar, Chennai, Tamil Nadu, IN".
 *      This is the only source accurate to where the user really is. It asks the
 *      visitor for permission; if they allow it we get a real area.
 *   2. IP fallback (/api/geo) — region-level and often the wrong city, used only
 *      when GPS is unavailable, denied, or times out.
 *
 * Everything is best-effort; a total failure resolves to '' (location unknown).
 */

const GPS_TIMEOUT_MS = 9000;
const GEOCODE_TIMEOUT_MS = 4000;

/** Promisified getCurrentPosition — resolves null instead of throwing. */
function currentPosition(): Promise<GeolocationPosition | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null), // denied / unavailable / timeout
      { enableHighAccuracy: false, timeout: GPS_TIMEOUT_MS, maximumAge: 10 * 60_000 },
    );
  });
}

function dedupeLabel(parts: (string | undefined | null)[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const v = (raw ?? '').trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out.join(', ');
}

/** Where a set of coordinates actually is, as the geocoder describes it. */
export type PlaceAtCoords = {
  /** Neighbourhood / area, e.g. "Gandhipuram". */
  locality: string;
  /** Town or city, e.g. "Coimbatore". */
  city: string;
  /** State, e.g. "Tamil Nadu". */
  state: string;
  /** Pincode at that point, when the geocoder knows one. */
  postcode: string;
  /** ISO country code, e.g. "IN". */
  countryCode: string;
};

/**
 * Reverse-geocode coordinates via BigDataCloud's free client endpoint (no key,
 * HTTPS, generous client-side use). Null on any failure — callers must treat
 * "we could not check" as different from "the check failed".
 */
export async function describeCoords(lat: number, lon: number): Promise<PlaceAtCoords | null> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const url =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&localityLanguage=en`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const d = await res.json();
    return {
      locality: String(d?.locality ?? '').trim(),
      city: String(d?.city ?? '').trim(),
      state: String(d?.principalSubdivision ?? '').trim(),
      postcode: String(d?.postcode ?? '').trim(),
      countryCode: String(d?.countryCode ?? '').trim().toUpperCase(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** The same thing as a display label, for the visitor-location banner. */
async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const p = await describeCoords(lat, lon);
  return p ? dedupeLabel([p.locality, p.city, p.state, p.countryCode]) : '';
}

/** IP-based fallback via our own serverless endpoint. */
async function ipLocation(): Promise<string> {
  try {
    const res = await fetch('/api/geo');
    if (!res.ok) return '';
    const d = await res.json();
    return typeof d?.label === 'string' ? d.label : '';
  } catch {
    return '';
  }
}

/**
 * Best available location label. Tries GPS first (real area), then IP.
 * Never rejects — returns '' when nothing could be resolved.
 */
export async function resolveLocation(): Promise<string> {
  const pos = await currentPosition();
  if (pos) {
    const area = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    if (area) return area;
  }
  return ipLocation();
}

/* ───────────────────────────────────────────────────────────────────────────
 * Pinning a shop on the map
 *
 * The seller wizard asks for the boutique's exact location as a pasted Google
 * Maps link (Maps → Share → Copy link) — the one form of it a shop owner can
 * reliably produce. These helpers read coordinates back out of such a link when
 * it happens to carry them, and say whether it is a Maps link at all.
 *
 * There is deliberately no "use my current location" here any more. Reading the
 * device position looked like the strongest option and was the weakest: a laptop
 * answers from Wi-Fi, accurate to kilometres, and the result is indistinguishable
 * from a GPS fix — which is how a shop in Oddanchatram came to be pinned in
 * Chennai and saved without complaint. A link the seller chose in Maps, looking
 * at their own shopfront, is a deliberate act rather than a guess.
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Whether this looks like a Google Maps link the app can hand to a buyer.
 *
 * Deliberately permissive about the path — Maps hands out at least five shapes
 * (`maps.app.goo.gl/…`, `goo.gl/maps/…`, `google.com/maps/place/…`, `?q=`,
 * `@lat,lng,17z`) and a validator that only accepted one of them would reject
 * the link most sellers actually have. The host is what is checked.
 */
export function isMapsLink(raw: string): boolean {
  const v = (raw ?? '').trim();
  if (!v) return false;
  try {
    const u = new URL(v.startsWith('http') ? v : `https://${v}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    return (
      host === 'goo.gl' ||
      host === 'maps.app.goo.gl' ||
      host === 'maps.google.com' ||
      host.endsWith('google.com') ||
      host.endsWith('google.co.in')
    );
  } catch {
    return false;
  }
}

/**
 * Coordinates out of a Maps URL, when it carries them (`?q=`, `@lat,lng`, `!3dlat!4dlng`).
 * A shortened `maps.app.goo.gl` link does not, and returns null — which is why
 * the coordinates are stored alongside the link rather than derived from it.
 */
export function parseMapCoords(raw: string): { lat: number; lng: number } | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  const pair =
    v.match(/[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/) ??
    v.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) ??
    v.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (!pair) return null;
  const lat = Number(pair[1]);
  const lng = Number(pair[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
