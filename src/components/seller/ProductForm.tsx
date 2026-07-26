import { useRef, useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useTaxonomy } from '@/state/TaxonomyContext';
import { uploadProductImage } from '@/data/products';
import { sortSizes } from '@/lib/sizes';
import { dominantColorsHex, nearestColorName } from '@/lib/imageColor';
import { TaxonomySelect } from '@/components/seller/TaxonomySelect';
import { CROP, useImageCropper } from '@/components/ui/ImageCropper';

export type ProductFormValues = {
  title: string;
  category: string;
  color: string;
  occasion: string;
  fabric: string;
  price: string;
  stock: string;
  description: string;
  mrp: string;
  sizes: string[];
  washCare: string;
  imageUrl: string;
  images: string[];
};

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  title: '', category: '', color: '', occasion: '', fabric: '', price: '', stock: '',
  description: '', mrp: '', sizes: [], washCare: '', imageUrl: '', images: [],
};

const inputStyle = 'width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;padding:0 14px;height:50px;font-size:14px;font-weight:600;';
const inputErrStyle = 'width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface-2);border-radius:13px;padding:0 14px;height:50px;font-size:14px;font-weight:600;';
const textAreaStyle = 'width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;padding:12px 14px;font-size:14px;font-weight:500;font-family:inherit;resize:vertical;min-height:80px;';
const labelStyle = 'font-size:13px;font-weight:700;color:var(--ag-label);';
const errStyle = 'display:block;margin-top:4px;font-size:11.5px;font-weight:700;color:#D6455A;';

/**
 * Category, colour, occasion and fabric used to be four free-text boxes. They
 * are the four fields the buyer app filters and groups by, which made them the
 * four fields where a typo quietly split one edit into two — so they are now
 * dropdowns over the managed vocabulary (migration 0024, @/state/TaxonomyContext).
 *
 * Category, occasion and fabric carry an "add new" request; colour does not,
 * because a colour needs a swatch hex to render on the buyer's filter and that
 * is the admin's to choose.
 */
const PICKERS = [
  // All four are type-to-search comboboxes: the vocabularies are long and
  // managed, so filtering beats scrolling. Colour also shows swatches; the other
  // three carry the "request a new one" action inside the search popover.
  { key: 'category', kind: 'category', label: 'Category *', searchable: true },
  { key: 'color', kind: 'color', label: 'Colour *', requestable: false, searchable: true },
  { key: 'occasion', kind: 'occasion', label: 'Occasion *', searchable: true },
  { key: 'fabric', kind: 'fabric', label: 'Fabric *', searchable: true },
] as const;

export function ProductForm({
  boutiqueId,
  initial,
  submitLabel,
  busy,
  onSubmit,
}: {
  boutiqueId: string;
  initial?: Partial<ProductFormValues>;
  submitLabel: string;
  busy: boolean;
  onSubmit: (values: ProductFormValues) => void;
}) {
  const { showToast } = useShop();
  const taxonomy = useTaxonomy();
  // Sizes are a fixed, admin-managed ladder — a chip row rather than a select,
  // because a product can carry several.
  const sizeOptions = sortSizes(taxonomy.names('size'));
  // Colour swatches, for snapping a photo's dominant colour to the vocabulary.
  // Every term is a candidate — its admin swatch when set, otherwise the hue
  // read from its name — so a well-detected dress colour has the whole palette
  // to match against, not just the handful an admin happened to hand-swatch.
  const colorSwatches = taxonomy.rows('color').map((r) => ({ name: r.name, hex: taxonomy.hexOf(r.name) }));
  const [form, setForm] = useState<ProductFormValues>({ ...EMPTY_PRODUCT_FORM, ...initial });
  const [errors, setErrors] = useState<Partial<Record<keyof ProductFormValues, string>>>({});
  const [uploading, setUploading] = useState<'cover' | 'gallery' | null>(null);
  // The colours we read off the cover photo — offered, never forced. Only shown
  // while Colour is still empty, so a seller's own choice is never second-guessed.
  const [colorSuggestions, setColorSuggestions] = useState<string[]>([]);
  const coverInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);
  const { cropImage, cropper } = useImageCropper();

  const set = <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const toggleSize = (s: string) =>
    setForm((f) => ({ ...f, sizes: f.sizes.includes(s) ? f.sizes.filter((x) => x !== s) : [...f.sizes, s] }));

  // Fill the (up to 3) gallery slots from a list of picked files. Each photo is
  // framed in the cropper one after another; a cancelled crop is simply skipped.
  // Appends functionally so several uploads in a row accumulate correctly.
  const fillGallery = async (files: File[]) => {
    let slots = 3 - form.images.length;
    for (const picked of files) {
      if (slots <= 0) break;
      const file = await cropImage(picked, CROP.product);
      if (!file) continue;
      setUploading('gallery');
      try {
        const url = await uploadProductImage(boutiqueId, file);
        setForm((f) => ({ ...f, images: [...f.images, url] }));
        slots--;
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Photo upload failed');
      } finally {
        setUploading(null);
      }
    }
  };

  const onCoverPick = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    // Multi-select: the first photo frames the cover, any extras flow straight
    // into the gallery slots — one pick fills the whole product in a single shot.
    const [first, ...rest] = Array.from(picked);
    // Cards crop to 3:4, so the seller frames it rather than discovering later
    // that the buyer's grid cut the hem off.
    const file = await cropImage(first, CROP.product);
    if (file) {
      setUploading('cover');
      try {
        const url = await uploadProductImage(boutiqueId, file);
        set('imageUrl', url);
        setErrors((e) => ({ ...e, imageUrl: undefined }));
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'Photo upload failed');
      } finally {
        setUploading(null);
      }
      // Read the main colours off the local file (untainted, no upload needed)
      // and snap each to the vocabulary. Best-effort: an empty result just offers
      // nothing rather than guessing wrong. Distinct names, in the photo's order.
      const hexes = colorSwatches.length ? await dominantColorsHex(file) : [];
      const names = hexes.map((h) => nearestColorName(h, colorSwatches)).filter((n): n is string => !!n);
      setColorSuggestions([...new Set(names)]);
    }
    if (rest.length) await fillGallery(rest);
  };

  const onGalleryPick = async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return;
    await fillGallery(Array.from(picked));
  };

  const validate = (): boolean => {
    const next: Partial<Record<keyof ProductFormValues, string>> = {};
    if (!form.title.trim()) next.title = 'Required';
    if (!form.category.trim()) next.category = 'Required';
    if (!form.fabric.trim()) next.fabric = 'Required';
    if (!form.color.trim()) next.color = 'Required';
    if (!form.occasion.trim()) next.occasion = 'Required';
    if (!form.price.trim() || Number(form.price) <= 0) next.price = 'Enter a valid price';
    if (form.stock.trim() === '' || Number(form.stock) < 0) next.stock = 'Enter valid stock';
    if (!form.imageUrl) next.imageUrl = 'Add a cover photo';
    if (form.mrp.trim() && Number(form.mrp) < Number(form.price || 0)) next.mrp = 'MRP must be ≥ price';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = () => {
    if (!validate()) {
      showToast('Please fill all required fields');
      return;
    }
    onSubmit(form);
  };

  const discountPct = form.mrp.trim() && Number(form.mrp) > Number(form.price || 0)
    ? Math.round((1 - Number(form.price || 0) / Number(form.mrp)) * 100)
    : null;

  return (
    <div style={css('display:flex;flex-direction:column;gap:14px;')}>
      <div style={css('display:flex;gap:10px;')}>
        <div
          onClick={() => coverInput.current?.click()}
          style={css(`width:96px;height:96px;flex:none;border-radius:16px;border:2px dashed ${errors.imageUrl ? 'var(--ag-border)' : 'var(--ag-border)'};background:var(--ag-surface);position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;`)}
        >
          {form.imageUrl ? (
            <img src={form.imageUrl} alt="Cover" style={css('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;')} />
          ) : (
            <>
              <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:24px;")}>
                {uploading === 'cover' ? 'progress_activity' : 'add_a_photo'}
              </span>
              <span style={css('font-size:10px;color:var(--ag-muted-soft);font-weight:700;')}>Cover *</span>
            </>
          )}
          {/* Clearing the value lets the same photo be re-picked after a cancelled crop. */}
          <input ref={coverInput} type="file" accept="image/*" multiple style={css('display:none;')} onChange={(e) => { void onCoverPick(e.target.files); e.target.value = ''; }} />
        </div>

        {[0, 1, 2].map((i) => {
          const url = form.images[i];
          return (
            <div
              key={i}
              onClick={() => (url ? set('images', form.images.filter((x) => x !== url)) : galleryInput.current?.click())}
              style={css('width:72px;height:96px;flex:none;border-radius:16px;border:2px dashed var(--ag-border);background:var(--ag-surface);position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:pointer;')}
            >
              {url ? (
                <>
                  <img src={url} alt="Gallery" style={css('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;')} />
                  <span style={css("position:absolute;top:3px;right:3px;font-family:'Material Symbols Outlined';font-size:16px;color:#fff;background:rgba(0,0,0,.45);border-radius:6px;")}>close</span>
                </>
              ) : (
                <span style={css("font-family:'Material Symbols Outlined';color:#D6A9BC;font-size:20px;")}>
                  {uploading === 'gallery' && !form.images[i] ? 'progress_activity' : 'add'}
                </span>
              )}
            </div>
          );
        })}
        <input ref={galleryInput} type="file" accept="image/*" multiple style={css('display:none;')} onChange={(e) => { void onGalleryPick(e.target.files); e.target.value = ''; }} />
      </div>
      {cropper}
      {errors.imageUrl && <span style={css(errStyle)}>{errors.imageUrl}</span>}

      <label style={css(labelStyle)}>
        Product title *
        <input
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="e.g. Rose Zari Silk Saree"
          style={css(errors.title ? inputErrStyle : inputStyle)}
        />
        {errors.title && <span style={css(errStyle)}>{errors.title}</span>}
      </label>

      {PICKERS.map((p) => (
        <div key={p.key}>
          <TaxonomySelect
            kind={p.kind}
            label={p.label}
            value={form[p.key]}
            onChange={(v) => set(p.key, v)}
            error={errors[p.key]}
            boutiqueId={boutiqueId}
            requestable={'requestable' in p ? p.requestable : true}
            searchable={'searchable' in p ? p.searchable : false}
          />
          {p.key === 'color' && !form.color && colorSuggestions.length > 0 && (
            <div style={css('margin-top:7px;')}>
              <span style={css('display:block;font-size:11.5px;font-weight:700;color:#A98D99;margin-bottom:6px;')}>
                {colorSuggestions.length > 1 ? 'Colours we spotted in your photo — tap one' : 'Colour we spotted in your photo — tap to use'}
              </span>
              <div style={css('display:flex;gap:7px;flex-wrap:wrap;')}>
                {colorSuggestions.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => { set('color', name); setColorSuggestions([]); }}
                    style={css('display:flex;align-items:center;gap:7px;border:1.5px solid var(--ag-border);background:var(--ag-surface-2);border-radius:11px;padding:7px 12px;cursor:pointer;font-family:inherit;')}
                  >
                    <span style={css(`flex:none;width:16px;height:16px;border-radius:5px;border:1.5px solid rgba(0,0,0,.08);background:${taxonomy.hexOf(name)};`)} />
                    <span style={css('font-size:12px;font-weight:700;color:var(--ag-crimson);')}>{name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}

      <div style={css('display:flex;gap:12px;')}>
        <label style={css(`flex:1;${labelStyle}`)}>
          Price (₹) *<input value={form.price} onChange={(e) => set('price', e.target.value)} inputMode="numeric" placeholder="4899" style={css(errors.price ? inputErrStyle : inputStyle)} />
          {errors.price && <span style={css(errStyle)}>{errors.price}</span>}
        </label>
        <label style={css(`flex:1;${labelStyle}`)}>
          Stock *<input value={form.stock} onChange={(e) => set('stock', e.target.value)} inputMode="numeric" placeholder="12" style={css(errors.stock ? inputErrStyle : inputStyle)} />
          {errors.stock && <span style={css(errStyle)}>{errors.stock}</span>}
        </label>
      </div>

      <label style={css(labelStyle)}>
        MRP (₹) — optional, shows a discount badge to buyers
        <input value={form.mrp} onChange={(e) => set('mrp', e.target.value)} inputMode="numeric" placeholder="5999" style={css(errors.mrp ? inputErrStyle : inputStyle)} />
        {errors.mrp && <span style={css(errStyle)}>{errors.mrp}</span>}
        {discountPct != null && <span style={css('display:block;margin-top:4px;font-size:11.5px;font-weight:700;color:var(--ag-good);')}>{discountPct}% off badge will show to buyers</span>}
      </label>

      <div>
        <div style={css(labelStyle)}>Sizes available — optional</div>
        <div style={css('display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;')}>
          {sizeOptions.map((s) => {
            const on = form.sizes.includes(s);
            return (
              <span key={s} onClick={() => toggleSize(s)} style={css(`padding:9px 14px;border-radius:11px;border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-ink-2)'};font-weight:700;font-size:13px;cursor:pointer;`)}>{s}</span>
            );
          })}
        </div>
      </div>

      <label style={css(labelStyle)}>
        Description — optional
        <textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Handcrafted with intricate zari work, tailored for a graceful drape…" style={css(textAreaStyle)} />
      </label>

      <label style={css(labelStyle)}>
        Wash care — optional
        <textarea value={form.washCare} onChange={(e) => set('washCare', e.target.value)} placeholder="Dry clean only" style={css(textAreaStyle)} />
      </label>

      <button
        onClick={submit}
        disabled={busy || uploading != null}
        style={css(`width:100%;height:54px;border:none;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:${busy || uploading ? 'default' : 'pointer'};opacity:${busy || uploading ? 0.7 : 1};box-shadow:0 14px 30px -14px rgba(214,51,108,.8);`)}
      >
        {uploading ? 'Uploading photo…' : busy ? 'Saving…' : submitLabel}
      </button>
    </div>
  );
}
