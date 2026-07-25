import { css } from '@/lib/css';
import type { CouponInput, CouponType } from '@/data/coupons';
import type { CouponFieldErrors } from '@/lib/couponForm';

/**
 * The create/edit coupon form body, shared by the admin console and the seller
 * app so the two never drift. The host supplies the surrounding chrome (a drawer,
 * a sheet) and the save button; this only renders the labelled fields.
 */

const field = 'width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:12px;padding:0 13px;height:46px;font-size:14px;font-weight:600;color:var(--ag-ink);box-sizing:border-box;font-family:inherit;';
const label = 'font-size:12.5px;font-weight:800;color:var(--ag-label);display:block;';
const errStyle = 'display:block;margin-top:4px;font-size:11.5px;font-weight:700;color:#D6455A;';

function Err({ msg }: { msg?: string }) {
  return msg ? <span style={css(errStyle)}>{msg}</span> : null;
}

export function CouponFormFields({
  input,
  onChange,
  errors,
  allowShip,
}: {
  input: CouponInput;
  onChange: (patch: Partial<CouponInput>) => void;
  errors: CouponFieldErrors;
  allowShip: boolean;
}) {
  const types: { value: CouponType; label: string }[] = [
    { value: 'pct', label: 'Percentage off' },
    { value: 'flat', label: 'Flat amount off (₹)' },
    ...(allowShip ? [{ value: 'ship' as CouponType, label: 'Free delivery' }] : []),
  ];

  return (
    <div style={css('display:flex;flex-direction:column;gap:14px;')}>
      <label style={css(label)}>
        Coupon code
        <input
          value={input.code}
          onChange={(e) => onChange({ code: e.target.value.toUpperCase().replace(/\s+/g, '') })}
          placeholder="FESTIVE10"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          style={css(field + 'letter-spacing:.05em;text-transform:uppercase;')}
        />
        <Err msg={errors.code} />
      </label>

      <label style={css(label)}>
        Discount type
        <select value={input.type} onChange={(e) => onChange({ type: e.target.value as CouponType })} style={css(field + 'cursor:pointer;')}>
          {types.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <Err msg={errors.type} />
      </label>

      {input.type !== 'ship' && (
        <div style={css('display:flex;gap:12px;')}>
          <label style={css(label + 'flex:1;')}>
            {input.type === 'pct' ? 'Percentage (%)' : 'Amount off (₹)'}
            <input
              type="number"
              inputMode="numeric"
              value={Number.isFinite(input.off) ? input.off : ''}
              onChange={(e) => onChange({ off: Number(e.target.value) })}
              placeholder={input.type === 'pct' ? '10' : '500'}
              style={css(field)}
            />
            <Err msg={errors.off} />
          </label>

          {input.type === 'pct' && (
            <label style={css(label + 'flex:1;')}>
              Max discount (₹)
              <input
                type="number"
                inputMode="numeric"
                value={input.max_discount ?? ''}
                onChange={(e) => onChange({ max_discount: e.target.value === '' ? null : Number(e.target.value) })}
                placeholder="Optional"
                style={css(field)}
              />
              <Err msg={errors.max_discount} />
            </label>
          )}
        </div>
      )}

      <label style={css(label)}>
        Minimum order value (₹)
        <input
          type="number"
          inputMode="numeric"
          value={Number.isFinite(input.min_subtotal) ? input.min_subtotal : ''}
          onChange={(e) => onChange({ min_subtotal: Number(e.target.value) })}
          placeholder="0"
          style={css(field)}
        />
        <span style={css('display:block;margin-top:5px;font-size:11.5px;color:#A98D99;font-weight:600;')}>
          {input.boutique_id
            ? 'Measured against just your boutique’s items in the bag.'
            : '0 means no minimum. Measured against the whole cart.'}
        </span>
        <Err msg={errors.min_subtotal} />
      </label>

      <label style={css(label)}>
        Description <span style={css('font-weight:600;color:#A98B98;')}>· shown to buyers</span>
        <input
          value={input.description}
          onChange={(e) => onChange({ description: e.target.value })}
          placeholder="Festive season saver"
          maxLength={80}
          style={css(field)}
        />
      </label>

      <label style={css(label)}>
        Expires on
        <input
          type="date"
          value={input.expires_at}
          onChange={(e) => onChange({ expires_at: e.target.value })}
          style={css(field)}
        />
        <Err msg={errors.expires_at} />
      </label>

      <label style={css('display:flex;align-items:center;gap:10px;cursor:pointer;font-size:13px;font-weight:700;color:var(--ag-ink-2);')}>
        <input
          type="checkbox"
          checked={input.active ?? true}
          onChange={(e) => onChange({ active: e.target.checked })}
          style={css('width:18px;height:18px;accent-color:#D6336C;cursor:pointer;')}
        />
        Active — buyers can use this code
      </label>
    </div>
  );
}
