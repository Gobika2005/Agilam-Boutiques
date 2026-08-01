import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { createProduct } from '@/data/products';
import { ProductForm, type ProductFormValues } from '@/components/seller/ProductForm';

export function AddProduct() {
  const navigate = useNavigate();
  const { showToast } = useShop();
  const { boutique } = useMyBoutique();
  const [saving, setSaving] = useState(false);

  const publish = async (form: ProductFormValues) => {
    if (!boutique) {
      showToast('No boutique found for this account');
      return;
    }
    setSaving(true);
    try {
      await createProduct({
        boutique_id: boutique.id,
        title: form.title.trim(),
        category: form.category.trim() || 'Other',
        price: Number(form.price) || 0,
        stock: Number(form.stock) || 0,
        fabric: form.fabric.trim(),
        color: form.color.trim(),
        occasion: form.occasion.trim(),
        tone: Math.floor(Math.random() * 8),
        description: form.description.trim(),
        mrp: form.mrp.trim() ? Number(form.mrp) : null,
        sizes: form.sizes,
        wash_care: form.washCare.trim(),
        image_url: form.imageUrl,
        images: form.images,
      });
      showToast('Product published');
      navigate('/seller/products');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not publish product');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
      <div style={css('padding:6px 20px 12px;display:flex;align-items:center;gap:10px;')}>
        <button onClick={() => navigate('/seller/products')} aria-label="Go back" style={css('width:42px;height:42px;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
        </button>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;")}>Add New Product</h1>
      </div>

      <div style={css('padding:6px 20px 0;')}>
        {boutique ? (
          <ProductForm boutiqueId={boutique.id} submitLabel="Publish Product" busy={saving} onSubmit={publish} />
        ) : (
          <div style={css('color:var(--ag-muted);font-size:14px;padding:20px 2px;')}>Loading your boutique…</div>
        )}
      </div>
    </div>
  );
}
