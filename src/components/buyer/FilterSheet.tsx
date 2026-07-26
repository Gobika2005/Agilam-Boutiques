import { Icon } from '@/components/ui/Icon';
import { fmtInr } from '@/lib/tokens';
import { useTaxonomy } from '@/state/TaxonomyContext';
import type { ProductFilters } from '@/data/products';

const SORTS: NonNullable<ProductFilters['sort']>[] = ['Latest', 'Price: Low to High', 'Price: High to Low', 'Popularity'];

type Props = {
  filters: ProductFilters;
  onChange: (f: ProductFilters) => void;
  onClose: () => void;
  resultsCount: number;
};

function toggleIn(arr: string[] = [], v: string) {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

export function FilterSheet({ filters, onChange, onClose, resultsCount }: Props) {
  const f = filters;
  // Every filter facet comes from the managed vocabulary, so the buyer can
  // filter by exactly what sellers can tag — no hardcoded list that drifts out
  // of step with the catalogue.
  const taxonomy = useTaxonomy();
  const catOpts = taxonomy.names('category');
  const occasionOpts = taxonomy.names('occasion');
  const colorOpts = taxonomy.rows('color').map((r) => ({ name: r.name, hex: taxonomy.hexOf(r.name) }));

  return (
    <div className="absolute inset-0 z-30">
      <div onClick={onClose} className="absolute inset-0 animate-fade" style={{ background: 'rgba(42,10,24,.45)' }} />
      <div
        className="no-scrollbar absolute inset-x-0 bottom-0 max-h-[88%] overflow-y-auto rounded-t-[28px] bg-white px-5.5 pb-6 pt-3.5 animate-sheet"
      >
        <div className="mx-auto mb-3.5 h-[5px] w-11 rounded-full" style={{ background: 'var(--ag-border)' }} />
        <div className="flex items-center justify-between">
          <div className="font-serif text-[26px] font-bold">Filters</div>
          <button onClick={() => onChange({ maxPrice: 10000, categories: [], colors: [], occasions: [], sort: 'Latest' })} className="border-none bg-transparent text-sm font-bold text-rose-primaryDark">
            Reset
          </button>
        </div>

        <div className="mt-4.5 text-sm font-extrabold">Price range</div>
        <div className="mt-2 flex justify-between text-[13px] font-bold text-rose-muted">
          <span>₹0</span>
          <span className="text-rose-primaryDark">
            {fmtInr(f.maxPrice ?? 10000)}
            {(f.maxPrice ?? 10000) >= 10000 ? '+' : ''}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={10000}
          step={100}
          value={f.maxPrice ?? 10000}
          onChange={(e) => onChange({ ...f, maxPrice: +e.target.value })}
          className="mt-1.5 h-6 w-full accent-rose-primary"
        />

        <div className="mt-3 text-sm font-extrabold">Category</div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {catOpts.map((c) => {
            const on = f.categories?.includes(c);
            return (
              <button
                key={c}
                onClick={() => onChange({ ...f, categories: toggleIn(f.categories, c) })}
                className="rounded-full border-[1.5px] px-3.5 py-2 text-[13px] font-bold"
                style={{ borderColor: on ? '#D6336C' : 'var(--ag-border)', background: on ? 'var(--ag-surface-2)' : 'var(--ag-surface)', color: on ? 'var(--ag-crimson)' : 'var(--ag-label)' }}
              >
                {c}
              </button>
            );
          })}
        </div>

        <div className="mt-4.5 text-sm font-extrabold">Colour</div>
        <div className="mt-3 flex flex-wrap gap-3">
          {colorOpts.map((c) => {
            const on = f.colors?.includes(c.name);
            return (
              <button key={c.name} onClick={() => onChange({ ...f, colors: toggleIn(f.colors, c.name) })} className="flex flex-col items-center gap-1.5 border-none bg-transparent">
                <span className="h-10 w-10 rounded-full" style={{ background: c.hex, boxShadow: `0 0 0 ${on ? '3px #D6336C' : '1px var(--ag-border)'}` }} />
                <span className="text-[11px] font-bold text-rose-label">{c.name}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4.5 text-sm font-extrabold">Occasion</div>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {occasionOpts.map((o) => {
            const on = f.occasions?.includes(o);
            return (
              <button
                key={o}
                onClick={() => onChange({ ...f, occasions: toggleIn(f.occasions, o) })}
                className="rounded-full border-[1.5px] px-3.5 py-2 text-[13px] font-bold"
                style={{ borderColor: on ? '#D6336C' : 'var(--ag-border)', background: on ? 'var(--ag-surface-2)' : 'var(--ag-surface)', color: on ? 'var(--ag-crimson)' : 'var(--ag-label)' }}
              >
                {o}
              </button>
            );
          })}
        </div>

        <div className="mt-4.5 text-sm font-extrabold">Sort by</div>
        <div className="mt-2 flex flex-col gap-0.5">
          {SORTS.map((s) => (
            <button
              key={s}
              onClick={() => onChange({ ...f, sort: s })}
              className="flex items-center justify-between border-none border-b border-rose-borderSoft bg-transparent py-2.5 text-left text-sm"
              style={{ fontWeight: f.sort === s ? 800 : 600, color: f.sort === s ? 'var(--ag-ink)' : 'var(--ag-label)' }}
            >
              {s}
              <Icon name="check_circle" style={{ color: '#D6336C', opacity: f.sort === s ? 1 : 0 }} />
            </button>
          ))}
        </div>

        <div className="mt-5.5 flex gap-3">
          <button
            onClick={() => onChange({ maxPrice: 10000, categories: [], colors: [], occasions: [], sort: 'Latest' })}
            className="h-[52px] flex-1 rounded-2xl border-[1.5px] border-rose-border bg-white font-bold text-rose-primaryDark"
          >
            Reset
          </button>
          <button onClick={onClose} className="h-[52px] flex-[2] rounded-2xl border-none font-extrabold text-white shadow-button" style={{ background: 'linear-gradient(135deg,#D6336C,#B02454)' }}>
            Show {resultsCount} results
          </button>
        </div>
      </div>
    </div>
  );
}
