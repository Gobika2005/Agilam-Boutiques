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
