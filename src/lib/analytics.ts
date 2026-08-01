/**
 * Analytics — GA4 and/or Google Tag Manager, plus Search Console verification.
 *
 * Nothing here loads unless the matching environment variable is set, so a
 * developer running `npm run dev` and a preview deploy send no traffic to a
 * production property, and a fork with no keys behaves exactly as before.
 *
 * ── Why it is deferred ───────────────────────────────────────────────────
 * This marketplace's audience is largely on 3G, where the first paint already
 * took 7.4 seconds before the boot splash was added. A tag manager in the
 * critical path would spend a chunk of that budget measuring how bad it is.
 * The script is therefore injected after the window `load` event (or on the
 * first interaction, whichever comes first), which keeps it out of LCP and INP
 * entirely while still recording the session.
 *
 * ── SPA page views ───────────────────────────────────────────────────────
 * GA4's automatic page_view fires once, on the document load. This is a
 * single-page app, so without `trackPageView` every route after the landing
 * page would be invisible and every session would look like a bounce.
 */

const GA4_ID = import.meta.env?.VITE_GA4_ID as string | undefined;
const GTM_ID = import.meta.env?.VITE_GTM_ID as string | undefined;
const GSC_VERIFICATION = import.meta.env?.VITE_GSC_VERIFICATION as string | undefined;

type GtagArgs = [string, ...unknown[]];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: GtagArgs) => void;
  }
}

function pushToDataLayer(...args: GtagArgs): void {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  // GA4's own snippet pushes `arguments`, not an array — the shape matters.
  window.dataLayer.push(args);
}

function loadScript(src: string): void {
  const tag = document.createElement('script');
  tag.async = true;
  tag.src = src;
  document.head.appendChild(tag);
}

let installed = false;

/**
 * Install the tags, once, after the page has finished loading.
 *
 * Safe to call unconditionally: with no IDs configured it does nothing at all.
 */
export function installAnalytics(): void {
  if (installed || typeof window === 'undefined') return;
  if (!GA4_ID && !GTM_ID && !GSC_VERIFICATION) return;
  installed = true;

  // Search Console verification is a meta tag, not a script — it costs nothing
  // and must be present before Google will report on the property.
  if (GSC_VERIFICATION) {
    const meta = document.createElement('meta');
    meta.name = 'google-site-verification';
    meta.content = GSC_VERIFICATION;
    document.head.appendChild(meta);
  }

  const start = () => {
    if (GTM_ID) {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      loadScript(`https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`);
    }

    if (GA4_ID) {
      loadScript(`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`);
      window.gtag = (...args: GtagArgs) => pushToDataLayer(...args);
      window.gtag('js', new Date());
      // Routing is handled by `trackPageView`, so the automatic one would
      // double-count the landing page.
      window.gtag('config', GA4_ID, { send_page_view: false, anonymize_ip: true });
    }
  };

  if (document.readyState === 'complete') {
    // Already loaded (a client-side route change got here first).
    setTimeout(start, 0);
  } else {
    window.addEventListener('load', () => setTimeout(start, 1200), { once: true });
    // Don't make an engaged visitor wait on a slow asset to be counted.
    window.addEventListener('pointerdown', start, { once: true });
  }
}

/* ── Events ─────────────────────────────────────────────────────────────── */

function send(event: string, params: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return;
  if (window.gtag) window.gtag('event', event, params);
  else if (GTM_ID) pushToDataLayer('event', event, params);
}

/** Call on every route change — see the module note on SPA page views. */
export function trackPageView(path: string, title?: string): void {
  if (!GA4_ID && !GTM_ID) return;
  send('page_view', {
    page_path: path,
    page_location: window.location.href,
    page_title: title || document.title,
  });
}

/* ── Ecommerce ──────────────────────────────────────────────────────────── */

export type AnalyticsItem = {
  item_id: string;
  item_name: string;
  item_category?: string;
  item_brand?: string;
  price?: number;
  quantity?: number;
};

/** GA4 recommended ecommerce events, so the funnel is reportable out of the box. */
export const track = {
  viewItem: (item: AnalyticsItem) => send('view_item', { currency: 'INR', value: item.price, items: [item] }),
  addToCart: (item: AnalyticsItem) => send('add_to_cart', { currency: 'INR', value: item.price, items: [item] }),
  removeFromCart: (item: AnalyticsItem) => send('remove_from_cart', { currency: 'INR', value: item.price, items: [item] }),
  addToWishlist: (item: AnalyticsItem) => send('add_to_wishlist', { currency: 'INR', value: item.price, items: [item] }),
  viewCart: (value: number, items: AnalyticsItem[]) => send('view_cart', { currency: 'INR', value, items }),
  beginCheckout: (value: number, items: AnalyticsItem[]) => send('begin_checkout', { currency: 'INR', value, items }),
  purchase: (orderId: string, value: number, items: AnalyticsItem[], shipping?: number) =>
    send('purchase', { transaction_id: orderId, currency: 'INR', value, shipping, items }),
  search: (term: string) => send('search', { search_term: term }),
  selectItem: (listName: string, item: AnalyticsItem) => send('select_item', { item_list_name: listName, items: [item] }),
  shareItem: (id: string, method: string) => send('share', { content_type: 'product', item_id: id, method }),
};
