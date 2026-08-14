import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { css } from '@/lib/css';
import { Icon } from '@/components/ui/Icon';

/**
 * The kit the five /sell pages are set in — the "Heritage Modern" system from
 * DESIGN.md, painted in our own tokens.
 *
 * What was taken from that reference: the type scale and its Libre Caslon /
 * Manrope pairing, the 120px-desktop / 64px-mobile section rhythm, the 1280px
 * container, the small-radius shape language (large containers excepted), and
 * the very soft berry-tinted card shadow that does the work heavy elevation
 * used to.
 *
 * What was NOT taken: its palette. The reference ships its own berry ramp in
 * literal hex; this site uses `--ag-*` so /sell cannot drift from the
 * storefront, the seller console and the admin console — and so CLAUDE.md's
 * "never a literal hex" rule holds. Our `--ag-deep` is a near neighbour of its
 * `#6c0034` anyway.
 *
 * Libre Caslon Text is added to the global font request in index.html. It costs
 * other pages only the extra bytes in the Google Fonts CSS: browsers fetch a
 * WOFF2 only when rendered text actually uses the family, and nothing outside
 * /sell does.
 */

/**
 * Headings. The reference's display face; Georgia is the metric-ish fallback.
 *
 * There is no monospace on this site. It had one — IBM Plex Mono, for every
 * figure and every small-caps label — and the reference sets both in Caslon and
 * Manrope instead. Losing it is most of the difference between the seller site
 * reading as a dashboard and reading as a printed prospectus.
 */
export const SERIF = "'Libre Caslon Text',Georgia,'Times New Roman',serif";

/* ── Shape and depth, from DESIGN.md ───────────────────────────────────────
   "Tonal layering rather than heavy shadows": a white card on a cream ground,
   a 1px border, and a berry-tinted shadow so soft it reads as warmth rather
   than elevation. The tint is `--ag-shadow`, so it follows the palette instead
   of being the hardcoded rgba(139,30,75,.04) the reference writes. */
export const CARD_SHADOW = '0 4px 20px -4px var(--ag-shadow)';
/** Large containers — the hero and the closing panel. */
export const R_HERO = '2rem';
/** Cards, panels, the rate table. */
export const R_CARD = '0.75rem';
/** Buttons, chips, inputs. Deliberately small: "architectural, not clinical". */
export const R_CONTROL = '0.5rem';

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
 * The crimson block — the hero and the closing call to action.
 *
 * A rounded panel inside the page rather than a full-bleed band, for a specific
 * reason: the site footer is a crimson gradient too, so a full-bleed deep band
 * at the foot of a page ran straight into it and the two restarted their
 * gradients against each other — a hard seam that reads as a rendering fault
 * rather than as two sections. A margin of page around it separates them.
 *
 * The fill is `--ag-deep`, our own token, not the reference's `#6c0034`; see the
 * note at the top of this file.
 */
export function DeepPanel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        ...css(
          // Flat, not a gradient. The reference's hero is one solid primary
          // block, and the flat field is most of why it reads as expensive —
          // a gradient across a panel this large bands visibly on a cheap
          // phone screen. The lit corner below does the depth instead.
          'position:relative;overflow:hidden;background:var(--ag-deep);color:#fff;' +
            `border-radius:${R_HERO};padding:clamp(32px,5.5vw,80px) clamp(24px,5vw,72px);`,
        ),
        ...style,
      }}
    >
      {/* The reference's one flourish: a soft radial lift in a corner at 10%
          white. Decorative and pointer-transparent, so it never eats a tap. */}
      <div
        aria-hidden="true"
        style={css(
          'position:absolute;inset:0;opacity:.1;pointer-events:none;' +
            'background-image:radial-gradient(circle at 100% 0%,#fff 0%,transparent 50%);',
        )}
      />
      <div style={css('position:relative;')}>{children}</div>
    </div>
  );
}

/**
 * The reading column.
 *
 * 1280px and a 24px gutter (20px on a phone) are DESIGN.md's container and
 * margin. The vertical rhythm is its `section-gap`: 120px on desktop, 64px on
 * mobile — "intentional verticality", the gallery feel that keeps this from
 * looking like a marketplace listing page.
 *
 * `wide` is the full container; the default is the narrower measure for
 * sections that are mostly prose, because 1280px of running text is unreadable.
 */
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
          `max-width:${wide ? 1280 : 1000}px;margin:0 auto;` +
            'padding:clamp(64px,9vw,120px) clamp(20px,3vw,24px);',
        ),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ── Type ───────────────────────────────────────────────────────────────────
   The scale is DESIGN.md's, near enough verbatim. Where it gives one fixed
   size for a role that has to survive a 360px phone as well as a 1280px
   container, that becomes a `clamp()` between its mobile and desktop values
   (display-lg-mobile 36px → display-lg 56px) rather than a size that overflows
   on one of them.

   `LABEL_SM` and `LABEL_LG` are its two label roles: Manrope, uppercase, wide
   tracking for the small one; the button and nav face for the large. Between
   them they replaced every use of the monospace this site used to have. */
export const LABEL_SM = 'font-size:12px;font-weight:500;line-height:1.2;letter-spacing:.2em;text-transform:uppercase;';
/** label-lg: the face for buttons, nav and the small headings inside cards. */
export const LABEL_LG = 'font-size:14px;font-weight:600;line-height:1.2;letter-spacing:.05em;';

export function Eyebrow({ children, onDeep }: { children: ReactNode; onDeep?: boolean }) {
  return (
    <div style={css(`${LABEL_SM}color:${onDeep ? 'var(--ag-gold-border)' : 'var(--ag-deep)'};`)}>
      {children}
    </div>
  );
}

/**
 * A section heading. `level` sets the tag so the document outline is real —
 * every page has exactly one `h1` and the rest are `h2`/`h3`.
 *
 * Weights follow the reference: 700 only on display-lg, 600 on the headlines.
 * The negative tracking is likewise display-lg's alone — Caslon at 32px does
 * not want tightening.
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
      ? 'font-size:clamp(36px,5vw,56px);line-height:1.1;letter-spacing:-.02em;font-weight:700;'
      : size === 'md'
      ? 'font-size:clamp(26px,3.2vw,32px);line-height:1.3;font-weight:600;'
      : 'font-size:clamp(21px,2.2vw,24px);line-height:1.3;font-weight:600;';
  return (
    <Tag
      style={{
        ...css(
          `font-family:${SERIF};${scale}` +
            `color:${onDeep ? '#fff' : 'var(--ag-ink)'};margin:20px 0 0;text-wrap:balance;`,
        ),
        ...style,
      }}
    >
      {children}
    </Tag>
  );
}

/** body-lg — the paragraph under a heading. Held to a comfortable measure. */
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
          `margin:24px 0 0;max-width:62ch;font-size:18px;line-height:1.6;` +
            `color:${onDeep ? 'rgba(255,255,255,.86)' : 'var(--ag-ink-2)'};`,
        ),
        ...style,
      }}
    >
      {children}
    </p>
  );
}

/** body-md — body copy inside a section. */
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
          `margin:16px 0 0;max-width:66ch;font-size:16px;line-height:1.6;` +
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

/*
 * Buttons are label-lg on a small radius, generously padded (32px × 16px in the
 * reference). No gradient: the reference's primary is a flat fill, and next to
 * a flat hero a gradient button is the thing that looks cheap.
 */
const ctaBase =
  'display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:16px 32px;' +
  `border-radius:${R_CONTROL};${LABEL_LG}text-decoration:none;white-space:nowrap;` +
  'transition:background-color .2s,color .2s,border-color .2s;';

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
      // On the deep panel the primary inverts to white-on-berry, which is what
      // makes it the loudest thing on a page that is already saturated.
      style={css(
        ctaBase +
          (onDeep
            ? 'background:#fff;color:var(--ag-deep);'
            : `background:var(--ag-deep);color:#fff;box-shadow:${CARD_SHADOW};`),
      )}
    >
      {children}
      <Icon name="arrow_forward" style={css('font-size:20px;')} />
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
            ? 'border:1px solid rgba(255,255,255,.45);color:#fff;'
            : 'border:1.5px solid var(--ag-deep);color:var(--ag-deep);background:transparent;'),
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
    <div style={css('display:flex;flex-wrap:wrap;gap:16px;margin-top:40px;')}>
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

/**
 * A white card on the cream ground — DESIGN.md's "Surface 1".
 *
 * Tonal layering, not elevation: a 1px border does the separating and the
 * shadow is only there to warm the edge. This is the one container shape the
 * whole site uses, so a page never accumulates four different card treatments.
 */
export function Card({
  children,
  style,
  pad = 32,
}: {
  children: ReactNode;
  style?: CSSProperties;
  pad?: number;
}) {
  return (
    <div
      style={{
        ...css(
          `background:var(--ag-surface);border:1px solid var(--ag-border);border-radius:${R_CARD};` +
            `box-shadow:${CARD_SHADOW};padding:clamp(24px,3vw,${pad}px);`,
        ),
        ...style,
      }}
    >
      {children}
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
    <div style={css('display:flex;flex-direction:column;')}>
      {/* headline-lg, in Caslon. The reference sets its figures in the display
          face rather than a monospace, and that is most of why the trust bar
          reads as a statement of terms instead of a dashboard. */}
      <div
        style={css(
          `font-family:${SERIF};font-size:clamp(30px,3.4vw,40px);font-weight:600;line-height:1.2;` +
            `color:${onDeep ? '#fff' : 'var(--ag-deep)'};margin-bottom:8px;`,
        )}
      >
        {value}
      </div>
      <div
        style={css(
          `font-size:12px;font-weight:500;line-height:1.45;color:${onDeep ? 'rgba(255,255,255,.78)' : 'var(--ag-muted)'};`,
        )}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * An icon-led point: thin-line glyph, a short heading, a sentence under it.
 *
 * DESIGN.md's "List Items" component, used for the where-your-fee-goes list and
 * anywhere else a run of five points would otherwise be five identical cards.
 * The icon sits loose on the page rather than inside a tinted circle — the
 * circle is what makes a section look like a template.
 */
export function IconPoint({
  icon,
  title,
  children,
}: {
  icon: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div style={css('display:flex;gap:24px;align-items:flex-start;')}>
      <Icon
        name={icon}
        // 'wght' 200 is the reference's thin-line stroke. Material Symbols is
        // loaded as a variable font, so this costs no extra file.
        style={css("font-size:24px;margin-top:2px;color:var(--ag-deep);flex:none;font-variation-settings:'wght' 200;")}
      />
      <div>
        <h3 style={css(`${LABEL_LG}color:var(--ag-ink);margin:0 0 8px;`)}>{title}</h3>
        <p style={css('margin:0;font-size:16px;line-height:1.6;color:var(--ag-ink-2);max-width:56ch;')}>
          {children}
        </p>
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
    <li style={css('display:grid;grid-template-columns:auto 1fr;gap:24px;padding:32px 0;border-top:1px solid var(--ag-border);')}>
      <div
        style={css(
          `font-family:${SERIF};font-size:24px;font-weight:600;line-height:1.3;color:var(--ag-deep);` +
            'opacity:.4;min-width:34px;',
        )}
      >
        {String(n).padStart(2, '0')}
      </div>
      <div>
        <h3 style={css(`font-family:${SERIF};font-weight:600;font-size:24px;line-height:1.3;margin:0;color:var(--ag-ink);`)}>
          {title}
        </h3>
        <div style={css('margin-top:12px;font-size:16px;line-height:1.6;color:var(--ag-ink-2);max-width:60ch;')}>
          {children}
        </div>
        {aside && (
          <div
            style={css(
              'margin-top:20px;padding:16px 20px;background:var(--ag-surface-2);' +
                `border-radius:${R_CONTROL};font-size:14px;line-height:1.55;color:var(--ag-muted);max-width:58ch;`,
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
    <li style={css('display:flex;gap:12px;align-items:flex-start;padding:10px 0;')}>
      <Icon
        name={icon}
        style={css(
          `font-size:20px;margin-top:1px;flex:none;font-variation-settings:'wght' 200;` +
            `color:${onDeep ? 'var(--ag-gold-border)' : 'var(--ag-deep)'};`,
        )}
      />
      <span
        style={css(
          `font-size:16px;line-height:1.6;color:${onDeep ? 'rgba(255,255,255,.9)' : 'var(--ag-ink-2)'};`,
        )}
      >
        {children}
      </span>
    </li>
  );
}

export function PointList({ children }: { children: ReactNode }) {
  return <ul style={css('list-style:none;padding:0;margin:24px 0 0;')}>{children}</ul>;
}

/**
 * A money line: label on the left, figure on the right.
 *
 * Set the way the reference sets its worked example — the label in Manrope, the
 * amount in Caslon at headline size, and a dashed rule under the deduction so
 * the eye reads it as a subtotal. This is the one place the seller site looks
 * like a bill, because that is exactly what it is showing.
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
    <div
      style={css(
        `padding:20px 0;${strong ? '' : `border-bottom:1px ${negative ? 'dashed' : 'solid'} var(--ag-border);`}`,
      )}
    >
      <div style={css('display:flex;align-items:flex-start;justify-content:space-between;gap:24px;')}>
        <div>
          <span
            style={css(
              strong
                ? `font-family:${SERIF};font-size:24px;font-weight:600;line-height:1.3;color:var(--ag-deep);`
                : `${LABEL_LG}color:${negative ? 'var(--ag-muted)' : 'var(--ag-ink)'};`,
            )}
          >
            {label}
          </span>
          {note && (
            <div style={css('margin-top:6px;font-size:12px;font-weight:500;line-height:1.45;color:var(--ag-muted);max-width:44ch;')}>
              {note}
            </div>
          )}
        </div>
        <span
          style={css(
            `font-family:${SERIF};font-weight:600;white-space:nowrap;line-height:1.3;` +
              `font-size:${strong ? '32px' : '24px'};` +
              `color:${negative ? 'var(--ag-muted)' : strong ? 'var(--ag-deep)' : 'var(--ag-ink)'};`,
          )}
        >
          {value}
        </span>
      </div>
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
          `margin:0;font-family:${SERIF};font-size:clamp(21px,2.4vw,24px);line-height:1.4;` +
            'color:var(--ag-ink);text-wrap:pretty;',
        )}
      >
        “{children}”
      </blockquote>
      <figcaption style={css('margin-top:20px;font-size:12px;font-weight:500;line-height:1.45;color:var(--ag-muted);')}>
        {attribution}
      </figcaption>
    </figure>
  );
}
