import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Scroll-in reveal for page sections, applied app-wide.
 *
 * Every screen's top-level blocks fade and rise as they scroll into view, so a
 * long page (Home's rails, a product page, the seller dashboard) arrives in
 * paced beats instead of appearing all at once. Mounted once next to
 * `ScrollManager`; no page component has to opt in.
 *
 * Four rules make this safe to run everywhere:
 *
 * 1. **Content is never hidden by CSS alone.** `.agx-sr` (the hidden state) is
 *    only ever added by this file, and only immediately before the element is
 *    handed to an IntersectionObserver. If the observer is unsupported, this
 *    module does nothing at all and every page renders exactly as before —
 *    there is no path where a stylesheet loads but the JS doesn't and the site
 *    is left blank.
 *
 * 2. **Nothing containing `position:fixed` is animated.** A transformed ancestor
 *    becomes the containing block for fixed descendants, which would tear the
 *    product page's "Add to Bag" bar and the Results filter button off the
 *    viewport and strand them mid-page. Those sections are skipped outright.
 *
 * 3. **The transform is removed once the animation ends**, so no element is
 *    left as a permanent containing block or a stuck compositor layer.
 *
 * 4. **`prefers-reduced-motion` disables it entirely** — not merely shortened,
 *    since a rise-and-fade is exactly the vestibular trigger that setting exists
 *    to avoid.
 */

/** Sections shorter than this are usually chrome (a breadcrumb, a back link);
 *  animating them reads as flicker rather than choreography. */
const MIN_HEIGHT = 40;
/** Matches the CSS duration + the longest stagger, after which classes are dropped. */
const CLEANUP_MS = 900;

export function ScrollReveal() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const seen = new WeakSet<Element>();
    let cleanupTimers: number[] = [];

    const reveal = (el: HTMLElement, index: number) => {
      // Stagger within a batch so a screenful arrives as a sequence, not a jump.
      el.style.setProperty('--agx-sr-delay', `${Math.min(index, 4) * 70}ms`);
      el.classList.add('agx-sr-in');
      const t = window.setTimeout(() => {
        // Drop every trace: no transform, no opacity, no containing block.
        el.classList.remove('agx-sr', 'agx-sr-in');
        el.style.removeProperty('--agx-sr-delay');
      }, CLEANUP_MS);
      cleanupTimers.push(t);
    };

    const io = new IntersectionObserver(
      (entries, obs) => {
        entries
          .filter((e) => e.isIntersecting)
          .forEach((e, i) => {
            reveal(e.target as HTMLElement, i);
            obs.unobserve(e.target);
          });
      },
      // Start a little before the element's top edge reaches the fold, so the
      // motion finishes about when the reader gets there.
      { rootMargin: '0px 0px -8% 0px', threshold: 0.01 },
    );

    /**
     * The sections are not `main`'s children — every page renders a single root
     * wrapper (often two), and the real blocks (hero, rail heading, rail, grid)
     * are inside it. Walk down through single-child wrappers to whichever
     * element actually holds the page's siblings.
     */
    const sectionParent = (): HTMLElement | null => {
      let node = document.querySelector('main.agx-app-main') as HTMLElement | null;
      let depth = 0;
      while (node && node.children.length === 1 && depth < 4) {
        const only = node.children[0];
        if (!(only instanceof HTMLElement)) break;
        node = only;
        depth += 1;
      }
      return node;
    };

    /**
     * One `getBoundingClientRect()` per element per scan.
     *
     * Every read here forces the browser to flush layout, and the walk below
     * used to measure the same element three or four times over — once in
     * `eligible`, twice more while sorting a level by height, then again in
     * `scan`. On a screen with a few dozen sections that is a few dozen
     * synchronous layouts inside whatever interaction happened to schedule the
     * scan, which is exactly what an INP measurement is counting. The cache is
     * per-scan and thrown away after, so it can never go stale.
     */
    let rects = new WeakMap<HTMLElement, DOMRect>();
    const rectOf = (el: HTMLElement) => {
      let r = rects.get(el);
      if (!r) {
        r = el.getBoundingClientRect();
        rects.set(el, r);
      }
      return r;
    };

    /**
     * Is this node inside a `position:fixed` surface?
     *
     * Walks up rather than testing the node itself: the chat is a fixed
     * full-screen surface whose children are ordinary flow and absolute
     * elements, and those children are not part of the page's scroll no matter
     * where their rects happen to land.
     */
    const insideFixedSurface = (el: HTMLElement) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).position === 'fixed') return true;
      }
      return false;
    };

    /** Tall enough to be worth animating, and not already on screen. */
    const eligible = (el: HTMLElement) => {
      const r = rectOf(el);
      return r.height >= MIN_HEIGHT && r.top >= window.innerHeight * 0.9;
    };

    /**
     * Pages come in two shapes. Home, Collections and Profile stack a dozen
     * sections, and those sections are the right thing to animate. Boutiques and
     * Inspire are a single tall grid, where the sections are all above the fold
     * and the *cards* are what the reader scrolls to.
     *
     * So: take a level, and if nothing on it is actually animatable, descend
     * into its tallest child and look again. Two levels is enough for every
     * screen in the app, and the 60-item cap keeps a long catalogue grid from
     * turning into sixty staggered animations.
     */
    const targets = (): HTMLElement[] => {
      let level = sectionParent();
      for (let depth = 0; depth < 3 && level; depth += 1) {
        const kids = Array.from(level.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
        if (kids.length > 60) return kids;
        if (kids.some(eligible)) return kids;
        level = kids.reduce<HTMLElement | null>(
          (tallest, k) => (!tallest || rectOf(k).height > rectOf(tallest).height ? k : tallest),
          null,
        );
      }
      return [];
    };

    const scan = () => {
      rects = new WeakMap();
      for (const node of targets()) {
        if (!(node instanceof HTMLElement) || seen.has(node)) continue;

        // Rule 2 — never transform a fixed element, nor an ancestor of one.
        // This is a permanent verdict, so it is safe to stop re-checking.
        if (getComputedStyle(node).position === 'fixed' || node.querySelector('[style*="position:fixed"]')) {
          seen.add(node);
          continue;
        }

        /*
         * Rule 2, the half that was missing: nor anything INSIDE a fixed
         * surface.
         *
         * The check above only looks at the node and its descendants, so a
         * `position:absolute` child of a full-screen fixed surface passed
         * straight through. That is exactly what the chat's message composer
         * is, and it sat a few pixels below `innerHeight * 0.9` — so it was
         * classed as a section "below the fold", given `.agx-sr`, and left at
         * `opacity:0; translateY(22px)` waiting for a scroll that never comes,
         * because a fixed surface does not move with the page. The buyer saw a
         * chat with no message bar, and scrolling the thread was the one thing
         * that made it appear.
         *
         * Nothing inside a fixed surface is ever "scrolled into view" in the
         * page sense, so none of it is a candidate. Permanent, like the check
         * above: an ancestor's `position` will not change under us.
         */
        if (insideFixedSurface(node)) {
          seen.add(node);
          continue;
        }

        // NOT marked `seen`: a section measured while its data is still loading
        // is 0px tall, and marking it here excluded every asynchronously-filled
        // rail on Home from ever animating. Leave it for a later scan.
        const rect = rectOf(node);
        if (rect.height < MIN_HEIGHT) continue;

        // Above the fold right now — the page's own entrance animations already
        // cover those, and hiding them would flash. Also not marked `seen`, so
        // it is reconsidered if the layout shifts it down.
        if (rect.top < window.innerHeight * 0.9) continue;

        seen.add(node);
        node.classList.add('agx-sr');
        io.observe(node);
      }
    };

    /**
     * At most one scan per frame.
     *
     * The observer below is `subtree: true` over the whole page, so it fires on
     * every React commit — and a single interaction (opening a sheet, typing in
     * search, expanding an accordion, a rail's data landing) is many commits.
     * Wired straight to `scan`, each one dragged a full measuring pass into the
     * same task as the interaction, and the reveal's own class changes fed more
     * commits back in. Coalescing to a frame makes the cost of a hundred
     * mutations the same as the cost of one, and moves it out of the event
     * handler the browser is timing for INP.
     */
    let queued = 0;
    const queueScan = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        scan();
      });
    };

    // Content arrives asynchronously (catalogue, orders, analytics), so re-scan
    // as the page fills rather than only once on mount.
    scan();
    const mo = new MutationObserver(queueScan);
    const main = document.querySelector('main.agx-app-main');
    // `subtree` because the sections live inside the page's own wrapper, so a
    // rail that finishes loading is not a mutation of `main` itself.
    if (main) mo.observe(main, { childList: true, subtree: true });
    const settle = window.setTimeout(scan, 600);
    const settle2 = window.setTimeout(scan, 1600);

    return () => {
      io.disconnect();
      mo.disconnect();
      if (queued) cancelAnimationFrame(queued);
      window.clearTimeout(settle);
      window.clearTimeout(settle2);
      cleanupTimers.forEach(window.clearTimeout);
      cleanupTimers = [];
      // Leave nothing hidden behind on an unmount mid-animation.
      document.querySelectorAll('.agx-sr').forEach((el) => el.classList.remove('agx-sr', 'agx-sr-in'));
    };
  }, [pathname]);

  return null;
}
