/**
 * Turn a human colour *name* into a display hex — so a swatch can settle to a
 * sensible hue even when the admin never picked one in the taxonomy.
 *
 * Boutique colour names are rarely a single tidy word: sellers type "Black,
 * vine", "Olive Brown with Orange Floral Design", "Mulberry wine with Dusty
 * blue". So rather than look the whole string up in a table, we scan it for the
 * colour words we know and keep the *first* one that appears — in fashion naming
 * the primary colour leads ("Olive Brown…" is olive, "Mulberry wine…" is
 * mulberry, "Black, vine" is black). Multi-word phrases ("desert rose", "dusty
 * blue") are matched as a whole so they win over the bare word inside them.
 *
 * Returns null when nothing is recognised, so callers can keep their own
 * fallback rather than showing a misleading colour.
 */

/** Colour vocabulary → display hex. Phrases (space-separated) are matched whole
 *  and, being longer, beat the plain word they contain. Ordering here doesn't
 *  matter — the scanner decides by position in the name, not table order. */
const PALETTE: Record<string, string> = {
  // multi-word / fashion phrases first, purely for readability
  'desert rose': '#C08081',
  'dusty blue': '#8FA9C4',
  'dusty rose': '#C4909A',
  'rose gold': '#E0A899',
  'off white': '#F4F1EA',
  'sea green': '#3AA88A',
  'sky blue': '#86BBD8',
  'navy blue': '#24314D',
  'baby pink': '#F4B8CC',
  'hot pink': '#E8558E',
  'bottle green': '#2C5F3E',
  'royal blue': '#2A4DA8',

  // neutrals
  white: '#F4F1EA',
  ivory: '#F5EFDF',
  cream: '#F3E9CE',
  offwhite: '#F4F1EA',
  beige: '#E4D6BC',
  tan: '#D2B48C',
  khaki: '#C3B37B',
  sand: '#E0CDA9',
  taupe: '#B9A99A',
  grey: '#9AA0A6',
  gray: '#9AA0A6',
  silver: '#C4C8CC',
  charcoal: '#40454B',
  slate: '#5A6472',
  black: '#2C2C30',

  // yellows / golds / browns
  gold: '#D4AF37',
  golden: '#D4AF37',
  mustard: '#D4A017',
  yellow: '#F0C230',
  amber: '#E8A317',
  ochre: '#CC8A3C',
  bronze: '#A87332',
  brown: '#8B5A2B',
  coffee: '#6F4E37',
  chocolate: '#5B3A29',
  camel: '#C19A6B',
  caramel: '#B87333',
  rust: '#B7410E',
  terracotta: '#C56A4A',
  copper: '#B87333',

  // oranges / reds / pinks
  orange: '#E8843C',
  tangerine: '#F08030',
  peach: '#F5C09E',
  coral: '#F07A66',
  salmon: '#F08A78',
  red: '#D6394B',
  crimson: '#C51E3A',
  scarlet: '#E23B3B',
  cherry: '#C4384A',
  maroon: '#7B1E2B',
  wine: '#722F37',
  burgundy: '#6E2233',
  mulberry: '#7C2E58',
  pink: '#E8639A',
  rose: '#D96E8A',
  blush: '#E8A9BC',
  magenta: '#C2185B',
  fuchsia: '#D6337A',
  fuschia: '#D6337A',

  // purples
  purple: '#8B5FBF',
  violet: '#8E7CC3',
  lavender: '#B9A7D6',
  mauve: '#C9A9B6',
  lilac: '#C8A2C8',
  plum: '#7D3C6A',
  aubergine: '#5A2A4A',
  indigo: '#4B4E8C',

  // blues / teals
  navy: '#24314D',
  blue: '#3E6EB5',
  denim: '#5A7DAE',
  teal: '#2E8B8B',
  turquoise: '#3FBFBF',
  cyan: '#3EB7C7',
  aqua: '#4CC0C0',
  sky: '#86BBD8',

  // greens
  green: '#4E9C5B',
  olive: '#808000',
  mint: '#8CCFAE',
  emerald: '#2E8B57',
  lime: '#9ACD32',
  sage: '#9AAE84',
  forest: '#2F5233',
};

/** Sorted so multi-word phrases are tried before their component words. */
const KEYS = Object.keys(PALETTE).sort((a, b) => b.length - a.length);

/**
 * Best display hex for a colour name, or null if no known colour word appears.
 * Picks the colour word that appears *earliest* in the name (the primary hue in
 * fashion naming); phrases win over the plain words nested inside them.
 */
export function colorFromName(name: string): string | null {
  if (!name) return null;
  const hay = ` ${name.toLowerCase().replace(/[^a-z]+/g, ' ').trim().replace(/\s+/g, ' ')} `;

  let bestIdx = Infinity;
  let bestHex: string | null = null;
  for (const key of KEYS) {
    const idx = hay.indexOf(` ${key} `);
    if (idx === -1) continue;
    // Earliest match wins; on a tie the longer phrase (scanned first) keeps it.
    if (idx < bestIdx) {
      bestIdx = idx;
      bestHex = PALETTE[key];
    }
  }
  return bestHex;
}
