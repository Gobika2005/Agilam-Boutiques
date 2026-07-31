import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { useShop } from '@/state/ShopContext';
import { TONES, fmt } from '@/data/demo';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchProductsByBoutique, updateProduct, deleteProduct } from '@/data/products';
import { ProductForm, type ProductFormValues } from '@/components/seller/ProductForm';
import { BOUTIQUE_STATUS_LABEL } from '@/data/types';
import type { ProductWithBoutique } from '@/data/types';

export function MyProducts() {
  const navigate = useNavigate();
  const { showToast } = useShop();
  const { boutique } = useMyBoutique();
  const { data: rows, loading, reload } = useAsync(() => (boutique ? fetchProductsByBoutique(boutique.id) : Promise.resolve([])), [boutique?.id]);
  const products = rows ?? [];

  // Until the shop is approved, RLS hides every one of these products from
  // buyers (schema.sql "products: public read from approved boutiques"). The
  // seller still sees them here as the owner, so without this reminder the page
  // looks live when it is not. Approval flips them all visible at once.
  const pendingReview = !!boutique && boutique.status !== 'approved';

  const [editing, setEditing] = useState<ProductWithBoutique | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const openEdit = (p: ProductWithBoutique) => {
    setEditing(p);
    setConfirmDelete(false);
  };
  const closeEdit = () => {
    if (busy) return;
    setEditing(null);
    setConfirmDelete(false);
  };

  const save = async (form: ProductFormValues) => {
    if (!editing) return;
    setBusy(true);
    try {
      await updateProduct(editing.id, {
        title: form.title.trim(),
        category: form.category.trim() || 'Other',
        price: Number(form.price) || 0,
        stock: Number(form.stock) || 0,
        fabric: form.fabric.trim(),
        color: form.color.trim(),
        occasion: form.occasion.trim(),
        description: form.description.trim(),
        mrp: form.mrp.trim() ? Number(form.mrp) : null,
        sizes: form.sizes,
        wash_care: form.washCare.trim(),
        image_url: form.imageUrl,
        images: form.images,
      });
      showToast('Product updated');
      setEditing(null);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not update product');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await deleteProduct(editing.id);
      showToast('Product deleted');
      setEditing(null);
      setConfirmDelete(false);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete product');
    } finally {
      setBusy(false);
    }
  };

  const stockOf = (stock: number) =>
    stock === 0
      ? { label: 'Out of stock', bg: 'var(--ag-bad-bg)', fg: '#D6455A' }
      : stock <= 5
        ? { label: `Low · ${stock} left`, bg: 'var(--ag-warn-bg)', fg: '#C99A3F' }
        : { label: 'In stock', bg: 'var(--ag-good-bg)', fg: 'var(--ag-good)' };

  const compact = (n: number) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n));
  const metricsOf = (p: ProductWithBoutique) => [
    { icon: 'visibility', label: 'Views', value: compact(p.views_count ?? 0), ic: 'var(--ag-info-text)' },
    { icon: 'favorite', label: 'Likes', value: compact(p.likes_count ?? 0), ic: '#D6336C' },
    { icon: 'ios_share', label: 'Shares', value: compact(p.shares_count ?? 0), ic: '#9B7FC7' },
    { icon: 'bookmark', label: 'Saved', value: compact(p.wishlist_count ?? 0), ic: '#C99A3F' },
    { icon: 'shopping_bag', label: 'Sold', value: compact(p.sold_count ?? 0), ic: 'var(--ag-good)' },
    { icon: 'inventory_2', label: 'Stock', value: String(p.stock), ic: p.stock === 0 ? '#D6455A' : 'var(--ag-label)' },
  ];

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('padding:6px 20px 12px;display:flex;align-items:center;justify-content:space-between;')}>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;")}>My Products</div>
        <button onClick={() => navigate('/seller/add-product')} style={css('background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;border:none;border-radius:12px;padding:9px 14px;font-weight:800;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:5px;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>add</span>Add
        </button>
      </div>

      {pendingReview && products.length > 0 && (
        <div style={css('margin:0 20px 12px;')}>
          <button
            onClick={() => navigate('/seller/verification')}
            style={css('width:100%;text-align:left;background:var(--ag-info-bg);border:1px solid #CFDDF0;border-radius:16px;padding:13px 15px;display:flex;align-items:center;gap:11px;cursor:pointer;font-family:inherit;')}
          >
            <span style={css('width:38px;height:38px;flex:none;border-radius:12px;background:var(--ag-surface);display:flex;align-items:center;justify-content:center;')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:21px;color:var(--ag-info-text);")}>visibility_off</span>
            </span>
            <span style={css('flex:1;min-width:0;')}>
              <span style={css('display:block;font-weight:800;font-size:13px;color:var(--ag-info-text);')}>Not visible to buyers yet</span>
              <span style={css('display:block;font-size:11.5px;font-weight:600;color:#4E688F;margin-top:2px;line-height:1.45;')}>Your shop is {BOUTIQUE_STATUS_LABEL[boutique!.status].toLowerCase()}. These products publish to buyers the moment your boutique is approved.</span>
            </span>
            <span style={css("font-family:'Material Symbols Outlined';font-size:20px;color:var(--ag-info-text);")}>chevron_right</span>
          </button>
        </div>
      )}

      <div style={css('display:flex;flex-direction:column;gap:10px;padding:4px 20px 0;')}>
        {!loading && products.length === 0 && (
          <div style={css('color:var(--ag-muted);font-size:14px;padding:8px 2px;')}>No products yet — tap Add to list your first piece.</div>
        )}
        {products.map((p) => {
          const st = stockOf(p.stock);
          return (
            <div key={p.id} style={css('background:var(--ag-surface);border-radius:16px;padding:10px;box-shadow:0 10px 26px -22px rgba(107,20,54,.6);')}>
              <div
                onClick={() => navigate(`/seller/products/${p.id}`)}
                className="agx-lift"
                style={css('display:flex;gap:11px;align-items:center;cursor:pointer;')}
              >
                <div style={css(`width:56px;height:56px;flex:none;border-radius:13px;background:${TONES[p.tone % TONES.length]};position:relative;overflow:hidden;`)}>
                  <ImageSlot src={p.image_url ?? undefined} placeholder={p.title} style={css('position:absolute;inset:0;')} />
                </div>
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('font-weight:800;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{p.title}</div>
                  <div style={css('font-size:12px;color:var(--ag-muted);')}>{p.category} · {fmt(Number(p.price))}</div>
                  <span style={css(`display:inline-block;margin-top:4px;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:7px;background:${st.bg};color:${st.fg};`)}>{st.label}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); openEdit(p); }}
                  aria-label={`Edit ${p.title}`}
                  style={css('width:36px;height:36px;flex:none;border-radius:11px;border:1.5px solid var(--ag-border);background:var(--ag-surface);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
                >
                  <span style={css("font-family:'Material Symbols Outlined';font-size:18px;color:var(--ag-crimson);")}>edit</span>
                </button>
              </div>

              {/* Performance at a glance — the buyer-side signals for this piece. */}
              <div style={css('display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid var(--ag-border-soft);')}>
                {metricsOf(p).map((m) => (
                  <span key={m.label} title={m.label} style={css('display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:800;color:var(--ag-ink-2);')}>
                    <span style={css(`font-family:'Material Symbols Outlined';font-size:15px;color:${m.ic};`)}>{m.icon}</span>
                    {m.value}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* align-items:flex-start, not center: a dialog taller than the viewport
          centred inside a scroll container has its top clipped and unreachable.
          The panel is capped to the viewport and scrolls its own body, so the
          header stays put instead of the action sitting ~1300px down the page. */}
      {editing && (
        <div onClick={closeEdit} style={css('position:fixed;inset:0;z-index:50;background:rgba(42,16,25,.42);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;')}>
          <div onClick={(e) => e.stopPropagation()} style={css('width:100%;max-width:520px;margin:auto;background:var(--ag-bg);border-radius:22px;padding:18px 20px 24px;box-shadow:0 30px 80px -30px rgba(107,20,54,.6);display:flex;flex-direction:column;max-height:calc(100dvh - 40px);')}>
            <div style={css('flex:none;display:flex;align-items:center;justify-content:space-between;')}>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;")}>Edit product</div>
              <button onClick={closeEdit} style={css('width:36px;height:36px;border-radius:11px;border:none;background:var(--ag-surface);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
                <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>close</span>
              </button>
            </div>

            {/* The one scroll region: form + destructive action travel together. */}
            <div style={css('flex:1;min-height:0;overflow-y:auto;margin:16px -20px -24px;padding:0 20px 24px;')}>
            <div>
              <ProductForm
                boutiqueId={editing.boutique_id}
                submitLabel="Save changes"
                busy={busy}
                onSubmit={save}
                initial={{
                  title: editing.title,
                  category: editing.category,
                  color: editing.color ?? '',
                  occasion: editing.occasion ?? '',
                  fabric: editing.fabric ?? '',
                  price: String(editing.price),
                  stock: String(editing.stock),
                  description: editing.description ?? '',
                  mrp: editing.mrp != null ? String(editing.mrp) : '',
                  sizes: editing.sizes ?? [],
                  washCare: editing.wash_care ?? '',
                  imageUrl: editing.image_url ?? '',
                  images: editing.images ?? [],
                }}
              />
            </div>

            {confirmDelete ? (
              <div style={css('margin-top:12px;background:var(--ag-bad-bg);border:1px solid var(--ag-border);border-radius:14px;padding:12px 14px;')}>
                <div style={css('font-size:13px;font-weight:700;color:var(--ag-bad-text);')}>Delete “{editing.title}”? This can't be undone.</div>
                <div style={css('display:flex;gap:10px;margin-top:10px;')}>
                  <button onClick={() => setConfirmDelete(false)} disabled={busy} style={css('flex:1;height:44px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);border-radius:12px;font-weight:800;cursor:pointer;')}>Cancel</button>
                  <button onClick={remove} disabled={busy} style={css(`flex:1;height:44px;border:none;background:#D6455A;color:#fff;border-radius:12px;font-weight:800;cursor:${busy ? 'default' : 'pointer'};opacity:${busy ? 0.7 : 1};`)}>{busy ? 'Deleting…' : 'Delete'}</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} disabled={busy} style={css('width:100%;height:48px;margin-top:10px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:#D6455A;border-radius:14px;font-weight:800;font-size:14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;')}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>delete</span>Delete product
              </button>
            )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
