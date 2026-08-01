import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { pauseLiveRefresh } from '@/lib/liveRefresh';

/**
 * Routes where stale data beats a re-render.
 *
 * Everywhere else, refreshing in the background is a gift. On these screens it
 * isn't: money is moving, a third-party widget owns the page, or the user is
 * partway through a long form that a re-render could disturb. They're all
 * short-lived flows that the user finishes in a minute or two, so nothing is
 * meaningfully out of date by the time they leave.
 */
const PAUSED_ROUTES = [
  '/checkout',
  '/payment',
  '/order-confirmation',
  '/seller/register',
  '/seller/onboarding',
  '/seller/add-product',
  '/seller/billing',
  '/auth/',
];

/**
 * Suspends app-wide background refresh while the user is on a sensitive route.
 * Mounted once, inside the router — one place to reason about, instead of a
 * pause hook sprinkled through half a dozen pages.
 */
export function LiveRefreshGate() {
  const { pathname } = useLocation();
  const paused = PAUSED_ROUTES.some((route) => pathname.startsWith(route));

  useEffect(() => {
    if (!paused) return;
    return pauseLiveRefresh();
  }, [paused]);

  return null;
}
