import { useMemo } from 'react';
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
  CtaPair,
  DeepPanel,
  Display,
  Eyebrow,
  Figure,
  LedgerRow,
  Lede,
  MONO,
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
 * The hero.
 *
 * Deliberately a single contained gradient card with nothing but type in it —
 * the same shape language as the storefront's home hero (`HERO_R`/the crimson
 * gradient and the thin gold inset ring in `src/pages/buyer/Home.tsx`), so a
 * seller who has seen the shop recognises the house.
 *
 * It used to be a collage of three live product photographs. Removed on the
 * owner's call, and the page is better for it: this hero has one job, which is
 * to say what the offer is and put a button under it. Photographs of sarees
 * also sell the wrong thing here — the reader is not shopping, she is deciding
 * whether to trust us, and pretty pictures of other people's stock do not
 * answer that. Nothing in this section fetches anything, so it paints on the
 * first frame with no layout shift and no dependency on the catalogue loading.
 */
function Hero({ terms }: { terms: ReturnType<typeof useSellerTerms> }) {
  return (
    <Band>
      <Wrap wide style={css('padding-bottom:clamp(24px,3vw,36px);')}>
        <div
          style={css(
            'position:relative;border-radius:clamp(26px,3.2vw,44px);overflow:hidden;' +
              'background:linear-gradient(120deg,#8E1C44,#B02454 55%,#D6336C);color:#fff;' +
              'box-shadow:0 26px 54px -32px var(--ag-shadow),inset 0 0 0 1px rgba(226,190,120,.3);' +
              'padding:clamp(34px,6vw,84px) clamp(24px,5vw,72px);',
          )}
        >
          <div style={css('max-width:760px;')}>
            <Eyebrow onDeep>For boutique owners</Eyebrow>
            <Display level={1} size="lg" onDeep style={css('margin-top:16px;')}>
              Your boutique, open to all of India.
            </Display>
            <Lede onDeep style={css('max-width:56ch;')}>
              Keep your shop, your name, your pieces and your regulars exactly as they are. We bring
              you buyers who are already looking for what you make, collect their money before you
              pack, and send it to your bank once it arrives. That is the whole idea.
            </Lede>

            <CtaPair
              to={START_SELLING}
              label="Open your boutique — it’s free"
              secondaryTo="/sell/how-it-works"
              secondaryLabel="Show me how it works"
              onDeep
            />

            <div
              style={css(
                'margin-top:26px;display:flex;flex-wrap:wrap;gap:10px 22px;font-size:13.5px;' +
                  'color:rgba(255,255,255,.82);',
              )}
            >
              <HeroNote icon="schedule">About fifteen minutes, on your phone</HeroNote>
              <HeroNote icon="savings">Nothing to pay today, or any month</HeroNote>
              <HeroNote icon="bolt">
                Just {terms.commissionPct}% when an order is delivered
              </HeroNote>
            </div>
          </div>
        </div>
      </Wrap>
    </Band>
  );
}

function HeroNote({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <span style={css('display:inline-flex;align-items:center;gap:8px;')}>
      <Icon name={icon} style={css('font-size:18px;color:#F4D9A6;')} />
      {children}
    </span>
  );
}

/* ── The four numbers ──────────────────────────────────────────────────────── */

function Mechanics({ terms }: { terms: ReturnType<typeof useSellerTerms> }) {
  return (
    <Band tone="panel">
      <Wrap wide style={css('padding-top:clamp(34px,4vw,52px);padding-bottom:clamp(34px,4vw,52px);')}>
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
            <div style={css('margin-top:26px;')}>
              <Link
                to="/sell/pricing"
                style={css('font-size:14.5px;font-weight:700;color:var(--ag-deep);display:inline-flex;align-items:center;gap:7px;')}
              >
                See every charge, worked out on real prices
                <Icon name="arrow_forward" style={css('font-size:18px;')} />
              </Link>
            </div>
          </div>

          <div
            style={css(
              'background:var(--ag-surface);border:1px solid var(--ag-border);border-radius:22px;padding:clamp(22px,3vw,30px);',
            )}
          >
            <div style={css(`font-family:${MONO};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ag-muted);`)}>
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
            <div style={css('margin-top:18px;font-size:13px;line-height:1.6;color:var(--ag-muted);')}>
              Sent {terms.holdDays} days after it is delivered, straight to the account you
              registered. No invoice to raise, no one to remind, nothing to follow up.
            </div>
          </div>
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

          <PointList>
            <Point icon="credit_card">
              <strong>Taking the payment.</strong> Every card, UPI and netbanking charge, and the tax
              on it. On a small order that alone is a meaningful slice of the fee.
            </Point>
            <Point icon="travel_explore">
              <strong>Finding you the buyer.</strong> Search, the collection pages, the feed and the
              work of getting MangaiMart in front of people who are shopping for what you make.
            </Point>
            <Point icon="account_balance">
              <strong>Holding and moving the money.</strong> Safely, and then into your bank
              automatically after each delivery — with the statements to match.
            </Point>
            <Point icon="shield">
              <strong>Standing behind the order.</strong> The 30-day cover on a faulty or wrong item
              is what lets a stranger in another state risk buying from a shop she has never heard
              of. That trust is the thing you are actually renting.
            </Point>
            <Point icon="support_agent">
              <strong>The console and the people.</strong> Listings, chat, billing, analytics — and
              someone to pick up the phone when you need them.
            </Point>
          </PointList>
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

        <div className="agx-sell-shops" style={css('margin-top:34px;')}>
          {shown.map((b) => (
            <Link
              key={b.id}
              to={`/boutique/${b.slug}`}
              style={css(
                'display:flex;gap:14px;align-items:center;padding:16px;border-radius:18px;text-decoration:none;' +
                  'background:var(--ag-surface);border:1px solid var(--ag-border);',
              )}
            >
              <BoutiqueLogo name={b.name} src={b.logo} size={46} radius={13} />
              <div style={css('min-width:0;')}>
                <div
                  style={css(
                    `font-family:${SERIF};font-weight:700;font-size:16.5px;color:var(--ag-ink);` +
                      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',
                  )}
                >
                  {b.name}
                </div>
                <div style={css('margin-top:3px;font-size:12.5px;color:var(--ag-muted);')}>
                  {b.city}
                  {b.products > 0 && ` · ${b.products} piece${b.products === 1 ? '' : 's'}`}
                  {b.verified && ' · Verified'}
                </div>
              </div>
            </Link>
          ))}
        </div>

        <div style={css('margin-top:26px;display:flex;flex-wrap:wrap;gap:10px 24px;align-items:center;')}>
          <Link to="/boutiques" style={css('font-size:14px;font-weight:700;color:var(--ag-deep);')}>
            Browse every shop on MangaiMart →
          </Link>
          <span style={css('font-size:13px;color:var(--ag-muted);')}>
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

        <ul style={css('list-style:none;padding:0;margin:36px 0 0;')}>
          {WHAT_YOU_NEED.map((item) => (
            <li key={item.need} style={css('padding:20px 0;border-top:1px solid var(--ag-border);')}>
              <div style={css('display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;')}>
                <span style={css('font-size:16.5px;font-weight:700;color:var(--ag-ink);')}>{item.need}</span>
                {!item.required && (
                  <span
                    style={css(
                      `font-family:${MONO};font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;` +
                        'color:var(--ag-good-text);background:var(--ag-good-bg);padding:3px 8px;border-radius:6px;',
                    )}
                  >
                    optional
                  </span>
                )}
              </div>
              <p style={css('margin:8px 0 0;font-size:14.5px;line-height:1.65;color:var(--ag-ink-2);max-width:62ch;')}>
                {item.detail}
              </p>
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
