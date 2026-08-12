/**
 * Presenting the seller-supplied catalogue vocabulary.
 *
 * Categories, occasions and fabrics are a managed list (migration 0024), but the
 * strings in it are still typed by people — they arrive as "office wear",
 * "SAREES", "raw silk", whatever the seller or the admin approving it wrote. The
 * app then renders them straight into headings, titles, breadcrumbs and FAQ
 * copy, so the casing and the wording are visible everywhere.
 *
 * Two rules, in one place so the twelve or so call sites cannot each get them
 * slightly differently.
 *
 * The edge middleware carries its own copy of both (it cannot import from `src`
 * — different runtime, no bundler). Change them together.
 */

/** "office wear" → "Office Wear". Leaves the words alone, only the casing. */
export function titleCase(term: string): string {
  return String(term || '').replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Comparing two terms — the third rule, and the one whose absence was a bug.
 *
 * The vocabulary and the products are two different people's typing. A tile is
 * built from the admin's term ("Kurta Set") and counted against the catalogue
 * loosely, so it appears whenever a seller listed a "kurta set" — but the click
 * that opened it compared with `===`, found nothing, and fell through to *no
 * filter at all*, which is how tapping one collection on the home page opened
 * the whole catalogue.
 *
 * So every comparison of a term against a product's value goes through here.
 * Casing and stray inner spacing are presentation; they must never decide
 * whether a piece is in a collection.
 */
export function termKey(term: string | null | undefined): string {
  return String(term || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Whether two vocabulary terms mean the same thing. */
export function sameTerm(a: string | null | undefined, b: string | null | undefined): boolean {
  return termKey(a) === termKey(b);
}

/** `list.includes(term)`, for terms. Empty list means "no constraint". */
export function hasTerm(list: readonly string[], term: string | null | undefined): boolean {
  const key = termKey(term);
  return list.some((t) => termKey(t) === key);
}

/**
 * An occasion reads as "<occasion> wear" — "Casual wear", "Office wear".
 *
 * Appending unconditionally is what produced **"office wear wear"** on the live
 * `/occasions/office-wear` page: in the H1, the `<title>`, the breadcrumb, the
 * meta description and the FAQ answers, because the seller had already written
 * "wear" into the term. Only add the word when it is not already there.
 */
export function occasionLabel(term: string): string {
  const cased = titleCase(term);
  return /\bwear$/i.test(cased) ? cased : `${cased} Wear`;
}

/** The same, lower-cased, for use mid-sentence ("how much does office wear cost"). */
export function occasionNoun(term: string): string {
  return occasionLabel(term).toLowerCase();
}
