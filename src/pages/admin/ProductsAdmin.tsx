import { useMemo, useState, type ReactNode } from 'react';
import { css } from '@/lib/css';
import { errMessage } from '@/lib/errMessage';
import { fmtInr } from '@/lib/tokens';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { useDebounced } from '@/hooks/useDebounced';
import { logAdminAction } from '@/data/activityLog';
import {
  fetchProductsAdmin, setProductStatus, bulkSetProductStatus, setProductFeatured,
  softDeleteProduct, bulkSoftDeleteProducts, restoreProduct, updateProduct,
  type AdminProductRow, type ProductStatus, type UpdateProductInput,
} from '@/data/adminProducts';
import {
  DataTable, SearchInput, Select, IconButton, StatusPill, Avatar, Pagination,
  BulkBar, GhostButton, ConfirmDialog, Drawer, Icon, EmptyState, T, type Column,
} from '@/components/admin/kit';
import { useSeededSearch } from '@/hooks/useSeededSearch';

const PAGE_SIZE = 12;
const STATUS_OPTS: { value: ProductStatus; label: string }[] = [
  { value: 'active', label: 'Active' }, { value: 'pending', label: 'Pending' }, { value: 'hidden', label: 'Hidden' }, { value: 'rejected', label: 'Rejected' },
];

export function ProductsAdmin() {
  const { showToast } = useShop();
  const { profile } = useAuth();
  const [page, setPage] = useState(0);
  const [rawSearch, setRawSearch] = useSeededSearch();
  const search = useDebounced(rawSearch, 300);
  const [status, setStatus] = useState<'all' | ProductStatus | 'deleted'>('all');
  const [lowStock, setLowStock] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<AdminProductRow | 'bulk' | null>(null);
  const [busy, setBusy] = useState(false);
  const [editProduct, setEditProduct] = useState<AdminProductRow | null>(null);
  const [editData, setEditData] = useState<UpdateProductInput>({ title: '', category: '', price: 0, stock: 0, status: 'active' });

  const openEdit = (p: AdminProductRow) => {
    setEditData({ title: p.title, category: p.category, price: p.price, stock: p.stock, status: p.status });
    setEditProduct(p);
  };

  const doUpdate = async () => {
    if (!editProduct) return;
    if (!editData.title.trim()) { showToast('Title is required'); return; }
    setBusy(true);
    try {
      await updateProduct(editProduct.id, { ...editData, price: Number(editData.price) || 0, stock: Number(editData.stock) || 0 });
      await log('product.update', editProduct.id, { title: editData.title });
      showToast(`${editData.title} updated`);
      setEditProduct(null);
      reload();
    } catch (e) { showToast(errMessage(e, 'Update failed')); }
    finally { setBusy(false); }
  };

  const q = useMemo(() => ({ page, pageSize: PAGE_SIZE, search, status, lowStock }), [page, search, status, lowStock]);
  const { data, loading, reload } = useAsync(() => fetchProductsAdmin(q), [q]);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  // Rejecting asks WHY before it writes (migration 0092). The reason reaches the
  // seller in their console and in the seller_product_rejected WhatsApp message,
  // so refusing without one just moves the conversation to support.
  const [rejecting, setRejecting] = useState<{ rows: AdminProductRow[]; bulk: boolean } | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const changeFilter = (fn: () => void) => { fn(); setPage(0); setSelected(new Set()); };
  const log = (action: string, entity_id: string, meta?: Record<string, unknown>) =>
    logAdminAction({ actor_id: profile?.id, actor_name: profile?.full_name ?? 'Admin', action, entity_type: 'product', entity_id, meta });

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected((s) => s.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)));

  const changeStatus = async (p: AdminProductRow, next: ProductStatus) => {
    if (next === 'rejected') { setRejectNote(''); setRejecting({ rows: [p], bulk: false }); return; }
    try {
      await setProductStatus(p.id, next);
      await log(`product.${next}`, p.id, { title: p.title });
      showToast(`${p.title} → ${next}`);
      reload();
    } catch (e) { showToast(errMessage(e, 'Update failed')); }
  };

  const toggleFeatured = async (p: AdminProductRow) => {
    try {
      await setProductFeatured(p.id, !p.featured);
      await log(p.featured ? 'product.unfeature' : 'product.feature', p.id, { title: p.title });
      showToast(`${p.title} ${p.featured ? 'unfeatured' : 'featured'}`);
      reload();
    } catch (e) { showToast(errMessage(e, 'Update failed')); }
  };

  const doReject = async () => {
    if (!rejecting) return;
    const note = rejectNote.trim() || null;
    const ids = rejecting.rows.map((r) => r.id);
    setBusy(true);
    try {
      if (rejecting.bulk) {
        await bulkSetProductStatus(ids, 'rejected', note);
        await log('product.bulk_rejected', ids.join(','), { count: ids.length, note });
        showToast(`${ids.length} listings rejected`);
        setSelected(new Set());
      } else {
        await setProductStatus(ids[0], 'rejected', note);
        await log('product.rejected', ids[0], { title: rejecting.rows[0]?.title, note });
        showToast(`${rejecting.rows[0]?.title} rejected`);
      }
      setRejecting(null);
      reload();
    } catch (e) { showToast(errMessage(e, 'Update failed')); }
    finally { setBusy(false); }
  };

  const bulk = async (next: ProductStatus) => {
    const ids = [...selected];
    if (next === 'rejected') {
      setRejectNote('');
      setRejecting({ rows: rows.filter((r) => selected.has(r.id)), bulk: true });
      return;
    }
    try {
      await bulkSetProductStatus(ids, next);
      await log(`product.bulk_${next}`, ids.join(','), { count: ids.length });
      showToast(`${ids.length} products → ${next}`);
      setSelected(new Set());
      reload();
    } catch (e) { showToast(errMessage(e, 'Bulk update failed')); }
  };

  const doDelete = async () => {
    setBusy(true);
    try {
      if (confirmDelete === 'bulk') {
        const ids = [...selected];
        await bulkSoftDeleteProducts(ids);
        await log('product.bulk_delete', ids.join(','), { count: ids.length });
        showToast(`${ids.length} products removed`);
        setSelected(new Set());
      } else if (confirmDelete) {
        await softDeleteProduct(confirmDelete.id);
        await log('product.delete', confirmDelete.id, { title: confirmDelete.title });
        showToast(`${confirmDelete.title} removed`);
      }
      setConfirmDelete(null);
      reload();
    } catch (e) { showToast(errMessage(e, 'Delete failed')); }
    finally { setBusy(false); }
  };

  const restore = async (p: AdminProductRow) => {
    try {
      await restoreProduct(p.id);
      await log('product.restore', p.id, { title: p.title });
      showToast(`${p.title} restored`);
      reload();
    } catch (e) { showToast(errMessage(e, 'Restore failed')); }
  };

  const columns: Column<AdminProductRow>[] = [
    {
      key: 'product', header: 'PRODUCT', width: '2.4fr',
      render: (p) => (
        <div style={css('display:flex;align-items:center;gap:10px;min-width:0;')}>
          {p.image_url
            ? <img src={p.image_url} alt="" style={css('width:38px;height:38px;flex:none;border-radius:10px;object-fit:cover;')} />
            : <Avatar name={p.title} tone={p.tone} />}
          <div style={css('min-width:0;')}>
            <div style={css('font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{p.title}{p.featured && ' ⭐'}</div>
            <div style={css(`font-size:11.5px;color:${T.muted};`)}>{p.boutique?.name ?? '—'} · {p.category}</div>
          </div>
        </div>
      ),
    },
    { key: 'price', header: 'PRICE', width: '1fr', render: (p) => <span style={css('font-size:13px;font-weight:700;')}>{fmtInr(p.price)}</span> },
    {
      key: 'stock', header: 'STOCK', width: '.9fr',
      render: (p) => <span style={css(`font-size:13px;font-weight:700;color:${p.stock === 0 ? 'var(--ag-danger-text)' : p.stock <= 5 ? 'var(--ag-gold-text)' : 'var(--ag-label)'};`)}>{p.stock}</span>,
    },
    { key: 'status', header: 'STATUS', width: '1fr', render: (p) => <StatusPill status={p.deleted_at ? 'rejected' : p.status} label={p.deleted_at ? 'Deleted' : undefined} /> },
    {
      key: 'actions', header: 'ACTIONS', width: '2.3fr', align: 'right',
      render: (p) => (
        <div style={css('display:flex;gap:8px;justify-content:flex-end;align-items:center;')} onClick={(e) => e.stopPropagation()}>
          {p.deleted_at ? (
            <IconButton icon="restore_from_trash" tone="success" title="Restore" onClick={() => restore(p)} />
          ) : (
            <>
              <select value={p.status} onChange={(e) => changeStatus(p, e.target.value as ProductStatus)} style={css(`height:34px;border:1.5px solid ${T.field};border-radius:10px;background:var(--ag-bg);font-size:12px;font-weight:700;color:var(--ag-label);padding:0 6px;cursor:pointer;font-family:inherit;`)}>
                {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <IconButton icon="edit" title="Edit" onClick={() => openEdit(p)} />
              <IconButton icon={p.featured ? 'star' : 'star_outline'} tone="warn" title={p.featured ? 'Unfeature' : 'Feature'} onClick={() => toggleFeatured(p)} />
              <IconButton icon="delete" tone="danger" title="Delete" onClick={() => setConfirmDelete(p)} />
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="agx-adm-toolbar" style={css('display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;')}>
        <SearchInput value={rawSearch} onChange={(v) => changeFilter(() => setRawSearch(v))} placeholder="Search products, categories…" />
        <Select value={status} onChange={(v) => changeFilter(() => setStatus(v as typeof status))} options={[
          { value: 'all', label: 'All statuses' }, ...STATUS_OPTS, { value: 'deleted', label: 'Deleted' },
        ]} />
        <GhostButton icon={lowStock ? 'filter_alt' : 'filter_alt_off'} tone={lowStock ? 'primary' : 'default'} onClick={() => changeFilter(() => setLowStock(!lowStock))}>Low stock</GhostButton>
      </div>

      <BulkBar count={selected.size}>
        <button onClick={() => bulk('active')} style={bulkBtn('var(--ag-good-text)')}>Approve</button>
        <button onClick={() => bulk('hidden')} style={bulkBtn('var(--ag-muted)')}>Hide</button>
        <button onClick={() => setConfirmDelete('bulk')} style={bulkBtn('var(--ag-danger-text)')}>Delete</button>
      </BulkBar>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        getId={(p) => p.id}
        selectable
        selectedIds={selected}
        onToggle={toggle}
        onToggleAll={toggleAll}
        empty={<EmptyState icon="local_mall" title="No products found" sub="Try a different search or filter." />}
      />
      {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}

      <ConfirmDialog
        open={!!confirmDelete}
        title={confirmDelete === 'bulk' ? 'Delete selected products?' : 'Delete product?'}
        message={confirmDelete === 'bulk' ? `${selected.size} products will be soft-deleted and hidden from buyers. They can be restored later.` : `${typeof confirmDelete === 'object' && confirmDelete ? confirmDelete.title : ''} will be soft-deleted and hidden from buyers. It can be restored later.`}
        confirmLabel="Delete" danger busy={busy}
        onConfirm={doDelete} onCancel={() => setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={!!rejecting}
        title={rejecting?.bulk ? 'Reject selected listings?' : 'Reject this listing?'}
        message={
          rejecting?.bulk
            ? `${rejecting.rows.length} listings will be hidden from buyers, and each seller is told why.`
            : `${rejecting?.rows[0]?.title ?? ''} will be hidden from buyers, and the seller is told why.`
        }
        confirmLabel="Reject" danger busy={busy}
        onConfirm={doReject}
        onCancel={() => setRejecting(null)}
      >
        <label style={css(`display:block;margin-top:14px;font-size:12px;font-weight:800;color:${T.muted};`)}>
          Reason the seller will see
          <textarea
            rows={3}
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="e.g. The photos show a different colour to the one listed."
            style={css(`display:block;width:100%;margin-top:6px;border:1.5px solid ${T.field};border-radius:12px;background:var(--ag-surface);font-size:13.5px;font-family:inherit;color:var(--ag-ink);padding:10px 12px;box-sizing:border-box;resize:vertical;line-height:1.5;`)}
          />
        </label>
        {/* Optional on purpose: a moderator clearing an obvious spam listing at
            speed should not be blocked. Left blank, the seller is asked to open
            their console instead of being quoted an empty reason. */}
        <div style={css(`font-size:11.5px;color:${T.muted};margin-top:6px;line-height:1.5;`)}>
          Sent to the seller on WhatsApp and shown in their console. Leave blank and they
          are asked to check their console instead.
        </div>
      </ConfirmDialog>

      <Drawer
        open={!!editProduct}
        onClose={() => setEditProduct(null)}
        title="Edit Product"
        footer={(
          <div style={css('display:flex;gap:10px;')}>
            <GhostButton onClick={() => setEditProduct(null)}>Cancel</GhostButton>
            <button
              type="submit"
              form="admin-edit-product-form"
              disabled={busy}
              style={css(`height:42px;border:none;border-radius:12px;padding:0 14px;font-weight:700;font-size:13px;cursor:${busy ? 'not-allowed' : 'pointer'};display:flex;align-items:center;gap:6px;font-family:inherit;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;opacity:${busy ? 0.7 : 1};`)}
            >
              <Icon name="save" size={18} />
              {busy ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      >
        {editProduct && (
          <form
            id="admin-edit-product-form"
            onSubmit={(e) => { e.preventDefault(); void doUpdate(); }}
            style={css('display:flex;flex-direction:column;gap:14px;')}
          >
            <div style={css(`display:flex;align-items:center;gap:12px;background:var(--ag-surface);border-radius:14px;padding:12px 14px;`)}>
              {editProduct.image_url
                ? <img src={editProduct.image_url} alt="" style={css('width:48px;height:48px;border-radius:12px;object-fit:cover;flex:none;')} />
                : <Avatar name={editProduct.title} tone={editProduct.tone} />}
              <div style={css('min-width:0;')}>
                <div style={css('font-weight:800;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{editProduct.title}</div>
                <div style={css(`font-size:11.5px;color:${T.muted};`)}>{editProduct.boutique?.name ?? '—'}</div>
              </div>
            </div>
            <PField label="Title *">
              <input value={editData.title} onChange={(e) => setEditData({ ...editData, title: e.target.value })} placeholder="Product title" style={css(PROD_FIELD)} />
            </PField>
            <PField label="Category">
              <input value={editData.category} onChange={(e) => setEditData({ ...editData, category: e.target.value })} placeholder="e.g. Sarees" style={css(PROD_FIELD)} />
            </PField>
            <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:12px;')}>
              <PField label="Price (₹)">
                <input type="number" min={0} value={editData.price} onChange={(e) => setEditData({ ...editData, price: e.target.value === '' ? 0 : Number(e.target.value) })} style={css(PROD_FIELD)} />
              </PField>
              <PField label="Stock">
                <input type="number" min={0} value={editData.stock} onChange={(e) => setEditData({ ...editData, stock: e.target.value === '' ? 0 : Number(e.target.value) })} style={css(PROD_FIELD)} />
              </PField>
            </div>
            <PField label="Status">
              <select value={editData.status} onChange={(e) => setEditData({ ...editData, status: e.target.value as ProductStatus })} style={css(PROD_FIELD + 'cursor:pointer;')}>
                {STATUS_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </PField>
            <div style={css(`font-size:12px;color:${T.muted};background:var(--ag-surface-2);border-left:4px solid #B02454;padding:12px;border-radius:8px;line-height:1.5;`)}>
              Photos, sizes and full description are managed by the boutique in the seller studio. Admin edits here cover pricing, stock, category and visibility.
            </div>
          </form>
        )}
      </Drawer>
    </div>
  );
}

const PROD_FIELD = 'width:100%;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:12px;padding:10px 14px;font-size:14px;font-family:inherit;';

function PField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={css('display:block;font-weight:700;font-size:12.5px;margin-bottom:6px;color:var(--ag-label);')}>{label}</label>
      {children}
    </div>
  );
}

const bulkBtn = (bg: string) => css(`border:none;border-radius:9px;padding:8px 14px;font-weight:800;font-size:12.5px;cursor:pointer;color:#fff;background:${bg};display:flex;align-items:center;gap:5px;font-family:inherit;`);
