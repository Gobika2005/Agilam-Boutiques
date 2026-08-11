import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  SITE_LOCALE,
  SITE_NAME,
  DEFAULT_OG_IMAGE,
  absoluteUrl,
  canonicalUrl,
  clampDescription,
  clampTitle,
  robotsFor,
} from '@/lib/seo';
import type { JsonLd } from '@/lib/schema';

/**
 * Per-screen `<title>`, description, canonical, robots, social cards and
 * JSON-LD.
 *
 * This is a single-page app, so the document head never changed: every screen
 * — every product — reported the title "MangaiMart" and carried no description
 * at all. A link pasted into WhatsApp showed the brand name and nothing about
 * the piece, and a search engine had one indexable title for the whole
 * catalogue.
 *
 * Call it near the top of a screen. Passing `null`/`undefined` (data still
 * loading) leaves the title alone rather than flashing a placeholder, and the
 * previous values are restored on unmount so a screen without a title can't
 * inherit the last one's.
 *
 * ── Why this still matters when the edge already injects meta ────────────
 * `middleware.ts` writes the same tags into the HTML before it ever reaches the
 * browser, which is what crawlers read. This hook covers the other half: an
 * in-app navigation never re-fetches the document, so without it the tab title,
 * the canonical and the JSON-LD would stay frozen on whatever page the visitor
 * first landed on. The two are deliberately redundant — the edge serves
 * crawlers and cold loads, this serves the SPA session.
 */

const DEFAULT_DESCRIPTION =
  'Shop verified independent boutiques across India in one place — sarees, kurta sets, kurtis and more, with direct chat to the shop.';

/** Tags this hook owns, so cleanup can retire exactly what it added. */
const MANAGED = 'data-page-meta';

function upsert(selector: string, create: () => HTMLElement, apply: (el: HTMLElement) => void) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (!el) {
    el = create();
    el.setAttribute(MANAGED, '');
    document.head.appendChild(el);
  }
  apply(el);
}

function setMeta(name: string, content: string | undefined) {
  if (!content) return;
  upsert(
    `meta[name="${name}"]`,
    () => {
      const t = document.createElement('meta');
      t.setAttribute('name', name);
      return t;
    },
    (el) => el.setAttribute('content', content),
  );
}

/** Open Graph uses `property`, not `name` — Facebook's parser is strict about it. */
function setProperty(property: string, content: string | undefined) {
  if (!content) return;
  upsert(
    `meta[property="${property}"]`,
    () => {
      const t = document.createElement('meta');
      t.setAttribute('property', property);
      return t;
    },
    (el) => el.setAttribute('content', content),
  );
}

function setLink(rel: string, href: string) {
  upsert(
    `link[rel="${rel}"]`,
    () => {
      const t = document.createElement('link');
      t.setAttribute('rel', rel);
      return t;
    },
    (el) => el.setAttribute('href', href),
  );
}

/**
 * Replace the structured data for this screen.
 *
 * Always removes the previous block first: leaving two `Product` graphs in the
 * head after a product-to-product navigation is a validation error, and the
 * stale one would describe the wrong piece.
 */
function setJsonLd(data: JsonLd | null | undefined) {
  document.querySelectorAll('script[data-page-schema]').forEach((el) => el.remove());
  if (!data) return;
  const script = document.createElement('script');
  script.type = 'application/ld+json';
  script.setAttribute('data-page-schema', '');
  // Strip `<` so a product title containing markup can't break out of the tag.
  script.textContent = JSON.stringify(data).replace(/</g, '\\u003c');
  document.head.appendChild(script);
}

export type PageMetaOptions = {
  /** Screen name; the site name is appended. Omit while data is loading. */
  title?: string | null;
  description?: string | null;
  /** Absolute or app-relative image URL for the link preview (a product photo). */
  image?: string | null;
  /**
   * Canonical path. Defaults to the current location, which is right for almost
   * every screen — pass it explicitly where a page is reachable at more than one
   * URL and one of them should win (a legacy alias, a filtered grid).
   */
  canonical?: string | null;
  /** Force `noindex`. Otherwise derived from the path (see `robotsFor`). */
  noindex?: boolean;
  /** `website` for a page, `product` for a PDP, `profile` for a boutique. */
  type?: 'website' | 'product' | 'profile' | 'article';
  /** Product-specific Open Graph, so a shared PDP previews with its price. */
  product?: { price: number; currency?: string; availability?: 'instock' | 'oos' } | null;
  /** JSON-LD `@graph` for this screen — see `@/lib/schema`. */
  schema?: JsonLd | null;
};

export function usePageMeta(opts: PageMetaOptions): void {
  const { title, description, image, canonical, noindex, type = 'website', product, schema } = opts;
  const { pathname } = useLocation();

  // `schema` is rebuilt on every render by its caller, so identity is useless as
  // a dependency — compare the serialised form instead and skip the DOM write
  // when nothing actually changed.
  const schemaKey = schema ? JSON.stringify(schema) : '';
  const productKey = product ? `${product.price}|${product.currency}|${product.availability}` : '';

  useEffect(() => {
    const previousTitle = document.title;

    const fullTitle = title ? clampTitle(`${title} · ${SITE_NAME}`, 70) : SITE_NAME;
    const desc = clampDescription(description || DEFAULT_DESCRIPTION);
    const url = canonicalUrl(canonical || pathname);
    const ogImage = image ? absoluteUrl(image) : DEFAULT_OG_IMAGE;

    if (title || description) document.title = fullTitle;

    setMeta('description', desc);
    setMeta('robots', noindex ? 'noindex, nofollow' : robotsFor(pathname));
    setLink('canonical', url);

    setProperty('og:site_name', SITE_NAME);
    setProperty('og:locale', SITE_LOCALE);
    setProperty('og:title', fullTitle);
    setProperty('og:description', desc);
    setProperty('og:type', type);
    setProperty('og:url', url);
    setProperty('og:image', ogImage);
    setProperty('og:image:alt', title || SITE_NAME);
    /*
     * No og:image:width/height.
     *
     * These were hardcoded to 1200×630, which is not the shape of any image
     * this actually serves: a product photo is portrait, a boutique logo is
     * square, and the brand fallback (mangaimart-logo.png) is 1254×1254. A
     * declared size that does not match the file is worse than none — the
     * scraper reserves the wrong box and then crops or drops the preview.
     *
     * `headFor()` in middleware.js dropped them for exactly this reason and
     * documented it; this hook kept re-adding them on every SPA navigation, so
     * the two halves of the SEO layer disagreed about the same page. Restore
     * both together, and only alongside a purpose-built 1.91:1 share image.
     */

    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', fullTitle);
    setMeta('twitter:description', desc);
    setMeta('twitter:image', ogImage);
    setMeta('twitter:image:alt', title || SITE_NAME);

    if (product) {
      setProperty('product:price:amount', String(product.price));
      setProperty('product:price:currency', product.currency || 'INR');
      setProperty('product:availability', product.availability === 'oos' ? 'oos' : 'instock');
    }

    setJsonLd(schema);

    return () => {
      document.title = previousTitle;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, image, canonical, pathname, noindex, type, productKey, schemaKey]);
}
