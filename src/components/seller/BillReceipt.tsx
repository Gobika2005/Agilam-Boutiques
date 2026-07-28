import { forwardRef } from 'react';
import { css } from '@/lib/css';
import { fmt } from '@/data/demo';

export type BillReceiptItem = { title: string; qty: number; price: number };

export type BillReceiptProps = {
  boutiqueName: string;
  boutiquePhone?: string | null;
  billNumber: string;
  date: string;
  buyerName: string;
  buyerPhone?: string;
  items: BillReceiptItem[];
  discount?: number;
  shippingFee?: number;
  codFee?: number;
  /** The grand total — goods, delivery and any cash handling fee. */
  total: number;
  paymentMethod?: string | null;
  /** Set on an unpaid COD order so the bill reads as a demand, not a receipt. */
  amountDue?: number;
};

/** Premium, brand-styled bill card — rendered off-DOM or inline and captured
 *  to a PNG/PDF via html2canvas (see src/lib/billImage.ts) so what gets
 *  shared to a buyer's WhatsApp looks like an actual invoice, not plain text. */
export const BillReceipt = forwardRef<HTMLDivElement, BillReceiptProps>(function BillReceipt(
  { boutiqueName, boutiquePhone, billNumber, date, buyerName, buyerPhone, items, discount = 0, shippingFee = 0, codFee = 0, total, paymentMethod, amountDue },
  ref,
) {
  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const initial = boutiqueName.charAt(0).toUpperCase() || 'A';

  return (
    <div ref={ref} style={css('width:420px;background:#fff;font-family:"Inter",sans-serif;')}>
      <div style={css('background:linear-gradient(135deg,#8E1C44 0%,#B02454 55%,#D6336C 100%);padding:28px 30px 24px;color:#fff;')}>
        <div style={css('display:flex;align-items:center;gap:12px;')}>
          <div style={css("width:44px;height:44px;flex:none;border-radius:13px;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>{initial}</div>
          <div style={css('flex:1;min-width:0;')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;line-height:1.15;")}>{boutiqueName}</div>
            {boutiquePhone && <div style={css('font-size:11px;opacity:.85;margin-top:2px;')}>{boutiquePhone}</div>}
          </div>
        </div>
        <div style={css('display:flex;justify-content:space-between;align-items:flex-end;margin-top:22px;')}>
          <div>
            <div style={css('font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;opacity:.8;')}>Bill</div>
            <div style={css('font-size:15px;font-weight:800;margin-top:2px;')}>{billNumber}</div>
          </div>
          <div style={css('text-align:right;')}>
            <div style={css('font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;opacity:.8;')}>Date</div>
            <div style={css('font-size:13px;font-weight:700;margin-top:2px;')}>{date}</div>
          </div>
        </div>
      </div>

      <div style={css('padding:22px 30px 8px;')}>
        <div style={css('font-size:9.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ag-muted-soft);font-weight:700;')}>Billed to</div>
        <div style={css('font-size:15px;font-weight:800;color:var(--ag-ink);margin-top:4px;')}>{buyerName || 'Customer'}</div>
        {buyerPhone && <div style={css('font-size:12px;color:var(--ag-muted);margin-top:2px;')}>{buyerPhone}</div>}
      </div>

      <div style={css('padding:14px 30px 0;')}>
        <div style={css('display:flex;padding:0 0 8px;border-bottom:1.5px solid #241019;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:var(--ag-muted);')}>
          <span style={css('flex:1;')}>Item</span>
          <span style={css('width:36px;text-align:center;')}>Qty</span>
          <span style={css('width:84px;text-align:right;')}>Amount</span>
        </div>
        {items.map((it, i) => (
          <div key={i} style={css('display:flex;align-items:center;padding:10px 0;border-bottom:1px solid var(--ag-surface-3);font-size:13px;')}>
            <span style={css('flex:1;color:var(--ag-ink);font-weight:600;padding-right:8px;')}>{it.title}</span>
            <span style={css('width:36px;text-align:center;color:var(--ag-ink-2);')}>{it.qty}</span>
            <span style={css('width:84px;text-align:right;font-weight:700;color:var(--ag-ink);')}>{fmt(it.price * it.qty)}</span>
          </div>
        ))}
      </div>

      <div style={css('padding:14px 30px 0;')}>
        <div style={css('display:flex;justify-content:space-between;font-size:13px;color:var(--ag-muted);padding:4px 0;')}>
          <span>Subtotal</span><span style={css('font-weight:700;color:var(--ag-ink);')}>{fmt(subtotal)}</span>
        </div>
        {discount > 0 && (
          <div style={css('display:flex;justify-content:space-between;font-size:13px;color:var(--ag-good);padding:4px 0;')}>
            <span>Discount</span><span style={css('font-weight:700;')}>-{fmt(discount)}</span>
          </div>
        )}
        {shippingFee > 0 && (
          <div style={css('display:flex;justify-content:space-between;font-size:13px;color:var(--ag-muted);padding:4px 0;')}>
            <span>Delivery</span><span style={css('font-weight:700;color:var(--ag-ink);')}>{fmt(shippingFee)}</span>
          </div>
        )}
        {codFee > 0 && (
          <div style={css('display:flex;justify-content:space-between;font-size:13px;color:var(--ag-muted);padding:4px 0;')}>
            <span>Cash handling</span><span style={css('font-weight:700;color:var(--ag-ink);')}>{fmt(codFee)}</span>
          </div>
        )}
        {paymentMethod && (
          <div style={css('display:flex;justify-content:space-between;font-size:13px;color:var(--ag-muted);padding:4px 0;')}>
            <span>Payment</span><span style={css('font-weight:700;color:var(--ag-ink);')}>{paymentMethod}</span>
          </div>
        )}
      </div>

      <div style={css('margin:16px 30px 0;padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,var(--ag-surface-2),#F8D2E2);display:flex;justify-content:space-between;align-items:center;')}>
        <span style={css('font-size:13px;font-weight:800;color:#8E1C44;letter-spacing:.04em;text-transform:uppercase;')}>Total</span>
        <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;color:#B02454;")}>{fmt(total)}</span>
      </div>

      {/* On an unpaid COD order this is the point of the whole document — the
          buyer needs the figure to have ready, not a receipt for a payment
          that hasn't happened. */}
      {amountDue != null && amountDue > 0 && (
        <div style={css('margin:10px 30px 0;padding:12px 16px;border-radius:14px;background:#FFF8E8;border:1px solid #F0DCB4;display:flex;justify-content:space-between;align-items:center;')}>
          <span style={css('font-size:12px;font-weight:800;color:#B0862B;letter-spacing:.04em;text-transform:uppercase;')}>Pay on delivery</span>
          <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;color:#B0862B;")}>{fmt(amountDue)}</span>
        </div>
      )}

      <div style={css('padding:20px 30px 26px;text-align:center;')}>
        <div style={css("font-family:'Playfair Display',serif;font-style:italic;font-size:13px;color:var(--ag-ink-2);")}>Thank you for shopping with {boutiqueName}!</div>
        <div style={css('margin-top:10px;font-size:9.5px;letter-spacing:.1em;color:#CBB0BC;text-transform:uppercase;')}>Powered by MangaiMart</div>
      </div>
    </div>
  );
});
