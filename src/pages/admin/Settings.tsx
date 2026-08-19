import { useEffect, useState } from 'react';
import { css } from '@/lib/css';
import { useAsync } from '@/hooks/useAsync';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import {
  fetchSettings, saveSettings, setRazorpayAccount,
  type PlatformSettings, type RazorpayAccount,
} from '@/data/settings';
import { fetchWaStats, fetchWaFailures, type WaStats, type WaFailure } from '@/data/whatsapp';
import { logAdminAction } from '@/data/activityLog';
import { Card, ConfirmDialog, GhostButton, Icon, T } from '@/components/admin/kit';

type NumField = { key: keyof PlatformSettings; label: string; help: string; prefix?: string; suffix?: string };

/**
 * Fulfilment terms are no longer set here.
 *
 * "Standard shipping", "Free delivery over", "COD fee" and "COD order cap" used
 * to be four fields on this page. Delivery belongs to the boutique that packs
 * the parcel, not to the marketplace, so since migration 0076 each seller sets
 * their own in the seller console and the buyer is charged per boutique; cash on
 * delivery was withdrawn entirely in 0085. Re-adding any of them here would have
 * no effect: nothing reads those columns any more.
 *
 * `return_window_days` survived, but its meaning changed with migration 0078:
 * it is now only the STARTING value for a newly-created boutique. Each shop
 * then sets its own, and the shop's number is what the product page shows and
 * what `request_return()` enforces — editing this field changes nothing for a
 * shop that already exists.
 *
 * What is left is genuinely platform-wide: the commission the marketplace
 * takes, how long a payout is held and the payout promise.
 */
const SECTIONS: { title: string; icon: string; fields: NumField[] }[] = [
  {
    title: 'Commission', icon: 'percent',
    fields: [
      { key: 'commission_pct', label: 'Platform commission', help: 'Deducted from every seller settlement.', suffix: '%' },
    ],
  },
  {
    title: 'Returns & payouts', icon: 'event_repeat',
    fields: [
      { key: 'return_window_days', label: 'Default return window', help: 'Starting value for a NEW boutique. Each shop sets its own afterwards, and that is what buyers are shown and what returns are checked against.', suffix: 'days' },
      { key: 'payout_hold_days', label: 'Payout hold', help: 'Hold window before an automatic seller transfer.', suffix: 'days' },
      { key: 'payout_sla_hours', label: 'Payout promise', help: 'Hours after delivery within which a seller is paid. Shown to sellers and used to flag an overdue payout.', suffix: 'hours' },
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
    // `razorpay_account` is deliberately not part of this patch — it has its own
    // immediate write (see PaymentAccountCard), so an emergency switch never
    // waits on "Save changes", and a deployment without migration 0064 can still
    // save commission and fees.
    const { updated_at: _u, razorpay_account: _r, ...patch } = form;
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
      <div className="agx-field" style={css(`display:flex;align-items:center;gap:6px;border:1.5px solid ${T.field};border-radius:11px;padding:0 12px;height:42px;background:var(--ag-surface);flex:none;`)}>
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
            <Icon name="engineering" size={24} color={form.maintenance_mode ? 'var(--ag-gold-text)' : T.muted} />
          </div>
          <div style={css('flex:1;min-width:0;')}>
            <div style={css('font-weight:800;font-size:14.5px;')}>Maintenance mode</div>
            <div style={css(`font-size:12.5px;color:${T.muted};margin-top:2px;`)}>Show a maintenance notice to buyers while you work on the storefront.</div>
          </div>
          <Toggle on={form.maintenance_mode} onChange={(v) => set('maintenance_mode', v)} label="Maintenance mode" />
        </div>
      </Card>

      <PaymentAccountCard initial={form.razorpay_account} />

      {SECTIONS.map((sec) => (
        <Card key={sec.title}>
          <div style={css('display:flex;align-items:center;gap:10px;margin-bottom:4px;')}>
            <Icon name={sec.icon} size={19} color="var(--ag-crimson)" />
            <div style={css('font-weight:800;font-size:15px;')}>{sec.title}</div>
          </div>
          {sec.fields.map(numInput)}
        </Card>
      ))}

      {/* Says where the fields that used to sit here went, so nobody spends ten
          minutes looking for the delivery fee. */}
      <Card>
        <div style={css('display:flex;align-items:center;gap:10px;margin-bottom:8px;')}>
          <Icon name="local_shipping" size={19} color={T.muted} />
          <div style={css('font-weight:800;font-size:15px;')}>Delivery & payment</div>
        </div>
        <div style={css(`font-size:12.5px;color:${T.muted};line-height:1.7;`)}>
          Each boutique sets its own delivery charges (priced by distance), free-delivery
          threshold, dispatch time and change-of-mind return window in its own console — the shop
          that packs the parcel is the one that prices and promises it. Buyers are charged per
          boutique, and each order stores the fees it carried. The 30-day cover for a faulty or
          wrong item stays ours. Cash on delivery has been withdrawn platform-wide: every order is
          paid in full through Razorpay before it is placed, and there is nothing to switch.
        </div>
      </Card>

      <WhatsAppCard on={form.whatsapp_enabled} onChange={(v) => set('whatsapp_enabled', v)} />

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

/* ────────────────────────────────────────────────────────────────────────────
 * Razorpay account switch
 * ──────────────────────────────────────────────────────────────────────────── */

type AccountProbe = {
  account: RazorpayAccount;
  label: string;
  mode: 'live' | 'test' | 'unknown';
  ok: boolean;
  status?: number;
  error?: string;
};

const ACCOUNT_COPY: Record<RazorpayAccount, { title: string; sub: string; env: string }> = {
  primary: {
    title: 'Primary account',
    sub: 'The everyday merchant account.',
    env: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET',
  },
  backup: {
    title: 'Backup account',
    sub: 'Standby, for when the primary is frozen or under review.',
    env: 'RAZORPAY_KEY_ID_B / RAZORPAY_KEY_SECRET_B',
  },
};

/**
 * Which Razorpay account takes buyers' money — the emergency switch.
 *
 * Kept out of the main settings form on purpose: this has to take effect the
 * instant it is tapped (the next /api/create-order reads it), not when someone
 * remembers to press Save, and it must not be blocked by an unrelated
 * half-finished edit elsewhere on the page.
 *
 * The tiles are backed by a live /api/health probe of BOTH accounts, because the
 * one thing worse than a dead payment account is switching to a second one that
 * was never configured. An account the server reports as unconfigured cannot be
 * selected at all — the server would silently fall back to the working one and
 * the console would be showing a lie.
 */
function PaymentAccountCard({ initial }: { initial: RazorpayAccount }) {
  const { showToast } = useShop();
  const { profile } = useAuth();
  const [account, setAccount] = useState<RazorpayAccount>(initial);
  const [probes, setProbes] = useState<AccountProbe[] | null>(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [pending, setPending] = useState<RazorpayAccount | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setAccount(initial); }, [initial]);

  // Health is advisory: a failed fetch (offline, /api not served in plain `vite
  // dev`) leaves the tiles unannotated rather than blocking the switch, which is
  // the last thing this control should do in an emergency.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const list = d?.razorpay?.accounts;
        if (Array.isArray(list)) setProbes(list as AccountProbe[]);
        setHealthChecked(true);
      })
      .catch(() => { if (!cancelled) setHealthChecked(true); });
    return () => { cancelled = true; };
  }, []);

  const probeOf = (key: RazorpayAccount) => probes?.find((p) => p.account === key) ?? null;
  /** Only treat an account as missing once the server has actually told us so. */
  const isConfigured = (key: RazorpayAccount) => !probes || !!probeOf(key);

  const applySwitch = async (next: RazorpayAccount) => {
    setBusy(true);
    const res = await setRazorpayAccount(next, profile?.id);
    setBusy(false);
    setPending(null);
    if (!res.ok) { showToast(res.error); return; }
    setAccount(next);
    // `meta` carries both ends of the move: "payments were switched" is not much
    // use to whoever reconciles the day's takings across two dashboards.
    void logAdminAction({
      actor_id: profile?.id,
      actor_name: profile?.full_name ?? 'Admin',
      action: 'settings.razorpay_account',
      entity_type: 'settings',
      entity_id: 'razorpay_account',
      meta: { from: account, to: next },
    });
    showToast(`Payments now go to the ${ACCOUNT_COPY[next].title.toLowerCase()}`);
  };

  const tile = (key: RazorpayAccount) => {
    const copy = ACCOUNT_COPY[key];
    const probe = probeOf(key);
    const selected = account === key;
    const configured = isConfigured(key);
    const disabled = !configured || busy;

    // Health line: what the server just found, in the operator's terms.
    let health = healthChecked ? 'Status unavailable' : 'Checking…';
    let healthColor = T.muted;
    if (!configured) {
      health = `Not configured — set ${copy.env}`;
      healthColor = 'var(--ag-warn-text)';
    } else if (probe?.ok) {
      health = `Reachable · ${probe.mode === 'live' ? 'LIVE keys' : probe.mode === 'test' ? 'TEST keys' : 'unrecognised key format'}`;
      healthColor = 'var(--ag-good-text)';
    } else if (probe) {
      health = probe.error ?? 'Razorpay rejected these keys';
      healthColor = 'var(--ag-bad-text)';
    }

    return (
      <button
        key={key}
        type="button"
        role="radio"
        aria-checked={selected}
        disabled={disabled}
        onClick={() => { if (!selected) setPending(key); }}
        style={css(`
          display:flex;align-items:flex-start;gap:12px;width:100%;text-align:left;font-family:inherit;
          border:1.5px solid ${selected ? 'var(--ag-crimson)' : T.field};border-radius:14px;padding:14px;
          background:${selected ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};
          cursor:${disabled || selected ? 'default' : 'pointer'};opacity:${configured ? 1 : 0.6};
        `)}
      >
        <Icon
          name={selected ? 'radio_button_checked' : 'radio_button_unchecked'}
          size={20}
          color={selected ? 'var(--ag-crimson)' : T.muted}
        />
        <span style={css('flex:1;min-width:0;')}>
          <span style={css('display:flex;align-items:center;gap:8px;flex-wrap:wrap;')}>
            <span style={css('font-weight:800;font-size:13.5px;')}>{copy.title}</span>
            {selected && (
              <span style={css('font-size:10.5px;font-weight:800;letter-spacing:.04em;color:#fff;background:var(--ag-crimson);border-radius:99px;padding:2px 8px;')}>
                COLLECTING NOW
              </span>
            )}
          </span>
          <span style={css(`display:block;font-size:12px;color:${T.muted};margin-top:3px;`)}>{copy.sub}</span>
          <span style={css(`display:block;font-size:11.5px;font-weight:700;color:${healthColor};margin-top:6px;`)}>
            {health}
          </span>
        </span>
      </button>
    );
  };

  const target: RazorpayAccount = account === 'primary' ? 'backup' : 'primary';

  return (
    <Card>
      <div style={css('display:flex;align-items:center;gap:10px;margin-bottom:4px;')}>
        <Icon name="sync_alt" size={19} color="var(--ag-crimson)" />
        <div style={css('font-weight:800;font-size:15px;')}>Payment account</div>
      </div>
      <div style={css(`font-size:12.5px;color:${T.muted};line-height:1.5;margin-bottom:14px;`)}>
        Which Razorpay account collects buyer payments and seller ad purchases. The switch applies to the
        very next checkout — no redeploy. Payments already in flight still settle on the account that took
        them, so it is safe to flip mid-day.
      </div>

      <div role="radiogroup" aria-label="Razorpay account" style={css('display:flex;flex-direction:column;gap:10px;')}>
        {tile('primary')}
        {tile('backup')}
      </div>

      {/* The one-tap version of the same action, for when something is on fire. */}
      <div style={css('display:flex;justify-content:flex-end;margin-top:14px;')}>
        <GhostButton
          icon="swap_horiz"
          onClick={() => setPending(target)}
          disabled={busy || !isConfigured(target)}
          title={isConfigured(target) ? undefined : 'That account has no keys configured'}
        >
          Switch to {target}
        </GhostButton>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title="Switch payment account?"
        message={
          pending
            ? `Every new checkout and ad purchase will be collected by the ${ACCOUNT_COPY[pending].title.toLowerCase()} from the moment you confirm. Money already taken stays where it is, and payouts are unaffected. Make sure that account is active in the Razorpay dashboard first.`
            : ''
        }
        confirmLabel="Switch account"
        danger
        busy={busy}
        onConfirm={() => pending && applySwitch(pending)}
        onCancel={() => setPending(null)}
      />
    </Card>
  );
}

/**
 * On/off switch.
 *
 * `role="switch"` + `aria-checked` because the state was conveyed by background
 * colour alone: a screen reader announced only "Toggle, button", and anyone who
 * cannot separate crimson from grey had nothing to read the state from. The
 * visible on/off word covers the latter.
 */
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
 * accepts it or does not. When the access token expires (Phase 0.6's warning
 * about the 24-hour token is exactly this failure), nothing breaks: orders still
 * place, statuses still change, and messages simply stop arriving. Without a
 * failure count on a screen somebody opens, that is invisible until a customer
 * complains. A rising `Failed` here with the same Meta error on every row is the
 * signal, and the error text names the cause.
 *
 * The counts are a snapshot, not a subscription — this is an operational check
 * somebody performs, not a dashboard worth a realtime channel.
 */
function WhatsAppCard({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  const [stats, setStats] = useState<WaStats | null>(null);
  const [failures, setFailures] = useState<WaFailure[]>([]);
  const [open, setOpen] = useState(false);

  const refresh = () => {
    void fetchWaStats().then(setStats);
    void fetchWaFailures().then(setFailures);
  };
  useEffect(refresh, []);

  const pill = (label: string, value: number, tone: string) => (
    <div key={label} style={css(`flex:1;min-width:74px;border:1px solid var(--ag-border-soft);border-radius:12px;padding:10px 12px;background:var(--ag-surface-2);`)}>
      <div style={css(`font-size:18px;font-weight:900;color:${tone};line-height:1.2;`)}>{value}</div>
      <div style={css(`font-size:11px;font-weight:700;color:${T.muted};margin-top:2px;`)}>{label}</div>
    </div>
  );

  return (
    <Card>
      <div style={css('display:flex;align-items:center;gap:14px;')}>
        <div style={css(`width:44px;height:44px;border-radius:13px;background:${on ? 'var(--ag-ok-bg)' : 'var(--ag-surface-2)'};display:flex;align-items:center;justify-content:center;flex:none;`)}>
          <Icon name="chat" size={22} color={on ? 'var(--ag-ok-text)' : T.muted} />
        </div>
        <div style={css('flex:1;min-width:0;')}>
          <div style={css('font-weight:800;font-size:14.5px;')}>WhatsApp order updates</div>
          <div style={css(`font-size:12.5px;color:${T.muted};margin-top:2px;line-height:1.55;`)}>
            Confirmation, shipped, delivered and refund messages to buyers, and new-order,
            payout and low-stock alerts to sellers. While this is off, messages are still
            queued but nothing is sent — so you can check the queue before going live.
          </div>
        </div>
        <Toggle on={on} onChange={onChange} label="WhatsApp order updates" />
      </div>

      {stats && (
        <>
          <div style={css('display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;')}>
            {pill('Waiting', stats.queued, 'var(--ag-ink)')}
            {pill('Sent', stats.sent, 'var(--ag-ok-text)')}
            {pill('Failed', stats.failed, stats.failed > 0 ? 'var(--ag-crimson)' : T.muted)}
            {pill('Opted out', stats.suppressed, T.muted)}
            {/* Queued past its usefulness and dropped — a spike here means the
                drainer stopped running, not that Meta refused anything. */}
            {pill('Expired', stats.stale, T.muted)}
          </div>

          <div style={css('display:flex;align-items:center;gap:12px;margin-top:12px;')}>
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

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div style={css('display:flex;align-items:center;gap:9px;flex:none;')}>
      <span style={css(`font-size:11.5px;font-weight:800;letter-spacing:.03em;color:${on ? 'var(--ag-crimson)' : T.muted};`)}>
        {on ? 'ON' : 'OFF'}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onChange(!on)}
        style={css(`width:50px;height:29px;border-radius:99px;border:none;cursor:pointer;flex:none;padding:3px;display:flex;justify-content:${on ? 'flex-end' : 'flex-start'};background:${on ? 'var(--ag-crimson)' : 'var(--ag-border)'};transition:.15s;`)}
      >
        <span style={css('width:23px;height:23px;border-radius:50%;background:#fff;box-shadow:0 2px 5px rgba(0,0,0,.25);')} />
      </button>
    </div>
  );
}
