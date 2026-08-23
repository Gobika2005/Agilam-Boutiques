import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { useShop } from '@/state/ShopContext';
import { updateMyProfile } from '@/data/profiles';
import { supabase } from '@/lib/supabase';
import { initial } from '@/lib/tokens';
import { adminPath } from '@/lib/adminPath';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Card, ConfirmDialog, GhostButton, Icon, SectionCard, T } from '@/components/admin/kit';

/**
 * "My profile" — the console operator's own account.
 *
 * WHY THIS PAGE EXISTS
 * The header avatar used to be wired straight to `signOut()`. Clicking the
 * thing that shows your own name — the universal affordance for "my account" —
 * ended your session with no confirmation and no way back but logging in again.
 * The avatar now opens this page, and logging out is a deliberate act you
 * choose here (or from the sidebar / mobile tab bar, both left untouched).
 *
 * WHAT IT DELIBERATELY DOES NOT LET YOU EDIT
 * Email and role are read-only. Role especially: a self-service role field is
 * precisely the self-escalation hole that migration 0010 exists to close, and
 * the RLS trigger would reject the write anyway — so offering the control would
 * only produce a confusing error. Both are changed by another admin from the
 * Users page, which is also where the change is recorded and emailed.
 *
 * STAFF USE THIS TOO
 * The header is shared by both console roles, so `profile` is on STAFF_ROUTES.
 * Nothing here is platform data — it is your own name, your own password and
 * your own theme — so there is no money or configuration to gate.
 */

const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', staff: 'Employee' };

/** A read-only label/value line — the shape used for facts you cannot edit. */
function Fact({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={css(`display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid ${T.border};`)}>
      <div style={css(`font-size:13px;color:${T.muted};flex:none;`)}>{label}</div>
      <div style={css('font-size:13.5px;font-weight:700;text-align:right;word-break:break-word;')}>
        {value}
        {hint && <div style={css(`font-size:11.5px;font-weight:500;color:${T.muted};margin-top:2px;`)}>{hint}</div>}
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, type = 'text', autoComplete,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string; autoComplete?: string;
}) {
  return (
    <label style={css('display:block;margin-bottom:13px;')}>
      <span style={css(`display:block;font-size:12.5px;color:${T.muted};margin-bottom:6px;font-weight:600;`)}>{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={css(`width:100%;box-sizing:border-box;padding:11px 13px;border:1px solid ${T.field};border-radius:12px;background:var(--ag-surface-2);color:var(--ag-ink);font-family:inherit;font-size:14px;`)}
      />
    </label>
  );
}

/** "3 Jan 2026" — a date a person reads, not an ISO string. */
function niceDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function niceDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function Profile() {
  const navigate = useNavigate();
  const { profile, session, signOut, updatePassword, refreshProfile } = useAuth();
  const { showToast } = useShop();

  const email = session?.user?.email ?? profile?.email ?? '';
  const role = profile?.role ?? '';

  const [name, setName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [city, setCity] = useState(profile?.city ?? '');
  const [savingDetails, setSavingDetails] = useState(false);

  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmGlobal, setConfirmGlobal] = useState(false);
  const [busyGlobal, setBusyGlobal] = useState(false);

  const dirty =
    name !== (profile?.full_name ?? '') ||
    phone !== (profile?.phone ?? '') ||
    city !== (profile?.city ?? '');

  const saveDetails = async () => {
    if (!profile?.id) return;
    if (!name.trim()) { showToast('Name cannot be empty', 'error'); return; }
    setSavingDetails(true);
    try {
      // Empty strings are stored as NULL, not '', so "no phone on file" is one
      // value everywhere rather than two that render differently.
      await updateMyProfile(profile.id, {
        full_name: name.trim(),
        phone: phone.trim() || null,
        city: city.trim() || null,
      });
      // The header avatar and every "signed in as" label read from context, so
      // without this the page would show the new name and the rest of the
      // console would keep showing the old one until a reload.
      await refreshProfile();
      showToast('Profile updated');
    } catch (err) {
      showToast((err as Error)?.message ?? 'Could not save your details', 'error');
    } finally {
      setSavingDetails(false);
    }
  };

  const changePassword = async () => {
    if (pw.length < 8) { showToast('Use at least 8 characters', 'error'); return; }
    if (pw !== pw2) { showToast('The two passwords do not match', 'error'); return; }
    setSavingPw(true);
    try {
      await updatePassword(pw);
      setPw(''); setPw2('');
      showToast('Password changed');
    } catch (err) {
      showToast((err as Error)?.message ?? 'Could not change the password', 'error');
    } finally {
      setSavingPw(false);
    }
  };

  /**
   * Sign out everywhere. `scope: 'global'` revokes every refresh token on the
   * account, so a session left open on a shared or lost machine dies too — the
   * reason to reach for this rather than the ordinary Log out below.
   */
  const signOutEverywhere = async () => {
    setBusyGlobal(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'global' });
      if (error) throw error;
      navigate('/', { replace: true });
    } catch (err) {
      showToast((err as Error)?.message ?? 'Could not sign out everywhere', 'error');
      setBusyGlobal(false);
    }
  };

  const logout = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

  return (
    <div style={css('max-width:760px;display:flex;flex-direction:column;gap:16px;')}>

      {/* Identity. The same crimson circle as the header avatar, at a size that
          reads as "this is you" rather than as a control. */}
      <Card>
        <div style={css('display:flex;align-items:center;gap:16px;flex-wrap:wrap;')}>
          <div style={css('width:64px;height:64px;border-radius:20px;background:#B02454;color:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;flex:none;')}>
            {initial(profile?.full_name ?? email ?? 'A')}
          </div>
          <div style={css('min-width:0;flex:1;')}>
            <div style={css('font-size:19px;font-weight:800;line-height:1.25;')}>{profile?.full_name || 'Unnamed account'}</div>
            <div style={css(`font-size:13px;color:${T.muted};margin-top:3px;word-break:break-word;`)}>{email || 'No email on file'}</div>
            <div style={css('display:inline-flex;align-items:center;gap:6px;margin-top:9px;padding:4px 11px;border-radius:999px;background:var(--ag-good-bg);color:var(--ag-good-text);font-size:11.5px;font-weight:800;')}>
              <Icon name="shield_person" size={15} />
              {ROLE_LABEL[role] ?? role ?? 'Account'}
            </div>
          </div>
        </div>
      </Card>

      {/* Editable details. */}
      <SectionCard title="Your details">
        <Field label="Full name" value={name} onChange={setName} placeholder="Your name" autoComplete="name" />
        <Field label="Phone" value={phone} onChange={setPhone} placeholder="Optional" type="tel" autoComplete="tel" />
        <Field label="City" value={city} onChange={setCity} placeholder="Optional" autoComplete="address-level2" />

        <div style={css('margin-top:4px;')}>
          <Fact label="Email" value={email || '—'} hint="Changed by an admin from the Users page" />
          <Fact label="Role" value={ROLE_LABEL[role] ?? role ?? '—'} hint="Only another admin can change this" />
          {/* The AUTH user's created_at, not profiles.created_at: the shared
              Profile type does not carry that column, and the date the login
              was created is what "member since" means anyway. */}
          <Fact label="Member since" value={niceDate(session?.user?.created_at)} />
        </div>

        <div style={css('display:flex;justify-content:flex-end;gap:10px;margin-top:16px;')}>
          <GhostButton
            icon="save"
            tone="primary"
            disabled={!dirty || savingDetails}
            onClick={saveDetails}
          >
            {savingDetails ? 'Saving…' : 'Save changes'}
          </GhostButton>
        </div>
      </SectionCard>

      {/* Security. Two-factor is deliberately NOT duplicated here — it already
          has a full panel (SecurityCard) on Settings for admins and StaffHome
          for employees, and a third copy of enrolment UI is a third place for
          the backup-code count to disagree. */}
      <SectionCard title="Security">
        <Fact label="Last signed in" value={niceDateTime(session?.user?.last_sign_in_at)} />

        <div style={css('margin-top:16px;')}>
          <div style={css('font-size:13.5px;font-weight:800;margin-bottom:10px;')}>Change password</div>
          <Field label="New password" value={pw} onChange={setPw} type="password" autoComplete="new-password" placeholder="At least 8 characters" />
          <Field label="Confirm new password" value={pw2} onChange={setPw2} type="password" autoComplete="new-password" placeholder="Type it again" />
          <div style={css('display:flex;justify-content:flex-end;')}>
            <GhostButton icon="key" tone="primary" disabled={!pw || !pw2 || savingPw} onClick={changePassword}>
              {savingPw ? 'Changing…' : 'Change password'}
            </GhostButton>
          </div>
        </div>

        <div style={css(`margin-top:18px;padding-top:16px;border-top:1px solid ${T.border};display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;`)}>
          <div style={css('min-width:0;')}>
            <div style={css('font-size:13.5px;font-weight:800;')}>Sign out on every device</div>
            <div style={css(`font-size:12px;color:${T.muted};margin-top:3px;`)}>
              Ends every session on this account, including any left open elsewhere.
            </div>
          </div>
          <GhostButton icon="devices" tone="danger" onClick={() => setConfirmGlobal(true)}>Sign out everywhere</GhostButton>
        </div>

        <div style={css(`margin-top:14px;font-size:12px;color:${T.muted};display:flex;align-items:center;gap:7px;`)}>
          <Icon name="info" size={16} />
          Two-factor authentication is managed on the {role === 'staff' ? 'My Work' : 'Settings'} page.
        </div>
      </SectionCard>

      {/* Appearance — the same three-segment control the buyer and seller use. */}
      <ThemeToggle variant="card" />

      {/* The way out, now that the avatar is not. */}
      <Card>
        <div style={css('display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;')}>
          <div style={css('min-width:0;')}>
            <div style={css('font-size:14px;font-weight:800;')}>Log out</div>
            <div style={css(`font-size:12px;color:${T.muted};margin-top:3px;`)}>Ends this session on this device only.</div>
          </div>
          <GhostButton icon="logout" tone="danger" onClick={() => setConfirmLogout(true)}>Log out</GhostButton>
        </div>
      </Card>

      <div style={css(`font-size:11.5px;color:${T.muted};text-align:center;padding-bottom:8px;`)}>
        Signed in to the MangaiMart console ·{' '}
        {/* A router navigation, not an <a href>: a plain link would reload the
            whole SPA and throw away the console's warmed state. */}
        <button
          onClick={() => navigate(role === 'staff' ? adminPath('staff') : adminPath('overview'))}
          style={css(`background:none;border:none;padding:0;cursor:pointer;font-family:inherit;font-size:11.5px;color:${T.accent};text-decoration:underline;`)}
        >
          Back to the console
        </button>
      </div>

      <ConfirmDialog
        open={confirmLogout}
        title="Log out?"
        message="You will need your password and your authenticator to get back in."
        confirmLabel="Log out"
        danger
        onConfirm={logout}
        onCancel={() => setConfirmLogout(false)}
      />

      <ConfirmDialog
        open={confirmGlobal}
        title="Sign out everywhere?"
        message="Every device signed in to this account will be logged out, including this one. Use this if a phone or laptop has been lost."
        confirmLabel="Sign out everywhere"
        danger
        busy={busyGlobal}
        onConfirm={signOutEverywhere}
        onCancel={() => setConfirmGlobal(false)}
      />
    </div>
  );
}
