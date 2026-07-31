import { useEffect } from 'react';

/**
 * Per-screen `<title>` and `<meta name="description">`.
 *
 * This is a single-page app, so the document head never changed: every screen
 * — every product — reported the title "MangaiMart" and carried no description
 * at all. A link pasted into WhatsApp showed the brand name and nothing about
 * the piece, and a search engine had one indexable title for the whole
 * catalogue.
 *
 * Call it near the top of a screen. Passing `null`/`undefined` (data still
 * loading) leaves the head alone rather than flashing a placeholder, and the
 * previous values are restored on unmount so a screen without a title can't
 * inherit the last one's.
 */

const SITE = 'MangaiMart';
const DEFAULT_DESCRIPTION =
  'Shop verified Tamil Nadu boutiques in one place — sarees, kurta sets, kurtis and more, with direct chat to the shop.';

function setMeta(name: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

/** Open Graph / Twitter, so a shared link previews the piece rather than the app. */
function setProperty(property: string, content: string) {
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('property', property);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

export function usePageMeta(opts: {
  /** Screen name; the site name is appended. Omit while data is loading. */
  title?: string | null;
  description?: string | null;
  /** Absolute image URL for the link preview (a product photo, say). */
  image?: string | null;
}): void {
  const { title, description, image } = opts;
  useEffect(() => {
    if (!title && !description && !image) return;
    const previousTitle = document.title;

    const fullTitle = title ? `${title} · ${SITE}` : SITE;
    const desc = description || DEFAULT_DESCRIPTION;

    document.title = fullTitle;
    setMeta('description', desc);
    setProperty('og:title', fullTitle);
    setProperty('og:description', desc);
    setProperty('og:type', 'website');
    setProperty('og:url', window.location.href);
    setMeta('twitter:card', image ? 'summary_large_image' : 'summary');
    if (image) setProperty('og:image', image);

    return () => { document.title = previousTitle; };
  }, [title, description, image]);
}
