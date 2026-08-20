import { useEffect, useMemo, useRef, useState } from 'react';
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
 *
 * LAYOUT: A TWO-PANE INBOX
 * Threads on the left, the selected conversation on the right. This replaced an
 * accordion where opening a thread pushed the others off-screen and the only way
 * back was to collapse it again. On a narrow screen the two panes become one —
 * see `.agx-wa-inbox` in index.css, which decides that in CSS from the
 * `data-view` attribute set below, rather than from a JS width check.
 */

/** Thread-list timestamp: a time for today, a date for anything older. */
const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** Clock only — inside a thread the day is already stated by the separator above. */
const fmtClock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
};

/**
 * The label on a date separator. "Today" and "Yesterday" carry further than a
 * bare date when someone is checking whether a customer has been answered yet;
 * the year appears only once a conversation is old enough for it to matter.
 */
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
};

/** Same calendar day? Decides where a separator is inserted. */
const sameDay = (a: string, b: string) => {
  const x = new Date(a), y = new Date(b);
  return !Number.isNaN(x.getTime()) && !Number.isNaN(y.getTime()) && x.toDateString() === y.toDateString();
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

  // Resolved against the FILTERED list: a thread the current search has hidden
  // must not stay open in the other pane, or the two panes disagree about what
  // is selected.
  const selected = filtered.find((t) => t.thread_key === openKey) ?? null;

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
    <div style={css('display:flex;flex-direction:column;gap:14px;max-width:1180px;')}>
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

      <div className="agx-wa-inbox" data-view={selected ? 'thread' : 'list'}>
        <div className="agx-wa-pane-list" style={css('display:flex;flex-direction:column;gap:10px;min-width:0;')}>
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
            <Card style="padding:6px;">
              <div className="agx-wa-scroll agx-wa-list" role="listbox" aria-label="Conversations">
                {filtered.map((t) => (
                  <ThreadItem
                    key={t.thread_key}
                    thread={t}
                    active={t.thread_key === openKey}
                    onOpen={() => setOpenKey(t.thread_key)}
                  />
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="agx-wa-pane-thread" style={css('min-width:0;')}>
          {selected ? (
            // Keyed so switching threads resets the loaded messages AND any
            // revealed number, rather than briefly showing one customer's data
            // under another's name.
            <Conversation key={selected.thread_key} thread={selected} onBack={() => setOpenKey(null)} />
          ) : (
            <Card>
              <EmptyState
                icon="chat"
                title="Pick a conversation"
                sub="Choose someone on the left to read the whole thread."
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** One row in the thread list. */
function ThreadItem({ thread, active, onOpen }: { thread: WaThread; active: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      role="option"
      aria-selected={active}
      style={css(
        'display:flex;align-items:center;gap:10px;width:100%;border:none;padding:9px 10px;cursor:pointer;' +
          'text-align:left;font-family:inherit;color:inherit;border-radius:12px;' +
          `background:${active ? 'var(--ag-surface-2)' : 'transparent'};`,
      )}
    >
      <div style={css('width:34px;height:34px;border-radius:50%;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;flex:none;')}>
        <Icon name="person" size={18} color={T.muted} />
      </div>
      <div style={css('flex:1;min-width:0;')}>
        <div style={css('display:flex;align-items:baseline;gap:6px;')}>
          <span style={css('font-weight:800;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>
            {thread.profile_name || 'Unknown'}
          </span>
          <div style={css('flex:1;')} />
          <span style={css(`font-size:10.5px;color:${T.muted};font-weight:700;flex:none;`)}>{fmtWhen(thread.last_at)}</span>
        </div>
        <div style={css(`font-size:11.5px;color:${T.muted};margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>
          {/* "You:" rather than an arrow glyph — it reads as language at a
              glance, where ↑/↓ needed a legend nobody had. */}
          {thread.last_dir === 'out' && <span style={css('font-weight:700;')}>You: </span>}
          {thread.last_body || '—'}
        </div>
        <div style={css('display:flex;align-items:center;gap:6px;margin-top:3px;')}>
          <span style={css(`font-size:10.5px;color:${T.muted};font-variant-numeric:tabular-nums;`)}>{thread.masked}</span>
          {thread.opted_out && (
            <span style={css('font-size:9.5px;font-weight:800;letter-spacing:.03em;padding:1px 6px;border-radius:99px;background:var(--ag-surface-3);color:var(--ag-crimson);')}>
              OPTED OUT
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/** The right-hand pane: one thread, read top to bottom. */
function Conversation({ thread, onBack }: { thread: WaThread; onBack: () => void }) {
  const { showToast } = useShop();
  const { profile } = useAuth();
  const [messages, setMessages] = useState<WaMessage[] | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchWaThreadMessages(thread.thread_key).then(setMessages);
  }, [thread.thread_key]);

  // Open on the newest message, the way every messaging app does — the useful
  // end of a support thread is the bottom.
  useEffect(() => {
    const el = scroller.current;
    if (el && messages) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
    <Card style="padding:0;overflow:hidden;">
      <div style={css('display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--ag-border-soft);')}>
        <button
          type="button"
          onClick={onBack}
          className="agx-wa-back"
          aria-label="Back to conversations"
          style={css('align-items:center;justify-content:center;width:32px;height:32px;flex:none;border:none;border-radius:9px;background:var(--ag-surface-2);cursor:pointer;color:inherit;font-family:inherit;')}
        >
          <Icon name="arrow_back" size={18} color={T.muted} />
        </button>
        <div style={css('width:36px;height:36px;border-radius:50%;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;flex:none;')}>
          <Icon name="person" size={19} color={T.muted} />
        </div>
        <div style={css('flex:1;min-width:0;')}>
          <div style={css('display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;')}>
            <span style={css('font-weight:800;font-size:14px;')}>{thread.profile_name || 'Unknown'}</span>
            <span style={css(`font-size:12px;font-weight:700;color:${T.muted};font-variant-numeric:tabular-nums;`)}>
              {full ?? thread.masked}
            </span>
            {thread.opted_out && (
              <span style={css('font-size:10px;font-weight:800;letter-spacing:.03em;padding:2px 7px;border-radius:99px;background:var(--ag-surface-3);color:var(--ag-crimson);')}>
                OPTED OUT
              </span>
            )}
          </div>
          <div style={css(`font-size:11px;color:${T.muted};margin-top:2px;`)}>
            {thread.in_count} received · {thread.out_count} sent
          </div>
        </div>
        {!full && <GhostButton onClick={reveal}>Reveal number</GhostButton>}
      </div>

      <div
        ref={scroller}
        className="agx-wa-scroll agx-wa-msgs"
        style={css('background:var(--ag-bg);padding:14px;display:flex;flex-direction:column;gap:7px;')}
      >
        {messages === null ? (
          <div style={css(`font-size:12.5px;color:${T.muted};`)}>Loading messages…</div>
        ) : messages.length === 0 ? (
          <div style={css(`font-size:12.5px;color:${T.muted};`)}>No messages recorded.</div>
        ) : (
          messages.map((m, i) => {
            const prev = i > 0 ? messages[i - 1] : null;
            const newDay = !prev || !sameDay(prev.at, m.at);
            return (
              // `display:contents` so the separator and the bubble are both laid
              // out by the flex column above, not nested inside a wrapper that
              // would collapse the gap between them.
              <div key={i} style={css('display:contents;')}>
                {newDay && <DaySeparator iso={m.at} />}
                <Bubble m={m} />
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}

function DaySeparator({ iso }: { iso: string }) {
  return (
    <div style={css('display:flex;align-items:center;gap:10px;margin:8px 0 3px;')}>
      <div style={css('flex:1;height:1px;background:var(--ag-border-soft);')} />
      <span style={css(`font-size:10.5px;font-weight:800;letter-spacing:.04em;color:${T.muted};padding:2px 10px;border-radius:99px;background:var(--ag-surface);border:1px solid var(--ag-border-soft);`)}>
        {dayLabel(iso)}
      </span>
      <div style={css('flex:1;height:1px;background:var(--ag-border-soft);')} />
    </div>
  );
}

function Bubble({ m }: { m: WaMessage }) {
  const out = m.dir === 'out';
  return (
    <div style={css(`display:flex;justify-content:${out ? 'flex-end' : 'flex-start'};`)}>
      <div
        style={css(
          'max-width:78%;border-radius:14px;padding:8px 11px;font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;' +
            // Outbound gets a real green (--ag-wa-* in index.css). Before this
            // both directions were near-identical surface tints and only the
            // alignment told them apart.
            (out
              ? 'background:var(--ag-wa-out-bg);border:1px solid var(--ag-wa-out-border);'
              : 'background:var(--ag-surface);border:1px solid var(--ag-border);'),
        )}
      >
        {m.body || <span style={css(`color:${T.muted};`)}>[{m.msg_type ?? 'message'}]</span>}
        <div style={css(`display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-top:5px;font-size:10px;color:${T.muted};font-weight:700;`)}>
          <span>{fmtClock(m.at)}</span>
          {/* Outbound only. `status` carries the outbox category — 'service' is a
              free auto-reply inside the 24h window, 'utility' is a billed
              template send. Worth seeing at a glance when reading a thread. */}
          {out && m.status && <span style={css('padding:1px 6px;border-radius:99px;background:var(--ag-surface-2);')}>{m.status}</span>}
          {out && m.delivery && <span style={css('padding:1px 6px;border-radius:99px;background:var(--ag-surface-2);')}>{m.delivery}</span>}
          {out && m.err && <span style={css('padding:1px 6px;border-radius:99px;background:var(--ag-bad-bg);color:var(--ag-bad-text);')}>{m.err}</span>}
        </div>
      </div>
    </div>
  );
}
