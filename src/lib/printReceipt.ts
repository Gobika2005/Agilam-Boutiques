import type { PlacedOrder } from './orderHistory';
import type { ReceiptExtras } from '@/data/orders';

/**
 * The buyer's payment receipt, as a printable page.
 *
 * The same document api/_receipt.js emails at checkout, reachable again later
 * from the order screen — because the one moment a buyer wants a receipt is
 * rarely the moment it arrived. Opens in a new window and calls `print()`,
 * which is "Save as PDF" in every browser and on both mobile platforms. That is
 * the whole reason there is no PDF library anywhere near this: the browser
 * already has one.
 *
 * ── Why this is a deliberate mirror ─────────────────────────────────────────
 * The layout is duplicated from api/_receipt.js rather than shared. It has to
 * be: that file is plain ESM inside Vercel's `api/` (which the Vite bundle never
 * sees) and builds table-based HTML for mail clients, while this one is TypeScript
 * in the browser bundle and can use real CSS. Pricing already lives with the same
 * arrangement — src/lib/pricing.ts and api/_pricing.js — so the rule that governs
 * it governs here too: change one, change the other. The consequence of drift is
 * milder than pricing's (a receipt that reads differently from the emailed one,
 * not a failed checkout), but a buyer holding two documents that disagree about
 * what they paid is exactly the argument a receipt exists to prevent.
 *
 * Colours are literal hex, not `--ag-*` tokens, and that is correct here for the
 * same reason as in the email: this renders in a detached window with none of
 * the app's stylesheets, and it is going onto white paper or into a white PDF.
 * There is no dark mode to honour on a printed page.
 */

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const money = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/**
 * "16 Aug 2026", pinned to IST — matching api/_receipt.js exactly.
 *
 * The email is rendered on a Vercel function running in UTC and this one in
 * whatever zone the buyer's phone is set to. Left to their defaults, an order
 * paid just after midnight IST would carry one date in the inbox and another on
 * the printout, from the same payment. Fixing both to Asia/Kolkata is what makes
 * the two documents agree.
 */
function paidOnDate(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** Address lines, dropping a district that only repeats the city. */
function shopAddressLines(shop: ReceiptExtras['shop']): string[] {
  if (!shop) return [];
  const norm = (s: string | null) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const district = norm(shop.district) === norm(shop.city) ? null : shop.district;
  const region = [district, shop.state].filter(Boolean).join(', ');
  return [shop.addressLine, shop.city, [region, shop.pincode].filter(Boolean).join(' ')]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean);
}

/**
 * Open the receipt for one order and trigger the print dialog.
 *
 * `extras` may be null — a guest's order is mirrored only in this browser and
 * has no readable row — in which case the shop's postal details and the payment
 * reference are simply left out. A receipt missing its "Bill From" address is
 * still a receipt; refusing to produce one would be worse.
 *
 * Returns false when the browser refused the window. Several block pop-ups by
 * default, and a button that silently does nothing reads as broken — the caller
 * uses this to say what actually happened.
 */
export function printReceipt(order: PlacedOrder, extras: ReceiptExtras | null): boolean {
  const win = window.open('', '_blank', 'width=760,height=920');
  if (!win) return false;

  const shop = extras?.shop ?? null;
  const shopName = shop?.name ?? order.boutique;

  // ── The arithmetic, derived the same way the email derives it ─────────────
  // `PlacedOrder.total` is already what the buyer paid: goods, plus delivery and
  // any COD fee, minus the platform coupon (see fromBuyerOrder). Working back
  // from it is what lets a seller-funded coupon be named on its own line without
  // needing `orders.discount`, which the buyer's column grants don't include.
  const itemsGross = order.items.reduce((s, it) => s + it.price * it.qty, 0);
  const delivery = order.shippingFee ?? 0;
  const codFee = order.codFee ?? 0;
  const platformDiscount = order.platformDiscount ?? 0;
  const paid = order.total;
  const goodsNet = paid - delivery - codFee + platformDiscount;
  const sellerDiscount = Math.max(0, Math.round(itemsGross - goodsNet));

  /**
   * The MangaiMart wordmark, as artwork rather than as the word set in a serif.
   *
   * Absolute, built from the current origin: the print window is opened on
   * `about:blank` and filled with `document.write`, so it has no base URL of its
   * own and a root-relative `/mangaimart-wordmark.png` is not reliably resolved.
   *
   * PNG rather than the smaller WebP next to it in /public, for the same reason
   * api/_email.js picks PNG — this document's destination is a print engine or a
   * PDF writer, and PNG is the one raster format all of them handle without
   * argument. It is 800px wide and prints at 34px tall, so it stays crisp on
   * paper.
   *
   * The text wordmark ships alongside it, hidden, and `onerror` swaps the two.
   * Writing the fallback as markup inside the handler instead would mean nesting
   * escaped HTML in an escaped JS string in an HTML attribute — three levels of
   * quoting for one `<div>`, and the kind of thing that breaks silently. Two
   * elements and a display toggle need no escaping at all.
   */
  const wordmarkSrc = `${window.location.origin}/mangaimart-wordmark.png`;
  const wordmark =
    `<div class="brand">` +
    `<img class="wordmark" src="${esc(wordmarkSrc)}" alt="MangaiMart" ` +
    `onerror="this.style.display='none';this.nextElementSibling.style.display='block'" />` +
    `<div class="wordmark-text">MangaiMart</div>` +
    `</div>`;

  const logo =
    shop?.logoUrl && /^https?:\/\//i.test(shop.logoUrl)
      ? `<img class="shoplogo" src="${esc(shop.logoUrl)}" alt="" />`
      : '';

  const itemRows = order.items
    .map(
      (it) => `<tr>
        <td class="desc"><b>${esc(it.title)}</b>${it.size ? `<div class="variant">${esc(it.size)}</div>` : ''}</td>
        <td class="num">${money(it.price)}</td>
        <td class="num qty">${it.qty}</td>
        <td class="num strong">${money(it.price * it.qty)}</td>
      </tr>`,
    )
    .join('');

  const totalRow = (name: string, value: string, cls = '') =>
    `<tr class="${cls}"><td class="tlabel">${esc(name)}</td><td class="tvalue">${esc(value)}</td></tr>`;

  const buyerLines = [
    extras?.buyer.phone,
    extras?.buyer.address,
    [extras?.buyer.city, extras?.buyer.pincode].filter(Boolean).join(' '),
  ]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean);

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<title>Payment Receipt ${esc(order.orderNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; color: #241019; margin: 0; padding: 40px; background: #fff; }
  .sheet { max-width: 720px; margin: 0 auto; }
  .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .wordmark { height: 34px; width: auto; display: block; }
  /* Shown only if the artwork fails to load — see the onerror swap. */
  .wordmark-text { display: none; font-family: Georgia, "Times New Roman", serif; font-size: 21px; font-weight: 700; letter-spacing: -.01em; color: #B02454; }
  .shoplogo { width: 56px; height: 56px; border-radius: 10px; object-fit: cover; border: 1px solid #EFDCE4; }
  h1 { font-size: 27px; font-weight: 800; margin: 26px 0 14px; letter-spacing: -.02em; }
  .meta td { font-size: 12px; padding: 2px 0; }
  .meta .k { color: #9A828C; padding-right: 18px; white-space: nowrap; }
  .meta .v { color: #241019; font-weight: 700; }
  .parties { display: flex; gap: 40px; margin: 30px 0 26px; }
  .party { flex: 1; min-width: 0; }
  .lbl { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: #9A828C; margin-bottom: 7px; }
  .party b { font-size: 13.5px; display: block; margin-bottom: 2px; }
  .party div.l { font-size: 12.5px; line-height: 1.6; color: #775D66; }
  .collected { font-size: 11px; color: #9A828C; margin-top: 9px; line-height: 1.5; }
  table.items { width: 100%; border-collapse: collapse; }
  table.items th { font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: #9A828C; font-weight: 400; text-align: right; padding: 0 0 9px 12px; border-bottom: 1px solid #EFDCE4; }
  table.items th.first { text-align: left; padding-left: 0; }
  table.items td { padding: 12px 0 12px 12px; border-bottom: 1px solid #EFDCE4; font-size: 13px; vertical-align: top; }
  td.desc { padding-left: 0; }
  .variant { font-size: 11.5px; color: #775D66; font-weight: 400; margin-top: 2px; }
  .num { text-align: right; white-space: nowrap; color: #775D66; }
  .num.strong { color: #241019; font-weight: 700; }
  .qty { white-space: normal; }
  table.totals { margin: 16px 0 0 auto; border-collapse: collapse; min-width: 260px; }
  .tlabel { text-align: right; padding: 5px 14px 5px 0; font-size: 12.5px; color: #775D66; }
  .tvalue { text-align: right; padding: 5px 0; font-size: 12.5px; font-weight: 700; white-space: nowrap; }
  tr.grand .tlabel, tr.grand .tvalue { border-top: 1px solid #EFDCE4; padding-top: 11px; font-size: 16px; color: #241019; }
  .note { margin-top: 34px; padding-top: 16px; border-top: 1px solid #EFDCE4; }
  .note p { font-size: 12px; line-height: 1.65; color: #775D66; margin: 0; }
  .note .fine { font-size: 11px; color: #9A828C; margin-top: 11px; }
  @media print { body { padding: 0; } @page { margin: 16mm; } }
</style></head>
<body><div class="sheet">
  <div class="top">
    ${wordmark}
    ${logo}
  </div>

  <h1>Payment Receipt</h1>
  <table class="meta">
    <tr><td class="k">Order Reference</td><td class="v">${esc(order.orderNumber)}</td></tr>
    ${extras?.paymentId ? `<tr><td class="k">Payment Reference</td><td class="v">${esc(extras.paymentId)}</td></tr>` : ''}
    <tr><td class="k">Paid On</td><td class="v">${esc(paidOnDate(extras?.paidAt ?? order.placedAt))}</td></tr>
  </table>

  <div class="parties">
    <div class="party">
      <div class="lbl">Bill From</div>
      <b>${esc(shopName)}</b>
      ${shopAddressLines(shop).map((l) => `<div class="l">${esc(l)}</div>`).join('')}
      <div class="collected">Payment collected by MangaiMart on the boutique's behalf.</div>
    </div>
    <div class="party">
      <div class="lbl">Bill To</div>
      <b>${esc(extras?.buyer.name || 'Customer')}</b>
      ${buyerLines.map((l) => `<div class="l">${esc(l)}</div>`).join('')}
    </div>
  </div>

  <table class="items">
    <thead><tr>
      <th class="first">Item Description</th><th>Price</th><th>Qty</th><th>Total</th>
    </tr></thead>
    <tbody>${itemRows || '<tr><td class="desc" colspan="4">No items recorded</td></tr>'}</tbody>
  </table>

  <table class="totals">
    ${totalRow('Items', money(itemsGross))}
    ${sellerDiscount > 0 ? totalRow(`${shopName} offer`, '− ' + money(sellerDiscount)) : ''}
    ${platformDiscount > 0 ? totalRow('MangaiMart offer', '− ' + money(platformDiscount)) : ''}
    ${codFee > 0 ? totalRow('Cash handling', money(codFee)) : ''}
    ${totalRow('Delivery', delivery > 0 ? money(delivery) : 'Free')}
    ${totalRow('Amount Paid', money(paid), 'grand')}
  </table>

  <div class="note">
    <div class="lbl">Note</div>
    <p>Thank you for shopping with MangaiMart. Your payment has been received in full and your order is with the boutique. We'll keep you updated at every step until it reaches you.</p>
    <p class="fine">This is a payment receipt, not a tax invoice.</p>
  </div>
</div>
<script>window.onload = function () { window.print(); };</script>
</body></html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}
