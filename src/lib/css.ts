import type { CSSProperties } from 'react';

/**
 * Converts a raw CSS declaration string into a React style object.
 *
 * The screens are ported from the `MangaiMart v2.dc.html` design, which
 * styles everything with inline `style="..."` strings. Keeping those strings
 * verbatim — rather than hand-translating each one into a camelCased object —
 * is what keeps the UI pixel-identical to the design and makes future diffs
 * against it readable.
 */

const cache = new Map<string, CSSProperties>();

// Custom properties (--x) must keep their exact casing; everything else is
// kebab-case in CSS and camelCase in React.
function toReactKey(prop: string): string {
  if (prop.startsWith('--')) return prop;
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

// Splits on top-level semicolons only, so `url(a;b)` and quoted values such as
// font-family:'Material Symbols Outlined' survive intact.
function splitDeclarations(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

export function css(text: string): CSSProperties {
  const cached = cache.get(text);
  if (cached) return cached;

  const style: Record<string, string> = {};

  for (const decl of splitDeclarations(text)) {
    const trimmed = decl.trim();
    if (!trimmed) continue;

    // Only split on the first colon — values like `background:url(http://…)`
    // and `grid-template-columns:repeat(2,1fr)` contain their own.
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue;

    const prop = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!prop || !value) continue;

    style[toReactKey(prop)] = value;
  }

  const frozen = style as CSSProperties;
  cache.set(text, frozen);
  return frozen;
}
