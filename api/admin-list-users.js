import { serviceClient } from './_supabase.js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Built lazily (null when env is missing) so a misconfigured deploy returns a
// clean 500 from the handler instead of throwing at import time, which crashes
// the whole function on cold start with no diagnosable response.
const supabaseAdmin = serviceClient(supabaseUrl, supabaseServiceKey);

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
    return { ok: false, status: 403, error: 'Admin access required (your admin account may be blocked or deleted)' };
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
    const body = req.body || {};
    const page = Math.max(0, Number(body.page) || 0);
    const pageSize = Math.min(100, Math.max(1, Number(body.pageSize) || 12));
    const role = body.role;
    const status = body.status;
    const search = typeof body.search === 'string' ? body.search.trim() : '';

    // Service role bypasses RLS, so the list always reflects the whole table —
    // no dependency on the caller's is_admin() / session shape.
    let query = supabaseAdmin
      .from('profiles')
      .select('id, full_name, email, phone, city, address, role, status, deleted_at, created_at', { count: 'exact' });

    if (role && role !== 'all') query = query.eq('role', role);
    // "All statuses" = everyone (active, blocked and soft-deleted).
    if (status === 'deleted') query = query.not('deleted_at', 'is', null);
    else if (status === 'active' || status === 'blocked') query = query.is('deleted_at', null).eq('status', status);

    if (search) {
      const s = `%${search}%`;
      query = query.or(`full_name.ilike.${s},email.ilike.${s},phone.ilike.${s},city.ilike.${s}`);
    }

    const from = page * pageSize;
    query = query.order('created_at', { ascending: false }).range(from, from + pageSize - 1);

    const { data, error, count } = await query;
    if (error) {
      console.error('[LIST_ERROR]', error);
      return res.status(500).json({ error: 'Failed to load users' });
    }

    const rows = data ?? [];
    const ids = rows.map((r) => r.id);
    const totals = {};
    if (ids.length) {
      const { data: ord } = await supabaseAdmin.from('orders').select('buyer_id, total').in('buyer_id', ids);
      (ord ?? []).forEach((o) => {
        if (!o.buyer_id) return;
        const cur = totals[o.buyer_id] || { orders: 0, spent: 0 };
        cur.orders += 1;
        cur.spent += Number(o.total) || 0;
        totals[o.buyer_id] = cur;
      });
    }

    return res.status(200).json({
      total: count ?? 0,
      rows: rows.map((r) => ({
        ...r,
        orders: totals[r.id]?.orders ?? 0,
        spent: totals[r.id]?.spent ?? 0,
      })),
    });
  } catch (error) {
    console.error('[API_ERROR]', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Internal server error' });
  }
}
