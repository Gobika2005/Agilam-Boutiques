import { useEffect, useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { useShop } from '@/state/ShopContext';
import { useAsync } from '@/hooks/useAsync';
import {
  fetchPayoutSummaries, fetchPayoutHistory, fetchPayoutDestinations, settlePayout,
  fetchSettleableOrders, payoutClock,
  PAYOUT_RATE, type PayoutSummary, type PayoutDestination, type StatementOrder, type PayoutRecord,
} from '@/data/payouts';
import { fetchSettings } from '@/data/settings';
import { PayoutStatement } from '@/components/payouts/PayoutStatement';
import { SellerPayoutMessage } from '@/components/admin/SellerPayoutMessage';
import { useIfscLookup } from '@/hooks/useIfscLookup';
import { CopyRow } from '@/components/admin/CopyRow';
import {
  T, Card, StatCard, DataTable, StatusPill, Avatar, GhostButton, ConfirmDialog, Drawer, Field, EmptyState,
  BulkBar, type Column,
} from '@/components/admin/kit';
import { Skeleton } from '@/components/ui/Skeleton';

/** Signed money: keeps a real minus for the "seller owes us" case. */
const money = (n: number) => (n < -0.005 ? '−' : '') + fmtInr(Math.abs(n));
const RATE_PCT = Math.round(PAYOUT_RATE * 100);

/**
 * A bank reference is required before money OUT can be marked paid: with
 * automatic payouts disabled, this reference is the only link between a row in
 * this console and a real transaction at the bank. Recording dues (net < 0)
 * moves no money and therefore has nothing to reference.
 */
const needsReference = (net: number) => net > 0;

/**
 * Re-render on a slow tick so the payout countdown stays true without the admin
 * reloading. A minute is the right granularity for an 8-hour clock: any faster
 * repaints the whole table for a digit nobody is watching.
 */
function useMinuteTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function Payments() {
  const { showToast } = useShop();
  const { data: summaries, loading, reload } = useAsync(() => fetchPayoutSummaries(), []);
  const { data: history, loading: histLoading, reload: reloadHistory } = useAsync(() => fetchPayoutHistory(), []);
  // The published promise. Falls back to 8 if settings are unreadable, which
  // matches DEFAULT_SETTINGS — a settings outage must not make every row look
  // overdue.
  const { data: settings } = useAsync(() => fetchSettings(), []);
  const slaHours = settings?.payout_sla_hours ?? 8;
  const now = useMinuteTick();

  const [selected, setSelected] = useState<PayoutSummary | null>(null);
  const [confirm, setConfirm] = useState<PayoutSummary | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Batch settlement: ticked boutiques, and the reference captured for each.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchRefs, setBatchRefs] = useState<Record<string, string>>({});
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  // Where each boutique's money has to go. Loaded for the whole table rather
  // than per-drawer, because whether a seller CAN be paid changes what the row
  // itself is allowed to offer.
  const [dests, setDests] = useState<Map<string, PayoutDestination>>(new Map());
  const [destsLoaded, setDestsLoaded] = useState(false);

  // The itemised orders behind the open drawer, and the "tell the seller" step
  // that follows a settlement.
  const [lines, setLines] = useState<StatementOrder[] | null>(null);
  const [linesLoading, setLinesLoading] = useState(false);
  // The destination is snapshotted with the record, not looked up again: a
  // fully-settled boutique drops out of `summaries`, which drops it out of
  // `dests` on the reload — and the email/WhatsApp buttons would vanish exactly
  // when they are needed.
  const [settled, setSettled] = useState<{ record: PayoutRecord; name: string; dest: PayoutDestination | null } | null>(null);
  const summaryIds = useMemo(() => (summaries ?? []).map((s) => s.boutique_id).join(','), [summaries]);

  useEffect(() => {
    if (!summaries) return;
    let cancelled = false;
    setDestsLoaded(false);
    fetchPayoutDestinations(summaries.map((s) => s.boutique_id))
      .then((m) => { if (!cancelled) { setDests(m); setDestsLoaded(true); } })
      .catch(() => { if (!cancelled) setDestsLoaded(true); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryIds]);

  const destOf = (id: string) => dests.get(id) ?? null;
  /** Money out is only allowed once we know there is an account to send it to. */
  const payable = (r: PayoutSummary) => r.net <= 0 || (destsLoaded && (destOf(r.boutique_id)?.hasBank ?? false));

  // Money out and money in are two different jobs. Sorting payables first (then
  // by size) stops a "seller owes us" row reading as a pending payment when the
  // only difference was a minus sign in the last column.
  const rows = [...(summaries ?? [])].sort((a, b) =>
    (a.net < 0 ? 1 : 0) - (b.net < 0 ? 1 : 0) || Math.abs(b.net) - Math.abs(a.net),
  );
  const totalPayable = rows.reduce((s, r) => s + Math.max(r.net, 0), 0);
  const totalOwedToUs = rows.reduce((s, r) => s + Math.max(-r.net, 0), 0);
  const unsettledCommission = rows.reduce((s, r) => s + r.prepaidCommission + r.codCommission, 0);

  // Sellers we owe money to but have no account for. Surfaced as its own number
  // because it is a chase-the-seller job, not a pay-the-seller job.
  const blocked = rows.filter((r) => r.net > 0 && destsLoaded && !destOf(r.boutique_id)?.hasBank);
  const blockedTotal = blocked.reduce((s, r) => s + r.net, 0);

  // Paid but undelivered — money the platform is holding by design (0078).
  const heldOrders = rows.reduce((s, r) => s + r.heldOrders, 0);
  const heldValue = rows.reduce((s, r) => s + r.heldValue, 0);
  // Past the promise. Only payables count: a "seller owes us" row has no clock
  // to be late against.
  const overdue = rows.filter((r) => r.net > 0 && payoutClock(r.oldestDeliveredAt, slaHours, now).overdue);
  const overdueTotal = overdue.reduce((s, r) => s + r.net, 0);

  const batchRows = rows.filter((r) => picked.has(r.boutique_id));
  const batchTotal = batchRows.reduce((s, r) => s + r.net, 0);
  // Every money-out line in the batch needs its own bank reference — one
  // transfer, one UTR — so the run cannot start until each is filled in.
  const batchReady = batchRows.length > 0 && batchRows.every((r) => !needsReference(r.net) || (batchRefs[r.boutique_id] ?? '').trim().length > 0);

  const toggle = (id: string) =>
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectableRows = rows.filter(payable);
  const toggleAll = () =>
    setPicked((p) => (p.size >= selectableRows.length ? new Set() : new Set(selectableRows.map((r) => r.boutique_id))));

  const openDrawer = (s: PayoutSummary) => {
    setSelected(s);
    setNote('');
    // Itemise what is about to be paid. Best-effort: the drawer's totals come
    // from the summary, so a failed line fetch degrades to "breakdown
    // unavailable" rather than blocking the payout.
    setLines(null);
    setLinesLoading(true);
    fetchSettleableOrders(s.boutique_id)
      .then((rows) => setLines(rows))
      .catch(() => setLines([]))
      .finally(() => setLinesLoading(false));
  };

  const doSettle = async () => {
    if (!confirm) return;
    if (needsReference(confirm.net) && !note.trim()) {
      showToast('Enter the bank reference / UTR before marking this paid');
      return;
    }
    setBusy(true);
    try {
      const rec = await settlePayout(confirm.boutique_id, note.trim() || undefined);
      showToast(
        rec.amount < 0
          ? `Recorded — ${confirm.name} owes ${money(-rec.amount)}`
          : `Paid ${money(rec.amount)} to ${confirm.name}`,
      );
      // Straight into telling the seller. This is the only moment the admin has
      // the bank reference to hand, so it is the only moment the message is
      // worth anything.
      setSettled({ record: rec, name: confirm.name, dest: destOf(confirm.boutique_id) });
      setConfirm(null);
      setSelected(null);
      setNote('');
      setPicked((p) => { const n = new Set(p); n.delete(confirm.boutique_id); return n; });
      reload();
      reloadHistory();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not settle this payout');
    } finally {
      setBusy(false);
    }
  };

  /**
   * Record several settlements in one pass.
   *
   * Sequential, not parallel: each call stamps the orders it covers, and firing
   * them together against the same tables invites races for no real gain at
   * this volume. A failure stops the run and reports how far it got, so nothing
   * is silently half-settled.
   */
  const doBatch = async () => {
    const list = batchRows;
    setBusy(true);
    let done = 0;
    try {
      for (const r of list) {
        setBatchProgress(`Recording ${done + 1} of ${list.length} — ${r.name}…`);
        await settlePayout(r.boutique_id, batchRefs[r.boutique_id]?.trim() || undefined);
        done += 1;
      }
      showToast(`Recorded ${done} payout${done === 1 ? '' : 's'}`);
      setBatchOpen(false);
      setPicked(new Set());
      setBatchRefs({});
      reload();
      reloadHistory();
    } catch (e) {
      showToast(
        done > 0
          ? `Recorded ${done} of ${list.length}, then failed: ${e instanceof Error ? e.message : 'unknown error'}`
          : e instanceof Error ? e.message : 'Could not record these payouts',
      );
      reload();
      reloadHistory();
    } finally {
      setBusy(false);
      setBatchProgress(null);
    }
  };

  const columns: Column<PayoutSummary>[] = [
    {
      key: 'name', header: 'BOUTIQUE', width: '1.6fr',
      render: (r) => (
        <div style={css('display:flex;align-items:center;gap:11px;min-width:0;')}>
          <Avatar name={r.name} tone={r.tone} />
          <div style={css('min-width:0;')}>
            <div style={css('font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{r.name}</div>
            <div style={css(`font-size:11.5px;color:${T.muted};font-weight:600;`)}>
              {r.orders} delivered order{r.orders === 1 ? '' : 's'}
              {/* Held money is why a balance can look smaller than the seller
                  expects. Naming it on the row saves the "where is my ₹4,000"
                  message before it is sent. */}
              {r.heldOrders > 0 && ` · ${r.heldOrders} held (${fmtInr(r.heldValue)})`}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'due', header: 'PAYOUT DUE', width: '1fr',
      render: (r) => {
        const clock = payoutClock(r.oldestDeliveredAt, slaHours, now);
        if (!clock.dueAt) {
          return <span style={css(`font-size:12px;font-weight:700;color:${T.muted};`)}>Nothing delivered</span>;
        }
        return (
          <div style={css('display:flex;flex-direction:column;gap:2px;')}>
            <span style={css(`font-size:12.5px;font-weight:800;color:${clock.overdue ? 'var(--ag-bad-text)' : 'var(--ag-good-text)'};`)}>
              {clock.label}
            </span>
            <span style={css(`font-size:10.5px;font-weight:600;color:${T.muted};`)}>
              {clock.dueAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            </span>
          </div>
        );
      },
    },
    {
      key: 'payout', header: 'ONLINE PAYOUT', width: '1fr', align: 'right',
      render: (r) => <span style={css('font-size:13px;font-weight:700;')}>{fmtInr(r.prepaidPayout)}</span>,
    },
    {
      key: 'cod', header: 'COD OWED', width: '1fr', align: 'right',
      // Normally the seller owes us (commission + fees on cash they hold), but a
      // platform coupon they honoured in cash can tip this the other way — then
      // it is a credit, and printing '—' would silently swallow money we owe.
      render: (r) => (
        <span style={css(`font-size:13px;font-weight:700;color:${r.codOwed > 0 ? 'var(--ag-bad-text)' : r.codOwed < 0 ? 'var(--ag-good-text)' : T.muted};`)}>
          {r.codOwed === 0 ? '—' : (r.codOwed > 0 ? '−' : '+') + fmtInr(Math.abs(r.codOwed))}
        </span>
      ),
    },
    {
      key: 'net', header: 'NET', width: '1.2fr', align: 'right',
      render: (r) => (
        <div style={css('display:flex;flex-direction:column;align-items:flex-end;gap:2px;')}>
          <span style={css(`font-size:14px;font-weight:800;color:${r.net < 0 ? 'var(--ag-bad-text)' : 'var(--ag-good-text)'};`)}>{money(r.net)}</span>
          <span style={css(`font-size:10.5px;font-weight:700;letter-spacing:.02em;color:${r.net < 0 ? 'var(--ag-bad-text)' : T.muted};`)}>
            {r.net < 0 ? 'seller owes us' : 'we owe seller'}
          </span>
        </div>
      ),
    },
    {
      key: 'action', header: '', width: '170px', align: 'right',
      render: (r) => {
        // A "Pay out" button on a seller with no account leads to a dead end —
        // the admin opens the drawer, finds nothing to copy, and closes it. Say
        // so on the row instead, and make it the actionable thing.
        if (r.net > 0 && destsLoaded && !destOf(r.boutique_id)?.hasBank) {
          return (
            <div style={css('display:flex;justify-content:flex-end;')} onClick={(e) => e.stopPropagation()}>
              <StatusPill status="failed" label="No bank account" />
            </div>
          );
        }
        return (
          <div style={css('display:flex;justify-content:flex-end;')} onClick={(e) => e.stopPropagation()}>
            {/* "Record" alone read as "record a payout" on rows where no money
                leaves the platform. Name the direction in the button. */}
            <GhostButton tone="primary" icon={r.net < 0 ? 'south_west' : 'payments'} onClick={() => { setNote(''); openDrawer(r); }}>
              {r.net < 0 ? 'Record dues' : 'Pay out'}
            </GhostButton>
          </div>
        );
      },
    },
  ];

  return (
    <div style={css('display:flex;flex-direction:column;gap:20px;')}>
      {/* The rule, stated where the money is. Two things about payouts are not
          discoverable from a table of figures: nothing is payable until it is
          delivered, and there is a published deadline once it is. */}
      <Card style="padding:14px 18px;display:flex;align-items:flex-start;gap:12px;">
        <span className="material-symbols-rounded" aria-hidden="true" style={css('color:var(--ag-good-text);flex:none;')}>local_shipping</span>
        <div style={css('font-size:12.5px;font-weight:600;line-height:1.6;')}>
          <strong style={css('font-weight:800;')}>Delivered orders only.</strong> An order becomes payable when it is marked
          delivered — a paid order that has not reached the buyer is held and cannot be settled, by the database as well as by this
          screen. From delivery, MangaiMart promises the seller their money <strong style={css('font-weight:800;')}>within {slaHours} hours</strong>;
          the clock in each row runs from that boutique's longest-waiting delivery. Paying earlier is fine — the deadline is the
          commitment, not a lock.
        </div>
      </Card>

      {/* Summary tiles */}
      <div className="agx-adm-g5">
        <StatCard label="Awaiting payout" value={fmtInr(totalPayable)} icon="account_balance_wallet" tint="var(--ag-good-bg)" ic="var(--ag-good-text)" sub={`${rows.filter((r) => r.net > 0).length} sellers`} />
        <StatCard
          label={`Past the ${slaHours}h promise`}
          value={fmtInr(overdueTotal)}
          icon="schedule"
          tint={overdue.length > 0 ? 'var(--ag-bad-bg)' : 'var(--ag-good-bg)'}
          ic={overdue.length > 0 ? 'var(--ag-bad-text)' : 'var(--ag-good-text)'}
          sub={overdue.length > 0 ? `${overdue.length} seller${overdue.length === 1 ? '' : 's'} waiting` : 'all on time'}
        />
        <StatCard label="Held — not delivered" value={fmtInr(heldValue)} icon="pause_circle" tint="var(--ag-info-bg)" ic="var(--ag-info-text)" sub={`${heldOrders} paid order${heldOrders === 1 ? '' : 's'}`} />
        <StatCard label="Owed to platform (COD)" value={fmtInr(totalOwedToUs)} icon="south_west" tint="var(--ag-bad-bg)" ic="var(--ag-bad-text)" sub={`${rows.filter((r) => r.net < 0).length} sellers`} />
        <StatCard label={`Commission (${RATE_PCT}% incl. gateway + tax)`} value={fmtInr(unsettledCommission)} icon="percent" tint="var(--ag-warn-bg)" ic="var(--ag-warn-text)" sub="unsettled" />
      </div>

      {/* Overdue is the only thing on this page with a deadline attached, so it
          gets its own line rather than being one number among four. */}
      {overdue.length > 0 && (
        <Card style="padding:14px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--ag-bad-bg);">
          <span className="material-symbols-rounded" style={css('color:var(--ag-bad-text);')}>schedule</span>
          <span style={css('flex:1;min-width:220px;font-size:13px;font-weight:700;color:var(--ag-bad-text);line-height:1.5;')}>
            {fmtInr(overdueTotal)} to {overdue.length} seller{overdue.length === 1 ? '' : 's'} is past the {slaHours}-hour payout promise
            {' — '}{overdue.map((b) => b.name).slice(0, 3).join(', ')}{overdue.length > 3 ? ` +${overdue.length - 3} more` : ''}. Transfer these first.
          </span>
        </Card>
      )}

      {/* Money we owe but cannot send. Kept above the table because it needs a
          different action entirely — chasing the seller, not paying them. */}
      {blocked.length > 0 && (
        <Card style="padding:14px 18px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--ag-warn-bg);">
          <span className="material-symbols-rounded" style={css('color:var(--ag-warn-text);')}>account_balance</span>
          <span style={css('flex:1;min-width:220px;font-size:13px;font-weight:700;color:var(--ag-warn-text);line-height:1.5;')}>
            {fmtInr(blockedTotal)} is owed to {blocked.length} seller{blocked.length === 1 ? '' : 's'} with no bank account on file
            {' — '}{blocked.map((b) => b.name).slice(0, 3).join(', ')}{blocked.length > 3 ? ` +${blocked.length - 3} more` : ''}.
            They are prompted to add one each time they open their dashboard.
          </span>
        </Card>
      )}

      {/* Awaiting settlement */}
      <div>
        <div style={css('display:flex;align-items:baseline;gap:9px;margin-bottom:12px;')}>
          <span style={css('font-weight:800;font-size:15px;')}>Awaiting settlement</span>
          {/* The tiles above count payables only, so a table of "owes us" rows
              under a "0 sellers awaiting payout" tile looked contradictory. */}
          <span style={css(`font-size:12px;font-weight:600;color:${T.muted};`)}>
            {rows.length === 0 ? 'nothing outstanding'
              : `${rows.filter((r) => r.net > 0).length} to pay · ${rows.filter((r) => r.net < 0).length} to collect`}
          </span>
        </div>
        <BulkBar count={picked.size}>
          <span style={css('font-size:12.5px;font-weight:700;opacity:.85;align-self:center;')}>{money(batchTotal)}</span>
          <GhostButton icon="close" onClick={() => setPicked(new Set())}>Clear</GhostButton>
          <GhostButton tone="primary" icon="payments" onClick={() => { setBatchRefs({}); setBatchOpen(true); }}>
            Record {picked.size} payout{picked.size === 1 ? '' : 's'}
          </GhostButton>
        </BulkBar>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          getId={(r) => r.boutique_id}
          selectable
          selectedIds={picked}
          onToggle={(id) => { const r = rows.find((x) => x.boutique_id === id); if (r && payable(r)) toggle(id); }}
          onToggleAll={toggleAll}
          onRowClick={openDrawer}
          empty={<EmptyState icon="task_alt" title="All settled" sub="No boutique has an outstanding balance right now." />}
        />
      </div>

      {/* Recent payouts */}
      <div>
        <div style={css('font-weight:800;font-size:15px;margin-bottom:12px;')}>Recent payouts</div>
        <Card style="padding:0;overflow:hidden;">
          {histLoading && (
            <div role="status" aria-busy="true">
              <span className="agx-visually-hidden">Loading payouts…</span>
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} style={css(`display:flex;align-items:center;gap:12px;padding:16px 20px;${i ? `border-top:1px solid ${T.border};` : ''}`)}>
                  <Skeleton w={34} h={34} radius={11} />
                  <span style={css('flex:1;min-width:0;')}>
                    <Skeleton w="46%" h={12} />
                    <Skeleton w="28%" h={10} style="margin-top:8px;" />
                  </span>
                  <Skeleton w={72} h={14} />
                </div>
              ))}
            </div>
          )}
          {!histLoading && (history ?? []).length === 0 && (
            <div style={css(`padding:20px;color:${T.muted};font-size:13.5px;`)}>No payouts recorded yet.</div>
          )}
          {(history ?? []).map((h, i) => {
            const auto = h.provider === 'razorpayx';
            const pill =
              h.status === 'processing' ? { status: 'pending', label: 'Processing' }
              : h.status === 'failed' ? { status: 'failed', label: 'Failed' }
              : h.status === 'reversed' ? { status: 'refunded', label: 'Reversed' }
              : h.amount < 0 ? { status: 'refunded', label: 'Owed us' }
              : { status: 'paid', label: 'Paid' };
            const who = auto ? `Auto${h.method ? ` · ${h.method.toUpperCase()}` : ''}` : `by ${h.created_by_name || 'Admin'}`;
            return (
              <div key={h.id} style={css(`display:flex;align-items:center;gap:12px;padding:13px 20px;${i > 0 ? `border-top:1px solid ${T.border};` : ''}`)}>
                <Avatar name={h.boutique?.name ?? 'Boutique'} tone={h.boutique?.tone ?? 0} />
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{h.boutique?.name ?? 'Boutique'}</div>
                  <div style={css(`font-size:11.5px;color:${T.muted};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>
                    {h.orders_count} order{h.orders_count === 1 ? '' : 's'} · {new Date(h.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {who}
                    {h.status === 'failed' && h.failure_reason ? ` · ${h.failure_reason}` : ''}
                  </div>
                </div>
                <StatusPill status={pill.status} label={pill.label} />
                <div style={css(`font-size:14px;font-weight:800;min-width:90px;text-align:right;color:${h.amount < 0 ? 'var(--ag-bad-text)' : 'var(--ag-good-text)'};`)}>{money(h.amount)}</div>
              </div>
            );
          })}
        </Card>
      </div>

      {/* Breakdown drawer */}
      <Drawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? 'Payout'}
        footer={selected && (
          <GhostButton
            tone="primary"
            icon="payments"
            disabled={!payable(selected) || (needsReference(selected.net) && !note.trim())}
            onClick={() => setConfirm(selected)}
          >
            {selected.net < 0 ? `Record ${money(selected.net)}` : `Mark ${money(selected.net)} paid`}
          </GhostButton>
        )}
      >
        {selected && (
          <div style={css('display:flex;flex-direction:column;gap:20px;')}>
            <div style={css(`background:var(--ag-surface);border-radius:16px;padding:18px;text-align:center;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);`)}>
              <div style={css(`font-size:12px;font-weight:700;color:${T.muted};`)}>NET PAYABLE</div>
              <div style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:34px;margin-top:4px;color:${selected.net < 0 ? 'var(--ag-bad-text)' : 'var(--ag-good-text)'};`)}>{money(selected.net)}</div>
              {selected.net < 0 && <div style={css('font-size:12px;color:var(--ag-bad-text);font-weight:600;margin-top:4px;')}>Seller owes the platform</div>}
              {(() => {
                const clock = payoutClock(selected.oldestDeliveredAt, slaHours, now);
                if (!clock.dueAt) return null;
                return (
                  <div style={css(`margin-top:7px;font-size:12px;font-weight:700;color:${clock.overdue ? 'var(--ag-bad-text)' : T.muted};`)}>
                    {clock.overdue ? `Past the ${slaHours}h promise — ${clock.label}` : `${clock.label} · by ${clock.dueAt.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`}
                  </div>
                );
              })()}
            </div>

            {/* Held money, explained in the one place it will be questioned. */}
            {selected.heldOrders > 0 && (
              <Card style="padding:13px 16px;background:var(--ag-info-bg);">
                <div style={css('font-size:12.5px;font-weight:700;color:var(--ag-info-text);line-height:1.55;')}>
                  {fmtInr(selected.heldValue)} across {selected.heldOrders} paid order{selected.heldOrders === 1 ? '' : 's'} is held back —
                  those have not been delivered yet, so they are not part of this payout and cannot be settled. They appear here
                  automatically once delivery is recorded.
                </div>
              </Card>
            )}

            <div style={css('background:var(--ag-surface);border-radius:16px;padding:6px 16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
              <Field label="Settleable orders" value={selected.orders} />
              <Field label="Online sales" value={fmtInr(selected.prepaidGoods)} />
              <Field label={`Commission (${RATE_PCT}%)`} value={`− ${fmtInr(selected.prepaidCommission)}`} />
              <Field label="Online payout" value={<span style={css('color:var(--ag-good-text);')}>{fmtInr(selected.prepaidPayout)}</span>} />
              {selected.codGoods > 0 && <>
                <Field label="COD cash held by seller" value={fmtInr(selected.codGoods - selected.codPlatformDiscount)} />
                <Field label={`Commission owed (${RATE_PCT}%)`} value={`− ${fmtInr(selected.codCommission)}`} />
                <Field label="Delivery / COD fees owed" value={`− ${fmtInr(selected.codFees)}`} />
                {/* The seller honoured our coupon in cash they never received,
                    so we hand that back rather than settling them on it. */}
                {selected.codPlatformDiscount > 0 && (
                  <Field label="Platform coupons we fund" value={<span style={css('color:var(--ag-good-text);')}>+ {fmtInr(selected.codPlatformDiscount)}</span>} />
                )}
                <Field
                  label="COD adjustment"
                  value={
                    <span style={css(`color:${selected.codOwed >= 0 ? 'var(--ag-bad-text)' : 'var(--ag-good-text)'};`)}>
                      {selected.codOwed >= 0 ? '− ' : '+ '}{fmtInr(Math.abs(selected.codOwed))}
                    </span>
                  }
                />
              </>}
            </div>

            {/* What the money is actually for. The totals above are the summary
                arithmetic; this is the evidence behind it, and it is the same
                component the seller reads in their own console — so a query
                about a figure is answered from one set of lines, not two. */}
            <div>
              <div style={css('font-weight:800;font-size:13.5px;margin-bottom:8px;')}>
                Orders in this payout
                {lines && lines.length > 0 && <span style={css(`font-weight:600;color:${T.muted};`)}> · tap a row for the items</span>}
              </div>
              <PayoutStatement
                orders={lines ?? []}
                loading={linesLoading}
                emptyLabel="Breakdown unavailable — the totals above still stand."
              />
            </div>

            {selected.net > 0 && <TransferWorksheet dest={destOf(selected.boutique_id)} loaded={destsLoaded} amount={selected.net} name={selected.name} />}

            {needsReference(selected.net) && (
              <div>
                <div style={css('font-weight:800;font-size:13.5px;margin-bottom:8px;')}>
                  Bank reference / UTR <span style={css('color:var(--ag-bad-text);')}>*</span>
                </div>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. UTR 123456789012"
                  style={css(`width:100%;height:44px;border:1.5px solid ${T.field};border-radius:12px;padding:0 14px;font-size:13.5px;font-family:inherit;background:var(--ag-surface);box-sizing:border-box;`)}
                />
                <span style={css(`display:block;margin-top:6px;font-size:11.5px;font-weight:600;color:${T.muted};line-height:1.5;`)}>
                  Paste this from your bank after the transfer goes through. It is the only record tying this settlement to a real transaction.
                </span>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {/* Settle confirmation */}
      {confirm && (
        <ConfirmDialog
          open
          title={confirm.net < 0 ? 'Record settlement' : 'Confirm payout'}
          message={
            confirm.net < 0
              ? `Record that ${confirm.name} owes the platform ${money(-confirm.net)} across ${confirm.orders} order(s). This closes the current cycle for this boutique.`
              : `Confirm you have transferred ${money(confirm.net)} to ${confirm.name} for ${confirm.orders} order(s)${note.trim() ? ` (ref ${note.trim()})` : ''}. Once recorded these orders are marked settled and won't be paid again.`
          }
          confirmLabel={confirm.net < 0 ? 'Record' : 'Mark paid'}
          onConfirm={doSettle}
          onCancel={() => setConfirm(null)}
          busy={busy}
        />
      )}

      {/* Tell the seller ----------------------------------------------------
          Opens on its own the moment a settlement is recorded. */}
      <Drawer
        open={!!settled}
        onClose={() => setSettled(null)}
        title="Tell the seller"
      >
        {settled && (
          <SellerPayoutMessage
            payout={settled.record}
            boutiqueName={settled.name}
            dest={settled.dest}
            onDone={() => setSettled(null)}
          />
        )}
      </Drawer>

      {/* Batch settlement ---------------------------------------------------
          Deliberately NOT a single "pay all" button: each seller is a separate
          bank transfer with its own UTR, so this collects one reference per
          line and refuses to run until they are all present. */}
      <Drawer
        open={batchOpen}
        onClose={() => { if (!busy) setBatchOpen(false); }}
        title={`Record ${batchRows.length} payout${batchRows.length === 1 ? '' : 's'}`}
        footer={
          <GhostButton tone="primary" icon="task_alt" disabled={!batchReady || busy} onClick={doBatch}>
            {busy ? (batchProgress ?? 'Recording…') : `Record ${batchRows.length} · ${money(batchTotal)}`}
          </GhostButton>
        }
      >
        <div style={css('display:flex;flex-direction:column;gap:14px;')}>
          <div style={css(`font-size:12.5px;font-weight:600;color:${T.muted};line-height:1.6;`)}>
            Make each transfer in your bank first, then paste its reference here. Nothing is recorded until you press the button below, and each line is settled in turn.
            Every seller here is notified in the app automatically as their payout is recorded; email and WhatsApp are offered per seller when you settle one at a time.
          </div>
          {batchRows.map((r) => {
            const d = destOf(r.boutique_id);
            const need = needsReference(r.net);
            return (
              <div key={r.boutique_id} style={css(`background:var(--ag-surface);border:1px solid ${T.border};border-radius:14px;padding:13px 15px;`)}>
                <div style={css('display:flex;align-items:center;gap:10px;')}>
                  <Avatar name={r.name} tone={r.tone} />
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-size:13.5px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{r.name}</div>
                    <div style={css(`font-size:11.5px;font-weight:600;color:${T.muted};`)}>
                      {d?.accountNumber ? `A/c ${d.accountNumber} · ${d.ifsc ?? ''}` : r.net < 0 ? 'No transfer — recording dues' : 'No bank account'}
                    </div>
                  </div>
                  <span style={css(`font-size:14px;font-weight:800;color:${r.net < 0 ? 'var(--ag-bad-text)' : 'var(--ag-good-text)'};`)}>{money(r.net)}</span>
                </div>
                {need && (
                  <input
                    value={batchRefs[r.boutique_id] ?? ''}
                    onChange={(e) => setBatchRefs((m) => ({ ...m, [r.boutique_id]: e.target.value }))}
                    placeholder="Bank reference / UTR (required)"
                    style={css(`width:100%;margin-top:10px;height:40px;border:1.5px solid ${(batchRefs[r.boutique_id] ?? '').trim() ? T.field : 'var(--ag-bad-text)'};border-radius:11px;padding:0 12px;font-size:13px;font-family:inherit;background:var(--ag-surface);box-sizing:border-box;`)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </Drawer>
    </div>
  );
}

/**
 * The bank transfer, laid out to be executed rather than read.
 *
 * Order matches a typical net-banking payee form — name, account, IFSC, amount
 * — so an admin can work straight down it, and every value is copyable because
 * re-typing an account number is how manual payouts go wrong. The IFSC is
 * resolved to its actual bank and branch: with automatic penny-drop
 * verification switched off, this is the last check that the destination is a
 * real place before money leaves.
 */
function TransferWorksheet({ dest, loaded, amount, name }: { dest: PayoutDestination | null; loaded: boolean; amount: number; name: string }) {
  const ifscStatus = useIfscLookup(dest?.ifsc ?? '');
  const branch = ifscStatus.kind === 'valid'
    ? `${ifscStatus.bank}${ifscStatus.branch ? ` · ${ifscStatus.branch}` : ''}${ifscStatus.city ? `, ${ifscStatus.city}` : ''}`
    : ifscStatus.kind === 'invalid' ? 'No branch found for this IFSC — check before transferring'
    : undefined;

  if (!loaded) {
    return <div style={css(`padding:14px 0;color:${T.muted};font-size:13px;`)}>Loading payout details…</div>;
  }

  if (!dest?.hasBank) {
    return (
      <Card style="padding:16px 18px;background:var(--ag-warn-bg);">
        <div style={css('font-size:13px;font-weight:800;color:var(--ag-warn-text);')}>No bank account on file</div>
        <div style={css('margin-top:5px;font-size:12.5px;font-weight:600;color:var(--ag-warn-text);line-height:1.55;')}>
          {name} cannot be paid until they add an account number and IFSC. They are prompted on their dashboard every time they sign in.
          {dest?.upiId && <><br /><br />A legacy UPI ID is on file — <strong>{dest.upiId}</strong> — from before bank-only payouts. Use it only if you have agreed this with the seller.</>}
        </div>
      </Card>
    );
  }

  return (
    <div>
      <div style={css('font-weight:800;font-size:13.5px;margin-bottom:8px;')}>Transfer these details</div>
      <div style={css('background:var(--ag-surface);border-radius:16px;padding:2px 16px 8px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
        <CopyRow label="ACCOUNT NAME" value={dest.accountName} missing="Not provided — confirm with the seller" />
        <CopyRow label="ACCOUNT NO." value={dest.accountNumber} mono />
        <CopyRow label="IFSC" value={dest.ifsc} mono hint={branch} />
        {/* Plain digits, no ₹ or separators: pasted straight into an amount field. */}
        <CopyRow label="AMOUNT" value={amount.toFixed(2)} hint={`${money(amount)} — the figure to transfer`} />
      </div>
    </div>
  );
}
