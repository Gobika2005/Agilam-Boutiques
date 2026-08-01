import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { useBuyerOrders } from '@/hooks/useBuyerOrders';
import { TONES, TRACK_STAGES, fmt } from '@/data/demo';
import { deliveryEstimate, formatOrderDateTime, STATUS_STAGE } from '@/lib/orderHistory';
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
  const { guest } = useShop();
  const { orders, refresh, refreshing } = useBuyerOrders();

  const decoded = id ? decodeURIComponent(id) : undefined;
  // Three handles resolve to the same order: the display id (`#AGL-…`, what the
  // orders list links with), the bare order number, and the DB row uuid — which
  // is what an order notification carries, so tapping one has to land here too.
  const order = useMemo(
    () => orders.find((o) => o.id === decoded || o.orderNumber === decoded || o.rowId === decoded),
    [orders, decoded],
  );

  if (!order) {
    return (
      <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
        <div style={css('max-width:720px;margin:0 auto;')}>
          <button onClick={() => navigate('/buyer/orders')} style={css('border:none;background:none;cursor:pointer;color:var(--ag-crimson);font-weight:800;font-size:13.5px;display:flex;align-items:center;gap:6px;padding:6px 0;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>arrow_back</span>My orders
          </button>
          <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:70px 30px;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:48px;color:#CBB0BC;")}>
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
                <button onClick={() => navigate('/buyer/orders')} style={css('height:46px;padding:0 18px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13.5px;cursor:pointer;')}>My orders</button>
                <a href={CONTACT_LINKS.support} style={css('display:flex;align-items:center;height:46px;padding:0 18px;border:1.5px solid var(--ag-border);border-radius:14px;background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:13.5px;')}>Contact support</a>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const stage = STATUS_STAGE[order.status];
  const rejected = order.status === 'rejected' || order.status === 'cancelled';
  const delivered = order.status === 'delivered';
  const item = order.items[0];
  const totalQty = order.items.reduce((s, it) => s + it.qty, 0);
  const itemsTotal = order.items.reduce((s, it) => s + it.price * it.qty, 0);
  const codFee = order.codFee ?? 0;
  // Recorded on the order since migration 0022. Older orders never stored it,
  // so fall back to inferring it from whatever the total exceeds the lines by.
  const delivery = order.shippingFee ?? Math.max(0, order.total - itemsTotal - codFee);
  // Cash still due at the door. Cleared once the boutique records collection,
  // so a delivered order never keeps asking for money already handed over.
  const owes = order.paymentMethod === 'COD' && (order.paymentStatus ?? 'pending') === 'pending' && !rejected;

  const chatWithBoutique = () => {
    navigate(`/buyer/chat/${order.boutiqueId}`, {
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

  // A real timestamp per stage, from migration 0042 — "Packed" and "Out for
  // delivery" are cosmetic hand-offs between the real events (accepted →
  // shipped) rather than status values of their own, so they carry no
  // timestamp of their own.
  const stageTimes: Record<number, string | null | undefined> = {
    0: order.placedAt,
    1: order.acceptedAt,
    3: order.shippedAt,
    5: order.deliveredAt,
  };
  const steps = TRACK_STAGES.map((st, i) => ({
    ...st,
    done: !rejected && i <= stage,
    current: !rejected && i === stage,
    showLine: i < TRACK_STAGES.length - 1,
    time: i <= stage ? formatOrderDateTime(stageTimes[i]) : '',
  }));

  const card = 'background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);';
  const sectionTitle = "font-family:'Playfair Display',serif;font-weight:700;font-size:19px;";

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('max-width:720px;margin:0 auto;')}>
        <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;')}>
          <button onClick={() => navigate('/buyer/orders')} style={css('border:none;background:none;cursor:pointer;color:var(--ag-crimson);font-weight:800;font-size:13.5px;display:flex;align-items:center;gap:6px;padding:6px 0;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>arrow_back</span>My orders
          </button>
          <button
            onClick={() => void refresh()}
            disabled={refreshing}
            aria-label="Refresh order status"
            style={css(`display:flex;align-items:center;gap:6px;height:34px;padding:0 12px;border:1px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:11px;font-weight:800;font-size:12px;cursor:${refreshing ? 'wait' : 'pointer'};opacity:${refreshing ? 0.65 : 1};`)}
          >
            <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>{refreshing ? 'sync' : 'refresh'}</span>
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
                <span style={css("font-family:'Material Symbols Outlined';font-size:16px;color:#F4D9A6;")}>{rejected ? 'cancel' : delivered ? 'check_circle' : 'local_shipping'}</span>
                {rejected ? 'Order cancelled' : TRACK_STAGES[stage].label}
              </div>
            </div>
          </div>

          {/* The single most-asked question, answered up front. */}
          {!rejected && (
            <div style={css('position:relative;margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,.2);display:flex;align-items:center;gap:9px;font-size:13px;font-weight:700;')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:18px;color:#F4D9A6;")}>{delivered ? 'task_alt' : 'schedule'}</span>
              {delivered ? 'Delivered — enjoy your piece!' : `Estimated delivery ${deliveryEstimate(order.placedAt)}`}
            </div>
          )}
        </div>

        {/* ---------- Cash on delivery ---------- */}
        {owes && (
          <div style={css('display:flex;gap:12px;margin-top:16px;padding:16px;background:var(--ag-gold-bg);border:1px solid var(--ag-gold-border);border-radius:18px;')}>
            <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-gold-text);font-size:22px;flex:none;")}>payments</span>
            <div style={css('flex:1;min-width:0;')}>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;color:var(--ag-gold-text);")}>
                Keep {fmt(order.total)} ready
              </div>
              <div style={css('font-size:13px;color:var(--ag-gold-text);line-height:1.55;margin-top:4px;')}>
                Pay in cash when this order arrives. Our delivery partner may not carry change, so the exact amount helps.
              </div>
            </div>
          </div>
        )}

        {/* ---------- Cancelled notice ---------- */}
        {rejected && (
          <div style={css('display:flex;gap:12px;margin-top:16px;padding:16px;background:var(--ag-bad-bg);border:1px solid var(--ag-border);border-radius:18px;')}>
            <span style={css("font-family:'Material Symbols Outlined';color:#C0455E;font-size:22px;flex:none;")}>info</span>
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
                  <span style={css(`font-family:'Material Symbols Outlined';font-size:20px;color:${st.done ? '#fff' : '#CBB0BC'};`)}>{st.icon}</span>
                </div>
                {st.showLine && <span style={css(`width:2.5px;flex:1;min-height:26px;background:${st.done && !st.current ? '#D6336C' : 'var(--ag-border)'};margin:3px 0;`)} />}
              </div>
              <div style={css('flex:1;padding-bottom:18px;padding-top:6px;')}>
                <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;')}>
                  <span style={css(`font-weight:800;font-size:15px;color:${st.done ? 'var(--ag-ink)' : 'var(--ag-muted-soft)'};`)}>{st.label}</span>
                  <span style={css("font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:var(--ag-muted);")}>{st.time}</span>
                </div>
                <div style={css('color:var(--ag-muted);font-size:12.5px;margin-top:2px;')}>{st.sub}</div>
              </div>
            </div>
          ))}
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
                onClick={() => it.pid && navigate(`/buyer/product/${it.pid}`)}
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
              <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>{owes ? 'payments' : 'verified'}</span>
              {order.paymentMethod === 'COD'
                ? owes ? 'Cash on delivery · pay when it arrives' : 'Cash on delivery · payment received'
                : 'Paid online · payment verified'}
            </div>
          </div>
        </div>

        {/* ---------- Delivery address ---------- */}
        <div style={css(`${card}padding:20px;margin-top:16px;`)}>
          <div style={css(`${sectionTitle}`)}>Delivery address</div>
          <div style={css('display:flex;gap:12px;margin-top:13px;')}>
            <span style={css('width:40px;height:40px;flex:none;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
              <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:21px;")}>location_on</span>
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
            <span style={css("font-family:'Material Symbols Outlined';font-size:20px;color:#25B04A;")}>chat</span>Chat with boutique
          </button>
          <a href={CONTACT_LINKS.support} style={css('flex:1;min-width:150px;height:52px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-ink-2);border-radius:15px;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center;gap:8px;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:20px;color:var(--ag-crimson);")}>support_agent</span>Need help?
          </a>
        </div>

        {/* Where to go next, rather than a dead end. */}
        <div style={css('display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin-top:18px;font-size:12.5px;')}>
          <a href="/buyer/policy/return-refund-policy" onClick={(e) => { e.preventDefault(); navigate('/buyer/policy/return-refund-policy'); }} style={css('color:var(--ag-muted);font-weight:700;')}>Return & refund policy</a>
          <a href="/buyer/policy/cancellation-policy" onClick={(e) => { e.preventDefault(); navigate('/buyer/policy/cancellation-policy'); }} style={css('color:var(--ag-muted);font-weight:700;')}>Cancellation policy</a>
          <a href={CONTACT_LINKS.call} style={css('color:var(--ag-muted);font-weight:700;')}>{COMPANY.phone}</a>
        </div>
      </div>
    </div>
  );
}
