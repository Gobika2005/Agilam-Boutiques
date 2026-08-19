/**
 * Do two Indian place names refer to the same place?
 *
 * Shared by the map-pin sanity check (`src/lib/pinCheck.ts`) and delivery zone
 * resolution (`src/lib/deliveryZone.ts`), both of which have to compare a name a
 * seller typed against a name a data source returned — and those are two
 * different transliterations of the same Tamil or Malayalam word far more often
 * than they are the same string. The seller writes "Oddanchatram"; India Post
 * says "Oddanchathiram"; the geocoder says "Oddanchatram (T)".
 *
 * The mirror of this logic exists in api/_pricing.js, because the server prices
 * the same delivery zone and the two must not disagree. Change both together.
 */

const key = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** Levenshtein distance, abandoned early on lengths that cannot be close. */
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
 * Forgiving enough for transliteration, strict enough to keep two real places
 * apart: exact match, either containing the other, or within two edits on names
 * of six letters or more. Two edits covers the usual th/t, aa/a and -ur/-oor
 * variations; it will not let Chennai match Coimbatore.
 */
export function namesAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = key(a ?? '');
  const y = key(b ?? '');
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return Math.min(x.length, y.length) >= 6 && editDistance(x, y) <= 2;
}
