/**
 * Every Material Symbols icon this app can draw.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The icon font was requested as the complete set:
 *
 *   fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0
 *
 * — one 447 kB woff2, the heaviest thing on the page by a wide margin, on every
 * cold load, for about a hundred and fifty glyphs. Google Fonts will subset it
 * to a named list with `&icon_names=`, which takes it to roughly 15 kB. What
 * stops anyone doing that by hand is the failure mode: an icon left out of the
 * list renders as its literal ligature text ("shopping_bag" as words, clipped
 * inside the 1em box `.msymbol` reserves), and the app names icons in about
 * four hundred places across three consoles.
 *
 * So the list is derived, never written. `vite.config.ts` calls this at build
 * time and rewrites the font URL, which means the request can only ever be
 * behind the source by a rebuild.
 *
 * ── How the sweep works ─────────────────────────────────────────────────────
 * Two passes, deliberately overlapping.
 *
 *  1. **Targeted.** The four shapes an icon name is actually written in — the
 *     ligature child of a Material-Symbols span, an `icon` prop or field, an
 *     `<Icon name>`, and any string inside a `{…}` expression sitting in
 *     ligature position (the `cond ? 'error' : 'check_circle'` pattern).
 *
 *  2. **Vocabulary.** Every bare `'lower_snake'` string literal anywhere in the
 *     source that *is* a real Material Symbols name. This is the net under the
 *     first pass: it catches icon names held in lookup tables, arrays and
 *     constants that no naming convention would have found — at the price of a
 *     handful of false positives (`home`, `search`, `pending` are also perfectly
 *     ordinary strings). A false positive costs a few dozen bytes of font. A
 *     false negative is a visible bug, so the trade only runs one way.
 *
 * `scripts/material-symbols-names.json` is the vocabulary that makes pass 2
 * safe — without it, sending Google a string that is not an icon name gets the
 * whole stylesheet rejected. Regenerate it with `--refresh` when Google ships
 * new icons.
 *
 * The taxonomy migrations are swept too: `taxonomy.icon` is a database column
 * (0024, 0040), so those seeded values reach the buyer app as icon names.
 * Nothing can add to them any more — the admin screen replaced its "type an
 * icon name" box with a photo picker (see `src/pages/admin/Catalogue.tsx`) —
 * which is what makes a static subset safe at all.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VOCAB_FILE = join(ROOT, 'scripts', 'material-symbols-names.json');
const METADATA_URL = 'https://fonts.google.com/metadata/icons?incomplete=1&key=material_symbols';

/** Icon-name shape: lower snake case, and never a single letter. */
const NAME = '[a-z][a-z0-9_]{2,}';

const walk = (dir, ext, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, ext, out);
    else if (ext.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
};

export function loadVocabulary() {
  return new Set(JSON.parse(readFileSync(VOCAB_FILE, 'utf8')));
}

/** Re-download Google's icon metadata. Run by hand, not by the build. */
export async function refreshVocabulary() {
  const res = await fetch(METADATA_URL);
  if (!res.ok) throw new Error(`icon metadata: HTTP ${res.status}`);
  const json = JSON.parse((await res.text()).replace(/^\)\]\}'/, ''));
  const names = [...new Set(json.icons.map((i) => i.name))].sort();
  writeFileSync(VOCAB_FILE, JSON.stringify(names));
  return names.length;
}

export function collectIconNames() {
  const vocabulary = loadVocabulary();
  const found = new Set();
  const keep = (name) => {
    if (name && vocabulary.has(name)) found.add(name);
  };

  for (const file of walk(join(ROOT, 'src'), ['.ts', '.tsx'])) {
    // Newlines folded away: an icon's markup routinely straddles four lines,
    // and every pattern below is written to read across them.
    const src = readFileSync(file, 'utf8').replace(/\s+/g, ' ');

    // 1a. Ligature child: …'Material Symbols Outlined'…")}>arrow_back</span>
    for (const m of src.matchAll(new RegExp(`Material Symbols Outlined[^>]*>\\s*(${NAME})\\s*<`, 'g'))) keep(m[1]);

    // 1b. Ligature child that is an expression: >{a ? 'error' : 'check_circle'}<
    //     Take every quoted literal inside the braces and let the vocabulary
    //     decide which of them are icons.
    for (const m of src.matchAll(/Material Symbols Outlined[^>]*>\s*\{([^}]*)\}\s*</g)) {
      for (const lit of m[1].matchAll(new RegExp(`['"\`](${NAME})['"\`]`, 'g'))) keep(lit[1]);
    }

    // 2. `icon` as a prop, an object field, or a braced prop.
    for (const m of src.matchAll(new RegExp(`\\bicon\\s*[:=]\\s*\\{?\\s*['"\`](${NAME})['"\`]`, 'g'))) keep(m[1]);

    // 3. <Icon name="…" /> and <Icon name={'…'} />
    for (const m of src.matchAll(new RegExp(`<Icon\\b[^>]*?\\bname=\\{?\\s*['"\`](${NAME})['"\`]`, 'g'))) keep(m[1]);

    // 4. The net: any lower-snake literal that is a real icon name.
    for (const m of src.matchAll(new RegExp(`['"\`](${NAME})['"\`]`, 'g'))) keep(m[1]);
  }

  // `taxonomy.icon` — seeded by migration, read by the buyer app.
  for (const file of walk(join(ROOT, 'supabase', 'migrations'), ['.sql'])) {
    const sql = readFileSync(file, 'utf8');
    if (!/insert\s+into\s+taxonomy/i.test(sql)) continue;
    for (const m of sql.matchAll(new RegExp(`'(${NAME})'`, 'g'))) keep(m[1]);
  }

  return [...found].sort();
}

/**
 * The stylesheet URL to request. `icon_names` must be comma-separated and
 * sorted — Google keys its cache on the exact URL, so a stable order means one
 * cache entry rather than one per build.
 */
export function iconFontHref(names = collectIconNames()) {
  return (
    'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0..1,0' +
    `&icon_names=${names.join(',')}` +
    '&display=block'
  );
}

if (process.argv[1] && process.argv[1].endsWith('icon-inventory.mjs')) {
  if (process.argv.includes('--refresh')) {
    console.log(`vocabulary refreshed: ${await refreshVocabulary()} names`);
  }
  const names = collectIconNames();
  if (process.argv.includes('--url')) console.log(iconFontHref(names));
  else console.log(`${names.length} icons\n${names.join('\n')}`);
}
