import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * A "Back" that can never leave the site.
 *
 * `history.state.idx` is React Router's own position in the history stack.
 * `idx > 0` means this entry has somewhere to go back to INSIDE the app; a cold
 * deep link — a shared WhatsApp URL, a bookmark, a Google result — starts at 0,
 * and `navigate(-1)` there walks the buyer out of the shop entirely, which is
 * the one thing a back button must never do. Those land on `fallback` instead.
 *
 * Shared by the product page and the four "See all" discovery pages, which are
 * the screens that retire the bottom tab dock in favour of their own back
 * control — so the rule that makes that safe is written down once.
 */
export function useGoBack(fallback = '/') {
  const navigate = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate(fallback);
  }, [navigate, fallback]);
}
