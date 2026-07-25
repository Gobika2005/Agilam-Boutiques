import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchConversationsForBoutique } from '@/data/chat';
import { getChatPrefs, togglePinned, toggleFavourite, setReadState, isMarkedRead } from '@/lib/chatPrefs';

const TABS = ['All', 'Unread', 'Favourite'] as const;
type Tab = (typeof TABS)[number];

const relTime = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h';
  return Math.round(h / 24) + 'd';
};

export function Messages() {
  const navigate = useNavigate();
  const { boutique } = useMyBoutique();
  const { data: convos } = useAsync(() => (boutique ? fetchConversationsForBoutique(boutique.id) : Promise.resolve([])), [boutique?.id]);

  const [prefs, setPrefs] = useState(getChatPrefs);
  const [tab, setTab] = useState<Tab>('All');
  const [search, setSearch] = useState('');
  const [menu, setMenu] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (convos ?? [])
      .map((c) => {
        const name = c.buyer_name || 'Customer';
        const markedRead = isMarkedRead(prefs, c.id, c.last_message_at);
        return {
          id: c.id,
          name,
          last: c.last_message,
          at: c.last_message_at,
          time: relTime(c.last_message_at),
          unread: markedRead ? 0 : c.unread,
          pinned: prefs.pinned.includes(c.id),
          fav: prefs.favourite.includes(c.id),
        };
      })
      .filter((r) => {
        if (tab === 'Unread' && r.unread === 0) return false;
        if (tab === 'Favourite' && !r.fav) return false;
        if (q && !r.name.toLowerCase().includes(q) && !r.last.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.at ?? '').localeCompare(a.at ?? '');
      });
  }, [convos, prefs, tab, search]);

  const totalUnread = (convos ?? []).filter((c) => !isMarkedRead(prefs, c.id, c.last_message_at) && c.unread > 0).length;
  const act = (fn: () => void) => { fn(); setMenu(null); };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);')} onClick={() => menu && setMenu(null)}>
      <div style={css('padding:6px 20px 10px;')}>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:28px;")}>Messages</div>
      </div>

      {/* Search */}
      <div style={css('padding:0 20px 10px;')}>
        <div style={css('display:flex;align-items:center;gap:9px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:14px;padding:0 14px;height:46px;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);font-size:20px;")}>search</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations" style={css('flex:1;border:none;outline:none;background:none;font-family:inherit;font-size:14px;color:var(--ag-ink);')} />
        </div>
      </div>

      {/* Tabs */}
      <div style={css('display:flex;gap:8px;padding:0 20px 12px;')}>
        {TABS.map((t) => {
          const on = tab === t;
          return (
            <button key={t} onClick={() => setTab(t)} style={css(`display:flex;align-items:center;gap:6px;padding:8px 15px;border:none;border-radius:999px;font-size:12.5px;font-weight:800;cursor:pointer;font-family:inherit;background:${on ? 'var(--ag-crimson)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-label)'};`)}>
              {t}
              {t === 'Unread' && totalUnread > 0 && (
                <span style={css(`min-width:18px;height:18px;padding:0 5px;border-radius:9px;font-size:10.5px;display:flex;align-items:center;justify-content:center;background:${on ? 'rgba(255,255,255,.25)' : '#D6336C'};color:#fff;`)}>{totalUnread}</span>
              )}
            </button>
          );
        })}
      </div>

      {rows.length === 0 && (
        <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:56px 30px;')}>
          <div style={css('width:78px;height:78px;border-radius:50%;background:linear-gradient(145deg,var(--ag-surface-2),var(--ag-surface-2));display:flex;align-items:center;justify-content:center;box-shadow:inset 0 2px 3px rgba(255,255,255,.7),0 12px 26px -12px rgba(214,51,108,.55);')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:36px;color:var(--ag-crimson);")}>forum</span>
          </div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;margin-top:16px;")}>
            {search || tab !== 'All' ? 'Nothing here' : 'No messages yet'}
          </div>
          <div style={css('color:var(--ag-muted);font-size:13.5px;margin-top:6px;max-width:320px;line-height:1.55;')}>
            {tab === 'Favourite' ? 'Star a conversation to keep it here.' : tab === 'Unread' ? 'You are all caught up.' : 'Enquiries from buyers land in this inbox.'}
          </div>
        </div>
      )}

      <div style={css('display:flex;flex-direction:column;')}>
        {rows.map((m) => (
          <div key={m.id} style={css('position:relative;display:flex;gap:12px;align-items:center;padding:12px 20px;border-bottom:1px solid var(--ag-border-soft);')}>
            <div onClick={() => navigate(`/seller/chat/${m.id}`)} style={css('display:flex;gap:12px;align-items:center;flex:1;min-width:0;cursor:pointer;')}>
              <BoutiqueLogo name={m.name} size={52} radius={16} />
              <div style={css('flex:1;min-width:0;')}>
                <div style={css('display:flex;justify-content:space-between;align-items:center;gap:8px;')}>
                  <span style={css('display:flex;align-items:center;gap:5px;min-width:0;')}>
                    {m.pinned && <span style={css("font-family:'Material Symbols Outlined';font-size:14px;color:var(--ag-crimson);")}>push_pin</span>}
                    {m.fav && <span style={css("font-family:'Material Symbols Outlined';font-size:14px;color:#E0B84B;")}>star</span>}
                    <span style={css('font-weight:800;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{m.name}</span>
                  </span>
                  <span style={css('font-size:11.5px;color:var(--ag-muted-soft);flex:none;')}>{m.time}</span>
                </div>
                <div style={css('display:flex;justify-content:space-between;align-items:center;margin-top:2px;gap:8px;')}>
                  <span style={css(`font-size:13px;color:${m.unread > 0 ? 'var(--ag-ink)' : 'var(--ag-muted)'};font-weight:${m.unread > 0 ? 700 : 400};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`)}>{m.last}</span>
                  {m.unread > 0 && (
                    <span style={css('min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#D6336C;color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex:none;')}>{m.unread}</span>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={(e) => { e.stopPropagation(); setMenu(menu === m.id ? null : m.id); }}
              aria-label="Conversation options"
              style={css('width:34px;height:34px;flex:none;border-radius:10px;border:none;background:none;cursor:pointer;display:flex;align-items:center;justify-content:center;')}
            >
              <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);")}>more_vert</span>
            </button>

            {menu === m.id && (
              <div onClick={(e) => e.stopPropagation()} style={css('position:absolute;top:52px;right:18px;z-index:20;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:14px;padding:5px;box-shadow:0 18px 40px -18px rgba(107,20,54,.5);min-width:180px;')}>
                {[
                  { icon: m.pinned ? 'keep_off' : 'push_pin', label: m.pinned ? 'Unpin' : 'Pin chat', fn: () => setPrefs(togglePinned(m.id)) },
                  { icon: m.fav ? 'star_border' : 'star', label: m.fav ? 'Remove favourite' : 'Add to favourites', fn: () => setPrefs(toggleFavourite(m.id)) },
                  { icon: m.unread > 0 ? 'mark_chat_read' : 'mark_chat_unread', label: m.unread > 0 ? 'Mark as read' : 'Mark as unread', fn: () => setPrefs(setReadState(m.id, m.at, m.unread > 0)) },
                ].map((o) => (
                  <button key={o.label} onClick={() => act(o.fn)} style={css('width:100%;display:flex;align-items:center;gap:10px;padding:10px 11px;border:none;background:none;cursor:pointer;text-align:left;font-family:inherit;border-radius:10px;font-size:13px;font-weight:700;color:var(--ag-ink-2);')}>
                    <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:var(--ag-crimson);")}>{o.icon}</span>{o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
