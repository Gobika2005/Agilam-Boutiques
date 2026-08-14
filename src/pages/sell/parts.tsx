import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { css } from '@/lib/css';
import { Icon } from '@/components/ui/Icon';

/**
 * The typographic kit the five /sell pages are set in.
 *
 * The seller site is the one part of the app that is read rather than used, so
 * it is built like a printed page instead of like a console: a single measure
 * of text, hairline rules instead of a card around everything, Playfair for the
 * headings and IBM Plex Mono wherever a number has to be trusted. All three
 * faces are already loaded in index.html for the storefront, so this costs
 * nothing extra.
 *
 * Colours are `--ag-*` only. The dark theme is not a variant of these pages, it
 * is the same page — see `src/lib/tokens.ts`.
 */

export const SERIF = "'Playfair Display',Georgia,serif";
export const MONO = "'IBM Plex Mono',ui-monospace,monospace";

/* ── Structure ─────────────────────────────────────────────────────────────── */

/**
 * A full-bleed horizontal band. `tone` decides the ground it sits on:
 *   page  — the paper itself, no fill (the default)
 *   panel — a quiet inset, for a section that should read as an aside
 *
 * There is deliberately no crimson tone here: the footer is already a crimson
 * gradient, so a full-bleed dark band collides with it. Use `DeepPanel`, which
 * keeps a margin of page around itself.
 */
export function Band({
  tone = 'page',
  children,
  style,
  id,
}: {
  tone?: 'page' | 'panel';
  children: ReactNode;
  style?: CSSProperties;
  id?: string;
}) {
  const fill = tone === 'panel' ? 'background:var(--ag-surface-2);' : '';
  return (
    <section
      id={id}
      style={{
        // Full-bleed out of the centred column, the same way SiteFooter does it.
        ...css(`width:100vw;margin-left:calc(50% - 50vw);${fill}`),
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/**
 * The crimson block, as a rounded panel inside the page rather than as a
 * full-bleed band.
 *
 * That is a deliberate correction: the site footer is the same crimson
 * gradient, so a full-bleed deep band at the bottom of a page ran straight into
 * it and the two restarted the gradient against each other — a hard seam that
 * reads as a rendering fault rather than as two sections. Keeping a margin of
 * page around it separates them and lets the panel look intended.
 */
export function DeepPanel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        ...css(
          'background:linear-gradient(150deg,#5C1330,#8E1C44 62%,#B02454);color:#fff;' +
            'border-radius:28px;padding:clamp(30px,4.5vw,54px);',
        ),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** The reading column. `wide` is for grids that need the room. */
export function Wrap({
  children,
  wide,
  style,
}: {
  children: ReactNode;
  wide?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        ...css(
          `max-width:${wide ? 1180 : 940}px;margin:0 auto;padding:clamp(52px,7vw,96px) clamp(20px,5vw,44px);`,
        ),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ── Type ──────────────────────────────────────────────────────────────────── */

export function Eyebrow({ children, onDeep }: { children: ReactNode; onDeep?: boolean }) {
  return (
    <div
      style={css(
        `font-family:${MONO};font-size:11px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;` +
          `color:${onDeep ? '#F4D9A6' : 'var(--ag-crimson)'};`,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A section heading. `level` sets the tag so the document outline is real —
 * every page has exactly one `h1` and the rest are `h2`/`h3`.
 */
export function Display({
  children,
  level = 2,
  size = 'md',
  onDeep,
  style,
}: {
  children: ReactNode;
  level?: 1 | 2 | 3;
  size?: 'sm' | 'md' | 'lg';
  onDeep?: boolean;
  style?: CSSProperties;
}) {
  const Tag = (`h${level}` as unknown) as 'h2';
  const scale =
    size === 'lg'
      ? 'font-size:clamp(34px,5.4vw,56px);line-height:1.04;'
      : size === 'md'
      ? 'font-size:clamp(26px,3.4vw,38px);line-height:1.12;'
      : 'font-size:clamp(20px,2.4vw,25px);line-height:1.2;';
  return (
    <Tag
      style={{
        ...css(
          `font-family:${SERIF};font-weight:700;letter-spacing:-.015em;${scale}` +
            `color:${onDeep ? '#fff' : 'var(--ag-ink)'};margin:14px 0 0;text-wrap:balance;`,
        ),
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

/** The paragraph under a heading. Held to a comfortable measure. */
export function Lede({
  children,
  onDeep,
  style,
}: {
  children: ReactNode;
  onDeep?: boolean;
  style?: CSSProperties;
}) {
  return (
    <p
      style={{
        ...css(
          `margin:18px 0 0;max-width:62ch;font-size:clamp(16px,1.6vw,18.5px);line-height:1.66;` +
            `color:${onDeep ? 'rgba(255,255,255,.9)' : 'var(--ag-ink-2)'};`,
        ),
        ...style,
      }}
    >
      {children}
    </p>
  );
}

/** Body copy inside a section. */
export function Text({
  children,
  onDeep,
  style,
}: {
  children: ReactNode;
  onDeep?: boolean;
  style?: CSSProperties;
}) {
  return (
    <p
      style={{
        ...css(
          `margin:14px 0 0;max-width:66ch;font-size:15.5px;line-height:1.7;` +
            `color:${onDeep ? 'rgba(255,255,255,.86)' : 'var(--ag-ink-2)'};`,
        ),
        ...style,
      }}
    >
      {children}
    </p>
  );
}

/** A hairline. The seller site's only divider — no card shadows. */
export function Rule({ onDeep, style }: { onDeep?: boolean; style?: CSSProperties }) {
  return (
    <div
      style={{
        ...css(
          `height:1px;background:${onDeep ? 'rgba(255,255,255,.22)' : 'var(--ag-border)'};margin:34px 0;`,
        ),
        ...style,
      }}
    />
  );
}

/* ── Calls to action ───────────────────────────────────────────────────────── */

const ctaBase =
  'display:inline-flex;align-items:center;justify-content:center;gap:9px;height:54px;padding:0 26px;' +
  'border-radius:16px;font-size:15px;font-weight:800;text-decoration:none;white-space:nowrap;';

export function PrimaryCta({
  to,
  children,
  onDeep,
}: {
  to: string;
  children: ReactNode;
  onDeep?: boolean;
}) {
  return (
    <Link
      to={to}
      style={css(
        ctaBase +
          (onDeep
            ? 'background:#fff;color:#8E1C44;'
            : 'background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;box-shadow:0 10px 26px -14px var(--ag-shadow);'),
      )}
    >
      {children}
      <Icon name="arrow_forward" style={css('font-size:19px;')} />
    </Link>
  );
}

export function GhostCta({
  to,
  children,
  onDeep,
}: {
  to: string;
  children: ReactNode;
  onDeep?: boolean;
}) {
  return (
    <Link
      to={to}
      style={css(
        ctaBase +
          (onDeep
            ? 'border:1.5px solid rgba(255,255,255,.5);color:#fff;'
            : 'border:1.5px solid var(--ag-border);color:var(--ag-deep);background:var(--ag-surface);'),
      )}
    >
      {children}
    </Link>
  );
}

/** The two buttons that close most sections. */
export function CtaPair({
  to,
  label,
  secondaryTo,
  secondaryLabel,
  onDeep,
}: {
  to: string;
  label: string;
  secondaryTo?: string;
  secondaryLabel?: string;
  onDeep?: boolean;
}) {
  return (
    <div style={css('display:flex;flex-wrap:wrap;gap:12px;margin-top:30px;')}>
      <PrimaryCta to={to} onDeep={onDeep}>
        {label}
      </PrimaryCta>
      {secondaryTo && secondaryLabel && (
        <GhostCta to={secondaryTo} onDeep={onDeep}>
          {secondaryLabel}
        </GhostCta>
      )}
    </div>
  );
}

/* ── Small pieces ──────────────────────────────────────────────────────────── */

/**
 * A figure and what it means. Used for facts we can stand behind (a rate, a
 * count of live shops) — never for a made-up milestone.
 */
export function Figure({
  value,
  label,
  onDeep,
}: {
  value: ReactNode;
  label: string;
  onDeep?: boolean;
}) {
  return (
    <div>
      <div
        style={css(
          `font-family:${MONO};font-size:clamp(24px,3vw,32px);font-weight:600;letter-spacing:-.02em;` +
            `color:${onDeep ? '#fff' : 'var(--ag-deep)'};`,
        )}
      >
        {value}
      </div>
      <div
        style={css(
          `margin-top:7px;font-size:13px;line-height:1.5;color:${onDeep ? 'rgba(255,255,255,.78)' : 'var(--ag-muted)'};`,
        )}
      >
        {label}
      </div>
    </div>
  );
}

/** One row of the "here is what happens" lists. Numbered, not bulleted. */
export function Step({
  n,
  title,
  children,
  aside,
}: {
  n: number;
  title: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <li style={css('display:grid;grid-template-columns:auto 1fr;gap:20px;padding:26px 0;border-top:1px solid var(--ag-border);')}>
      <div
        style={css(
          `font-family:${MONO};font-size:13px;font-weight:600;color:var(--ag-crimson);padding-top:5px;min-width:26px;`,
        )}
      >
        {String(n).padStart(2, '0')}
      </div>
      <div>
        <h3 style={css(`font-family:${SERIF};font-weight:700;font-size:21px;line-height:1.25;margin:0;color:var(--ag-ink);`)}>
          {title}
        </h3>
        <div style={css('margin-top:9px;font-size:15px;line-height:1.68;color:var(--ag-ink-2);max-width:60ch;')}>
          {children}
        </div>
        {aside && (
          <div
            style={css(
              'margin-top:14px;padding:12px 15px;border-left:2px solid var(--ag-border);' +
                'font-size:13.5px;line-height:1.6;color:var(--ag-muted);max-width:58ch;',
            )}
          >
            {aside}
          </div>
        )}
      </div>
    </li>
  );
}

/** A tick line. Deliberately plain — no coloured pills, no icon circles. */
export function Point({
  children,
  icon = 'check',
  onDeep,
}: {
  children: ReactNode;
  icon?: string;
  onDeep?: boolean;
}) {
  return (
    <li style={css('display:flex;gap:11px;align-items:flex-start;padding:9px 0;')}>
      <Icon
        name={icon}
        style={css(
          `font-size:18px;margin-top:2px;color:${onDeep ? '#F4D9A6' : 'var(--ag-crimson)'};flex:none;`,
        )}
      />
      <span
        style={css(
          `font-size:15px;line-height:1.62;color:${onDeep ? 'rgba(255,255,255,.9)' : 'var(--ag-ink-2)'};`,
        )}
      >
        {children}
      </span>
    </li>
  );
}

export function PointList({ children }: { children: ReactNode }) {
  return <ul style={css('list-style:none;padding:0;margin:18px 0 0;')}>{children}</ul>;
}

/**
 * A money line: label on the left, figure on the right, dotted leader between.
 * This is the one place the seller site looks like a bill, because that is
 * exactly what it is showing.
 */
export function LedgerRow({
  label,
  value,
  strong,
  negative,
  note,
}: {
  label: ReactNode;
  value: ReactNode;
  strong?: boolean;
  negative?: boolean;
  note?: string;
}) {
  return (
    <div style={css(`padding:13px 0;border-bottom:1px ${strong ? 'solid' : 'dotted'} var(--ag-border);`)}>
      <div style={css('display:flex;align-items:baseline;justify-content:space-between;gap:16px;')}>
        <span
          style={css(
            `font-size:${strong ? '15.5px' : '14.5px'};font-weight:${strong ? 700 : 500};color:${
              strong ? 'var(--ag-ink)' : 'var(--ag-ink-2)'
            };`,
          )}
        >
          {label}
        </span>
        <span
          style={css(
            `font-family:${MONO};font-size:${strong ? '18px' : '15px'};font-weight:600;white-space:nowrap;` +
              `color:${negative ? 'var(--ag-muted)' : strong ? 'var(--ag-deep)' : 'var(--ag-ink)'};`,
          )}
        >
          {value}
        </span>
      </div>
      {note && <div style={css('margin-top:5px;font-size:12.5px;line-height:1.5;color:var(--ag-muted);max-width:52ch;')}>{note}</div>}
    </div>
  );
}

/** A short quoted line set large. Used for the seller's own words, never ours. */
export function PullQuote({
  children,
  attribution,
}: {
  children: ReactNode;
  attribution: ReactNode;
}) {
  return (
    <figure style={css('margin:0;')}>
      <blockquote
        style={css(
          `margin:0;font-family:${SERIF};font-size:clamp(20px,2.4vw,26px);line-height:1.42;` +
            'font-style:italic;color:var(--ag-ink);text-wrap:pretty;',
        )}
      >
        “{children}”
      </blockquote>
      <figcaption style={css('margin-top:16px;font-size:13.5px;line-height:1.5;color:var(--ag-muted);')}>
        {attribution}
      </figcaption>
    </figure>
  );
}
