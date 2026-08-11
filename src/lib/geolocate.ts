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

/**
 * Reverse-geocode coordinates to an area label via BigDataCloud's free
 * client endpoint (no key, HTTPS, generous client-side use).
 */
async function reverseGeocode(lat: number, lon: number): Promise<string> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
  try {
    const url =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&localityLanguage=en`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return '';
    const d = await res.json();
    // locality = neighbourhood/area, city = town, principalSubdivision = state.
    return dedupeLabel([d?.locality, d?.city, d?.principalSubdivision, d?.countryCode]);
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
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

export type Coords = { lat: number; lng: number; accuracyM: number | null };

/**
 * The device's current position, asked for with high accuracy — this is used to
 * drop a pin on a shopfront, where the ~1km an IP or cell-tower fix gives you is
 * the difference between a courier finding the shop and not. Resolves null if
 * the visitor declines or the fix times out.
 */
export function currentCoords(): Promise<Coords | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy ?? null }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: GPS_TIMEOUT_MS, maximumAge: 0 },
    );
  });
}

/** A plain, permanent Google Maps link to a point. `?q=` rather than a `/place/`
 *  URL because it opens correctly in the app and on the web, and needs no key. */
export function mapsLinkFromCoords(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** A Maps link for a typed address, used when a seller has no GPS fix to give. */
export function mapsLinkFromAddress(parts: (string | null | undefined)[]): string {
  const q = parts.map((p) => (p ?? '').trim()).filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
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
