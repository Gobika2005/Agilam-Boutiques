import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { graph, organizationSchema, breadcrumbSchema } from '@/lib/schema';
import { fmtInr } from '@/lib/tokens';
import {
  Band,
  CtaPair,
  Display,
  Eyebrow,
  LedgerRow,
  Lede,
  MONO,
  Point,
  PointList,
  Rule,
  SERIF,
  Text,
  Wrap,
} from './parts';
import { START_SELLING } from './sellContent';
import { useSellerTerms } from './useSellerTerms';

/**
 * `/sell/pricing` — what MangaiMart charges, with nothing left out.
 *
 * The fee, the payout hold and the ad rates are all read live (see
 * `useSellerTerms`). Nothing on this page is a typed-in number except the three
 * example prices, which are only there to make the arithmetic legible.
 *
 * The worked examples deliberately use `terms.cutOf`/`terms.netOf` rather than
 * doing the sum inline, so the column always adds up on screen even when the
 * rate is one that does not divide neatly.
 *
 * "Platform fee", never "commission" — see the note at the top of
 * `sellContent.ts`. The number is not softened anywhere on this page; it is
 * explained instead. Hiding it would be the one thing worse than the number.
 */

/** Three prices that bracket what boutiques here actually list at. */
const EXAMPLES = [899, 2400, 6500];

export function SellPricing() {
  const terms = useSellerTerms();

  usePageMeta({
    title: 'Seller Pricing — Free to List, Pay Only on Delivery',
    description:
      'What it costs to sell on MangaiMart: nothing to join, nothing to list, no monthly fee. One small platform fee on delivered orders, worked out on real prices so you can see it clearly.',
    canonical: '/sell/pricing',
    schema: graph(
      organizationSchema(),
      breadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Sell on MangaiMart', path: '/sell' },
        { name: 'What it costs', path: '/sell/pricing' },
      ]),
    ),
  });

  return (
    <>
      <Band>
        <Wrap>
          <Eyebrow>What it costs</Eyebrow>
          <Display level={1} size="lg">
            Nothing at all, until something sells and arrives.
          </Display>
          <Lede>
            There is exactly one charge here, and it is a share of what you actually sold. No
            registration fee, no monthly fee, nothing to list, nothing for taking the payment, and no
            plan to upgrade to — because there are no plans. This page shows you the whole of it.
          </Lede>
        </Wrap>
      </Band>

      {/* ── The one charge ─────────────────────────────────────────────── */}
      <Band tone="panel">
        <Wrap wide>
          <div className="agx-sell-lean">
            <div>
              <Eyebrow>The only charge</Eyebrow>
              <Display>
                A {terms.commissionPct}% platform fee, once the order arrives.
              </Display>
              <Text>
                It applies to the goods value — what the pieces sold for, the same figure your buyer
                sees against the items in her order. Delivery is billed to her separately, on top, so
                it is never part of this sum.
              </Text>
              <Text>
                And that {terms.commissionPct}% is the whole of our side. It already covers the
                payment gateway’s charge and the tax we owe on it, which is why you will not find a
                second line for “payment handling” or GST on a fee anywhere below. One deduction,
                once, on an order that actually reached your customer.
              </Text>

              <PointList>
                <Point icon="do_not_disturb_on">
                  <strong>Cancelled, rejected or refunded?</strong> You pay nothing. The fee only
                  applies on delivery, so an order that came undone costs you nothing at all.
                </Point>
                <Point icon="storefront">
                  <strong>Your walk-in customers?</strong> Nothing there either. Counter bills are
                  your own till and never enter a payout.
                </Point>
                <Point icon="local_offer">
                  <strong>Running your own coupon?</strong> Your offer, your call — so it comes off
                  your side. Our own platform-wide coupons are funded by us and never reduce what you
                  are paid.
                </Point>
              </PointList>
            </div>

            <div
              style={css(
                'background:var(--ag-surface);border:1px solid var(--ag-border);border-radius:22px;padding:clamp(22px,3vw,28px);',
              )}
            >
              <div style={css(`font-family:${MONO};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--ag-muted);`)}>
                Worked out
              </div>
              <div style={css('margin-top:6px;font-size:13.5px;line-height:1.6;color:var(--ag-muted);')}>
                What reaches your bank on three ordinary orders. No small print under it.
              </div>

              {EXAMPLES.map((price) => (
                <div key={price} style={css('margin-top:22px;')}>
                  <div style={css(`font-family:${SERIF};font-size:17px;font-weight:700;color:var(--ag-ink);`)}>
                    A piece at {fmtInr(price)}
                  </div>
                  <LedgerRow
                    label={`Platform fee (${terms.commissionPct}%)`}
                    value={`− ${fmtInr(terms.cutOf(price))}`}
                    negative
                  />
                  <LedgerRow label="Yours" value={fmtInr(terms.netOf(price))} strong />
                </div>
              ))}
            </div>
          </div>
        </Wrap>
      </Band>

      {/* ── Not charged ────────────────────────────────────────────────── */}
      <Band>
        <Wrap wide>
          <Eyebrow>On the house</Eyebrow>
          <Display>Everything here is included, and stays included.</Display>
          <Lede>
            Not free for the first month, not free on a starter plan that quietly ends. There is one
            price list on MangaiMart, it is this one, and it is the same for every shop on the site.
          </Lede>

          <div className="agx-sell-three" style={css('margin-top:34px;')}>
            <FreeCard
              title="Being here"
              items={['Registration', 'Verification', 'Your shop page', 'A web address to share']}
            />
            <FreeCard
              title="Running the shop"
              items={['Unlimited listings', 'Photo hosting', 'The seller console', 'Counter billing', 'Buyer chat']}
            />
            <FreeCard
              title="Getting paid"
              items={['Payment collection', 'Bank transfers', 'Invoices and statements', 'Refund handling']}
            />
          </div>
        </Wrap>
      </Band>

      {/* ── Optional: ads ──────────────────────────────────────────────── */}
      <AdRates terms={terms} />

      {/* ── Where the money goes ───────────────────────────────────────── */}
      <Band>
        <Wrap>
          <Eyebrow>Being straight with you</Eyebrow>
          <Display>Two costs that are yours, not ours.</Display>
          <Text>
            We would much rather you heard this from us now than discovered it in month two. Selling
            online has real costs, and two of them are not ours to charge you or to waive:
          </Text>

          <PointList>
            {/*
              ── OPEN DECISION — read before editing this paragraph ──────────
              It does not say who ends up with the delivery charge, and that is
              on purpose, not an oversight in the writing.

              Migration 0076 made delivery the SELLER'S: the seller sets the
              four rates and arranges the courier. But `settle_boutique_payout`
              (still on the 0025 model, last redefined in 0078) pays out
              `total − fee` and only RECORDS `shipping_fee` in
              `payouts.fees` — it is not added to the seller's amount. So today
              the platform collects the seller's delivery charge and the seller
              pays the courier out of the goods money.

              That looks like 0076 having outrun the payout function rather
              than a decision anybody made. Until it is settled one way or the
              other, this page must not claim either — "you keep the delivery
              fee" would be false today, and "we keep it" would publish what is
              probably a bug. Once the owner decides, say it plainly here and on
              /sell/delivery-and-payouts.
            */}
            <Point icon="local_shipping">
              <strong>Getting the parcel there.</strong> You set the delivery charge the buyer pays,
              in four bands by distance, and you arrange the courier yourself — so what a courier
              charges you is a real cost of selling, here as anywhere else.
            </Point>
            <Point icon="inventory_2">
              <strong>Packing it properly.</strong> A cover, a filler, something that survives a van.
              Small, and it is the difference between a five-star review and a return.
            </Point>
          </PointList>

          <Rule />

          <Display size="sm">And what a return costs you</Display>
          <Text>
            Your change-of-mind window is yours to set, so how exposed you are to returns is
            genuinely your call. Separately, we cover a faulty or wrong item for 30 days right across
            the marketplace. We know that sounds like it only helps the buyer — but it is the reason
            a woman three states away is willing to try a shop she has never heard of, and that is
            the whole business you are joining.
          </Text>

          <CtaPair
            to={START_SELLING}
            label="Open your boutique"
            secondaryTo="/sell/delivery-and-payouts"
            secondaryLabel="How delivery and payouts work"
          />
        </Wrap>
      </Band>
    </>
  );
}

function FreeCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div style={css('border-top:2px solid var(--ag-crimson);padding-top:18px;')}>
      <h3 style={css(`font-family:${SERIF};font-weight:700;font-size:19px;margin:0;color:var(--ag-ink);`)}>{title}</h3>
      <ul style={css('list-style:none;padding:0;margin:14px 0 0;display:flex;flex-direction:column;gap:9px;')}>
        {items.map((i) => (
          <li key={i} style={css('display:flex;align-items:baseline;gap:9px;font-size:14.5px;color:var(--ag-ink-2);')}>
            <span
              style={css(
                `font-family:${MONO};font-size:12px;font-weight:600;color:var(--ag-good-text);flex:none;`,
              )}
            >
              ₹0
            </span>
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The advertising rate card, straight off `ad_placements`.
 *
 * Hidden entirely when there are no active placements — which is also what
 * happens if migration 0032 has not been applied. Ads are the only other way
 * MangaiMart earns from a seller and the only thing on the site a seller can
 * choose to pay for, so the rates belong on the pricing page rather than being
 * discoverable only after signing up.
 */
function AdRates({ terms }: { terms: ReturnType<typeof useSellerTerms> }) {
  if (terms.placements.length === 0) return null;
  return (
    <Band tone="panel">
      <Wrap wide>
        <Eyebrow>Optional, and only if you want it</Eyebrow>
        <Display>Paid placement, at a flat rate per day.</Display>
        <Lede>
          You never have to buy this and nothing is throttled if you do not. It is a fixed day rate
          for a fixed slot — not an auction, not a bid, and not a percentage of anything. You choose
          the number of days, pay for them up front, and the slot runs.
        </Lede>

        <div className="agx-sell-table-scroll" style={css('margin-top:30px;border:1px solid var(--ag-border);border-radius:18px;background:var(--ag-surface);')}>
          <table className="agx-sell-table">
            <thead>
              <tr>
                <th scope="col">Where it shows</th>
                <th scope="col">What it is</th>
                <th scope="col">Per day</th>
              </tr>
            </thead>
            <tbody>
              {terms.placements.map((p) => (
                <tr key={p.code}>
                  <td style={css('font-weight:700;color:var(--ag-ink);')}>{p.name}</td>
                  <td style={css('color:var(--ag-ink-2);')}>{p.description || '—'}</td>
                  <td style={css(`font-family:${MONO};font-weight:600;color:var(--ag-deep);white-space:nowrap;`)}>
                    {fmtInr(p.daily_rate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={css('margin-top:16px;font-size:13px;line-height:1.6;color:var(--ag-muted);max-width:62ch;')}>
          Rates are set by MangaiMart and shown here exactly as they are charged in the console. Every
          campaign is reviewed before it runs, and a slot that is full simply cannot be bought until
          it frees up — nobody outbids you out of a slot you have paid for.
        </div>
      </Wrap>
    </Band>
  );
}
