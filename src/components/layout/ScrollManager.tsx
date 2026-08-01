import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Scroll behaviour on navigation.
 *
 * React Router keeps the window where it was when the route changes, so opening
 * a product from half-way down the results grid dropped you half-way down the
 * product page. Every forward navigation now starts at the top.
 *
 * Going *back* is the opposite expectation: you want the grid exactly where you
 * left it. So positions are remembered per history entry and restored on a POP,
 * rather than blindly scrolling to top on every route change.
 *
 * Render once, inside the router.
 */

/** scrollY per history entry key. In-memory: a reload gets a fresh history anyway. */
const positions = new Map<string, number>();

/**
 * Routes that are the same screen wearing different URLs — the filter and sort
 * sheets render over the results grid. Moving between them must not move the
 * grid underneath.
 */
const SHEET_GROUPS = [['/shop', '/shop/filter', '/shop/sort']];

function sameScreen(a: string, b: string): boolean {
  if (a === b) return true;
  return SHEET_GROUPS.some((group) => group.includes(a) && group.includes(b));
}

/**
 * Layouts where the page scrolls inside an element rather than the window — the
 * admin console, whose sidebar is fixed and whose content pane scrolls. They opt
 * in with `.agx-scroll-main` so this stays a one-line change per layout.
 */
function scrollPanes(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.agx-scroll-main'));
}

function scrollAllTo(y: number) {
  window.scrollTo(0, y);
  scrollPanes().forEach((el) => { el.scrollTop = y; });
}

/**
 * A programmatic scroll fires a scroll event of its own. Without this guard it
 * would immediately overwrite the position we just restored.
 */
let lastProgrammaticScroll = 0;

export function ScrollManager() {
  const { pathname, key } = useLocation();
  const navigationType = useNavigationType();
  /** The path the previous render settled on, used to detect same-screen moves. */
  const lastPath = useRef<string | null>(null);

  // Remember where this history entry is left. `capture` so the same listener
  // also sees scroll events from the inner panes, which don't bubble.
  useEffect(() => {
    const entryKey = key;
    const onScroll = (e: Event) => {
      if (Date.now() - lastProgrammaticScroll < 120) return;
      const target = e.target;
      const y = target instanceof HTMLElement && target.classList.contains('agx-scroll-main')
        ? target.scrollTop
        : target === document || target === document.documentElement
          ? window.scrollY
          : null;
      if (y != null) positions.set(entryKey, y);
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', onScroll, { capture: true });
  }, [key]);

  // Own scroll restoration, so the browser's guess doesn't fight ours. Set once.
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  }, []);

  // Layout effect, not a passive one: the jump has to happen before the browser
  // paints, or the new page is visibly drawn at the old offset first.
  useLayoutEffect(() => {
    const previous = lastPath.current;
    lastPath.current = pathname;
    if (previous !== null && sameScreen(previous, pathname)) return;

    lastProgrammaticScroll = Date.now();

    if (navigationType === 'POP') {
      const saved = positions.get(key);
      if (saved != null) {
        scrollAllTo(saved);
        // Product photos load lazily, so the page can still be shorter than it
        // will be — the browser clamps the scroll and the buyer lands above
        // where they were. Re-apply once the next frame has laid out.
        const retry = requestAnimationFrame(() => {
          const pane = scrollPanes()[0];
          const current = pane ? pane.scrollTop : window.scrollY;
          if (Math.abs(current - saved) > 1) {
            lastProgrammaticScroll = Date.now();
            scrollAllTo(saved);
          }
        });
        return () => cancelAnimationFrame(retry);
      }
    }
    scrollAllTo(0);
  }, [pathname, key, navigationType]);

  return null;
}
