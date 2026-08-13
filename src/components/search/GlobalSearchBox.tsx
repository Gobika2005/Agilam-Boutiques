import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useGlobalSearch } from '@/hooks/useGlobalSearch';
import { MIN_TERM } from '@/lib/search/query';
import { recentSearches, rememberSearch, clearRecentSearches } from '@/lib/search/recent';
import { SearchRow, SearchGroupLabel } from './SearchRow';
import type { SearchHit, SearchSource } from '@/lib/search/types';

/**
 * The one search box, used by all three consoles.
 *
 * Buyer, seller and admin used to have three unrelated answers to the same
 * question — the storefront had a working box, the seller console had a
 * separate page reached by an icon, and the admin header had an `<input>` wired
 * to nothing at all. They now share this component and differ only in which
 * sources they pass in, which is the part that genuinely differs.
 *
 * Three shapes:
 *
 *  - `inline`   — an always-visible field with a dropdown (buyer desktop).
 *  - `compact`  — the same, sized for a console header (seller/admin desktop).
 *  - `icon`     — a single button that opens a full-screen sheet (phones).
 */

export type GlobalSearchBoxProps<C> = {
  sources: SearchSource<C>[];
  ctx: C;
  /** Where "See all results" goes; `?q=` is appended. */
  resultsPath: string;
  /** localStorage namespace for recent terms — one per console. */
  recentKey: string;
  placeholder?: string;
  /** The line shown in the empty sheet, before anything is typed. */
  hint?: string;
  ariaLabel?: string;
  variant?: 'inline' | 'compact' | 'icon';
  className?: string;
  /** Seeds the field, e.g. from `?q=` on the results page. */
  initialTerm?: string;
  /**
   * Overrides what pressing Enter does. The storefront needs to push the term
   * into `ShopContext` and reset filters as well as navigate, which no other
   * console does.
   */
  onCommit?: (term: string) => void;
  /** Shown as a dot on the icon variant — the buyer's live filtered state. */
  badge?: boolean;
};

export function GlobalSearchBox<C>({
  sources,
  ctx,
  resultsPath,
  recentKey,
  placeholder = 'Search…',
  hint,
  ariaLabel = 'Search',
  variant = 'inline',
  className,
  initialTerm = '',
  onCommit,
  badge,
}: GlobalSearchBoxProps<C>) {
  const navigate = useNavigate();
  const [text, setText] = useState(initialTerm);
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useState<string[]>(() => recentSearches(recentKey));
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isSheet = variant === 'icon';
  const { outcome, flat, loading, active: hasTerm } = useGlobalSearch({ sources, ctx, term: text });

  useEffect(() => setText(initialTerm), [initialTerm]);

  // A new result set invalidates the highlighted index.
  useEffect(() => setActive(-1), [outcome.term]);

  // Opening the sheet lands the caret in the field and locks the page behind it,
  // so the result list scrolls instead of the page under it.
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  const dismiss = () => {
    setOpen(false);
    setSheetOpen(false);
    inputRef.current?.blur();
  };

  const commit = (raw: string) => {
    const t = raw.trim();
    if (t.length < MIN_TERM) return;
    setRecent(rememberSearch(recentKey, t));
    dismiss();
    if (onCommit) onCommit(t);
    else navigate(`${resultsPath}?q=${encodeURIComponent(t)}`);
  };

  const pick = (hit: SearchHit) => {
    setRecent(rememberSearch(recentKey, text.trim()));
    dismiss();
    navigate(hit.to);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (active >= 0 && flat[active]) pick(flat[active]);
    else commit(text);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (flat.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % flat.length);
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? flat.length - 1 : i - 1));
    }
  };

  const clear = () => {
    setText('');
    setOpen(!isSheet ? false : true);
    inputRef.current?.focus();
  };

  const term = text.trim();

  /** Flat index of each hit, so arrow keys and hover agree across groups. */
  const indexOf = useMemo(() => {
    const map = new Map<string, number>();
    flat.forEach((h, i) => map.set(`${h.group}:${h.id}`, i));
    return map;
  }, [flat]);

  const fieldHeight = variant === 'compact' ? 40 : 44;
  const field = (
    <form
      onSubmit={onSubmit}
      role="search"
      className="agx-field"
      style={css(
        variant === 'compact'
          ? `display:flex;align-items:center;gap:8px;background:var(--ag-surface-2);border:1px solid var(--ag-border-soft);border-radius:12px;padding:0 6px 0 12px;height:${fieldHeight}px;width:100%;`
          : `display:flex;align-items:center;gap:9px;background:var(--ag-surface);border:1px solid var(--ag-border-soft);border-radius:14px;padding:0 8px 0 14px;height:${fieldHeight}px;width:100%;box-shadow:0 8px 22px -18px rgba(107,20,54,.6);`,
      )}
    >
      <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);font-size:20px;flex:none;")}>
        search
      </span>
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        // Deliberately not type="search": WebKit adds its own clear button,
        // which would sit next to ours.
        type="text"
        inputMode="search"
        enterKeyHint="search"
        autoComplete="off"
        aria-label={ariaLabel}
        placeholder={placeholder}
        style={css(
          `border:none;background:none;flex:1;font-size:${variant === 'compact' ? 13 : 15}px;font-weight:600;color:var(--ag-ink);min-width:0;font-family:inherit;`,
        )}
      />
      {loading && (
        <span
          aria-hidden="true"
          className="agx-search-spin"
          style={css('width:14px;height:14px;flex:none;border-radius:50%;border:2px solid var(--ag-border);border-top-color:var(--ag-crimson);')}
        />
      )}
      {text && !loading && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          style={css(
            'width:30px;height:30px;flex:none;border-radius:9px;border:none;background:var(--ag-surface-3);cursor:pointer;display:flex;align-items:center;justify-content:center;',
          )}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:18px;")}>
            close
          </span>
        </button>
      )}
    </form>
  );

  const emptyState = (
    <div style={css('padding:24px 14px;text-align:center;color:var(--ag-muted);font-size:13.5px;')}>
      Nothing matched “{term}”.
      <button
        type="button"
        onClick={() => commit(term)}
        style={css(
          'display:block;margin:12px auto 0;border:none;background:var(--ag-surface-2);color:var(--ag-crimson);border-radius:10px;padding:9px 15px;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;',
        )}
      >
        Search anyway
      </button>
    </div>
  );

  const recentPanel = recent.length > 0 && (
    <>
      <div style={css('display:flex;align-items:center;justify-content:space-between;padding:10px 10px 4px;')}>
        <span className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-muted);letter-spacing:.08em;text-transform:uppercase;font-weight:800;')}>
          Recent
        </span>
        <button
          type="button"
          onClick={() => {
            clearRecentSearches(recentKey);
            setRecent([]);
          }}
          style={css('border:none;background:none;color:var(--ag-muted-soft);font-size:11.5px;font-weight:700;cursor:pointer;font-family:inherit;')}
        >
          Clear
        </button>
      </div>
      {recent.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => {
            setText(r);
            commit(r);
          }}
          style={css(
            'width:100%;display:flex;align-items:center;gap:11px;padding:9px 10px;border:none;border-radius:12px;cursor:pointer;text-align:left;background:transparent;font-family:inherit;',
          )}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);font-size:19px;")}>
            history
          </span>
          <span style={css('font-size:13.5px;font-weight:700;color:var(--ag-ink);')}>{r}</span>
        </button>
      ))}
    </>
  );

  const results = (
    <>
      {outcome.degraded.length > 0 && (
        <div
          role="status"
          style={css(
            'margin:6px 6px 2px;padding:8px 10px;border-radius:10px;background:var(--ag-gold-bg);color:var(--ag-gold-text);font-size:11.5px;font-weight:700;line-height:1.45;',
          )}
        >
          Could not search {outcome.degraded.join(', ')} — that data may need a migration applied.
        </div>
      )}

      {outcome.total === 0 ? (
        loading ? (
          <div style={css('padding:24px 14px;text-align:center;color:var(--ag-muted);font-size:13px;')}>Searching…</div>
        ) : (
          emptyState
        )
      ) : (
        <>
          {outcome.groups.map((g) => (
            <div key={g.key}>
              <SearchGroupLabel label={g.label} icon={g.icon} />
              {g.hits.map((h) => {
                const i = indexOf.get(`${h.group}:${h.id}`) ?? -1;
                return (
                  <SearchRow key={`${h.group}:${h.id}`} hit={h} active={i === active} onHover={() => setActive(i)} onPick={() => pick(h)} />
                );
              })}
            </div>
          ))}
          <button
            type="button"
            onClick={() => commit(term)}
            style={css(
              'width:100%;display:flex;align-items:center;justify-content:center;gap:7px;margin-top:4px;padding:12px;border:none;border-top:1px solid var(--ag-surface-2);background:none;cursor:pointer;color:var(--ag-crimson);font-weight:800;font-size:12.5px;font-family:inherit;',
            )}
          >
            See all results for “{term}”
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>
              arrow_forward
            </span>
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
          aria-label={ariaLabel}
          className={className}
          style={css(
            'width:44px;height:44px;flex:none;border-radius:14px;border:1px solid var(--ag-border-soft);background:var(--ag-surface);cursor:pointer;align-items:center;justify-content:center;box-shadow:0 8px 22px -18px rgba(107,20,54,.6);position:relative;display:flex;',
          )}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:23px;")}>
            search
          </span>
          {badge && (
            <span
              style={css('position:absolute;top:-3px;right:-3px;width:10px;height:10px;border-radius:50%;background:#D6336C;border:2px solid var(--ag-bg);')}
            />
          )}
        </button>

        {/* Portalled to the body on purpose: the app header sets
            `backdrop-filter`, which makes it a containing block for fixed
            descendants — a sheet rendered inside it would be trapped there. */}
        {sheetOpen &&
          createPortal(
            <div style={css('position:fixed;inset:0;z-index:200;display:flex;flex-direction:column;animation:agx-fade .18s ease;')}>
              <div onClick={() => setSheetOpen(false)} style={css('position:absolute;inset:0;background:rgba(42,10,24,.45);backdrop-filter:blur(3px);')} />

              <div
                style={css(
                  'position:relative;background:var(--ag-bg);border-bottom:1px solid var(--ag-border-soft);padding:calc(10px + env(safe-area-inset-top)) 12px 12px;display:flex;align-items:center;gap:10px;',
                )}
              >
                <button
                  type="button"
                  onClick={() => setSheetOpen(false)}
                  aria-label="Close search"
                  style={css(
                    'width:40px;height:40px;flex:none;border-radius:13px;border:none;background:var(--ag-surface-2);cursor:pointer;display:flex;align-items:center;justify-content:center;',
                  )}
                >
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:22px;")}>
                    arrow_back
                  </span>
                </button>
                <div style={css('flex:1;min-width:0;')}>{field}</div>
              </div>

              <div
                className="agx-scroll"
                style={css(
                  'position:relative;flex:1;min-height:0;overflow-y:auto;background:var(--ag-surface);padding:6px 8px calc(16px + env(safe-area-inset-bottom));',
                )}
              >
                {hasTerm ? (
                  results
                ) : (
                  <>
                    {recentPanel}
                    <div style={css('padding:38px 24px;text-align:center;')}>
                      <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:36px;color:var(--ag-border);")}>
                        search
                      </span>
                      <div style={css('color:var(--ag-muted);font-size:13.5px;margin-top:10px;line-height:1.55;')}>{hint ?? placeholder}</div>
                    </div>
                  </>
                )}
              </div>
            </div>,
            document.body,
          )}
      </>
    );
  }

  /* ---------------- desktop: an inline field with a dropdown ---------------- */
  const showDropdown = open && (hasTerm || recent.length > 0);
  return (
    <div ref={boxRef} className={className} style={css('position:relative;')}>
      {field}
      {showDropdown && (
        <div
          className="agx-scroll"
          style={css(
            // The compact field sits at the right edge of a console header and
            // is narrower than its own results, so the panel is anchored to its
            // right edge — stretched from the left it would hang off-screen.
            `position:absolute;top:${fieldHeight + 8}px;${variant === 'compact' ? 'right:0;left:auto;width:min(360px,calc(100vw - 32px));' : 'left:0;right:0;'}z-index:80;max-height:min(70vh,460px);overflow-y:auto;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;box-shadow:0 26px 60px -26px rgba(107,20,54,.55);padding:6px;`,
          )}
        >
          {hasTerm ? results : recentPanel}
        </div>
      )}
    </div>
  );
}
