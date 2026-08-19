import type { ReactNode } from 'react';
import { css } from '@/lib/css';

/**
 * Skeleton placeholders.
 *
 * The shimmer itself is `.agx-shimmer` in index.css — a gradient over the
 * `--ag-shimmer-*` tokens, so it tracks light/dark like everything else and
 * stops sweeping under `prefers-reduced-motion`. These components exist so a
 * screen can describe the shape of what is coming rather than reimplementing
 * the gradient (which is how the admin tables ended up with a *static* one).
 *
 * The rule of thumb: a skeleton stands in for content whose size we can predict,
 * on a FOREGROUND load only. A background revalidation (`useAsync`'s
 * `refreshing`) must never tear the screen back down to boxes.
 */

type Size = number | string;

const size = (v: Size) => (typeof v === 'number' ? `${v}px` : v);

/** One shimmering block. `w`/`h` take px numbers or any CSS length. */
export function Skeleton({ w = '100%', h = 12, radius = 6, style = '' }: { w?: Size; h?: Size; radius?: number; style?: string }) {
  return <span className="agx-shimmer" aria-hidden="true" style={css(`display:block;flex:none;width:${size(w)};height:${size(h)};border-radius:${radius}px;${style}`)} />;
}

/**
 * Wraps a group of blocks in a polite live region. Every screen-level skeleton
 * should go through this, so assistive tech hears "Loading…" instead of silence.
 */
export function SkeletonGroup({ label = 'Loading…', style = '', children }: { label?: string; style?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" style={css(style)}>
      <span className="agx-visually-hidden">{label}</span>
      {children}
    </div>
  );
}

/** A paragraph of shimmering lines; the last one is short, the way text ends. */
export function SkeletonText({ lines = 3, h = 12, gap = 9 }: { lines?: number; h?: Size; gap?: number }) {
  return (
    <>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} h={h} w={i === lines - 1 ? '55%' : '100%'} style={i ? `margin-top:${gap}px;` : ''} />
      ))}
    </>
  );
}

/**
 * Stand-in for a list of cards — the shape most of the seller and admin screens
 * load into. `lines` is how many text rows sit next to the leading thumbnail.
 */
export function SkeletonRows({
  rows = 5,
  height = 68,
  thumb = true,
  label = 'Loading…',
  style = '',
}: {
  rows?: number;
  height?: number;
  /** Leading square, for lists that lead with a photo or logo. */
  thumb?: boolean;
  label?: string;
  style?: string;
}) {
  return (
    <SkeletonGroup label={label} style={`display:flex;flex-direction:column;gap:12px;${style}`}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={css(`display:flex;align-items:center;gap:13px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:0 15px;height:${height}px;`)}
        >
          {thumb && <Skeleton w={40} h={40} radius={13} />}
          <span style={css('flex:1;min-width:0;')}>
            <Skeleton w={`${52 + ((i * 13) % 30)}%`} h={12} />
            <Skeleton w={`${30 + ((i * 7) % 22)}%`} h={10} style="margin-top:8px;" />
          </span>
          <Skeleton w={54} h={22} radius={11} />
        </div>
      ))}
    </SkeletonGroup>
  );
}

/**
 * Stand-in for a row of stat tiles (seller dashboard, admin overview).
 *
 * Pass `className` to borrow a page's own responsive grid (`agx-adm-g4`,
 * `agx-sd-stats`); the inline fallback grid is then dropped, because an inline
 * `grid-template-columns` would beat the class at every breakpoint.
 */
export function SkeletonTiles({ count = 4, height = 96, className = '' }: { count?: number; height?: number; className?: string }) {
  return (
    <SkeletonGroup label="Loading figures…">
      <div className={className} style={css(className ? '' : `display:grid;gap:14px;grid-template-columns:repeat(${Math.min(count, 2)},minmax(0,1fr));`)}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} style={css(`background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:15px;height:${height}px;`)}>
            <Skeleton w={26} h={26} radius={9} />
            <Skeleton w="62%" h={15} style="margin-top:14px;" />
            <Skeleton w="40%" h={10} style="margin-top:9px;" />
          </div>
        ))}
      </div>
    </SkeletonGroup>
  );
}
