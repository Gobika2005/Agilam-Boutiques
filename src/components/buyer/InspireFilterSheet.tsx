import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { useDismissOnEscape } from '@/hooks/useDismissOnEscape';
import { useCatalog } from '@/state/CatalogContext';
import { useTaxonomy } from '@/state/TaxonomyContext';
import { sortSizes } from '@/lib/sizes';
import { distinctCities } from '@/lib/cities';
import { hasTerm, termKey } from '@/lib/vocabulary';
import { fmt } from '@/data/demo';
import {
  FEED_MAX_PRICE,
  NO_FEED_FILTERS,
  feedFilterCount,
  matchesFeedFilters,
  type FeedFilters,
} from '@/lib/feedFilters';

/**
 * The Inspire feed's filter sheet.
 *
 * The same bottom-sheet shape as the shop grid's `FilterSheet`, deliberately —
 * a buyer who has filtered the grid already knows this control. It is a separate
 * component rather than a reuse because that one is bound to the global shop
 * filters and closes by navigating to /shop; this one owns nothing, takes a
 * value and hands back a new one, and the screen it lives on throws the value
 * away when the buyer leaves Inspire.
 *
 * Edits are held locally and only committed on "Show N pieces", so dragging the
 * price slider does not refetch the feed on every pixel. "Reset" clears
 * everything and closes, which is the one case where committing immediately is
 * what the buyer means.
 *
 * Every facet offered is one something in the live catalogue actually has (plus
 * anything already ticked, or a filter that emptied the feed could not be
 * un-ticked). The vocabulary lists are the admin's approved ones — migration
 * 0024 — never a hardcoded list.
 */
export function InspireFilterSheet({
  value,
  onApply,
  onClose,
}: {
  value: FeedFilters;
  onApply: (next: FeedFilters) => void;
  onClose: () => void;
}) {
  const { products: PRODUCTS, boutiques: BOUTIQUES } = useCatalog();
  const { names, rows, hexOf } = useTaxonomy();
  const [draft, setDraft] = useState<FeedFilters>(value);

  useDismissOnEscape(onClose);

  const set = <K extends keyof FeedFilters>(key: K, next: FeedFilters[K]) =>
    setDraft((d) => ({ ...d, [key]: next }));

  const toggle = (key: 'categories' | 'occasions' | 'fabrics' | 'colors' | 'sizes', v: string) =>
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(v) ? d[key].filter((x) => x !== v) : [...d[key], v],
    }));

  const shopById = useMemo(() => new Map(BOUTIQUES.map((b) => [b.id, b])), [BOUTIQUES]);

  /**
   * The exact number of pieces behind the button.
   *
   * The whole active catalogue is already in memory, so this is a filter over an
   * array rather than a count query — no round trip per slider pixel, and the
   * number always matches the feed the buyer is about to see.
   */
  const matchCount = useMemo(
    () => PRODUCTS.filter((p) => matchesFeedFilters(p, shopById.get(p.boutiqueId ?? ''), draft)).length,
    [PRODUCTS, shopById, draft],
  );

  /** Offer a facet only if the catalogue has it — or if it is already ticked. */
  const present = <T,>(options: T[], has: (o: T) => boolean, on: (o: T) => boolean) =>
    options.filter((o) => has(o) || on(o));

  const catsPresent = useMemo(() => new Set(PRODUCTS.map((p) => termKey(p.cat))), [PRODUCTS]);
  const occasionsPresent = useMemo(() => new Set(PRODUCTS.map((p) => termKey(p.occasion))), [PRODUCTS]);
  const fabricsPresent = useMemo(() => new Set(PRODUCTS.map((p) => termKey(p.fabric))), [PRODUCTS]);
  const colorsPresent = useMemo(() => new Set(PRODUCTS.map((p) => termKey(p.color))), [PRODUCTS]);
  const sizesPresent = useMemo(() => new Set(PRODUCTS.flatMap((p) => (p.sizes ?? []).map(termKey))), [PRODUCTS]);

  // Cities that have a shop, canonical and de-duplicated, with a count each —
  // the same searched control as the boutique directory rather than a wall of
  // chips, because a marketplace of a hundred towns is not browsable.
  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of PRODUCTS) if (p.city) counts.set(p.city, (counts.get(p.city) ?? 0) + 1);
    return distinctCities(BOUTIQUES.map((b) => b.city)).map((name) => ({
      name,
      count: counts.get(name) ?? 0,
    }));
  }, [PRODUCTS, BOUTIQUES]);
  const [cityQuery, setCityQuery] = useState('');
  const cityMatches = useMemo(() => {
    const q = cityQuery.trim().toLowerCase();
    if (q) return cities.filter((c) => c.name.toLowerCase().includes(q));
    const top = [...cities].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 6);
    if (draft.city && !top.some((c) => c.name === draft.city)) {
      const picked = cities.find((c) => c.name === draft.city);
      if (picked) return [picked, ...top.slice(0, 5)];
    }
    return top;
  }, [cities, cityQuery, draft.city]);

  const sizeOptions = sortSizes(present(names('size'), (s) => sizesPresent.has(termKey(s)), (s) => hasTerm(draft.sizes, s)));

  // One chip, one look — the sheet is a grid of them and they must not drift.
  const chip = (on: boolean) =>
    css(`display:flex;align-items:center;gap:6px;border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-label)'};border-radius:999px;padding:8px 15px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;`);

  const heading = (text: string) => (
    <div style={css('font-weight:800;font-size:14px;margin-top:18px;')}>{text}</div>
  );

  const chipRow = (options: string[], key: 'categories' | 'occasions' | 'fabrics', picked: string[]) => (
    <div style={css('display:flex;flex-wrap:wrap;gap:9px;margin-top:10px;')}>
      {options.map((o) => (
        <button key={o} onClick={() => toggle(key, o)} style={chip(hasTerm(picked, o))}>{o}</button>
      ))}
    </div>
  );

  const count = feedFilterCount(draft);

  return (
    <div style={css('position:fixed;inset:0;z-index:120;')}>
      <div onClick={onClose} style={css('position:absolute;inset:0;background:rgba(42,10,24,.45);backdrop-filter:blur(4px);animation:agx-fade .2s ease;')} />
      <div
        className="agx-scroll"
        role="dialog"
        aria-modal="true"
        aria-label="Filter the feed"
        style={css('position:absolute;left:0;right:0;bottom:0;max-height:88%;overflow-y:auto;background:var(--ag-surface);border-radius:28px 28px 0 0;padding:14px 22px 24px;animation:agx-sheet .28s cubic-bezier(.2,.9,.3,1);')}
      >
        <div style={css('width:44px;height:5px;border-radius:3px;background:var(--ag-border);margin:0 auto 14px;')} />
        <div style={css('display:flex;align-items:center;justify-content:space-between;')}>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;")}>Filters</div>
          <button
            onClick={() => { onApply(NO_FEED_FILTERS); onClose(); }}
            style={css('border:none;background:none;color:var(--ag-crimson);font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;')}
          >
            Reset
          </button>
        </div>

        {/* ── Price ── */}
        <div style={css('font-weight:800;font-size:14px;margin-top:18px;')}>Price range</div>
        <div style={css('display:flex;justify-content:space-between;font-size:13px;color:var(--ag-muted);font-weight:700;margin-top:8px;')}>
          <span>₹0</span>
          <span style={css('color:var(--ag-crimson);')}>{fmt(draft.maxPrice)}{draft.maxPrice >= FEED_MAX_PRICE ? '+' : ''}</span>
        </div>
        <input
          type="range"
          min={0}
          max={FEED_MAX_PRICE}
          step={100}
          value={draft.maxPrice}
          onChange={(e) => set('maxPrice', +e.target.value)}
          aria-label="Maximum price"
          aria-valuetext={fmt(draft.maxPrice)}
          style={css('width:100%;accent-color:#D6336C;margin-top:6px;height:24px;')}
        />

        {/* ── Availability ── the three yes/no ones together, because they are
            about whether a piece can be had rather than what it is. */}
        {heading('Availability')}
        <div style={css('display:flex;flex-wrap:wrap;gap:9px;margin-top:10px;')}>
          {([
            { key: 'inStockOnly', label: 'In stock', icon: 'inventory_2' },
            { key: 'newOnly', label: 'New this month', icon: 'auto_awesome' },
            { key: 'verifiedOnly', label: 'Verified boutiques', icon: 'verified' },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => set(t.key, !draft[t.key])}
              aria-pressed={draft[t.key]}
              style={chip(draft[t.key])}
            >
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Category / occasion / fabric ── */}
        {heading('Category')}
        {chipRow(present(names('category'), (c) => catsPresent.has(termKey(c)), (c) => hasTerm(draft.categories, c)), 'categories', draft.categories)}

        {heading('Occasion')}
        {chipRow(present(names('occasion'), (o) => occasionsPresent.has(termKey(o)), (o) => hasTerm(draft.occasions, o)), 'occasions', draft.occasions)}

        {heading('Fabric')}
        {chipRow(present(names('fabric'), (f) => fabricsPresent.has(termKey(f)), (f) => hasTerm(draft.fabrics, f)), 'fabrics', draft.fabrics)}

        {/* ── Size ── canonical ladder, not approval order. */}
        {heading('Size')}
        <div style={css('display:flex;flex-wrap:wrap;gap:9px;margin-top:10px;')}>
          {sizeOptions.map((s) => {
            const on = hasTerm(draft.sizes, s);
            return (
              <button
                key={s}
                onClick={() => toggle('sizes', s)}
                style={css(`min-width:46px;height:44px;padding:0 14px;border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-label)'};border-radius:12px;font-size:13px;font-weight:${on ? 800 : 700};cursor:pointer;font-family:inherit;`)}
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* ── Colour ── swatches, since a colour name is a worse label than the
            colour itself. */}
        {heading('Colour')}
        <div style={css('display:flex;flex-wrap:wrap;gap:12px;margin-top:12px;')}>
          {present(rows('color'), (c) => colorsPresent.has(termKey(c.name)), (c) => hasTerm(draft.colors, c.name)).map((c) => (
            <button
              key={c.name}
              onClick={() => toggle('colors', c.name)}
              aria-pressed={hasTerm(draft.colors, c.name)}
              style={css('display:flex;flex-direction:column;align-items:center;gap:5px;border:none;background:none;cursor:pointer;font-family:inherit;')}
            >
              <span style={css(`width:40px;height:40px;border-radius:50%;background:${hexOf(c.name)};box-shadow:0 0 0 ${hasTerm(draft.colors, c.name) ? '3px #D6336C' : '1px var(--ag-border)'};`)} />
              <span style={css('font-size:11px;font-weight:700;color:var(--ag-label);')}>{c.name}</span>
            </button>
          ))}
        </div>

        {/* ── City ── searched, not listed. */}
        {heading('City')}
        <div className="agx-field" style={css('display:flex;align-items:center;gap:9px;background:var(--ag-surface-2);border:1px solid var(--ag-border-soft);border-radius:13px;padding:0 8px 0 12px;height:44px;margin-top:10px;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);font-size:19px;")}>location_on</span>
          <input
            value={cityQuery}
            onChange={(e) => setCityQuery(e.target.value)}
            placeholder={draft.city ?? 'Search your city…'}
            aria-label="Filter the feed by city"
            style={css('border:none;background:none;flex:1;font-size:13.5px;font-weight:600;color:var(--ag-ink);min-width:0;')}
          />
          {(cityQuery || draft.city) && (
            <button
              onClick={() => { setCityQuery(''); set('city', null); }}
              aria-label={draft.city ? 'Clear the selected city' : 'Clear the city search'}
              style={css('width:32px;height:32px;flex:none;border-radius:10px;border:none;background:var(--ag-surface);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
            >
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:18px;")}>close</span>
            </button>
          )}
        </div>
        <div style={css('display:flex;flex-wrap:wrap;gap:9px;margin-top:10px;')}>
          {cityMatches.map((c) => {
            const on = draft.city === c.name;
            return (
              <button
                key={c.name}
                onClick={() => { set('city', on ? null : c.name); setCityQuery(''); }}
                style={chip(on)}
              >
                {c.name}
                <span style={css('font-size:11px;font-weight:800;opacity:.6;')}>{c.count}</span>
              </button>
            );
          })}
          {cityQuery.trim() && cityMatches.length === 0 && (
            <div style={css('font-size:12.5px;color:var(--ag-muted);font-weight:600;padding:4px 2px;')}>
              No boutiques in a city matching “{cityQuery.trim()}” yet.
            </div>
          )}
        </div>

        {/* ── Commit ── the count is the honest one: it is computed with exactly
            the predicate the feed will run. A filter set that matches nothing
            still applies, so the feed can say so rather than the sheet refusing
            to close. */}
        <div style={css('display:flex;gap:12px;margin-top:24px;')}>
          <button
            onClick={onClose}
            style={css('flex:1;height:52px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;font-weight:700;cursor:pointer;color:var(--ag-crimson);font-family:inherit;')}
          >
            Cancel
          </button>
          <button
            onClick={() => { onApply(draft); onClose(); }}
            style={css('flex:2;height:52px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);font-family:inherit;')}
          >
            Show {matchCount} {matchCount === 1 ? 'piece' : 'pieces'}
            {count > 0 && <span style={css('opacity:.8;font-weight:700;')}> · {count} {count === 1 ? 'filter' : 'filters'}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
