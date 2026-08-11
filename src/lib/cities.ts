/**
 * One spelling per city.
 *
 * `boutiques.city` is free text a seller types once during onboarding, so the
 * same place arrives as "Coimbatore", "coimbatore", "COIMBATORE ", "Cbe" and
 * "Kovai". Nothing downstream can tell those apart:
 *
 *   • the buyer directory groups by the raw string, so one city becomes five
 *     chips, each holding a fifth of the shops;
 *   • `/boutiques/:citySlug` slugifies the raw string, so the same city has five
 *     landing pages competing with each other in search;
 *   • "boutiques near me" reads as a typo to a buyer who lives there.
 *
 * This is the single place that decides what a city is called. It runs on write
 * (so what is stored is already canonical — see `src/data/boutiques.ts`) and on
 * the buyer-facing reads (so a row written before this shipped, or by a path
 * that misses it, still displays and groups correctly).
 *
 * Migration 0075 applies the same collapse to the rows already in the table.
 *
 * Deliberately not a closed list: a boutique in a town nobody has heard of must
 * still be able to sign up. An unknown name is title-cased and kept as typed —
 * only the aliases below are rewritten.
 */

/**
 * Cities that already have boutiques or are the obvious next ones, in their
 * canonical spelling. Doubles as the suggestion list on the seller's city field,
 * which is what stops a new variant being invented in the first place.
 */
export const KNOWN_CITIES: readonly string[] = [
  'Ahmedabad',
  'Bengaluru',
  'Bhopal',
  'Chennai',
  'Coimbatore',
  'Delhi',
  'Erode',
  'Gurugram',
  'Hyderabad',
  'Indore',
  'Jaipur',
  'Kanchipuram',
  'Kochi',
  'Kolkata',
  'Kozhikode',
  'Lucknow',
  'Madurai',
  'Mumbai',
  'Mysuru',
  'Nagpur',
  'Namakkal',
  'Nashik',
  'Noida',
  'Puducherry',
  'Pune',
  'Salem',
  'Surat',
  'Thanjavur',
  'Thiruvananthapuram',
  'Thoothukudi',
  'Tiruchirappalli',
  'Tirunelveli',
  'Tiruppur',
  'Vellore',
  'Visakhapatnam',
];

/**
 * Short forms, older names and common misspellings, keyed by `key()`.
 *
 * The renamed-city entries (Bangalore → Bengaluru, Madras → Chennai …) follow
 * the official name rather than the popular one, because that is what the city
 * page's title and address schema have to say to be correct.
 */
const ALIASES: Record<string, string> = {
  // Coimbatore — by far the most-typed variants on this marketplace.
  cbe: 'Coimbatore',
  kovai: 'Coimbatore',
  coimbature: 'Coimbatore',
  coimbatoor: 'Coimbatore',
  covai: 'Coimbatore',
  // Renamed cities.
  bangalore: 'Bengaluru',
  blr: 'Bengaluru',
  madras: 'Chennai',
  chennaicity: 'Chennai',
  bombay: 'Mumbai',
  calcutta: 'Kolkata',
  cochin: 'Kochi',
  ernakulam: 'Kochi',
  trivandrum: 'Thiruvananthapuram',
  calicut: 'Kozhikode',
  mysore: 'Mysuru',
  gurgaon: 'Gurugram',
  pondicherry: 'Puducherry',
  pondy: 'Puducherry',
  trichy: 'Tiruchirappalli',
  tiruchirapalli: 'Tiruchirappalli',
  tiruchi: 'Tiruchirappalli',
  tirupur: 'Tiruppur',
  tiruppur: 'Tiruppur',
  tuticorin: 'Thoothukudi',
  vizag: 'Visakhapatnam',
  tanjore: 'Thanjavur',
  nellai: 'Tirunelveli',
  newdelhi: 'Delhi',
  hyd: 'Hyderabad',
  // Not a city. Sellers occasionally put the state or the country here, which
  // used to produce a "Boutiques in Tamil Nadu" page sitting alongside the real
  // city pages. Blanking it is honest: the directory then files the shop under
  // no city rather than under a wrong one.
  india: '',
  tamilnadu: '',
  kerala: '',
  karnataka: '',
};

/** Comparison key: letters only, lower case. "Cbe " and "cbe." both → "cbe". */
const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** Every canonical spelling, reachable from any of its keys. */
const LOOKUP: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const c of KNOWN_CITIES) m[key(c)] = c;
  for (const [k, v] of Object.entries(ALIASES)) m[k] = v;
  return m;
})();

/** "coimbatore" → "Coimbatore"; "navi  mumbai" → "Navi Mumbai". */
function titleCase(s: string): string {
  return s.replace(/[\p{L}\p{N}]+/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * The canonical name for a typed city. Returns `''` for empty input and for the
 * non-city values above, which callers should treat as "no city given".
 */
export function normalizeCity(raw: string | null | undefined): string {
  // A seller who types "RS Puram, Coimbatore" into the city box means the last
  // part; the first part is the area, which has its own field.
  const cleaned = (raw ?? '')
    .replace(/[.,;/|]+\s*$/, '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const tail = cleaned.includes(',') ? cleaned.slice(cleaned.lastIndexOf(',') + 1).trim() : cleaned;
  const known = LOOKUP[key(tail)];
  if (known !== undefined) return known;
  return titleCase(tail);
}

/**
 * Grouping/equality key for two typed cities. Use this rather than `===` on the
 * raw column: it is what makes "Cbe" and "Coimbatore" one entry in the
 * directory even where the stored value has not been normalised yet.
 */
export function cityKey(raw: string | null | undefined): string {
  return key(normalizeCity(raw));
}

/**
 * Fold a list of typed cities into the distinct canonical ones, alphabetically.
 * Empty and non-city values drop out.
 */
export function distinctCities(raw: Iterable<string | null | undefined>): string[] {
  const seen = new Map<string, string>();
  for (const r of raw) {
    const name = normalizeCity(r);
    if (name) seen.set(key(name), name);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}
