import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { useShop, DEFAULT_FILTERS } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { useDebounced } from '@/hooks/useDebounced';
import { TONES, fmt } from '@/data/demo';

/**
 * The header search box.
 *
 * It was previously an uncontrolled input wired to nothing — typing in it did
 * nothing on any screen. It now searches the live catalogue across product
 * titles, categories, occasions, fabrics, colours and boutique names, shows
 * typed suggestions as you go, and commits the term to `ShopContext.query`,
 * which the results grid filters on.
 *
 * Two shapes, same behaviour:
 *
 *  - `inline` — the always-visible field in the desktop header.
 *  - `icon` — a single button for phones. A permanent full-width field cost the
 *    mobile header an entire second row (~56px of chrome on every screen) for
 *    something used occasionally, so it collapses to an icon beside the profile
 *    avatar and opens a focused search sheet on tap.
 */

type Suggestion =
  | { kind: 'product'; id: string; title: string; sub: string; image: string; tone: number; price: number }
  | { kind: 'boutique'; id: string; title: string; sub: string; logo?: string }
  | { kind: 'term'; id: string; title: string; sub: string };

const MAX_PER_GROUP = 4;

export function GlobalSearch({
  className,
  variant = 'inline',
}: {
  className?: string;
  variant?: 'inline' | 'icon';
}) {
  const navigate = useNavigate();
  const { query, setQuery, setFilters } = useShop();
  const { products, boutiques } = useCatalog();

  // The box keeps its own text so typing stays responsive; the committed term
  // (what the results grid filters on) is only pushed on submit or on picking a
  // suggestion. Seeded from the context so returning to a search keeps it.
  const [text, setText] = useState(query);
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const debounced = useDebounced(text, 140);
  const isSheet = variant === 'icon';

  useEffect(() => setText(query), [query]);

  // Opening the sheet should land the caret in the field, and lock the page
  // behind it so the suggestion list scrolls instead of the storefront.
  useEffect(() => {
    if (!sheetOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focus = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      document.body.style.overflow = previous;
      cancelAnimationFrame(focus);
    };
  }, [sheetOpen]);

  // Close the inline dropdown on an outside click.
  useEffect(() => {
    if (!open || isSheet) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, isSheet]);

  // Escape backs out of the sheet.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  const suggestions = useMemo<Suggestion[]>(() => {
    const q = debounced.trim().toLowerCase();
    if (q.length < 2) return [];

    const productHits = products
      .filter((p) =>
        [p.title, p.cat, p.occasion, p.fabric, p.color, p.boutique].some((f) => f?.toLowerCase().includes(q)),
      )
      .slice(0, MAX_PER_GROUP)
      .map<Suggestion>((p) => ({
        kind: 'product',
        id: p.id,
        title: p.title,
        sub: `${p.cat} · ${p.boutique}`,
        image: p.image,
        tone: p.tone,
        price: p.price,
      }));

    const boutiqueHits = boutiques
      .filter((b) => b.name.toLowerCase().includes(q) || b.city.toLowerCase().includes(q))
      .slice(0, MAX_PER_GROUP)
      .map<Suggestion>((b) => ({ kind: 'boutique', id: b.id, title: b.name, sub: b.city, logo: b.logo }));

    // Category / occasion shortcuts, so "bridal" offers the edit as well as the
    // individual pieces that happen to mention it.
    const facets = new Set<string>();
    products.forEach((p) => {
      if (p.cat?.toLowerCase().includes(q)) facets.add(p.cat);
      if (p.occasion?.toLowerCase().includes(q)) facets.add(p.occasion);
    });
    const termHits = [...facets].slice(0, 3).map<Suggestion>((t) => ({
      kind: 'term',
      id: t,
      title: t,
      sub: 'Browse the edit',
    }));

    return [...termHits, ...productHits, ...boutiqueHits];
  }, [debounced, products, boutiques]);

  const dismiss = () => {
    setOpen(false);
    setSheetOpen(false);
    inputRef.current?.blur();
  };

  const commit = (term: string) => {
    setQuery(term);
    // A fresh search shouldn't inherit filters from a previous browse, or the
    // grid can come back empty for a term that clearly has matches.
    setFilters({ ...DEFAULT_FILTERS });
    dismiss();
    navigate('/buyer/results');
  };

  const pick = (s: Suggestion) => {
    dismiss();
    if (s.kind === 'product') {
      navigate(`/buyer/product/${s.id}`);
      return;
    }
    if (s.kind === 'boutique') {
      navigate(`/buyer/boutique/${s.id}`);
      return;
    }
    // A facet term browses that edit rather than running a text search.
    setText(s.title);
    setQuery('');
    const isCat = products.some((p) => p.cat === s.title);
    setFilters({ ...DEFAULT_FILTERS, ...(isCat ? { cats: [s.title] } : { occasions: [s.title] }) });
    navigate('/buyer/results');
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (active >= 0 && suggestions[active]) pick(suggestions[active]);
    else if (text.trim()) commit(text.trim());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % suggestions.length); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); }
  };

  const clear = () => {
    setText('');
    setQuery('');
    if (!isSheet) setOpen(false);
    inputRef.current?.focus();
  };

  /** The field itself — identical in both shapes. */
  const field = (
    <form
      onSubmit={onSubmit}
      role="search"
      style={css('display:flex;align-items:center;gap:9px;background:var(--ag-surface);border:1px solid var(--ag-border-soft);border-radius:14px;padding:0 8px 0 14px;height:44px;width:100%;box-shadow:0 8px 22px -18px rgba(107,20,54,.6);')}
    >
      <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);font-size:20px;flex:none;")}>search</span>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => { setText(e.target.value); setActive(-1); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        // Deliberately not type="search": WebKit adds its own clear button,
        // which would sit next to ours.
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        aria-label="Search boutiques and styles"
        placeholder="Search boutiques &amp; styles"
        style={css('border:none;background:none;flex:1;font-size:15px;font-weight:600;color:var(--ag-ink);min-width:0;')}
      />
      {text && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          style={css('width:30px;height:30px;flex:none;border-radius:9px;border:none;background:var(--ag-surface-2);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
        >
          <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:18px;")}>close</span>
        </button>
      )}
    </form>
  );

  const term = text.trim();

  /** The suggestion rows — the dropdown on desktop, the sheet body on mobile. */
  const results = (
    <>
      {suggestions.length === 0 ? (
        <div style={css('padding:24px 14px;text-align:center;color:var(--ag-muted);font-size:13.5px;')}>
          Nothing matched “{term}”.
          <button
            onClick={() => commit(term)}
            style={css('display:block;margin:12px auto 0;border:none;background:var(--ag-surface-2);color:var(--ag-crimson);border-radius:10px;padding:9px 15px;font-weight:800;font-size:13px;cursor:pointer;')}
          >
            Search anyway
          </button>
        </div>
      ) : (
        <>
          {suggestions.map((s, i) => (
            <button
              key={`${s.kind}:${s.id}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(s)}
              style={css(`width:100%;display:flex;align-items:center;gap:11px;padding:9px 10px;border:none;border-radius:12px;cursor:pointer;text-align:left;background:${i === active ? '#FCF3F7' : 'transparent'};`)}
            >
              {s.kind === 'product' && (
                <span className="agx-thumb-media" style={css(`width:38px;background:${TONES[s.tone]};`)}>
                  <ImageSlot src={s.image} placeholder={s.title} className="agx-prod-fill" />
                </span>
              )}
              {s.kind === 'boutique' && <BoutiqueLogo name={s.title} src={s.logo} size={38} radius={12} />}
              {s.kind === 'term' && (
                <span style={css('width:38px;height:38px;flex:none;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
                  <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:20px;")}>category</span>
                </span>
              )}
              <span style={css('flex:1;min-width:0;')}>
                <span style={css('display:block;font-size:13.5px;font-weight:800;color:var(--ag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{s.title}</span>
                <span style={css('display:block;font-size:11.5px;color:var(--ag-muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{s.sub}</span>
              </span>
              {s.kind === 'product' && (
                <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:14.5px;flex:none;")}>{fmt(s.price)}</span>
              )}
            </button>
          ))}
          <button
            onClick={() => commit(term)}
            style={css('width:100%;display:flex;align-items:center;justify-content:center;gap:7px;margin-top:4px;padding:12px;border:none;border-top:1px solid var(--ag-surface-2);background:none;cursor:pointer;color:var(--ag-crimson);font-weight:800;font-size:12.5px;')}
          >
            See all results for “{term}”
            <span style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>arrow_forward</span>
          </button>
        </>
      )}
    </>
  );

  /* ---------------- mobile: an icon that opens a search sheet ---------------- */
  if (isSheet) {
    return (
      <>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          aria-label="Search boutiques and styles"
          className={className}
          style={css('width:44px;height:44px;flex:none;border-radius:14px;border:1px solid var(--ag-border-soft);background:var(--ag-surface);cursor:pointer;align-items:center;justify-content:center;box-shadow:0 8px 22px -18px rgba(107,20,54,.6);position:relative;')}
        >
          <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:23px;")}>search</span>
          {/* A live search stays visible as a dot, so the buyer can tell the
              grid is filtered without opening the sheet. */}
          {query.trim() && (
            <span style={css('position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:#D6336C;border:2px solid var(--ag-bg);')} />
          )}
        </button>

        {/* Portalled to the body on purpose: the app header sets
            `backdrop-filter`, which makes it a containing block for fixed
            descendants — a sheet rendered inside it would be trapped there. */}
        {sheetOpen &&
          createPortal(
            <div style={css('position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;animation:agx-fade .18s ease;')}>
              <div onClick={() => setSheetOpen(false)} style={css('position:absolute;inset:0;background:rgba(42,10,24,.45);backdrop-filter:blur(3px);')} />

              <div style={css('position:relative;background:var(--ag-bg);border-bottom:1px solid var(--ag-border-soft);padding:calc(10px + env(safe-area-inset-top)) 12px 12px;display:flex;align-items:center;gap:10px;')}>
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  aria-label="Close search"
                  style={css('width:40px;height:40px;flex:none;border-radius:13px;border:none;background:var(--ag-surface-2);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
                >
                  <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:22px;")}>arrow_back</span>
                </button>
                <div style={css('flex:1;min-width:0;')}>{field}</div>
              </div>

              <div
                className="agx-scroll"
                style={css('position:relative;flex:1;min-height:0;overflow-y:auto;background:var(--ag-surface);padding:6px 8px calc(16px + env(safe-area-inset-bottom));')}
              >
                {term.length >= 2 ? (
                  results
                ) : (
                  <div style={css('padding:38px 24px;text-align:center;')}>
                    <span style={css("font-family:'Material Symbols Outlined';font-size:36px;color:#E7A9C1;")}>search</span>
                    <div style={css('color:var(--ag-muted);font-size:13.5px;margin-top:10px;line-height:1.55;')}>
                      Search for a saree, a boutique, or an occasion like “bridal”.
                    </div>
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )}
      </>
    );
  }

  /* ---------------- desktop: an inline field with a dropdown ---------------- */
  return (
    <div ref={boxRef} className={className} style={css('position:relative;')}>
      {field}
      {open && term.length >= 2 && (
        <div
          className="agx-scroll"
          style={css('position:absolute;left:0;right:0;top:52px;z-index:80;max-height:min(60vh,420px);overflow-y:auto;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;box-shadow:0 26px 60px -26px rgba(107,20,54,.55);padding:6px;')}
        >
          {results}
        </div>
      )}
    </div>
  );
}
