import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { useAsync } from '@/hooks/useAsync';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { fetchRefunds, setOrderRefunded, type RefundRow } from '@/data/admin';
import { logAdminAction } from '@/data/activityLog';
import { StatCard, Select, DataTable, StatusPill, GhostButton, ConfirmDialog, Avatar, T, type Column } from '@/components/admin/kit';

const compactInr = (n: number) =>
  n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'k' : fmtInr(n);

type Filter = 'all' | 'refunded' | 'candidates';

export function Refunds() {
  const { data, loading, reload } = useAsync(() => fetchRefunds(), []);
  const { showToast } = useShop();
  const { profile } = useAuth();
  const [filter, setFilter] = useState<Filter>('candidates');
  const [target, setTarget] = useState<RefundRow | null>(null);
  const [busy, setBusy] = useState(false);

  const all = data ?? [];
  // A "candidate" is an order that was rejected/cancelled but not yet refunded.
  const isCandidate = (r: RefundRow) => !r.refunded && (r.status === 'rejected' || r.status === 'cancelled');

  const rows = useMemo(() => {
    if (filter === 'refunded') return all.filter((r) => r.refunded);
    if (filter === 'candidates') return all.filter(isCandidate);
    return all;
  }, [all, filter]);

  const refundedList = all.filter((r) => r.refunded);
  const refundedAmount = refundedList.reduce((s, r) => s + r.total, 0);
  const candidates = all.filter(isCandidate);

  const confirmToggle = async () => {
    if (!target) return;
    setBusy(true);
    const next = !target.refunded;
    const res = await setOrderRefunded(target.id, next);
    setBusy(false);
    if (!res.ok) { showToast(res.error ?? 'Failed'); return; }
    void logAdminAction({
      actor_id: profile?.id, actor_name: profile?.full_name ?? 'Admin',
      action: next ? 'order.refund' : 'order.refund_reverse', entity_type: 'order', entity_id: target.order_number,
      meta: { total: target.total },
    });
    showToast(next ? `${target.order_number} marked refunded` : `${target.order_number} refund reversed`);
    setTarget(null);
    reload();
  };

  const columns: Column<RefundRow>[] = [
    {
      key: 'order', header: 'ORDER', width: '2fr',
      render: (r) => (
        <div style={css('display:flex;align-items:center;gap:10px;min-width:0;')}>
          <Avatar name={r.name} tone={r.order_number.charCodeAt(r.order_number.length - 1) % 8} />
          <div style={css('min-width:0;')}>
            <div style={css('font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{r.order_number} · {r.name}</div>
            <div style={css(`font-size:11.5px;color:${T.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>{r.boutique}</div>
          </div>
        </div>
      ),
    },
    { key: 'pay', header: 'PAYMENT', width: '110px', render: (r) => <StatusPill status={r.payment_id ? 'paid' : 'cod'} label={r.payment_id ? 'Online' : 'COD'} /> },
    { key: 'status', header: 'ORDER', width: '110px', render: (r) => <StatusPill status={r.status} /> },
    { key: 'refund', header: 'REFUND', width: '120px', render: (r) => r.refunded ? <StatusPill status="refunded" /> : <span style={css(`font-size:12px;color:${T.muted};`)}>—</span> },
    { key: 'total', header: 'AMOUNT', width: '110px', align: 'right', render: (r) => <span style={css('font-weight:800;font-size:13px;')}>{fmtInr(r.total)}</span> },
    {
      key: 'act', header: '', width: '150px', align: 'right',
      render: (r) => (
        <div style={css('display:flex;justify-content:flex-end;')} onClick={(e) => e.stopPropagation()}>
          <GhostButton tone={r.refunded ? 'default' : 'primary'} icon={r.refunded ? 'undo' : 'currency_rupee'} onClick={() => setTarget(r)}>
            {r.refunded ? 'Reverse' : 'Refund'}
          </GhostButton>
        </div>
      ),
    },
  ];

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      <div className="agx-adm-g4">
        <StatCard label="Refunds issued" value={String(refundedList.length)} icon="undo" tint="var(--ag-bad-bg)" ic="var(--ag-bad-text)" />
        <StatCard label="Refunded value" value={compactInr(refundedAmount)} icon="payments" tint="var(--ag-surface-2)" ic="#D6336C" />
        <StatCard label="Awaiting refund" value={String(candidates.length)} icon="pending_actions" tint="var(--ag-warn-bg)" ic="#C99A3F" sub={candidates.length ? 'action needed' : 'clear'} />
        <StatCard label="Candidate value" value={compactInr(candidates.reduce((s, r) => s + r.total, 0))} icon="account_balance_wallet" tint="var(--ag-info-bg)" ic="var(--ag-info-text)" />
      </div>

      <div style={css('display:flex;gap:10px;flex-wrap:wrap;align-items:center;')}>
        <Select value={filter} onChange={(v) => setFilter(v as Filter)} options={[
          { value: 'candidates', label: `Awaiting refund (${candidates.length})` },
          { value: 'refunded', label: `Refunded (${refundedList.length})` },
          { value: 'all', label: 'All orders' },
        ]} />
        <span style={css(`font-size:12px;color:${T.muted};font-weight:600;`)}>
          Marking an order refunded records the decision. Money movement via Razorpay is a separate settlement step.
        </span>
      </div>

      <DataTable columns={columns} rows={rows} loading={loading} getId={(r) => r.id} />

      <ConfirmDialog
        open={!!target}
        title={target?.refunded ? 'Reverse this refund?' : 'Mark as refunded?'}
        message={target ? `${target.order_number} · ${fmtInr(target.total)} to ${target.name}. ${target.refunded ? 'This clears the refunded flag.' : 'Confirm the buyer has been (or will be) refunded.'}` : ''}
        confirmLabel={target?.refunded ? 'Reverse' : 'Mark refunded'}
        danger={!target?.refunded}
        busy={busy}
        onConfirm={confirmToggle}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}
