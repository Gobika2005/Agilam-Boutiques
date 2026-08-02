import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { type Thread } from '@/data/demo';

/**
 * Messages list, shared by the buyer and seller inboxes.
 *
 * There is deliberately no online dot here. Presence is tracked per open
 * conversation (see `subscribeToPresence`), and holding a live channel open for
 * every thread in the inbox would be both expensive and, as it was before,
 * wrong — the dot was rendered from a hardcoded `false`.
 */
export function ThreadList({ threads, chatBase }: { threads: Thread[]; chatBase: string }) {
  const navigate = useNavigate();

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);')}>
      <div style={css('padding:6px 20px 12px;')}>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:28px;margin:0;")}>Messages</h1>
      </div>

      {threads.length === 0 && (
        <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:64px 30px;')}>
          <div style={css('width:82px;height:82px;border-radius:50%;background:linear-gradient(145deg,var(--ag-surface-2),var(--ag-surface-2));display:flex;align-items:center;justify-content:center;box-shadow:inset 0 2px 3px rgba(255,255,255,.7),0 12px 26px -12px rgba(214,51,108,.55);')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:38px;color:var(--ag-crimson);")}>forum</span>
          </div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;margin-top:18px;")}>No messages yet</div>
          <div style={css('color:var(--ag-muted);font-size:14px;margin-top:8px;max-width:320px;line-height:1.55;')}>
            Chats you start with a boutique appear here — ask about sizing, custom stitching or an order any time.
          </div>
        </div>
      )}

      <div style={css('display:flex;flex-direction:column;')}>
        {threads.map((m) => (
          <div key={m.id} onClick={() => navigate(`${chatBase}/${m.id}`)} style={css('display:flex;gap:12px;align-items:center;padding:12px 20px;cursor:pointer;border-bottom:1px solid var(--ag-border-soft);')}>
            <BoutiqueLogo name={m.name} src={m.avatar} size={52} radius={16} />
            <div style={css('flex:1;min-width:0;')}>
              <div style={css('display:flex;justify-content:space-between;align-items:center;')}>
                <span style={css('font-weight:800;font-size:14.5px;')}>{m.name}</span>
                <span style={css('font-size:11.5px;color:var(--ag-muted-soft);')}>{m.time}</span>
              </div>
              <div style={css('display:flex;justify-content:space-between;align-items:center;margin-top:2px;')}>
                <span style={css('font-size:13px;color:var(--ag-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:210px;')}>{m.last}</span>
                {m.unread > 0 && (
                  <span style={css('min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#D6336C;color:#fff;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;')}>{m.unread}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
