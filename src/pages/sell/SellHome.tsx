import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { graph, organizationSchema, breadcrumbSchema } from '@/lib/schema';
import { useCatalog } from '@/state/CatalogContext';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { Icon } from '@/components/ui/Icon';
import { fmtInr } from '@/lib/tokens';
import {
  Band,
  Card,
  CARD_SHADOW,
  CtaPair,
  DeepPanel,
  Display,
  Eyebrow,
  Figure,
  GhostCta,
  IconPoint,
  LABEL_LG,
  LedgerRow,
  Lede,
  Point,
  PointList,
  PrimaryCta,
  PullQuote,
  Rule,
  SERIF,
  Text,
  Wrap,
} from './parts';
import { SELLER_STORIES, START_SELLING, WHAT_YOU_NEED } from './sellContent';
import { useSellerTerms } from './useSellerTerms';

/** The "…and here is the next page" link that closes several sections. */
const arrowLink = css(
  `${LABEL_LG}color:var(--ag-deep);text-decoration:none;display:inline-flex;align-items:center;gap:8px;`,
);

/**
 * `/sell` — the page a boutique owner lands on.
 *
 * The hero sells on MECHANICS, not on scale, because we have no scale worth
 * quoting yet and a fabricated "10,000 sellers" is both a lie and the kind of
 * lie that is trivially checked. What we do have is an arrangement that is
 * genuinely kinder to a small shop than the alternatives — paid before you
 * pack, keep your own delivery, nothing charged until it actually arrives —
 * and a live catalogue of real shops that proves the thing exists.
 *
 * ── Two things about the writing ──────────────────────────────────────────
 *
 * 1. It is "platform fee", never "commission", everywhere a seller can read
 *    it. Same number, same row (`platform_settings.commission_pct`) — but
 *    "commission" is the word a middleman uses for the cut he takes, and it
 *    lands badly on someone deciding whether to trust us. The code keeps the
 *    database's name; the page uses the seller's.
 *
 * 2. The tone is warm and it is not evasive. A percentage always looks large
 *    until you know what it covers, so the page SAYS what it covers rather
 *    than hurrying past it — see `WhatTheFeeCovers`. Softening the number by
 *    hiding it would be the one thing worse than the number.
 *
 * Everything numeric here comes from `useSellerTerms`; everything real comes
 * from the live catalogue via `useCatalog`. No hardcoded rate anywhere.
 */
export function SellHome() {
  const terms = useSellerTerms();
  const { products, boutiques } = useCatalog();

  usePageMeta({
    title: 'Sell on MangaiMart — Open Your Boutique Online',
    description:
      'Open your boutique to buyers across India. Free to join and free to list, a small platform fee only when an order is delivered, every order paid online before you pack, and delivery stays in your hands.',
    canonical: '/sell',
    schema: graph(
      organizationSchema(),
      breadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Sell on MangaiMart', path: '/sell' },
      ]),
    ),
  });

  return (
    <>
      <Hero terms={terms} boutiques={boutiques} />
      <Mechanics terms={terms} />
      <TheDeal terms={terms} />
      <WhatTheFeeCovers terms={terms} />
      <RealShops boutiques={boutiques} products={products} />
      <Division />
      <SellerVoices />
      <WhatYouNeed />
      <ClosingBand />
    </>
  );
}

/* ── Hero ──────────────────────────────────────────────────────────────────── */

/**
 * The hero — a full-bleed berry field, the copy at half, an arched portrait at
 * the other, and the terms sitting along the bottom of it.
 *
 * ── Why it is full bleed and the closing panel is not ──────────────────────
 * `DeepPanel` keeps a margin of page around itself because the site footer is a
 * crimson gradient and two dark blocks meeting mid-page read as a rendering
 * fault (see the note on `DeepPanel` in parts.tsx). Nothing sits above the hero
 * but the cream header, so here the berry can run edge to edge — which is what
 * makes the first screen read as a cover rather than as a card on a page.
 *
 * ── Why the numbers moved into it ─────────────────────────────────────────
 * The four figures used to be a separate rule below the fold. A boutique owner
 * arriving from an ad that shouted "0% commission" decides in about four
 * seconds, so the terms are now IN the hero, and three of the four are zeros —
 * because three of them genuinely are. `Mechanics` below carries four different
 * facts; nothing is stated twice.
 *
 * ── What is deliberately absent ───────────────────────────────────────────
 * No seller count, no GMV, no "trusted by thousands". Rule 2 of sellContent.ts.
 * The proof on this page is the live catalogue, and the badge on the portrait
 * says so only once the catalogue is big enough to be proof — see `HeroBadge`.
 */
function Hero({
  terms,
  boutiques,
}: {
  terms: ReturnType<typeof useSellerTerms>;
  boutiques: ReturnType<typeof useCatalog>['boutiques'];
}) {
  return (
    <Band
      style={css(
        'position:relative;overflow:hidden;background:var(--ag-deep);color:#fff;',
      )}
    >
      <HeroFlourish />
      <Wrap
        wide
        style={css(
          'position:relative;padding-top:clamp(44px,5.5vw,76px);padding-bottom:clamp(44px,5.5vw,72px);',
        )}
      >
        <div className="agx-sell-hero">
          <div>
            <Eyebrow onDeep>For boutique owners</Eyebrow>

            {/* The one accent word, in Caslon italic and the pale gold. It falls
                on the reach — the thing a shop owner cannot get on her own and
                the entire reason she is reading this page. */}
            <Display
              level={1}
              size="lg"
              onDeep
              style={css('margin-top:22px;font-size:clamp(38px,5.6vw,64px);')}
            >
              From your boutique to{' '}
              <em style={css('font-style:italic;color:var(--ag-gold-border);')}>every corner</em> of
              India.
            </Display>

            <Ornament />

            <Lede onDeep style={css('margin-top:26px;max-width:48ch;')}>
              List your pieces, reach buyers across India, and keep running your shop exactly as you
              run it now — we handle the rest. You create, we connect,{' '}
              <strong style={css('color:#fff;font-weight:600;')}>India shops</strong>.
            </Lede>

            {/* Hand-rolled rather than `CtaPair`, only so the secondary can
                carry the play glyph — its `secondaryLabel` is a plain string. */}
            <div style={css('display:flex;flex-wrap:wrap;gap:16px;margin-top:36px;')}>
              <PrimaryCta to={START_SELLING} onDeep>
                Start selling today
              </PrimaryCta>
              <GhostCta to="/sell/how-it-works" onDeep>
                <Icon
                  name="play_circle"
                  style={css("font-size:20px;font-variation-settings:'wght' 200;")}
                />
                See how it works
              </GhostCta>
            </div>
          </div>

          <HeroArt boutiques={boutiques} />
        </div>

        <HeroTerms terms={terms} />
      </Wrap>
    </Band>
  );
}

/**
 * The decoration behind the berry: a lit corner and an abstract reach motif.
 *
 * The motif is deliberately NOT a map of India. Depicting India's boundaries
 * incorrectly is a regulated matter here, and a hand-drawn outline on a
 * marketing page is not a risk worth carrying for a background graphic — so
 * this is arcs radiating from a point with lit nodes on them, which says
 * "orders travelling out from your shop" without asserting a border anywhere.
 * Purely decorative, `aria-hidden`, and it never intercepts a tap.
 */
function HeroFlourish() {
  return (
    <div aria-hidden="true" style={css('position:absolute;inset:0;pointer-events:none;overflow:hidden;')}>
      {/* The same soft radial lift `DeepPanel` uses, so the hero and the closing
          panel are recognisably the same material. */}
      <div
        style={css(
          'position:absolute;inset:0;opacity:.1;' +
            'background-image:radial-gradient(circle at 100% 0%,#fff 0%,transparent 55%);',
        )}
      />
      <svg
        viewBox="0 0 400 400"
        className="agx-sell-hero-motif"
        fill="none"
        stroke="var(--ag-gold-border)"
        strokeWidth="1"
      >
        {[70, 118, 166, 214].map((r) => (
          <circle key={r} cx="120" cy="230" r={r} opacity=".22" strokeDasharray="2 9" />
        ))}
        {/* Nodes on the arcs — a delivery landing somewhere, at four distances. */}
        {[
          [190, 230],
          [238, 168],
          [286, 258],
          [154, 60],
          [318, 118],
        ].map(([cx, cy]) => (
          <g key={`${cx}-${cy}`}>
            <circle cx={cx} cy={cy} r="9" fill="var(--ag-gold-border)" stroke="none" opacity=".12" />
            <circle cx={cx} cy={cy} r="2.5" fill="var(--ag-gold-border)" stroke="none" opacity=".75" />
          </g>
        ))}
      </svg>
    </div>
  );
}

/** The hairline-and-diamond rule under the headline. Type ornament, nothing more. */
function Ornament() {
  const line = (dir: number) =>
    css(`height:1px;flex:1;opacity:.5;background:linear-gradient(${dir}deg,var(--ag-gold-border),transparent);`);
  return (
    <div aria-hidden="true" style={css('display:flex;align-items:center;gap:14px;margin-top:34px;max-width:400px;')}>
      <span style={line(90)} />
      <span
        style={css('width:7px;height:7px;flex:none;transform:rotate(45deg);background:var(--ag-gold-border);opacity:.85;')}
      />
      <span style={line(270)} />
    </div>
  );
}

/**
 * Where the hero photograph is expected to live.
 *
 * A plain path into `public/`, so dropping the file in and rebuilding is the
 * whole of it — no import, no code change. It wants a PORTRAIT crop, roughly
 * 4:5 and at least 1200px wide, with the subject centred: it is painted into an
 * arch with `object-fit:cover`, so anything at the edges is what gets cut. A
 * transparent PNG works and looks best — the arch's own gradient then becomes
 * the backdrop.
 */
const HERO_PHOTO = '/sell-hero.png';

/**
 * The arched portrait.
 *
 * An arch rather than the square-on-a-tilt it replaced: a dome is the shape of
 * a shopfront and of a temple doorway, it costs nothing, and it stops the one
 * photograph on this site reading as a stock tile. The dashed outline sitting
 * just outside it is the same gold hairline as the ornament under the headline.
 *
 * The photo stays optional at runtime, exactly as before: if the file is not
 * there, `onError` fires, the whole column unmounts, `.agx-sell-hero` collapses
 * to one column and the copy takes the full width. That is a deliberate layout,
 * not a gap — the badge is decorative and goes with it.
 */
function HeroArt({ boutiques }: { boutiques: ReturnType<typeof useCatalog>['boutiques'] }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <div className="agx-sell-hero-art">
      <div className="agx-sell-hero-arch" style={css('position:relative;')}>
        {/* Offset dashed arch. Inset is negative, so it needs the parent to NOT
            clip — which is why the frame below carries its own overflow. */}
        <div
          aria-hidden="true"
          style={css(
            'position:absolute;inset:-14px;border:1px dashed var(--ag-gold-border);opacity:.35;' +
              'border-radius:999px 999px 32px 32px;',
          )}
        />
        <div
          style={css(
            'position:relative;width:100%;aspect-ratio:4/5;overflow:hidden;' +
              'border-radius:999px 999px 20px 20px;border:1px solid rgba(255,255,255,.2);' +
              'background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(255,255,255,.02));' +
              'box-shadow:0 34px 64px -34px rgba(0,0,0,.6);',
          )}
        >
          <img
            src={HERO_PHOTO}
            alt="A boutique owner in her shop"
            width={720}
            height={900}
            decoding="async"
            // The hero photograph is this page's LCP element and it is above the
            // fold on every desktop, so it is never lazy and never low priority.
            fetchPriority="high"
            onError={() => setHidden(true)}
            style={css('width:100%;height:100%;object-fit:cover;object-position:50% 42%;display:block;')}
          />
        </div>
        <HeroBadge boutiques={boutiques} />
      </div>
    </div>
  );
}

/**
 * How many live shops it takes before a count is worth printing.
 *
 * Under this the badge says what the verification queue does instead. Both
 * lines are true; the difference is that only one of them is PROOF, and a hero
 * that boasts "3 boutiques" argues against itself. What it never does is round
 * a small number up — see rule 2 in sellContent.ts.
 */
const BADGE_MIN_SHOPS = 6;

function HeroBadge({ boutiques }: { boutiques: ReturnType<typeof useCatalog>['boutiques'] }) {
  // Shops with something actually listed, matching `RealShops` further down the
  // page — a directory of empty shops is not evidence of anything, and the two
  // sections must not disagree about how many there are.
  const live = boutiques.filter((b) => b.products > 0);
  const cities = new Set(live.map((b) => b.city).filter(Boolean));
  const proven = live.length >= BADGE_MIN_SHOPS;

  return (
    <div className="agx-sell-hero-badge">
      <span
        style={css(
          'width:34px;height:34px;flex:none;border-radius:9999px;background:rgba(255,255,255,.16);' +
            'display:flex;align-items:center;justify-content:center;',
        )}
      >
        <Icon
          name={proven ? 'storefront' : 'verified_user'}
          style={css("font-size:18px;color:var(--ag-gold-border);font-variation-settings:'wght' 200;")}
        />
      </span>
      <div>
        <div style={css('font-size:13px;font-weight:700;line-height:1.35;color:#fff;')}>
          {proven
            ? `${live.length} boutiques, live right now`
            : 'Every boutique checked by hand'}
        </div>
        <div style={css('margin-top:5px;font-size:12px;line-height:1.45;color:rgba(255,255,255,.8);')}>
          {proven
            ? `Across ${cities.size} cit${cities.size === 1 ? 'y' : 'ies'} — scroll down and open any of them.`
            : 'We look over each shop before it can list, so buyers trust the ones that pass.'}
        </div>
      </div>
    </div>
  );
}

/**
 * The terms, along the foot of the hero.
 *
 * Three zeros and the fee, in that order, and the order is the argument. The
 * marketplaces a boutique owner is comparing us against advertise "0%
 * commission" and then take their margin on the delivery, the payment charge or
 * a monthly plan. Ours are the lines where the zero is real: nothing to join,
 * nothing on an order that did not arrive, and not a rupee of the delivery
 * charge she sets herself (0076/0077).
 *
 * Then the fee, in the same row, at the same size, with what it does NOT touch
 * written under it. Burying it would be the one thing worse than the number —
 * a seller who finds it later feels tricked, and would be right to.
 *
 * Every figure is read live from `platform_settings`; none is typed in here.
 */
function HeroTerms({ terms }: { terms: ReturnType<typeof useSellerTerms> }) {
  return (
    <div className="agx-sell-hero-stats">
      <HeroTerm value="₹0" title="To join, to list, every month">
        No plans, no tiers, nothing to pay to start.
      </HeroTerm>
      <HeroTerm value="₹0" title="On a cancelled or returned order">
        You are never charged for a sale that did not happen.
      </HeroTerm>
      <HeroTerm value="100%" title="Paid online before you pack">
        The money is collected up front. No cash to chase.
      </HeroTerm>
      <HeroTerm value={`${terms.commissionPct}%`} title="The only fee, once it is delivered">
        Nothing else comes off. Your delivery charge stays yours.
      </HeroTerm>
    </div>
  );
}

function HeroTerm({
  value,
  title,
  children,
}: {
  value: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="agx-sell-hero-stat">
      <span
        style={css(
          'width:46px;height:46px;flex:none;border-radius:9999px;background:rgba(255,255,255,.94);' +
            `color:var(--ag-deep);font-family:${SERIF};font-size:15px;font-weight:700;line-height:1;` +
            'display:flex;align-items:center;justify-content:center;',
        )}
      >
        {value}
      </span>
      <div>
        <div style={css('font-size:14px;font-weight:700;line-height:1.35;color:#fff;')}>{title}</div>
        <div style={css('margin-top:5px;font-size:12.5px;line-height:1.45;color:rgba(255,255,255,.76);')}>
          {children}
        </div>
      </div>
    </div>
  );
}

/* ── The four numbers ──────────────────────────────────────────────────────── */

/**
 * The trust bar.
 *
 * On the page ground with a hairline under it, not in a tinted band: the
 * reference treats this as a rule across the paper rather than as a section,
 * which is what stops four numbers reading as a dashboard. Its padding is
 * deliberately tighter than `Wrap`'s section rhythm — it belongs to the hero
 * above it more than to the section below.
 *
 * These are FOUR DIFFERENT FACTS from the ones in the hero's own strip, and
 * they have to stay that way: the two rows are a screen apart, so repeating a
 * figure here reads as the page having very little to say. The hero carries
 * what it costs; this carries what happens — delivery, timing, and how long
 * opening a shop takes.
 */
function Mechanics({ terms }: { terms: ReturnType<typeof useSellerTerms> }) {
  return (
    <Band>
      <Wrap
        wide
        style={css(
          'padding-top:clamp(24px,3vw,32px);padding-bottom:clamp(32px,4vw,48px);border-bottom:1px solid var(--ag-border);',
        )}
      >
        <div className="agx-sell-four">
          {/* The answer to every "0% commission" advertisement she has seen. The
              seller sets four delivery rates by distance and keeps all four —
              migrations 0076 and 0077 — which is exactly the line those
              platforms take their margin on. */}
          <Figure value="0%" label="Of your delivery charge is ours. You set the rates, you keep them" />
          <Figure
            value={`${terms.holdDays} days`}
            label="After a delivery before your money is released — the buyer's window to say something is wrong"
          />
          <Figure
            value={`${terms.slaHours} hrs`}
            label="What we hold ourselves to once a payout is due. It lands in the account you registered"
          />
          <Figure value="15 min" label="About what it takes to open your shop, on your phone, saved as you go" />
        </div>
      </Wrap>
    </Band>
  );
}

/* ── The money, worked ─────────────────────────────────────────────────────── */

function TheDeal({ terms }: { terms: ReturnType<typeof useSellerTerms> }) {
  const example = 2400;
  return (
    <Band>
      <Wrap wide>
        <div className="agx-sell-two">
          <div>
            <Eyebrow>The whole arrangement</Eyebrow>
            <Display>We only earn when you do.</Display>
            <Text>
              Most marketplaces need a table with nine rows to explain themselves. Here it is one
              line: {terms.commissionPct}% of what the pieces sold for, and only once the order has
              actually reached your customer. Until that happens, we have not earned anything and we
              do not take anything.
            </Text>
            <Text>
              So if a buyer changes her mind, if you have to turn an order down, or if a piece comes
              back — that order costs you nothing at all. No fee on a sale that did not happen has
              always seemed to us like the only fair way to do this.
            </Text>
            <div style={css('margin-top:32px;')}>
              <Link to="/sell/pricing" style={arrowLink}>
                See every charge, worked out on real prices
                <Icon name="arrow_forward" style={css('font-size:20px;')} />
              </Link>
            </div>
          </div>

          <Card>
            <div
              style={css(
                'font-size:12px;font-weight:500;letter-spacing:.2em;text-transform:uppercase;color:var(--ag-muted);' +
                  'padding-bottom:16px;border-bottom:1px solid var(--ag-border);',
              )}
            >
              One delivered order
            </div>
            <LedgerRow label="A saree, priced by you at" value={fmtInr(example)} />
            <LedgerRow
              label={`Platform fee (${terms.commissionPct}%)`}
              value={`− ${fmtInr(terms.cutOf(example))}`}
              negative
              note="This is the only deduction. Nothing else comes off."
            />
            <LedgerRow label="Yours, into your bank" value={fmtInr(terms.netOf(example))} strong />
            <p
              style={css(
                'margin:16px 0 0;padding:16px;background:var(--ag-surface-2);border-radius:0.5rem;' +
                  'font-size:12px;font-weight:500;line-height:1.5;color:var(--ag-muted);',
              )}
            >
              Sent {terms.holdDays} days after it is delivered, straight to the account you
              registered. No invoice to raise, no one to remind, nothing to follow up.
            </p>
          </Card>
        </div>
      </Wrap>
    </Band>
  );
}

/* ── What the fee actually buys ────────────────────────────────────────────── */

/**
 * The answer to "why is it that much?", given before anyone has to ask.
 *
 * A percentage looks like a lot right up until you know what sits behind it,
 * and the instinct to bury the number is exactly wrong — a seller who finds it
 * later feels tricked, and rightly. So the number stays in plain sight two
 * sections earlier and this is where it is justified.
 *
 * Every line below is something the platform genuinely carries. The gateway
 * charge and the tax are the two named in migration 0025's own note on the
 * money model; the rest are real costs of running the marketplace. Nothing
 * here is padded to make the list look longer.
 */
function WhatTheFeeCovers({ terms }: { terms: ReturnType<typeof useSellerTerms> }) {
  return (
    <Band tone="panel">
      <Wrap wide>
        <div className="agx-sell-lean">
          <div>
            <Eyebrow>Fair’s fair</Eyebrow>
            <Display>Where your {terms.commissionPct}% goes.</Display>
            <Text>
              You are trusting us with your livelihood, so you should know what you are paying for
              rather than take it on faith. Here is the honest list — and it is one fee covering all
              of it, not the first of several.
            </Text>
            <Text>
              There is no version of MangaiMart where you pay less by giving something up, because
              there are no plans and no tiers. The newest shop on the site is on exactly the same
              terms as the busiest one.
            </Text>
          </div>

          <div style={css('display:flex;flex-direction:column;gap:40px;')}>
            <IconPoint icon="payments" title="Taking the payment.">
              Every card, UPI and netbanking charge, and the tax on it. On a small order that alone
              is a meaningful slice of the fee.
            </IconPoint>
            <IconPoint icon="search" title="Finding you the buyer.">
              Search, the collection pages, the feed and the work of getting MangaiMart in front of
              people who are shopping for what you make.
            </IconPoint>
            <IconPoint icon="account_balance" title="Holding and moving the money.">
              Safely, and then into your bank automatically after each delivery — with the
              statements to match.
            </IconPoint>
            <IconPoint icon="shield" title="Standing behind the order.">
              The 30-day cover on a faulty or wrong item is what lets a stranger in another state
              risk buying from a shop she has never heard of. That trust is the thing you are
              actually renting.
            </IconPoint>
            <IconPoint icon="support_agent" title="The console and the people.">
              Listings, chat, billing, analytics — and someone to pick up the phone when you need
              them.
            </IconPoint>
          </div>
        </div>
      </Wrap>
    </Band>
  );
}

/* ── Real shops, real pieces ───────────────────────────────────────────────── */

function RealShops({
  boutiques,
  products,
}: {
  boutiques: ReturnType<typeof useCatalog>['boutiques'];
  products: ReturnType<typeof useCatalog>['products'];
}) {
  // Shops with something actually listed. A directory of empty shops is not
  // proof of anything, and this section is here to be proof.
  const shown = useMemo(
    () => boutiques.filter((b) => b.products > 0).slice(0, 6),
    [boutiques],
  );
  if (shown.length === 0) return null;

  const cities = new Set(shown.map((b) => b.city).filter(Boolean));

  return (
    // Page tone, not panel: `WhatTheFeeCovers` above it is already tinted, and
    // two panel bands in a row read as one long block with no section break.
    <Band>
      <Wrap wide>
        <Eyebrow>You’d be in good company</Eyebrow>
        <Display>Real shops, listing real pieces, right now.</Display>
        <Lede>
          Every boutique below is live on the storefront today. Open any of them, read their reviews,
          and see exactly what your own shop page would look like — before you decide anything.
        </Lede>

        <div className="agx-sell-shops" style={css('margin-top:48px;')}>
          {shown.map((b) => (
            <Link
              key={b.id}
              to={`/boutique/${b.slug}`}
              style={css(
                'display:flex;gap:16px;align-items:center;padding:20px;border-radius:0.75rem;text-decoration:none;' +
                  `background:var(--ag-surface);border:1px solid var(--ag-border);box-shadow:${CARD_SHADOW};`,
              )}
            >
              <BoutiqueLogo name={b.name} src={b.logo} size={48} radius={8} />
              <div style={css('min-width:0;')}>
                <div
                  style={css(
                    `font-family:${SERIF};font-weight:600;font-size:18px;line-height:1.3;color:var(--ag-ink);` +
                      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
                  )}
                >
                  {b.name}
                </div>
                <div style={css('margin-top:4px;font-size:12px;font-weight:500;color:var(--ag-muted);')}>
                  {b.city}
                  {b.products > 0 && ` · ${b.products} piece${b.products === 1 ? '' : 's'}`}
                  {b.verified && ' · Verified'}
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div style={css('margin-top:32px;display:flex;flex-wrap:wrap;gap:12px 24px;align-items:center;')}>
          <Link to="/boutiques" style={arrowLink}>
            Browse every shop on MangaiMart
            <Icon name="arrow_forward" style={css('font-size:20px;')} />
          </Link>
          <span style={css('font-size:14px;color:var(--ag-muted);')}>
            {products.length} live piece{products.length === 1 ? '' : 's'}
            {cities.size > 0 && ` across ${cities.size} cit${cities.size === 1 ? 'y' : 'ies'}`}
          </span>
        </div>
      </Wrap>
    </Band>
  );
}

/* ── What is yours, what is ours ───────────────────────────────────────────── */

function Division() {
  return (
    <Band tone="panel">
      <Wrap wide>
        <Eyebrow>Who does what</Eyebrow>
        <Display>You keep the shop. We take the boring half.</Display>
        <Lede>
          Somewhere that decides your prices, your packing and who your customer is isn’t really a
          marketplace — it’s a supplier contract. We’ve drawn the line the other way round.
        </Lede>

        <div className="agx-sell-two" style={css('margin-top:36px;align-items:start;')}>
          <div>
            <h3 style={css(`font-family:${SERIF};font-weight:700;font-size:22px;margin:0;color:var(--ag-ink);`)}>
              Yours to decide
            </h3>
            <PointList>
              <Point>What each piece costs, and when you discount it</Point>
              <Point>What you charge to deliver — four rates, by distance</Point>
              <Point>How many days you need to dispatch, shown to the buyer before she orders</Point>
              <Point>Your own change-of-mind return window</Point>
              <Point>Your shop page: name, logo, story, city — and its own web address to share</Point>
              <Point>Your own coupon codes, run when you want to run them</Point>
              <Point>Whether to answer a buyer’s message yourself. You always can</Point>
            </PointList>
          </div>

          <div>
            <h3 style={css(`font-family:${SERIF};font-weight:700;font-size:22px;margin:0;color:var(--ag-ink);`)}>
              Ours to handle
            </h3>
            <PointList>
              <Point icon="verified_user">Taking the payment, safely, before the order reaches you</Point>
              <Point icon="verified_user">Holding that money and transferring it to your bank after delivery</Point>
              <Point icon="verified_user">Getting your pieces found — search, collections, the Inspire feed</Point>
              <Point icon="verified_user">The buyer’s account, order tracking and refund handling</Point>
              <Point icon="verified_user">Checking every shop before it can list, so buyers trust the ones that pass</Point>
              <Point icon="verified_user">Covering a faulty or wrong item for 30 days, across the marketplace</Point>
              <Point icon="verified_user">The invoices, the statements and the record of every rupee</Point>
            </PointList>
          </div>
        </div>

        <Rule />

        <div className="agx-sell-two" style={css('align-items:start;')}>
          <div>
            <Display size="sm">And the counter you already have</Display>
            <Text>
              The console bills your walk-in customers too. Ring up a sale at the shop, send the bill
              straight to her WhatsApp, and your stock stays right in one place. We charge nothing at
              all on those — that till is yours, and it never touches a payout.
            </Text>
          </div>
          <div>
            <Display size="sm">On the phone in your hand</Display>
            <Text>
              Listing, photos, orders, chat, billing, earnings — all of it works on a phone. Most
              sellers here never open a laptop. There is nothing to install and nothing to buy.
            </Text>
          </div>
        </div>
      </Wrap>
    </Band>
  );
}

/* ── Sellers in their own words ────────────────────────────────────────────── */

/**
 * Renders nothing until there is a real quote to render.
 *
 * See the note on `SELLER_STORIES` in sellContent.ts. An empty section is a
 * page that is missing a section; an invented one is a page that cannot be
 * trusted about anything else on it, including the money.
 */
function SellerVoices() {
  if (SELLER_STORIES.length === 0) return null;
  return (
    <Band tone="panel">
      <Wrap wide>
        <Eyebrow>In their words</Eyebrow>
        <Display>Sellers already here.</Display>
        <div className="agx-sell-quotes" style={css('margin-top:38px;')}>
          {SELLER_STORIES.map((s) => (
            <PullQuote
              key={`${s.shop}-${s.name}`}
              attribution={
                <>
                  <strong style={css('color:var(--ag-ink);')}>{s.name}</strong>
                  {' · '}
                  {s.boutiqueSlug ? (
                    <Link to={`/boutique/${s.boutiqueSlug}`} style={css('color:var(--ag-deep);')}>
                      {s.shop}
                    </Link>
                  ) : (
                    s.shop
                  )}
                  {' · '}
                  {s.city}
                </>
              }
            >
              {s.quote}
            </PullQuote>
          ))}
        </div>
      </Wrap>
    </Band>
  );
}

/* ── What you need ─────────────────────────────────────────────────────────── */

function WhatYouNeed() {
  return (
    <Band>
      <Wrap>
        <Eyebrow>Before you start</Eyebrow>
        <Display>Five things — and you almost certainly have four of them.</Display>
        <Lede>
          No minimum number of pieces, no minimum order value, and you don’t need to be a registered
          company. If you make or stock ethnic wear and you can post a parcel, you’re in.
        </Lede>

        <ul style={css('list-style:none;padding:0;margin:64px 0 0;display:flex;flex-direction:column;gap:24px;')}>
          {WHAT_YOU_NEED.map((item) => (
            <li key={item.need}>
              <Card pad={32} style={css('display:flex;gap:24px;align-items:flex-start;')}>
                {/* The one place a tinted icon circle earns its keep: this is a
                    checklist, and the disc reads as a box to tick. */}
                <div
                  style={css(
                    'width:48px;height:48px;border-radius:9999px;background:var(--ag-surface-3);' +
                      'display:flex;align-items:center;justify-content:center;flex:none;',
                  )}
                >
                  <Icon name={item.icon} style={css('font-size:22px;color:var(--ag-deep);')} />
                </div>
                <div>
                  <div style={css('display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px;')}>
                    <h3 style={css(`${LABEL_LG}color:var(--ag-ink);margin:0;`)}>{item.need}</h3>
                    {!item.required && (
                      <span
                        style={css(
                          'font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;' +
                            'color:var(--ag-muted);background:var(--ag-surface-3);' +
                            'padding:4px 8px;border-radius:0.25rem;',
                        )}
                      >
                        optional
                      </span>
                    )}
                  </div>
                  <p style={css('margin:0;font-size:14px;line-height:1.6;color:var(--ag-ink-2);max-width:62ch;')}>
                    {item.detail}
                  </p>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </Wrap>
    </Band>
  );
}

/* ── Close ─────────────────────────────────────────────────────────────────── */

function ClosingBand() {
  return (
    <Band>
      <Wrap wide>
        <DeepPanel>
          <div className="agx-sell-two" style={css('align-items:center;')}>
            <div>
              <Eyebrow onDeep>Whenever you’re ready</Eyebrow>
              <Display onDeep size="md">
                Eight short steps, and you can stop after any of them.
              </Display>
              <Lede onDeep>
                Nothing is charged and nothing is committed. Your shop only goes live once one of us
                has looked it over and you’ve listed your first piece — so there is no way to end up
                somewhere you didn’t mean to be.
              </Lede>
              <CtaPair
                to={START_SELLING}
                label="Open your boutique"
                secondaryTo="/sell/faq"
                secondaryLabel="I have questions first"
                onDeep
              />
            </div>
            <div>
              <PointList>
                <Point onDeep icon="schedule">About fifteen minutes, on your phone</Point>
                <Point onDeep icon="save">Saved as you go — close it and come back later</Point>
                <Point onDeep icon="payments">No card asked for, nothing to pay</Point>
                <Point onDeep icon="support_agent">
                  Stuck anywhere? Call or WhatsApp us and a real person will walk you through it
                </Point>
              </PointList>
            </div>
          </div>
        </DeepPanel>
      </Wrap>
    </Band>
  );
}
