import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { useAsync } from '@/hooks/useAsync';
import { fetchActivity } from '@/data/activityLog';
import { SearchInput, EmptyState, Icon, T } from '@/components/admin/kit';

const timeAgo = (iso: string) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/** Icon per audit action family, so the timeline scans at a glance. */
const iconFor = (action: string): string => {
  if (action.includes('delete') || action.includes('reject')) return 'delete';
  if (action.includes('block')) return 'block';
  if (action.includes('approve') || action.includes('verify')) return 'verified';
  if (action.includes('refund')) return 'undo';
  if (action.includes('create') || action.includes('add')) return 'add_circle';
  if (action.includes('pay') || action.includes('payout')) return 'account_balance';
  if (action.includes('hide')) return 'visibility_off';
  return 'bolt';
};

export function Audit() {
  const { data, loading } = useAsync(() => fetchActivity(200), []);
  const [q, setQ] = useState('');

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = data ?? [];
    if (!needle) return list;
    return list.filter((a) =>
      a.action.toLowerCase().includes(needle) ||
      a.actor_name.toLowerCase().includes(needle) ||
      a.entity_type.toLowerCase().includes(needle),
    );
  }, [data, q]);

  // Group by calendar day for a readable timeline.
  const groups = useMemo(() => {
    const map = new Map<string, typeof rows>();
    rows.forEach((a) => {
      const day = new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      (map.get(day) ?? map.set(day, []).get(day)!).push(a);
    });
    return [...map.entries()];
  }, [rows]);

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      <SearchInput value={q} onChange={setQ} placeholder="Search by action, admin or entity…" />

      <div style={css(T.card + 'padding:22px;')}>
        {loading && (!data || data.length === 0) ? (
          <div style={css(`color:${T.muted};font-size:13.5px;`)}>Loading audit trail…</div>
        ) : rows.length === 0 ? (
          <EmptyState icon="history" title="No matching actions" sub="Admin actions are recorded here automatically." />
        ) : (
          <div style={css('display:flex;flex-direction:column;gap:22px;')}>
            {groups.map(([day, items]) => (
              <div key={day}>
                <div style={css(`font-size:11.5px;font-weight:800;letter-spacing:.04em;color:${T.muted};text-transform:uppercase;margin-bottom:12px;`)}>{day}</div>
                <div style={css('display:flex;flex-direction:column;')}>
                  {items.map((a, i) => (
                    <div key={a.id} style={css(`display:flex;gap:13px;padding-bottom:${i === items.length - 1 ? 0 : 16}px;`)}>
                      <div style={css('display:flex;flex-direction:column;align-items:center;flex:none;')}>
                        <div style={css('width:34px;height:34px;border-radius:11px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
                          <Icon name={iconFor(a.action)} size={18} color="var(--ag-crimson)" />
                        </div>
                        {i !== items.length - 1 && <div style={css('flex:1;width:2px;background:var(--ag-border-soft);margin-top:4px;min-height:14px;')} />}
                      </div>
                      <div style={css('flex:1;min-width:0;padding-top:6px;')}>
                        <div style={css('font-weight:700;font-size:13.5px;')}>{a.action.replace(/[._]/g, ' ')}</div>
                        <div style={css(`font-size:12px;color:${T.muted};margin-top:2px;`)}>
                          {a.actor_name}{a.entity_type ? ` · ${a.entity_type}` : ''}{a.entity_id ? ` · ${a.entity_id.slice(0, 8)}` : ''} · {timeAgo(a.created_at)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
