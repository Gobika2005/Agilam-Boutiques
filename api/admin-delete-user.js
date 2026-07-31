import { serviceClient } from './_supabase.js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Built lazily (null when env is missing) so a misconfigured deploy returns a
// clean 500 from the handler instead of throwing at import time, which crashes
// the whole function on cold start with no diagnosable response.
const supabaseAdmin = serviceClient(supabaseUrl, supabaseServiceKey);

// Validate the caller's access token with the same service-role client that
// performs the delete, so the token check and the admin lookup always hit one
// project (see admin-create-user for the rationale).
async function authenticateAdmin(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization;
  const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : '';

  if (!token) return { ok: false, status: 401, error: 'Missing admin session' };

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !authData?.user) return { ok: false, status: 401, error: 'Invalid admin session' };

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('id, role, status, deleted_at')
    .eq('id', authData.user.id)
    .maybeSingle();

  if (profileError) return { ok: false, status: 500, error: 'Could not verify admin access' };
  if (!profile || profile.role !== 'admin' || profile.status !== 'active' || profile.deleted_at) {
    return { ok: false, status: 403, error: 'Admin access required' };
  }

  return { ok: true, adminId: authData.user.id };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabaseAdmin) return res.status(500).json({ error: 'User management is not configured on the server. Set SUPABASE_SERVICE_ROLE_KEY in the deployment environment and redeploy.' });

  const auth = await authenticateAdmin(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  try {
    const { userId, action } = req.body || {};
    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: 'A userId is required' });
    }

    // ── Restore an archived user ─────────────────────────────────────────────
    // The soft-delete path below sets deleted_at + status='blocked' AND bans the
    // auth login. Restoring must undo all three, or the user reappears as active
    // in the list but still can't sign in. Clearing the profile flags needs the
    // service role here (an admin could do it via RLS, but only the service role
    // can lift the auth ban), so both happen together.
    if (action === 'restore') {
      const { error: profErr } = await supabaseAdmin
        .from('profiles')
        .update({ deleted_at: null, status: 'active', updated_at: new Date().toISOString() })
        .eq('id', userId);
      if (profErr) {
        console.error('[RESTORE_ERROR]', profErr);
        return res.status(500).json({ error: 'Failed to restore the user' });
      }
      // Best-effort un-ban: a user archived without a ban (or already unbanned)
      // must still report success, so a failure here is logged, not fatal.
      await supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: 'none' }).catch((e) => {
        console.warn('[RESTORE_UNBAN]', e?.message ?? e);
      });
      return res.status(200).json({ mode: 'restored', message: 'User restored and their login re-enabled.' });
    }

    if (userId === auth.adminId) {
      return res.status(400).json({ error: 'You cannot delete your own admin account' });
    }

    // Never delete an admin account — that risks locking the business out of the
    // console. To remove one, change their role first, then delete.
    const { data: target } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    if (target?.role === 'admin') {
      return res.status(400).json({ error: 'Admin accounts cannot be deleted. Change their role first, then delete.' });
    }

    // Attempt a permanent delete. Deleting the auth user cascades to the profile
    // and all owned rows that reference it with ON DELETE CASCADE (wishlist,
    // cart, reviews, conversations, inspire posts, a seller's boutique). It is
    // BLOCKED only when the user still has rows that must be kept — orders
    // (financial record) and chat messages — whose FKs intentionally don't
    // cascade. In that case we archive instead of destroying history.
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (!deleteError) {
      return res.status(200).json({
        mode: 'deleted',
        message: 'User permanently deleted from the database.',
      });
    }

    console.warn('[DELETE_FALLBACK]', deleteError?.message);

    // Preserve records: soft-delete the profile (hidden from the active list,
    // restorable) and ban the auth user so the login can no longer be used.
    const [{ error: softError }] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .update({ deleted_at: new Date().toISOString(), status: 'blocked', updated_at: new Date().toISOString() })
        .eq('id', userId),
      supabaseAdmin.auth.admin.updateUserById(userId, { ban_duration: '876000h' }).catch(() => {}),
    ]);

    if (softError) {
      console.error('[SOFT_DELETE_ERROR]', softError);
      return res.status(500).json({ error: 'Failed to delete the user' });
    }

    return res.status(200).json({
      mode: 'archived',
      message: 'This user has orders or chat history, so their records were kept. The account has been archived and its login disabled.',
    });
  } catch (error) {
    console.error('[API_ERROR]', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
