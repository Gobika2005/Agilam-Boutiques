import { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { useAsync } from '@/hooks/useAsync';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { logAdminAction } from '@/data/activityLog';
import {
  EXPENSE_CATEGORIES, PAYMENT_METHODS, PROOF_BUCKET, EXPENSES_MIGRATION,
  categoryMeta, paymentLabel, emptyExpenseInput, expenseInputFromRow, validateExpenseInput,
  fetchExpenses, createExpense, updateExpense, deleteExpense,
  summariseExpenses, monthlyBars, availableMonths, monthLabel, monthKey, expensesToCsv,
  type ExpenseRow, type ExpenseInput, type ExpenseFieldErrors,
} from '@/data/expenses';
import { uploadPrivateFile, signedFileUrl, removePrivateFile, fileNameFromPath, isPdfPath } from '@/lib/privateUpload';
import {
  T, StatCard, Card, DataTable, EmptyState, GhostButton, IconButton, SearchInput, Select,
  Drawer, ConfirmDialog, Icon, type Column,
} from '@/components/admin/kit';

/**
 * Expenses — the outgoing half of the platform ledger.
 *
 * Every other money screen in the console (Overview, Reports, Payouts, Refunds)
 * measures what the marketplace takes in. This records what it spends, and
 * insists on the receipt: an entry with no proof is flagged on the row and
 * counted on a stat card, because an unverifiable expense is the one that
 * causes the argument at year end.
 *
 * Receipts live in a PRIVATE storage bucket (migration 0056) and are opened
 * through short-lived signed URLs — see `@/lib/privateUpload`.
 */

const compactInr = (n: number) =>
  n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'k' : fmtInr(n);

const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const label = 'font-size:12px;font-weight:800;color:var(--ag-label);margin-bottom:6px;display:block;letter-spacing:.01em;';
const input = `width:100%;height:46px;border:1.5px solid ${T.field};border-radius:12px;background:var(--ag-surface);padding:0 13px;font-size:14px;font-family:inherit;color:var(--ag-ink);`;
const errText = 'font-size:11.5px;font-weight:700;color:var(--ag-bad-text);margin-top:5px;';

type Editing = { id: string | null; input: ExpenseInput; errors: ExpenseFieldErrors };

export function Expenses() {
  const { showToast } = useShop();
  const { profile } = useAuth();
  const { data, loading, error, reload } = useAsync(() => fetchExpenses(), []);

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [month, setMonth] = useState('all');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [viewing, setViewing] = useState<ExpenseRow | null>(null);
  const [confirm, setConfirm] = useState<ExpenseRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const all = useMemo(() => data ?? [], [data]);
  const months = useMemo(() => availableMonths(all), [all]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (category !== 'all' && r.category !== category) return false;
      if (month !== 'all' && monthKey(r.spent_on) !== month) return false;
      if (q && ![r.title, r.vendor, r.reference, r.notes].some((f) => f.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [all, search, category, month]);

  // Cards describe the current filter, so narrowing to "Marketing, June" gives
  // that slice's totals rather than a headline that ignores the filters above it.
  const totals = useMemo(() => summariseExpenses(rows), [rows]);
  const bars = useMemo(() => monthlyBars(all), [all]);
  const filtered = category !== 'all' || month !== 'all' || search.trim() !== '';
  const momDelta = totals.lastMonth > 0 ? Math.round(((totals.thisMonth - totals.lastMonth) / totals.lastMonth) * 100) : null;

  const openNew = () => setEditing({ id: null, input: emptyExpenseInput(), errors: {} });
  const openEdit = (r: ExpenseRow) => setEditing({ id: r.id, input: expenseInputFromRow(r), errors: {} });
  const patch = (p: Partial<ExpenseInput>) => setEditing((e) => (e ? { ...e, input: { ...e.input, ...p }, errors: {} } : e));

  const pickProof = async (files: FileList) => {
    if (!editing) return;
    setUploading(true);
    try {
      const paths: string[] = [];
      for (const f of Array.from(files)) {
        paths.push(await uploadPrivateFile(PROOF_BUCKET, 'expenses', f, EXPENSES_MIGRATION));
      }
      setEditing((e) => (e ? { ...e, input: { ...e.input, proofs: [...e.input.proofs, ...paths] } } : e));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not upload the proof');
    } finally {
      setUploading(false);
    }
  };

  const dropProof = (path: string) => {
    setEditing((e) => (e ? { ...e, input: { ...e.input, proofs: e.input.proofs.filter((p) => p !== path) } } : e));
    // The row has not been saved with this path, so the object is already
    // orphaned — clean it up now rather than leaving it in the bucket forever.
    void removePrivateFile(PROOF_BUCKET, path);
  };

  const save = async () => {
    if (!editing) return;
    const errors = validateExpenseInput(editing.input);
    if (Object.keys(errors).length) {
      setEditing({ ...editing, errors });
      return;
    }
    setBusy(true);
    try {
      if (editing.id) await updateExpense(editing.id, editing.input);
      else await createExpense(editing.input, { id: profile?.id, name: profile?.full_name ?? 'Admin' });
      void logAdminAction({
        actor_id: profile?.id, actor_name: profile?.full_name ?? 'Admin',
        action: editing.id ? 'expense.update' : 'expense.create',
        entity_type: 'expense', entity_id: editing.id,
        meta: { title: editing.input.title, amount: editing.input.amount, category: editing.input.category, proofs: editing.input.proofs.length },
      });
      showToast(editing.id ? 'Expense updated' : 'Expense recorded');
      setEditing(null);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save the expense');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await deleteExpense(confirm);
      void logAdminAction({
        actor_id: profile?.id, actor_name: profile?.full_name ?? 'Admin',
        action: 'expense.delete', entity_type: 'expense', entity_id: confirm.id,
        meta: { title: confirm.title, amount: confirm.amount },
      });
      showToast('Expense deleted');
      setConfirm(null);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete the expense');
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const csv = expensesToCsv(rows);
    // Leading BOM so Excel reads ₹ and Tamil vendor names as UTF-8.
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `mangaimart-expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns: Column<ExpenseRow>[] = [
    {
      key: 'what', header: 'EXPENSE', width: '2.2fr',
      render: (r) => {
        const meta = categoryMeta(r.category);
        return (
          <div style={css('display:flex;align-items:center;gap:11px;min-width:0;')}>
            <div style={css('width:36px;height:36px;flex:none;border-radius:11px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
              <Icon name={meta.icon} size={19} color="var(--ag-crimson)" />
            </div>
            <div style={css('min-width:0;')}>
              <div style={css('font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{r.title}</div>
              <div style={css(`font-size:11.5px;color:${T.muted};font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>
                {meta.label}{r.vendor ? ` · ${r.vendor}` : ''}
              </div>
            </div>
          </div>
        );
      },
    },
    { key: 'date', header: 'PAID ON', width: '1fr', render: (r) => <span style={css('font-size:12.5px;font-weight:600;')}>{fmtDate(r.spent_on)}</span> },
    {
      key: 'method', header: 'METHOD', width: '1fr',
      render: (r) => (
        <div style={css('min-width:0;')}>
          <div style={css('font-size:12.5px;font-weight:700;')}>{paymentLabel(r.payment_method)}</div>
          {r.reference && <div style={css(`font-size:11px;color:${T.muted};font-family:'IBM Plex Mono',monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>{r.reference}</div>}
        </div>
      ),
    },
    {
      // The whole point of the screen: is this claim backed by a document?
      key: 'proof', header: 'PROOF', width: '120px',
      render: (r) => (
        <div onClick={(e) => e.stopPropagation()}>
          {r.proofs.length === 0 ? (
            <span style={css('font-size:11px;font-weight:800;padding:4px 9px;border-radius:8px;background:var(--ag-warn-bg);color:var(--ag-warn-text);white-space:nowrap;')}>No proof</span>
          ) : (
            <button
              type="button"
              onClick={() => setViewing(r)}
              style={css(`display:flex;align-items:center;gap:5px;border:1.5px solid ${T.field};background:var(--ag-surface);border-radius:9px;padding:4px 9px;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:800;color:var(--ag-crimson);`)}
            >
              <Icon name="receipt_long" size={15} />
              {r.proofs.length > 1 ? `${r.proofs.length} files` : 'View'}
            </button>
          )}
        </div>
      ),
    },
    { key: 'amount', header: 'AMOUNT', width: '120px', align: 'right', render: (r) => <span style={css('font-weight:800;font-size:13.5px;')}>{fmtInr(r.amount)}</span> },
    {
      key: 'act', header: '', width: '92px', align: 'right',
      render: (r) => (
        <div style={css('display:flex;gap:6px;justify-content:flex-end;')} onClick={(e) => e.stopPropagation()}>
          <IconButton icon="edit" title="Edit" onClick={() => openEdit(r)} />
          <IconButton icon="delete" tone="danger" title="Delete" onClick={() => setConfirm(r)} />
        </div>
      ),
    },
  ];

  // A missing migration is a set-up problem with a specific fix, not a crash.
  if (error) {
    return (
      <Card>
        <EmptyState
          icon="savings"
          title="Expense tracking isn't set up yet"
          sub={`Apply migration ${EXPENSES_MIGRATION} in the Supabase SQL editor, then reload. (${error})`}
        />
      </Card>
    );
  }

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      <div className="agx-adm-g4">
        <StatCard
          label={filtered ? 'Spend (filtered)' : 'Spend this month'}
          value={compactInr(filtered ? totals.total : totals.thisMonth)}
          icon="payments" tint="var(--ag-surface-2)" ic="#D6336C"
          sub={!filtered && momDelta !== null ? `${momDelta >= 0 ? '+' : ''}${momDelta}% vs last month` : undefined}
          bars={filtered ? undefined : bars}
        />
        <StatCard label="Last month" value={compactInr(totals.lastMonth)} icon="calendar_month" tint="var(--ag-info-bg)" ic="var(--ag-info-text)" />
        <StatCard label={filtered ? 'Entries shown' : 'Total recorded'} value={filtered ? String(totals.count) : compactInr(totals.total)} icon="receipt_long" tint="var(--ag-good-bg)" ic="var(--ag-good-text)" sub={filtered ? undefined : `${totals.count} entries`} />
        <StatCard
          label="Missing proof"
          value={String(totals.missingProof)}
          icon="warning" tint="var(--ag-warn-bg)" ic="var(--ag-gold-text)"
          sub={totals.missingProof ? 'attach receipts' : 'all backed up'}
        />
      </div>

      <div style={css('display:flex;gap:10px;flex-wrap:wrap;align-items:center;')}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search what for, vendor or reference…" />
        <Select
          value={category}
          onChange={setCategory}
          options={[{ value: 'all', label: 'All categories' }, ...EXPENSE_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))]}
        />
        <Select
          value={month}
          onChange={setMonth}
          options={[{ value: 'all', label: 'All time' }, ...months.map((m) => ({ value: m, label: monthLabel(m) }))]}
        />
        <div style={css('flex:1;')} />
        <GhostButton icon="download" onClick={exportCsv}>Export</GhostButton>
        <GhostButton icon="add" tone="primary" onClick={openNew}>Record expense</GhostButton>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        getId={(r) => r.id}
        onRowClick={openEdit}
        empty={<EmptyState icon="savings" title={all.length ? 'Nothing matches those filters' : 'No expenses recorded yet'} sub={all.length ? 'Try a wider category or period.' : 'Record what the platform spends — ads, salaries, hosting — and attach the receipt.'} />}
      />

      {/* Where the money went, for the period on screen. Only worth drawing
          once there is more than one category to compare. */}
      {totals.byCategory.length > 1 && (
        <Card>
          <div style={css('font-weight:800;font-size:15px;margin-bottom:14px;')}>Where it went{filtered ? ' (filtered)' : ''}</div>
          <div style={css('display:flex;flex-direction:column;gap:11px;')}>
            {totals.byCategory.slice(0, 8).map((c) => (
              <div key={c.value}>
                <div style={css('display:flex;justify-content:space-between;gap:12px;font-size:12.5px;font-weight:700;margin-bottom:5px;')}>
                  <span style={css('display:flex;align-items:center;gap:7px;min-width:0;')}>
                    <Icon name={categoryMeta(c.value).icon} size={16} color="var(--ag-muted)" />
                    <span style={css('overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{c.label}</span>
                  </span>
                  <span style={css('flex:none;')}>{fmtInr(c.amount)} <span style={css(`color:${T.muted};font-weight:600;`)}>· {Math.round(c.pct)}%</span></span>
                </div>
                <div style={css('height:8px;border-radius:99px;background:var(--ag-surface-2);overflow:hidden;')}>
                  <div style={css(`height:100%;width:${Math.max(2, c.pct)}%;border-radius:99px;background:linear-gradient(90deg,#E7719F,#D6336C);`)} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit expense' : 'Record an expense'}
        footer={
          <div style={css('display:flex;gap:10px;')}>
            <button onClick={() => setEditing(null)} disabled={busy} style={css(`flex:none;height:48px;padding:0 18px;border-radius:14px;border:1.5px solid ${T.field};background:var(--ag-surface);color:var(--ag-label);font-weight:700;font-size:14px;cursor:pointer;`)}>Cancel</button>
            <button onClick={save} disabled={busy || uploading} style={css(`flex:1;height:48px;border-radius:14px;border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14px;cursor:pointer;opacity:${busy || uploading ? 0.7 : 1};`)}>
              {busy ? 'Saving…' : uploading ? 'Uploading…' : editing?.id ? 'Save changes' : 'Record expense'}
            </button>
          </div>
        }
      >
        {editing && (
          <div style={css('display:flex;flex-direction:column;gap:16px;')}>
            <div>
              <span style={css(label)}>What was it for</span>
              <input
                value={editing.input.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="e.g. Instagram ads — June campaign"
                style={css(input + (editing.errors.title ? 'border-color:var(--ag-bad-text);' : ''))}
              />
              {editing.errors.title && <div style={css(errText)}>{editing.errors.title}</div>}
            </div>

            <div style={css('display:flex;gap:12px;flex-wrap:wrap;')}>
              <div style={css('flex:1;min-width:150px;')}>
                <span style={css(label)}>Amount (₹)</span>
                <input
                  type="number" min="0" step="0.01" inputMode="decimal"
                  value={editing.input.amount || ''}
                  onChange={(e) => patch({ amount: Number(e.target.value) })}
                  placeholder="0"
                  style={css(input + (editing.errors.amount ? 'border-color:var(--ag-bad-text);' : ''))}
                />
                {editing.errors.amount && <div style={css(errText)}>{editing.errors.amount}</div>}
              </div>
              <div style={css('flex:1;min-width:150px;')}>
                <span style={css(label)}>Paid on</span>
                <input
                  type="date"
                  value={editing.input.spent_on}
                  onChange={(e) => patch({ spent_on: e.target.value })}
                  style={css(input + (editing.errors.spent_on ? 'border-color:var(--ag-bad-text);' : ''))}
                />
                {editing.errors.spent_on && <div style={css(errText)}>{editing.errors.spent_on}</div>}
              </div>
            </div>

            <div style={css('display:flex;gap:12px;flex-wrap:wrap;')}>
              <div style={css('flex:1;min-width:150px;')}>
                <span style={css(label)}>Category</span>
                <select value={editing.input.category} onChange={(e) => patch({ category: e.target.value })} style={css(input + 'cursor:pointer;font-weight:700;')}>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              <div style={css('flex:1;min-width:150px;')}>
                <span style={css(label)}>Paid by</span>
                <select value={editing.input.payment_method} onChange={(e) => patch({ payment_method: e.target.value })} style={css(input + 'cursor:pointer;font-weight:700;')}>
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>

            <div style={css('display:flex;gap:12px;flex-wrap:wrap;')}>
              <div style={css('flex:1;min-width:150px;')}>
                <span style={css(label)}>Paid to</span>
                <input value={editing.input.vendor} onChange={(e) => patch({ vendor: e.target.value })} placeholder="Vendor or person" style={css(input)} />
              </div>
              <div style={css('flex:1;min-width:150px;')}>
                <span style={css(label)}>Reference</span>
                <input value={editing.input.reference} onChange={(e) => patch({ reference: e.target.value })} placeholder="Invoice / UTR no." style={css(input)} />
              </div>
            </div>

            {/* Proof — images or PDFs, straight into the private bucket. */}
            <div>
              <span style={css(label)}>Proof of payment</span>
              <input
                ref={fileInput} type="file" accept="image/*,application/pdf" multiple style={css('display:none;')}
                onChange={(e) => { const f = e.target.files; if (f?.length) void pickProof(f); e.target.value = ''; }}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                style={css(`width:100%;height:48px;border-radius:12px;border:1.5px dashed #D9A9BE;background:var(--ag-surface-2);color:var(--ag-crimson);font-weight:800;font-size:13px;cursor:${uploading ? 'wait' : 'pointer'};display:flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;`)}
              >
                <Icon name={uploading ? 'progress_activity' : 'upload_file'} size={19} />
                {uploading ? 'Uploading…' : editing.input.proofs.length ? 'Add another receipt' : 'Upload receipt or invoice'}
              </button>
              <div style={css(`font-size:11.5px;color:${T.muted};font-weight:600;margin-top:7px;line-height:1.5;`)}>
                JPG, PNG or PDF up to 10 MB. Receipts are stored privately — only signed-in admins can open them.
              </div>
              {editing.input.proofs.length > 0 && (
                <div style={css('display:flex;flex-direction:column;gap:8px;margin-top:11px;')}>
                  {editing.input.proofs.map((p) => (
                    <div key={p} style={css(`display:flex;align-items:center;gap:10px;border:1.5px solid ${T.field};border-radius:12px;padding:9px 11px;`)}>
                      <Icon name={isPdfPath(p) ? 'picture_as_pdf' : 'image'} size={19} color="var(--ag-crimson)" />
                      <span style={css('flex:1;min-width:0;font-size:12.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{fileNameFromPath(p)}</span>
                      <IconButton icon="close" tone="danger" title="Remove" onClick={() => dropProof(p)} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <span style={css(label)}>Notes</span>
              <textarea
                value={editing.input.notes}
                onChange={(e) => patch({ notes: e.target.value })}
                rows={3}
                placeholder="Anything the books should remember about this spend"
                style={css(input + 'height:auto;padding:12px 13px;resize:vertical;line-height:1.5;')}
              />
            </div>

            {editing.id && (
              <div style={css(`font-size:11.5px;color:${T.muted};font-weight:600;`)}>
                Edits are recorded in the audit trail.
              </div>
            )}
          </div>
        )}
      </Drawer>

      <ProofViewer row={viewing} onClose={() => setViewing(null)} />

      <ConfirmDialog
        open={!!confirm}
        title="Delete this expense?"
        message={confirm ? `${confirm.title} · ${fmtInr(confirm.amount)}. The entry and its receipts are removed for good.` : ''}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

/**
 * Opens an expense's receipts.
 *
 * The bucket is private, so each file needs a freshly signed URL — minted when
 * the dialog opens rather than per row, which would have signed a URL for every
 * receipt in the table on every load.
 */
function ProofViewer({ row, onClose }: { row: ExpenseRow | null; onClose: () => void }) {
  const [links, setLinks] = useState<{ path: string; url: string | null }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!row) { setLinks([]); return; }
    let cancelled = false;
    setLoading(true);
    void Promise.all(row.proofs.map(async (path) => ({ path, url: await signedFileUrl(PROOF_BUCKET, path) })))
      .then((res) => { if (!cancelled) { setLinks(res); setLoading(false); } });
    return () => { cancelled = true; };
  }, [row]);

  useEffect(() => {
    if (!row) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [row, onClose]);

  if (!row) return null;

  return (
    <div onClick={onClose} style={css('position:fixed;inset:0;background:rgba(42,26,32,.55);z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;')}>
      <div onClick={(e) => e.stopPropagation()} className="agx-scroll" style={css('width:560px;max-width:100%;max-height:88vh;overflow-y:auto;background:var(--ag-surface);border-radius:20px;padding:22px;box-shadow:0 30px 70px -30px rgba(107,20,54,.7);')}>
        <div style={css('display:flex;align-items:flex-start;justify-content:space-between;gap:12px;')}>
          <div style={css('min-width:0;')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:21px;")}>{row.title}</div>
            <div style={css(`color:${T.muted};font-size:12.5px;font-weight:600;margin-top:3px;`)}>
              {fmtInr(row.amount)} · {fmtDate(row.spent_on)} · {paymentLabel(row.payment_method)}
              {row.created_by_name ? ` · filed by ${row.created_by_name}` : ''}
            </div>
          </div>
          <IconButton icon="close" title="Close" onClick={onClose} />
        </div>

        {row.notes && <div style={css(`margin-top:14px;font-size:13px;color:${T.muted};line-height:1.55;`)}>{row.notes}</div>}

        <div style={css('display:flex;flex-direction:column;gap:12px;margin-top:16px;')}>
          {loading && <div style={css(`font-size:13px;color:${T.muted};font-weight:600;`)}>Opening receipts…</div>}
          {!loading && links.map(({ path, url }) => (
            <div key={path} style={css(`border:1.5px solid ${T.border};border-radius:14px;overflow:hidden;`)}>
              {url && !isPdfPath(path) && (
                <img src={url} alt="Proof of payment" style={css('display:block;width:100%;max-height:420px;object-fit:contain;background:var(--ag-surface-2);')} />
              )}
              <div style={css('display:flex;align-items:center;gap:10px;padding:10px 12px;')}>
                <Icon name={isPdfPath(path) ? 'picture_as_pdf' : 'image'} size={19} color="var(--ag-crimson)" />
                <span style={css('flex:1;min-width:0;font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{fileNameFromPath(path)}</span>
                {url ? (
                  <a href={url} target="_blank" rel="noreferrer" style={css('font-size:12px;font-weight:800;color:var(--ag-crimson);text-decoration:none;white-space:nowrap;')}>Open ↗</a>
                ) : (
                  <span style={css(`font-size:12px;font-weight:700;color:${T.muted};`)}>Unavailable</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
