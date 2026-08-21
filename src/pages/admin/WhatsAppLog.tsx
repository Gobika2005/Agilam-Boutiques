import { useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@/lib/css';
import { useAsync } from '@/hooks/useAsync';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { logAdminAction } from '@/data/activityLog';
import {
  fetchWaThreads, fetchWaThreadMessages, revealMsisdn,
  fetchWaStats, fetchWaFailures,
  type WaThread, type WaMessage, type WaStats, type WaFailure,
} from '@/data/whatsapp';
import { fetchSettings, saveSettings } from '@/data/settings';
import { Card, EmptyState, GhostButton, Icon, SearchInput, T, Toggle } from '@/components/admin/kit';

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

type Tick = 'sent' | 'delivered' | 'read';

/**
 * Which tick an outbound message has earned.
 *
 * TWO FIELDS, AND THEY ARE NOT INTERCHANGEABLE. `wa_thread_messages` (0091)
 * returns `o.category, o.status, o.delivery_status, o.last_error` as
 * `msg_type, status, delivery, err`, so:
 *
 *   `delivery` is META'S receipt — 'sent' | 'delivered' | 'read' | 'failed' —
 *     and is NULL until a receipt actually arrives on the webhook.
 *   `status` is OUR OUTBOX queue state — 'queued' | 'sent' | 'failed' |
 *     'suppressed' | 'stale'.
 *
 * The null case is the one that matters: a message handed to Meta that has not
 * been acknowledged yet is `status='sent'` with `delivery=null`, and that is
 * precisely the single-tick state. Reading ticks off `delivery` alone would
 * leave every such message with no indicator at all.
 *
 * Returns null for anything the ticks cannot honestly express (queued,
 * suppressed, stale, failed) — those keep a text pill, because inventing a
 * glyph for them would be asking the reader to learn a vocabulary nobody
 * published.
 */
function tickFor(m: WaMessage): Tick | null {
  if (m.dir !== 'out') return null;
  if (m.delivery === 'failed' || m.status === 'failed') return null;
  if (m.delivery === 'read') return 'read';
  if (m.delivery === 'delivered') return 'delivered';
  if (m.delivery === 'sent' || (!m.delivery && m.status === 'sent')) return 'sent';
  return null;
}

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

  // The order-updates panel below is NOT gated on any of this. It reads the
  // outbox (migration 0090) while the thread list needs 0091, and these are
  // applied by hand one at a time — so an early return here would strand the
  // send kill switch on a database that has 0090 but not 0091, and the switch
  // no longer has a home in Settings to fall back to.
  const blocked = loading ? (
    <div style={css(`color:${T.muted};font-size:13.5px;`)}>Loading conversations…</div>
  ) : error ? (
    <Card>
      <div style={css('font-weight:800;font-size:14.5px;margin-bottom:6px;')}>Message log unavailable</div>
      <div style={css(`font-size:12.5px;color:${T.muted};line-height:1.6;`)}>
        This screen needs migration <strong>0091</strong> applied. Until then the outbox still
        records everything sent — only the threaded view is missing.
      </div>
    </Card>
  ) : null;

  return (
    <div style={css('display:flex;flex-direction:column;gap:14px;max-width:1180px;')}>
      <OrderUpdatesCard />

      {blocked ?? (
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
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * WhatsApp order updates
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The kill switch, plus the only two numbers that tell you whether the pipeline
 * is alive: what is waiting and what has given up.
 *
 * WHY THIS PANEL EXISTS AT ALL
 * Everything about WhatsApp sending happens where nobody is looking — a Postgres
 * trigger queues a row, a pg_cron tick wakes an Edge Function, and Meta either
 * accepts it or does not. When the access token expires, nothing breaks: orders
 * still place, statuses still change, and messages simply stop arriving. Without
 * a failure count on a screen somebody opens, that is invisible until a customer
 * complains. A rising `Failed` here with the same Meta error on every row is the
 * signal, and the error text names the cause.
 *
 * It lives on this screen rather than in Settings because this is where anyone
 * wondering "did that message go out?" already is — the queue counters and the
 * conversation that proves it are one glance apart.
 *
 * THE SWITCH SAVES ITSELF
 * In Settings it rode along with the commission form's Save button. There is no
 * such button here, so it writes on tap — the same way the Razorpay account
 * switch does, and for the same reason: it is an operational control, and one
 * that must not carry an unrelated half-finished edit along with it. The UI
 * moves first and rolls back if the write fails, so the switch never shows a
 * state the database does not have.
 *
 * The counts are a snapshot, not a subscription — this is an operational check
 * somebody performs, not a dashboard worth a realtime channel.
 */
function OrderUpdatesCard() {
  const { showToast } = useShop();
  const { profile } = useAuth();
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [stats, setStats] = useState<WaStats | null>(null);
  const [failures, setFailures] = useState<WaFailure[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = () => {
    void fetchWaStats().then(setStats);
    void fetchWaFailures().then(setFailures);
  };
  useEffect(() => {
    refresh();
    void fetchSettings().then((s) => setOn(s.whatsapp_enabled));
  }, []);

  const toggle = async (next: boolean) => {
    if (saving || on === null) return;
    setSaving(true);
    setOn(next);
    const res = await saveSettings({ whatsapp_enabled: next }, profile?.id);
    setSaving(false);
    if (!res.ok) {
      setOn(!next);              // put the switch back where the database has it
      showToast(res.error);
      return;
    }
    showToast(next ? 'WhatsApp order updates ON' : 'WhatsApp order updates OFF');
    // Turning the platform's outbound messaging on or off is worth attributing.
    void logAdminAction({
      actor_id: profile?.id,
      actor_name: profile?.full_name ?? 'Admin',
      action: next ? 'whatsapp.updates_enabled' : 'whatsapp.updates_disabled',
      entity_type: 'settings',
    });
  };

  const pill = (label: string, value: number, tone: string) => (
    <div key={label} style={css('flex:1;min-width:74px;border:1px solid var(--ag-border-soft);border-radius:12px;padding:10px 12px;background:var(--ag-surface-2);')}>
      <div style={css(`font-size:18px;font-weight:900;color:${tone};line-height:1.2;`)}>{value}</div>
      <div style={css(`font-size:11px;font-weight:700;color:${T.muted};margin-top:2px;`)}>{label}</div>
    </div>
  );

  return (
    <Card>
      <div style={css('display:flex;align-items:center;gap:14px;')}>
        {/* --ag-good-*, not the --ag-ok-* this card used in Settings: those two
            tokens are not defined anywhere, so the "enabled" chip was rendering
            with no background and an uncoloured icon in both themes. */}
        <div style={css(`width:44px;height:44px;border-radius:13px;background:${on ? 'var(--ag-good-bg)' : 'var(--ag-surface-2)'};display:flex;align-items:center;justify-content:center;flex:none;`)}>
          <Icon name="chat" size={22} color={on ? 'var(--ag-good-text)' : T.muted} />
        </div>
        <div style={css('flex:1;min-width:0;')}>
          <div style={css('font-weight:800;font-size:14.5px;')}>WhatsApp order updates</div>
          <div style={css(`font-size:12.5px;color:${T.muted};margin-top:2px;line-height:1.55;`)}>
            Confirmation, shipped, delivered and refund messages to buyers, and new-order,
            payout and low-stock alerts to sellers. While this is off, messages are still
            queued but nothing is sent — so you can check the queue before going live.
          </div>
        </div>
        {on !== null && <Toggle on={on} onChange={toggle} label="WhatsApp order updates" />}
      </div>

      {stats && (
        <>
          <div style={css('display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;')}>
            {pill('Waiting', stats.queued, 'var(--ag-ink)')}
            {pill('Sent', stats.sent, 'var(--ag-good-text)')}
            {pill('Failed', stats.failed, stats.failed > 0 ? 'var(--ag-crimson)' : T.muted)}
            {pill('Opted out', stats.suppressed, T.muted)}
            {/* Queued past its usefulness and dropped — a spike here means the
                drainer stopped running, not that Meta refused anything. */}
            {pill('Expired', stats.stale, T.muted)}
          </div>

          <div style={css('display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap;')}>
            <span style={css(`flex:1;font-size:11.5px;color:${T.muted};font-weight:600;`)}>
              {stats.newest ? `Latest queued ${new Date(stats.newest).toLocaleString('en-IN')}` : 'Nothing queued yet.'}
            </span>
            {failures.length > 0 && (
              <GhostButton onClick={() => setOpen((v) => !v)}>
                {open ? 'Hide failures' : `Show ${failures.length} failure${failures.length === 1 ? '' : 's'}`}
              </GhostButton>
            )}
            <GhostButton onClick={refresh}>Refresh</GhostButton>
          </div>
        </>
      )}

      {open && failures.map((f) => (
        <div key={f.id} style={css('border-top:1px solid var(--ag-border-soft);padding:10px 0;')}>
          <div style={css('display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;')}>
            <span style={css('font-weight:700;font-size:12.5px;')}>{f.template}</span>
            <span style={css(`font-size:11.5px;color:${T.muted};font-weight:600;`)}>
              {f.recipient_masked} · {f.audience} · {f.attempts} attempt{f.attempts === 1 ? '' : 's'} · {new Date(f.created_at).toLocaleString('en-IN')}
            </span>
          </div>
          {/* Meta's own words, verbatim. Paraphrasing an API error is how the
              actual cause gets lost between here and the fix. */}
          <div style={css('font-size:11.5px;color:var(--ag-crimson);margin-top:3px;font-weight:600;word-break:break-word;')}>{f.last_error ?? 'No error recorded'}</div>
        </div>
      ))}
    </Card>
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

/**
 * The delivery tick, WhatsApp's vocabulary: one tick sent, two delivered, two
 * coloured once it has been seen. The "seen" colour is --ag-crimson rather than
 * WhatsApp's blue, which is why the bubble behind it is held at a light blush —
 * a saturated pink fill would swallow the one mark that has to stand out.
 *
 * `title`/`aria-label` carry the word, because a tick count is a convention and
 * not everyone reading this screen will know it.
 */
function DeliveryTick({ tick }: { tick: Tick }) {
  const read = tick === 'read';
  const label = read ? 'Seen' : tick === 'delivered' ? 'Delivered' : 'Sent';
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      style={css('display:inline-flex;align-items:center;line-height:0;')}
    >
      <Icon
        name={tick === 'sent' ? 'check' : 'done_all'}
        size={14}
        color={read ? 'var(--ag-crimson)' : T.muted}
      />
    </span>
  );
}

function Bubble({ m }: { m: WaMessage }) {
  const out = m.dir === 'out';
  const tick = tickFor(m);
  // A failure always speaks in words — `err` when Meta gave a reason, the bare
  // state when it did not, so the row is never silently blank.
  const failed = out && (m.delivery === 'failed' || m.status === 'failed');
  // Only the states no tick covers: queued, suppressed, stale.
  const pill = out && !tick && !failed ? m.status : null;

  return (
    <div style={css(`display:flex;justify-content:${out ? 'flex-end' : 'flex-start'};`)}>
      <div
        style={css(
          'max-width:78%;border-radius:14px;padding:8px 11px;font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;' +
            // Outbound is the brand blush (--ag-wa-* in index.css). Before this
            // both directions were near-identical surface tints and only the
            // alignment told them apart.
            (out
              ? 'background:var(--ag-wa-out-bg);border:1px solid var(--ag-wa-out-border);'
              : 'background:var(--ag-surface);border:1px solid var(--ag-border);'),
        )}
      >
        {m.body || <span style={css(`color:${T.muted};`)}>[{m.msg_type ?? 'message'}]</span>}
        <div style={css(`display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:5px;font-size:10px;color:${T.muted};font-weight:700;`)}>
          <span>{fmtClock(m.at)}</span>
          {tick && <DeliveryTick tick={tick} />}
          {pill && <span style={css('padding:1px 6px;border-radius:99px;background:var(--ag-surface-2);')}>{pill}</span>}
          {failed && (
            <span style={css('padding:1px 6px;border-radius:99px;background:var(--ag-bad-bg);color:var(--ag-bad-text);')}>
              {m.err || 'failed'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
