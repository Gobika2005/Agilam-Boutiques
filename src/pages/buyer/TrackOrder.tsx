import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { useAsync } from '@/hooks/useAsync';
import { fetchShipment, fetchShipmentEvents, reportDeliveryIssue } from '@/data/shipments';
import { useBuyerOrders } from '@/hooks/useBuyerOrders';
import { TONES, TRACK_STAGES, fmt } from '@/data/demo';
import { deliveryEstimate, formatOrderDateTime, isFailedShipment, trackStage } from '@/lib/orderHistory';
import { useOrderFeedback } from '@/hooks/useOrderFeedback';
import { OrderFeedbackSheet } from '@/components/buyer/OrderFeedbackSheet';
import { ReturnRequestSheet } from '@/components/buyer/ReturnRequestSheet';
import { fetchReturnForOrder, RETURN_REASON_LABEL, RETURN_STATUS_LABEL } from '@/data/returns';
import { fetchReceiptExtras } from '@/data/orders';
import { printReceipt } from '@/lib/printReceipt';
import { COMPANY, CONTACT_LINKS } from '@/data/company';

/**
 * One screen for an order: what was in it, what it cost, where it's going, and
 * how far along it is. Reads through `useBuyerOrders`, so a status the boutique
 * changes lands here live rather than at the next reload.
 */
export function TrackOrder() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { productById } = useCatalog();
  const { guest, showToast } = useShop();
  const { orders, refresh, refreshing } = useBuyerOrders();

  const decoded = id ? decodeURIComponent(id) : undefined;
  // Three handles resolve to the same order: the display id (`#AGL-…`, what the
  // orders list links with), the bare order number, and the DB row uuid — which
  // is what an order notification carries, so tapping one has to land here too.
  const order = useMemo(
    () => orders.find((o) => o.id === decoded || o.orderNumber === decoded || o.rowId === decoded),
    [orders, decoded],
  );

  // Keyed on the DB row id, which only a signed-in buyer's order carries: a
  // guest's order is mirrored in memory and unreadable through RLS, so they see
  // no tracking here at all. That gap is the public lookup in §6 of the plan.
  const { data: shipment } = useAsync(
    () => (order?.rowId ? fetchShipment(order.rowId) : Promise.resolve(null)),
    [order?.rowId],
  );
  // Every courier scan, newest first (migration 0067). Empty is normal — a
  // manually-shipped parcel has no scans at all, only a courier and a docket.
  const { data: scans } = useAsync(
    () => (order?.rowId ? fetchShipmentEvents(order.rowId) : Promise.resolve([])),
    [order?.rowId],
  );
  const [disputing, setDisputing] = useState(false);
  const [disputed, setDisputed] = useState(false);
  const [showAllScans, setShowAllScans] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const feedback = useOrderFeedback(orders);

  // The return on this order, if one has been raised (migration 0074).
  // `returnBump` re-reads it after the sheet submits, so the card flips from
  // "Request a return" to "Awaiting the boutique" without a reload.
  const [returnOpen, setReturnOpen] = useState(false);
  const [returnBump, setReturnBump] = useState(0);
  const { data: returnReq } = useAsync(
    () => (order?.rowId ? fetchReturnForOrder(order.rowId) : Promise.resolve(null)),
    [order?.rowId, returnBump],
  );

  if (!order) {
    return (
      <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
        <div style={css('max-width:720px;margin:0 auto;')}>
          <button onClick={() => navigate('/orders')} style={css('border:none;background:none;cursor:pointer;color:var(--ag-crimson);font-weight:800;font-size:13.5px;display:flex;align-items:center;gap:6px;padding:6px 0;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>arrow_back</span>My orders
          </button>
          <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:70px 30px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:48px;color:#CBB0BC;")}>
              {refreshing ? 'sync' : 'search_off'}
            </span>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;margin-top:14px;")}>
              {refreshing ? 'Loading your order…' : 'Order not found'}
            </div>
            <div style={css('color:var(--ag-muted);font-size:14px;margin-top:8px;max-width:340px;line-height:1.55;')}>
              {refreshing
                ? 'One moment while we fetch it from your account.'
                : 'We couldn’t find that order on this device. If you placed it while signed out, open it from the device you ordered on — or contact support with the order number.'}
            </div>
            {!refreshing && (
              <div style={css('display:flex;gap:10px;margin-top:18px;flex-wrap:wrap;justify-content:center;')}>
                <button onClick={() => navigate('/orders')} style={css('height:46px;padding:0 18px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13.5px;cursor:pointer;')}>My orders</button>
                <a href={CONTACT_LINKS.support} style={css('display:flex;align-items:center;height:46px;padding:0 18px;border:1.5px solid var(--ag-border);border-radius:14px;background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:13.5px;')}>Contact support</a>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // The order's own status can only ever reach "Shipped" — the two steps after
  // it belong to the courier. `trackStage` lets the latest scan push the
  // timeline further, which is what stops a moving parcel sitting on "Shipped"
  // for four days with nothing to show the buyer.
  const stage = trackStage(order, shipment?.last_status);
  const rejected = order.status === 'rejected' || order.status === 'cancelled';
  const delivered = order.status === 'delivered';
  /** The parcel is going backwards — returning to the boutique, or lost. */
  const failed = isFailedShipment(shipment?.last_status) && !delivered && !rejected;
  const rto = shipment?.last_status === 'rto';
  const latestScan = (scans ?? [])[0];
  const item = order.items[0];
  const totalQty = order.items.reduce((s, it) => s + it.qty, 0);
  const itemsTotal = order.items.reduce((s, it) => s + it.price * it.qty, 0);
  const codFee = order.codFee ?? 0;
  // Recorded on the order since migration 0022. Older orders never stored it,
  // so fall back to inferring it from whatever the total exceeds the lines by.
  const delivery = order.shippingFee ?? Math.max(0, order.total - itemsTotal - codFee);
  // Cash never collected on an order placed before cash on delivery was
  // withdrawn (migration 0085). Always false on a prepaid order, i.e. on every
  // order placed since — kept so an old row is not relabelled as "Paid".
  const owes = order.paymentMethod === 'COD' && (order.paymentStatus ?? 'pending') === 'pending' && !rejected;

  /**
   * Re-open the payment receipt that was emailed at checkout.
   *
   * The shop's postal details and the payment reference aren't in the order
   * screen's data, so they're fetched here — on the tap, not on every visit.
   * A failed fetch still prints: `printReceipt` falls back to the order's own
   * figures, and a receipt missing the boutique's street address beats no
   * receipt at all when someone is trying to file an expense.
   */
  const downloadReceipt = async () => {
    if (receiptBusy) return;
    setReceiptBusy(true);
    try {
      const extras = order.rowId ? await fetchReceiptExtras(order.rowId).catch(() => null) : null;
      // Pop-ups are blocked by default in several browsers, and a button that
      // silently does nothing reads as broken — so say what happened.
      if (!printReceipt(order, extras)) showToast('Allow pop-ups to download your receipt');
    } finally {
      setReceiptBusy(false);
    }
  };

  const chatWithBoutique = () => {
    navigate(`/chat/${order.boutiqueId}`, {
      state: {
        order: {
          orderId: order.id,
          title: item?.title ?? 'Order',
          image: item ? productById(item.pid)?.image : undefined,
          tone: item?.tone ?? 0,
          qty: totalQty,
          amount: order.total,
          status: rejected ? 'Cancelled' : TRACK_STAGES[stage].label,
        },
      },
    });
  };

  // A real timestamp per step. 0042 gives accepted/shipped/delivered, 0063 gives
  // packed, and 0067's courier scans give the two in between. "In Transit" has
  // no column of its own — it IS the scan — so it reads the first movement scan
  // rather than inventing a time.
  const firstMovement = [...(scans ?? [])]
    .filter((s) => s.stage === 'in_transit' || s.stage === 'picked_up')
    .sort((a, b) => new Date(a.occurred_at ?? a.created_at).getTime() - new Date(b.occurred_at ?? b.created_at).getTime())[0];

  const stageTimes: Record<number, string | null | undefined> = {
    0: order.placedAt,
    1: order.acceptedAt,
    2: order.packedAt,
    3: order.shippedAt,
    4: firstMovement?.occurred_at ?? firstMovement?.created_at,
    5: order.outForDeliveryAt,
    6: order.deliveredAt,
  };
  /**
   * Does anything actually report on this parcel's journey?
   *
   * Only a courier feed can produce "In Transit" and "Out for Delivery". A
   * manually-shipped parcel — the seller typed a docket, nobody is streaming
   * scans — has neither, and never will. Left in, those two steps would flip to
   * "done" the moment the seller marked the order delivered, showing the buyer
   * two courier events that never happened with no time beside them. So the
   * timeline drops them entirely rather than claiming them: Placed → Confirmed
   * → Packed → Shipped → Delivered is the whole truth for a manual parcel.
   */
  const hasCourierFeed = (scans ?? []).length > 0 || !!order.outForDeliveryAt;
  const COURIER_ONLY_STEPS = [4, 5];

  const steps = TRACK_STAGES
    .map((st, i) => ({ ...st, index: i }))
    .filter((st) => hasCourierFeed || !COURIER_ONLY_STEPS.includes(st.index))
    .map((st, pos, visible) => ({
      ...st,
      done: !rejected && st.index <= stage,
      current: !rejected && st.index === stage,
      showLine: pos < visible.length - 1,
      time: st.index <= stage ? formatOrderDateTime(stageTimes[st.index]) : '',
    }));

  const card = 'background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);';
  const sectionTitle = "font-family:'Playfair Display',serif;font-weight:700;font-size:19px;";

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('max-width:720px;margin:0 auto;')}>
        <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;')}>
          <button onClick={() => navigate('/orders')} style={css('border:none;background:none;cursor:pointer;color:var(--ag-crimson);font-weight:800;font-size:13.5px;display:flex;align-items:center;gap:6px;padding:6px 0;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>arrow_back</span>My orders
          </button>
          <button
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="Refresh order status"
            style={css(`display:flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:11px;font-weight:800;font-size:12px;cursor:${refreshing ? 'wait' : 'pointer'};opacity:${refreshing ? 0.65 : 1};`)}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>{refreshing ? 'sync' : 'refresh'}</span>
            {refreshing ? 'Updating' : 'Update'}
          </button>
        </div>

        {/* ---------- Summary ---------- */}
        <div style={css('background:linear-gradient(135deg,#8E1C44,#B02454 60%,#D6336C);border-radius:24px;padding:22px;color:#fff;box-shadow:0 24px 50px -30px rgba(176,36,84,.9);position:relative;overflow:hidden;')}>
          <div style={css('position:absolute;top:-60px;right:-30px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(244,217,166,.22),transparent 70%);')} />
          <div style={css('display:flex;gap:15px;position:relative;')}>
            <div className="agx-thumb-media" style={css(`width:78px;background:${TONES[item?.tone ?? 0]};box-shadow:0 12px 26px -12px rgba(0,0,0,.4);`)}>
              <ImageSlot src={item ? productById(item.pid)?.image : undefined} placeholder={item?.title} className="agx-prod-fill" />
            </div>
            <div style={css('flex:1;min-width:0;')}>
              <div className="agx-eyebrow" style={css('font-size:9px;color:#F4D9A6;')}>{order.id}</div>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:21px;line-height:1.15;margin-top:5px;")}>
                {item?.title ?? 'Order'}{order.items.length > 1 ? ` +${order.items.length - 1} more` : ''}
              </div>
              <div style={css('opacity:.85;font-size:12.5px;margin-top:4px;')}>{order.boutique} · Qty {totalQty} · {fmt(order.total)}</div>
              <div style={css('display:inline-flex;align-items:center;gap:6px;margin-top:11px;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:6px 13px;font-size:12.5px;font-weight:800;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;color:#F4D9A6;")}>{rejected ? 'cancel' : delivered ? 'check_circle' : 'local_shipping'}</span>
                {rejected ? 'Order cancelled' : TRACK_STAGES[stage].label}
              </div>
            </div>
          </div>

          {/* The single most-asked question, answered up front. */}
          {!rejected && (
            <div style={css('position:relative;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.2);display:flex;align-items:center;gap:9px;font-size:13px;font-weight:700;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;color:#F4D9A6;")}>{delivered ? 'task_alt' : 'schedule'}</span>
              {delivered ? 'Delivered — enjoy your piece!' : `Estimated delivery ${deliveryEstimate(order.placedAt)}`}
            </div>
          )}
        </div>

        {/* ---------- Parcel going backwards (0067 RTO / failed scan) ---------- */}
        {/* Without this the timeline sat on "Shipped" while the parcel was on
            its way back to the boutique — the screen quietly telling the buyer
            something that was no longer true. */}
        {failed && (
          <div style={css('display:flex;gap:12px;margin-top:16px;padding:16px;background:var(--ag-bad-bg);border:1px solid var(--ag-border);border-radius:18px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#C0455E;font-size:22px;flex:none;")}>error</span>
            <div style={css('flex:1;min-width:0;')}>
              <div style={css('font-size:14px;font-weight:800;color:#7A4652;')}>
                {rto ? 'Your parcel is on its way back to the boutique' : 'There’s a problem with this delivery'}
              </div>
              <div style={css('font-size:12.5px;color:#7A4652;line-height:1.6;margin-top:4px;')}>
                {rto
                  ? 'The courier couldn’t complete the delivery, so the parcel is being returned. You don’t need to do anything — we’re sorting out your refund, and support can tell you exactly where it stands.'
                  : 'The courier has reported an issue with your parcel. Our team has been alerted and is looking into it.'}
                {/* The courier's own wording, verbatim. When a parcel goes
                    wrong this exact phrase is what support needs quoted. */}
                {latestScan?.raw_status && (
                  <><br /><span style={css('opacity:.8;')}>Courier update: “{latestScan.raw_status}”</span></>
                )}
              </div>
              <a
                href={CONTACT_LINKS.support}
                style={css('display:inline-flex;align-items:center;gap:6px;margin-top:10px;height:40px;padding:0 15px;border-radius:12px;background:var(--ag-surface);border:1.5px solid var(--ag-border);color:var(--ag-crimson);font-weight:800;font-size:12.5px;text-decoration:none;')}
              >
                Contact support
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>arrow_forward</span>
              </a>
            </div>
          </div>
        )}

        {/* ---------- How was it? (migration 0071) ---------- */}
        {/* Sits above the "not received" row on purpose: for almost every
            delivered order the parcel did arrive, and asking about the happy
            case first is the honest ordering of likelihood. */}
        {feedback.needsFeedback(order) && (
          <div style={css('display:flex;gap:12px;margin-top:16px;padding:16px;background:var(--ag-gold-bg);border:1px solid var(--ag-gold-border);border-radius:18px;align-items:center;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-gold-text);font-size:22px;flex:none;")}>reviews</span>
            <div style={css('flex:1;min-width:0;')}>
              <div style={css('font-size:14px;font-weight:800;color:var(--ag-gold-text);')}>How was it?</div>
              <div style={css('font-size:12.5px;color:var(--ag-gold-text);line-height:1.5;margin-top:2px;opacity:.9;')}>
                Rate what you bought — it’s how other buyers find {order.boutique}.
              </div>
            </div>
            <button
              onClick={() => setFeedbackOpen(true)}
              style={css('flex:none;height:40px;padding:0 16px;border:none;border-radius:12px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;')}
            >
              Rate
            </button>
          </div>
        )}

        {/* ---------- Returns (migration 0074) ---------- */}
        {/* Below "How was it?" and above "not received": a return is the least
            likely of the three outcomes, and leading with it would suggest we
            expect something to be wrong. */}
        {delivered && order.rowId && (
          <div style={css('display:flex;gap:12px;margin-top:16px;padding:16px;background:var(--ag-surface-2);border:1px solid var(--ag-border);border-radius:18px;align-items:center;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted);font-size:22px;flex:none;")}>autorenew</span>
            <div style={css('flex:1;min-width:0;')}>
              <div style={css('font-size:13.5px;font-weight:800;')}>
                {returnReq ? RETURN_STATUS_LABEL[returnReq.status] : 'Something wrong with it?'}
              </div>
              <div style={css('font-size:12.5px;color:var(--ag-muted);line-height:1.5;margin-top:2px;')}>
                {returnReq
                  ? returnReq.seller_note
                    ? `${RETURN_REASON_LABEL[returnReq.reason]} — ${returnReq.seller_note}`
                    : `${RETURN_REASON_LABEL[returnReq.reason]} · raised ${formatOrderDateTime(returnReq.created_at)}`
                  : 'Damaged, faulty or not what you ordered? Ask the boutique for a return.'}
              </div>
            </div>
            {!returnReq && (
              <button
                onClick={() => setReturnOpen(true)}
                style={css('flex:none;height:40px;padding:0 16px;border:1.5px solid var(--ag-border);border-radius:12px;background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;')}
              >
                Return
              </button>
            )}
          </div>
        )}

        {/* ---------- "It never arrived" ---------- */}
        {/* The buyer's only way to stop the seller being paid for a delivery
            that did not happen. Until this existed, "delivered" was the
            seller's word alone and the payout ran on a timer. */}
        {delivered && order.rowId && (
          <div style={css('display:flex;gap:12px;margin-top:16px;padding:16px;background:var(--ag-surface-2);border:1px solid var(--ag-border);border-radius:18px;align-items:center;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted);font-size:22px;flex:none;")}>help</span>
            <div style={css('flex:1;min-width:0;')}>
              <div style={css('font-size:13.5px;font-weight:800;')}>
                {disputed || order.deliveryDisputed ? 'We’re looking into it' : 'Not received?'}
              </div>
              <div style={css('font-size:12.5px;color:var(--ag-muted);line-height:1.5;margin-top:2px;')}>
                {disputed || order.deliveryDisputed
                  ? 'Thanks — we’ve put this order on hold and our team will be in touch.'
                  : 'This order is marked delivered. Tell us if it hasn’t reached you.'}
              </div>
            </div>
            {!(disputed || order.deliveryDisputed) && (
              <button
                disabled={disputing}
                onClick={async () => {
                  if (!order.rowId) return;
                  setDisputing(true);
                  try {
                    await reportDeliveryIssue(order.rowId);
                    setDisputed(true);
                    showToast('Reported — we’ll look into it');
                  } catch (e) {
                    showToast(e instanceof Error ? e.message : 'Could not report this');
                  } finally {
                    setDisputing(false);
                  }
                }}
                style={css(`flex:none;height:40px;padding:0 15px;border:1.5px solid var(--ag-border);border-radius:12px;background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:12.5px;cursor:${disputing ? 'wait' : 'pointer'};font-family:inherit;`)}
              >
                {disputing ? 'Sending…' : 'Report'}
              </button>
            )}
          </div>
        )}

        {/* ---------- Cancelled notice ---------- */}
        {rejected && (
          <div style={css('display:flex;gap:12px;margin-top:16px;padding:16px;background:var(--ag-bad-bg);border:1px solid var(--ag-border);border-radius:18px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#C0455E;font-size:22px;flex:none;")}>info</span>
            <div style={css('font-size:13px;color:#7A4652;line-height:1.55;')}>
              {/* Promising a refund on an order that was never paid for would be
                  a lie the buyer would chase support about. */}
              {order.paymentMethod === 'COD' ? (
                <>
                  This order was cancelled and nothing will be delivered. You were never charged, so there is no refund to wait for.{' '}
                  <a href={CONTACT_LINKS.support} style={css('color:var(--ag-crimson);font-weight:800;')}>Contact support</a> if you have a question.
                </>
              ) : (
                <>
                  This order was cancelled. The full amount is refunded to your original payment method and reaches you in 5–7 working days.{' '}
                  <a href={CONTACT_LINKS.support} style={css('color:var(--ag-crimson);font-weight:800;')}>Contact support</a> if it hasn’t arrived.
                </>
              )}
            </div>
          </div>
        )}

        {/* ---------- Timeline ---------- */}
        <div style={css(`${card}padding:22px 22px 8px;margin-top:16px;`)}>
          <div style={css(`${sectionTitle}margin-bottom:6px;`)}>Order timeline</div>
          {steps.map((st) => (
            <div key={st.label} style={css('display:flex;gap:14px;')}>
              <div style={css('display:flex;flex-direction:column;align-items:center;')}>
                <div style={css(`width:38px;height:38px;flex:none;border-radius:50%;background:${st.done ? '#D6336C' : 'var(--ag-surface)'};border:2px solid ${st.done ? '#D6336C' : 'var(--ag-border)'};display:flex;align-items:center;justify-content:center;${st.current ? 'box-shadow:0 0 0 4px rgba(214,51,108,.16);' : ''}`)}>
                  <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:20px;color:${st.done ? '#fff' : '#CBB0BC'};`)}>{st.icon}</span>
                </div>
                {st.showLine && <span style={css(`width:2.5px;flex:1;min-height:26px;background:${st.done && !st.current ? '#D6336C' : 'var(--ag-border)'};margin:3px 0;`)} />}
              </div>
              <div style={css('flex:1;padding-bottom:18px;padding-top:6px;')}>
                <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;')}>
                  <span style={css(`font-weight:800;font-size:15px;color:${st.done ? 'var(--ag-ink)' : 'var(--ag-muted-soft)'};`)}>{st.label}</span>
                  <span style={css("font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ag-muted);")}>{st.time}</span>
                </div>
                <div style={css('color:var(--ag-muted);font-size:12.5px;margin-top:2px;')}>{st.sub}</div>

                {/* Who has the parcel, and the way to follow it — attached to
                    the step it belongs to rather than floating in its own card
                    somewhere else on the page. */}
                {st.index === 3 && st.done && shipment && (
                  <div style={css('margin-top:10px;padding:12px;border-radius:14px;background:var(--ag-surface-2);border:1px solid var(--ag-border);')}>
                    <div style={css('display:flex;align-items:center;gap:10px;')}>
                      <div style={css('flex:1;min-width:0;')}>
                        <div style={css('font-weight:800;font-size:13.5px;')}>{shipment.courier_name}</div>
                        <div style={css('font-size:12px;color:var(--ag-muted);word-break:break-all;')}>{shipment.awb}</div>
                      </div>
                      <button
                        onClick={() => { void navigator.clipboard?.writeText(shipment.awb); showToast('Tracking number copied'); }}
                        aria-label="Copy tracking number"
                        style={css('width:34px;height:34px;flex:none;border-radius:10px;border:none;background:var(--ag-surface);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
                      >
                        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;color:var(--ag-crimson);")}>content_copy</span>
                      </button>
                    </div>
                    {/* No link is a real outcome, not a bug: most Indian courier
                        tracking pages take no docket in the URL. */}
                    {shipment.tracking_url ? (
                      <a
                        href={shipment.tracking_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={css('display:flex;align-items:center;justify-content:center;gap:7px;width:100%;margin-top:10px;height:42px;border-radius:12px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13px;text-decoration:none;')}
                      >
                        Track on {shipment.courier_name}
                        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>open_in_new</span>
                      </a>
                    ) : (
                      <div style={css('margin-top:8px;font-size:12px;color:var(--ag-muted);line-height:1.5;')}>
                        Quote this number to {shipment.courier_name} to check where your parcel is.
                      </div>
                    )}
                  </div>
                )}

                {/* The courier's own scans. This is what a buyer refreshes for,
                    and until now none of it reached them. Newest first; the
                    rest folded away because some couriers post a scan at every
                    hub and the list gets long fast. */}
                {st.index === 4 && st.done && (scans ?? []).length > 0 && (
                  <div style={css('margin-top:10px;')}>
                    {(showAllScans ? (scans ?? []) : (scans ?? []).slice(0, 1)).map((sc) => (
                      <div key={sc.id} style={css('display:flex;gap:9px;padding:7px 0;')}>
                        <span style={css('width:6px;height:6px;flex:none;border-radius:50%;background:var(--ag-muted-soft);margin-top:6px;')} />
                        <div style={css('flex:1;min-width:0;')}>
                          <div style={css('font-size:12.5px;color:var(--ag-ink);font-weight:600;')}>{sc.raw_status}</div>
                          <div style={css('font-size:11.5px;color:var(--ag-muted);margin-top:1px;')}>
                            {[sc.location, formatOrderDateTime(sc.occurred_at ?? sc.created_at)].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                      </div>
                    ))}
                    {(scans ?? []).length > 1 && (
                      <button
                        onClick={() => setShowAllScans((v) => !v)}
                        style={css('margin-top:4px;border:none;background:none;padding:4px 0;color:var(--ag-crimson);font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:5px;')}
                      >
                        {showAllScans ? 'Show less' : `See all ${(scans ?? []).length} updates`}
                        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>
                          {showAllScans ? 'expand_less' : 'expand_more'}
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Having dropped the two courier steps above, say why they're absent
              rather than leaving the buyer to wonder where "Out for delivery"
              went. Honest about what we do and don't know. */}
          {stage >= 3 && !delivered && !hasCourierFeed && shipment && (
            <div style={css('margin:0 0 18px 52px;font-size:12px;color:var(--ag-muted);line-height:1.55;')}>
              {shipment.courier_name} doesn’t send us live updates for this parcel, so we can’t show its position here —
              use the tracking number above for their latest.
            </div>
          )}
        </div>

        {/* ---------- Items ---------- */}
        <div style={css(`${card}padding:20px;margin-top:16px;`)}>
          <div style={css(`${sectionTitle}`)}>
            {order.items.length} {order.items.length === 1 ? 'item' : 'items'} from {order.boutique}
          </div>
          <div style={css('display:flex;flex-direction:column;gap:14px;margin-top:14px;')}>
            {order.items.map((it, i) => (
              <div
                key={`${it.pid}-${it.size}-${i}`}
                onClick={() => it.pid && navigate(`/products/${it.pid}`)}
                style={css(`display:flex;gap:13px;align-items:center;cursor:${it.pid ? 'pointer' : 'default'};`)}
              >
                <div className="agx-thumb-media" style={css(`width:58px;background:${TONES[it.tone ?? 0]};`)}>
                  <ImageSlot src={productById(it.pid)?.image} placeholder={it.title} className="agx-prod-fill" />
                </div>
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('font-weight:800;font-size:14px;line-height:1.25;')}>{it.title}</div>
                  <div style={css('color:var(--ag-muted);font-size:12.5px;margin-top:3px;')}>
                    {it.size ? `Size ${it.size} · ` : ''}Qty {it.qty}
                  </div>
                </div>
                <div style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:16px;flex:none;")}>
                  {fmt(it.price * it.qty)}
                </div>
              </div>
            ))}
          </div>

          {/* ---------- What was charged ---------- */}
          <div style={css('margin-top:18px;padding-top:16px;border-top:1px solid var(--ag-border-soft);display:flex;flex-direction:column;gap:9px;font-size:13.5px;')}>
            <div style={css('display:flex;justify-content:space-between;color:var(--ag-ink-2);')}>
              <span>Items</span><span style={css('font-weight:700;')}>{fmt(itemsTotal)}</span>
            </div>
            <div style={css('display:flex;justify-content:space-between;color:var(--ag-ink-2);')}>
              <span>Delivery</span>
              <span style={css(`font-weight:800;color:${delivery === 0 ? 'var(--ag-good)' : 'var(--ag-ink)'};`)}>{delivery === 0 ? 'FREE' : fmt(delivery)}</span>
            </div>
            {codFee > 0 && (
              <div style={css('display:flex;justify-content:space-between;color:var(--ag-ink-2);')}>
                <span>Cash handling</span><span style={css('font-weight:700;')}>{fmt(codFee)}</span>
              </div>
            )}
            <div style={css('display:flex;justify-content:space-between;align-items:baseline;margin-top:5px;padding-top:11px;border-top:1px solid var(--ag-border-soft);')}>
              <span style={css('font-weight:800;')}>{owes ? 'Due on delivery' : 'Paid'}</span>
              <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:22px;")}>{fmt(order.total)}</span>
            </div>
            <div style={css(`display:flex;align-items:center;gap:7px;color:${owes ? '#B0862B' : 'var(--ag-good)'};font-size:12px;font-weight:700;margin-top:2px;`)}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>{owes ? 'payments' : 'verified'}</span>
              {order.paymentMethod === 'COD'
                ? owes ? 'Cash on delivery · pay when it arrives' : 'Cash on delivery · payment received'
                : 'Paid online · payment verified'}
            </div>

            {/* The same receipt that was emailed at checkout, on demand — the
                moment someone wants a receipt is rarely the moment it arrived.
                Hidden while money is still owed: there is nothing to receipt
                until it has been paid (only ever true of a pre-0085 cash
                order, which is why it is a guard and not a removal). */}
            {!owes && (
              <button
                onClick={downloadReceipt}
                disabled={receiptBusy}
                style={css(`margin-top:12px;height:44px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-ink-2);border-radius:14px;font-weight:800;font-size:13.5px;cursor:${receiptBusy ? 'default' : 'pointer'};opacity:${receiptBusy ? '.6' : '1'};display:flex;align-items:center;justify-content:center;gap:8px;width:100%;`)}
              >
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;color:var(--ag-crimson);")}>receipt_long</span>
                {receiptBusy ? 'Preparing…' : 'Download receipt'}
              </button>
            )}
          </div>
        </div>

        {/* ---------- Delivery address ---------- */}
        <div style={css(`${card}padding:20px;margin-top:16px;`)}>
          <div style={css(`${sectionTitle}`)}>Delivery address</div>
          <div style={css('display:flex;gap:12px;margin-top:13px;')}>
            <span style={css('width:40px;height:40px;flex:none;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:21px;")}>location_on</span>
            </span>
            <div style={css('flex:1;min-width:0;font-size:13.5px;line-height:1.6;color:var(--ag-ink-2);')}>
              {guest.name && <div style={css('font-weight:800;color:var(--ag-ink);')}>{guest.name}</div>}
              {guest.address && <div>{guest.address}</div>}
              {guest.city && <div>{guest.city}</div>}
              {guest.phone && <div style={css('color:var(--ag-muted);margin-top:2px;')}>+91 {guest.phone}</div>}
              {!guest.address && !guest.city && (
                <div style={css('color:var(--ag-muted);')}>The address you gave at checkout.</div>
              )}
            </div>
          </div>
        </div>

        {/* ---------- Help ---------- */}
        <div style={css('display:flex;gap:12px;margin-top:16px;flex-wrap:wrap;')}>
          <button onClick={chatWithBoutique} style={css('flex:1;min-width:150px;height:52px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-ink-2);border-radius:15px;font-weight:800;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;color:#25B04A;")}>chat</span>Chat with boutique
          </button>
          <a href={CONTACT_LINKS.support} style={css('flex:1;min-width:150px;height:52px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-ink-2);border-radius:15px;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center;gap:8px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;color:var(--ag-crimson);")}>support_agent</span>Need help?
          </a>
        </div>

        {/* Where to go next, rather than a dead end. */}
        <div style={css('display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin-top:18px;font-size:12.5px;')}>
          <a href="/return-refund-policy" onClick={(e) => { e.preventDefault(); navigate('/return-refund-policy'); }} style={css('color:var(--ag-muted);font-weight:700;')}>Return & refund policy</a>
          <a href="/cancellation-policy" onClick={(e) => { e.preventDefault(); navigate('/cancellation-policy'); }} style={css('color:var(--ag-muted);font-weight:700;')}>Cancellation policy</a>
          <a href={CONTACT_LINKS.call} style={css('color:var(--ag-muted);font-weight:700;')}>{COMPANY.phone}</a>
        </div>
      </div>

      {feedbackOpen && (
        <OrderFeedbackSheet
          order={order}
          alreadyReviewed={feedback.reviewedProductIds}
          onClose={(submitted) => {
            setFeedbackOpen(false);
            feedback.suppress(order.rowId ?? '');
            if (submitted) feedback.reload();
          }}
        />
      )}

      {returnOpen && order.rowId && (
        <ReturnRequestSheet
          orderId={order.rowId}
          orderNumber={order.id}
          boutiqueId={order.boutiqueId}
          onClose={() => setReturnOpen(false)}
          onDone={() => {
            setReturnOpen(false);
            setReturnBump((n) => n + 1);
          }}
        />
      )}
    </div>
  );
}
