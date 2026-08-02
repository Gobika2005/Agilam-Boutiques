/**
 * Which navigation tab the current route belongs to.
 *
 * The three navigation components (`AppShell`'s dock, `BottomTabBar`, `TopNav`)
 * each carried the same one-liner:
 *
 *     t.match.some((m) => pathname.startsWith(m))
 *
 * which lights up the Home tab on **every page in the buyer app**, because the
 * Home tab matches `'/'` and every path starts with `'/'`. Two tabs read as
 * current at once — Home stayed crimson while you stood on Boutiques, Orders or
 * Messages — and `BottomTabBar` went further and put `aria-current="page"` on
 * both, so a screen reader was told there were two current pages.
 *
 * It has not always been wrong. Buyer routes used to live under `/buyer/…`, so
 * Home matched `/buyer/home` and the prefix test was sound; migration 0057 moved
 * the storefront to root URLs and turned Home's pattern into a wildcard.
 *
 * Prefix matching is also too loose in the ordinary case: `/orders` would claim
 * `/ordersomething`, and `/shop` would claim `/shopping-bag`. A pattern should
 * match its own path or a path *below* it, which means testing at a segment
 * boundary.
 */

/** True when `pathname` is `pattern` or sits underneath it. `'/'` is exact. */
export function pathMatches(pathname: string, pattern: string): boolean {
  if (pattern === '/') return pathname === '/';
  const clean = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
  return pathname === clean || pathname.startsWith(`${clean}/`);
}

/** True when any of a tab's patterns claims this route. */
export function isTabActive(pathname: string, patterns: string[]): boolean {
  return patterns.some((p) => pathMatches(pathname, p));
}
