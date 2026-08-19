import { esc, inr, LOGO_URL } from './_email.js';

/**
 * The buyer's payment receipt — the document that says "we have your money".
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The owner had switched on Razorpay's dashboard feature "Post-payment Receipts"
 * and no receipt ever arrived. It never could: that feature only fires for
 * Payment Links, Payment Pages and Invoices, and this platform takes money a
 * different way — api/create-order.js opens a Razorpay ORDER and the browser
 * settles it through Standard Checkout. Orders are outside the feature's scope,
 * so the receipt has to be ours. Hence "automated from our side".
 *
 * ── Bill From is the boutique, not us ───────────────────────────────────────
 * Razorpay's sample put the platform in "Bill From". That would be wrong here:
 * MangaiMart is a commission marketplace, so the goods are the seller's and we
 * only collect and hold the money until settlement (see the payout flow in
 * api/run-payouts.js). The receipt says so in as many words — the shop bills,
 * we collected. Owner's decision, taken deliberately.
 *
 * ── It is a receipt, not a tax invoice ──────────────────────────────────────
 * No GSTIN, no tax split, and it says which of the two it is. Sellers' GST
 * numbers aren't captured anywhere in the schema and src/data/company.ts still
 * holds placeholder business details, so a tax block here would be decoration
 * at best and a false statement at worst. The layout leaves room for one.
 *
 * ── Email constraints this markup obeys ─────────────────────────────────────
 * Tables and inline attributes only, literal hex instead of `--ag-*` tokens
 * (a mail client has never seen our stylesheet and cannot resolve a CSS
 * variable), and every user-supplied string escaped — a product titled
 * `<img onerror=…>` must not be able to restructure the message. Same rules as
 * api/_email.js, which this builds on: `layout()` supplies the MangaiMart
 * wordmark at the top, and the shop's own logo sits beside its name below.
 *
 * The leading underscore keeps this out of Vercel's /api routing. That is not
 * cosmetic — the project sits at the 12-function Hobby ceiling, so a routable
 * file here would break the deploy.
 */

const INK = '#241019';
const MUTED = '#775D66';
const FAINT = '#9A828C';
const RULE = '#EFDCE4';

const FONT = "font-family:Arial,Helvetica,sans-serif;";

/**
 * "16 Aug 2026" — the format on the receipt's "Paid On" line.
 *
 * Forced to Asia/Kolkata rather than the runtime's zone. Vercel functions run in
 * UTC, so an order paid at 1am IST would otherwise be receipted with the
 * previous day's date — a discrepancy the buyer would take to support, and one
 * that is a genuine nuisance to explain away afterwards.
 */
function paidOnDate(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/**
 * The shop's mark, or null.
 *
 * Two guards, both load-bearing:
 *
 *   • Only an absolute http(s) URL is rendered. A relative path resolves against
 *     the mail client, not against us, so it is a broken image in every inbox.
 *   • The URL is used EXACTLY as stored — deliberately not routed through the
 *     Supabase image transformer the app uses (src/lib/imageUrl.ts). The
 *     transformer negotiates WebP from the `Accept` header, and Outlook on
 *     Windows cannot decode WebP; it would show alt text where the shop's brand
 *     should be. api/_email.js makes the same call for the same reason.
 *
 * Sized with the `width` attribute as well as CSS because Outlook ignores the
 * style and would otherwise paint the logo at its natural upload size.
 */
function shopLogoImg(shop) {
  const url = String(shop?.logo_url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) return null;
  return (
    `<img src="${esc(url)}" width="44" height="44" alt="${esc(shop?.name ?? 'Boutique')}" ` +
    `style="display:block;width:44px;height:44px;border-radius:8px;object-fit:cover;border:1px solid ${RULE};" />`
  );
}

/**
 * The shop's postal address, as many lines of it as the seller filled in.
 *
 * The district is dropped when it merely repeats the city, which for most of
 * this catalogue it does — a Coimbatore shop has city "Coimbatore" and district
 * "Coimbatore", and printing both gives "Coimbatore / Coimbatore, Tamil Nadu".
 * Compared case- and space-insensitively because the two fields are filled in by
 * hand at different steps of the onboarding wizard.
 */
function shopAddressLines(shop) {
  const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const district = norm(shop?.district) === norm(shop?.city) ? null : shop?.district;
  const region = [district, shop?.state].filter(Boolean).join(', ');
  const lastLine = [region, shop?.pincode].filter(Boolean).join(' ');
  return [shop?.address_line, shop?.city, lastLine].map((s) => String(s ?? '').trim()).filter(Boolean);
}

/** Small grey label above a block of details. */
function label(text) {
  return `<div style="${FONT}font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:${FAINT};margin:0 0 6px;">${esc(text)}</div>`;
}

/** One line of a Bill From / Bill To block. `strong` for the name at the top. */
function detailLine(text, strong = false) {
  if (!text) return '';
  return (
    `<div style="${FONT}font-size:12.5px;line-height:1.55;color:${strong ? INK : MUTED};` +
    `${strong ? 'font-weight:700;' : ''}">${esc(text)}</div>`
  );
}

/**
 * A label/value pair in the reference block under the title.
 *
 * `white-space:nowrap` on the value keeps a payment id (`pay_QxRt…`) on one line
 * rather than letting a narrow phone break it mid-token, which makes it useless
 * for reading out to support — the one job that field has.
 */
function metaRow(name, value) {
  return (
    `<tr><td style="${FONT}font-size:11.5px;color:${FAINT};padding:2px 14px 2px 0;white-space:nowrap;">${esc(name)}</td>` +
    `<td style="${FONT}font-size:11.5px;color:${INK};font-weight:700;padding:2px 0;">${esc(value)}</td></tr>`
  );
}

/** A row in the totals stack. `emphasis` for the amount actually paid. */
function totalRow(name, value, emphasis = false) {
  const size = emphasis ? '15px' : '12.5px';
  const colour = emphasis ? INK : MUTED;
  const top = emphasis ? `border-top:1px solid ${RULE};` : '';
  return (
    `<tr>` +
    `<td align="right" style="${FONT}font-size:${size};color:${colour};padding:${emphasis ? '10px' : '5px'} 12px 5px 0;${top}">${esc(name)}</td>` +
    `<td align="right" style="${FONT}font-size:${size};color:${INK};font-weight:700;white-space:nowrap;padding:${emphasis ? '10px' : '5px'} 0 5px;${top}">${esc(value)}</td>` +
    `</tr>`
  );
}

/**
 * Build the receipt body, ready to hand to `layout()` as `bodyHtml`.
 *
 * @param order  One `orders` row's worth of data, with its `lines`. `total` is
 *               already net of any seller coupon (`discount`), and
 *               `platform_discount` is NOT taken off it — the platform funds
 *               that one, so the seller is still paid in full while the buyer
 *               genuinely owes less. The arithmetic below is the only place
 *               those two behave differently, and getting it backwards would
 *               print a total the buyer's bank statement disagrees with.
 * @param shop   The boutique: name, logo_url and address columns.
 * @param buyer  { name, email, phone, address, city, pincode }.
 */
export function receiptBody({ order, shop, buyer }) {
  const lines = Array.isArray(order?.lines) ? order.lines : [];

  const itemsGross = lines.reduce((sum, l) => sum + Number(l.price) * (Number(l.qty) || 1), 0);
  const sellerDiscount = Number(order?.discount ?? 0);
  const platformDiscount = Number(order?.platform_discount ?? 0);
  const delivery = Number(order?.shipping_fee ?? 0);
  // What the card was actually charged for this order — the same figure
  // api/place-order.js binds the Razorpay payment against.
  const paid = Number(order?.total ?? 0) + delivery - platformDiscount;

  // ── Reference block ──────────────────────────────────────────────────────
  // Both references, on purpose. The order number is what every other screen,
  // email and support conversation calls this order; the payment id is what
  // Razorpay's dashboard can be searched by. A buyer disputing a charge needs
  // the second one and would otherwise have nowhere to find it.
  const meta =
    `<table role="presentation" cellpadding="0" cellspacing="0">` +
    metaRow('Order Reference', order?.order_number ?? '—') +
    (order?.payment_id ? metaRow('Payment Reference', order.payment_id) : '') +
    metaRow('Paid On', paidOnDate(order?.paid_at ?? order?.created_at)) +
    `</table>`;

  // ── Bill From / Bill To ──────────────────────────────────────────────────
  // A two-column table rather than floats or flexbox: Outlook renders neither,
  // and this is the one part of the receipt where the columns must stay side by
  // side to read as a pair. At the 560px shell each column is ~250px, which
  // still holds an address on a phone.
  const logo = shopLogoImg(shop);
  const billFrom =
    label('Bill From') +
    (logo ? `<div style="margin:0 0 8px;">${logo}</div>` : '') +
    detailLine(shop?.name ?? 'Boutique', true) +
    shopAddressLines(shop).map((l) => detailLine(l)).join('') +
    `<div style="${FONT}font-size:11px;line-height:1.5;color:${FAINT};margin-top:8px;">Payment collected by MangaiMart on the boutique's behalf.</div>`;

  const buyerAddress = [buyer?.address, [buyer?.city, buyer?.pincode].filter(Boolean).join(' ')]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean);
  const billTo =
    label('Bill To') +
    detailLine(buyer?.name || 'Customer', true) +
    detailLine(buyer?.email) +
    detailLine(buyer?.phone) +
    buyerAddress.map((l) => detailLine(l)).join('');

  const parties =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
    `<tr>` +
    `<td width="50%" valign="top" style="padding:0 12px 0 0;">${billFrom}</td>` +
    `<td width="50%" valign="top" style="padding:0 0 0 12px;">${billTo}</td>` +
    `</tr></table>`;

  // ── Items ────────────────────────────────────────────────────────────────
  const head =
    `<tr>` +
    `<th align="left" style="${FONT}font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:${FAINT};font-weight:400;padding:0 0 8px;border-bottom:1px solid ${RULE};">Item Description</th>` +
    `<th align="right" style="${FONT}font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:${FAINT};font-weight:400;padding:0 0 8px 10px;border-bottom:1px solid ${RULE};white-space:nowrap;">Price</th>` +
    `<th align="right" style="${FONT}font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:${FAINT};font-weight:400;padding:0 0 8px 10px;border-bottom:1px solid ${RULE};">Qty</th>` +
    `<th align="right" style="${FONT}font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:${FAINT};font-weight:400;padding:0 0 8px 10px;border-bottom:1px solid ${RULE};white-space:nowrap;">Total</th>` +
    `</tr>`;

  const body = lines
    .map((l) => {
      const qty = Number(l.qty) || 1;
      const price = Number(l.price);
      // Size and colour go under the title rather than beside it: on a phone a
      // long saree name plus two variants on one line wraps into the price
      // column and the row stops scanning as a row.
      const variant = [l.size, l.color].filter(Boolean).join(' · ');
      return (
        `<tr>` +
        `<td align="left" style="${FONT}font-size:12.5px;color:${INK};font-weight:700;padding:10px 0;border-bottom:1px solid ${RULE};">` +
        `${esc(l.title)}` +
        (variant ? `<div style="${FONT}font-size:11.5px;color:${MUTED};font-weight:400;margin-top:2px;">${esc(variant)}</div>` : '') +
        `</td>` +
        `<td align="right" style="${FONT}font-size:12.5px;color:${MUTED};padding:10px 0 10px 10px;border-bottom:1px solid ${RULE};white-space:nowrap;">${esc(inr(price))}</td>` +
        `<td align="right" style="${FONT}font-size:12.5px;color:${MUTED};padding:10px 0 10px 10px;border-bottom:1px solid ${RULE};">${qty}</td>` +
        `<td align="right" style="${FONT}font-size:12.5px;color:${INK};font-weight:700;padding:10px 0 10px 10px;border-bottom:1px solid ${RULE};white-space:nowrap;">${esc(inr(price * qty))}</td>` +
        `</tr>`
      );
    })
    .join('');

  const items = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${head}${body}</table>`;

  // ── Totals ───────────────────────────────────────────────────────────────
  // Each discount is named for who funded it. "Discount" alone reads as one
  // pot of money; these are two, and the boutique's own offer is the one the
  // seller's statement will also show.
  const totals =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">` +
    totalRow('Items', inr(itemsGross)) +
    (sellerDiscount > 0 ? totalRow(`${shop?.name ?? 'Boutique'} offer`, '− ' + inr(sellerDiscount)) : '') +
    (platformDiscount > 0 ? totalRow('MangaiMart offer', '− ' + inr(platformDiscount)) : '') +
    totalRow('Delivery', delivery > 0 ? inr(delivery) : 'Free') +
    totalRow('Amount Paid', inr(paid), true) +
    `</table>`;

  const note =
    label('Note') +
    `<div style="${FONT}font-size:12px;line-height:1.6;color:${MUTED};">` +
    `Thank you for shopping with MangaiMart. Your payment has been received in full and your order is now with the boutique. ` +
    `We'll keep you updated at every step until it reaches you.</div>` +
    `<div style="${FONT}font-size:11px;line-height:1.6;color:${FAINT};margin-top:10px;">` +
    `This is a payment receipt, not a tax invoice.</div>`;

  const gap = (h) => `<div style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</div>`;

  return (
    meta +
    gap(20) +
    parties +
    gap(22) +
    items +
    gap(14) +
    totals +
    gap(24) +
    `<div style="border-top:1px solid ${RULE};padding-top:14px;">${note}</div>`
  );
}

/**
 * The plain-text half of the same receipt.
 *
 * Not optional: a message with no text part is scored as more likely to be spam
 * by most filters, and this one has to reach the inbox — it is the buyer's proof
 * of payment.
 */
export function receiptText({ order, shop, buyer, appUrl }) {
  const lines = Array.isArray(order?.lines) ? order.lines : [];
  const itemsGross = lines.reduce((sum, l) => sum + Number(l.price) * (Number(l.qty) || 1), 0);
  const delivery = Number(order?.shipping_fee ?? 0);
  const platformDiscount = Number(order?.platform_discount ?? 0);
  const sellerDiscount = Number(order?.discount ?? 0);
  const paid = Number(order?.total ?? 0) + delivery - platformDiscount;

  const out = [
    'PAYMENT RECEIPT',
    '',
    `Order Reference: ${order?.order_number ?? '—'}`,
    ...(order?.payment_id ? [`Payment Reference: ${order.payment_id}`] : []),
    `Paid On: ${paidOnDate(order?.paid_at ?? order?.created_at)}`,
    '',
    `Bill From: ${shop?.name ?? 'Boutique'}`,
    ...shopAddressLines(shop).map((l) => `  ${l}`),
    "  Payment collected by MangaiMart on the boutique's behalf.",
    '',
    `Bill To: ${buyer?.name || 'Customer'}`,
    ...[buyer?.email, buyer?.phone, buyer?.address, [buyer?.city, buyer?.pincode].filter(Boolean).join(' ')]
      .map((s) => String(s ?? '').trim())
      .filter(Boolean)
      .map((l) => `  ${l}`),
    '',
    ...lines.map((l) => {
      const qty = Number(l.qty) || 1;
      const variant = [l.size, l.color].filter(Boolean).join(' · ');
      return `${l.title}${variant ? ` (${variant})` : ''} x${qty} — ${inr(Number(l.price) * qty)}`;
    }),
    '',
    `Items: ${inr(itemsGross)}`,
    ...(sellerDiscount > 0 ? [`${shop?.name ?? 'Boutique'} offer: -${inr(sellerDiscount)}`] : []),
    ...(platformDiscount > 0 ? [`MangaiMart offer: -${inr(platformDiscount)}`] : []),
    `Delivery: ${delivery > 0 ? inr(delivery) : 'Free'}`,
    `Amount Paid: ${inr(paid)}`,
    '',
    `Track this order: ${appUrl}/orders/${order?.id ?? ''}`,
    '',
    'This is a payment receipt, not a tax invoice.',
  ];
  return out.join('\n') + '\n';
}
