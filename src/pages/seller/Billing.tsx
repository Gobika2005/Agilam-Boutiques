import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { useShop } from '@/state/ShopContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchProductsByBoutique } from '@/data/products';
import { createOfflineSale, type OfflineSaleItem, type OfflineSaleResult } from '@/data/offlineSales';
import { buildWhatsAppLink, buildBillShareCaption } from '@/lib/whatsapp';
import { shareOrDownloadBillImage, downloadBillPdf, openPendingWhatsAppTab } from '@/lib/billImage';
import { BillReceipt } from '@/components/seller/BillReceipt';
import { TONES, fmt } from '@/data/demo';

type CartLine = OfflineSaleItem & { key: string; stock: number | null };

const PAYMENT_METHODS = ['Cash', 'UPI', 'Card', 'Other'];
const inputStyle = 'width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;padding:0 14px;height:48px;font-size:14px;font-weight:600;';
const labelStyle = 'font-size:13px;font-weight:700;color:var(--ag-label);';
const cardStyle = 'background:var(--ag-surface);border-radius:16px;padding:14px;box-shadow:0 10px 26px -22px rgba(107,20,54,.6);';

export function Billing() {
  const navigate = useNavigate();
  const { showToast } = useShop();
  const { boutique } = useMyBoutique();
  const { data: products } = useAsync(() => (boutique ? fetchProductsByBoutique(boutique.id) : Promise.resolve([])), [boutique?.id]);

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [custom, setCustom] = useState({ title: '', price: '', qty: '1' });
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [discount, setDiscount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [creating, setCreating] = useState(false);
  const [receipt, setReceipt] = useState<OfflineSaleResult | null>(null);
  const [sharing, setSharing] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);

  const filtered = (products ?? []).filter((p) => p.title.toLowerCase().includes(search.trim().toLowerCase()));

  const addProduct = (p: NonNullable<typeof products>[number]) => {
    setCart((c) => {
      const existing = c.find((l) => l.product_id === p.id);
      const stock = p.stock;
      if (existing) {
        if (existing.qty >= stock) {
          showToast('No more stock left');
          return c;
        }
        return c.map((l) => (l.product_id === p.id ? { ...l, qty: l.qty + 1 } : l));
      }
      if (stock <= 0) {
        showToast('Out of stock');
        return c;
      }
      return [...c, { key: p.id, product_id: p.id, title: p.title, price: Number(p.price), qty: 1, stock }];
    });
  };

  const setQty = (key: string, qty: number) => {
    setCart((c) => c
      .map((l) => (l.key === key ? { ...l, qty: l.stock != null ? Math.min(qty, l.stock) : qty } : l))
      .filter((l) => l.qty > 0));
  };

  const removeLine = (key: string) => setCart((c) => c.filter((l) => l.key !== key));

  const addCustom = () => {
    if (!custom.title.trim() || !custom.price.trim() || Number(custom.price) <= 0) {
      showToast('Enter an item name and price');
      return;
    }
    setCart((c) => [...c, {
      key: `custom-${Date.now()}`,
      product_id: null,
      title: custom.title.trim(),
      price: Number(custom.price),
      qty: Math.max(1, Number(custom.qty) || 1),
      stock: null,
    }]);
    setCustom({ title: '', price: '', qty: '1' });
  };

  const subtotal = cart.reduce((s, l) => s + l.price * l.qty, 0);
  const discountVal = Math.min(subtotal, Number(discount) || 0);
  const total = Math.max(0, subtotal - discountVal);

  const generateBill = async () => {
    if (!boutique) return;
    if (cart.length === 0) {
      showToast('Add at least one item');
      return;
    }
    if (!buyerName.trim() || !buyerPhone.trim()) {
      showToast('Enter the buyer’s name and phone number');
      return;
    }
    setCreating(true);
    try {
      const result = await createOfflineSale({
        boutique_id: boutique.id,
        buyer_name: buyerName.trim(),
        buyer_phone: buyerPhone.trim(),
        items: cart.map(({ product_id, title, price, qty }) => ({ product_id, title, price, qty })),
        discount: discountVal,
        payment_method: paymentMethod,
      });
      setReceipt(result);
      showToast('Bill generated');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not generate the bill');
    } finally {
      setCreating(false);
    }
  };

  const newBill = () => {
    setCart([]);
    setBuyerName('');
    setBuyerPhone('');
    setDiscount('');
    setPaymentMethod('Cash');
    setReceipt(null);
  };

  const billDate = receipt ? new Date(receipt.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  const shareBillImage = async () => {
    if (!receiptRef.current || !receipt) return;
    // Must open synchronously, still inside this click's user gesture — see
    // openPendingWhatsAppTab's doc comment for why (a window.open() issued
    // after the async bill render below gets silently popup-blocked).
    const pendingTab = openPendingWhatsAppTab();
    setSharing(true);
    try {
      const caption = buildBillShareCaption({
        boutiqueName: boutique?.name ?? 'Agilam Boutique',
        boutiqueSlug: boutique?.slug,
        buyerName,
        billNumber: receipt.order_number,
        total: receipt.total,
      });
      const result = await shareOrDownloadBillImage(receiptRef.current, `Bill-${receipt.order_number}.png`, caption);
      if (result === 'downloaded') {
        showToast('Bill image saved — attach it in the WhatsApp chat that just opened');
        if (pendingTab) pendingTab.location.href = buildWhatsAppLink(buyerPhone, caption);
      } else {
        pendingTab?.close();
        if (result === 'shared') showToast('Bill shared');
      }
    } catch (e) {
      pendingTab?.close();
      showToast(e instanceof Error ? e.message : 'Could not generate the bill image');
    } finally {
      setSharing(false);
    }
  };

  const downloadPdf = async () => {
    if (!receiptRef.current || !receipt) return;
    try {
      await downloadBillPdf(receiptRef.current, `Bill-${receipt.order_number}.pdf`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not generate the PDF');
    }
  };

  if (receipt) {
    return (
      <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
        <div className="agx-no-print" style={css('padding:6px 20px 12px;display:flex;align-items:center;gap:10px;')}>
          <button onClick={newBill} style={css('width:42px;height:42px;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
            <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
          </button>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;")}>Bill generated</div>
        </div>

        <div style={css('padding:6px 20px 0;display:flex;flex-direction:column;align-items:center;')}>
          <div style={css('width:100%;max-width:420px;border-radius:18px;overflow:hidden;box-shadow:0 20px 46px -26px rgba(107,20,54,.6);')}>
            <BillReceipt
              ref={receiptRef}
              boutiqueName={boutique?.name ?? 'Agilam Boutique'}
              boutiquePhone={boutique?.phone}
              billNumber={receipt.order_number}
              date={billDate}
              buyerName={buyerName}
              buyerPhone={buyerPhone}
              items={cart.map((l) => ({ title: l.title, qty: l.qty, price: l.price }))}
              discount={discountVal}
              total={receipt.total}
              paymentMethod={paymentMethod}
            />
          </div>

          <div className="agx-no-print" style={css('display:flex;flex-direction:column;gap:10px;margin-top:16px;width:100%;max-width:420px;')}>
            <button onClick={shareBillImage} disabled={sharing} style={css(`width:100%;height:52px;border:none;border-radius:14px;background:linear-gradient(135deg,var(--ag-good),#1E8A57);color:#fff;font-weight:800;font-size:15px;cursor:${sharing ? 'default' : 'pointer'};opacity:${sharing ? 0.7 : 1};display:flex;align-items:center;justify-content:center;gap:8px;`)}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>share</span>{sharing ? 'Preparing…' : 'Share Bill on WhatsApp'}
            </button>
            <button onClick={downloadPdf} style={css('width:100%;height:48px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-ink-2);border-radius:14px;font-weight:800;font-size:14px;cursor:pointer;')}>Download PDF</button>
            <button onClick={() => navigate(`/seller/orders/${encodeURIComponent(receipt.id)}`)} style={css('width:100%;height:48px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-ink-2);border-radius:14px;font-weight:800;font-size:14px;cursor:pointer;')}>View in Orders</button>
            <button onClick={newBill} style={css('width:100%;height:48px;border:none;background:transparent;color:var(--ag-crimson);font-weight:800;font-size:14px;cursor:pointer;')}>New bill</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
      <div style={css('padding:6px 20px 12px;display:flex;align-items:center;gap:10px;')}>
        <button onClick={() => navigate('/seller/dashboard')} style={css('width:42px;height:42px;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
        </button>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;")}>New Bill</div>
      </div>

      <div style={css('padding:6px 20px 0;display:flex;flex-direction:column;gap:14px;')}>
        <div style={css(cardStyle)}>
          <div style={css('font-size:12px;font-weight:800;color:var(--ag-muted);letter-spacing:.05em;')}>ADD ITEMS FROM YOUR STORE</div>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your products…" style={css(inputStyle)} />
          <div style={css('display:flex;flex-direction:column;gap:8px;margin-top:10px;max-height:220px;overflow-y:auto;')}>
            {filtered.map((p) => (
              <div key={p.id} onClick={() => addProduct(p)} style={css('display:flex;align-items:center;gap:10px;padding:8px;border-radius:12px;cursor:pointer;')}>
                <div style={css(`width:40px;height:40px;flex:none;border-radius:10px;background:${TONES[p.tone]};position:relative;overflow:hidden;`)}>
                  <ImageSlot src={p.image_url ?? undefined} placeholder={p.title} style={css('position:absolute;inset:0;')} />
                </div>
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{p.title}</div>
                  <div style={css('font-size:11.5px;color:var(--ag-muted);')}>{fmt(Number(p.price))} · {p.stock} in stock</div>
                </div>
                <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;")}>add_circle</span>
              </div>
            ))}
            {filtered.length === 0 && <div style={css('color:var(--ag-muted);font-size:13px;padding:6px 2px;')}>No products found.</div>}
          </div>
        </div>

        <div style={css(cardStyle)}>
          <div style={css('font-size:12px;font-weight:800;color:var(--ag-muted);letter-spacing:.05em;')}>CUSTOM ITEM (off-catalog)</div>
          <div style={css('display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;')}>
            <input value={custom.title} onChange={(e) => setCustom((c) => ({ ...c, title: e.target.value }))} placeholder="Item name" style={css(`${inputStyle}flex:2;min-width:120px;`)} />
            <input value={custom.price} onChange={(e) => setCustom((c) => ({ ...c, price: e.target.value }))} inputMode="numeric" placeholder="Price" style={css(`${inputStyle}flex:1;min-width:80px;`)} />
            <input value={custom.qty} onChange={(e) => setCustom((c) => ({ ...c, qty: e.target.value }))} inputMode="numeric" placeholder="Qty" style={css(`${inputStyle}width:64px;flex:none;`)} />
          </div>
          <button onClick={addCustom} style={css('margin-top:10px;width:100%;height:42px;border:1.5px dashed #E6BCCF;background:var(--ag-surface);color:var(--ag-crimson);border-radius:12px;font-weight:800;font-size:13px;cursor:pointer;')}>+ Add custom item</button>
        </div>

        {cart.length > 0 && (
          <div style={css(cardStyle)}>
            <div style={css('font-size:12px;font-weight:800;color:var(--ag-muted);letter-spacing:.05em;')}>BILL ITEMS</div>
            <div style={css('display:flex;flex-direction:column;gap:8px;margin-top:8px;')}>
              {cart.map((l) => (
                <div key={l.key} style={css('display:flex;align-items:center;gap:10px;')}>
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{l.title}</div>
                    <div style={css('font-size:11.5px;color:var(--ag-muted);')}>{fmt(l.price)} each</div>
                  </div>
                  <div style={css('display:flex;align-items:center;gap:8px;')}>
                    <button onClick={() => setQty(l.key, l.qty - 1)} style={css('width:28px;height:28px;border-radius:9px;border:1.5px solid var(--ag-border);background:var(--ag-surface);cursor:pointer;')}>−</button>
                    <span style={css('font-weight:800;font-size:13px;width:18px;text-align:center;')}>{l.qty}</span>
                    <button onClick={() => setQty(l.key, l.qty + 1)} style={css('width:28px;height:28px;border-radius:9px;border:1.5px solid var(--ag-border);background:var(--ag-surface);cursor:pointer;')}>+</button>
                  </div>
                  <span style={css('font-weight:800;font-size:13.5px;color:var(--ag-crimson);width:74px;text-align:right;')}>{fmt(l.price * l.qty)}</span>
                  <button onClick={() => removeLine(l.key)} style={css('width:28px;height:28px;border:none;background:none;cursor:pointer;')}>
                    <span style={css("font-family:'Material Symbols Outlined';font-size:18px;color:#D6455A;")}>close</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={css(cardStyle)}>
          <div style={css('font-size:12px;font-weight:800;color:var(--ag-muted);letter-spacing:.05em;')}>BUYER DETAILS</div>
          <label style={css(labelStyle)}>Name<input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} placeholder="Priya Sharma" style={css(inputStyle)} /></label>
          <label style={css(`${labelStyle}display:block;margin-top:10px;`)}>WhatsApp number<input value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" style={css(inputStyle)} /></label>
          <label style={css(`${labelStyle}display:block;margin-top:10px;`)}>Discount (₹) — optional<input value={discount} onChange={(e) => setDiscount(e.target.value)} inputMode="numeric" placeholder="0" style={css(inputStyle)} /></label>
          <div style={css(`${labelStyle}margin-top:10px;`)}>Payment method</div>
          <div style={css('display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;')}>
            {PAYMENT_METHODS.map((m) => {
              const on = paymentMethod === m;
              return (
                <span key={m} onClick={() => setPaymentMethod(m)} style={css(`padding:9px 14px;border-radius:11px;border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-ink-2)'};font-weight:700;font-size:13px;cursor:pointer;`)}>{m}</span>
              );
            })}
          </div>
        </div>

        <div style={css(cardStyle)}>
          <div style={css('display:flex;justify-content:space-between;font-size:13.5px;color:var(--ag-muted);')}><span>Subtotal</span><span style={css('font-weight:700;color:var(--ag-ink);')}>{fmt(subtotal)}</span></div>
          {discountVal > 0 && <div style={css('display:flex;justify-content:space-between;font-size:13.5px;color:var(--ag-good);margin-top:4px;')}><span>Discount</span><span>-{fmt(discountVal)}</span></div>}
          <div style={css('display:flex;justify-content:space-between;margin-top:8px;font-weight:800;font-size:17px;')}><span>Total</span><span style={css('color:var(--ag-crimson);')}>{fmt(total)}</span></div>
        </div>

        <button onClick={generateBill} disabled={creating} style={css(`width:100%;height:54px;border:none;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:${creating ? 'default' : 'pointer'};opacity:${creating ? 0.7 : 1};box-shadow:0 14px 30px -14px rgba(214,51,108,.8);`)}>
          {creating ? 'Generating…' : 'Generate Bill'}
        </button>
      </div>
    </div>
  );
}
