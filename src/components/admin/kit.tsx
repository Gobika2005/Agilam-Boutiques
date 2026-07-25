import { useEffect, type ReactNode } from 'react';
import { css } from '@/lib/css';

/**
 * Shared admin UI kit — the premium, consistent primitives every admin page is
 * built from (Shopify/Linear-flavoured, in the app's rose theme). Everything is
 * inline-styled via the `css()` helper to match the rest of the codebase.
 */

export const T = {
  card: 'background:var(--ag-surface);border-radius:18px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);',
  head: 'var(--ag-surface-2)',
  border: 'var(--ag-border-soft)',
  field: 'var(--ag-border)',
  muted: 'var(--ag-muted)',
  ink: 'var(--ag-ink)',
  accent: 'var(--ag-crimson)',
  accent2: '#D6336C',
};

export function Icon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  return (
    <span translate="no" aria-hidden style={css(`font-family:'Material Symbols Outlined';font-size:${size}px;line-height:1;${color ? `color:${color};` : ''}`)}>
      {name}
    </span>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: string }) {
  return <div style={css(T.card + 'padding:20px;' + (style ?? ''))}>{children}</div>;
}

export function SectionCard({ title, action, children, style }: { title: string; action?: ReactNode; children: ReactNode; style?: string }) {
  return (
    <div style={css(T.card + 'padding:20px;' + (style ?? ''))}>
      <div style={css('display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;')}>
        <div style={css('font-weight:800;font-size:15px;')}>{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** Colour map for every status label the admin surfaces. */
const PILL: Record<string, { bg: string; fg: string }> = {
  active: { bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' },
  approved: { bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' },
  delivered: { bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' },
  live: { bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' },
  settled: { bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' },
  paid: { bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' },
  pending: { bg: 'var(--ag-warn-bg)', fg: 'var(--ag-warn-text)' },
  hidden: { bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' },
  paused: { bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' },
  draft: { bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' },
  shipped: { bg: 'var(--ag-info-bg)', fg: 'var(--ag-info-text)' },
  cod: { bg: 'var(--ag-info-bg)', fg: 'var(--ag-info-text)' },
  blocked: { bg: 'var(--ag-bad-bg)', fg: 'var(--ag-bad-text)' },
  rejected: { bg: 'var(--ag-bad-bg)', fg: 'var(--ag-bad-text)' },
  refunded: { bg: 'var(--ag-bad-bg)', fg: 'var(--ag-bad-text)' },
  failed: { bg: 'var(--ag-bad-bg)', fg: 'var(--ag-bad-text)' },
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const s = PILL[status.toLowerCase()] ?? { bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' };
  const text = label ?? status.charAt(0).toUpperCase() + status.slice(1);
  return <span style={css(`font-size:11px;font-weight:800;padding:4px 10px;border-radius:8px;white-space:nowrap;background:${s.bg};color:${s.fg};`)}>{text}</span>;
}

export function StatCard({
  label, value, icon, tint, ic, sub, bars,
}: { label: string; value: string; icon: string; tint: string; ic: string; sub?: string; bars?: number[] }) {
  const max = bars && bars.length ? Math.max(...bars, 1) : 1;
  return (
    <div style={css(T.card + 'padding:18px;')}>
      <div style={css('display:flex;align-items:center;justify-content:space-between;')}>
        <div style={css(`width:38px;height:38px;border-radius:12px;background:${tint};display:flex;align-items:center;justify-content:center;`)}>
          <Icon name={icon} size={21} color={ic} />
        </div>
        {sub && <span style={css(`font-size:12px;font-weight:800;color:${T.muted};`)}>{sub}</span>}
      </div>
      <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:30px;line-height:1;margin-top:14px;")}>{value}</div>
      <div style={css(`color:${T.muted};font-size:12.5px;font-weight:600;margin-top:3px;`)}>{label}</div>
      {bars && bars.length > 0 && (
        <div style={css('display:flex;align-items:flex-end;gap:3px;height:34px;margin-top:12px;')}>
          {bars.map((b, i) => (
            <div key={i} style={css(`flex:1;border-radius:3px 3px 1px 1px;background:linear-gradient(180deg,#E7719F,#D6336C);height:${Math.max(6, Math.round((b / max) * 100))}%;`)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div style={css(`display:flex;align-items:center;gap:8px;background:var(--ag-surface);border:1.5px solid ${T.field};border-radius:12px;padding:0 12px;height:42px;flex:1;min-width:180px;`)}>
      <Icon name="search" size={19} color="var(--ag-muted-soft)" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? 'Search…'} style={css('border:none;background:none;flex:1;font-size:13.5px;min-width:0;font-family:inherit;color:var(--ag-ink);')} />
      {value && <button type="button" aria-label="Clear search" onClick={() => onChange('')} style={css('border:none;background:none;cursor:pointer;color:var(--ag-muted-soft);display:flex;')}><Icon name="close" size={18} /></button>}
    </div>
  );
}

export function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={css(`height:42px;border:1.5px solid ${T.field};border-radius:12px;background:var(--ag-surface);font-size:13px;font-weight:700;color:var(--ag-label);padding:0 10px;cursor:pointer;font-family:inherit;`)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function GhostButton({ icon, children, onClick, tone = 'default', title }: { icon?: string; children?: ReactNode; onClick?: () => void; tone?: 'default' | 'danger' | 'primary'; title?: string }) {
  const styles = {
    default: `border:1.5px solid ${T.field};background:var(--ag-surface);color:var(--ag-label);`,
    danger: 'border:1.5px solid #E7A7B4;background:var(--ag-surface);color:#D6455A;',
    primary: 'border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;',
  }[tone];
  return (
    <button type="button" title={title} onClick={onClick} style={css(`height:42px;border-radius:12px;padding:0 14px;font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px;font-family:inherit;${styles}`)}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, onClick, tone = 'default', title }: { icon: string; onClick?: () => void; tone?: 'default' | 'danger' | 'success' | 'warn'; title?: string }) {
  const styles = {
    default: `border:1.5px solid ${T.field};background:var(--ag-surface);color:var(--ag-crimson);`,
    danger: 'border:1.5px solid #E7A7B4;background:var(--ag-surface);color:#D6455A;',
    success: 'border:none;background:var(--ag-good-text);color:#fff;',
    warn: 'border:none;background:var(--ag-warn-bg);color:var(--ag-warn-text);',
  }[tone];
  return (
    <button type="button" title={title} aria-label={title ?? icon} onClick={onClick} style={css(`width:34px;height:34px;flex:none;border-radius:10px;cursor:pointer;display:flex;align-items:center;justify-content:center;${styles}`)}>
      <Icon name={icon} size={18} />
    </button>
  );
}

export function EmptyState({ icon, title, sub }: { icon: string; title: string; sub?: string }) {
  return (
    <div style={css('padding:48px 20px;text-align:center;')}>
      <div style={css(`width:56px;height:56px;border-radius:16px;background:${T.head};display:inline-flex;align-items:center;justify-content:center;`)}>
        <Icon name={icon} size={26} color="var(--ag-muted-soft)" />
      </div>
      <div style={css('font-weight:800;font-size:15px;margin-top:12px;')}>{title}</div>
      {sub && <div style={css(`color:${T.muted};font-size:13px;margin-top:4px;`)}>{sub}</div>}
    </div>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  width?: string; // grid track, e.g. '2fr' | '120px'
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns, rows, loading, getId, empty, selectable, selectedIds, onToggle, onToggleAll, onRowClick,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  getId: (row: T) => string;
  empty?: ReactNode;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggle?: (id: string) => void;
  onToggleAll?: () => void;
  onRowClick?: (row: T) => void;
}) {
  const grid = (selectable ? '44px ' : '') + columns.map((c) => c.width ?? '1fr').join(' ');
  const allChecked = selectable && rows.length > 0 && rows.every((r) => selectedIds?.has(getId(r)));

  return (
    <div style={css(T.card + 'overflow:hidden;')}>
      {/* On phones the columns would crush to unreadable slivers, so the whole
          grid keeps a min-width and scrolls sideways inside this wrapper. */}
      <div className="agx-adm-tablewrap">
        <div className="agx-adm-tablegrid">
          <div style={css(`display:grid;grid-template-columns:${grid};padding:13px 20px;background:${T.head};font-size:11.5px;font-weight:800;color:${T.muted};letter-spacing:.04em;`)}>
            {selectable && (
              <span onClick={onToggleAll} style={css('display:flex;align-items:center;cursor:pointer;')}>
                <Checkbox checked={!!allChecked} />
              </span>
            )}
            {columns.map((c) => <span key={c.key} style={css(`text-align:${c.align ?? 'left'};`)}>{c.header}</span>)}
          </div>

          {loading &&
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={css(`display:grid;grid-template-columns:${grid};padding:15px 20px;border-top:1px solid ${T.border};align-items:center;`)}>
                {(selectable ? [null, ...columns] : columns).map((_c, j) => (
                  <div key={j} style={css('height:12px;border-radius:6px;background:linear-gradient(90deg,#F3E6ED,#FBF3F7,#F3E6ED);width:70%;')} />
                ))}
              </div>
            ))}

          {!loading && rows.length === 0 && (empty ?? <EmptyState icon="inbox" title="Nothing here yet" />)}

          {!loading &&
            rows.map((r) => {
              const id = getId(r);
              return (
                <div
                  key={id}
                  onClick={onRowClick ? () => onRowClick(r) : undefined}
                  style={css(`display:grid;grid-template-columns:${grid};padding:13px 20px;border-top:1px solid ${T.border};align-items:center;${onRowClick ? 'cursor:pointer;' : ''}`)}
                >
                  {selectable && (
                    <span onClick={(e) => { e.stopPropagation(); onToggle?.(id); }} style={css('display:flex;align-items:center;cursor:pointer;')}>
                      <Checkbox checked={!!selectedIds?.has(id)} />
                    </span>
                  )}
                  {columns.map((c) => <div key={c.key} style={css(`text-align:${c.align ?? 'left'};min-width:0;`)}>{c.render(r)}</div>)}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

export function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span style={css(`width:18px;height:18px;border-radius:6px;border:1.5px solid ${checked ? T.accent : 'var(--ag-border)'};background:${checked ? T.accent : 'var(--ag-surface)'};display:flex;align-items:center;justify-content:center;`)}>
      {checked && <Icon name="check" size={14} color="#fff" />}
    </span>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const last = Math.max(0, Math.ceil(total / pageSize) - 1);
  const btn = (disabled: boolean) => css(`width:36px;height:36px;border-radius:10px;border:1.5px solid ${T.field};background:var(--ag-surface);cursor:${disabled ? 'not-allowed' : 'pointer'};opacity:${disabled ? 0.45 : 1};display:flex;align-items:center;justify-content:center;color:var(--ag-label);`);
  return (
    <div style={css('display:flex;align-items:center;justify-content:space-between;margin-top:14px;')}>
      <div style={css(`font-size:12.5px;color:${T.muted};font-weight:600;`)}>{from}–{to} of {total}</div>
      <div style={css('display:flex;gap:8px;')}>
        <button type="button" disabled={page <= 0} onClick={() => onPage(page - 1)} style={btn(page <= 0)}><Icon name="chevron_left" size={18} /></button>
        <button type="button" disabled={page >= last} onClick={() => onPage(page + 1)} style={btn(page >= last)}><Icon name="chevron_right" size={18} /></button>
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose} style={css('position:fixed;inset:0;background:rgba(42,26,32,.45);z-index:50;display:flex;justify-content:flex-end;')}>
      <div onClick={(e) => e.stopPropagation()} className="agx-scroll" style={css('width:460px;max-width:100%;height:100%;background:var(--ag-bg);display:flex;flex-direction:column;box-shadow:-30px 0 70px -30px rgba(107,20,54,.6);')}>
        <div style={css(`flex:none;padding:20px 22px;background:var(--ag-surface);border-bottom:1px solid ${T.border};display:flex;align-items:center;justify-content:space-between;`)}>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>{title}</div>
          <button type="button" onClick={onClose} style={css(`width:36px;height:36px;border-radius:10px;border:1.5px solid ${T.field};background:var(--ag-surface);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--ag-label);`)}><Icon name="close" size={18} /></button>
        </div>
        <div className="agx-scroll" style={css('flex:1;overflow-y:auto;padding:20px 22px;')}>{children}</div>
        {footer && <div style={css(`flex:none;padding:16px 22px;background:var(--ag-surface);border-top:1px solid ${T.border};`)}>{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel, busy }: {
  open: boolean; title: string; message: string; confirmLabel?: string; danger?: boolean; onConfirm: () => void; onCancel: () => void; busy?: boolean;
}) {
  if (!open) return null;
  return (
    <div onClick={onCancel} style={css('position:fixed;inset:0;background:rgba(42,26,32,.45);z-index:60;display:flex;align-items:center;justify-content:center;padding:20px;')}>
      <div onClick={(e) => e.stopPropagation()} style={css('width:400px;max-width:100%;background:var(--ag-surface);border-radius:20px;padding:24px;box-shadow:0 30px 70px -30px rgba(107,20,54,.7);')}>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:21px;")}>{title}</div>
        <div style={css(`color:${T.muted};font-size:13.5px;margin-top:8px;line-height:1.5;`)}>{message}</div>
        <div style={css('display:flex;gap:10px;margin-top:22px;')}>
          <button onClick={onCancel} disabled={busy} style={css(`flex:1;height:48px;border-radius:14px;border:1.5px solid ${T.field};background:var(--ag-surface);color:var(--ag-label);font-weight:700;font-size:14px;cursor:pointer;`)}>Cancel</button>
          <button onClick={onConfirm} disabled={busy} style={css(`flex:1;height:48px;border-radius:14px;border:none;color:#fff;font-weight:800;font-size:14px;cursor:pointer;background:${danger ? 'linear-gradient(135deg,#E4636F,var(--ag-bad-text))' : 'linear-gradient(135deg,#D6336C,#B02454)'};`)}>{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function BulkBar({ count, children }: { count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div style={css('display:flex;align-items:center;gap:12px;background:#2A1A20;color:#fff;border-radius:14px;padding:10px 16px;margin-bottom:14px;box-shadow:0 16px 34px -20px rgba(42,26,32,.7);')}>
      <span style={css('font-weight:800;font-size:13px;')}>{count} selected</span>
      <div style={css('flex:1;')} />
      <div style={css('display:flex;gap:8px;')}>{children}</div>
    </div>
  );
}

export function Avatar({ name, tone }: { name: string; tone: number }) {
  const TONES = ['#F4D6E2', '#F1DCC7', '#E2DAEF', '#D7E7DE', '#F3DFD0', '#E7D9E6', '#DCE4EF', '#F0DAD4'];
  return (
    <div style={css(`width:36px;height:36px;flex:none;border-radius:11px;background:${TONES[tone % TONES.length]};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;color:rgba(42,26,32,.55);`)}>
      {(name?.trim()?.[0] ?? '?').toUpperCase()}
    </div>
  );
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={css('display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid #F0E3EA;')}>
      <span style={css(`font-size:13px;color:${T.muted};font-weight:600;`)}>{label}</span>
      <span style={css('font-size:13px;font-weight:700;text-align:right;')}>{value}</span>
    </div>
  );
}
