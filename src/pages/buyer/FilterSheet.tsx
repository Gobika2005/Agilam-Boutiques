import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useDismissOnEscape } from '@/hooks/useDismissOnEscape';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { useTaxonomy } from '@/state/TaxonomyContext';
import { sortSizes } from '@/lib/sizes';
import { fmt, productSizes } from '@/data/demo';

/**
 * Bottom-sheet filter overlay, shown over the results screen on mobile.
 *
 * Sorting is deliberately not here: the results screen has its own Sort control
 * (chips on desktop, a dedicated sheet on mobile), and offering it in both
 * places meant two controls competing over one piece of state.
 *
 * Every facet here is the admin's approved vocabulary (migration 0024), not a
 * hardcoded list — so a category approved this morning is filterable this
 * afternoon, and a one-off spelling a seller typed never becomes a chip.
 */
export function FilterSheet() {
  const navigate = useNavigate();
  const { filters, toggleFilter, setMaxPrice, resetFilters, query } = useShop();
  const { names, rows, hexOf } = useTaxonomy();
  // The count on the confirm button has to come from the live catalogue — it
  // was counting the eight hardcoded demo products, so it never matched the
  // grid the buyer was about to see.
  const { products: PRODUCTS } = useCatalog();

  const q = query.trim().toLowerCase();
  const results = PRODUCTS.filter(
    (p) =>
      p.price <= filters.maxPrice &&
      (filters.cats.length === 0 || filters.cats.includes(p.cat)) &&
      (filters.colors.length === 0 || filters.colors.includes(p.color)) &&
      (filters.occasions.length === 0 || filters.occasions.includes(p.occasion)) &&
      (filters.sizes.length === 0 || productSizes(p).some((s) => filters.sizes.includes(s))) &&
      (q === '' || [p.title, p.cat, p.occasion, p.fabric, p.color, p.boutique].some((f) => f?.toLowerCase().includes(q))),
  );

  const close = () => navigate('/shop');
  useDismissOnEscape(close);
  const pricePlus = filters.maxPrice >= 10000 ? '+' : '';

  /**
   * Only offer facets that something in the catalogue actually has.
   *
   * The vocabulary is the full approved list, so the sheet was showing chips for
   * Lehengas, Bridal, Gowns and Maternity Wear when no boutique had listed one —
   * every tap led to an empty grid. An already-selected value is always kept, or
   * the buyer could not un-tick a filter that had emptied the results.
   */
  const inCatalogue = <T,>(options: T[], has: (o: T) => boolean, selected: (o: T) => boolean) =>
    options.filter((o) => has(o) || selected(o));

  const catsPresent = new Set(PRODUCTS.map((p) => p.cat));
  const occasionsPresent = new Set(PRODUCTS.map((p) => p.occasion));
  const colorsPresent = new Set(PRODUCTS.map((p) => p.color));
  const sizesPresent = new Set(PRODUCTS.flatMap((p) => productSizes(p)));

  // Canonical ladder (XS · S · M · L · XL · XXL … · Free Size). The vocabulary
  // returns whatever order the rows were approved in, which put XS and XXL after
  // 6XL on the sheet.
  const sizeOptions = sortSizes(
    inCatalogue(names('size'), (s) => sizesPresent.has(s), (s) => filters.sizes.includes(s)),
  );

  return (
    <div style={css('position:fixed;inset:0;z-index:120;')}>
      <div onClick={close} style={css('position:absolute;inset:0;background:rgba(42,10,24,.45);backdrop-filter:blur(4px);animation:agx-fade .2s ease;')} />
      <div className="agx-scroll" style={css('position:absolute;left:0;right:0;bottom:0;max-height:88%;overflow-y:auto;background:var(--ag-surface);border-radius:28px 28px 0 0;padding:14px 22px 24px;animation:agx-sheet .28s cubic-bezier(.2,.9,.3,1);')}>
        <div style={css('width:44px;height:5px;border-radius:3px;background:var(--ag-border);margin:0 auto 14px;')} />
        <div style={css('display:flex;align-items:center;justify-content:space-between;')}>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;")}>Filters</div>
          <button onClick={resetFilters} style={css('border:none;background:none;color:var(--ag-crimson);font-weight:700;font-size:14px;cursor:pointer;')}>Reset</button>
        </div>

        <div style={css('font-weight:800;font-size:14px;margin-top:18px;')}>Price range</div>
        <div style={css('display:flex;justify-content:space-between;font-size:13px;color:var(--ag-muted);font-weight:700;margin-top:8px;')}>
          <span>₹0</span><span style={css('color:var(--ag-crimson);')}>{fmt(filters.maxPrice)}{pricePlus}</span>
        </div>
        <input type="range" min={0} max={10000} step={100} value={filters.maxPrice} onChange={(e) => setMaxPrice(+e.target.value)} aria-label="Maximum price" aria-valuetext={fmt(filters.maxPrice)} style={css('width:100%;accent-color:#D6336C;margin-top:6px;height:24px;')} />

        <div style={css('font-weight:800;font-size:14px;margin-top:12px;')}>Category</div>
        <div style={css('display:flex;flex-wrap:wrap;gap:9px;margin-top:10px;')}>
          {inCatalogue(names('category'), (c) => catsPresent.has(c), (c) => filters.cats.includes(c)).map((c) => {
            const on = filters.cats.includes(c);
            return (
              <button key={c} onClick={() => toggleFilter('cats', c)} style={css(`border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-label)'};border-radius:999px;padding:8px 15px;font-size:13px;font-weight:700;cursor:pointer;`)}>{c}</button>
            );
          })}
        </div>

        <div style={css('font-weight:800;font-size:14px;margin-top:18px;')}>Size</div>
        <div style={css('display:flex;flex-wrap:wrap;gap:9px;margin-top:10px;')}>
          {sizeOptions.map((s) => {
            const on = filters.sizes.includes(s);
            return (
              <button key={s} onClick={() => toggleFilter('sizes', s)} style={css(`min-width:46px;height:44px;padding:0 14px;border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-label)'};border-radius:12px;font-size:13px;font-weight:${on ? 800 : 700};cursor:pointer;`)}>{s}</button>
            );
          })}
        </div>

        <div style={css('font-weight:800;font-size:14px;margin-top:18px;')}>Colour</div>
        <div style={css('display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;')}>
          {inCatalogue(rows('color'), (c) => colorsPresent.has(c.name), (c) => filters.colors.includes(c.name)).map((c) => (
            <button key={c.name} onClick={() => toggleFilter('colors', c.name)} style={css('display:flex;flex-direction:column;align-items:center;gap:5px;border:none;background:none;cursor:pointer;')}>
              <span style={css(`width:40px;height:40px;border-radius:50%;background:${hexOf(c.name)};box-shadow:0 0 0 ${filters.colors.includes(c.name) ? '3px #D6336C' : '1px var(--ag-border)'};`)} />
              <span style={css('font-size:11px;font-weight:700;color:var(--ag-label);')}>{c.name}</span>
            </button>
          ))}
        </div>

        <div style={css('font-weight:800;font-size:14px;margin-top:18px;')}>Occasion</div>
        <div style={css('display:flex;flex-wrap:wrap;gap:9px;margin-top:10px;')}>
          {inCatalogue(names('occasion'), (o) => occasionsPresent.has(o), (o) => filters.occasions.includes(o)).map((o) => {
            const on = filters.occasions.includes(o);
            return (
              <button key={o} onClick={() => toggleFilter('occasions', o)} style={css(`border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-label)'};border-radius:999px;padding:8px 15px;font-size:13px;font-weight:700;cursor:pointer;`)}>{o}</button>
            );
          })}
        </div>

        <div style={css('display:flex;gap:12px;margin-top:24px;')}>
          <button onClick={resetFilters} style={css('flex:1;height:52px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;font-weight:700;cursor:pointer;color:var(--ag-crimson);')}>Reset</button>
          <button onClick={close} style={css('flex:2;height:52px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);')}>
            Show {results.length} results
          </button>
        </div>
      </div>
    </div>
  );
}
