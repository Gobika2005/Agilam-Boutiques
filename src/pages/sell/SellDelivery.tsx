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
  LABEL_LG,
  LABEL_SM,
  Point,
  PointList,
  Rule,
  SERIF,
  Step,
  Text,
  Wrap,
} from './parts';
import { START_SELLING } from './sellContent';
import { useSellerTerms } from './useSellerTerms';

/**
 * `/sell/delivery-and-payouts` — the two things a seller worries about most.
 *
 * The delivery model here is unusual enough among marketplaces that it has to
 * be explained rather than asserted: MangaiMart does not take the parcel. The
 * seller sets four rates by distance (migrations 0076 and 0077), sets their own
 * dispatch window and return window (0078), and arranges the courier. What the
 * platform owns is the money — collecting it up front and releasing it after
 * delivery — and that half is described with the live hold and promise from
 * `platform_settings`.
 *
 * The zone names below mirror `resolveZone` in `src/lib/deliveryZone.ts` and
 * `zoneFor` in `api/_pricing.js`. If a band is ever added or renamed there, it
 * has to change here too or the page is describing a checkout that no longer
 * exists.
 */
export function SellDelivery() {
  const terms = useSellerTerms();

  usePageMeta({
    title: 'Delivery & Payouts for Sellers — How Both Work',
    description:
      'You set four delivery rates by distance, your own dispatch window and your own return window. MangaiMart collects the money up front and transfers it to your bank after delivery.',
    canonical: '/sell/delivery-and-payouts',
    schema: graph(
      organizationSchema(),
      breadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Sell on MangaiMart', path: '/sell' },
        { name: 'Delivery & payouts', path: '/sell/delivery-and-payouts' },
      ]),
    ),
  });

  return (
    <>
      <Band>
        <Wrap>
          <Eyebrow>Delivery &amp; money</Eyebrow>
          <Display level={1} size="lg">
            You decide how far you deliver. We decide nothing about your parcel.
          </Display>
          <Lede>
            Most marketplaces take the parcel off you and hand back a fee. MangaiMart does not. The
            piece leaves your shop the way you send it, at a rate you set, in a window you promised —
            and the money for it is already collected before you pack.
          </Lede>
        </Wrap>
      </Band>

      {/* ── The four bands ─────────────────────────────────────────────── */}
      <Band tone="panel">
        <Wrap wide>
          <Eyebrow>Delivery, part one</Eyebrow>
          <Display>Four rates, chosen by the buyer’s pincode.</Display>
          <Lede>
            You type in four numbers once. At checkout, her pincode is matched against your shop’s
            address and the right one is applied automatically — you never quote a rate by hand.
          </Lede>

          <div
            className="agx-sell-table-scroll"
            style={css('margin-top:40px;border:1px solid var(--ag-border);border-radius:0.75rem;background:var(--ag-surface);overflow:hidden;')}
          >
            <table className="agx-sell-table">
              <thead>
                <tr>
                  <th scope="col">Band</th>
                  <th scope="col">Who it covers</th>
                  <th scope="col">Free over your threshold?</th>
                </tr>
              </thead>
              <tbody>
                <ZoneRow band="Local" covers="Buyers in your own town or city — the address you registered the shop at." free />
                <ZoneRow band="District" covers="The rest of your district. Usually a courier, occasionally still your own delivery boy." free />
                <ZoneRow band="State" covers="Anywhere else in your state." />
                <ZoneRow band="National" covers="The rest of India." />
              </tbody>
            </table>
          </div>

          <div className="agx-sell-two" style={css('margin-top:48px;')}>
            <div>
              <Display size="sm">Leaving a band blank</Display>
              <Text>
                It means you do not deliver there, and it is a real setting rather than an oversight.
                A buyer outside the bands you filled in cannot place the order at all — so you are
                never handed a parcel you have no way to send.
              </Text>
            </div>
            <div>
              <Display size="sm">Free delivery, if you want it</Display>
              <Text>
                Set an order value above which local and district buyers pay nothing to have it sent.
                It is the simplest way to lift a small order into a bigger one, and it is entirely
                optional — leave it off and your normal rates always apply.
              </Text>
            </div>
          </div>
        </Wrap>
      </Band>

      {/* ── Dispatch and the courier ───────────────────────────────────── */}
      <Band>
        <Wrap>
          <Eyebrow>Delivery, part two</Eyebrow>
          <Display>Your dispatch window is a promise you write yourself.</Display>
          <Text>
            You set how many days you need to get a parcel out — two to four, or one to two, or
            whatever is true of your shop. That window is printed on every product page before the
            buyer orders, so a piece that needs finishing is not a broken promise. Transit time after
            dispatch is estimated by MangaiMart from the distance, and is shown separately, because
            that part is not yours to be judged on.
          </Text>

          <PointList>
            <Point icon="local_shipping">
              <strong>Book a courier from the dashboard.</strong> Pick up, label, tracking number —
              done from the order itself, without leaving the console.
            </Point>
            <Point icon="directions_bike">
              <strong>Or send a local order yourself.</strong> Your own delivery boy, your own auto,
              the way you already do it. Record who took it and the buyer can still follow it.
            </Point>
            <Point icon="pin_drop">
              <strong>Tracking is not optional.</strong> The tracking record is what confirms delivery,
              and confirmed delivery is what releases your money — so it protects you before it
              protects anyone else.
            </Point>
          </PointList>

          <Rule />

          <Display size="sm">Returns</Display>
          <Text>
            Your change-of-mind window is yours to set, including a short one, and it is shown on
            every one of your product pages so a buyer knows before she orders. Separately, and for
            the whole marketplace, MangaiMart covers a faulty or wrong item for 30 days. That cover
            is not a cost you can opt out of, and it is also the reason a stranger three states away
            is willing to buy from a shop she has never heard of.
          </Text>
        </Wrap>
      </Band>

      {/* ── Payouts ────────────────────────────────────────────────────── */}
      <Band tone="panel">
        <Wrap wide>
          <Eyebrow>The money</Eyebrow>
          <Display>Collected before you pack. Released after it arrives.</Display>
          <Lede>
            There is no cash on delivery on MangaiMart, so there is no order in your list that might
            still turn out not to be an order. Every one of them is already paid.
          </Lede>

          <div className="agx-sell-lean" style={css('margin-top:48px;')}>
            <ol style={css('list-style:none;padding:0;margin:0;')}>
              <Step n={1} title="She pays, we hold it">
                The full amount is taken online at checkout and held by MangaiMart. Nothing about that
                payment is your problem — not the gateway, not the failure retries, not the refund if
                she changes her mind before dispatch.
              </Step>
              <Step n={2} title="Delivery is confirmed">
                Against the courier’s record. A payout is not released on an undelivered order, and
                that rule has no exceptions — including for us.
              </Step>
              <Step
                n={3}
                title={`${terms.holdDays}-day hold, then it moves`}
                aside={`Once a payout is due we hold ourselves to ${terms.slaHours} hours. The countdown is visible in your console, so you can see it rather than wonder about it.`}
              >
                The hold is the window in which a delivery problem would normally surface. After it,
                the transfer goes to the bank account you registered — automatically, with no request
                from you and no invoice to raise.
              </Step>
              <Step n={4} title="Every rupee is on the statement">
                Per order and per piece: what it sold for, what fee was taken, what was transferred
                and when. Your walk-in bills sit alongside it, marked as yours, outside the payout
                entirely.
              </Step>
            </ol>

            <div
              style={css(
                'background:var(--ag-surface);border:1px solid var(--ag-border);border-radius:22px;padding:clamp(22px,3vw,28px);height:fit-content;',
              )}
            >
              <div style={css(`${LABEL_SM}color:var(--ag-muted);padding-bottom:16px;border-bottom:1px solid var(--ag-border);`)}>
                A delivered order, in full
              </div>
              <LedgerRow label="Two pieces, sold at" value={fmtInr(3200)} />
              {/* The note stops at what is certainly true: the fee is computed
                  on `orders.total`, which is the goods value — `shipping_fee`
                  is a separate column and is not in it. Where the delivery
                  charge itself ends up is an open decision; see the long
                  comment in SellPricing.tsx before adding a line about it
                  here. */}
              <LedgerRow
                label={`Platform fee (${terms.commissionPct}%)`}
                value={`− ${fmtInr(terms.cutOf(3200))}`}
                negative
                note="Charged on the goods value only. The delivery charge is billed to your buyer separately, on top, and is never part of this sum."
              />
              <LedgerRow label="Transferred to your bank" value={fmtInr(terms.netOf(3200))} strong />
              <div style={css('margin-top:16px;font-size:13px;line-height:1.62;color:var(--ag-muted);')}>
                {terms.holdDays} days after delivery is confirmed, within {terms.slaHours} hours of
                falling due.
              </div>
            </div>
          </div>

          <Rule />

          <Display size="sm">What would hold a payout up</Display>
          <PointList>
            <Point icon="pending">An order that has not been delivered yet — nothing is released early.</Point>
            <Point icon="report">
              A delivery the buyer has disputed. We look at the tracking record with you before
              anything is decided either way.
            </Point>
            <Point icon="account_balance">
              Bank details that do not match. Get the account number and IFSC right at setup and this
              never happens; get it wrong and the transfer bounces back to us.
            </Point>
          </PointList>
        </Wrap>
      </Band>

      <Band>
        <Wrap>
          <Display>Your side of it, in one line.</Display>
          <Text>
            Set four rates, promise a dispatch window you can keep, send the parcel, record the
            tracking. Everything after that is ours.
          </Text>
          <CtaPair
            to={START_SELLING}
            label="Open your boutique"
            secondaryTo="/sell/faq"
            secondaryLabel="Still have questions?"
          />
        </Wrap>
      </Band>
    </>
  );
}

function ZoneRow({ band, covers, free }: { band: string; covers: string; free?: boolean }) {
  return (
    <tr>
      <td style={css(`font-family:${SERIF};font-size:16px;font-weight:700;color:var(--ag-ink);white-space:nowrap;`)}>{band}</td>
      <td style={css('color:var(--ag-ink-2);')}>{covers}</td>
      <td
        style={css(
          `${LABEL_LG}white-space:nowrap;` +
            `color:${free ? 'var(--ag-good-text)' : 'var(--ag-muted)'};`,
        )}
      >
        {free ? 'Yes' : 'No'}
      </td>
    </tr>
  );
}
