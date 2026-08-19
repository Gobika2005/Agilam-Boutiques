import { useEffect, useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { useAsync } from '@/hooks/useAsync';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { logAdminAction } from '@/data/activityLog';
import {
  fetchWaThreads, fetchWaThreadMessages, revealMsisdn,
  type WaThread, type WaMessage,
} from '@/data/whatsapp';
import { Card, EmptyState, GhostButton, Icon, SearchInput, T } from '@/components/admin/kit';

/**
 * WhatsApp message log — every conversation on the platform number, read-only.
 *
 * WHY READ-ONLY, WHEN META ALREADY HAS AN INBOX
 * Replies are written in Meta Business Suite and stay there, so there is never a
 * question of two people answering the same customer from two places. What
 * Business Suite cannot do is show the conversation next to the order it is
 * about — it has no idea what AGL-W08JR8D12B is — and it needs a Meta account
 * for every person who has to look something up. That is the whole reason this
 * screen exists.
 *
 * NUMBERS ARE MASKED AT THE SOURCE
 * `wa_threads` (migration 0091) returns a hash and an already-masked number; the
 * real one is never in the payload behind this list. Revealing calls a separate
 * function for a single number and writes an audit entry, so "who looked up this
 * customer" stays answerable. Returning full numbers and hiding them with CSS
 * would be the appearance of masking rather than masking.
 *
 * WHAT AN OUTBOUND ROW CAN AND CANNOT SHOW
 * An auto-reply stores its finished text, so it renders verbatim. A template
 * send stores only the parameters — the wording lives at Meta and we never held
 * it — so those render as the template name plus the values we passed. Showing
 * the parameters honestly beats reconstructing a body we do not have.
 */

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

export function WhatsAppLog() {
  const { data, loading, error } = useAsync(() => fetchWaThreads(200), []);
  const [query, setQuery] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);

  const threads = data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return threads;
    // Masked numbers still match on the visible digits, which is enough to find
    // a thread when someone reads the last two off a support ticket.
    return threads.filter(
      (t) =>
        t.masked.toLowerCase().includes(q) ||
        (t.profile_name ?? '').toLowerCase().includes(q) ||
        (t.last_body ?? '').toLowerCase().includes(q),
    );
  }, [threads, query]);

  if (loading) return <div style={css(`color:${T.muted};font-size:13.5px;`)}>Loading conversations…</div>;

  if (error) {
    return (
      <Card>
        <div style={css('font-weight:800;font-size:14.5px;margin-bottom:6px;')}>Message log unavailable</div>
        <div style={css(`font-size:12.5px;color:${T.muted};line-height:1.6;`)}>
          This screen needs migration <strong>0091</strong> applied. Until then the outbox still
          records everything sent — only the threaded view is missing.
        </div>
      </Card>
    );
  }

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;max-width:960px;')}>
      <Card>
        <div style={css('display:flex;align-items:center;gap:10px;margin-bottom:8px;')}>
          <Icon name="forum" size={19} color="var(--ag-crimson)" />
          <div style={css('font-weight:800;font-size:15px;flex:1;')}>WhatsApp conversations</div>
          <span style={css(`font-size:11.5px;font-weight:700;color:${T.muted};`)}>
            {threads.length} thread{threads.length === 1 ? '' : 's'}
          </span>
        </div>
        <div style={css(`font-size:12.5px;color:${T.muted};line-height:1.65;`)}>
          Everything sent and received on the platform number. Read-only —{' '}
          <strong>replies are written in Meta Business Suite</strong>, so one customer is never
          answered from two places. Customer numbers are hidden until you ask for one, and each
          reveal is recorded in the audit trail.
        </div>
      </Card>

      <SearchInput value={query} onChange={setQuery} placeholder="Search name, message or visible digits" />

      {filtered.length === 0 ? (
        <EmptyState
          icon="forum"
          title={query ? 'No conversations match' : 'No conversations yet'}
          sub={
            query
              ? 'Try the last two digits of the number, or a word from the message.'
              : 'Messages appear here as soon as someone writes to the platform number, or once order updates start going out.'
          }
        />
      ) : (
        filtered.map((t) => (
          <ThreadRow key={t.thread_key} thread={t} open={openKey === t.thread_key} onToggle={() => setOpenKey(openKey === t.thread_key ? null : t.thread_key)} />
        ))
      )}
    </div>
  );
}

function ThreadRow({ thread, open, onToggle }: { thread: WaThread; open: boolean; onToggle: () => void }) {
  const { showToast } = useShop();
  const { profile } = useAuth();
  const [messages, setMessages] = useState<WaMessage[] | null>(null);
  const [full, setFull] = useState<string | null>(null);

  useEffect(() => {
    if (open && !messages) void fetchWaThreadMessages(thread.thread_key).then(setMessages);
  }, [open, messages, thread.thread_key]);

  const reveal = async () => {
    const n = await revealMsisdn(thread.thread_key);
    if (!n) { showToast('Could not read that number'); return; }
    setFull(n);
    // Deliberately audited: a reveal is the one action here that exposes a
    // customer's personal data, so it should be attributable afterwards.
    void logAdminAction({
      actor_id: profile?.id,
      actor_name: profile?.full_name ?? 'Admin',
      action: 'whatsapp.reveal_number',
      entity_type: 'whatsapp',
    });
  };

  return (
    <Card>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={css('display:flex;align-items:center;gap:12px;width:100%;background:none;border:none;padding:0;cursor:pointer;text-align:left;font-family:inherit;color:inherit;')}
      >
        <div style={css(`width:38px;height:38px;border-radius:50%;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;flex:none;`)}>
          <Icon name="person" size={20} color={T.muted} />
        </div>
        <div style={css('flex:1;min-width:0;')}>
          <div style={css('display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;')}>
            <span style={css('font-weight:800;font-size:13.5px;')}>{thread.profile_name || 'Unknown'}</span>
            <span style={css(`font-size:12px;font-weight:700;color:${T.muted};font-variant-numeric:tabular-nums;`)}>
              {full ?? thread.masked}
            </span>
            {thread.opted_out && (
              <span style={css('font-size:10.5px;font-weight:800;letter-spacing:.03em;padding:2px 7px;border-radius:99px;background:var(--ag-surface-2);color:var(--ag-crimson);')}>
                OPTED OUT
              </span>
            )}
          </div>
          <div style={css(`font-size:12px;color:${T.muted};margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>
            {thread.last_dir === 'out' ? '↑ ' : '↓ '}{thread.last_body || '—'}
          </div>
        </div>
        <div style={css('text-align:right;flex:none;')}>
          <div style={css(`font-size:11px;color:${T.muted};font-weight:700;`)}>{fmtWhen(thread.last_at)}</div>
          <div style={css(`font-size:10.5px;color:${T.muted};margin-top:2px;`)}>
            {thread.in_count} in · {thread.out_count} out
          </div>
        </div>
        <Icon name={open ? 'expand_less' : 'expand_more'} size={20} color={T.muted} />
      </button>

      {open && (
        <div style={css('margin-top:14px;border-top:1px solid var(--ag-border-soft);padding-top:12px;')}>
          <div style={css('display:flex;justify-content:flex-end;margin-bottom:10px;')}>
            {!full && <GhostButton onClick={reveal}>Reveal number</GhostButton>}
          </div>

          {messages === null ? (
            <div style={css(`font-size:12.5px;color:${T.muted};`)}>Loading messages…</div>
          ) : messages.length === 0 ? (
            <div style={css(`font-size:12.5px;color:${T.muted};`)}>No messages recorded.</div>
          ) : (
            <div style={css('display:flex;flex-direction:column;gap:8px;')}>
              {messages.map((m, i) => <Bubble key={i} m={m} />)}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Bubble({ m }: { m: WaMessage }) {
  const out = m.dir === 'out';
  return (
    <div style={css(`display:flex;justify-content:${out ? 'flex-end' : 'flex-start'};`)}>
      <div
        style={css(
          `max-width:76%;border-radius:14px;padding:9px 12px;font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;` +
            (out
              ? 'background:var(--ag-surface-2);border:1px solid var(--ag-border-soft);'
              : 'background:var(--ag-surface);border:1px solid var(--ag-border);'),
        )}
      >
        {m.body || <span style={css(`color:${T.muted};`)}>[{m.msg_type ?? 'message'}]</span>}
        <div style={css(`display:flex;gap:7px;align-items:center;margin-top:5px;font-size:10.5px;color:${T.muted};font-weight:700;`)}>
          <span>{fmtWhen(m.at)}</span>
          {/* Outbound only. `status` carries the outbox category — 'service' is a
              free auto-reply inside the 24h window, 'utility' is a billed
              template send. Worth seeing at a glance when reading a thread. */}
          {out && m.status && <span>· {m.status}</span>}
          {out && m.delivery && <span>· {m.delivery}</span>}
          {out && m.err && <span style={css('color:var(--ag-crimson);')}>· {m.err}</span>}
        </div>
      </div>
    </div>
  );
}
