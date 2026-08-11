import { useSyncExternalStore } from 'react';
import { COMPANY, COMPANY_ADDRESS_LINE, POLICY_TERMS } from './company';
import { currentSettings, subscribeSettings, type PlatformSettings } from './settings';

/**
 * Buyer-facing legal & informational pages.
 *
 * Every page is data, not markup: `src/pages/buyer/Policy.tsx` renders whichever
 * entry matches the `:slug` route param, so adding a page is a matter of adding
 * an entry here.
 *
 * ── Where the numbers come from ─────────────────────────────────────────────
 *
 * The commercial terms quoted in the copy — delivery fee, free-delivery
 * threshold, return window, COD cap, commission — are read from the LIVE
 * `platform_settings` row, the same source `src/lib/pricing.ts` prices a bag
 * from. They used to be the compile-time `POLICY_TERMS` constants, and the two
 * drifted: the Delivery Policy promised a ₹79 delivery fee while checkout
 * charged ₹89, the Return Policy advertised a 7-day window against a configured
 * window of zero, and the COD cap on the Terms page was double the one the bag
 * actually enforced. Those are published contractual terms, so a buyer was
 * being charged something other than what the site promised.
 *
 * Keeping them in step "by hand" is what failed. Now the promise and the charge
 * are the same value by construction: change the fee in Platform Settings and
 * the policy page says the new number on the next render. `POLICY_TERMS` is
 * still the fallback (via DEFAULT_SETTINGS) for the moments before the row
 * loads, and still owns the copy-only terms — refund timings, delivery
 * estimates, the cancellation window — which are promises rather than
 * calculations and have no settings column.
 *
 * Because the copy now depends on state, `POLICIES` is a function of the terms
 * rather than a module constant. Components should use `usePolicies()` /
 * `usePolicy(slug)` so they re-render when the row lands.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  ⚠  These are drafted to standard Indian marketplace practice and to the
 *     behaviour this app actually implements. They are NOT legal advice —
 *     have them reviewed by a lawyer before launch, and re-check them against
 *     the Consumer Protection (E-Commerce) Rules 2020 and the DPDP Act 2023.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** A paragraph, or a bullet when prefixed with "- ". */
export type PolicyBlock = string;

export type PolicySection = {
  heading: string;
  blocks: PolicyBlock[];
};

export type PolicyPage = {
  slug: string;
  /** Menu / breadcrumb label. */
  title: string;
  eyebrow: string;
  icon: string;
  /** One-line summary shown under the title and in list rows. */
  summary: string;
  sections: PolicySection[];
};

/** Shown as "Last updated" on every page. Bump when the copy changes. */
export const POLICIES_UPDATED = '11 August 2026';

const CONTACT_SECTION: PolicySection = {
  heading: 'Contact us',
  blocks: [
    `Questions about this policy? Write to ${COMPANY.supportEmail} or call ${COMPANY.phone}.`,
    `${COMPANY.legalName}, ${COMPANY_ADDRESS_LINE}.`,
  ],
};

/**
 * The numbers the copy quotes: the admin-editable ones straight off the live
 * settings row, plus the copy-only promises that have no settings column.
 *
 * Naming it `T` keeps every `${T.x}` interpolation below unchanged from when
 * these came from `POLICY_TERMS` — the only thing that moved is where the
 * commercial values are read from.
 */
type PolicyCopyTerms = {
  returnWindowDays: number;
  commissionPct: number;
  refundWorkingDays: string;
  deliveryEstimate: string;
  metroDeliveryEstimate: string;
  cancellationWindowHours: number;
};

function copyTerms(s: PlatformSettings): PolicyCopyTerms {
  return {
    // Live, admin-editable — these are what the buyer is actually charged.
    //
    // Delivery and COD are no longer among them: since migration 0076 each
    // boutique sets its own charge, threshold, cash-handling fee and cap, so
    // there is no single figure this copy could quote that would be true for
    // every shop. The sections below describe the rule instead and point at the
    // number the checkout screen actually shows — which is the mistake that was
    // made the other way round before, when these pages quoted a frozen ₹79
    // while checkout charged ₹89.
    returnWindowDays: s.return_window_days,
    commissionPct: s.commission_pct,
    // Copy-only: service promises with no settings column behind them.
    refundWorkingDays: POLICY_TERMS.refundWorkingDays,
    deliveryEstimate: POLICY_TERMS.deliveryEstimate,
    metroDeliveryEstimate: POLICY_TERMS.metroDeliveryEstimate,
    cancellationWindowHours: POLICY_TERMS.cancellationWindowHours,
  };
}

/**
 * Build the full set of pages for a given set of terms.
 *
 * Exported for the rare non-React caller (and for tests); components should
 * reach for `usePolicies()` so the copy re-renders when the settings row lands.
 */
export function buildPolicies(T: PolicyCopyTerms): PolicyPage[] {
  return [
  /* ------------------------------------------------------------------ */
  {
    slug: 'delivery-policy',
    title: 'Delivery Policy',
    eyebrow: 'Getting your order to you',
    icon: 'local_shipping',
    summary: `Most orders reach you in ${T.deliveryEstimate}. Each boutique sets its own delivery charge, shown before you pay.`,
    sections: [
      {
        heading: 'Where we deliver',
        blocks: [
          `${COMPANY.brand} delivers across India. Orders are fulfilled by the individual boutique you bought from, and shipped from their own store.`,
          'We do not currently deliver outside India. If your pincode is not serviceable by our delivery partners, the boutique will contact you on the number you provided and refund the order in full.',
        ],
      },
      {
        heading: 'Delivery timelines',
        blocks: [
          `- Metro cities: ${T.metroDeliveryEstimate} from dispatch.`,
          `- Rest of India: ${T.deliveryEstimate} from dispatch.`,
          '- Made-to-order, custom-stitched and altered pieces: the boutique will confirm the timeline with you on chat before work begins. These typically add 5–10 working days.',
          'Timelines are estimates from the date the boutique dispatches your order, not from the date you place it. Boutiques usually pack an order within 1–2 working days of confirming it.',
        ],
      },
      {
        heading: 'Delivery charges',
        blocks: [
          'Each boutique sets its own delivery charge, and many set it to zero. The exact amount for your bag is shown on the payment screen before you pay — that figure is what you are charged.',
          'Some boutiques deliver free once your order from that shop reaches a value they choose. Where that applies, the charge simply drops off as you add items.',
          'A cart containing items from several boutiques is split into one order per boutique, each packed and shipped by that shop. Each carries its own delivery charge, because each is a separate parcel.',
        ],
      },
      {
        heading: 'Tracking your order',
        blocks: [
          'Every order gets its own timeline under My Orders → Track order: Order Placed, Confirmed, Packed, Shipped, Out for Delivery and Delivered. The boutique updates the stage as it fulfils your order, and the screen reflects the change the next time you open it.',
          'You can also message the boutique directly from the order page if you need an update.',
        ],
      },
      {
        heading: 'Failed and delayed deliveries',
        blocks: [
          'Our delivery partners attempt delivery up to three times. If nobody is available, the parcel returns to the boutique and we refund the order to your original payment method, less any delivery charge already incurred.',
          'Delays caused by weather, strikes, regional restrictions or other events beyond our control are outside these timelines. We will keep you informed if your order is affected.',
        ],
      },
      CONTACT_SECTION,
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'shipping-policy',
    title: 'Shipping Policy',
    eyebrow: 'How orders are dispatched',
    icon: 'inventory_2',
    summary: 'Boutiques pack and dispatch within 1–2 working days through our insured delivery partners.',
    sections: [
      {
        heading: 'Dispatch',
        blocks: [
          'Once your payment is confirmed, the order is sent to the boutique immediately. The boutique confirms availability and packs the order, usually within 1–2 working days.',
          'If an item turns out to be unavailable after you have paid, the boutique cancels that order and the amount is refunded to your original payment method in full.',
        ],
      },
      {
        heading: 'Packaging',
        blocks: [
          'Garments are folded, wrapped in protective film and sealed in tamper-evident courier packaging. Bridal and heavy-work pieces are additionally boxed.',
          'We ask boutiques to include the invoice inside the parcel. Keep it — you will need it for any return or exchange.',
        ],
      },
      {
        heading: 'Delivery partners',
        blocks: [
          'We ship through reputed third-party logistics providers. Title and risk in the goods pass to you on delivery to the address you provided.',
          'Please inspect the packaging before accepting a parcel. If the outer packaging is torn, opened or tampered with, refuse delivery and tell us the same day so we can raise a claim with the courier.',
        ],
      },
      {
        heading: 'Address accuracy',
        blocks: [
          'Enter a complete address with a landmark and a reachable phone number. We are not able to change the delivery address once the boutique has dispatched the parcel.',
          'Orders returned to the boutique because of an incorrect or incomplete address may be re-shipped at your cost.',
        ],
      },
      CONTACT_SECTION,
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'return-refund-policy',
    title: 'Return & Refund Policy',
    eyebrow: 'If something is not right',
    icon: 'autorenew',
    summary: T.returnWindowDays > 0
      ? `${T.returnWindowDays}-day returns on eligible items. Refunds land in ${T.refundWorkingDays}.`
      : `Returns on damaged, defective or wrong items. Refunds land in ${T.refundWorkingDays}.`,
    sections: [
      // A zero return window is a real configuration — it means the platform
      // offers no goodwill returns, only the statutory remedy for an item that
      // arrived damaged, defective or wrong. Printing "the 0-day window" and
      // "within 0 days of delivery" would have been nonsense, and quietly
      // hard-coding 7 here is exactly the drift this file was rewritten to end.
      T.returnWindowDays > 0
        ? {
            heading: `The ${T.returnWindowDays}-day window`,
            blocks: [
              `You may request a return within ${T.returnWindowDays} days of delivery if the item is damaged, defective, materially different from what was listed, or the wrong item was sent.`,
              'Raise the request from My Orders, or message the boutique directly from the order page. Please include clear photographs of the item and the packaging — they let the boutique resolve the request without a delay.',
            ],
          }
        : {
            heading: 'When you can return an item',
            blocks: [
              'We do not offer change-of-mind returns. You may still request a return if the item arrived damaged, is defective, is materially different from what was listed, or the wrong item was sent — report it as soon as you receive the parcel.',
              'Raise the request from My Orders, or message the boutique directly from the order page. Please include clear photographs of the item and the packaging — they let the boutique resolve the request without a delay.',
            ],
          },
      {
        heading: 'Condition of returned items',
        blocks: [
          'To be accepted, the item must be unused, unwashed and unaltered, with all original tags, labels, packaging and any accompanying blouse piece or dupatta intact.',
          'Items that fail this condition check on arrival at the boutique are returned to you, and no refund is issued.',
        ],
      },
      {
        heading: 'What cannot be returned',
        blocks: [
          '- Custom-stitched, made-to-measure or altered garments, including blouses stitched to your measurements.',
          '- Items marked non-returnable on the product page at the time of purchase.',
          '- Innerwear and intimate apparel, for hygiene reasons.',
          '- Items damaged by misuse, washing against the stated care instructions, or normal wear.',
          '- Free gifts and promotional items.',
          'A minor variation in colour between the photograph and the garment is inherent to fabric and screen calibration, and is not by itself a defect. Silk, hand-block and hand-woven pieces carry small irregularities that are a feature of the craft.',
        ],
      },
      {
        heading: 'Refunds',
        blocks: [
          `Once the boutique receives and checks the returned item, your refund is initiated within 2 working days and reaches your original payment method in ${T.refundWorkingDays}, depending on your bank.`,
          'Refunds are always made to the original payment method. We do not refund to a different account, and we do not issue cash refunds.',
          `Where a delivery fee was charged, it is refunded only if the return is due to our or the boutique's error (damaged, defective or wrong item).`,
          'If the order was paid with a coupon, the discount is not refunded in cash — you are refunded the amount actually charged to your payment method.',
        ],
      },
      {
        heading: 'Exchanges',
        blocks: [
          'Size exchanges are at the boutique’s discretion and subject to stock. Message the boutique from the order page — most are happy to arrange one within the return window.',
        ],
      },
      CONTACT_SECTION,
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'cancellation-policy',
    title: 'Cancellation Policy',
    eyebrow: 'Changed your mind',
    icon: 'cancel',
    summary: `Cancel free of charge any time before the boutique dispatches your order.`,
    sections: [
      {
        heading: 'Cancelling an order',
        blocks: [
          `You can cancel an order free of charge at any time before it is marked Shipped — in practice, within about ${T.cancellationWindowHours} hours of placing it. Use My Orders, or message the boutique directly.`,
          'Once an order has been dispatched it can no longer be cancelled. You may instead refuse delivery, or raise a return under the Return & Refund Policy if the item is eligible.',
        ],
      },
      {
        heading: 'Cancellation by the boutique or by us',
        blocks: [
          'A boutique may cancel an order if the item is out of stock, if the piece cannot be made to the standard it promised, or if your address is not serviceable.',
          'We may cancel an order where we detect fraudulent or abusive activity, a pricing or listing error, or a payment that could not be verified.',
          'In every such case the full amount you paid is refunded to your original payment method. You will be told the reason by chat or on the number you provided.',
        ],
      },
      {
        heading: 'Custom orders',
        blocks: [
          'Custom-stitched and made-to-measure orders cannot be cancelled once the boutique has begun cutting or stitching, because the piece cannot be resold. The boutique will confirm on chat before it starts work.',
        ],
      },
      {
        heading: 'Refund on cancellation',
        blocks: [
          `Refunds for cancelled orders are initiated within 2 working days and reach your original payment method in ${T.refundWorkingDays}.`,
        ],
      },
      CONTACT_SECTION,
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'product-policy',
    title: 'Product Policy',
    eyebrow: 'What we list and what we don’t',
    icon: 'checkroom',
    summary: 'Every listing is by a verified boutique, priced inclusive of taxes, with honest photography.',
    sections: [
      {
        heading: 'Who lists on MangaiMart',
        blocks: [
          `${COMPANY.brand} is a marketplace. Products are listed, owned, priced and dispatched by independent boutiques. We verify a boutique before approving it, but the boutique — not ${COMPANY.short} — is the seller of record for your purchase.`,
          'Verified boutiques carry a blue tick on their profile. Verification means we have confirmed the business identity and contact details; it is not a guarantee of any individual product.',
        ],
      },
      {
        heading: 'Product information',
        blocks: [
          'Boutiques are required to list the fabric, category, occasion, colour, available sizes, wash care and city of origin for every piece, and to use their own photographs of the actual item.',
          'Where a size chart is shown, measurements are in inches and refer to the finished garment or blouse piece. If you are between two sizes we recommend sizing up, or asking the boutique on chat.',
          'Handloom, hand-block and hand-embroidered pieces vary slightly from one to the next. Small irregularities in weave, print alignment or thread work are characteristic of the craft and are not defects.',
        ],
      },
      {
        heading: 'Pricing',
        blocks: [
          'All prices are in Indian Rupees and are inclusive of applicable taxes. The MRP shown struck through is the boutique’s stated maximum retail price; the discount percentage is calculated from it.',
          'The final amount you pay is always computed on our servers from the current listed prices at the moment you pay — never from the figures held in your browser. If a price changes between adding to your bag and paying, you pay the price shown on the payment screen.',
        ],
      },
      {
        heading: 'Prohibited listings',
        blocks: [
          'Boutiques may not list counterfeit or replica goods, items infringing another party’s trademark or design, used or unhygienic garments, or anything restricted under Indian law.',
          `Report a listing you believe breaches this policy to ${COMPANY.grievanceEmail}. We remove confirmed breaches and may suspend the boutique.`,
        ],
      },
      {
        heading: 'Stock and availability',
        blocks: [
          'Stock counts shown on a product page are maintained by the boutique and reserved when you pay. In the rare case an item sells out between your payment and the boutique’s confirmation, the order is cancelled and refunded in full.',
        ],
      },
      CONTACT_SECTION,
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    eyebrow: 'Your data, plainly explained',
    icon: 'shield_person',
    summary: 'What we collect, why we collect it, who sees it, and how you get it deleted.',
    sections: [
      {
        heading: 'Who we are',
        blocks: [
          `${COMPANY.legalName} ("${COMPANY.short}", "we") operates the ${COMPANY.brand} marketplace and is the data fiduciary for the personal data described here. Our registered office is ${COMPANY_ADDRESS_LINE}.`,
        ],
      },
      {
        heading: 'What we collect',
        blocks: [
          '- Account details: your name, email address and, if you sign in with Google, the basic profile Google shares with us.',
          '- Order details: delivery address, phone number, the items you bought and your order history.',
          '- Payment references: the payment id, order id and signature returned by our payment gateway. We never see or store your card number, UPI PIN or bank credentials — those go directly to the gateway.',
          '- Messages: the content of chats you exchange with a boutique.',
          '- Device data: basic technical information such as browser type and approximate region, used to keep the service secure and working.',
        ],
      },
      {
        heading: 'What we do with it',
        blocks: [
          'We use your data to place and fulfil your orders, to let you and the boutique talk to each other, to provide support, to prevent fraud and abuse, and to meet our legal and tax obligations.',
          'We do not sell your personal data, and we do not share it for third-party advertising.',
        ],
      },
      {
        heading: 'Who sees your data',
        blocks: [
          '- The boutique you order from sees your name, delivery address, phone number and the items in that order — it needs them to deliver.',
          '- Our delivery partners see what is needed to deliver the parcel.',
          '- Our payment gateway processes your payment and returns a reference to us.',
          '- Our hosting and database providers store the data on our behalf under contract.',
          '- Government authorities, where we are legally required to disclose.',
        ],
      },
      {
        heading: 'Browsing without an account',
        blocks: [
          'You can browse, save items and build a bag without an account. That data stays in your browser’s local storage until you sign in, at which point it is merged into your account so it follows you across devices.',
          'Signing out clears the collections held on that device; your data remains safe on your account.',
        ],
      },
      {
        heading: 'How long we keep it',
        blocks: [
          'Order and invoice records are retained for eight years as required by Indian tax law. Chat messages, saved items and profile details are retained while your account is open and deleted within 90 days of a deletion request, except where we must keep them by law.',
        ],
      },
      {
        heading: 'Your rights',
        blocks: [
          'You may ask us to give you a copy of your data, correct it, or delete your account and its data. Sign in and use the profile screen, or write to us at the address below.',
          `Data protection queries and grievances: ${COMPANY.grievanceEmail}, addressed to the ${COMPANY.grievanceOfficer}. We respond within 30 days.`,
        ],
      },
      {
        heading: 'Security',
        blocks: [
          'Traffic to and from the app is encrypted in transit. Access to production data is restricted and audited, and payments are verified server-side against the gateway’s signature before an order is created.',
          'No system is perfectly secure. If a breach affects your data we will notify you and the relevant authority as required by law.',
        ],
      },
      {
        heading: 'Children',
        blocks: [
          'The service is not directed at children under 18. We do not knowingly collect their data; if you believe we have, contact us and we will delete it.',
        ],
      },
      {
        heading: 'Changes',
        blocks: [
          'We will post any change to this policy on this page and update the date at the top. Material changes will additionally be notified in the app.',
        ],
      },
      CONTACT_SECTION,
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'terms',
    title: 'Terms & Conditions',
    eyebrow: 'The agreement between us',
    icon: 'gavel',
    summary: 'The rules for using MangaiMart, for buyers and for boutiques.',
    sections: [
      {
        heading: 'Accepting these terms',
        blocks: [
          `By using ${COMPANY.brand} you agree to these terms and to the policies linked from them. If you do not agree, please do not use the service.`,
          `The service is operated by ${COMPANY.legalName}, ${COMPANY_ADDRESS_LINE}.`,
        ],
      },
      {
        heading: 'We are a marketplace',
        blocks: [
          `${COMPANY.short} provides a platform on which independent boutiques list and sell their own products. The contract of sale for any item is between you and the boutique. ${COMPANY.short} is not the seller, manufacturer or importer of the goods.`,
          'We are responsible for the platform: the listings surface, checkout, payment verification, order records and support. The boutique is responsible for the product, its description, its price, its packaging and its dispatch.',
        ],
      },
      {
        heading: 'Your account',
        blocks: [
          'You may browse, save items and fill a bag without an account. Placing an order requires one — as do chatting with a boutique and syncing your orders across devices.',
          'Keep your sign-in details to yourself — you are responsible for activity on your account. Tell us immediately if you believe it has been used without your permission.',
          'You agree to give accurate details, and to keep your delivery address and phone number up to date.',
        ],
      },
      {
        heading: 'Orders and payment',
        blocks: [
          'Placing an order is an offer to buy; the contract forms when the boutique confirms it.',
          'The amount payable is computed on our servers from current listed prices, applicable delivery charges and any valid coupon. We reserve the right to cancel and refund an order affected by an obvious pricing or listing error.',
          'A cart spanning several boutiques becomes one order per boutique, each separately confirmed, dispatched and tracked.',
        ],
      },
      {
        heading: 'Cash on delivery',
        blocks: [
          'Where the boutique offers it, you may pay in cash when your order is delivered. The boutique sets its own cash-handling fee and its own upper limit for cash orders; both are applied and shown on the payment screen before you confirm, and the total there is what you hand over at the door.',
          'Because a cart spanning several boutiques is delivered separately by each, the handling fee applies once per delivery, and each delivery is paid for on arrival.',
          'Please keep the exact amount ready — our delivery partners may not carry change. If payment is refused at the door the order is returned to the boutique and may count against future cash-on-delivery eligibility.',
          'A cash-on-delivery order can be cancelled free of charge from "My orders" at any time before it is dispatched. Nothing has been charged, so there is no refund to process.',
        ],
      },
      {
        heading: 'Coupons',
        blocks: [
          'Coupons are subject to their stated minimum order value, cap and expiry, are single-use unless stated otherwise, cannot be combined, and hold no cash value. We may withdraw a coupon at any time before it is applied.',
        ],
      },
      {
        heading: 'Acceptable use',
        blocks: [
          'You agree not to misuse the service: no scraping, no attempting to breach or probe our security, no fraudulent orders or payment instruments, no abusive, obscene or harassing messages to boutiques, and no infringement of anyone’s intellectual property.',
          'We may suspend or terminate access for breach of these terms.',
        ],
      },
      {
        heading: 'For boutiques',
        blocks: [
          `Boutiques selling through MangaiMart warrant that they own or are authorised to sell what they list, that listings are accurate, and that they hold the registrations their business requires. MangaiMart charges a ${T.commissionPct}% commission on the value of orders fulfilled through the platform, deducted before settlement.`,
          'Boutiques are responsible for fulfilling confirmed orders within the stated timelines, for honouring the return and cancellation policies, and for the tax treatment of their own sales.',
        ],
      },
      {
        heading: 'Intellectual property',
        blocks: [
          `The ${COMPANY.brand} name, logo, design and software are ours. Product photographs and descriptions belong to the boutique that listed them. Nothing here transfers any of those rights to you.`,
        ],
      },
      {
        heading: 'Liability',
        blocks: [
          'To the extent permitted by law, our total liability to you for any claim connected with an order is limited to the amount you paid for that order.',
          'We do not exclude liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot be excluded under Indian law. Nothing in these terms affects your rights under the Consumer Protection Act, 2019.',
        ],
      },
      {
        heading: 'Governing law and disputes',
        blocks: [
          `These terms are governed by the laws of India. The courts at ${COMPANY.address.city}, ${COMPANY.address.state} have exclusive jurisdiction, without prejudice to your right to approach a consumer forum where you reside.`,
        ],
      },
      {
        heading: 'Grievance redressal',
        blocks: [
          `In accordance with the Consumer Protection (E-Commerce) Rules 2020 and the Information Technology Rules 2021, complaints may be addressed to the ${COMPANY.grievanceOfficer} at ${COMPANY.grievanceEmail}. We acknowledge within 48 hours and resolve within one month.`,
        ],
      },
      CONTACT_SECTION,
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'about',
    title: 'About Us',
    eyebrow: 'Why MangaiMart exists',
    icon: 'favorite',
    summary: 'A marketplace built so India’s independent boutiques can be found — and talked to — online.',
    sections: [
      {
        heading: 'Our story',
        blocks: [
          'India’s best ethnic wear has always come from small boutiques — a street in RS Puram, a first floor in T. Nagar, a family loom in Kanchipuram, a block-printing studio in Jaipur. What they have never had is a way to be found by someone two districts away.',
          `${COMPANY.brand} was built for exactly that. We put verified local boutiques in one place, keep their photographs and their prices theirs, and let you talk to the owner before you buy — the way you would across the counter.`,
        ],
      },
      {
        heading: 'What makes us different',
        blocks: [
          '- Every boutique is verified before it can list.',
          '- You chat directly with the shop, not a call centre.',
          '- Photographs are the boutique’s own — of the actual piece.',
          '- Prices are set by the boutique, and the money goes to the boutique.',
        ],
      },
      {
        heading: 'Sell on MangaiMart',
        blocks: [
          `Own a boutique? Opening a shop takes a few minutes and there is no subscription — we earn a ${T.commissionPct}% commission only when you make a sale. Tap "Sell on MangaiMart" on your profile to get started.`,
        ],
      },
      CONTACT_SECTION,
    ],
  },

  /* ------------------------------------------------------------------ */
  {
    slug: 'help',
    title: 'Help & Support',
    eyebrow: 'We’re here',
    icon: 'support_agent',
    summary: 'Answers to the questions we get most, and how to reach a human.',
    sections: [
      {
        heading: 'Reaching us',
        blocks: [
          `Email ${COMPANY.supportEmail} or call ${COMPANY.phone}.`,
          'For anything about a specific order — where it is, a size change, a custom blouse — the fastest route is to message the boutique directly from the order page. They are the ones holding your parcel.',
        ],
      },
      {
        heading: 'Where is my order?',
        blocks: [
          'Open My Orders and tap Track order. The timeline shows the stage your order has reached and updates as the boutique fulfils it. If it has not moved in more than two working days, message the boutique.',
        ],
      },
      {
        heading: 'I paid but there is no order',
        blocks: [
          'This is rare and it is recoverable. Your payment is captured and held against your session — reopen the payment screen and you will be offered "Complete my order", which finishes the order without charging you a second time.',
          `If that does not appear, write to ${COMPANY.supportEmail} with your payment reference and we will settle it manually.`,
        ],
      },
      {
        heading: 'How do I return something?',
        blocks: [
          T.returnWindowDays > 0
            ? `Within ${T.returnWindowDays} days of delivery, open the order and message the boutique with photographs. See the Return & Refund Policy for what is eligible.`
            : 'Open the order as soon as it arrives and message the boutique with photographs. See the Return & Refund Policy for what is eligible.',
        ],
      },
      {
        heading: 'How do I change my address?',
        blocks: [
          'Profile → Edit updates your saved delivery address for future orders. To change the address on an order already placed, message the boutique before it is dispatched.',
        ],
      },
      CONTACT_SECTION,
    ],
  },
  ];
}

/** The seven legal pages, in the order they are listed in the footer and profile. */
export const LEGAL_SLUGS = [
  'delivery-policy',
  'shipping-policy',
  'return-refund-policy',
  'cancellation-policy',
  'product-policy',
  'privacy-policy',
  'terms',
] as const;

/**
 * Every page slug, in route order. Static — `src/App.tsx` registers one route
 * per slug at mount and must not depend on a settings row that has not loaded.
 * The page CONTENT is what varies with the terms, never the set of pages.
 */
export const POLICY_SLUGS: string[] = buildPolicies(copyTerms(currentSettings())).map((p) => p.slug);

// ── React bindings ──────────────────────────────────────────────────────────

/**
 * The policy pages under the terms in force right now, re-rendering when the
 * live settings row lands or an admin changes a fee.
 *
 * The snapshot is memoised on the settings object identity: `useSyncExternalStore`
 * demands a stable reference between publishes, and rebuilding the array on every
 * call would loop forever.
 */
let cachedFor: PlatformSettings | null = null;
let cachedPolicies: PolicyPage[] = [];

function policiesSnapshot(): PolicyPage[] {
  const s = currentSettings();
  if (cachedFor !== s) {
    cachedFor = s;
    cachedPolicies = buildPolicies(copyTerms(s));
  }
  return cachedPolicies;
}

/** All policy pages, under the terms currently in force. */
export function usePolicies(): PolicyPage[] {
  return useSyncExternalStore(subscribeSettings, policiesSnapshot, policiesSnapshot);
}

/** One policy page by slug, or undefined. */
export function usePolicy(slug: string | undefined): PolicyPage | undefined {
  return usePolicies().find((p) => p.slug === slug);
}

/** The seven legal pages, in footer order, under the terms currently in force. */
export function useLegalPages(): PolicyPage[] {
  const all = usePolicies();
  return LEGAL_SLUGS.map((s) => all.find((p) => p.slug === s)).filter((p): p is PolicyPage => !!p);
}
