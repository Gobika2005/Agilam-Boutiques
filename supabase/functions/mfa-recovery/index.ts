/**
 * mfa-recovery — the two ways a lost authenticator gets un-lost.
 *
 *   redeem       a user spends one of their own backup codes
 *   admin-reset  an admin clears 2FA for somebody else
 *
 * Both do the same thing in the end: delete the account's TOTP factors, so the
 * next sign-in lands on the enrol screen instead of the challenge screen.
 *
 * WHY THIS IS AN EDGE FUNCTION
 * Two reasons, and the second is the real one.
 *
 * 1. `api/` is at the 12/12 Vercel Hobby function ceiling. There is no room for
 *    another route there, which is the same reason WhatsApp and Shiprocket live
 *    out here (see CLAUDE.md).
 * 2. Deleting an MFA factor is a GoTrue Admin API call, so it needs the service
 *    role key. That key cannot go anywhere the browser can reach it.
 *
 * WHY A BACKUP CODE DOES NOT LOG YOU IN
 * Only GoTrue can mint a JWT carrying `aal2`, and it only does that for a real
 * TOTP challenge. Anything we honoured ourselves would be a flag in React over
 * a session the database still sees as aal1 — and after migration 0100 the
 * database is what withholds the console. So a code buys a fresh enrolment,
 * not a session. That is the honest version of the feature.
 *
 * WHY BRUTE FORCE IS NOT GUARDED HERE
 * The codes are 64 bits (0099 issues 16 hex characters), single-use, and ten to
 * an account. Guessing one is not a thing that happens, so this endpoint does
 * not carry a rate limiter of its own — it inherits the platform's. If the code
 * length in `mfa_backup_codes_generate` is ever shortened for readability, that
 * reasoning dies with it and a limiter becomes mandatory.
 *
 * DEPLOY — with JWT verification ON, unlike `unsubscribe`. Every caller here
 * must already hold a session; an anonymous request has nothing to recover.
 *   supabase functions deploy mfa-recovery
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/**
 * Read the claims out of a JWT without verifying the signature.
 *
 * Safe only because this function is deployed with verify_jwt on, so the
 * platform has already rejected anything unsigned or expired before our code
 * runs — and because the two claims read here (`sub`, `aal`) are re-checked
 * against the database below rather than trusted on their own.
 */
function claims(token: string): { sub?: string; aal?: string } {
  try {
    const [, payload] = token.split('.');
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
  } catch {
    return {};
  }
}

/** Remove every MFA factor on an account. Returns how many were removed. */
async function clearFactors(admin: ReturnType<typeof createClient>, userId: string): Promise<number> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) throw new Error(error.message);

  const factors = data.user?.factors ?? [];
  for (const factor of factors) {
    const { error: delErr } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (delErr) throw new Error(delErr.message);
  }
  return factors.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ ok: false, error: 'Sign in first.' }, 401);

  const { sub: callerId, aal: callerAal } = claims(token);
  if (!callerId || !UUID.test(callerId)) return json({ ok: false, error: 'Sign in first.' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  let body: { action?: string; code?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Malformed request.' }, 400);
  }

  // ── A user spending one of their own backup codes ─────────────────────────
  //
  // Deliberately reachable at aal1: the entire point is that this person cannot
  // complete a challenge right now. The password they signed in with plus a
  // code only they hold is the two-factor pair being honoured here.
  if (body.action === 'redeem') {
    const code = (body.code ?? '').trim();
    if (!code) return json({ ok: false, error: 'Enter a backup code.' }, 400);

    const { data: ok, error } = await admin.rpc('mfa_backup_code_consume', {
      p_user: callerId,
      p_code: code,
    });
    if (error) return json({ ok: false, error: 'Could not check that code. Please try again.' }, 500);
    // One message for "wrong code", "already used" and "no codes issued". The
    // distinctions are only useful to somebody who is not the owner.
    if (!ok) return json({ ok: false, error: 'That backup code is not valid or has already been used.' }, 400);

    try {
      await clearFactors(admin, callerId);
    } catch (e) {
      // The code is already spent at this point and cannot be handed back. Say
      // so plainly rather than inviting a retry that would burn a second one.
      return json(
        { ok: false, error: `Your code was accepted but the reset failed: ${e instanceof Error ? e.message : 'unknown error'}. Contact support before using another code.` },
        500,
      );
    }

    await admin.from('admin_activity_log').insert({
      actor_id: callerId,
      actor_name: 'Account owner',
      action: 'mfa.backup_code_redeemed',
      entity_type: 'profile',
      entity_id: callerId,
      meta: { note: 'Authenticator cleared with a backup code; re-enrolment required.' },
    });

    return json({ ok: true });
  }

  // ── An admin clearing somebody else's 2FA ─────────────────────────────────
  if (body.action === 'admin-reset') {
    const targetId = (body.userId ?? '').trim();
    if (!UUID.test(targetId)) return json({ ok: false, error: 'Unknown account.' }, 400);

    // Role comes from the database, never from the token: a JWT says what role
    // GoTrue knew at sign-in, and an admin demoted five minutes ago still holds
    // one. The `aal` claim IS taken from the token — it is minted per-token by
    // GoTrue and is the only place it exists.
    const { data: caller } = await admin
      .from('profiles')
      .select('id, role, full_name, status, deleted_at')
      .eq('id', callerId)
      .maybeSingle();

    const isLiveAdmin =
      caller?.role === 'admin' && (caller.status ?? 'active') === 'active' && caller.deleted_at == null;
    if (!isLiveAdmin) return json({ ok: false, error: 'Admins only.' }, 403);

    // An admin at aal1 must not be able to strip 2FA from other accounts — that
    // would be a one-call unwind of the whole scheme by whoever stole a single
    // password. Staff are excluded by the role check above for the same reason:
    // this is a "money and people" action, and 0086 keeps those away from staff.
    if (callerAal !== 'aal2') {
      return json({ ok: false, error: 'Enter your own authenticator code first, then retry.' }, 403);
    }

    let removed = 0;
    try {
      removed = await clearFactors(admin, targetId);
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : 'Reset failed.' }, 500);
    }

    // Backup codes are per-authenticator. Leaving the old set live would mean a
    // reset account still had ten working bypasses tied to a factor that no
    // longer exists.
    await admin.from('mfa_backup_codes').delete().eq('user_id', targetId);

    await admin.from('admin_activity_log').insert({
      actor_id: callerId,
      actor_name: caller?.full_name || 'Admin',
      action: 'mfa.admin_reset',
      entity_type: 'profile',
      entity_id: targetId,
      meta: { factors_removed: removed },
    });

    return json({ ok: true, removed });
  }

  return json({ ok: false, error: 'Unknown action.' }, 400);
});
