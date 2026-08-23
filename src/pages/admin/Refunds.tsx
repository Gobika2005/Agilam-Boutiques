import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { useAsync } from '@/hooks/useAsync';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { fetchRefunds, refundOrder, clearLegacyRefundFlag, buyerPaid, isRefundCandidate, moneyCollected, type RefundRow } from '@/data/admin';
import { logAdminAction } from '@/data/activityLog';
import { StatCard, Select, SearchInput, DataTable, StatusPill, GhostButton, ConfirmDialog, Avatar, T, type Column } from '@/components/admin/kit';
import { useSeededSearch } from '@/hooks/useSeededSearch';

const compactInr = (n: number) =>
  n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'k' : fmtInr(n);

type Filter = 'all' | 'refunded' | 'candidates' | 'unpaid';

export function Refunds() {
  const { data, loading, reload } = useAsync(() => fetchRefunds(), []);
  const { showToast } = useShop();
  const { profile } = useAuth();
  const [search, setSearch] = useSeededSearch();
  // A refund arrived at from the global search is, by definition, already
  // refunded — so landing on the default "Awaiting refund" tab would hide the
  // very row that was picked. A seeded term opens on All instead.
  const [filter, setFilter] = useState<Filter>(() => (search ? 'all' : 'candidates'));
  const [target, setTarget] = useState<RefundRow | null>(null);
  const [busy, setBusy] = useState(false);

  const all = data ?? [];

  // Rejected/cancelled but never paid for — almost always an abandoned COD
  // order. Nothing to refund, but worth listing so the drop-off is visible
  // instead of silently vanishing from the workbench.
  const isUnpaidWriteOff = (r: RefundRow) =>
    !r.refunded && (r.status === 'rejected' || r.status === 'cancelled') && !moneyCollected(r);

  const refundedList = all.filter((r) => r.refunded);
  // `refund_amount` is what the gateway actually sent back; `buyerPaid` is the
  // best estimate for a row refunded by hand before 0097 recorded it.
  const refundedAmount = refundedList.reduce((s, r) => s + (r.refund_amount ?? buyerPaid(r)), 0);
  const candidates = all.filter(isRefundCandidate);
  const unpaid = all.filter(isUnpaidWriteOff);

  const rows = useMemo(() => {
    const base =
      filter === 'refunded' ? refundedList : filter === 'candidates' ? candidates : filter === 'unpaid' ? unpaid : all;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (r) =>
        r.order_number.toLowerCase().includes(q) ||
        r.name.toLowerCase().includes(q) ||
        r.boutique.toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, filter, search]);

  /**
   * Confirm the dialog. Two different actions share it, and which one runs is
   * decided by the row, not by a mode flag:
   *
   *   • not refunded          → issue a real Razorpay refund
   *   • refunded, no refund_id → clear a flag someone set by hand pre-0097
   *
   * A row with a refund_id never opens this dialog at all: the money is gone and
   * there is nothing here that could bring it back.
   */
  const confirmAction = async () => {
    if (!target) return;
    const reversing = target.refunded;
    setBusy(true);
    const res = reversing
      ? await clearLegacyRefundFlag(target.id)
      : await refundOrder(target.id, 'Refunded from the Refunds console');
    setBusy(false);
    if (!res.ok) { showToast(res.error ?? 'Failed'); return; }
    void logAdminAction({
      actor_id: profile?.id, actor_name: profile?.full_name ?? 'Admin',
      action: reversing ? 'order.refund_reverse' : 'order.refund', entity_type: 'order', entity_id: target.order_number,
      meta: reversing
        ? { total: target.total }
        : { amount: buyerPaid(target), refund_id: 'refundId' in res ? res.refundId : null },
    });
    showToast(reversing ? `${target.order_number} refund flag cleared` : `${target.order_number} refunded`);
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
    {
      // Method AND whether the money actually arrived. Showing only "COD" hid
      // the difference between cash collected at the door and an order nobody
      // ever paid for — the distinction that decides if a refund is even owed.
      key: 'pay', header: 'PAYMENT', width: '150px',
      render: (r) => {
        const paid = moneyCollected(r);
        return (
          <div style={css('display:flex;flex-direction:column;gap:3px;align-items:flex-start;')}>
            <StatusPill status={r.payment_id ? 'paid' : 'cod'} label={r.payment_id ? 'Online' : 'COD'} />
            <span style={css(`font-size:10.5px;font-weight:700;color:${paid ? 'var(--ag-good-text)' : T.muted};`)}>
              {paid ? 'money received' : 'never paid'}
            </span>
          </div>
        );
      },
    },
    { key: 'status', header: 'ORDER', width: '110px', render: (r) => <StatusPill status={r.status} /> },
    {
      key: 'refund', header: 'REFUND', width: '150px',
      render: (r) => {
        if (!r.refunded) return <span style={css(`font-size:12px;color:${T.muted};`)}>—</span>;
        return (
          <div style={css('display:flex;flex-direction:column;gap:2px;min-width:0;')}>
            <StatusPill status="refunded" />
            {/* The gateway reference is the whole point of the column now: it is
                what an operator quotes when a buyer says the money never came,
                and its absence is what marks a row refunded by hand. */}
            <span style={css(`font-size:10.5px;font-weight:700;color:${r.refund_status === 'pending' ? 'var(--ag-gold-text)' : T.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>
              {r.refund_id
                ? (r.refund_status === 'pending' ? 'with the bank · ' : '') + r.refund_id
                : 'recorded by hand'}
            </span>
          </div>
        );
      },
    },
    {
      key: 'total', header: 'AMOUNT', width: '110px', align: 'right',
      // What the buyer paid for THIS order — goods + the seller's delivery
      // charge − any platform-funded discount — which is what a refund sends
      // back. `total` alone understated every order that carried delivery.
      render: (r) => <span style={css('font-weight:800;font-size:13px;')}>{fmtInr(r.refund_amount ?? buyerPaid(r))}</span>,
    },
    {
      key: 'act', header: '', width: '150px', align: 'right',
      render: (r) => (
        <div style={css('display:flex;justify-content:flex-end;')} onClick={(e) => e.stopPropagation()}>
          {/* No money in means nothing to give back, so the action is withheld
              rather than offered and then explained away in the dialog. */}
          {!r.refunded && !moneyCollected(r) ? (
            <span style={css(`font-size:11.5px;font-weight:700;color:${T.muted};`)}>Nothing to refund</span>
          ) : r.refunded && r.refund_id ? (
            // Sent to Razorpay. There is no undo, so no button pretends there is.
            <span style={css(`font-size:11.5px;font-weight:700;color:${T.muted};`)}>Sent to Razorpay</span>
          ) : (
            <GhostButton tone={r.refunded ? 'default' : 'primary'} icon={r.refunded ? 'undo' : 'currency_rupee'} onClick={() => setTarget(r)}>
              {r.refunded ? 'Clear flag' : 'Refund'}
            </GhostButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      <div className="agx-adm-g4">
        <StatCard label="Refunds issued" value={String(refundedList.length)} icon="undo" tint="var(--ag-bad-bg)" ic="var(--ag-bad-text)" />
        <StatCard label="Refunded value" value={compactInr(refundedAmount)} icon="payments" tint="var(--ag-surface-2)" ic="#D6336C" />
        <StatCard label="Awaiting refund" value={String(candidates.length)} icon="pending_actions" tint="var(--ag-warn-bg)" ic="var(--ag-gold-text)" sub={candidates.length ? 'action needed' : 'clear'} />
        {/* Money the platform is actually holding and owes back — not the value
            of every failed order, which is what this used to total. */}
        <StatCard label="Owed to buyers" value={compactInr(candidates.reduce((s, r) => s + buyerPaid(r), 0))} icon="account_balance_wallet" tint="var(--ag-info-bg)" ic="var(--ag-info-text)" sub={unpaid.length ? `${unpaid.length} unpaid write-offs excluded` : undefined} />
      </div>

      <div style={css('display:flex;gap:10px;flex-wrap:wrap;align-items:center;')}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search order #, buyer or boutique…" />
        <Select value={filter} onChange={(v) => setFilter(v as Filter)} options={[
          { value: 'candidates', label: `Awaiting refund (${candidates.length})` },
          { value: 'unpaid', label: `Unpaid write-offs (${unpaid.length})` },
          { value: 'refunded', label: `Refunded (${refundedList.length})` },
          { value: 'all', label: 'All orders' },
        ]} />
        <span style={css(`font-size:12px;color:${T.muted};font-weight:600;`)}>
          {filter === 'unpaid'
            ? 'Rejected or cancelled before any money changed hands — usually abandoned COD. Listed for the record; there is nothing to refund.'
            : 'Only orders the platform actually collected money for can be refunded. Refunding sends the money back through Razorpay immediately — there is no undo.'}
        </span>
      </div>

      <DataTable columns={columns} rows={rows} loading={loading} getId={(r) => r.id} />

      <ConfirmDialog
        open={!!target}
        title={target?.refunded ? 'Clear the refunded flag?' : 'Refund this buyer?'}
        message={target
          ? target.refunded
            ? `${target.order_number} · this row was marked refunded by hand, with no Razorpay refund behind it. Clearing the flag puts the order back in the workbench and back into the seller's payout.`
            : `${fmtInr(buyerPaid(target))} goes back to ${target.name} for ${target.order_number}, through Razorpay, now. This cannot be undone from here.`
          : ''}
        confirmLabel={target?.refunded ? 'Clear flag' : 'Refund now'}
        danger={!target?.refunded}
        busy={busy}
        onConfirm={confirmAction}
        onCancel={() => setTarget(null)}
      />
    </div>
  );
}
