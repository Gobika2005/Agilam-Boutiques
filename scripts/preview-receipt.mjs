/**
 * Render the buyer's payment receipt to a file, without placing an order.
 *
 *   node scripts/preview-receipt.mjs
 *
 * The receipt that reaches a buyer is built by api/_receipt.js and sent from
 * api/place-order.js at checkout. Seeing it normally means a real payment, so
 * this feeds the same builders a sample order and writes the result to disk —
 * open it in a browser to check the layout, the wording and the arithmetic.
 *
 * What it does NOT check is delivery: whether Resend is configured, whether the
 * from-domain is verified, whether the mail lands in an inbox or a spam folder.
 * Only a real send proves that. See the notes at the bottom of this file.
 *
 * Nothing here touches the database or the network.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { layout, inr } from '../api/_email.js';
import { receiptBody, receiptText } from '../api/_receipt.js';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, '..', 'receipt-preview.html');

/* ── A sample order ─────────────────────────────────────────────────────────
 * Deliberately awkward: two boutique-funded and platform-funded discounts at
 * once, a multi-quantity line, a variant on one item and not the other, and a
 * paid_at just after midnight IST. If the receipt reads correctly for this one
 * it reads correctly for an ordinary order. Edit freely — it is only a sample.
 */
const shop = {
  name: 'Saravana Silks',
  logo_url: 'https://mangaimart.com/mangaimart-logo.png',
  address_line: '12 Cross Cut Road, Gandhipuram',
  city: 'Coimbatore',
  district: 'Coimbatore',
  state: 'Tamil Nadu',
  pincode: '641012',
};

const buyer = {
  name: 'Priya R',
  email: 'priya@example.com',
  phone: '+91 99999 99999',
  address: '4B Lake View Apartments, Anna Nagar',
  city: 'Chennai',
  pincode: '600040',
};

const order = {
  id: 'e3b0c442-98fc-1c14-9afb-f4c8996fb924',
  order_number: 'AGL-1042',
  payment_id: 'pay_QxRt7ZmK1a2B3c',
  // 19:41 UTC on the 16th is 01:11 IST on the 17th — the receipt must say the
  // 17th, because that is the date the buyer's phone showed when they paid.
  paid_at: '2026-08-16T19:41:00.000Z',
  total: 3900, // 4,100 goods − 200 boutique coupon
  discount: 200,
  platform_discount: 300,
  shipping_fee: 89,
  lines: [
    { title: 'Banarasi silk saree with zari border', price: 2400, qty: 1, size: 'Free size', color: 'Maroon' },
    { title: 'Cotton kurta', price: 850, qty: 2, size: 'M', color: null },
  ],
};

const appUrl = process.env.APP_URL || 'https://mangaimart.com';
const paid = order.total + order.shipping_fee - order.platform_discount;

// ── The arithmetic the receipt has to agree with ────────────────────────────
// Independent of the receipt code on purpose: if this file and api/_receipt.js
// ever disagree, that is the bug worth catching.
const gross = order.lines.reduce((s, l) => s + l.price * l.qty, 0);
const expected = gross - order.discount - order.platform_discount + order.shipping_fee;
console.log('Items gross          ', inr(gross));
console.log('Amount Paid          ', inr(paid));
console.log('Independently derived', inr(expected), expected === paid ? '✓ agrees' : '✗ MISMATCH');
console.log();

const html = layout({
  heading: 'Payment Receipt',
  intro: `Thanks, ${buyer.name} — ${shop.name} has your payment of ${inr(paid)} and is getting order ${order.order_number} ready. We'll tell you the moment it ships.`,
  bodyHtml: receiptBody({ order, shop, buyer }),
  ctaLabel: 'Track this order',
  ctaHref: `${appUrl}/orders/${order.id}`,
  footerNote: 'Keep this receipt — it is your proof of payment for this order.',
});

writeFileSync(outFile, html);

console.log(receiptText({ order, shop, buyer, appUrl }));
console.log('─'.repeat(64));
console.log('Open in a browser:', pathToFileURL(outFile).href);
console.log();
console.log('This previews the LAYOUT only. To prove a receipt actually sends,');
console.log('place a test order with Razorpay test keys and watch the function');
console.log('log for "place-order: buyer receipt email failed" — silence there');
console.log('means Resend accepted it.');
