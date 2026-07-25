import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { TONES, fmt } from '@/data/demo';
import { POLICY_TERMS } from '@/data/company';
import { useAsync } from '@/hooks/useAsync';
import { fetchOrder, updateOrderStatus, markCashCollected } from '@/data/orders';
import type { OrderStatus } from '@/data/types';
import { toOrderView } from '@/lib/orderView';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { buildWhatsAppLink, buildBillShareCaption } from '@/lib/whatsapp';
import { shareOrDownloadBillImage, openPendingWhatsAppTab } from '@/lib/billImage';
import { BillReceipt } from '@/components/seller/BillReceipt';

export function OrderDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { showToast } = useShop();

  const { boutique } = useMyBoutique();
  const orderId = decodeURIComponent(id ?? '');
  const { data: row, loading, reload } = useAsync(() => (orderId ? fetchOrder(orderId) : Promise.resolve(null)), [orderId]);
  const [sharing, setSharing] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);

  if (!row) {
    return (
      <div style={css('min-height:60vh;display:flex;align-items:center;justify-content:center;color:#8A7078;font-size:15px;')}>
        {loading ? 'Loading order…' : 'Order not found.'}
      </div>
    );
  }

  const o = toOrderView(row);
  const subtotal = o.amount;

  const setStatus = async (status: OrderStatus, msg: string) => {
    try {
      await updateOrderStatus(o.id, status);
      showToast(msg);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Update failed');
    }
  };

  /**
   * Confirm the cash arrived. Kept separate from "Delivered" on purpose: an
   * order can be handed over and the money still not counted, and recording
   * payment that never happened is what corrupts the payout report.
   */
  const collectCash = async () => {
    try {
      await markCashCollected(o.id);
      showToast(`${fmt(o.collectAmount)} recorded as collected`);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not record the payment');
    }
  };

  const settled = o.isCod && o.paymentStatus === 'paid';
  const closed = o.rawStatus === 'rejected' || o.rawStatus === 'cancelled';

  const shareBillImage = async () => {
    if (!o.phone) {
      showToast('No phone number on this order');
      return;
    }
    if (!receiptRef.current) return;
    // Must open synchronously, still inside this click's user gesture — the
    // bill render below is async, and a window.open() issued after an await
    // gets silently blocked by the browser's popup blocker on most desktop
    // browsers, which is why this button could look like it does nothing.
    const pendingTab = openPendingWhatsAppTab();
    setSharing(true);
    try {
      const caption = buildBillShareCaption({
        boutiqueName: boutique?.name ?? 'Agilam Boutique',
        boutiqueSlug: boutique?.slug,
        buyerName: o.customer,
        billNumber: o.number,
        total: o.grandTotal,
      });
      const result = await shareOrDownloadBillImage(receiptRef.current, `Bill-${o.number.replace('#', '')}.png`, caption);
      if (result === 'downloaded') {
        showToast('Bill image saved — attach it in the WhatsApp chat that just opened');
        if (pendingTab) pendingTab.location.href = buildWhatsAppLink(o.phone, caption);
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

  return (
    <div style={css('min-height:100%;background:#FBF6F2;display:flex;flex-direction:column;')}>
      <div style={css('padding:6px 20px 12px;display:flex;align-items:center;gap:10px;')}>
        <button onClick={() => navigate('/seller/orders')} style={css('width:42px;height:42px;border-radius:12px;border:none;background:#fff;box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:#B02454;")}>arrow_back</span>
        </button>
        <div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;line-height:1;")}>Order {o.number}</div>
          <div style={css('font-size:12px;color:#8A7078;')}>Placed {o.date} · {o.status}</div>
        </div>
      </div>

      <div style={css('flex:1;padding:4px 20px 0;')}>
        <div style={css('background:#fff;border-radius:16px;padding:14px;box-shadow:0 10px 26px -22px rgba(107,20,54,.6);')}>
          <div style={css('font-size:12px;font-weight:800;color:#8A7078;letter-spacing:.05em;')}>CUSTOMER</div>
          <div style={css('display:flex;align-items:center;gap:11px;margin-top:8px;')}>
            <div style={css("width:44px;height:44px;border-radius:13px;background:#F4D6E2;display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;color:rgba(42,26,32,.5);")}>{o.customer[0]}</div>
            <div style={css('flex:1;')}>
              <div style={css('font-weight:800;font-size:14px;')}>{o.customer}</div>
              <div style={css('font-size:12px;color:#8A7078;display:flex;align-items:center;gap:5px;flex-wrap:wrap;')}>
                <span>{o.city || 'Customer'}</span>
                {o.phone && (
                  <>
                    <span>·</span>
                    <a
                      href={buildWhatsAppLink(o.phone, '')}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={css('display:inline-flex;align-items:center;gap:3px;color:#2FA36B;font-weight:700;text-decoration:none;')}
                    >
                      {o.phone}
                      <span style={css("font-family:'Material Symbols Outlined';font-size:14px;")}>open_in_new</span>
                    </a>
                  </>
                )}
              </div>
            </div>
            <button onClick={() => navigate('/seller/messages')} style={css('width:38px;height:38px;border-radius:11px;border:none;background:#FCE0EC;cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
              <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;")}>chat</span>
            </button>
          </div>
          {/* The delivery address lives on the order (guest checkout keeps no
              account), so this card is the only place the seller can read it. */}
          {(o.address || o.city || o.pincode) && (
            <div style={css('margin-top:12px;padding:11px 12px;border-radius:12px;background:#FBF6F2;display:flex;gap:9px;align-items:flex-start;')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:18px;color:#B02454;")}>home_pin</span>
              <div style={css('flex:1;min-width:0;')}>
                <div style={css('font-size:11px;font-weight:800;color:#8A7078;letter-spacing:.05em;')}>DELIVER TO</div>
                <div style={css('font-size:13px;color:#2A1A20;margin-top:3px;line-height:1.45;')}>
                  {[o.address, o.city, o.pincode ? `PIN ${o.pincode}` : null].filter(Boolean).join(', ')}
                </div>
              </div>
            </div>
          )}

          <button onClick={shareBillImage} disabled={sharing} style={css(`width:100%;margin-top:12px;height:44px;border:none;border-radius:13px;background:linear-gradient(135deg,#2FA36B,#1E8A57);color:#fff;font-weight:800;font-size:13.5px;cursor:${sharing ? 'default' : 'pointer'};opacity:${sharing ? 0.7 : 1};display:flex;align-items:center;justify-content:center;gap:7px;`)}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>share</span>{sharing ? 'Preparing…' : 'Share bill via WhatsApp'}
          </button>
        </div>

        {/* Hidden premium bill card, captured to an image on demand — never shown
            to the seller directly. Kept within normal viewport coordinates
            (opacity 0, not translated far off-screen) because html2canvas can
            fail to capture elements positioned way outside the viewport. */}
        <div style={css('position:absolute;top:0;left:0;opacity:0;pointer-events:none;z-index:-1;')} aria-hidden="true">
          <BillReceipt
            ref={receiptRef}
            boutiqueName={boutique?.name ?? 'Agilam Boutique'}
            boutiquePhone={boutique?.phone}
            billNumber={o.number}
            date={o.date}
            buyerName={o.customer}
            buyerPhone={o.phone ?? undefined}
            items={o.items.map((it) => ({ title: it.title, qty: it.qty, price: Number(it.price) }))}
            shippingFee={o.shippingFee}
            codFee={o.codFee}
            total={o.grandTotal}
            paymentMethod={o.paymentMethod}
            amountDue={o.collectAmount}
          />
        </div>

        <div style={css('background:#fff;border-radius:16px;padding:14px;margin-top:12px;box-shadow:0 10px 26px -22px rgba(107,20,54,.6);')}>
          <div style={css('font-size:12px;font-weight:800;color:#8A7078;letter-spacing:.05em;')}>ITEM</div>
          <div style={css('display:flex;gap:11px;align-items:center;margin-top:8px;')}>
            <div style={css(`width:56px;height:56px;flex:none;border-radius:13px;background:${TONES[o.tone]};position:relative;overflow:hidden;`)}>
              <div style={css('position:absolute;inset:0;background:repeating-linear-gradient(135deg,rgba(255,255,255,.3) 0 1px,transparent 1px 12px);')} />
            </div>
            <div style={css('flex:1;')}>
              <div style={css('font-weight:700;font-size:13.5px;')}>{o.item}</div>
              <div style={css('font-size:12px;color:#8A7078;')}>Size {o.size ?? 'Free'} · {o.color ?? '—'} · Qty {o.qty}</div>
            </div>
            <div style={css('font-weight:800;color:#B02454;')}>{fmt(o.amount)}</div>
          </div>
          <div style={css('border-top:1px solid #F5E4EC;margin-top:12px;padding-top:10px;display:flex;justify-content:space-between;font-size:13px;color:#8A7078;')}>
            <span>Subtotal</span><span style={css('font-weight:700;color:#2A1A20;')}>{fmt(subtotal)}</span>
          </div>
          <div style={css('display:flex;justify-content:space-between;font-size:13px;color:#8A7078;margin-top:4px;')}>
            <span>Delivery</span>
            <span style={css(`font-weight:700;color:${o.shippingFee === 0 ? '#2FA36B' : '#2A1A20'};`)}>
              {o.shippingFee === 0 ? 'Free' : fmt(o.shippingFee)}
            </span>
          </div>
          {o.codFee > 0 && (
            <div style={css('display:flex;justify-content:space-between;font-size:13px;color:#8A7078;margin-top:4px;')}>
              <span>Cash handling fee</span><span style={css('font-weight:700;color:#2A1A20;')}>{fmt(o.codFee)}</span>
            </div>
          )}
          <div style={css('display:flex;justify-content:space-between;margin-top:8px;font-weight:800;font-size:15px;')}>
            <span>Total</span><span style={css('color:#B02454;')}>{fmt(o.grandTotal)}</span>
          </div>
          {/* Prepaid vs cash-on-delivery changes what the seller does at the
              door, so it's stated next to the amount rather than buried. */}
          {o.paymentMethod && (
            <div style={css('display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid #F5E4EC;font-size:13px;')}>
              <span style={css('color:#8A7078;')}>Payment · {o.paymentMethod}</span>
              <span style={css(`font-weight:800;padding:3px 10px;border-radius:8px;background:${o.isCod ? (settled ? '#E5F3EC' : '#FBF0DA') : '#E5F3EC'};color:${o.isCod ? (settled ? '#2FA36B' : '#B0862B') : '#2FA36B'};`)}>
                {!o.isCod ? 'Paid online' : settled ? 'Cash collected' : 'Collect on delivery'}
              </span>
            </div>
          )}
        </div>

        {/* The cash instruction, stated once and unmissably. A seller reading
            this on a doorstep needs the figure, not a status chip. */}
        {o.isCod && !closed && (
          <div style={css(`margin-top:12px;border-radius:16px;padding:16px;border:1.5px solid ${settled ? '#CFE6D9' : '#F0DCB4'};background:${settled ? '#F3F9F5' : '#FFF8E8'};`)}>
            <div style={css('display:flex;align-items:center;gap:11px;')}>
              <span style={css(`width:42px;height:42px;flex:none;border-radius:13px;background:#fff;display:flex;align-items:center;justify-content:center;`)}>
                <span style={css(`font-family:'Material Symbols Outlined';font-size:23px;color:${settled ? '#2FA36B' : '#C99A3F'};`)}>{settled ? 'task_alt' : 'payments'}</span>
              </span>
              <div style={css('flex:1;min-width:0;')}>
                <div style={css(`font-size:11.5px;font-weight:800;letter-spacing:.05em;color:${settled ? '#2C6249' : '#B0862B'};`)}>
                  {settled ? 'CASH COLLECTED' : 'COLLECT ON DELIVERY'}
                </div>
                <div style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:27px;line-height:1.1;margin-top:2px;color:${settled ? '#2C6249' : '#7A5C2A'};`)}>
                  {fmt(o.grandTotal)}
                </div>
              </div>
            </div>
            {!settled && (
              <>
                <div style={css('font-size:12.5px;color:#7A5C2A;font-weight:600;line-height:1.55;margin-top:10px;')}>
                  Take the full amount in cash when you hand the order over, then tap below. Agilam’s {POLICY_TERMS.commissionPct}% commission on this order is added to what you owe and settled against your next online payout.
                </div>
                <button
                  onClick={collectCash}
                  style={css('width:100%;margin-top:12px;height:46px;border:none;border-radius:13px;background:linear-gradient(135deg,#2FA36B,#1E8A57);color:#fff;font-weight:800;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;font-family:inherit;')}
                >
                  <span style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>check_circle</span>
                  I collected {fmt(o.grandTotal)}
                </button>
              </>
            )}
          </div>
        )}

        {o.rawStatus === 'cancelled' && (
          <div style={css('margin-top:12px;border-radius:16px;padding:14px 16px;border:1px solid #E8D5DE;background:#F7F1F4;display:flex;gap:11px;')}>
            <span style={css("font-family:'Material Symbols Outlined';color:#8A7078;")}>cancel</span>
            <div style={css('font-size:13px;color:#6B5560;font-weight:600;line-height:1.55;')}>
              The customer cancelled this order before dispatch{o.cancelReason ? ` — “${o.cancelReason}”` : ''}. The stock has been returned to your catalogue.
            </div>
          </div>
        )}
      </div>

      {/* A rejected or cancelled order has no next step, so the action bar goes
          away rather than offering moves that would resurrect it. */}
      {!closed && (
        <div style={css('position:sticky;bottom:0;background:#FBF6F2;padding:12px 20px 16px;display:flex;gap:10px;')}>
          <button onClick={() => setStatus('rejected', 'Order rejected')} style={css('flex:1;height:52px;border:1.5px solid #E7A7B4;background:#fff;color:#D6455A;border-radius:14px;font-weight:800;cursor:pointer;font-family:inherit;')}>Reject</button>
          {o.rawStatus === 'pending' ? (
            <button onClick={() => setStatus('accepted', 'Order accepted')} style={css('flex:1.4;height:52px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;cursor:pointer;font-family:inherit;')}>Accept order</button>
          ) : (
            <>
              <button onClick={() => setStatus('delivered', 'Marked delivered')} style={css('flex:1;height:52px;border:1.5px solid #D6336C;background:#fff;color:#B02454;border-radius:14px;font-weight:800;cursor:pointer;font-family:inherit;')}>Delivered</button>
              <button onClick={() => setStatus('shipped', 'Marked as shipped')} style={css('flex:1.4;height:52px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;cursor:pointer;font-family:inherit;')}>Mark Shipped</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
