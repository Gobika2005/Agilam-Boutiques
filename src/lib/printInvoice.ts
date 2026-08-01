import type { OrderView } from './orderView';
import { COMPANY } from '@/data/company';

const money = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Opens a print-ready invoice for one order in a new window and triggers the
 * browser's print dialog (which is also "Save as PDF" everywhere). Plain HTML
 * so it needs no heavy canvas/pdf dependency — the seller prints or saves it
 * straight from the list.
 */
export function printInvoice(o: OrderView, boutiqueName: string): void {
  const win = window.open('', '_blank', 'width=720,height=900');
  if (!win) return;

  const rows = (o.items ?? [])
    .map(
      (it) => `<tr>
        <td>${esc(it.title)}${it.size ? ` · ${esc(it.size)}` : ''}${it.color ? ` · ${esc(it.color)}` : ''}</td>
        <td class="num">${it.qty}</td>
        <td class="num">${money(Number(it.price))}</td>
        <td class="num">${money(Number(it.price) * it.qty)}</td>
      </tr>`,
    )
    .join('');

  const feeRow = (label: string, val: number) =>
    val > 0 ? `<tr><td colspan="3" class="lbl">${label}</td><td class="num">${money(val)}</td></tr>` : '';

  const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>Invoice ${esc(o.number)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #241019; margin: 0; padding: 32px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #B02454; padding-bottom: 16px; }
  .brand { font-size: 22px; font-weight: 800; color: #B02454; }
  .sub { font-size: 12px; color: #8A7078; margin-top: 2px; }
  h1 { font-size: 15px; letter-spacing: .12em; text-transform: uppercase; color: #8A7078; margin: 0 0 4px; text-align: right; }
  .meta { font-size: 12px; color: #5C4650; text-align: right; line-height: 1.6; }
  .to { margin: 22px 0; font-size: 13px; line-height: 1.6; }
  .to b { display: block; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: #8A7078; margin-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
  th { text-align: left; background: #FBF0F5; padding: 9px 10px; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: #8A5A72; }
  td { padding: 9px 10px; border-bottom: 1px solid #F0E2E9; }
  .num { text-align: right; white-space: nowrap; }
  .lbl { text-align: right; color: #8A7078; }
  .total td { border-top: 2px solid #B02454; border-bottom: none; font-weight: 800; font-size: 15px; color: #B02454; }
  .foot { margin-top: 28px; font-size: 11px; color: #8A7078; text-align: center; line-height: 1.6; }
  @media print { body { padding: 0; } @page { margin: 16mm; } }
</style></head>
<body>
  <div class="head">
    <div>
      <div class="brand">${esc(boutiqueName)}</div>
      <div class="sub">via ${esc(COMPANY.brand)}</div>
    </div>
    <div>
      <h1>Invoice</h1>
      <div class="meta">${esc(o.number)}<br/>${esc(o.date)}<br/>${o.channel === 'offline' ? 'Walk-in bill' : 'Online order'}${o.paymentMethod ? ` · ${esc(o.paymentMethod)}` : ''}</div>
    </div>
  </div>

  <div class="to">
    <b>Billed to</b>
    ${esc(o.customer)}${o.phone ? `<br/>${esc(o.phone)}` : ''}${o.address ? `<br/>${esc(o.address)}` : ''}${o.city ? `<br/>${esc(o.city)}` : ''}
  </div>

  <table>
    <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
    <tbody>
      ${rows || '<tr><td colspan="4">No items</td></tr>'}
      ${o.platformDiscount > 0 ? `<tr><td colspan="3" class="lbl">${esc(COMPANY.brand)} offer</td><td class="num">− ${money(o.platformDiscount)}</td></tr>` : ''}
      ${feeRow('Delivery', o.shippingFee)}
      ${feeRow('Cash handling', o.codFee)}
      <tr class="total"><td colspan="3" class="lbl">Total</td><td class="num">${money(o.grandTotal)}</td></tr>
    </tbody>
  </table>

  ${o.isCod && o.collectAmount > 0 ? `<div style="margin-top:14px;padding:10px 12px;background:#FFF8E8;border:1px solid #F0DCB4;border-radius:8px;font-size:12px;color:#7A5C2A;"><b>${money(o.collectAmount)}</b> to be collected in cash on delivery.</div>` : ''}

  <div class="foot">Thank you for shopping with ${esc(boutiqueName)}.<br/>This is a computer-generated invoice.</div>

  <script>window.onload = function () { window.print(); };</script>
</body></html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}
