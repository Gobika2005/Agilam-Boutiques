/**
 * Canonical size ordering, shared by the seller's product form and the buyer's
 * product page so a size ladder always reads XS · S · M · L · XL … · Free Size,
 * no matter the order the seller tapped the chips or the taxonomy stored them.
 */

// Letter sizes get a fixed rank; "Free Size" / "One Size" always sit last.
const SIZE_RANK: Record<string, number> = {
  XXS: 0,
  XS: 1,
  S: 2,
  M: 3,
  L: 4,
  XL: 5,
  XXL: 6,
  '2XL': 6,
  XXXL: 7,
  '3XL': 7,
  XXXXL: 8,
  '4XL': 8,
  '5XL': 9,
  '6XL': 10,
  '7XL': 11,
  '8XL': 12,
  'FREE SIZE': 1000,
  FREE: 1000,
  'ONE SIZE': 1000,
  ONESIZE: 1000,
};

/** Sort weight for one size label. Lower = shown first. */
export function sizeRank(size: string): number {
  const key = size.trim().toUpperCase();
  if (key in SIZE_RANK) return SIZE_RANK[key];
  // Pure numeric sizes (28, 30, 32…) sort by value, after the letter ladder
  // but before "Free Size".
  const num = Number(key);
  if (!Number.isNaN(num)) return 100 + num;
  // Anything unrecognised keeps a stable spot just before "Free Size".
  return 900;
}

/** Return the sizes in canonical order without mutating the input. */
export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => sizeRank(a) - sizeRank(b));
}
