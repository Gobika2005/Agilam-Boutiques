import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { installAnalytics, trackPageView } from '@/lib/analytics';

/**
 * Reports a page view on every route change.
 *
 * GA4's automatic `page_view` fires once, when the document loads. This is a
 * single-page app, so without this every screen after the landing page would be
 * invisible: sessions would show one page view each, every visit would look
 * like a bounce, and there would be no way to tell which category or product
 * pages actually earn traffic — which is the entire point of doing the SEO
 * work.
 *
 * The title is read one frame late, because `usePageMeta` sets `document.title`
 * in its own effect; reading it synchronously here would report the *previous*
 * screen's title against the new path.
 *
 * Renders nothing. Mount once, inside the router.
 */
export function AnalyticsTracker() {
  const { pathname, search } = useLocation();
  const previous = useRef<string | null>(null);

  useEffect(() => {
    installAnalytics();
  }, []);

  useEffect(() => {
    const path = `${pathname}${search}`;
    // React 18 StrictMode runs effects twice in development; without this the
    // dev console shows every page counted twice.
    if (previous.current === path) return;
    previous.current = path;

    const id = window.setTimeout(() => trackPageView(path), 0);
    return () => window.clearTimeout(id);
  }, [pathname, search]);

  return null;
}
