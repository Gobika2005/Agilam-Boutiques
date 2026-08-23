import { supabase } from '@/lib/supabase';

/**
 * Two-factor authentication (TOTP) — the client half.
 *
 * WHAT MAKES THIS REAL AND NOT A UI GATE
 * Everything here is a thin wrapper over Supabase's own MFA, and that is the
 * point. When `verifyChallenge` succeeds, GoTrue re-mints the session's JWT
 * with `aal: "aal2"`, Postgres sees that claim in `request.jwt.claims`, and
 * migration 0100's `is_admin()` / `is_staff()` test it. So the console's data is
 * withheld by the database until a code is entered — not by the screens in this
 * app, which an attacker holding a stolen password would simply not load.
 *
 * That is also why none of the obvious shortcuts are available. We cannot
 * "remember this device" past a fresh sign-in (a remembered device is an aal1
 * session, and RLS would hand it an empty console), and we cannot accept a
 * backup code as a login (only GoTrue can mint aal2). See `mfa-recovery`.
 *
 * WHAT THE ASSURANCE LEVELS MEAN IN PRACTICE
 *   current aal1 / next aal1  → no factor enrolled. Nothing to challenge.
 *   current aal1 / next aal2  → enrolled but not yet challenged this session.
 *   current aal2 / next aal2  → done; the JWT carries aal2.
 *
 * `nextLevel` is the enrolment signal, `currentLevel` the "did they type a code
 * this session" one, and confusing the two is the easy bug here.
 */

export type MfaState =
  /** Session is fully verified — the console is open. */
  | 'verified'
  /** Has an authenticator, hasn't entered a code since signing in. */
  | 'challenge'
  /** No authenticator yet. Must enrol before they can be challenged. */
  | 'enroll'
  /** Not signed in, so the question does not arise. */
  | 'anonymous';

export type EnrollStart = {
  factorId: string;
  /** An `<img src>`-ready SVG data URL from GoTrue. No QR library needed. */
  qrCode: string;
  /** The same secret in text, for authenticator apps entered by hand. */
  secret: string;
};

/**
 * Where the signed-in session stands. Read after any auth change, and again
 * after a verify — the AAL is a property of the JWT, so it only moves when the
 * token does.
 */
export async function readMfaState(): Promise<MfaState> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return 'anonymous';

  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  // Treat an unreadable AAL as "enrol" rather than "verified". If this call is
  // failing we do not know what the session is, and the safe direction for an
  // unknown is the one that asks for more proof, not less. The database is
  // enforcing this regardless, so a wrong guess here costs a confusing screen,
  // never access.
  if (error || !data) return 'enroll';

  if (data.currentLevel === 'aal2') return 'verified';
  return data.nextLevel === 'aal2' ? 'challenge' : 'enroll';
}

/** True when the account has an authenticator registered, verified or not. */
export async function hasEnrolledFactor(): Promise<boolean> {
  const { data } = await supabase.auth.mfa.listFactors();
  return !!data?.totp?.length;
}

/**
 * Begin enrolment: returns the QR code to scan.
 *
 * Abandoned enrolments leave `unverified` factors behind — someone who opens
 * this screen three times before finding their phone would otherwise collect
 * three of them, and Supabase rejects a duplicate friendly name, so the third
 * attempt would fail with an error about a name the user never typed. Clearing
 * the unverified ones first makes re-opening the screen always work.
 */
export async function startEnrollment(friendlyName = 'MangaiMart'): Promise<EnrollStart> {
  const { data: existing } = await supabase.auth.mfa.listFactors();
  for (const factor of existing?.all ?? []) {
    if (factor.status !== 'verified') {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName });
  if (error) throw new Error(friendlyMfaError(error.message));
  if (!data) throw new Error('Could not start setup. Please try again.');

  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

/**
 * Verify a 6-digit code against a factor — used both to finish enrolment and to
 * unlock a later session.
 *
 * On success the local session is upgraded to aal2 in place, which is why the
 * caller must re-read the AAL rather than assume it: React state derived from
 * the old token is now stale.
 */
export async function verifyChallenge(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: code.replace(/\D/g, ''),
  });
  if (error) throw new Error(friendlyMfaError(error.message));
}

/** The verified factor to challenge against, if the account has one. */
export async function verifiedFactorId(): Promise<string | null> {
  const { data } = await supabase.auth.mfa.listFactors();
  return data?.totp?.find((f) => f.status === 'verified')?.id ?? null;
}

/**
 * Turn 2FA off for the signed-in user.
 *
 * Supabase requires aal2 to unenrol a verified factor, which is the correct
 * behaviour and worth not working around: without it, a stolen aal1 session
 * could strip the protection it had just been stopped by.
 */
export async function disableMfa(): Promise<void> {
  const { data } = await supabase.auth.mfa.listFactors();
  for (const factor of data?.all ?? []) {
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) throw new Error(friendlyMfaError(error.message));
  }
}

/**
 * Issue ten fresh single-use backup codes, invalidating any earlier set.
 *
 * Returned in clear text exactly once — there is nowhere to read them back
 * from, by design (the table stores only sha256 hashes). The caller must show
 * them before navigating away.
 */
export async function generateBackupCodes(): Promise<string[]> {
  const { data, error } = await supabase.rpc('mfa_backup_codes_generate');
  if (error) throw new Error(friendlyMfaError(error.message));
  return (data as string[] | null) ?? [];
}

/** How many unused backup codes remain, for the "n of 10 left" line. */
export async function backupCodesRemaining(): Promise<number> {
  const { data, error } = await supabase.rpc('mfa_backup_codes_remaining');
  if (error) return 0;
  return typeof data === 'number' ? data : 0;
}

/**
 * Spend a backup code to clear a lost authenticator.
 *
 * This does NOT sign anybody in — it removes the factor so the user can enrol a
 * new one and challenge normally. Deleting a factor needs the Admin API, so the
 * work happens in the `mfa-recovery` Edge Function; the browser only carries
 * its own session token there.
 */
export async function redeemBackupCode(code: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('mfa-recovery', {
    body: { action: 'redeem', code },
  });
  if (error) throw new Error(friendlyMfaError(error.message));
  const body = data as { ok?: boolean; error?: string } | null;
  if (!body?.ok) throw new Error(body?.error ?? 'That backup code is not valid.');
}

/**
 * Admin action: clear another account's 2FA so they can enrol again.
 *
 * The Edge Function re-checks that the caller is an admin at aal2 — this
 * function being called from an admin screen is not the guard, because the
 * screen is not what an attacker would use.
 */
export async function adminResetMfa(userId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('mfa-recovery', {
    body: { action: 'admin-reset', userId },
  });
  if (error) throw new Error(friendlyMfaError(error.message));
  const body = data as { ok?: boolean; error?: string } | null;
  if (!body?.ok) throw new Error(body?.error ?? 'Could not reset two-factor authentication.');
}

/**
 * Which accounts have 2FA on, as a set of user ids.
 *
 * `auth.mfa_factors` is not readable from the browser, so this goes through
 * 0099's `mfa_enrollment_status()`.
 */
export async function enrolledUserIds(): Promise<Set<string>> {
  const { data, error } = await supabase.rpc('mfa_enrollment_status');
  if (error || !data) return new Set();
  return new Set((data as { user_id: string }[]).map((r) => r.user_id));
}

/** Readable text for the raw GoTrue MFA errors. */
export function friendlyMfaError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid totp code') || (m.includes('invalid') && m.includes('code'))) {
    // Nearly always clock drift on the phone rather than a mistyped code, and
    // saying so saves a support round-trip.
    return 'That code is not right. Codes change every 30 seconds — try the current one, and check your phone’s clock is set automatically.';
  }
  if (m.includes('already exists') || m.includes('friendly name')) {
    return 'Setup was already started. Reload this page and scan the new QR code.';
  }
  if (m.includes('aal2') || m.includes('insufficient') || m.includes('assurance')) {
    return 'Enter a code from your authenticator app first.';
  }
  if (m.includes('rate') || m.includes('too many')) {
    return 'Too many attempts — wait a minute and try again.';
  }
  if (m.includes('factor not found') || m.includes('no factor')) {
    return 'No authenticator is registered on this account. Set one up to continue.';
  }
  const t = message.trim();
  if (!t || t === '{}' || t.startsWith('{')) {
    return 'Two-factor authentication is unavailable right now. Please try again.';
  }
  return message;
}
