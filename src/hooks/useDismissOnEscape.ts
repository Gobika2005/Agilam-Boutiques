import { useEffect } from 'react';

/**
 * Close an overlay when the user presses Escape.
 *
 * The filter and sort sheets, and the share sheet, could only be dismissed by
 * finding their × or tapping the scrim — Escape did nothing. For a keyboard
 * user that is close to a keyboard trap (WCAG 2.1.2), and the filter sheet is
 * the densest screen in the app to be stuck inside; for everyone else Escape is
 * simple muscle memory, and an overlay that ignores it feels jammed.
 *
 * `capture: true` so the sheet wins over any ancestor also listening for
 * Escape, and the listener is removed with the overlay.
 */
export function useDismissOnEscape(onDismiss: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onDismiss();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDismiss, active]);
}
