import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { graph, organizationSchema, breadcrumbSchema } from '@/lib/schema';
import {
  Band,
  CtaPair,
  Display,
  Eyebrow,
  Lede,
  LABEL_SM,
  Point,
  PointList,
  SERIF,
  Step,
  Text,
  Wrap,
} from './parts';
import { START_SELLING } from './sellContent';
import { useSellerTerms } from './useSellerTerms';

/**
 * `/sell/how-it-works` — the whole thing, once, in order.
 *
 * Written for someone who has never sold online. That means no "onboarding",
 * no "catalogue", no "SKU", no "fulfilment" — every step says what the seller
 * physically does and what happens on our side, and the steps are the real
 * ones from `SellerOnboarding` and the order lifecycle, not a marketing
 * simplification of them.
 */
export function SellHowItWorks() {
  const terms = useSellerTerms();

  usePageMeta({
    title: 'How Selling on MangaiMart Works — Step by Step',
    description:
      'From creating your login to money reaching your bank: every step of selling on MangaiMart, what you do, what we do, and how long each part takes.',
    canonical: '/sell/how-it-works',
    schema: graph(
      organizationSchema(),
      breadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Sell on MangaiMart', path: '/sell' },
        { name: 'How it works', path: '/sell/how-it-works' },
      ]),
    ),
  });

  return (
    <>
      <Band>
        <Wrap>
          <Eyebrow>Start to finish</Eyebrow>
          <Display level={1} size="lg">
            From your first photograph to money in your bank.
          </Display>
          <Lede>
            Nothing below is a summary. This is the actual sequence — the same steps you will see on
            the screen, in the order you will see them — so there is no part of this you find out
            about after you have committed to it.
          </Lede>
        </Wrap>
      </Band>

      {/* ── Setting up ───────────────────────────────────────────────────── */}
      <Band tone="panel">
        <Wrap>
          <Eyebrow>Part one · Opening the shop</Eyebrow>
          <Display>Once, at the beginning. About fifteen minutes.</Display>

          <ol style={css('list-style:none;padding:0;margin:48px 0 0;')}>
            <Step n={1} title="Create your login">
              Your name, your phone number, an email address and a password. That is the account you
              will manage the shop with. Nothing about the boutique is asked yet.
            </Step>

            <Step
              n={2}
              title="Tell us about the boutique"
              aside="Everything from here is saved the moment you move to the next step. Close the page, run the shop, come back in the evening — it opens exactly where you left it."
            >
              Seven short screens: the shop’s name and what it is known for; how customers reach you;
              the shop address with a map pin; your business details; your timings and delivery
              rates; the bank account payouts go to; and a final read-through before you send it.
            </Step>

            <Step
              n={3}
              title="A person at MangaiMart checks it"
              aside="If something is wrong, you are told exactly which field and why — not simply 'rejected'. Fix it and resubmit; you do not start again."
            >
              We look at the details you gave and confirm the shop is real and reachable. This is the
              step buyers are actually paying for when they trust a shop they have never heard of, so
              it is done properly rather than instantly.
            </Step>

            <Step n={4} title="List your first pieces">
              Photograph, price, fabric, occasion, sizes, stock. Add a piece in a couple of minutes,
              and it appears on the storefront, in the relevant collections, and on your own shop
              page. There is no minimum — one piece is a shop.
            </Step>
          </ol>
        </Wrap>
      </Band>

      {/* ── Every order ─────────────────────────────────────────────────── */}
      <Band>
        <Wrap>
          <Eyebrow>Part two · Every order after that</Eyebrow>
          <Display>The same five things happen, every time.</Display>

          <ol style={css('list-style:none;padding:0;margin:48px 0 0;')}>
            <Step
              n={5}
              title="A buyer pays, and you are told"
              aside="There is no cash on delivery on MangaiMart. Nothing reaches you as a promise to pay later."
            >
              She pays online, in full, before anything reaches you. The order lands in your console
              with her name, her address, the pieces and the sizes. MangaiMart is holding that money —
              your part is simply to accept the order and get it ready.
            </Step>

            <Step
              n={6}
              title="You pack it and send it"
              aside="Delivering to a customer in your own town? Send it the way you already do. The console still wants the tracking details for anything that goes by courier."
            >
              Within the dispatch window you set. Book a courier and print the label from your
              dashboard, or hand a local parcel to the delivery boy you already use. You record the
              courier and the tracking number, and the buyer can follow it from her orders page — so
              the "where is my parcel" messages mostly stop arriving.
            </Step>

            <Step n={7} title="It is delivered">
              Delivery is recorded against the courier’s record, not against a tap on a button. That
              matters to you as much as to the buyer: it is what starts the clock on your money, and
              it is the evidence if anyone ever says a parcel did not arrive.
            </Step>

            <Step
              n={8}
              title="You are paid"
              aside="And if a delivered order is later refunded, the fee on it is not charged either. You are never left paying for a sale that came undone."
            >
              {terms.holdDays} days after delivery, the money goes into your bank account — what the
              pieces sold for, less the {terms.commissionPct}% platform fee. Once a payout is due we
              hold ourselves to {terms.slaHours} hours. Nothing to invoice, nothing to claim, nobody
              to remind.
            </Step>

            <Step n={9} title="She leaves a review, and it compounds">
              Reviews are what rank a shop here — not what it pays. A boutique that photographs
              honestly, dispatches when it said it would and answers its messages climbs the listings
              on its own, and the next buyer arrives without you doing anything.
            </Step>
          </ol>
        </Wrap>
      </Band>

      {/* ── What the console gives you ──────────────────────────────────── */}
      <Band tone="panel">
        <Wrap wide>
          <Eyebrow>What you get to work with</Eyebrow>
          <Display>The console, in plain words.</Display>
          <Lede>
            All of it is included. None of it is a paid tier — there are no tiers.
          </Lede>

          <div className="agx-sell-three" style={css('margin-top:48px;')}>
            <ConsoleCard
              title="Orders and customers"
              body="Every order with its address, its sizes and its status. A list of the customers who have bought from you, and what they bought."
            />
            <ConsoleCard
              title="Chat with the buyer"
              body="She messages you from your shop page or a product page and it arrives here, with the piece she was looking at attached. You answer as yourself."
            />
            <ConsoleCard
              title="Your earnings"
              body="What has been paid, what is still on hold, and what fee was taken on which order. Down to the individual piece."
            />
            <ConsoleCard
              title="Counter billing"
              body="Bill a walk-in customer, send the bill to her WhatsApp, and keep one stock figure for the shop. We take nothing on these."
            />
            <ConsoleCard
              title="What is being looked at"
              body="Views, wishlist adds and shares per piece — so you can tell the difference between something nobody sees and something nobody wants."
            />
            <ConsoleCard
              title="Offers and promotion"
              body="Your own coupon codes, your sale prices, and — if you ever want it — a paid slot on the storefront at a flat day rate."
            />
          </div>
        </Wrap>
      </Band>

      {/* ── Honest timeline ─────────────────────────────────────────────── */}
      <Band>
        <Wrap>
          <Eyebrow>Being straight with you</Eyebrow>
          <Display>What the first month actually looks like.</Display>
          <Text>
            A new shop does not sell on day one, here or anywhere. What decides how quickly it starts
            is almost entirely in your hands, and it is not a secret:
          </Text>

          <PointList>
            <Point icon="photo_camera">
              <strong>Photographs decide everything.</strong> Daylight, a plain wall, the whole piece
              and then a close-up of the fabric. A phone is fine. Bad photographs are the single
              commonest reason a good boutique gets no orders.
            </Point>
            <Point icon="inventory_2">
              <strong>Fifteen pieces beats three.</strong> More listings means more ways a buyer can
              land on your shop, and a shop with three pieces looks like one that was abandoned.
            </Point>
            <Point icon="share">
              <strong>Send your shop link to your own customers first.</strong> Your shop page has its
              own address. Put it in your Instagram bio and your WhatsApp status — your existing
              customers ordering through it is what gives you your first reviews.
            </Point>
            <Point icon="reviews">
              <strong>The first five reviews are the hard ones.</strong> After that the ranking starts
              working for you instead of against you.
            </Point>
          </PointList>

          <div
            style={css(
              'margin-top:30px;padding:20px 22px;border-left:3px solid var(--ag-crimson);background:var(--ag-surface-2);border-radius:0 14px 14px 0;',
            )}
          >
            <div style={css(`${LABEL_SM}color:var(--ag-deep);`)}>
              Not promised
            </div>
            <p style={css('margin:9px 0 0;font-size:15px;line-height:1.68;color:var(--ag-ink-2);max-width:62ch;')}>
              We are not going to tell you what you will earn — anyone who does is guessing, and the
              guess is always a flattering one. What we can promise is the arrangement itself: free
              to be here, a {terms.commissionPct}% platform fee on what actually gets delivered, and
              your money in your bank {terms.holdDays} days after it arrives.
            </p>
          </div>

          <CtaPair
            to={START_SELLING}
            label="Open your boutique"
            secondaryTo="/sell/pricing"
            secondaryLabel="What it costs"
          />
        </Wrap>
      </Band>
    </>
  );
}

function ConsoleCard({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={css(
        'background:var(--ag-surface);border:1px solid var(--ag-border);border-radius:18px;padding:22px;',
      )}
    >
      <h3 style={css(`font-family:${SERIF};font-weight:700;font-size:18px;margin:0;color:var(--ag-ink);`)}>{title}</h3>
      <p style={css('margin:9px 0 0;font-size:14.5px;line-height:1.65;color:var(--ag-ink-2);')}>{body}</p>
    </div>
  );
}
