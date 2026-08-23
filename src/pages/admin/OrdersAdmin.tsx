import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { useDebounced } from '@/hooks/useDebounced';
import { logAdminAction } from '@/data/activityLog';
import { fetchOrdersAdminPaged, updateOrderStatus } from '@/data/orders';
import { refundOrder, clearLegacyRefundFlag, buyerPaid } from '@/data/admin';
import { canSeePlatformMoney } from '@/lib/staffAccess';
import type { OrderWithDetails } from '@/data/types';
import { useSettings } from '@/data/settings';
import {
  DataTable, SearchInput, Select, StatusPill, Avatar, Pagination,
  Drawer, Field, EmptyState, Icon, GhostButton, T, type Column,
} from '@/components/admin/kit';
import { useSeededSearch } from '@/hooks/useSeededSearch';

const PAGE_SIZE = 12;
const FLOW: OrderWithDetails['status'][] = ['pending', 'shipped', 'delivered'];

export function OrdersAdmin() {
  const { showToast } = useShop();
  const { profile } = useAuth();
  // Refunds and cancellations are money moving back out — the owner's call.
  const canAct = canSeePlatformMoney(profile?.role);
  const [page, setPage] = useState(0);
  // Seeded from `?q=` so a hit picked in the global search lands here already
  // filtered to it.
  const [rawSearch, setRawSearch] = useSeededSearch();
  const search = useDebounced(rawSearch, 300);
  const [status, setStatus] = useState<'all' | 'pending' | 'shipped' | 'delivered' | 'rejected' | 'refunded'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  // A refund moves real money — never let a second click start a second one.
  const [busyRefund, setBusyRefund] = useState(false);

  const q = useMemo(() => ({ page, pageSize: PAGE_SIZE, search, status }), [page, search, status]);
  const { data, loading, reload } = useAsync(() => fetchOrdersAdminPaged(q), [q]);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const open = rows.find((r) => r.id === openId) ?? null;

  const changeFilter = (fn: () => void) => { fn(); setPage(0); };
  const log = (action: string, id: string, meta?: Record<string, unknown>) =>
    logAdminAction({ actor_id: profile?.id, actor_name: profile?.full_name ?? 'Admin', action, entity_type: 'order', entity_id: id, meta });

  const setStatusFor = async (o: OrderWithDetails, next: OrderWithDetails['status']) => {
    try {
      await updateOrderStatus(o.id, next);
      await log(`order.${next}`, o.id, { order: o.order_number });
      showToast(`${o.order_number} → ${next}`);
      reload();
    } catch (e) { showToast(e instanceof Error ? e.message : 'Update failed'); }
  };

  /**
   * Send the money back. Real Razorpay refund, server-side — see
   * api/_refunds.js for why the amount is re-derived there rather than sent
   * from here.
   */
  const refund = async (o: OrderWithDetails) => {
    if (busyRefund) return;
    setBusyRefund(true);
    const res = await refundOrder(o.id, 'Refunded from the Orders console');
    setBusyRefund(false);
    if (!res.ok) { showToast(res.error ?? 'Refund failed'); return; }
    await log('order.refund', o.id, {
      order: o.order_number,
      amount: buyerPaid({
        total: o.total,
        shipping_fee: o.shipping_fee ?? 0,
        platform_discount: o.platform_discount ?? 0,
      }),
      refund_id: res.refundId,
    });
    showToast(`${o.order_number} refunded`);
    reload();
  };

  /** Only for rows flagged by hand before 0097 — see clearLegacyRefundFlag. */
  const clearFlag = async (o: OrderWithDetails) => {
    if (busyRefund) return;
    setBusyRefund(true);
    const res = await clearLegacyRefundFlag(o.id);
    setBusyRefund(false);
    if (!res.ok) { showToast(res.error ?? 'Update failed'); return; }
    await log('order.unrefund', o.id, { order: o.order_number });
    showToast(`${o.order_number} refund flag cleared`);
    reload();
  };

  const columns: Column<OrderWithDetails>[] = [
    {
      key: 'order', header: 'ORDER', width: '1.4fr',
      render: (o) => (
        <div style={css('min-width:0;')}>
          <div style={css('font-weight:800;font-size:13px;')}>{o.order_number}</div>
          <div style={css(`font-size:11px;color:${T.muted};`)}>{new Date(o.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {o.items?.length ?? 0} items</div>
        </div>
      ),
    },
    {
      key: 'customer', header: 'CUSTOMER', width: '1.8fr',
      render: (o) => {
        const name = o.buyer?.full_name ?? o.guest_name ?? 'Guest';
        return (
          <div style={css('display:flex;align-items:center;gap:10px;min-width:0;')}>
            <Avatar name={name} tone={name.charCodeAt(0) % 8} />
            <div style={css('min-width:0;')}>
              <div style={css('font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{name}</div>
              <div style={css(`font-size:11px;color:${T.muted};`)}>{o.boutique?.name ?? '—'}</div>
            </div>
          </div>
        );
      },
    },
    { key: 'total', header: 'TOTAL', width: '1fr', render: (o) => <span style={css('font-size:13px;font-weight:800;')}>{fmtInr(o.total)}</span> },
    { key: 'pay', header: 'PAYMENT', width: '1fr', render: (o) => <StatusPill status={o.payment_id ? 'paid' : 'cod'} label={o.payment_id ? 'Online' : 'COD'} /> },
    {
      key: 'status', header: 'STATUS', width: '1.1fr',
      render: (o) => (
        <div style={css('display:flex;gap:6px;align-items:center;')}>
          <StatusPill status={o.status} />
          {o.refunded && <StatusPill status="refunded" label="Refunded" />}
        </div>
      ),
    },
    { key: 'go', header: '', width: '44px', align: 'right', render: () => <Icon name="chevron_right" size={20} color="#C9AEBA" /> },
  ];

  return (
    <div>
      <div className="agx-adm-toolbar" style={css('display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;')}>
        <SearchInput value={rawSearch} onChange={(v) => changeFilter(() => setRawSearch(v))} placeholder="Search order #, guest name or phone…" />
        <Select value={status} onChange={(v) => changeFilter(() => setStatus(v as typeof status))} options={[
          { value: 'all', label: 'All orders' }, { value: 'pending', label: 'Pending' }, { value: 'shipped', label: 'Shipped' },
          { value: 'delivered', label: 'Delivered' }, { value: 'rejected', label: 'Cancelled' }, { value: 'refunded', label: 'Refunded' },
        ]} />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        getId={(o) => o.id}
        onRowClick={(o) => setOpenId(o.id)}
        empty={<EmptyState icon="receipt_long" title="No orders found" sub="Try a different search or filter." />}
      />
      {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}

      <Drawer
        open={!!open}
        onClose={() => setOpenId(null)}
        title={open?.order_number ?? 'Order'}
        footer={open && (
          <div style={css('display:flex;gap:10px;')}>
            {/* Cancelling an order and marking it refunded are both refund
                decisions — money going back out — so both stay with the owner.
                `staff_set_order_status` refuses 'rejected' and staff hold no
                UPDATE policy on `orders`, so these would fail anyway (0086);
                hiding them keeps an employee from trying. */}
            {canAct && open.status !== 'rejected' && (
              <GhostButton icon="cancel" tone="danger" onClick={() => setStatusFor(open, 'rejected')}>Cancel order</GhostButton>
            )}
            {/* Once Razorpay holds the instruction the money is gone, so a real
                refund gets no "undo" — only a row flagged by hand before 0097
                can still be un-flagged. */}
            {canAct && !open.refunded && (
              <GhostButton icon="currency_rupee" tone="primary" disabled={busyRefund} onClick={() => refund(open)}>
                {busyRefund ? 'Refunding…' : 'Refund buyer'}
              </GhostButton>
            )}
            {canAct && open.refunded && !open.refund_id && (
              <GhostButton icon="undo" disabled={busyRefund} onClick={() => clearFlag(open)}>Clear refund flag</GhostButton>
            )}
          </div>
        )}
      >
        {open && <OrderDetail o={open} onSetStatus={(s) => setStatusFor(open, s)} />}
      </Drawer>
    </div>
  );
}

function OrderDetail({ o, onSetStatus }: { o: OrderWithDetails; onSetStatus: (s: OrderWithDetails['status']) => void }) {
  const { commission_pct: pct } = useSettings();
  const { profile } = useAuth();
  const showMoney = canSeePlatformMoney(profile?.role);
  const name = o.buyer?.full_name ?? o.guest_name ?? 'Guest';
  const phone = o.buyer?.phone ?? o.guest_phone ?? '—';
  const city = o.buyer?.city ?? o.guest_city ?? '—';
  const currentIdx = FLOW.indexOf(o.status);
  const rejected = o.status === 'rejected';

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      {/* Status timeline */}
      <div style={css('background:var(--ag-surface);border-radius:14px;padding:16px;')}>
        <div style={css('font-weight:800;font-size:13px;margin-bottom:14px;')}>Fulfilment</div>
        {rejected ? (
          <StatusPill status="rejected" label="Cancelled" />
        ) : (
          <div style={css('display:flex;align-items:center;')}>
            {FLOW.map((step, i) => {
              const done = i <= currentIdx;
              return (
                <div key={step} style={css('display:flex;align-items:center;flex:1;')}>
                  <div style={css('display:flex;flex-direction:column;align-items:center;gap:5px;')}>
                    <div style={css(`width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;${done ? 'background:#D6336C;color:#fff;' : 'background:var(--ag-surface-2);color:var(--ag-muted-soft);'}`)}>
                      <Icon name={i === 0 ? 'receipt' : i === 1 ? 'local_shipping' : 'check'} size={16} />
                    </div>
                    <span style={css(`font-size:10.5px;font-weight:700;color:${done ? 'var(--ag-crimson)' : 'var(--ag-muted-soft)'};`)}>{step}</span>
                  </div>
                  {i < FLOW.length - 1 && <div style={css(`flex:1;height:2px;margin:0 4px 16px;background:${i < currentIdx ? '#D6336C' : '#F3DFE8'};`)} />}
                </div>
              );
            })}
          </div>
        )}
        <div style={css('display:flex;gap:8px;margin-top:14px;')}>
          <select value={o.status} onChange={(e) => onSetStatus(e.target.value as OrderWithDetails['status'])} style={css(`flex:1;height:38px;border:1.5px solid ${T.field};border-radius:10px;background:var(--ag-bg);font-size:13px;font-weight:700;color:var(--ag-label);padding:0 10px;cursor:pointer;font-family:inherit;`)}>
            <option value="pending">Pending</option>
            <option value="shipped">Shipped</option>
            <option value="delivered">Delivered</option>
            <option value="rejected">Cancelled</option>
          </select>
        </div>
      </div>

      {/* Customer */}
      <div style={css('background:var(--ag-surface);border-radius:14px;padding:4px 16px;')}>
        <Field label="Customer" value={name} />
        <Field label="Phone" value={phone} />
        <Field label="City" value={city} />
        <Field label="Address" value={o.guest_address || '—'} />
      </div>

      {/* Items */}
      <div>
        <div style={css('font-weight:800;font-size:13px;margin-bottom:8px;')}>Items</div>
        <div style={css('display:flex;flex-direction:column;gap:8px;')}>
          {o.items.map((it) => (
            <div key={it.id} style={css('background:var(--ag-surface);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;')}>
              <div style={css('flex:1;min-width:0;')}>
                <div style={css('font-weight:700;font-size:12.5px;')}>{it.title}</div>
                <div style={css(`font-size:11px;color:${T.muted};`)}>Qty {it.qty}{it.size ? ` · ${it.size}` : ''}{it.color ? ` · ${it.color}` : ''}</div>
              </div>
              <div style={css('font-weight:800;font-size:12.5px;')}>{fmtInr(it.price * it.qty)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Payment summary */}
      <div style={css('background:var(--ag-surface);border-radius:14px;padding:4px 16px;')}>
        {/* No payment id means a cash order placed before cash on delivery was
            withdrawn (migration 0085) — every order since carries one. */}
        <Field label="Payment" value={o.payment_id ? 'Online (Razorpay)' : 'Cash on delivery (legacy)'} />
        {o.payment_id && <Field label="Payment ID" value={<span style={css('font-size:11.5px;')}>{o.payment_id}</span>} />}
        {/* Order total stays visible for everyone — support cannot handle an
            order without knowing what the buyer paid. The commission line is
            what the PLATFORM earns, which is revenue, so it is admin-only. */}
        <Field label="Order total" value={fmtInr(o.total)} />
        {showMoney && (
          <Field label={`Commission (${pct}%)`} value={<span style={css('color:var(--ag-gold-text);')}>{fmtInr(o.total * (pct / 100))}</span>} />
        )}
        <Field label="Refund" value={o.refunded ? <StatusPill status="refunded" label="Refunded" /> : 'None'} />
      </div>
    </div>
  );
}
