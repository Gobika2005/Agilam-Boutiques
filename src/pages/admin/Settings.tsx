import { useEffect, useState } from 'react';
import { css } from '@/lib/css';
import { useAsync } from '@/hooks/useAsync';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { fetchSettings, saveSettings, type PlatformSettings } from '@/data/settings';
import { logAdminAction } from '@/data/activityLog';
import { Card, GhostButton, Icon, T } from '@/components/admin/kit';

type NumField = { key: keyof PlatformSettings; label: string; help: string; prefix?: string; suffix?: string };

const SECTIONS: { title: string; icon: string; fields: NumField[] }[] = [
  {
    title: 'Commission & fees', icon: 'percent',
    fields: [
      { key: 'commission_pct', label: 'Platform commission', help: 'Deducted from every seller settlement.', suffix: '%' },
      { key: 'standard_shipping', label: 'Standard shipping', help: 'Charged below the free-delivery threshold.', prefix: '₹' },
      { key: 'free_delivery_over', label: 'Free delivery over', help: 'Cart value that unlocks free shipping.', prefix: '₹' },
    ],
  },
  {
    title: 'Cash on delivery', icon: 'payments',
    fields: [
      { key: 'cod_fee', label: 'COD fee', help: 'Flat fee added to cash-on-delivery orders.', prefix: '₹' },
      { key: 'cod_max_order', label: 'COD order cap', help: 'Largest cart value allowed to pay by COD.', prefix: '₹' },
    ],
  },
  {
    title: 'Returns & payouts', icon: 'event_repeat',
    fields: [
      { key: 'return_window_days', label: 'Return window', help: 'Days a buyer can request a return.', suffix: 'days' },
      { key: 'payout_hold_days', label: 'Payout hold', help: 'Hold window before an automatic seller transfer.', suffix: 'days' },
    ],
  },
];

export function Settings() {
  const { data } = useAsync(() => fetchSettings(), []);
  const { showToast } = useShop();
  const { profile } = useAuth();
  const [form, setForm] = useState<PlatformSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (data && !form) setForm(data); }, [data, form]);

  if (!form) return <div style={css(`color:${T.muted};font-size:13.5px;`)}>Loading settings…</div>;

  const dirty = !!data && JSON.stringify(form) !== JSON.stringify(data);
  const set = <K extends keyof PlatformSettings>(k: K, v: PlatformSettings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    setSaving(true);
    const { updated_at: _u, ...patch } = form;
    const res = await saveSettings(patch, profile?.id);
    setSaving(false);
    if (!res.ok) { showToast(res.error); return; }
    void logAdminAction({ actor_id: profile?.id, actor_name: profile?.full_name ?? 'Admin', action: 'settings.update', entity_type: 'settings' });
    showToast('Settings saved');
  };

  const numInput = (f: NumField) => (
    <div key={String(f.key)} style={css('display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 0;border-top:1px solid var(--ag-border-soft);')}>
      <div style={css('min-width:0;')}>
        <div style={css('font-weight:700;font-size:13.5px;')}>{f.label}</div>
        <div style={css(`font-size:12px;color:${T.muted};margin-top:2px;`)}>{f.help}</div>
      </div>
      <div style={css(`display:flex;align-items:center;gap:6px;border:1.5px solid ${T.field};border-radius:11px;padding:0 12px;height:42px;background:var(--ag-surface);flex:none;`)}>
        {f.prefix && <span style={css(`font-size:13px;color:${T.muted};font-weight:700;`)}>{f.prefix}</span>}
        <input
          type="number"
          value={String(form[f.key] as number)}
          onChange={(e) => set(f.key, Number(e.target.value) as PlatformSettings[typeof f.key])}
          style={css('border:none;background:none;width:84px;text-align:right;font-size:14px;font-weight:800;font-family:inherit;color:var(--ag-ink);')}
        />
        {f.suffix && <span style={css(`font-size:12px;color:${T.muted};font-weight:700;`)}>{f.suffix}</span>}
      </div>
    </div>
  );

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;max-width:760px;')}>
      {/* Maintenance mode banner-toggle */}
      <Card style={form.maintenance_mode ? 'border:1.5px solid var(--ag-warn-text);' : ''}>
        <div style={css('display:flex;align-items:center;gap:14px;')}>
          <div style={css(`width:44px;height:44px;border-radius:13px;background:${form.maintenance_mode ? 'var(--ag-warn-bg)' : 'var(--ag-surface-2)'};display:flex;align-items:center;justify-content:center;flex:none;`)}>
            <Icon name="engineering" size={24} color={form.maintenance_mode ? '#C99A3F' : T.muted} />
          </div>
          <div style={css('flex:1;min-width:0;')}>
            <div style={css('font-weight:800;font-size:14.5px;')}>Maintenance mode</div>
            <div style={css(`font-size:12.5px;color:${T.muted};margin-top:2px;`)}>Show a maintenance notice to buyers while you work on the storefront.</div>
          </div>
          <Toggle on={form.maintenance_mode} onChange={(v) => set('maintenance_mode', v)} />
        </div>
      </Card>

      {SECTIONS.map((sec) => (
        <Card key={sec.title}>
          <div style={css('display:flex;align-items:center;gap:10px;margin-bottom:4px;')}>
            <Icon name={sec.icon} size={19} color="var(--ag-crimson)" />
            <div style={css('font-weight:800;font-size:15px;')}>{sec.title}</div>
          </div>
          {sec.fields.map(numInput)}
        </Card>
      ))}

      <Card>
        <div style={css('display:flex;align-items:center;gap:10px;margin-bottom:12px;')}>
          <Icon name="support_agent" size={19} color="var(--ag-crimson)" />
          <div style={css('font-weight:800;font-size:15px;')}>Support</div>
        </div>
        <div style={css('font-weight:700;font-size:13.5px;margin-bottom:6px;')}>Support email</div>
        <input
          type="email"
          value={form.support_email}
          onChange={(e) => set('support_email', e.target.value)}
          placeholder="support@yourbrand.com"
          style={css(`width:100%;border:1.5px solid ${T.field};border-radius:12px;background:var(--ag-surface);font-size:14px;font-family:inherit;color:var(--ag-ink);padding:12px 14px;box-sizing:border-box;`)}
        />
      </Card>

      {/* Sticky save bar */}
      <div style={css(`position:sticky;bottom:16px;display:flex;align-items:center;gap:12px;background:var(--ag-surface);border:1px solid var(--ag-border);border-radius:16px;padding:12px 16px;box-shadow:0 14px 36px -20px var(--ag-shadow);`)}>
        <span style={css(`font-size:12.5px;color:${T.muted};font-weight:600;flex:1;`)}>
          {dirty ? 'You have unsaved changes.' : data?.updated_at ? `Last saved ${new Date(data.updated_at).toLocaleString('en-IN')}` : 'All changes saved.'}
        </span>
        {dirty && <GhostButton onClick={() => data && setForm(data)}>Discard</GhostButton>}
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={css(`height:42px;border-radius:12px;padding:0 20px;border:none;font-weight:800;font-size:13.5px;font-family:inherit;cursor:${dirty && !saving ? 'pointer' : 'not-allowed'};opacity:${dirty && !saving ? 1 : 0.5};background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;`)}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} aria-label="Toggle" style={css(`width:50px;height:29px;border-radius:99px;border:none;cursor:pointer;flex:none;padding:3px;display:flex;justify-content:${on ? 'flex-end' : 'flex-start'};background:${on ? 'var(--ag-crimson)' : 'var(--ag-border)'};transition:.15s;`)}>
      <span style={css('width:23px;height:23px;border-radius:50%;background:#fff;box-shadow:0 2px 5px rgba(0,0,0,.25);')} />
    </button>
  );
}
