import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { fetchNotifications, markNotificationRead } from '@/data/notifications';

const TABS = ['All', 'Orders', 'Messages', 'Updates'];

const STYLE: Record<string, { icon: string; tint: string; ic: string }> = {
  Orders: { icon: 'shopping_bag', tint: 'var(--ag-surface-2)', ic: '#D6336C' },
  Messages: { icon: 'chat_bubble', tint: 'var(--ag-info-bg)', ic: 'var(--ag-info-text)' },
  Updates: { icon: 'notifications', tint: 'var(--ag-purple-bg)', ic: '#9B7FC7' },
};

const relTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h';
  return Math.round(h / 24) + 'd';
};

export function Notifications() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [tab, setTab] = useState('All');
  const { data: rows, loading, reload } = useAsync(() => (profile ? fetchNotifications(profile.id) : Promise.resolve([])), [profile?.id]);

  const notifs = (rows ?? [])
    .filter((n) => tab === 'All' || n.type === tab)
    .map((n) => {
      const s = STYLE[n.type] ?? STYLE.Updates;
      return { id: n.id, orderId: n.order_id, title: n.title, body: n.body, type: n.type, unread: !n.read, time: relTime(n.created_at), ...s };
    });

  // Tapping a notification marks it read and, for an order, opens that order.
  // The mark is best-effort — a failed update must not swallow the navigation.
  const open = async (n: { id: string; orderId: string | null; unread: boolean }) => {
    if (n.unread) {
      try {
        await markNotificationRead(n.id);
        reload();
      } catch {
        /* keep it unread; the seller can still open the order */
      }
    }
    if (n.orderId) navigate(`/seller/orders/${encodeURIComponent(n.orderId)}`);
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('padding:6px 20px 8px;display:flex;align-items:center;gap:10px;')}>
        <button onClick={() => navigate('/seller/profile')} style={css('width:42px;height:42px;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
        </button>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;")}>Notifications</div>
      </div>

      <div className="agx-scroll" style={css('display:flex;gap:8px;overflow-x:auto;padding:4px 20px 10px;')}>
        {TABS.map((t) => {
          const on = tab === t;
          return (
            <button key={t} onClick={() => setTab(t)} style={css(`flex:none;padding:7px 15px;border:none;border-radius:999px;font-size:12.5px;font-weight:700;cursor:pointer;background:${on ? 'var(--ag-crimson)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-label)'};`)}>
              {t}
            </button>
          );
        })}
      </div>

      <div style={css('display:flex;flex-direction:column;gap:10px;padding:0 20px;')}>
        {!loading && notifs.length === 0 && (
          <div style={css('color:var(--ag-muted);font-size:14px;padding:8px 2px;')}>Nothing here yet — new orders and messages land in this inbox.</div>
        )}
        {notifs.map((n) => (
          <div
            key={n.id}
            onClick={() => open(n)}
            style={css(`background:${n.unread ? '#FFF3F8' : 'var(--ag-surface)'};border-radius:16px;padding:13px;display:flex;gap:11px;align-items:flex-start;box-shadow:0 10px 26px -22px rgba(107,20,54,.6);cursor:${n.orderId ? 'pointer' : 'default'};`)}
          >
            <div style={css(`width:40px;height:40px;flex:none;border-radius:12px;background:${n.tint};display:flex;align-items:center;justify-content:center;`)}>
              <span style={css(`font-family:'Material Symbols Outlined';font-size:20px;color:${n.ic};`)}>{n.icon}</span>
            </div>
            <div style={css('flex:1;')}>
              <div style={css('display:flex;justify-content:space-between;align-items:center;gap:8px;')}>
                <span style={css('font-weight:800;font-size:13.5px;')}>{n.title}</span>
                <span style={css('font-size:11px;color:var(--ag-muted-soft);flex:none;')}>{n.time}</span>
              </div>
              <div style={css('font-size:12.5px;color:var(--ag-muted);line-height:1.4;margin-top:2px;')}>{n.body}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
