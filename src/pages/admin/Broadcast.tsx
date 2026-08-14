import { useState } from 'react';
import { css } from '@/lib/css';
import { useAsync } from '@/hooks/useAsync';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { broadcast, fetchAudienceSizes, type Audience } from '@/data/broadcast';
import { logAdminAction } from '@/data/activityLog';
import { EmailBroadcast } from '@/pages/admin/EmailBroadcast';
import { Card, GhostButton, ConfirmDialog, Icon, TabBar, T } from '@/components/admin/kit';

const AUDIENCES: { key: Audience; label: string; icon: string }[] = [
  { key: 'all', label: 'Everyone', icon: 'public' },
  { key: 'buyer', label: 'Buyers', icon: 'group' },
  { key: 'seller', label: 'Sellers', icon: 'storefront' },
];

/**
 * Broadcast — two channels for the same job, kept apart on purpose.
 *
 * The bell reaches people inside the app the moment they next open it: instant,
 * free, low stakes, and open to staff, because 0086 widened
 * `broadcast_notification` to is_staff() precisely so employees could send buyer
 * updates. Email leaves the building. It lands under the company's sending
 * domain next to order receipts, it cannot be recalled, and a careless one costs
 * deliverability for the transactional mail too — so that tab is admins only,
 * enforced again by is_admin() inside the Edge Function.
 */
const TABS = [
  { key: 'bell' as const, label: 'Notification bell' },
  { key: 'email' as const, label: 'Email' },
];

export function Broadcast() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<'bell' | 'email'>('bell');

  // Staff see no tab strip at all rather than a tab that rejects them.
  if (profile?.role !== 'admin') return <BellBroadcast />;

  return (
    <div>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      {tab === 'bell' ? <BellBroadcast /> : <EmailBroadcast />}
    </div>
  );
}

function BellBroadcast() {
  const { data: sizes } = useAsync(() => fetchAudienceSizes(), []);
  const { showToast } = useShop();
  const { profile } = useAuth();
  const [audience, setAudience] = useState<Audience>('all');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const reach = sizes ? sizes[audience] : 0;
  const canSend = title.trim().length > 0 && body.trim().length > 0;

  const send = async () => {
    setBusy(true);
    const res = await broadcast(audience, title, body);
    setBusy(false);
    setConfirm(false);
    if (!res.ok) { showToast(res.error); return; }
    void logAdminAction({ actor_id: profile?.id, actor_name: profile?.full_name ?? 'Admin', action: 'broadcast.send', entity_type: 'notification', meta: { audience, sent: res.sent } });
    showToast(`Broadcast sent to ${res.sent} ${res.sent === 1 ? 'person' : 'people'}`);
    setTitle('');
    setBody('');
  };

  const field = `width:100%;border:1.5px solid ${T.field};border-radius:12px;background:var(--ag-surface);font-size:14px;font-family:inherit;color:var(--ag-ink);padding:12px 14px;box-sizing:border-box;`;

  return (
    <div className="agx-adm-split" style={css('align-items:start;')}>
      <Card>
        <div style={css('font-weight:800;font-size:15px;margin-bottom:14px;')}>Compose broadcast</div>

        <div style={css(`font-size:12px;font-weight:800;color:${T.muted};text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;`)}>Audience</div>
        <div style={css('display:grid;grid-template-columns:repeat(3,1fr);gap:10px;')}>
          {AUDIENCES.map((a) => {
            const on = audience === a.key;
            return (
              <button key={a.key} onClick={() => setAudience(a.key)} style={css(`border:1.5px solid ${on ? 'var(--ag-crimson)' : T.field};background:${on ? 'var(--ag-bad-bg)' : 'var(--ag-surface)'};border-radius:14px;padding:14px 10px;cursor:pointer;font-family:inherit;display:flex;flex-direction:column;align-items:center;gap:6px;`)}>
                <Icon name={a.icon} size={22} color={on ? 'var(--ag-crimson)' : T.muted} />
                <span style={css(`font-weight:800;font-size:13px;color:${on ? 'var(--ag-crimson)' : 'var(--ag-label)'};`)}>{a.label}</span>
                <span style={css(`font-size:11px;color:${T.muted};font-weight:700;`)}>{sizes ? sizes[a.key] : '…'} people</span>
              </button>
            );
          })}
        </div>

        <div style={css(`font-size:12px;font-weight:800;color:${T.muted};text-transform:uppercase;letter-spacing:.04em;margin:18px 0 8px;`)}>Title</div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="e.g. Diwali sale is live 🎉" style={css(field)} />

        <div style={css(`font-size:12px;font-weight:800;color:${T.muted};text-transform:uppercase;letter-spacing:.04em;margin:18px 0 8px;`)}>Message</div>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={280} rows={4} placeholder="Write a short, clear message…" style={css(field + 'resize:vertical;min-height:96px;')} />
        <div style={css(`text-align:right;font-size:11px;color:${T.muted};margin-top:4px;`)}>{body.length}/280</div>

        <div style={css('display:flex;justify-content:flex-end;margin-top:16px;')}>
          <GhostButton tone="primary" icon="send" onClick={() => setConfirm(true)}>Send broadcast</GhostButton>
        </div>
        {!canSend && <div style={css(`font-size:11.5px;color:${T.muted};margin-top:8px;text-align:right;`)}>Add a title and message to send.</div>}
      </Card>

      <Card>
        <div style={css('font-weight:800;font-size:15px;margin-bottom:14px;')}>Preview</div>
        <div style={css('border:1.5px solid var(--ag-border-soft);border-radius:16px;padding:14px;display:flex;gap:12px;align-items:flex-start;background:var(--ag-surface-2);')}>
          <div style={css('width:40px;height:40px;border-radius:12px;background:var(--ag-surface);display:flex;align-items:center;justify-content:center;flex:none;')}>
            <Icon name="campaign" size={22} color="var(--ag-crimson)" />
          </div>
          <div style={css('min-width:0;')}>
            <div style={css('font-weight:800;font-size:14px;')}>{title.trim() || 'Notification title'}</div>
            <div style={css(`font-size:13px;color:var(--ag-label);margin-top:3px;line-height:1.5;`)}>{body.trim() || 'Your message appears here as buyers and sellers will see it in their notification bell.'}</div>
            <div style={css(`font-size:11px;color:${T.muted};margin-top:6px;`)}>just now</div>
          </div>
        </div>
        <div style={css('margin-top:16px;display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;background:var(--ag-info-bg);')}>
          <Icon name="info" size={19} color="var(--ag-info-text)" />
          <span style={css('font-size:12.5px;font-weight:600;color:var(--ag-info-text);')}>
            This reaches <b>{reach}</b> {audience === 'all' ? 'people' : audience === 'buyer' ? 'buyers' : 'sellers'} in their notification bell instantly. It can't be recalled.
          </span>
        </div>
      </Card>

      <ConfirmDialog
        open={confirm}
        title={`Send to ${reach} ${audience === 'all' ? 'people' : audience + 's'}?`}
        message="This notification is delivered immediately and cannot be recalled. Double-check the wording."
        confirmLabel="Send now"
        busy={busy}
        onConfirm={send}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
