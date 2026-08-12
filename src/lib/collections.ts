/**
 * The collections a buyer can browse by.
 *
 * Two inputs, and the difference between them matters:
 *
 *   · the **vocabulary** (migration 0024) decides *which* terms are browsable.
 *     It is the admin's list, so a seller's one-off spelling never becomes a
 *     tile and a newly approved category appears everywhere at once.
 *   · the **catalogue** decides which of those terms are worth showing. A term
 *     with nothing listed under it is dropped: a tile that opens onto an empty
 *     grid is worse than no tile at all.
 *
 * `CATEGORIES` in @/data/demo survives only as artwork. It is six hand-drawn
 * circles from the design file — right for the Home rail, wrong as a source of
 * truth, since it hardcodes a "More" tile that means nothing and cannot know
 * about a category approved last week.
 */

import { CATEGORIES, TONES } from '@/data/demo';
import { colorFromName } from '@/lib/colorName';
import { termKey } from '@/lib/vocabulary';
import type { Product } from '@/data/demo';
import type { TaxonomyKind } from '@/data/taxonomy';

/**
 * The slice of `TaxonomyContext` this module needs. Taking an interface rather
 * than importing the context keeps this file a pure function of its inputs —
 * testable, and usable from anywhere that already has the vocabulary loaded.
 */
export type Vocabulary = {
  rows: (kind: TaxonomyKind) => {
    name: string;
    hex: string | null;
    icon: string | null;
    image_url: string | null;
  }[];
};

export type CategoryTile = {
  name: string;
  count: number;
  /** Tile art: the admin's upload, else the design's, else a real product photo. */
  image?: string;
  icon: string;
  toneHex: string;
  /** Cheapest piece in the category — "from ₹1,899" under the name. */
  from: number;
};

export type OccasionTile = { name: string; count: number; icon: string; toneHex: string; image?: string };
export type ColourTile = { name: string; count: number; hex: string };
export type BudgetTile = { label: string; maxPrice: number; count: number };
export type FabricTile = { name: string; count: number };

/**
 * Budget bands are a ladder ("Under ₹3,000"), not slices ("₹2,000–3,000").
 *
 * The filter model carries a single `maxPrice` and no floor, so a slice cannot
 * be expressed without a schema change — and a ladder is the better shopping
 * affordance anyway: a buyer with ₹3,000 wants everything they can afford, not
 * only the things that cost nearly that much.
 */
const BUDGET_STEPS = [1500, 3000, 5000, 10000];

const rupees = (n: number) => '₹' + n.toLocaleString('en-IN');

/** Fallback glyphs for a term the admin has not given an icon. */
const GENERIC_CATEGORY_ICON = 'checkroom';
const GENERIC_OCCASION_ICON = 'celebration';

/**
 * Counting a term and matching a term must be the same function, or a tile can
 * promise pieces the grid then refuses to show. This is that function — shared
 * with the results grid and the filter sheet through @/lib/vocabulary.
 */
const norm = termKey;

function countBy(products: Product[], pick: (p: Product) => string | undefined | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of products) {
    const k = pick(p);
    if (!k) continue;
    const key = norm(k);
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

export type Collections = {
  categories: CategoryTile[];
  occasions: OccasionTile[];
  budgets: BudgetTile[];
  colours: ColourTile[];
  fabrics: FabricTile[];
};

export function buildCollections(products: Product[], vocab: Vocabulary): Collections {
  const drawn = new Map(CATEGORIES.map((c) => [norm(c.name), c]));

  const catCounts = countBy(products, (p) => p.cat);
  const categories: CategoryTile[] = vocab
    .rows('category')
    .flatMap<CategoryTile>((term) => {
      const key = norm(term.name);
      const count = catCounts.get(key) ?? 0;
      if (count === 0) return [];

      const inCategory = products.filter((p) => norm(p.cat) === key);
      const art = drawn.get(key);
      return [{
        name: term.name,
        count,
        // The admin's own art wins, then the design's, then a photo of
        // something actually listed under it — so a category approved this
        // morning has a picture by this afternoon without anyone uploading one.
        image: term.image_url ?? art?.image ?? inCategory.find((p) => p.image)?.image,
        icon: term.icon ?? art?.icon ?? GENERIC_CATEGORY_ICON,
        toneHex: art?.toneHex ?? TONES[inCategory[0]?.tone ?? 0],
        from: Math.min(...inCategory.map((p) => p.price)),
      }];
    })
    // Biggest edits first — the page should lead with what there is most of.
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const occCounts = countBy(products, (p) => p.occasion);
  const occasions: OccasionTile[] = vocab
    .rows('occasion')
    .map((term, i) => ({
      name: term.name,
      count: occCounts.get(norm(term.name)) ?? 0,
      // The glyph is the fallback, not the default: an uploaded photo replaces
      // it in the tile's swatch square.
      icon: term.icon ?? GENERIC_OCCASION_ICON,
      toneHex: TONES[i % TONES.length],
      image: term.image_url ?? undefined,
    }))
    // Left in the admin's order: it is a narrative (bridal → casual), not a
    // ranking, and reshuffling it by popularity would read as arbitrary.
    .filter((t) => t.count > 0);

  const budgets: BudgetTile[] = BUDGET_STEPS.map((maxPrice) => ({
    label: `Under ${rupees(maxPrice)}`,
    maxPrice,
    count: products.filter((p) => p.price <= maxPrice).length,
  })).filter((b) => b.count > 0);

  const colourCounts = countBy(products, (p) => p.color);
  const colours: ColourTile[] = vocab
    .rows('color')
    .map((term) => ({
      name: term.name,
      count: colourCounts.get(norm(term.name)) ?? 0,
      // The admin's swatch wins; otherwise settle the tile to a hue read from
      // the colour's own name, so "Olive Brown…" is olive and "Black, vine" is
      // black rather than every un-swatched colour sharing one mauve.
      hex: term.hex ?? colorFromName(term.name) ?? '#C9A9B6',
    }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const fabricCounts = countBy(products, (p) => p.fabric);
  const fabrics: FabricTile[] = vocab
    .rows('fabric')
    .map((term) => ({ name: term.name, count: fabricCounts.get(norm(term.name)) ?? 0 }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return { categories, occasions, budgets, colours, fabrics };
}
