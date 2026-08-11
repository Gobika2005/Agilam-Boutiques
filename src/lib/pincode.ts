/**
 * Indian pincode → the places, district and state it covers.
 *
 * A seller typing their own address is the worst possible source for the two
 * fields the rest of the app depends on: `city` files the shop into the buyer
 * directory and its own /boutiques/<city> page, and `district` is what a courier
 * pickup registration is matched on. Typed by hand they arrive as "Cbe",
 * "Coimbatore Dt", "TN" — see `src/lib/cities.ts` for the mess that follows.
 *
 * The pincode, by contrast, is six digits the seller knows by heart and cannot
 * really get wrong, and India Post publishes exactly what we need against it:
 * every post office (i.e. every locality/place) under that pincode, plus the one
 * district and state they belong to. So the wizard asks for the pincode first
 * and offers the rest as suggestions rather than blank boxes.
 *
 * api.postalpincode.in is the free public mirror of that data — HTTPS, no key,
 * no quota to manage. It is treated as strictly best-effort: every failure path
 * (offline, rate-limited, unknown pincode, malformed answer) resolves to `null`
 * and the fields stay free text, because a boutique in a village the API has
 * never heard of must still be able to sign up.
 */

const TIMEOUT_MS = 6000;

export type PincodeArea = {
  pincode: string;
  /** Every locality under this pincode, de-duped and alphabetical. */
  places: string[];
  district: string;
  state: string;
};

/** Resolved lookups for this page load — the wizard re-checks on every keystroke
 *  that completes six digits, and a seller stepping back and forth would
 *  otherwise re-fetch the same pincode repeatedly. `null` is cached too: an
 *  unknown pincode stays unknown. */
const cache = new Map<string, PincodeArea | null>();

export const PINCODE_RE = /^[1-9][0-9]{5}$/;

type PostOffice = { Name?: string; District?: string; State?: string; Block?: string };

function titleCase(s: string): string {
  return s.trim().replace(/[\p{L}\p{N}]+/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/** Strip the suffixes India Post appends to a locality name: "Gandhipuram S.O",
 *  "Peelamedu B.O", "Coimbatore H.O" are all the place, not a place plus a
 *  post-office grade. */
function cleanPlace(raw: string): string {
  return titleCase(raw.replace(/\s+(?:[SBH]\.?O\.?|Sub Office|Head Office|Branch Office)\s*$/i, '').trim());
}

/** Districts arrive as "COIMBATORE" or occasionally "Coimbatore District". */
function cleanDistrict(raw: string): string {
  return titleCase(raw.replace(/\s+(?:district|dist\.?)\s*$/i, '').trim());
}

/**
 * Look up a 6-digit pincode. Never throws; `null` means "we could not tell you",
 * which callers must treat as "let them type it themselves", not as an error.
 */
export async function lookupPincode(pin: string): Promise<PincodeArea | null> {
  const code = String(pin ?? '').trim();
  if (!PINCODE_RE.test(code)) return null;
  const hit = cache.get(code);
  if (hit !== undefined) return hit;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.postalpincode.in/pincode/${code}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null; // not cached: a 429/500 is worth retrying later
    const body = await res.json();
    const entry = Array.isArray(body) ? body[0] : null;
    const offices: PostOffice[] = Array.isArray(entry?.PostOffice) ? entry.PostOffice : [];
    if (entry?.Status !== 'Success' || offices.length === 0) {
      cache.set(code, null);
      return null;
    }

    const places = [...new Set(offices.map((o) => cleanPlace(o?.Name ?? '')).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    const area: PincodeArea = {
      pincode: code,
      places,
      district: cleanDistrict(offices[0]?.District ?? ''),
      state: titleCase(offices[0]?.State ?? ''),
    };
    cache.set(code, area);
    return area;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
