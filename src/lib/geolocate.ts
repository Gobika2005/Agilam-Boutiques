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

/* ────────────────────────────────────────────────────────────────────────────
 * Pinning a shop on the map
 *
 * The seller wizard asks for the boutique's exact location, and a pasted Google
 * Maps link is the form that a shop owner can actually produce (Maps → Share →
 * Copy link). These helpers are what turn "standing in my shop" into that link,
 * and what read coordinates back out of one when it happens to carry them.
 * ──────────────────────────────────────────────────────────────────────────── */

export type Coords = { lat: number; lng: number; accuracyM: number };

/** Why a fix could not be taken. Each one needs different words to the seller —
 *  "turn location on" is useless advice to someone who already has. */
export type LocateFailure =
  | 'unsupported'  // browser has no Geolocation API at all
  | 'insecure'     // page is not HTTPS, so the API refuses outright
  | 'denied'       // the visitor (or the OS, or a policy) blocked it
  | 'unavailable'  // no position source could answer — radios off, indoors
  | 'timeout';     // nothing came back in time

export type LocateResult =
  | ({ ok: true } & Coords)
  | { ok: false; reason: LocateFailure };

/** Good enough to stand for a shopfront. A GPS fix reaches this outdoors in a
 *  few seconds; a Wi-Fi or IP-derived fix never will. */
const GOOD_ACCURACY_M = 50;
/** Past this we keep the fix but say out loud that it is vague — a desktop with
 *  no radios typically answers with several kilometres of error. */
export const VAGUE_ACCURACY_M = 150;
/** How long to keep improving before settling for the best fix so far. */
const LOCATE_WINDOW_MS = 20_000;

function failureFor(err: GeolocationPositionError): LocateFailure {
  if (err.code === err.PERMISSION_DENIED) return 'denied';
  if (err.code === err.POSITION_UNAVAILABLE) return 'unavailable';
  return 'timeout';
}

/**
 * Take the best position fix we can get, for pinning a shopfront.
 *
 * `getCurrentPosition` — which this replaces — returns the FIRST fix the device
 * can produce, and on a laptop that is the Wi-Fi/IP estimate: it arrives in
 * milliseconds, is accurate to kilometres, and is silently wrong. That is how a
 * shop in Oddanchatram came to be pinned in Chennai.
 *
 * So instead: watch, keep the most accurate fix seen, and stop as soon as one is
 * good enough for a shopfront (or after `LOCATE_WINDOW_MS`, with whatever the
 * best was). On a phone outdoors this settles in a few seconds as the GPS
 * overtakes the network estimate. On a desktop it returns the vague fix it has —
 * flagged as vague, so the caller can say so rather than pretend.
 *
 * Never rejects. The failure cases are values, because each needs its own
 * sentence in the UI.
 */
export async function locateShop(): Promise<LocateResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { ok: false, reason: 'unsupported' };
  }
  // Geolocation is refused outright on plain HTTP in every current browser, and
  // the error it raises there is an unhelpful generic one.
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return { ok: false, reason: 'insecure' };
  }
  // Ask the Permissions API first where it exists: a previously-blocked site
  // gets no prompt and no error for several seconds, which reads as "the button
  // does nothing". Best-effort — Safari only added `geolocation` recently.
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (status?.state === 'denied') return { ok: false, reason: 'denied' };
  } catch {
    /* no Permissions API, or it does not know this name — carry on and ask */
  }

  return new Promise<LocateResult>((resolve) => {
    let best: GeolocationPosition | null = null;
    let settled = false;

    const finish = (result: LocateResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      navigator.geolocation.clearWatch(watch);
      resolve(result);
    };

    const settleWithBest = (fallback: LocateFailure) => {
      if (!best) return finish({ ok: false, reason: fallback });
      finish({
        ok: true,
        lat: best.coords.latitude,
        lng: best.coords.longitude,
        accuracyM: Math.round(best.coords.accuracy ?? 0) || 0,
      });
    };

    const watch = navigator.geolocation.watchPosition(
      (p) => {
        if (!best || (p.coords.accuracy ?? Infinity) < (best.coords.accuracy ?? Infinity)) best = p;
        if ((best.coords.accuracy ?? Infinity) <= GOOD_ACCURACY_M) settleWithBest('timeout');
      },
      // An error after a usable fix (the GPS dropping out) must not throw away
      // the fix we already have.
      (err) => settleWithBest(failureFor(err)),
      { enableHighAccuracy: true, timeout: LOCATE_WINDOW_MS, maximumAge: 0 },
    );

    const timer = setTimeout(() => settleWithBest('timeout'), LOCATE_WINDOW_MS);
  });
}

/** A plain, permanent Google Maps link to a point. `?q=` rather than a `/place/`
 *  URL because it opens correctly in the app and on the web, and needs no key. */
export function mapsLinkFromCoords(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

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
