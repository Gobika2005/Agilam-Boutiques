import { supabase } from '@/lib/supabase';
import { csvDocument } from '@/lib/csv';
import type { Role } from '@/types/database';

export interface AdminUserRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  address: string | null;
  role: Role;
  status: 'active' | 'blocked';
  deleted_at: string | null;
  created_at: string;
  orders: number;
  spent: number;
}

export interface UsersQuery {
  page: number;
  pageSize: number;
  search?: string;
  role?: 'all' | Role;
  status?: 'all' | 'active' | 'blocked' | 'deleted';
}

export interface Paged<T> {
  rows: T[];
  total: number;
}

/**
 * Load users through the service-role endpoint (bypasses RLS), so the admin list
 * always reflects the whole `profiles` table — never a subset because of a
 * session/is_admin() quirk. A blocked/deleted admin gets a clear error instead
 * of a silent empty list.
 */
export async function fetchUsers(q: UsersQuery): Promise<Paged<AdminUserRow>> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Admin session expired. Please sign in again.');

  const response = await fetch('/api/admin-list-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      page: q.page,
      pageSize: q.pageSize,
      search: q.search ?? '',
      role: q.role ?? 'all',
      status: q.status ?? 'all',
    }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to load users');
  return { rows: (data.rows ?? []) as AdminUserRow[], total: data.total ?? 0 };
}

/**
 * The admin session token every write below needs. These calls used to go
 * straight from the browser to Postgres; they run server-side now so the person
 * whose access changed can be emailed about it — and only the server holds the
 * mail provider key.
 */
async function adminPost(body: Record<string, unknown>, path: string, failMessage: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Admin session expired. Please sign in again.');

  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || failMessage);
  return data as { message?: string; emailSent?: boolean; mode?: string; roleChanged?: boolean };
}

export interface AccessChangeResult {
  message: string;
  /** False when the provider is unset or the send failed — the admin should tell them directly. */
  emailSent: boolean;
}

/**
 * Block or unblock an account. The affected user is emailed either way; on a
 * block, an optional admin-typed `reason` is quoted to them verbatim.
 */
export async function setUserStatus(
  id: string,
  status: 'active' | 'blocked',
  reason?: string,
): Promise<AccessChangeResult> {
  const data = await adminPost(
    { userId: id, action: status === 'blocked' ? 'block' : 'unblock', reason: reason ?? '' },
    '/api/admin-delete-user',
    'Failed to update the user',
  );
  return {
    message: data.message ?? (status === 'blocked' ? 'User blocked.' : 'User unblocked.'),
    emailSent: data.emailSent ?? false,
  };
}

export interface DeleteUserResult {
  mode: 'deleted' | 'archived';
  message: string;
  emailSent: boolean;
}

/**
 * Permanently delete a user from the database (auth login + profile + all
 * cascading data). Runs server-side with the service role. If the user has
 * orders or chat history, the server archives them instead (records kept, login
 * disabled) and returns mode: 'archived'.
 *
 * Either way the person is emailed a closure notice, with the optional
 * admin-typed `reason` quoted. On a hard delete that mail is sent from data read
 * before the row is destroyed — afterwards there is no address left to use.
 */
export async function deleteUserEverywhere(id: string, reason?: string): Promise<DeleteUserResult> {
  const data = await adminPost(
    { userId: id, reason: reason ?? '' },
    '/api/admin-delete-user',
    'Failed to delete user',
  );
  return {
    mode: (data.mode as 'deleted' | 'archived') ?? 'deleted',
    message: data.message ?? 'User deleted.',
    emailSent: data.emailSent ?? false,
  };
}

/**
 * Restore an archived user: clears the soft-delete, sets status back to active
 * and lifts the auth-login ban. Runs server-side with the service role because
 * only it can un-ban the auth user — a client-side profile update alone would
 * leave the login disabled. The user is emailed that they are back in.
 */
export async function restoreUser(id: string): Promise<AccessChangeResult> {
  const data = await adminPost({ userId: id, action: 'restore' }, '/api/admin-delete-user', 'Failed to restore user');
  return { message: data.message ?? 'User restored.', emailSent: data.emailSent ?? false };
}

export interface UserDetail {
  orders: {
    id: string;
    order_number: string;
    total: number;
    status: string;
    created_at: string;
    boutique: string;
  }[];
  wishlist: number;
  totalSpent: number;
}

export async function fetchUserDetail(id: string): Promise<UserDetail> {
  const [ordersRes, wishRes] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, total, status, created_at, boutique:boutiques(name)')
      .eq('buyer_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('wishlist').select('product_id', { count: 'exact', head: true }).eq('buyer_id', id),
  ]);

  const orders = (ordersRes.data ?? []) as unknown as {
    id: string;
    order_number: string;
    total: number;
    status: string;
    created_at: string;
    boutique: { name: string } | null;
  }[];

  return {
    orders: orders.map((o) => ({
      id: o.id,
      order_number: o.order_number,
      total: Number(o.total),
      status: o.status,
      created_at: o.created_at,
      boutique: o.boutique?.name ?? '-',
    })),
    wishlist: wishRes.count ?? 0,
    totalSpent: orders.reduce((sum, o) => sum + Number(o.total), 0),
  };
}

export function usersToCsv(rows: AdminUserRow[]): string {
  // Name, email, phone and city are all typed by the user themselves, so every
  // cell goes through csvCell — which neutralises a leading `=`/`+`/`-`/`@` as
  // well as quoting. See src/lib/csv.ts for why quoting alone is not enough.
  const head = ['Name', 'Email', 'Phone', 'City', 'Role', 'Status', 'Orders', 'Spent', 'Joined'];
  return csvDocument(
    head,
    rows.map((r) => [
      r.full_name,
      r.email,
      r.phone,
      r.city,
      r.role,
      r.deleted_at ? 'deleted' : r.status,
      r.orders,
      r.spent,
      new Date(r.created_at).toLocaleDateString('en-IN'),
    ]),
  );
}

export interface CreateUserInput {
  email: string;
  fullName: string;
  phone?: string;
  city?: string;
  role: Role;
}

export interface CreateUserResult {
  userId: string;
  message: string;
  emailSent: boolean;
  tempPassword: string;
}

export async function createUser(input: CreateUserInput): Promise<CreateUserResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  if (!accessToken) {
    throw new Error('Admin session expired. Please sign in again.');
  }

  const response = await fetch('/api/admin-create-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(input),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Failed to create user');
  }

  return {
    userId: data.userId,
    message: data.message,
    emailSent: data.emailSent ?? true,
    tempPassword: data.tempPassword ?? '',
  };
}

/**
 * Change only the role. Goes through the same server path as a full edit so it
 * cannot become a second, silent way to grant admin — a direct profiles UPDATE
 * here would skip the notification email entirely.
 */
export async function changeUserRole(userId: string, newRole: Role): Promise<AccessChangeResult> {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('full_name, phone, city, address')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) throw new Error('User not found');

  return updateUser(userId, {
    fullName: profile.full_name,
    phone: profile.phone,
    city: profile.city,
    address: profile.address,
    role: newRole,
  });
}

export interface UpdateUserInput {
  fullName: string;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  role: Role;
}

/**
 * Admin edit of an existing profile — name, contact, city, address and role.
 * Runs server-side: if the role moved, the user is emailed about it. Editing
 * anything else sends nothing, so correcting a typo stays quiet.
 */
export async function updateUser(userId: string, input: UpdateUserInput): Promise<AccessChangeResult> {
  const data = await adminPost(
    {
      action: 'update',
      userId,
      fullName: input.fullName.trim(),
      phone: input.phone?.trim() || null,
      city: input.city?.trim() || null,
      address: input.address?.trim() || null,
      role: input.role,
    },
    '/api/admin-create-user',
    'Failed to update the user',
  );
  return { message: data.message ?? 'User updated.', emailSent: data.emailSent ?? false };
}

export function storeAdoptedRole(role: Role): void {
  try {
    sessionStorage.setItem('agx-adopted-role', role);
  } catch {
    /* session storage unavailable */
  }
}

export function getAdoptedRole(): Role | null {
  try {
    return (sessionStorage.getItem('agx-adopted-role') as Role) || null;
  } catch {
    return null;
  }
}

export function clearAdoptedRole(): void {
  try {
    sessionStorage.removeItem('agx-adopted-role');
  } catch {
    /* session storage unavailable */
  }
}
