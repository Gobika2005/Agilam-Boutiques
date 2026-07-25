import type { ReactNode } from 'react';
import { css } from '@/lib/css';

/**
 * Field primitives shared by the seller setup wizard and the seller settings
 * screens. The design is ported from inline-styled markup (see @/lib/css), so
 * these wrappers exist to keep one copy of each style string rather than
 * repeating it across ~40 onboarding inputs.
 */

const INPUT = 'width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;padding:0 14px;height:50px;font-size:14px;font-weight:600;color:var(--ag-ink);box-sizing:border-box;font-family:inherit;';
const INPUT_ERR = INPUT.replace('var(--ag-border)', '#E7A7B4').replace('background:var(--ag-surface)', 'background:var(--ag-surface-2)');
const TEXTAREA = 'width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;padding:12px 14px;font-size:14px;font-weight:500;color:var(--ag-ink);box-sizing:border-box;font-family:inherit;resize:vertical;min-height:88px;';
const LABEL = 'display:block;font-size:13px;font-weight:700;color:var(--ag-label);';
const ERR = 'display:block;margin-top:4px;font-size:11.5px;font-weight:700;color:#D6455A;';
const HINT = 'display:block;margin-top:4px;font-size:11.5px;font-weight:600;color:#A98D99;';

export function Field({
  label, value, onChange, placeholder, error, hint, type = 'text', inputMode, maxLength, disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  type?: string;
  inputMode?: 'text' | 'numeric' | 'tel' | 'email' | 'url';
  maxLength?: number;
  disabled?: boolean;
}) {
  return (
    <label style={css(LABEL)}>
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        type={type}
        inputMode={inputMode}
        maxLength={maxLength}
        disabled={disabled}
        style={css(`${error ? INPUT_ERR : INPUT}${disabled ? 'opacity:.6;' : ''}`)}
      />
      {error ? <span style={css(ERR)}>{error}</span> : hint ? <span style={css(HINT)}>{hint}</span> : null}
    </label>
  );
}

export function TextArea({
  label, value, onChange, placeholder, error, hint, maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  hint?: string;
  maxLength?: number;
}) {
  return (
    <label style={css(LABEL)}>
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        style={css(error ? TEXTAREA.replace('var(--ag-border)', '#E7A7B4') : TEXTAREA)}
      />
      {error ? <span style={css(ERR)}>{error}</span> : hint ? <span style={css(HINT)}>{hint}</span> : null}
    </label>
  );
}

/** A row of pills — one pick by default, any number of them with `multiple`. */
export function ChipPicker({
  label, options, value, onChange, error, multiple, hint,
}: {
  label: string;
  options: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  error?: string;
  multiple?: boolean;
  hint?: string;
}) {
  const toggle = (opt: string) => {
    if (!multiple) return onChange(value[0] === opt ? [] : [opt]);
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  };

  return (
    <div>
      <div style={css(LABEL)}>{label}</div>
      <div style={css('display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;')}>
        {options.map((opt) => {
          const on = value.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              style={css(`padding:9px 14px;border-radius:11px;border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-ink-2)'};font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;`)}
            >
              {opt}
            </button>
          );
        })}
      </div>
      {error ? <span style={css(ERR)}>{error}</span> : hint ? <span style={css(HINT)}>{hint}</span> : null}
    </div>
  );
}

export function Toggle({
  label, description, icon, on, onChange,
}: {
  label: string;
  description?: string;
  icon?: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={css('width:100%;display:flex;align-items:center;gap:12px;padding:13px 14px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;cursor:pointer;text-align:left;font-family:inherit;')}
    >
      {icon && (
        <span style={css('width:36px;height:36px;flex:none;border-radius:11px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:19px;")}>{icon}</span>
        </span>
      )}
      <span style={css('flex:1;min-width:0;')}>
        <span style={css('display:block;font-weight:700;font-size:14px;color:var(--ag-ink);')}>{label}</span>
        {description && <span style={css('display:block;font-size:11.5px;color:#A98D99;font-weight:600;margin-top:2px;')}>{description}</span>}
      </span>
      <span style={css(`width:46px;height:27px;flex:none;border-radius:999px;background:${on ? '#D6336C' : '#E8D5DE'};position:relative;transition:background .18s;`)}>
        <span style={css(`position:absolute;top:3px;left:${on ? '22px' : '3px'};width:21px;height:21px;border-radius:50%;background:var(--ag-surface);box-shadow:0 2px 6px rgba(0,0,0,.2);transition:left .18s;`)} />
      </span>
    </button>
  );
}

/** A titled block inside a step or a settings page. */
export function SectionCard({ title, subtitle, children }: { title?: string; subtitle?: string; children: ReactNode }) {
  return (
    <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:18px;box-shadow:0 16px 38px -30px rgba(107,20,54,.6);')}>
      {title && <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:19px;color:var(--ag-ink);")}>{title}</div>}
      {subtitle && <div style={css('font-size:12.5px;color:#A98D99;font-weight:600;margin-top:3px;')}>{subtitle}</div>}
      <div style={css(`display:flex;flex-direction:column;gap:14px;${title || subtitle ? 'margin-top:16px;' : ''}`)}>{children}</div>
    </div>
  );
}

/** Two fields side by side on wide screens, stacked on a phone. */
export function Row({ children }: { children: ReactNode }) {
  return <div className="agx-form-row" style={css('display:grid;grid-template-columns:1fr 1fr;gap:14px;')}>{children}</div>;
}
