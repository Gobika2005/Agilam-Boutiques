import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { trackAdImpression } from '@/data/ads';

/**
 * Fires a single impression for an ad the first time at least half of it scrolls
 * into view. Uses IntersectionObserver so an ad below the fold is not counted
 * until the buyer actually reaches it; trackAdImpression is itself throttled to
 * once per ad per session, so this never double-counts across re-renders.
 */
export function AdImpression({
  adId,
  children,
  className,
  style,
}: {
  adId: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      // No observer support — count it on mount rather than never.
      if (!fired.current) {
        fired.current = true;
        void trackAdImpression(adId);
      }
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !fired.current) {
            fired.current = true;
            void trackAdImpression(adId);
            obs.disconnect();
          }
        }
      },
      { threshold: 0.5 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [adId]);

  return (
    <div ref={ref} className={className} style={style}>
      {children}
    </div>
  );
}
