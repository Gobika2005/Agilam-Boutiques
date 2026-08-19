/**
 * The written content of the public seller site (`/sell`).
 *
 * Everything a seller reads before they sign up lives here rather than being
 * scattered through five page components, for the same reason `@/data/company`
 * exists: the business gets corrected in one file. Two hard rules for anything
 * added below.
 *
 *  1. NO NUMBER THAT MOVES. The platform fee, the payout hold, the payout
 *     promise and the ad rates are all admin-editable rows (`platform_settings`,
 *     `ad_placements`). They are read live by `useSellerTerms` and interpolated
 *     into the copy at render — never typed in here. A marketing page that
 *     quotes a stale rate is the exact failure the 2026-08-11 functional test
 *     found on the buyer policy pages, where the published delivery fee was ₹79
 *     and checkout charged ₹89.
 *
 *  2. NO CLAIM WE CANNOT SHOW. No invented supplier counts, no invented GMV, no
 *     invented quotes. The proof on these pages is real boutiques out of the
 *     live catalogue and real mechanics out of the code. `SELLER_STORIES` below
 *     is empty and the section that renders it hides itself — see the note
 *     there before putting anything in it.
 *
 *  3. IT IS THE "PLATFORM FEE", NEVER THE "COMMISSION". Same number, same
 *     column (`platform_settings.commission_pct`) — but "commission" is what a
 *     middleman calls the cut he takes, and to a boutique owner weighing this
 *     up it reads as exactly that. The code keeps the database's word; every
 *     line a seller can read uses hers. The tone throughout is a person
 *     explaining something to a neighbour, not a company issuing terms —
 *     warm, plain, and never at the cost of leaving a number out.
 */

/** Where a seller goes when they decide. Both are existing, live routes. */
export const START_SELLING = '/seller/register';
export const SELLER_SIGNIN = '/auth/signin/seller';

/** The nav across the top of every /sell page. */
export const SELL_NAV = [
  { label: 'Why sell here', to: '/sell' },
  { label: 'How it works', to: '/sell/how-it-works' },
  { label: 'What it costs', to: '/sell/pricing' },
  { label: 'Delivery & payouts', to: '/sell/delivery-and-payouts' },
  { label: 'Questions', to: '/sell/faq' },
] as const;

/**
 * What a seller must have before they open the wizard.
 *
 * Mirrors `validateStep` in `@/pages/seller/SellerOnboarding` — if a field
 * becomes required there, it becomes required here. GST is listed as optional
 * on purpose: step 4 accepts a blank GSTIN, and a boutique owner who assumes
 * she needs one is a boutique owner who never starts.
 */
export const WHAT_YOU_NEED = [
  {
    icon: 'smartphone',
    need: 'A phone number and an email address',
    detail: 'Your login, and where order alerts land. Nothing else is needed to create the account.',
    required: true,
  },
  {
    icon: 'location_on',
    need: 'Your shop address, with the map pin',
    detail:
      'Where the parcel is picked up from, and what decides whether a buyer counts as local, district, state or national for your delivery charge.',
    required: true,
  },
  {
    icon: 'account_balance',
    need: 'A bank account in the shop or owner’s name',
    detail:
      'Account number and IFSC. This is where money is transferred after each delivery — there is no other way to be paid.',
    required: true,
  },
  {
    icon: 'photo_camera',
    need: 'Photos of what you sell',
    detail:
      'Taken on a phone is fine. A plain wall and daylight beats a studio. You can list your first piece the same hour you are approved.',
    required: true,
  },
  {
    icon: 'receipt_long',
    need: 'A GST number',
    detail:
      'Leave it blank if you do not have one — you can still open the shop, list and be paid. Add it later from Settings whenever you register.',
    required: false,
  },
] as const;

/**
 * Real seller quotes. EMPTY ON PURPOSE.
 *
 * The section that renders these (`SellerVoices` on /sell) returns null while
 * the array is empty, so the page is complete without it. Do not write filler
 * here: a made-up quote from a made-up shop on a page asking people to trust us
 * with their livelihood is the one thing that cannot be walked back.
 *
 * To publish a real one, get the seller's permission in writing, then add:
 *
 *   { quote: '…their words, unedited…', name: 'Owner name', shop: 'Shop name',
 *     city: 'Coimbatore', boutiqueSlug: 'shop-slug' }
 *
 * `boutiqueSlug` is optional; when it matches a live boutique the card links to
 * that shop's real storefront, which is what makes a quote checkable.
 */
export type SellerStory = {
  quote: string;
  name: string;
  shop: string;
  city: string;
  boutiqueSlug?: string;
};
export const SELLER_STORIES: SellerStory[] = [];

/**
 * The questions, in the order a real person asks them.
 *
 * `a` may contain `{commission}`, `{hold}`, `{sla}` and `{returnWindow}`
 * placeholders — `useSellerTerms().fill()` swaps in the live values. Anything
 * else is plain text, and is also fed to `faqSchema` for the rich result, so
 * keep answers to a paragraph and keep them answers.
 */
export type Faq = { q: string; a: string };
export type FaqGroup = { title: string; note?: string; items: Faq[] };

export const FAQ_GROUPS: FaqGroup[] = [
  {
    title: 'Opening your shop',
    items: [
      {
        q: 'Do I need a GST number to sell on MangaiMart?',
        a: 'No. You can register, list, sell and be paid without a GST number — leave the field blank when you set up. If you register for GST later, add it in Settings and it appears on your invoices from then on.',
      },
      {
        q: 'Does it cost anything to join?',
        a: 'Not a rupee. No joining fee, no monthly fee, and nothing to list your pieces. We only earn when you do — a {commission}% platform fee on the goods value of an order that actually reaches your customer. If nothing sells, you owe us nothing.',
      },
      {
        q: 'How long does approval take?',
        a: 'Setup is eight short steps and you can stop and come back — everything is saved as you go. Once you send it in, one of us checks your details and either opens your shop or comes back to you with exactly what needs fixing. You are never left wondering: the status sits on your dashboard the whole time.',
      },
      {
        q: 'I am not from Tamil Nadu. Can I still sell?',
        a: 'Yes. MangaiMart is open to boutiques anywhere in India. Your shop address decides your delivery zones, not whether you can join.',
      },
      {
        q: 'I already sell on WhatsApp and Instagram. Why add this?',
        a: 'Because the work you already do stays the same and the discovery is new. Buyers find you through search, the collection pages and the Inspire feed, and they can message you inside MangaiMart exactly as they message you now — the difference is that they pay before you pack, and there is a record of every order.',
      },
      {
        q: 'Do I need a computer?',
        a: 'No. The whole seller console works on a phone — listing, photos, orders, chat, billing and your earnings. Most sellers never open a laptop.',
      },
    ],
  },
  {
    title: 'Money',
    items: [
      {
        q: 'What exactly does MangaiMart take?',
        a: 'A {commission}% platform fee on the goods value of a delivered order — and that is the whole of it. That one figure already covers the payment gateway’s charge and the tax we owe on it, which is why there is no second fee stacked on top, no listing fee and nothing for collecting the payment.',
      },
      {
        q: 'Why {commission}%? That sounds like a lot.',
        a: 'It is a fair question, so here is what sits behind it: every card and UPI charge on your orders plus the tax on them, the work of getting buyers to your shop, holding the money safely and moving it to your bank, the 30-day cover that makes a stranger willing to buy from a shop she has never heard of, and the console itself. It is one fee covering all of that, charged only when an order lands — not the first of several, and not more for a small shop than for a busy one.',
      },
      {
        q: 'When do I get paid?',
        a: 'After the order is delivered. Once delivery is confirmed and a {hold}-day hold has passed, the money is released — and we hold ourselves to moving it within {sla} hours of that. It goes straight into the bank account you set up. You never raise an invoice and you never have to ask.',
      },
      {
        q: 'What if the buyer never pays?',
        a: 'That simply cannot happen here. Every order is paid online before it reaches you. There is no cash on delivery, so you never pack a parcel on a promise and you never have to chase anybody for money.',
      },
      {
        q: 'What happens if an order is cancelled or refunded?',
        a: 'You are charged nothing. The fee only applies to orders that are actually delivered, so a cancelled, rejected or refunded order costs you nothing at all — no fee on a sale that did not happen.',
      },
      {
        q: 'Is there a fee on my walk-in customers?',
        a: 'None. The billing screen in your console is for your own counter sales and we take nothing from them. It is there so your shop has one record of everything it sold, online and offline. Those bills never enter a payout.',
      },
      {
        q: 'Can I run my own discount?',
        a: 'Of course. Create coupon codes for your own shop from the console — you decide the discount, the minimum cart value and how long it runs. Because it is your offer, it comes off your side of the order. We also run our own platform-wide coupons now and then, and those are funded by us, so they never reduce what you are paid.',
      },
    ],
  },
  {
    title: 'Delivery and returns',
    items: [
      {
        q: 'Who delivers the order?',
        a: 'You do — and you decide how. Book a courier and print the label from your dashboard, or hand a local order to the delivery boy you already use. MangaiMart does not take the parcel out of your hands, which is why nobody else decides how your pieces are packed.',
      },
      {
        q: 'How do I decide what to charge for delivery?',
        a: 'You set four rates: your own town, your district, the rest of your state, and the rest of India. A buyer’s pincode picks the right one automatically at checkout. Leave a band blank and you simply do not deliver there — no order from that area will reach you.',
      },
      {
        q: 'Can I offer free delivery?',
        a: 'Yes. Set an order value above which delivery is free for local and district buyers. Below it, your normal rate applies.',
      },
      {
        q: 'How fast do I have to dispatch?',
        a: 'You say. You set a dispatch window — for example two to four days — and that is what the buyer is shown before they order, so a piece that takes time to finish is not a broken promise. Transit time after that is estimated by MangaiMart based on distance.',
      },
      {
        q: 'Do I have to accept returns?',
        a: 'You set your own change-of-mind return window, including a shorter one, and it is shown on every one of your product pages. Separately, MangaiMart covers a faulty or wrong item for 30 days across the whole marketplace — that protection is what makes a first-time buyer willing to try a shop she has never heard of.',
      },
      {
        q: 'What if a buyer says the parcel never arrived?',
        a: 'Delivery is recorded against a courier and a tracking number, not against a tap on a button, and the payout for that order is held until delivery is confirmed. If something is genuinely disputed, MangaiMart looks at the tracking record with you before anything is decided.',
      },
    ],
  },
  {
    title: 'Your products and your shop',
    items: [
      {
        q: 'How many pieces do I need to start?',
        a: 'One. There is no minimum catalogue size and no minimum order value. Most shops start with the five or six pieces they can photograph in an afternoon and add more as they go.',
      },
      {
        q: 'Do my photos have to be professional?',
        a: 'No, and they mostly are not. What matters is daylight, a plain background and showing the fabric honestly — the drape, the border, the actual colour. A buyer who receives what she saw leaves a good review, and reviews are what rank your shop.',
      },
      {
        q: 'Can buyers contact me directly?',
        a: 'Yes. Every product page and every shop page has a chat button, and the conversation lands in your console with the buyer’s name and the piece they are asking about. You answer as yourself, not through a call centre.',
      },
      {
        q: 'Do I keep my own brand?',
        a: 'Yes. Your shop has its own page on MangaiMart with your name, your logo, your city and your pieces, and it has its own web address you can share on Instagram or WhatsApp. Buyers follow shops here, not just products.',
      },
      {
        q: 'Can I sell the same pieces somewhere else?',
        a: 'Yes. Nothing here is exclusive. Keep your shop, your Instagram and any other marketplace exactly as they are.',
      },
      {
        q: 'What can I not list?',
        a: 'Anything you cannot actually supply, anything counterfeit, and anything outside ethnic and occasion wear. Listings are checked, and a shop that repeatedly cancels orders it cannot fulfil loses its place in the rankings before it loses anything else.',
      },
    ],
  },
];

/** Flattened, for the FAQ rich result. */
export const ALL_FAQS: Faq[] = FAQ_GROUPS.flatMap((g) => g.items);
