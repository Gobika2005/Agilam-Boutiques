import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { fmt } from '@/data/demo';
import { readOrders, type PlacedOrder } from '@/lib/orderHistory';

export function OrderConfirmation() {
  const navigate = useNavigate();
  const { lastOrderId, guest } = useShop();
  const firstName = guest.name.trim().split(/\s+/)[0] || 'there';

  // A cart spanning several boutiques is split into one order per boutique
  // server-side, so the confirmation has to show the whole batch — not just the
  // first order number. The batch is every locally-stored order sharing the
  // placement timestamp of the one we just placed.
  const orders = useMemo<PlacedOrder[]>(() => {
    if (!lastOrderId) return [];
    const all = readOrders();
    const primary = all.find((o) => o.orderNumber === lastOrderId || o.id === lastOrderId);
    if (!primary) return [];
    return all.filter((o) => o.placedAt === primary.placedAt);
  }, [lastOrderId]);

  const grandTotal = orders.reduce((s, o) => s + o.total, 0);

  // Landing here without having just checked out (a refresh, a bookmarked URL).
  // Better to send them to their order list than to congratulate them on nothing.
  if (orders.length === 0) {
    return (
      <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
        <div style={css('max-width:560px;margin:0 auto;text-align:center;padding-top:60px;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:48px;color:#CBB0BC;")}>receipt_long</span>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:14px;")}>No recent order</div>
          <div style={css('color:var(--ag-muted);font-size:14px;margin-top:8px;')}>Your placed orders live under My orders.</div>
          <div style={css('display:flex;gap:12px;margin-top:22px;justify-content:center;flex-wrap:wrap;')}>
            <button onClick={() => navigate('/orders')} style={css('height:52px;padding:0 22px;border:none;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer;')}>My orders</button>
            <button onClick={() => navigate('/')} style={css('height:52px;padding:0 22px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:15px;font-weight:800;font-size:14.5px;cursor:pointer;')}>Continue shopping</button>
          </div>
        </div>
      </div>
    );
  }

  const primary = orders[0];
  const multi = orders.length > 1;

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('max-width:560px;margin:0 auto;text-align:center;padding-top:20px;')}>
        <div style={css('width:96px;height:96px;margin:0 auto;border-radius:30px;background:linear-gradient(135deg,var(--ag-good),#1E8455);display:flex;align-items:center;justify-content:center;box-shadow:0 22px 44px -20px rgba(47,163,107,.7);')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:56px;color:#fff;")}>check</span>
        </div>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:34px;line-height:1.05;margin-top:22px;")}>Order confirmed!</div>
        <div style={css('color:var(--ag-ink-2);font-size:15px;margin-top:8px;line-height:1.55;')}>
          Thank you, {firstName}. {multi ? `${orders.length} boutiques have been notified` : 'Your boutique has been notified'} and will start preparing your order.
        </div>

        {/* One card per boutique order — each is separately tracked and fulfilled. */}
        <div style={css('display:flex;flex-direction:column;gap:10px;margin-top:22px;')}>
          {orders.map((o) => (
            <div
              key={o.id}
              onClick={() => navigate(`/orders/${encodeURIComponent(o.id)}/track`)}
              style={css('cursor:pointer;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:16px 18px;box-shadow:0 16px 36px -28px rgba(107,20,54,.5);display:flex;align-items:center;gap:14px;text-align:left;')}
            >
              <span style={css('width:52px;height:52px;flex:none;border-radius:15px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:26px;")}>shopping_bag</span>
              </span>
              <div style={css('flex:1;min-width:0;')}>
                <div className="agx-eyebrow" style={css('font-size:9.5px;color:var(--ag-muted);')}>{o.boutique}</div>
                <div style={css("font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:17px;color:var(--ag-crimson);margin-top:3px;")}>{o.id}</div>
                <div style={css('color:var(--ag-muted);font-size:12.5px;margin-top:3px;')}>
                  {o.items.reduce((s, it) => s + it.qty, 0)} item{o.items.reduce((s, it) => s + it.qty, 0) === 1 ? '' : 's'} · {fmt(o.total)}
                </div>
              </div>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;")}>chevron_right</span>
            </div>
          ))}
        </div>

        {multi && (
          <div style={css('display:flex;justify-content:space-between;align-items:baseline;margin-top:14px;padding:0 4px;font-size:14px;')}>
            <span style={css('font-weight:800;')}>Total paid</span>
            <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:22px;")}>{fmt(grandTotal)}</span>
          </div>
        )}

        {/* What genuinely happens next — no fake "SMS sent" ticks. */}
        <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:6px 16px;margin-top:14px;box-shadow:0 16px 36px -28px rgba(107,20,54,.5);text-align:left;')}>
          <div style={css('display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--ag-border-soft);')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-good);")}>storefront</span>
            <div style={css('flex:1;')}>
              <div style={css('font-weight:800;font-size:13.5px;')}>Boutique notified</div>
              <div style={css('color:var(--ag-muted);font-size:12px;')}>{multi ? 'Each boutique confirms its own items' : 'They’ll confirm and start packing'}</div>
            </div>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-good);font-size:20px;")}>check_circle</span>
          </div>
          <div style={css('display:flex;align-items:center;gap:12px;padding:13px 0;border-bottom:1px solid var(--ag-border-soft);')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;")}>local_shipping</span>
            <div style={css('flex:1;')}>
              <div style={css('font-weight:800;font-size:13.5px;')}>Delivering to</div>
              <div style={css('color:var(--ag-muted);font-size:12px;')}>{[guest.address, guest.city, guest.pincode].filter(Boolean).join(', ') || 'Your saved address'}</div>
            </div>
          </div>
          <div style={css('display:flex;align-items:center;gap:12px;padding:13px 0;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#25B04A;")}>chat</span>
            <div style={css('flex:1;')}>
              <div style={css('font-weight:800;font-size:13.5px;')}>Questions?</div>
              <div style={css('color:var(--ag-muted);font-size:12px;')}>Chat with the boutique from the order page</div>
            </div>
          </div>
        </div>

        <div style={css('display:flex;gap:12px;margin-top:20px;flex-wrap:wrap;')}>
          <button onClick={() => navigate(`/orders/${encodeURIComponent(primary.id)}/track`)} style={css('flex:1;min-width:150px;height:54px;border:none;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>pin_drop</span>Track order
          </button>
          <button onClick={() => navigate('/')} style={css('flex:1;min-width:150px;height:54px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:15px;font-weight:800;font-size:14.5px;cursor:pointer;')}>Continue shopping</button>
        </div>
      </div>
    </div>
  );
}
