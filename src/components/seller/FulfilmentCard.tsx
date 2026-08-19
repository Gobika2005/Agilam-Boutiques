import { css } from '@/lib/css';
import { Field, Row } from '@/components/seller/FormKit';
import { dispatchLabel, returnsDetail, shopFulfilment } from '@/lib/fulfilment';

/**
 * Dispatch time and the shop's return window — the two promises the product
 * page used to make on the seller's behalf.
 *
 * Until migration 0078 a buyer read "3–7 working days" and "7-day easy returns"
 * on every product in the marketplace: the first a single platform estimate that
 * suited neither a ready-stock shop nor a made-to-order one, the second a
 * compile-time constant that did not even agree with the returns flow. Both are
 * the seller's answer now, and this is where they give it.
 *
 * Shared by the setup wizard and seller settings so the two cannot drift.
 */

export type FulfilmentForm = {
  dispatchMin: string;
  dispatchMax: string;
  returnWindowDays: string;
};

export const fulfilmentToForm = (row: {
  dispatch_days_min?: number | null;
  dispatch_days_max?: number | null;
  return_window_days?: number | null;
}): FulfilmentForm => ({
  dispatchMin: String(row.dispatch_days_min ?? 1),
  dispatchMax: String(row.dispatch_days_max ?? 2),
  returnWindowDays: String(row.return_window_days ?? 7),
});

export const fulfilmentToPatch = (f: FulfilmentForm) => {
  const min = Math.max(0, Math.min(60, Number(f.dispatchMin || 0)));
  const max = Math.max(0, Math.min(60, Number(f.dispatchMax || 0)));
  return {
    dispatch_days_min: min,
    // The DB has a CHECK for this; clamping here means the seller gets a sane
    // saved value rather than a constraint violation they cannot act on.
    dispatch_days_max: Math.max(min, max),
    return_window_days: Math.max(0, Math.min(30, Number(f.returnWindowDays || 0))),
  };
};

/** Whether the numbers make sense, for the wizard's per-step validation. */
export function validateFulfilment(f: FulfilmentForm): string | null {
  const min = Number(f.dispatchMin);
  const max = Number(f.dispatchMax);
  if (!Number.isFinite(min) || !Number.isFinite(max) || f.dispatchMin === '' || f.dispatchMax === '') {
    return 'Enter how many working days you take to dispatch';
  }
  if (min < 0 || max < 0) return 'Dispatch days cannot be negative';
  if (max < min) return 'The longest dispatch time cannot be shorter than the shortest';
  if (max > 60) return 'Enter a dispatch time of 60 working days or less';
  const win = Number(f.returnWindowDays);
  if (!Number.isFinite(win) || f.returnWindowDays === '') return 'Enter a return window, or 0 for none';
  if (win < 0 || win > 30) return 'Return window must be between 0 and 30 days';
  return null;
}

export function FulfilmentCard({
  value, onChange, error,
}: {
  value: FulfilmentForm;
  onChange: (next: FulfilmentForm) => void;
  error?: string;
}) {
  const set = (key: keyof FulfilmentForm, raw: string) =>
    onChange({ ...value, [key]: raw.replace(/\D/g, '').slice(0, 2) });

  // Said back in the buyer's words, from the same helper the product page uses,
  // so the seller can see the sentence they are signing up to.
  const preview = shopFulfilment({
    dispatchMin: Number(value.dispatchMin),
    dispatchMax: Number(value.dispatchMax),
    returnWindowDays: Number(value.returnWindowDays),
  });

  return (
    <div style={css('display:flex;flex-direction:column;gap:14px;')}>
      <div style={css('font-size:12px;font-weight:600;color:var(--ag-muted);line-height:1.6;')}>
        Buyers see these on every product you list. Count only the days you need
        to pack and hand over the parcel — the courier’s travel time is added
        separately.
      </div>

      <Row>
        <Field
          label="Dispatch in, from (working days) *"
          value={value.dispatchMin}
          onChange={(v) => set('dispatchMin', v)}
          placeholder="1"
          inputMode="numeric"
          hint="0 means you dispatch the same day."
        />
        <Field
          label="…up to (working days) *"
          value={value.dispatchMax}
          onChange={(v) => set('dispatchMax', v)}
          placeholder="2"
          inputMode="numeric"
          hint="Stitch to order? Set a longer, honest window."
        />
      </Row>

      <Field
        label="Return window (days) *"
        value={value.returnWindowDays}
        onChange={(v) => set('returnWindowDays', v)}
        placeholder="7"
        inputMode="numeric"
        hint="How long after delivery a buyer may return a piece because they changed their mind. 0 = you don’t accept those."
      />

      {/* Zero returns is a legitimate choice and a common one for custom work,
          so it is stated plainly rather than discouraged — but the seller has to
          know that faults are still their responsibility either way. */}
      <div style={css('display:flex;gap:8px;padding:11px 13px;border-radius:12px;background:var(--ag-surface-2);font-size:11.5px;font-weight:600;color:var(--ag-ink-2);line-height:1.6;')}>
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;color:var(--ag-crimson);flex:none;")}>info</span>
        <span>
          <strong style={css('font-weight:800;')}>Buyers will see:</strong> “{dispatchLabel(preview)}”.
          <br />
          {returnsDetail(preview)}
        </span>
      </div>

      {error && <span style={css('font-size:11.5px;font-weight:700;color:var(--ag-danger-text);')}>{error}</span>}
    </div>
  );
}
