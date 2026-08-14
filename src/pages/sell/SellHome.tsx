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
  IconPoint,
  LABEL_LG,
  LedgerRow,
  Lede,
  Point,
  PointList,
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
      <Hero terms={terms} />
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
 * The hero — a flat berry block, the copy at two-thirds, a photograph at one.
 *
 * The photograph is the only asset on this site that is not either type or live
 * data, and it is deliberately a single committed file rather than anything
 * pulled from the catalogue: it is meant to be a styled shot of a boutique — a
 * rail of sarees, a counter, a shop with someone in it — which is what a seller
 * is being asked to picture herself in. A product cut-out would say "shop here"
 * to a reader who is not shopping.
 *
 * See `HERO_PHOTO`. It is optional at runtime: if the file is missing the whole
 * art column removes itself and the hero becomes the single-column type-only
 * card it was before, at full width. That is a real fallback, not a broken
 * image — the page is complete either way.
 */
function Hero({ terms }: { terms: ReturnType<typeof useSellerTerms> }) {
  return (
    <Band>
      <Wrap wide style={css('padding-bottom:clamp(24px,3vw,40px);')}>
        <DeepPanel>
          <div className="agx-sell-hero">
            <div>
              <Eyebrow onDeep>For boutique owners</Eyebrow>
              <Display level={1} size="lg" onDeep style={css('margin-top:24px;')}>
                Your boutique, open to all of India.
              </Display>
              <Lede onDeep style={css('max-width:52ch;')}>
                Keep your shop, your name, your pieces and your regulars exactly as they are. We
                bring you buyers who are already looking for what you make, collect their money
                before you pack, and send it to your bank once it arrives. That is the whole idea.
              </Lede>

              <CtaPair
                to={START_SELLING}
                label="Open your boutique — it’s free"
                secondaryTo="/sell/how-it-works"
                secondaryLabel="Show me how it works"
                onDeep
              />

              <div className="agx-sell-hero-notes">
                <HeroNote icon="schedule">About fifteen minutes, on your phone</HeroNote>
                <HeroNote icon="credit_card_off">Nothing to pay today, or any month</HeroNote>
                <HeroNote icon="bolt">Just {terms.commissionPct}% when an order is delivered</HeroNote>
              </div>
            </div>

            <HeroArt />
          </div>
        </DeepPanel>
      </Wrap>
    </Band>
  );
}

/**
 * Where the hero photograph is expected to live.
 *
 * A plain path into `public/`, so dropping the file in and rebuilding is the
 * whole of it — no import, no code change. Portrait-ish and at least 1200px on
 * the short edge; it is painted into a square frame with `object-fit:cover`, so
 * the subject wants to be near the middle.
 */
const HERO_PHOTO = '/sell-hero.webp';

function HeroArt() {
  // `hidden` starts false so the frame is laid out immediately and the photo
  // paints as soon as it decodes. If the file is not there, `onError` fires and
  // the whole column unmounts — `.agx-sell-hero` then collapses to one column
  // and the copy takes the full width, which is a deliberate layout, not a gap.
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <div className="agx-sell-hero-art">
      <div
        style={css(
          `position:relative;width:100%;aspect-ratio:1;overflow:hidden;border-radius:1.5rem;` +
            'transform:rotate(3deg);box-shadow:0 18px 40px -20px rgba(0,0,0,.45);',
        )}
      >
        <img
          src={HERO_PHOTO}
          alt="A MangaiMart boutique"
          width={720}
          height={720}
          decoding="async"
          onError={() => setHidden(true)}
          style={css('width:100%;height:100%;object-fit:cover;display:block;')}
        />
        {/* A whisper of the brand colour over the photo, so a shot in any
            colour temperature still sits inside the berry block. */}
        <div
          aria-hidden="true"
          style={css('position:absolute;inset:0;background:var(--ag-deep);opacity:.1;mix-blend-mode:multiply;')}
        />
      </div>
    </div>
  );
}

function HeroNote({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <span style={css('display:inline-flex;align-items:center;gap:8px;')}>
      <Icon name={icon} style={css("font-size:16px;color:var(--ag-gold-border);font-variation-settings:'wght' 200;")} />
      {children}
    </span>
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
          <Figure value="₹0" label="To join, to list your pieces, and every month after that" />
          <Figure
            value={`${terms.commissionPct}%`}
            label="The platform fee — charged only when an order actually reaches your customer"
          />
          <Figure value="100%" label="Of orders paid online before they ever reach you. No cash to chase" />
          <Figure
            value={`${terms.slaHours} hrs`}
            label={`What we hold ourselves to once a payout is due, ${terms.holdDays} days after delivery`}
          />
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
