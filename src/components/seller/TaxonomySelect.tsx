import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useTaxonomy } from '@/state/TaxonomyContext';
import { requestTaxonomy, KIND_LABEL, type TaxonomyKind } from '@/data/taxonomy';

/**
 * A managed dropdown for one of the catalogue vocabularies, with a way out.
 *
 * These fields used to be free-text, which is how the catalogue ended up with
 * "Saree", "Sarees" and "SAREES" as three separate filter chips. A closed
 * dropdown fixes that but creates the opposite problem — the seller with a
 * genuine Dupatta has nowhere to put it and picks the nearest wrong answer.
 *
 * So: pick from the list, or ask for a new one. The request goes to the admin
 * queue and the seller carries on — their product saves and sells under the
 * requested name immediately. What waits for approval is the *browse facet*:
 * the collection tile and the filter chip on the buyer side. That is the honest
 * trade. A seller is never blocked from listing by a queue they cannot see, and
 * the buyer's filters never fill up with one-off spellings.
 */

const SELECT =
  "width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface) url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23B02454' stroke-width='2.5' stroke-linecap='round'><path d='M6 9l6 6 6-6'/></svg>\") no-repeat right 14px center;border-radius:13px;padding:0 40px 0 14px;height:50px;font-size:14px;font-weight:600;color:var(--ag-ink);box-sizing:border-box;font-family:inherit;appearance:none;-webkit-appearance:none;cursor:pointer;";
const SELECT_ERR = SELECT.replace('var(--ag-border)', 'var(--ag-border)');
const LABEL = 'display:block;font-size:13px;font-weight:700;color:var(--ag-label);';
const ERR = 'display:block;margin-top:4px;font-size:11.5px;font-weight:700;color:#D6455A;';
const HINT = 'display:block;margin-top:5px;font-size:11.5px;font-weight:600;color:#A98D99;line-height:1.5;';

const ADD_NEW = '__add_new__';

export function TaxonomySelect({
  kind,
  label,
  value,
  onChange,
  error,
  boutiqueId,
  requestable = true,
}: {
  kind: TaxonomyKind;
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  boutiqueId?: string;
  /** Colours and sizes are admin-managed, so they get the dropdown without the
   *  "add new" escape hatch. */
  requestable?: boolean;
}) {
  const { showToast } = useShop();
  const { names, myRequests, reload } = useTaxonomy();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const approved = names(kind);

  /** This seller's own request for this vocabulary, if any is outstanding. */
  const pending = useMemo(
    () => myRequests.filter((r) => r.kind === kind && r.status === 'pending').map((r) => r.name),
    [myRequests, kind],
  );

  const rejected = useMemo(
    () => myRequests.find((r) => r.kind === kind && r.status === 'rejected' && r.name === value),
    [myRequests, kind, value],
  );

  /**
   * A product saved before this vocabulary existed can hold a name that is not
   * in any list. Carrying it as an option is what stops opening the edit form
   * from silently blanking the field — and re-saving from silently changing the
   * product's category to whatever happened to be first.
   */
  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; note?: string }[] = [];
    for (const n of approved) {
      if (seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      out.push({ name: n });
    }
    for (const n of pending) {
      if (seen.has(n.toLowerCase())) continue;
      seen.add(n.toLowerCase());
      out.push({ name: n, note: 'awaiting approval' });
    }
    if (value && !seen.has(value.toLowerCase())) {
      out.push({ name: value, note: 'not in the list yet' });
    }
    return out;
  }, [approved, pending, value]);

  const isPending = pending.some((n) => n.toLowerCase() === value.toLowerCase());

  const submitRequest = async () => {
    const name = draft.trim();
    if (name.length < 2) {
      showToast('Enter at least two characters');
      return;
    }
    setBusy(true);
    try {
      const { duplicate } = await requestTaxonomy({ kind, name, boutiqueId });
      onChange(name);
      setAdding(false);
      setDraft('');
      showToast(
        duplicate
          ? `“${name}” already exists — selected it for you`
          : `“${name}” sent to Agilam for approval`,
      );
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not send the request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label style={css(LABEL)}>
        {label}
        <select
          value={value}
          onChange={(e) => {
            if (e.target.value === ADD_NEW) {
              setAdding(true);
              setDraft('');
              return;
            }
            onChange(e.target.value);
          }}
          style={css(error ? SELECT_ERR : SELECT)}
        >
          <option value="">Select {KIND_LABEL[kind].toLowerCase()}…</option>
          {options.map((o) => (
            <option key={o.name} value={o.name}>
              {o.note ? `${o.name} · ${o.note}` : o.name}
            </option>
          ))}
          {requestable && <option value={ADD_NEW}>＋ Add a new {KIND_LABEL[kind].toLowerCase()}…</option>}
        </select>
      </label>

      {error && <span style={css(ERR)}>{error}</span>}

      {/* Inline request row — deliberately not a modal. Asking for a new
          category is a two-second aside in the middle of listing a product,
          not a task of its own. */}
      {adding && (
        <div style={css('margin-top:8px;border:1.5px dashed var(--ag-border);background:var(--ag-surface-2);border-radius:13px;padding:12px;')}>
          <div style={css('font-size:12px;font-weight:700;color:var(--ag-crimson);')}>
            New {KIND_LABEL[kind].toLowerCase()}
          </div>
          <div style={css('display:flex;gap:8px;margin-top:8px;')}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitRequest()}
              autoFocus
              maxLength={40}
              placeholder={kind === 'category' ? 'e.g. Dupattas' : kind === 'fabric' ? 'e.g. Tussar Silk' : 'e.g. Sangeet'}
              style={css('flex:1;min-width:0;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:11px;padding:0 12px;height:44px;font-size:14px;font-weight:600;font-family:inherit;color:var(--ag-ink);')}
            />
            <button
              type="button"
              onClick={submitRequest}
              disabled={busy}
              style={css(`flex:none;border:none;border-radius:11px;padding:0 18px;height:44px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13px;font-family:inherit;cursor:${busy ? 'default' : 'pointer'};opacity:${busy ? 0.7 : 1};`)}
            >
              {busy ? 'Sending…' : 'Request'}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setDraft(''); }}
              style={css('flex:none;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:11px;width:44px;height:44px;cursor:pointer;display:flex;align-items:center;justify-content:center;')}
            >
              <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:var(--ag-muted-soft);")}>close</span>
            </button>
          </div>
          <span style={css(HINT)}>
            Your product goes live under this name straight away. Once our team approves it, buyers can browse by it too.
          </span>
        </div>
      )}

      {isPending && !adding && (
        <span style={css('display:flex;align-items:flex-start;gap:6px;margin-top:6px;font-size:11.5px;font-weight:600;color:var(--ag-warn-text);line-height:1.5;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:15px;flex:none;")}>schedule</span>
          Awaiting approval — your product still sells under this name; buyers will be able to browse by it once we approve.
        </span>
      )}

      {rejected && !adding && (
        <span style={css('display:flex;align-items:flex-start;gap:6px;margin-top:6px;font-size:11.5px;font-weight:600;color:var(--ag-bad-text);line-height:1.5;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:15px;flex:none;")}>cancel</span>
          Not approved{rejected.review_note ? ` — ${rejected.review_note}` : ''}. Please pick the closest option instead.
        </span>
      )}
    </div>
  );
}
