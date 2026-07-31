import { Link } from 'react-router-dom';
import type { CSSProperties, ReactNode } from 'react';
import { css } from '@/lib/css';

/**
 * The clickable wrapper around a catalogue tile.
 *
 * Product and boutique cards used to be `<div onClick={navigate}>`, which meant
 * they were not links at all: they could not be reached by keyboard (tabbing a
 * results grid skipped every card and landed only on the hearts), could not be
 * opened in a new tab, had no address to copy or share, and were invisible to
 * anything reading the page rather than clicking it.
 *
 * A real `<a href>` fixes all of that in one place, and react-router's `Link`
 * keeps the in-app navigation instant — modifier-click, middle-click and
 * "Open in new tab" fall through to the browser, exactly as they should.
 *
 * Interactive children (the wishlist heart, a quick-add button) must still call
 * `e.stopPropagation()` **and** `e.preventDefault()` in their own handler so
 * they don't also follow the link; `WishButton` already does.
 */
export function CardLink({
  to,
  label,
  children,
  className = '',
  style,
}: {
  to: string;
  /** What a screen reader announces for the card — normally the product title. */
  label: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      className={className}
      style={{
        // Cards style their own contents; the anchor must not add link colour,
        // underlines or inline layout of its own.
        ...css('display:block;color:inherit;text-decoration:none;cursor:pointer;'),
        ...style,
      }}
    >
      {children}
    </Link>
  );
}
