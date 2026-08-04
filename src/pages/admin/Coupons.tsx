import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { useAsync } from '@/hooks/useAsync';
import {
  T, DataTable, EmptyState, GhostButton, IconButton, SearchInput, Select, StatusPill, Drawer, ConfirmDialog, type Column,
} from '@/components/admin/kit';
import { CouponFormFields } from '@/components/coupons/CouponFormFields';
import {
  fetchAllCoupons, createCoupon, updateCoupon, setCouponActive, deleteCoupon, type CouponRow, type CouponInput,
} from '@/data/coupons';
import {
  emptyCouponInput, couponInputFromRow, validateCouponInput, describeCoupon, type CouponFieldErrors,
} from '@/lib/couponForm';
import { isExpired } from '@/lib/pricing';

/**
 * Coupons — the admin console's view of every discount code on the marketplace.
 *
 * Admins create PLATFORM coupons here (boutique_id null, platform-funded, whole
 * cart). Seller coupons (created in the seller app, boutique-scoped and
 * seller-funded) are shown too so an admin can deactivate or remove any code, but
 * the seller owns their content. Pricing/eligibility maths live in
 * `@/lib/pricing`; this is CRUD only.
 */

const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

type Editing = { id: string | null; input: CouponInput; errors: CouponFieldErrors };

export function Coupons() {
  const { showToast } = useShop();
  const { boutiques } = useCatalog();
  const { data, loading, error, reload } = useAsync(() => fetchAllCoupons(), []);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<'all' | 'platform' | 'seller'>('all');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const boutiqueName = (id: string | null) => (id ? boutiques.find((b) => b.id === id)?.name ?? 'Boutique' : 'Platform');

  const rows = useMemo(() => {
    const all = data ?? [];
    const q = search.trim().toUpperCase();
    return all.filter((c) => {
      if (scope === 'platform' && c.boutique_id) return false;
      if (scope === 'seller' && !c.boutique_id) return false;
      if (q && !c.code.toUpperCase().includes(q) && !c.description.toUpperCase().includes(q)) return false;
      return true;
    });
  }, [data, search, scope]);

  const openNew = () => setEditing({ id: null, input: emptyCouponInput(null), errors: {} });
  const openEdit = (c: CouponRow) => setEditing({ id: c.id, input: couponInputFromRow(c), errors: {} });

  const patch = (p: Partial<CouponInput>) =>
    setEditing((e) => (e ? { ...e, input: { ...e.input, ...p }, errors: {} } : e));

  const save = async () => {
    if (!editing) return;
    const errors = validateCouponInput(editing.input, { allowShip: editing.input.boutique_id == null });
    if (Object.keys(errors).length) {
      setEditing({ ...editing, errors });
      return;
    }
    setBusy(true);
    try {
      if (editing.id) await updateCoupon(editing.id, editing.input);
      else await createCoupon(editing.input);
      showToast(editing.id ? 'Coupon updated' : 'Coupon created');
      setEditing(null);
      reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not save the coupon';
      // The one error a user can actually fix themselves is a duplicate code.
      showToast(/duplicate|unique/i.test(msg) ? 'That code is already taken — pick another' : msg);
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (c: CouponRow) => {
    try {
      await setCouponActive(c.id, !c.active);
      showToast(c.active ? 'Coupon deactivated' : 'Coupon activated');
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not update the coupon');
    }
  };

  const remove = async () => {
    if (!confirmId) return;
    setBusy(true);
    try {
      await deleteCoupon(confirmId);
      showToast('Coupon deleted');
      setConfirmId(null);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete the coupon');
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<CouponRow>[] = [
    {
      key: 'code',
      header: 'Code',
      width: '1.4fr',
      render: (c) => (
        <div style={css('min-width:0;')}>
          <div style={css("font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:13.5px;color:var(--ag-crimson);letter-spacing:.03em;")}>{c.code}</div>
          <div style={css('font-size:12px;color:var(--ag-muted);font-weight:600;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{c.description || '—'}</div>
        </div>
      ),
    },
    {
      key: 'scope',
      header: 'Scope',
      width: '1fr',
      render: (c) =>
        c.boutique_id
          ? <span style={css('font-size:12.5px;font-weight:700;color:#8A5A20;background:var(--ag-gold-bg);border-radius:8px;padding:3px 9px;')}>{boutiqueName(c.boutique_id)}</span>
          : <span style={css('font-size:12.5px;font-weight:700;color:var(--ag-info-text);background:var(--ag-info-bg);border-radius:8px;padding:3px 9px;')}>Platform</span>,
    },
    { key: 'discount', header: 'Discount', width: '1.4fr', render: (c) => <span style={css('font-size:13px;font-weight:700;color:var(--ag-ink);')}>{describeCoupon(c)}</span> },
    {
      // Redemptions were invisible: there was no way to tell a code used twice
      // from one used two thousand times, or to see a cap being approached.
      key: 'used', header: 'Used', width: '0.8fr',
      render: (c) => {
        const exhausted = c.usage_limit != null && c.used_count >= c.usage_limit;
        return (
          <span style={css(`font-size:12.5px;font-weight:700;color:${exhausted ? 'var(--ag-bad-text)' : 'var(--ag-label)'};`)}>
            {c.used_count}{c.usage_limit != null ? ` / ${c.usage_limit}` : ''}
            {c.usage_limit == null && <span style={css('font-weight:600;color:var(--ag-muted);')}> · no cap</span>}
          </span>
        );
      },
    },
    { key: 'expires', header: 'Expires', width: '0.9fr', render: (c) => <span style={css(`font-size:12.5px;font-weight:600;color:${isExpired(c) ? 'var(--ag-bad-text)' : 'var(--ag-label)'};`)}>{fmtDate(c.expires_at)}</span> },
    {
      key: 'status',
      header: 'Status',
      width: '0.8fr',
      render: (c) => {
        const exhausted = c.usage_limit != null && c.used_count >= c.usage_limit;
        if (exhausted) return <StatusPill status="expired" label="Used up" />;
        return <StatusPill status={isExpired(c) ? 'expired' : c.active ? 'active' : 'paused'} label={isExpired(c) ? 'Expired' : c.active ? 'Active' : 'Off'} />;
      },
    },
    {
      key: 'actions',
      header: '',
      width: '132px',
      align: 'right',
      render: (c) => (
        <div style={css('display:flex;gap:6px;justify-content:flex-end;')}>
          <IconButton icon="edit" title="Edit" onClick={() => openEdit(c)} />
          <IconButton icon={c.active ? 'toggle_on' : 'toggle_off'} tone={c.active ? 'success' : 'default'} title={c.active ? 'Deactivate' : 'Activate'} onClick={() => toggleActive(c)} />
          <IconButton icon="delete" tone="danger" title="Delete" onClick={() => setConfirmId(c.id)} />
        </div>
      ),
    },
  ];

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      <div style={css('display:flex;gap:10px;flex-wrap:wrap;align-items:center;')}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search code or description…" />
        <Select
          value={scope}
          onChange={(v) => setScope(v as 'all' | 'platform' | 'seller')}
          options={[
            { value: 'all', label: 'All coupons' },
            { value: 'platform', label: 'Platform' },
            { value: 'seller', label: 'Seller' },
          ]}
        />
        <div style={css('flex:1;')} />
        <GhostButton icon="add" tone="primary" onClick={openNew}>New platform coupon</GhostButton>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        getId={(c) => c.id}
        empty={
          // Distinguish "none exist" from "we couldn't read them". Migration
          // 0058 made this query 403 for every role, and because the table fell
          // back to the empty state the console reported an empty coupon list
          // rather than a failure. See 0059.
          error
            ? <EmptyState icon="error_outline" title="Couldn’t load coupons" sub={`The coupon list failed to load. ${error}`} />
            : <EmptyState icon="local_offer" title="No coupons yet" sub="Create a platform coupon, or wait for sellers to add their own." />
        }
      />

      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit coupon' : 'New platform coupon'}
        footer={
          <div style={css('display:flex;gap:10px;')}>
            <button onClick={() => setEditing(null)} disabled={busy} style={css(`flex:none;height:48px;padding:0 18px;border-radius:14px;border:1.5px solid ${T.field};background:var(--ag-surface);color:var(--ag-label);font-weight:700;font-size:14px;cursor:pointer;`)}>Cancel</button>
            <button onClick={save} disabled={busy} style={css(`flex:1;height:48px;border-radius:14px;border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14px;cursor:pointer;opacity:${busy ? 0.7 : 1};`)}>
              {busy ? 'Saving…' : editing?.id ? 'Save changes' : 'Create coupon'}
            </button>
          </div>
        }
      >
        {editing && (
          <>
            {editing.input.boutique_id && (
              <div style={css('margin-bottom:14px;padding:11px 13px;background:var(--ag-gold-bg);border:1px solid var(--ag-gold-border);border-radius:12px;font-size:12.5px;color:var(--ag-gold-text);font-weight:600;line-height:1.5;')}>
                Seller coupon for {boutiqueName(editing.input.boutique_id)} — the boutique funds this one.
              </div>
            )}
            <CouponFormFields
              input={editing.input}
              onChange={patch}
              errors={editing.errors}
              allowShip={editing.input.boutique_id == null}
            />
          </>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!confirmId}
        title="Delete coupon?"
        message="Buyers will no longer be able to use this code. This can't be undone."
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmId(null)}
      />
    </div>
  );
}
