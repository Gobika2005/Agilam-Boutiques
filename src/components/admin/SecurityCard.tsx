import { useCallback, useEffect, useState } from 'react';
import { css } from '@/lib/css';
import { Card, ConfirmDialog, GhostButton, Icon, T } from '@/components/admin/kit';
import { useShop } from '@/state/ShopContext';
import {
  backupCodesRemaining,
  generateBackupCodes,
  listAuthenticators,
  removeAuthenticator,
  startEnrollment,
  verifyChallenge,
  type Authenticator,
  type EnrollStart,
} from '@/lib/mfa';

/**
 * "Your security" — the console's own two-factor panel.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE GATE
 * `RequireMfa` gets you IN. It shows a QR to somebody with no authenticator and
 * a keypad to somebody who has one, and then it gets out of the way. Everything
 * you might want to do about 2FA once you are already inside — check how many
 * backup codes are left, print a fresh set before a trip, register the laptop as
 * a second device so a lost phone is an inconvenience rather than a support
 * call — had nowhere to live. This is that place.
 *
 * WHY IT IS MOUNTED TWICE
 * Staff cannot open Settings (`STAFF_ROUTES` in lib/staffAccess), and after
 * migration 0100 they need 2FA exactly as much as an admin does. So this card
 * renders on the admin Settings page AND on StaffHome. One component, two
 * mount points, rather than a screen half the console cannot reach.
 *
 * WHAT IT DELIBERATELY WILL NOT DO
 * There is no "turn two-factor off". After 0100 an account with no verified
 * factor can never reach aal2, and the console's policies require aal2 — so
 * that button would be a silent, permanent self-lockout whose only remedy is
 * pasting rollback SQL into the Supabase editor. Dropping a SPARE device is
 * offered and safe; `removeAuthenticator` refuses to remove the last one.
 */

const CODE_GRID =
  "font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:13px;font-weight:700;letter-spacing:.02em;";

export function SecurityCard() {
  const { showToast } = useShop();

  const [devices, setDevices] = useState<Authenticator[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);

  // Enrolment sub-flow — used both for the very first authenticator and for
  // adding a second device, because they are the same three steps.
  const [enrolling, setEnrolling] = useState<EnrollStart | null>(null);
  const [code, setCode] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<Authenticator | null>(null);

  const load = useCallback(async () => {
    const list = await listAuthenticators();
    setDevices(list);
    setRemaining(list.length ? await backupCodesRemaining() : null);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function beginEnrol() {
    setBusy(true);
    try {
      // Named by position and date so a second device is distinguishable in the
      // list, and so re-adding after a removal cannot collide with a name
      // GoTrue still holds — friendly names must be unique per user.
      const n = (devices?.length ?? 0) + 1;
      const stamp = new Date().toISOString().slice(0, 10);
      setEnrolling(await startEnrollment(n === 1 ? 'MangaiMart' : `MangaiMart ${n} · ${stamp}`));
      setCode('');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start setup');
    } finally {
      setBusy(false);
    }
  }

  async function finishEnrol() {
    if (!enrolling || code.length !== 6 || busy) return;
    setBusy(true);
    try {
      await verifyChallenge(enrolling.factorId, code);
      const first = (devices?.length ?? 0) === 0;
      setEnrolling(null);
      setCode('');
      // A first authenticator has no backup codes behind it yet; a second
      // device shares the set that already exists, so minting a new one there
      // would silently invalidate the codes already written down somewhere.
      if (first) setCodes(await generateBackupCodes());
      else showToast('Device added');
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'That code did not work');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function regenerate() {
    setBusy(true);
    try {
      setCodes(await generateBackupCodes());
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not generate codes');
    } finally {
      setBusy(false);
    }
  }

  async function doRemove() {
    if (!confirmRemove) return;
    setBusy(true);
    try {
      await removeAuthenticator(confirmRemove.id);
      showToast('Device removed');
      setConfirmRemove(null);
      await load();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not remove that device');
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <div style={css('display:flex;align-items:center;gap:10px;margin-bottom:4px;')}>
      <Icon name="encrypted" size={19} color="var(--ag-crimson)" />
      <div style={css('font-weight:800;font-size:15px;')}>Your security</div>
    </div>
  );

  if (devices === null) {
    return (
      <Card>
        {header}
        <div style={css(`font-size:12.5px;color:${T.muted};`)}>Checking…</div>
      </Card>
    );
  }

  // ── The one-time reveal of a fresh set of backup codes ────────────────────
  if (codes) {
    return (
      <Card style="border:1.5px solid var(--ag-crimson);">
        {header}
        <div style={css(`font-size:12.5px;color:${T.muted};line-height:1.6;margin-bottom:12px;`)}>
          Save these somewhere that is not your phone. Each works once, and this is the only time
          they are shown — they are stored as hashes, so there is nowhere to read them back from.
          Any codes from an earlier set have just stopped working.
        </div>
        <div style={css('display:grid;grid-template-columns:1fr 1fr;gap:8px;background:var(--ag-surface-2);border:1px solid var(--ag-border);border-radius:14px;padding:14px;')}>
          {codes.map((c) => (
            <div key={c} style={css(CODE_GRID)}>{c}</div>
          ))}
        </div>
        <div style={css('display:flex;gap:10px;justify-content:flex-end;margin-top:14px;')}>
          <GhostButton
            icon="content_copy"
            onClick={() => {
              navigator.clipboard?.writeText(codes.join('\n')).then(
                () => showToast('Backup codes copied'),
                () => showToast('Could not copy — write them down instead'),
              );
            }}
          >
            Copy
          </GhostButton>
          <GhostButton
            icon="download"
            onClick={() => {
              const blob = new Blob([`MangaiMart backup codes\n\n${codes.join('\n')}\n`], { type: 'text/plain' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = 'mangaimart-backup-codes.txt';
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download
          </GhostButton>
          <GhostButton icon="check" onClick={() => setCodes(null)}>I’ve saved them</GhostButton>
        </div>
      </Card>
    );
  }

  // ── Scanning a QR, for a first authenticator or an extra device ───────────
  if (enrolling) {
    return (
      <Card>
        {header}
        <div style={css(`font-size:12.5px;color:${T.muted};line-height:1.6;margin-bottom:14px;`)}>
          Scan this with your authenticator app, then enter the six-digit code it shows.
        </div>
        <div style={css('display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap;')}>
          {/* White plate behind the QR — GoTrue returns a plain SVG, and a QR on
              a dark background does not scan. */}
          <img
            src={enrolling.qrCode}
            alt="Two-factor setup QR code"
            width={168}
            height={168}
            style={css('width:168px;height:168px;background:#fff;border-radius:14px;padding:9px;border:1px solid var(--ag-border);flex:none;')}
          />
          <div style={css('flex:1;min-width:200px;')}>
            <div style={css('font-weight:700;font-size:13px;margin-bottom:6px;')}>Six-digit code</div>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => {
                const next = e.target.value.replace(/\D/g, '').slice(0, 6);
                setCode(next);
                if (next.length === 6) void finishEnrol();
              }}
              placeholder="000000"
              style={css('width:100%;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:12px;padding:0 14px;height:48px;font-size:20px;font-weight:800;letter-spacing:.3em;text-align:center;color:var(--ag-ink);')}
            />
            <div style={css(`font-size:11.5px;color:${T.muted};margin-top:8px;line-height:1.5;word-break:break-all;`)}>
              Can’t scan? Enter this key by hand: <span style={css(CODE_GRID)}>{enrolling.secret}</span>
            </div>
            <div style={css('display:flex;gap:10px;margin-top:12px;')}>
              <GhostButton icon="check" onClick={() => void finishEnrol()} disabled={busy || code.length !== 6}>
                Verify
              </GhostButton>
              <GhostButton icon="close" onClick={() => { setEnrolling(null); setCode(''); }} disabled={busy}>
                Cancel
              </GhostButton>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // ── Not set up yet ────────────────────────────────────────────────────────
  if (devices.length === 0) {
    return (
      <Card style="border:1.5px solid var(--ag-warn-text);">
        {header}
        <div style={css(`font-size:12.5px;color:${T.muted};line-height:1.6;margin-bottom:14px;`)}>
          Two-factor authentication is <strong>not set up</strong> on your account. The console holds
          payouts, refunds and every customer record, so a password on its own is the only thing
          standing in front of all of it. Setting this up takes about a minute.
        </div>
        <GhostButton icon="encrypted" onClick={() => void beginEnrol()} disabled={busy}>
          Set up two-factor
        </GhostButton>
      </Card>
    );
  }

  // ── Set up ────────────────────────────────────────────────────────────────
  const low = remaining !== null && remaining <= 3;

  return (
    <Card>
      {header}
      <div style={css(`font-size:12.5px;color:${T.muted};line-height:1.6;margin-bottom:14px;`)}>
        Two-factor authentication is on. You are asked for a code when you sign in — not on every
        visit, because the session keeps its verification until you sign out.
      </div>

      <div style={css('display:flex;flex-direction:column;gap:8px;')}>
        {devices.map((d) => (
          <div key={d.id} style={css('display:flex;align-items:center;gap:11px;background:var(--ag-surface-2);border:1px solid var(--ag-border);border-radius:12px;padding:10px 12px;')}>
            <Icon name="smartphone" size={18} color="var(--ag-good-text)" />
            <div style={css('flex:1;min-width:0;')}>
              <div style={css('font-weight:700;font-size:13.5px;')}>{d.name}</div>
              {d.createdAt && (
                <div style={css(`font-size:11.5px;color:${T.muted};margin-top:1px;`)}>
                  Added {new Date(d.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                </div>
              )}
            </div>
            {/* Only when a spare exists. Removing the last authenticator would
                lock the account out of the console permanently. */}
            {devices.length > 1 && (
              <GhostButton icon="delete" onClick={() => setConfirmRemove(d)} disabled={busy}>
                Remove
              </GhostButton>
            )}
          </div>
        ))}
      </div>

      <div style={css(`display:flex;align-items:center;gap:11px;margin-top:12px;padding:10px 12px;border-radius:12px;border:1px solid ${low ? 'var(--ag-warn-text)' : 'var(--ag-border)'};background:${low ? 'var(--ag-warn-bg)' : 'var(--ag-surface-2)'};`)}>
        <Icon name="key" size={18} color={low ? 'var(--ag-gold-text)' : T.muted} />
        <div style={css('flex:1;min-width:0;')}>
          <div style={css('font-weight:700;font-size:13.5px;')}>
            {remaining ?? 0} of 10 backup codes left
          </div>
          <div style={css(`font-size:11.5px;color:${T.muted};margin-top:1px;line-height:1.45;`)}>
            {low
              ? 'Running low. Generate a fresh set while you still have a working authenticator.'
              : 'Each works once, and gets you back in if you lose your phone.'}
          </div>
        </div>
        <GhostButton icon="refresh" onClick={() => void regenerate()} disabled={busy}>
          Regenerate
        </GhostButton>
      </div>

      <div style={css('display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap;')}>
        <div style={css(`font-size:11.5px;color:${T.muted};line-height:1.5;flex:1;min-width:220px;`)}>
          Adding a second device — a laptop password manager, a tablet — means a lost phone never
          locks you out.
        </div>
        <GhostButton icon="add" onClick={() => void beginEnrol()} disabled={busy}>
          Add a device
        </GhostButton>
      </div>

      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove this authenticator?"
        message={`${confirmRemove?.name ?? 'This device'} will stop generating codes for your account. You will still have ${Math.max(0, devices.length - 1)} other authenticator${devices.length - 1 === 1 ? '' : 's'}, so you keep access.`}
        confirmLabel="Remove"
        danger
        busy={busy}
        onConfirm={() => void doRemove()}
        onCancel={() => setConfirmRemove(null)}
      />
    </Card>
  );
}
