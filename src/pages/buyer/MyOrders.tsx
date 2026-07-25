import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { useCatalog } from '@/state/CatalogContext';
import { useBuyerOrders } from '@/hooks/useBuyerOrders';
import { useShop } from '@/state/ShopContext';
import { cancelCodOrder } from '@/data/orders';
import { TONES, TRACK_STAGES, fmt } from '@/data/demo';
import { deliveryEstimate, formatOrderDate, patchLocalOrder, STATUS_STAGE, isCancellable, type PlacedOrder } from '@/lib/orderHistory';

/** Order-list tabs. "Active" is everything the buyer is still waiting on. */
const TABS = [
  { key: 'active', label: 'Active' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'all', label: 'All' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function MyOrders() {
  const navigate = useNavigate();
  const { productById } = useCatalog();
  const { orders: allOrders, refresh, refreshing, error } = useBuyerOrders();
  const { guest, showToast } = useShop();
  const [tab, setTab] = useState<TabKey>('all');
  const [cancelling, setCancelling] = useState<string | null>(null);

  const isActive = (o: PlacedOrder) => o.status === 'pending' || o.status === 'accepted' || o.status === 'shipped';
  const isClosed = (o: PlacedOrder) => o.status === 'rejected' || o.status === 'cancelled';

  const counts = useMemo(() => ({
    active: allOrders.filter(isActive).length,
    delivered: allOrders.filter((o) => o.status === 'delivered').length,
    cancelled: allOrders.filter(isClosed).length,
    all: allOrders.length,
  }), [allOrders]);

  const orders = useMemo(() => {
    if (tab === 'active') return allOrders.filter(isActive);
    if (tab === 'delivered') return allOrders.filter((o) => o.status === 'delivered');
    if (tab === 'cancelled') return allOrders.filter(isClosed);
    return allOrders;
  }, [allOrders, tab]);

  const cancel = async (o: PlacedOrder) => {
    if (!window.confirm(`Cancel order ${o.id}? The boutique will be told and nothing will be delivered.`)) return;
    setCancelling(o.orderNumber);
    try {
      await cancelCodOrder(o.orderNumber, guest.phone);
      // A guest's orders never come back from the server, so the local mirror
      // has to be corrected here or the card would still read "Arriving…".
      patchLocalOrder(o.orderNumber, { status: 'cancelled' });
      showToast('Order cancelled');
      await refresh();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not cancel this order');
    } finally {
      setCancelling(null);
    }
  };

  // Open a live chat with the order's boutique, tagged with the order as an
  // enquiry card. Mirrors the button on the order tracking screen.
  const chatWithBoutique = (o: PlacedOrder) => {
    const item = o.items[0];
    navigate(`/buyer/chat/${o.boutiqueId}`, {
      state: {
        order: {
          orderId: o.id,
          title: item?.title ?? 'Order',
          image: item ? productById(item.pid)?.image : undefined,
          tone: item?.tone ?? 0,
          qty: o.items.reduce((s, it) => s + it.qty, 0),
          amount: o.total,
          status: isClosed(o) ? 'Cancelled' : TRACK_STAGES[STATUS_STAGE[o.status]].label,
        },
      },
    });
  };

  const header = (
    <>
      <div style={css('display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:4px 0 6px;')}>
        <div>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Purchases</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(28px,3vw,40px);line-height:1.05;margin-top:4px;")}>My orders</div>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          style={css(`display:flex;align-items:center;gap:7px;height:40px;padding:0 15px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:13px;font-weight:800;font-size:13px;cursor:${refreshing ? 'wait' : 'pointer'};opacity:${refreshing ? 0.65 : 1};`)}
        >
          <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>{refreshing ? 'sync' : 'refresh'}</span>
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      {/* A failed refresh is worth saying out loud — the statuses on screen
          might be behind what the boutique has already done. */}
      {error && (
        <div style={css('display:flex;align-items:flex-start;gap:10px;margin-top:10px;padding:12px 14px;background:var(--ag-gold-bg);border:1px solid var(--ag-gold-border);border-radius:14px;color:#7A6450;font-size:12.5px;line-height:1.5;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:#C99A3F;font-size:19px;flex:none;")}>cloud_off</span>
          {error}
        </div>
      )}

      {allOrders.length > 0 && (
        <div className="agx-scroll" style={css('display:flex;gap:8px;overflow-x:auto;margin-top:14px;padding-bottom:2px;')}>
          {TABS.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={css(`flex:none;display:flex;align-items:center;gap:6px;border:1.5px solid ${on ? 'transparent' : 'var(--ag-border)'};background:${on ? 'linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-ink-3)'};border-radius:999px;padding:8px 15px;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;`)}
              >
                {t.label}
                <span style={css(`min-width:18px;height:18px;padding:0 5px;border-radius:9px;font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;background:${on ? 'rgba(255,255,255,.24)' : 'var(--ag-surface-2)'};color:${on ? '#fff' : 'var(--ag-crimson)'};`)}>
                  {counts[t.key]}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );

  if (orders.length === 0) {
    const empty = allOrders.length === 0;
    return (
      <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
        <div style={css('max-width:820px;margin:0 auto;')}>
          {header}
          <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:60px 30px;')}>
            <div style={css('width:82px;height:82px;border-radius:50%;background:linear-gradient(145deg,var(--ag-surface-2),var(--ag-surface-2));display:flex;align-items:center;justify-content:center;box-shadow:inset 0 2px 3px rgba(255,255,255,.7),0 12px 26px -12px rgba(214,51,108,.55);')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:40px;color:var(--ag-crimson);")}>receipt_long</span>
            </div>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:20px;")}>
              {empty ? 'No orders yet' : `Nothing ${tab === 'active' ? 'in progress' : tab}`}
            </div>
            <div style={css('color:var(--ag-muted);font-size:14.5px;margin-top:8px;max-width:340px;line-height:1.55;')}>
              {empty
                ? 'When you place an order it shows up here — track every piece from checkout to your doorstep.'
                : 'Try another tab to see the rest of your orders.'}
            </div>
            <button onClick={() => (empty ? navigate('/buyer/home') : setTab('all'))} style={css('margin-top:20px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;border:none;border-radius:14px;padding:13px 24px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);')}>
              {empty ? 'Start shopping' : 'Show all orders'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('max-width:820px;margin:0 auto;')}>
        {header}

        <div style={css('display:flex;flex-direction:column;gap:14px;margin-top:14px;')}>
          {orders.map((o) => {
            const item = o.items[0];
            const extra = o.items.length - 1;
            const delivered = o.status === 'delivered';
            const rejected = isClosed(o);
            const badge = o.status === 'cancelled'
              ? 'Cancelled'
              : o.status === 'rejected'
                ? 'Declined'
                : TRACK_STAGES[STATUS_STAGE[o.status]].label;
            // Cash still owed on this order: shown so the buyer knows to have
            // it ready, and hidden the moment the boutique records collection.
            const owes = o.paymentMethod === 'COD' && (o.paymentStatus ?? 'pending') === 'pending' && !rejected;
            const canCancel = isCancellable(o);
            return (
              <div
                key={o.id}
                onClick={() => navigate(`/buyer/orders/${encodeURIComponent(o.id)}/track`)}
                className="agx-lift"
                style={css('cursor:pointer;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:15px;box-shadow:0 16px 36px -30px rgba(107,20,54,.55);')}
              >
                <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;')}>
                  <span style={css("font-family:'IBM Plex Mono',monospace;font-size:12px;font-weight:600;color:var(--ag-muted);")}>{o.id}</span>
                  <span style={css(`font-size:11px;font-weight:800;padding:5px 11px;border-radius:999px;background:${delivered ? 'var(--ag-good-bg)' : rejected ? 'var(--ag-bad-bg)' : 'var(--ag-surface-2)'};color:${delivered ? 'var(--ag-good)' : rejected ? '#C0455E' : 'var(--ag-crimson)'};`)}>
                    {badge}
                  </span>
                </div>
                <div style={css('display:flex;gap:14px;margin-top:12px;')}>
                  <div className="agx-thumb-media" style={css(`width:72px;background:${TONES[item?.tone ?? 0]};`)}>
                    <ImageSlot src={item ? productById(item.pid)?.image : undefined} placeholder={item?.title} className="agx-prod-fill" />
                  </div>
                  <div style={css('flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;')}>
                    <div style={css('font-weight:800;font-size:15px;line-height:1.2;')}>
                      {item?.title ?? 'Order'}{extra > 0 ? ` +${extra} more` : ''}
                    </div>
                    <div style={css('color:var(--ag-muted);font-size:12.5px;margin-top:3px;')}>{o.boutique} · Qty {o.items.reduce((s, it) => s + it.qty, 0)}</div>
                    {/* What the buyer actually wants to know at a glance: when
                        it should arrive, or when it did. */}
                    <div style={css(`display:flex;align-items:center;gap:5px;font-size:12px;font-weight:700;margin-top:6px;color:${delivered ? 'var(--ag-good)' : rejected ? '#C0455E' : 'var(--ag-crimson)'};`)}>
                      <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>
                        {delivered ? 'check_circle' : rejected ? 'cancel' : 'schedule'}
                      </span>
                      {delivered
                        ? `Delivered · ${formatOrderDate(o.placedAt)}`
                        : o.status === 'cancelled'
                          ? 'Cancelled by you'
                          : o.status === 'rejected'
                            ? o.paymentMethod === 'COD'
                              ? 'Declined by the boutique'
                              : 'Declined — refund on its way'
                            : `Arriving ${deliveryEstimate(o.placedAt)}`}
                    </div>
                    {owes && (
                      <div style={css('display:flex;align-items:center;gap:5px;font-size:12px;font-weight:700;margin-top:5px;color:#B0862B;')}>
                        <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>payments</span>
                        Pay {fmt(o.total)} in cash on delivery
                      </div>
                    )}
                    <div style={css('display:flex;align-items:center;justify-content:space-between;margin-top:8px;')}>
                      <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:18px;")}>{fmt(o.total)}</span>
                      <span style={css('display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:var(--ag-muted);')}>
                        <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>event</span>{formatOrderDate(o.placedAt)}
                      </span>
                    </div>
                  </div>
                </div>
                <div style={css('display:flex;gap:10px;margin-top:13px;padding-top:13px;border-top:1px solid var(--ag-border-soft);flex-wrap:wrap;')}>
                  {/* Cancelling is only offered while it's genuinely free to do
                      — an un-dispatched COD order costs nobody anything yet. */}
                  {canCancel && (
                    <button
                      onClick={(e) => { e.stopPropagation(); void cancel(o); }}
                      disabled={cancelling === o.orderNumber}
                      style={css(`flex:1;min-width:140px;height:42px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:#C0455E;border-radius:13px;font-weight:800;font-size:13px;cursor:${cancelling === o.orderNumber ? 'wait' : 'pointer'};opacity:${cancelling === o.orderNumber ? 0.6 : 1};display:flex;align-items:center;justify-content:center;gap:7px;font-family:inherit;`)}
                    >
                      <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>close</span>
                      {cancelling === o.orderNumber ? 'Cancelling…' : 'Cancel order'}
                    </button>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); chatWithBoutique(o); }}
                    style={css('flex:1;min-width:140px;height:42px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:13px;font-weight:800;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;font-family:inherit;')}
                  >
                    <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>chat</span>Chat with boutique
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/buyer/orders/${encodeURIComponent(o.id)}/track`); }}
                    style={css('flex:1;min-width:140px;height:42px;border:none;background:var(--ag-surface-2);color:var(--ag-crimson);border-radius:13px;font-weight:800;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;font-family:inherit;')}
                  >
                    <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>local_shipping</span>
                    {delivered || rejected ? 'Order details' : 'Track order'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
