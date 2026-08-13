import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * A page's own search box, seeded from `?q=` in the URL.
 *
 * The global search sends you to the console page that can act on a row — an
 * order to Orders, a coupon to Coupons — and carries the term along so the page
 * lands already filtered to it. Without this the destination opened unfiltered
 * and the operator had to type the same thing twice.
 *
 * Re-seeding on change matters as much as the initial read: searching again
 * from the header while already on the destination changes `?q=` without
 * remounting the page, so plain `useState(initial)` would keep showing the
 * first term. Tracking the last URL value (rather than comparing against the
 * current input) is what lets the operator still edit the box by hand
 * afterwards without the URL yanking it back.
 */
export function useSeededSearch(initial = ''): [string, (value: string) => void] {
  const [params] = useSearchParams();
  const seed = params.get('q') ?? initial;
  const [value, setValue] = useState(seed);
  const lastSeed = useRef(seed);

  useEffect(() => {
    if (seed === lastSeed.current) return;
    lastSeed.current = seed;
    setValue(seed);
  }, [seed]);

  return [value, setValue];
}
