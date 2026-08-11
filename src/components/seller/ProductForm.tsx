import { useRef, useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useTaxonomy } from '@/state/TaxonomyContext';
import { uploadProductImage } from '@/data/products';
import { sortSizes } from '@/lib/sizes';
import { dominantColorsHex, nearestColorName } from '@/lib/imageColor';
import { TaxonomySelect } from '@/components/seller/TaxonomySelect';
import { CROP, useImageCropper } from '@/components/ui/ImageCropper';
import {
  DEFAULT_COLOR_DISCLAIMER, MAX_PRODUCT_BADGES, MIN_PRODUCT_BADGES, PRODUCT_BADGES,
} from '@/lib/productBadges';

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
  /** Packed weight of one unit, in grams (migration 0065). Blank falls back to
   *  the shop's default weight in Settings. */
  weightGrams: string;
  sizes: string[];
  washCare: string;
  imageUrl: string;
  images: string[];
  /** The buyer's product page sections (migration 0054). */
  badges: string[];
  feedingFriendly: boolean;
  feedingNote: string;
  shippingInfo: string;
  colorDisclaimer: string;
  specs: { label: string; value: string }[];
};

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  title: '', category: '', color: '', occasion: '', fabric: '', price: '', stock: '',
  description: '', mrp: '', weightGrams: '', sizes: [], washCare: '', imageUrl: '', images: [],
  badges: [], feedingFriendly: false, feedingNote: '', shippingInfo: '', colorDisclaimer: '', specs: [],
};

const inputStyle = 'width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;padding:0 14px;height:50px;font-size:14px;font-weight:600;';
const inputErrStyle = 'width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface-2);border-radius:13px;padding:0 14px;height:50px;font-size:14px;font-weight:600;';
const textAreaStyle = 'width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;padding:12px 14px;font-size:14px;font-weight:500;font-family:inherit;resize:vertical;min-height:80px;';
const labelStyle = 'font-size:13px;font-weight:700;color:var(--ag-label);';
const errStyle = 'display:block;margin-top:4px;font-size:11.5px;font-weight:700;color:var(--ag-danger-text);';
const hintStyle = 'display:block;margin-top:4px;font-size:11.5px;font-weight:600;color:var(--ag-muted);line-height:1.45;';

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
/** Enough room for the details buyers ask about, short of an unreadable table. */
const MAX_SPEC_ROWS = 10;

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

  // Badges keep the seller's pick order — that's the order the buyer's 3×2 grid
  // renders them in, so the first three picks are the ones above the fold.
  const toggleBadge = (id: string) => {
    setForm((f) => {
      if (f.badges.includes(id)) return { ...f, badges: f.badges.filter((x) => x !== id) };
      if (f.badges.length >= MAX_PRODUCT_BADGES) {
        showToast(`Up to ${MAX_PRODUCT_BADGES} badges — remove one first`);
        return f;
      }
      return { ...f, badges: [...f.badges, id] };
    });
    setErrors((e) => ({ ...e, badges: undefined }));
  };

  const setSpec = (i: number, key: 'label' | 'value', v: string) =>
    setForm((f) => ({ ...f, specs: f.specs.map((row, idx) => (idx === i ? { ...row, [key]: v } : row)) }));
  const addSpec = () => setForm((f) => (f.specs.length >= MAX_SPEC_ROWS ? f : { ...f, specs: [...f.specs, { label: '', value: '' }] }));
  const removeSpec = (i: number) => setForm((f) => ({ ...f, specs: f.specs.filter((_, idx) => idx !== i) }));

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
        const url = await uploadProductImage(boutiqueId, file, form.title);
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
        const url = await uploadProductImage(boutiqueId, file, form.title);
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
    // Optional — a blank falls back to the shop default so no existing product
    // is blocked — but a nonsense value must not reach a courier booking, where
    // an under-declared weight becomes a discrepancy charge weeks later.
    if (form.weightGrams.trim()) {
      const g = Number(form.weightGrams);
      if (!Number.isFinite(g) || g <= 0 || g > 50000) next.weightGrams = 'Enter a weight between 1 and 50000 grams';
    }
    // The three the buyer page can't fake convincingly. Everything else in the
    // detail section is an optional override with a sensible fallback.
    if (!form.description.trim()) next.description = 'Buyers read this first — describe the piece';
    if (!form.washCare.trim()) next.washCare = 'Required — tell buyers how to wash it';
    if (form.badges.length < MIN_PRODUCT_BADGES) next.badges = `Pick at least ${MIN_PRODUCT_BADGES} badges`;
    // A half-typed spec row would publish as "Blouse: " — make the seller finish
    // it or drop it, rather than quietly discarding what they typed.
    if (form.specs.some((s) => !!s.label.trim() !== !!s.value.trim())) {
      next.specs = 'Fill both sides of every specification, or remove the row';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = () => {
    if (!validate()) {
      showToast('Please fill all required fields');
      return;
    }
    // Blank rows are how an "Add specification" tap that changed its mind looks;
    // they're dropped here so they never reach the database.
    onSubmit({ ...form, specs: form.specs.filter((s) => s.label.trim() && s.value.trim()) });
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
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:24px;")}>
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
                  <span aria-hidden="true" style={css("position:absolute;top:3px;right:3px;font-family:'Material Symbols Outlined';font-size:16px;color:#fff;background:rgba(0,0,0,.45);border-radius:6px;")}>close</span>
                </>
              ) : (
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6A9BC;font-size:20px;")}>
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
              <span style={css('display:block;font-size:11.5px;font-weight:700;color:var(--ag-muted);margin-bottom:6px;')}>
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

      <label style={css(labelStyle)}>
        Packed weight (grams) — optional
        <input
          value={form.weightGrams}
          onChange={(e) => set('weightGrams', e.target.value)}
          inputMode="numeric"
          placeholder="650"
          style={css(errors.weightGrams ? inputErrStyle : inputStyle)}
        />
        {errors.weightGrams
          ? <span style={css(errStyle)}>{errors.weightGrams}</span>
          : (
            <span style={css(hintStyle)}>
              Weigh the piece packed, ready to hand over. Used to book couriers and price the freight —
              leave it blank and we use your shop’s default weight from Settings. Under-declaring costs
              you the difference when the courier weighs it themselves.
            </span>
          )}
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

      {/* ── What the buyer's product page shows ──────────────────────────────
          Everything below fills a section of the product page. The buyer app
          hides any section left empty, so an optional box costs the seller
          nothing but a filled one answers a question they'd otherwise be
          messaged about. */}
      <div style={css('display:flex;align-items:center;gap:9px;margin-top:6px;padding-top:16px;border-top:1px solid var(--ag-border);')}>
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;color:#D6336C;")}>list_alt</span>
        <div>
          <div style={css('font-size:14px;font-weight:800;color:var(--ag-ink);')}>Product page details</div>
          <div style={css('font-size:11.5px;font-weight:600;color:var(--ag-muted);')}>What buyers read before they decide</div>
        </div>
      </div>

      <div>
        <div style={css(labelStyle)}>Feature badges * — pick {MIN_PRODUCT_BADGES} to {MAX_PRODUCT_BADGES}</div>
        <span style={css(hintStyle)}>The icon grid at the top of your product page. Only claim what's true of this piece.</span>
        <div style={css('display:flex;gap:8px;flex-wrap:wrap;margin-top:9px;')}>
          {PRODUCT_BADGES.map((b) => {
            const on = form.badges.includes(b.id);
            const full = !on && form.badges.length >= MAX_PRODUCT_BADGES;
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleBadge(b.id)}
                style={css(`display:flex;align-items:center;gap:6px;padding:9px 13px;border-radius:11px;border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-ink-2)'};font-weight:700;font-size:12.5px;font-family:inherit;cursor:pointer;opacity:${full ? 0.45 : 1};`)}
              >
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>{b.icon}</span>
                {b.label}
              </button>
            );
          })}
        </div>
        <span style={css(hintStyle)}>{form.badges.length} of {MAX_PRODUCT_BADGES} selected</span>
        {errors.badges && <span style={css(errStyle)}>{errors.badges}</span>}
      </div>

      <label style={css(labelStyle)}>
        Description *
        <textarea value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Handcrafted with intricate zari work, tailored for a graceful drape…" style={css(textAreaStyle)} />
        {errors.description && <span style={css(errStyle)}>{errors.description}</span>}
      </label>

      {/* Nursing access is a yes/no because it decides whether the section
          appears at all — and because a flag can become a buyer filter, which
          free text never could. */}
      <div style={css('border:1.5px solid var(--ag-border);border-radius:13px;background:var(--ag-surface);padding:13px 14px;')}>
        <button
          type="button"
          role="switch"
          aria-checked={form.feedingFriendly}
          onClick={() => set('feedingFriendly', !form.feedingFriendly)}
          style={css('width:100%;display:flex;align-items:center;gap:11px;border:none;background:none;padding:0;cursor:pointer;text-align:left;font-family:inherit;')}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;color:#D6336C;")}>child_care</span>
          <span style={css('flex:1;')}>
            <span style={css('display:block;font-size:13px;font-weight:700;color:var(--ag-label);')}>Feeding friendly</span>
            <span style={css('display:block;font-size:11.5px;font-weight:600;color:var(--ag-muted);margin-top:2px;')}>Has nursing access — a concealed zip, side slit or overlap</span>
          </span>
          <span style={css(`flex:none;width:44px;height:26px;border-radius:999px;background:${form.feedingFriendly ? '#D6336C' : 'var(--ag-surface-3)'};position:relative;transition:background .18s;`)}>
            <span style={css(`position:absolute;top:3px;left:${form.feedingFriendly ? 21 : 3}px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .18s;box-shadow:0 1px 3px rgba(0,0,0,.3);`)} />
          </span>
        </button>
        {form.feedingFriendly && (
          <textarea
            value={form.feedingNote}
            onChange={(e) => set('feedingNote', e.target.value)}
            placeholder="How it works — e.g. concealed zip under the yoke, opens from both sides"
            style={css(`${textAreaStyle}min-height:64px;`)}
          />
        )}
      </div>

      <label style={css(labelStyle)}>
        Wash care *
        <textarea value={form.washCare} onChange={(e) => set('washCare', e.target.value)} placeholder="Dry clean only. Do not bleach. Iron on low heat with a cloth over the zari." style={css(textAreaStyle)} />
        {errors.washCare && <span style={css(errStyle)}>{errors.washCare}</span>}
      </label>

      <div>
        <div style={css(labelStyle)}>Extra specifications — optional</div>
        <span style={css(hintStyle)}>
          Category, colour, fabric, occasion and sizes already appear on their own. Add what's specific to this piece — blouse type, saree length, work, lining.
        </span>
        {form.specs.map((row, i) => (
          <div key={i} style={css('display:flex;gap:8px;align-items:center;margin-top:8px;')}>
            <input
              value={row.label}
              onChange={(e) => setSpec(i, 'label', e.target.value)}
              placeholder="Blouse"
              style={css(`${inputStyle}flex:0 0 36%;min-width:0;margin-top:0;height:46px;`)}
            />
            <input
              value={row.value}
              onChange={(e) => setSpec(i, 'value', e.target.value)}
              placeholder="Unstitched · 0.8m"
              style={css(`${inputStyle}flex:1;min-width:0;margin-top:0;height:46px;`)}
            />
            <button
              type="button"
              onClick={() => removeSpec(i)}
              aria-label={`Remove specification ${i + 1}`}
              style={css('flex:none;width:40px;height:46px;border:1.5px solid var(--ag-border);border-radius:12px;background:var(--ag-surface);color:var(--ag-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
            >
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>close</span>
            </button>
          </div>
        ))}
        {errors.specs && <span style={css(errStyle)}>{errors.specs}</span>}
        {form.specs.length < MAX_SPEC_ROWS && (
          <button
            type="button"
            onClick={addSpec}
            style={css('margin-top:9px;display:flex;align-items:center;gap:6px;height:44px;padding:0 15px;border:1.5px dashed var(--ag-border);border-radius:12px;background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:13px;font-family:inherit;cursor:pointer;')}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>add</span>
            Add specification
          </button>
        )}
      </div>

      <label style={css(labelStyle)}>
        Shipping information — optional
        <textarea
          value={form.shippingInfo}
          onChange={(e) => set('shippingInfo', e.target.value)}
          placeholder="e.g. Made to order — dispatched in 5–7 days"
          style={css(textAreaStyle)}
        />
        <span style={css(hintStyle)}>Only for this piece. Leave blank and buyers see your shop's usual delivery details.</span>
      </label>

      <label style={css(labelStyle)}>
        Colour disclaimer — optional
        <textarea
          value={form.colorDisclaimer}
          onChange={(e) => set('colorDisclaimer', e.target.value)}
          placeholder={DEFAULT_COLOR_DISCLAIMER}
          style={css(textAreaStyle)}
        />
        <span style={css(hintStyle)}>Leave blank to use the standard note shown above.</span>
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
