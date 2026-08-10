import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { TONES, fmt } from '@/data/demo';
import { POLICY_TERMS } from '@/data/company';
import { useAsync } from '@/hooks/useAsync';
import { fetchOrder, updateOrderStatus, markCashCollected, markOrderPacked } from '@/data/orders';
import type { OrderStatus } from '@/data/types';
import { toOrderView } from '@/lib/orderView';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { buildWhatsAppLink, buildBillShareCaption } from '@/lib/whatsapp';
import { shareOrDownloadBillImage, openPendingWhatsAppTab } from '@/lib/billImage';
import { BillReceipt } from '@/components/seller/BillReceipt';
import { ShipSheet } from '@/components/seller/ShipSheet';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { createShipment, fetchCouriers, fetchShipment } from '@/data/shipments';
import { Skeleton, SkeletonGroup, SkeletonRows } from '@/components/ui/Skeleton';

export function OrderDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { showToast } = useShop();

  const { boutique } = useMyBoutique();
  const orderId = decodeURIComponent(id ?? '');
  const { data: row, loading, reload } = useAsync(() => (orderId ? fetchOrder(orderId) : Promise.resolve(null)), [orderId]);
  const [sharing, setSharing] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [shipOpen, setShipOpen] = useState(false);
  const [shipping, setShipping] = useState(false);
  const receiptRef = useRef<HTMLDivElement>(null);

  // Both read separately from the order (see src/data/shipments.ts): an
  // un-migrated deploy must degrade to "no tracking", never to a dead screen.
  const { data: couriers } = useAsync(() => fetchCouriers().catch(() => []), []);
  const { data: shipment, reload: reloadShipment } = useAsync(
    () => (orderId ? fetchShipment(orderId) : Promise.resolve(null)),
    [orderId],
  );

  if (!row && loading) {
    return (
      <SkeletonGroup label="Loading order…" style="padding:16px 20px;">
        <Skeleton w="52%" h={26} radius={9} />
        <Skeleton w="34%" h={12} style="margin-top:12px;" />
        <div style={css('margin-top:20px;')}><SkeletonRows rows={3} height={72} /></div>
        <Skeleton w="100%" h={120} radius={18} style="margin-top:16px;" />
      </SkeletonGroup>
    );
  }

  if (!row) {
    return (
      <div style={css('min-height:60vh;display:flex;align-items:center;justify-content:center;color:var(--ag-muted);font-size:15px;')}>
        Order not found.
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
   * Record the parcel, then move the order to 'shipped'.
   *
   * Order matters: migration 0063's trigger refuses the transition until a
   * shipment row exists, so the write has to land first. If the status update
   * then fails the shipment row is left behind — harmless, and the seller simply
   * ships again (the unique constraint on order_id means the retry updates
   * nothing rather than duplicating).
   */
  const shipOrder = async (v: { courierId: string | null; courierName: string; awb: string; trackingUrl: string | null }) => {
    if (!row) return;
    setShipping(true);
    try {
      await createShipment({
        orderId: o.id,
        boutiqueId: row.boutique_id,
        courierId: v.courierId,
        courierName: v.courierName,
        awb: v.awb,
        trackingUrl: v.trackingUrl,
      });
      await updateOrderStatus(o.id, 'shipped');
      setShipOpen(false);
      showToast(`Shipped via ${v.courierName}`);
      reloadShipment();
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not ship this order');
    } finally {
      setShipping(false);
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
        boutiqueName: boutique?.name ?? 'MangaiMart Boutique',
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
    <div style={css('min-height:100%;background:var(--ag-bg);display:flex;flex-direction:column;')}>
      <div style={css('padding:6px 20px 12px;display:flex;align-items:center;gap:10px;')}>
        <button onClick={() => navigate('/seller/orders')} aria-label="Go back" style={css('width:42px;height:42px;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
        </button>
        <div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;line-height:1;")}>Order {o.number}</div>
          <div style={css('font-size:12px;color:var(--ag-muted);')}>Placed {o.date} · {o.status}</div>
        </div>
      </div>

      <div style={css('flex:1;padding:4px 20px 0;')}>
        <div style={css('background:var(--ag-surface);border-radius:16px;padding:14px;box-shadow:0 10px 26px -22px rgba(107,20,54,.6);')}>
          <div style={css('font-size:12px;font-weight:800;color:var(--ag-muted);letter-spacing:.05em;')}>CUSTOMER</div>
          <div style={css('display:flex;align-items:center;gap:11px;margin-top:8px;')}>
            <div style={css("width:44px;height:44px;border-radius:13px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;color:rgba(42,26,32,.5);")}>{o.customer[0]}</div>
            <div style={css('flex:1;')}>
              <div style={css('font-weight:800;font-size:14px;')}>{o.customer}</div>
              <div style={css('font-size:12px;color:var(--ag-muted);display:flex;align-items:center;gap:5px;flex-wrap:wrap;')}>
                <span>{o.city || 'Customer'}</span>
                {o.phone && (
                  <>
                    <span>·</span>
                    <a
                      href={buildWhatsAppLink(o.phone, '')}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      style={css('display:inline-flex;align-items:center;gap:3px;color:var(--ag-good);font-weight:700;text-decoration:none;')}
                    >
                      {o.phone}
                      <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:14px;")}>open_in_new</span>
                    </a>
                  </>
                )}
              </div>
            </div>
            <button onClick={() => navigate('/seller/messages')} style={css('width:38px;height:38px;border-radius:11px;border:none;background:var(--ag-surface-2);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;")}>chat</span>
            </button>
          </div>
          {/* The delivery address lives on the order (guest checkout keeps no
              account), so this card is the only place the seller can read it. */}
          {(o.address || o.city || o.pincode) && (
            <div style={css('margin-top:12px;padding:11px 12px;border-radius:12px;background:var(--ag-bg);display:flex;gap:9px;align-items:flex-start;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;color:var(--ag-crimson);")}>home_pin</span>
              <div style={css('flex:1;min-width:0;')}>
                <div style={css('font-size:11px;font-weight:800;color:var(--ag-muted);letter-spacing:.05em;')}>DELIVER TO</div>
                <div style={css('font-size:13px;color:var(--ag-ink);margin-top:3px;line-height:1.45;')}>
                  {[o.address, o.city, o.pincode ? `PIN ${o.pincode}` : null].filter(Boolean).join(', ')}
                </div>
              </div>
            </div>
          )}

          <button onClick={shareBillImage} disabled={sharing} style={css(`width:100%;margin-top:12px;height:44px;border:none;border-radius:13px;background:linear-gradient(135deg,var(--ag-good),#1E8A57);color:#fff;font-weight:800;font-size:13.5px;cursor:${sharing ? 'default' : 'pointer'};opacity:${sharing ? 0.7 : 1};display:flex;align-items:center;justify-content:center;gap:7px;`)}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>share</span>{sharing ? 'Preparing…' : 'Share bill via WhatsApp'}
          </button>
        </div>

        {/* Hidden premium bill card, captured to an image on demand — never shown
            to the seller directly. Kept within normal viewport coordinates
            (opacity 0, not translated far off-screen) because html2canvas can
            fail to capture elements positioned way outside the viewport. */}
        <div style={css('position:absolute;top:0;left:0;opacity:0;pointer-events:none;z-index:-1;')} aria-hidden="true">
          <BillReceipt
            ref={receiptRef}
            boutiqueName={boutique?.name ?? 'MangaiMart Boutique'}
            boutiquePhone={boutique?.phone}
            billNumber={o.number}
            date={o.date}
            buyerName={o.customer}
            buyerPhone={o.phone ?? undefined}
            items={o.items.map((it) => ({ title: it.title, qty: it.qty, price: Number(it.price) }))}
            discount={o.platformDiscount}
            shippingFee={o.shippingFee}
            codFee={o.codFee}
            total={o.grandTotal}
            paymentMethod={o.paymentMethod}
            amountDue={o.collectAmount}
          />
        </div>

        <div style={css('background:var(--ag-surface);border-radius:16px;padding:14px;margin-top:12px;box-shadow:0 10px 26px -22px rgba(107,20,54,.6);')}>
          <div style={css('font-size:12px;font-weight:800;color:var(--ag-muted);letter-spacing:.05em;')}>
            {o.items.length > 1 ? `ITEMS · ${o.items.length}` : 'ITEM'}
          </div>
          {/* Every line, not just the first: a seller packing a multi-item order
              has to see all of it, and tapping a line opens that product so the
              stock and photo are one tap away from the order being packed. */}
          {o.items.map((it) => {
            const open = it.product_id ? () => navigate(`/seller/products/${it.product_id}`) : undefined;
            return (
              <div
                key={it.id}
                onClick={open}
                style={css(`display:flex;gap:11px;align-items:center;margin-top:10px;cursor:${open ? 'pointer' : 'default'};`)}
              >
                <ImageSlot
                  src={it.product?.image_url ?? undefined}
                  placeholder={it.title}
                  alt={it.title}
                  style={css(`width:56px;height:56px;flex:none;border-radius:13px;background:${TONES[(it.product?.tone ?? o.tone) % 8]};`)}
                />
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('font-weight:700;font-size:13.5px;')}>{it.title}</div>
                  <div style={css('font-size:12px;color:var(--ag-muted);')}>Size {it.size ?? 'Free'} · {it.color ?? '—'} · Qty {it.qty}</div>
                </div>
                <div style={css('display:flex;align-items:center;gap:2px;')}>
                  <span style={css('font-weight:800;color:var(--ag-crimson);')}>{fmt(Number(it.price) * it.qty)}</span>
                  {open && <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;color:var(--ag-muted-soft);")}>chevron_right</span>}
                </div>
              </div>
            );
          })}
          {o.items.length === 0 && (
            <div style={css('margin-top:8px;font-size:13px;color:var(--ag-muted);')}>No item lines recorded on this order.</div>
          )}
          <div style={css('border-top:1px solid var(--ag-border-soft);margin-top:12px;padding-top:10px;display:flex;justify-content:space-between;font-size:13px;color:var(--ag-muted);')}>
            <span>Subtotal</span><span style={css('font-weight:700;color:var(--ag-ink);')}>{fmt(subtotal)}</span>
          </div>
          {/* A MangaiMart coupon is funded by us, not the boutique: the seller
              is still paid on the full subtotal above, but the customer hands
              over this much less — so it has to be on the bill they both read. */}
          {o.platformDiscount > 0 && (
            <div style={css('display:flex;justify-content:space-between;font-size:13px;color:var(--ag-muted);margin-top:4px;')}>
              <span>MangaiMart offer</span>
              <span style={css('font-weight:700;color:var(--ag-good);')}>− {fmt(o.platformDiscount)}</span>
            </div>
          )}
          <div style={css('display:flex;justify-content:space-between;font-size:13px;color:var(--ag-muted);margin-top:4px;')}>
            <span>Delivery</span>
            <span style={css(`font-weight:700;color:${o.shippingFee === 0 ? 'var(--ag-good)' : 'var(--ag-ink)'};`)}>
              {o.shippingFee === 0 ? 'Free' : fmt(o.shippingFee)}
            </span>
          </div>
          {o.codFee > 0 && (
            <div style={css('display:flex;justify-content:space-between;font-size:13px;color:var(--ag-muted);margin-top:4px;')}>
              <span>Cash handling fee</span><span style={css('font-weight:700;color:var(--ag-ink);')}>{fmt(o.codFee)}</span>
            </div>
          )}
          <div style={css('display:flex;justify-content:space-between;margin-top:8px;font-weight:800;font-size:15px;')}>
            <span>Total</span><span style={css('color:var(--ag-crimson);')}>{fmt(o.grandTotal)}</span>
          </div>
          {/* Prepaid vs cash-on-delivery changes what the seller does at the
              door, so it's stated next to the amount rather than buried. */}
          {o.paymentMethod && (
            <div style={css('display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid var(--ag-border-soft);font-size:13px;')}>
              <span style={css('color:var(--ag-muted);')}>Payment · {o.paymentMethod}</span>
              {/* A cancelled/rejected COD order is neither collected nor still
                  collectable — it must not read "Collect on delivery". */}
              <span style={css(`font-weight:800;padding:3px 10px;border-radius:8px;background:${!o.isCod || settled ? 'var(--ag-good-bg)' : closed ? 'var(--ag-surface-2)' : 'var(--ag-warn-bg)'};color:${!o.isCod || settled ? 'var(--ag-good)' : closed ? 'var(--ag-muted)' : 'var(--ag-warn-text)'};`)}>
                {!o.isCod ? 'Paid online' : settled ? 'Cash collected' : closed ? 'Not collected' : 'Collect on delivery'}
              </span>
            </div>
          )}
        </div>

        {/* The cash instruction, stated once and unmissably. A seller reading
            this on a doorstep needs the figure, not a status chip. */}
        {o.isCod && !closed && (
          <div style={css(`margin-top:12px;border-radius:16px;padding:16px;border:1.5px solid ${settled ? '#CFE6D9' : 'var(--ag-gold-border)'};background:${settled ? '#F3F9F5' : 'var(--ag-gold-bg)'};`)}>
            <div style={css('display:flex;align-items:center;gap:11px;')}>
              <span style={css(`width:42px;height:42px;flex:none;border-radius:13px;background:var(--ag-surface);display:flex;align-items:center;justify-content:center;`)}>
                <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:23px;color:${settled ? 'var(--ag-good)' : 'var(--ag-gold-text)'};`)}>{settled ? 'task_alt' : 'payments'}</span>
              </span>
              <div style={css('flex:1;min-width:0;')}>
                <div style={css(`font-size:11.5px;font-weight:800;letter-spacing:.05em;color:${settled ? '#2C6249' : '#B0862B'};`)}>
                  {settled ? 'CASH COLLECTED' : 'COLLECT ON DELIVERY'}
                </div>
                <div style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:27px;line-height:1.1;margin-top:2px;color:${settled ? '#2C6249' : 'var(--ag-gold-text)'};`)}>
                  {fmt(o.grandTotal)}
                </div>
              </div>
            </div>
            {!settled && (
              <>
                <div style={css('font-size:12.5px;color:var(--ag-gold-text);font-weight:600;line-height:1.55;margin-top:10px;')}>
                  Take this exact amount in cash when you hand the order over, then tap below. MangaiMart’s {POLICY_TERMS.commissionPct}% commission on this order is added to what you owe and settled against your next online payout.
                  {o.platformDiscount > 0 && ` The customer used a MangaiMart offer, so collect ${fmt(o.platformDiscount)} less — we add it back to your payout.`}
                </div>
                <button
                  onClick={collectCash}
                  style={css('width:100%;margin-top:12px;height:46px;border:none;border-radius:13px;background:linear-gradient(135deg,var(--ag-good),#1E8A57);color:#fff;font-weight:800;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;font-family:inherit;')}
                >
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>check_circle</span>
                  I collected {fmt(o.grandTotal)}
                </button>
              </>
            )}
          </div>
        )}

        {/* Once dispatched, the docket is the thing the seller gets asked about
            on the phone — so it sits on the order, copyable, not buried. */}
        {shipment && (
          <div style={css('background:var(--ag-surface);border-radius:16px;padding:14px;margin-top:12px;box-shadow:0 10px 26px -22px rgba(107,20,54,.6);')}>
            <div style={css('font-size:12px;font-weight:800;color:var(--ag-muted);letter-spacing:.05em;')}>SHIPMENT</div>
            <div style={css('display:flex;align-items:center;gap:11px;margin-top:10px;')}>
              <span style={css('width:42px;height:42px;flex:none;border-radius:13px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>local_shipping</span>
              </span>
              <div style={css('flex:1;min-width:0;')}>
                <div style={css('font-weight:800;font-size:14px;')}>{shipment.courier_name}</div>
                <div style={css('font-size:12.5px;color:var(--ag-muted);word-break:break-all;')}>{shipment.awb}</div>
              </div>
              <button
                onClick={() => { void navigator.clipboard?.writeText(shipment.awb); showToast('Tracking number copied'); }}
                aria-label="Copy tracking number"
                style={css('width:38px;height:38px;flex:none;border-radius:11px;border:none;background:var(--ag-surface-2);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
              >
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;color:var(--ag-crimson);")}>content_copy</span>
              </button>
            </div>
            {shipment.tracking_url && (
              <a
                href={shipment.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                style={css('display:flex;align-items:center;justify-content:center;gap:7px;width:100%;margin-top:12px;height:44px;border-radius:13px;background:var(--ag-surface-2);color:var(--ag-crimson);font-weight:800;font-size:13.5px;text-decoration:none;')}
              >
                Track shipment
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>open_in_new</span>
              </a>
            )}
          </div>
        )}

        {o.rawStatus === 'cancelled' && (
          <div style={css('margin-top:12px;border-radius:16px;padding:14px 16px;border:1px solid var(--ag-border);background:var(--ag-surface-2);display:flex;gap:11px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted);")}>cancel</span>
            <div style={css('font-size:13px;color:var(--ag-label);font-weight:600;line-height:1.55;')}>
              The customer cancelled this order before dispatch{o.cancelReason ? ` — “${o.cancelReason}”` : ''}. The stock has been returned to your catalogue.
            </div>
          </div>
        )}
      </div>

      {/* Fulfilment moves one step at a time: pending → accepted → shipped →
          delivered. The bar only ever offers the next real step, so a seller
          can't mark an order delivered before it shipped, and Reject disappears
          the moment the parcel is on its way — you can't reject after dispatch,
          let alone after delivery. Terminal states (delivered / rejected /
          cancelled) have no further move, so the bar goes away entirely. */}
      {(() => {
        // Reject is only honest while the order is still in the seller's hands.
        const canReject = o.rawStatus === 'pending' || o.rawStatus === 'accepted';
        const forward =
          o.rawStatus === 'pending'
            ? { status: 'accepted' as const, label: 'Accept order', msg: 'Order accepted' }
            : o.rawStatus === 'accepted'
              ? { status: 'shipped' as const, label: 'Mark shipped', msg: 'Marked as shipped' }
              : o.rawStatus === 'shipped'
                ? { status: 'delivered' as const, label: 'Mark delivered', msg: 'Marked delivered' }
                : null;

        if (!forward && !canReject) return null;

        return (
          <div style={css('position:sticky;bottom:0;background:var(--ag-bg);padding:12px 20px 16px;')}>
            {/* Packing isn't a lifecycle status — it sits between accepted and
                shipped without changing either. It's here so the buyer's
                "Packed" step finally shows a real time instead of a blank. */}
            {o.rawStatus === 'accepted' && !row.packed_at && !confirmReject && (
              <button
                onClick={async () => {
                  try {
                    await markOrderPacked(o.id);
                    showToast('Marked as packed');
                    reload();
                  } catch (e) {
                    showToast(e instanceof Error ? e.message : 'Could not update this order');
                  }
                }}
                style={css('width:100%;height:42px;margin-bottom:10px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:12px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:7px;')}
              >
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>inventory_2</span>
                Mark packed
              </button>
            )}
            {confirmReject ? (
              <div style={css('background:var(--ag-bad-bg);border:1px solid var(--ag-border);border-radius:14px;padding:13px 15px;')}>
                <div style={css('font-size:13px;font-weight:700;color:#8A2A34;line-height:1.5;')}>
                  Reject this order? This can’t be undone{o.isCod ? '' : ' and any online payment is refunded'}. The stock returns to your catalogue.
                </div>
                <div style={css('display:flex;gap:10px;margin-top:11px;')}>
                  <button onClick={() => setConfirmReject(false)} style={css('flex:1;height:48px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);border-radius:12px;font-weight:800;cursor:pointer;font-family:inherit;')}>Keep order</button>
                  <button onClick={() => { setConfirmReject(false); setStatus('rejected', 'Order rejected'); }} style={css('flex:1;height:48px;border:none;background:var(--ag-danger-text);color:#fff;border-radius:12px;font-weight:800;cursor:pointer;font-family:inherit;')}>Reject order</button>
                </div>
              </div>
            ) : (
              <div style={css('display:flex;gap:10px;')}>
                {canReject && (
                  <button onClick={() => setConfirmReject(true)} style={css('flex:1;height:52px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-danger-text);border-radius:14px;font-weight:800;cursor:pointer;font-family:inherit;')}>Reject</button>
                )}
                {forward && (
                  <button
                    onClick={() => {
                      // Shipping is the one step that needs data first — the
                      // sheet collects it and does the transition itself.
                      if (forward.status === 'shipped') setShipOpen(true);
                      else setStatus(forward.status, forward.msg);
                    }}
                    style={css('flex:1.4;height:52px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;cursor:pointer;font-family:inherit;')}
                  >
                    {forward.label}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {shipOpen && (
        <ShipSheet
          couriers={couriers ?? []}
          busy={shipping}
          onCancel={() => setShipOpen(false)}
          onConfirm={shipOrder}
        />
      )}
    </div>
  );
}
