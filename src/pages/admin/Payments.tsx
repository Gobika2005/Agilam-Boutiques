import { useState } from 'react';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { useShop } from '@/state/ShopContext';
import { useAsync } from '@/hooks/useAsync';
import { fetchPayoutSummaries, fetchPayoutHistory, settlePayout, PAYOUT_RATE, type PayoutSummary } from '@/data/payouts';
import { fetchBoutiquePrivate } from '@/data/boutiques';
import type { BoutiquePrivate } from '@/data/types';
import {
  T, Card, StatCard, DataTable, StatusPill, Avatar, GhostButton, ConfirmDialog, Drawer, Field, EmptyState,
  type Column,
} from '@/components/admin/kit';

/** Signed money: keeps a real minus for the "seller owes us" case. */
const money = (n: number) => (n < -0.005 ? '−' : '') + fmtInr(Math.abs(n));
const RATE_PCT = Math.round(PAYOUT_RATE * 100);

export function Payments() {
  const { showToast } = useShop();
  const { data: summaries, loading, reload } = useAsync(() => fetchPayoutSummaries(), []);
  const { data: history, loading: histLoading, reload: reloadHistory } = useAsync(() => fetchPayoutHistory(), []);

  const [selected, setSelected] = useState<PayoutSummary | null>(null);
  const [bank, setBank] = useState<BoutiquePrivate | null>(null);
  const [confirm, setConfirm] = useState<PayoutSummary | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  // Money out and money in are two different jobs. Sorting payables first (then
  // by size) stops a "seller owes us" row reading as a pending payment when the
  // only difference was a minus sign in the last column.
  const rows = [...(summaries ?? [])].sort((a, b) =>
    (a.net < 0 ? 1 : 0) - (b.net < 0 ? 1 : 0) || Math.abs(b.net) - Math.abs(a.net),
  );
  const totalPayable = rows.reduce((s, r) => s + Math.max(r.net, 0), 0);
  const totalOwedToUs = rows.reduce((s, r) => s + Math.max(-r.net, 0), 0);
  const unsettledCommission = rows.reduce((s, r) => s + r.prepaidCommission + r.codCommission, 0);

  const openDrawer = async (s: PayoutSummary) => {
    setSelected(s);
    setBank(null);
    try {
      setBank(await fetchBoutiquePrivate(s.boutique_id));
    } catch {
      /* bank details are a convenience here — absence never blocks a payout */
    }
  };

  const doSettle = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const rec = await settlePayout(confirm.boutique_id, note.trim() || undefined);
      showToast(
        rec.amount < 0
          ? `Recorded — ${confirm.name} owes ${money(-rec.amount)}`
          : `Paid ${money(rec.amount)} to ${confirm.name}`,
      );
      setConfirm(null);
      setSelected(null);
      setNote('');
      reload();
      reloadHistory();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not settle this payout');
    } finally {
      setBusy(false);
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
            <div style={css(`font-size:11.5px;color:${T.muted};font-weight:600;`)}>{r.orders} order{r.orders === 1 ? '' : 's'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'payout', header: 'ONLINE PAYOUT', width: '1fr', align: 'right',
      render: (r) => <span style={css('font-size:13px;font-weight:700;')}>{fmtInr(r.prepaidPayout)}</span>,
    },
    {
      key: 'cod', header: 'COD OWED', width: '1fr', align: 'right',
      render: (r) => <span style={css(`font-size:13px;font-weight:700;color:${r.codOwed > 0 ? 'var(--ag-bad-text)' : T.muted};`)}>{r.codOwed > 0 ? '−' + fmtInr(r.codOwed) : '—'}</span>,
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
      key: 'action', header: '', width: '140px', align: 'right',
      render: (r) => (
        <div style={css('display:flex;justify-content:flex-end;')} onClick={(e) => e.stopPropagation()}>
          {/* "Record" alone read as "record a payout" on rows where no money
              leaves the platform. Name the direction in the button. */}
          <GhostButton tone="primary" icon={r.net < 0 ? 'south_west' : 'payments'} onClick={() => { setNote(''); setConfirm(r); }}>
            {r.net < 0 ? 'Record dues' : 'Pay out'}
          </GhostButton>
        </div>
      ),
    },
  ];

  return (
    <div style={css('display:flex;flex-direction:column;gap:20px;')}>
      {/* Summary tiles */}
      <div className="agx-adm-stats" style={css('display:grid;grid-template-columns:repeat(3,1fr);gap:16px;')}>
        <StatCard label="Awaiting payout" value={fmtInr(totalPayable)} icon="account_balance_wallet" tint="var(--ag-good-bg)" ic="var(--ag-good-text)" sub={`${rows.filter((r) => r.net > 0).length} sellers`} />
        <StatCard label="Owed to platform (COD)" value={fmtInr(totalOwedToUs)} icon="south_west" tint="var(--ag-bad-bg)" ic="var(--ag-bad-text)" sub={`${rows.filter((r) => r.net < 0).length} sellers`} />
        <StatCard label={`Commission (${RATE_PCT}% incl. gateway + tax)`} value={fmtInr(unsettledCommission)} icon="percent" tint="var(--ag-warn-bg)" ic="var(--ag-warn-text)" sub="unsettled" />
      </div>

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
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          getId={(r) => r.boutique_id}
          onRowClick={openDrawer}
          empty={<EmptyState icon="task_alt" title="All settled" sub="No boutique has an outstanding balance right now." />}
        />
      </div>

      {/* Recent payouts */}
      <div>
        <div style={css('font-weight:800;font-size:15px;margin-bottom:12px;')}>Recent payouts</div>
        <Card style="padding:0;overflow:hidden;">
          {histLoading && <div style={css(`padding:20px;color:${T.muted};font-size:13.5px;`)}>Loading…</div>}
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
          <GhostButton tone="primary" icon="payments" onClick={() => setConfirm(selected)}>
            {selected.net < 0 ? `Record ${money(selected.net)}` : `Pay out ${money(selected.net)}`}
          </GhostButton>
        )}
      >
        {selected && (
          <div style={css('display:flex;flex-direction:column;gap:20px;')}>
            <div style={css(`background:var(--ag-surface);border-radius:16px;padding:18px;text-align:center;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);`)}>
              <div style={css(`font-size:12px;font-weight:700;color:${T.muted};`)}>NET PAYABLE</div>
              <div style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:34px;margin-top:4px;color:${selected.net < 0 ? 'var(--ag-bad-text)' : 'var(--ag-good-text)'};`)}>{money(selected.net)}</div>
              {selected.net < 0 && <div style={css('font-size:12px;color:var(--ag-bad-text);font-weight:600;margin-top:4px;')}>Seller owes the platform</div>}
            </div>

            <div style={css('background:var(--ag-surface);border-radius:16px;padding:6px 16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
              <Field label="Settleable orders" value={selected.orders} />
              <Field label="Online sales" value={fmtInr(selected.prepaidGoods)} />
              <Field label={`Commission (${RATE_PCT}%)`} value={`− ${fmtInr(selected.prepaidCommission)}`} />
              <Field label="Online payout" value={<span style={css('color:var(--ag-good-text);')}>{fmtInr(selected.prepaidPayout)}</span>} />
              {selected.codGoods > 0 && <>
                <Field label="COD cash held by seller" value={fmtInr(selected.codGoods)} />
                <Field label={`Commission owed (${RATE_PCT}%)`} value={`− ${fmtInr(selected.codCommission)}`} />
                <Field label="Delivery / COD fees owed" value={`− ${fmtInr(selected.codFees)}`} />
                <Field label="COD adjustment" value={<span style={css('color:var(--ag-bad-text);')}>− {fmtInr(selected.codOwed)}</span>} />
              </>}
            </div>

            <div>
              <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;')}>
                <div style={css('font-weight:800;font-size:13.5px;')}>Bank / UPI details</div>
                {bank && (() => {
                  const v = bank.payout_verification_status ?? 'unverified';
                  const meta =
                    v === 'verified' ? { status: 'approved', label: 'Verified' }
                    : v === 'pending' ? { status: 'pending', label: 'Verifying…' }
                    : v === 'failed' ? { status: 'failed', label: 'Verification failed' }
                    : { status: 'draft', label: 'Not verified' };
                  return <StatusPill status={meta.status} label={meta.label} />;
                })()}
              </div>
              <div style={css('background:var(--ag-surface);border-radius:16px;padding:6px 16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
                {!bank && <div style={css(`padding:14px 0;color:${T.muted};font-size:13px;`)}>Loading payout details…</div>}
                {bank && !bank.bank_account_number && !bank.upi_id && (
                  <div style={css(`padding:14px 0;color:${T.muted};font-size:13px;`)}>The seller has not added payout details yet.</div>
                )}
                {bank && bank.bank_account_name && <Field label="Account name" value={bank.bank_account_name} />}
                {bank && bank.bank_account_number && <Field label="Account no." value={bank.bank_account_number} />}
                {bank && bank.bank_ifsc && <Field label="IFSC" value={bank.bank_ifsc} />}
                {bank && bank.upi_id && <Field label="UPI" value={bank.upi_id} />}
              </div>
            </div>

            <div>
              <div style={css('font-weight:800;font-size:13.5px;margin-bottom:8px;')}>Reference (optional)</div>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Bank reference / UTR number"
                style={css(`width:100%;height:44px;border:1.5px solid ${T.field};border-radius:12px;padding:0 14px;font-size:13.5px;font-family:inherit;background:var(--ag-surface);box-sizing:border-box;`)}
              />
            </div>
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
              : `Pay ${money(confirm.net)} to ${confirm.name} for ${confirm.orders} order(s). Once recorded these orders are marked settled and won't be paid again.`
          }
          confirmLabel={confirm.net < 0 ? 'Record' : 'Mark paid'}
          onConfirm={doSettle}
          onCancel={() => setConfirm(null)}
          busy={busy}
        />
      )}
    </div>
  );
}
