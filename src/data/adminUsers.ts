import { supabase } from '@/lib/supabase';
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

export async function setUserStatus(id: string, status: 'active' | 'blocked') {
  const { error } = await supabase
    .from('profiles')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function softDeleteUser(id: string) {
  const { error } = await supabase
    .from('profiles')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export interface DeleteUserResult {
  mode: 'deleted' | 'archived';
  message: string;
}

/**
 * Permanently delete a user from the database (auth login + profile + all
 * cascading data). Runs server-side with the service role. If the user has
 * orders or chat history, the server archives them instead (records kept, login
 * disabled) and returns mode: 'archived'.
 */
export async function deleteUserEverywhere(id: string): Promise<DeleteUserResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Admin session expired. Please sign in again.');

  const response = await fetch('/api/admin-delete-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ userId: id }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to delete user');
  return { mode: data.mode ?? 'deleted', message: data.message ?? 'User deleted.' };
}

/**
 * Restore an archived user: clears the soft-delete, sets status back to active
 * and lifts the auth-login ban. Runs server-side with the service role because
 * only it can un-ban the auth user — a client-side profile update alone would
 * leave the login disabled.
 */
export async function restoreUser(id: string) {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) throw new Error('Admin session expired. Please sign in again.');

  const response = await fetch('/api/admin-delete-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ userId: id, action: 'restore' }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Failed to restore user');
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
  const head = ['Name', 'Email', 'Phone', 'City', 'Role', 'Status', 'Orders', 'Spent', 'Joined'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      r.full_name,
      r.email,
      r.phone,
      r.city,
      r.role,
      r.deleted_at ? 'deleted' : r.status,
      r.orders,
      r.spent,
      new Date(r.created_at).toLocaleDateString('en-IN'),
    ].map(esc).join(','),
  );
  return [head.join(','), ...lines].join('\n');
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

export async function changeUserRole(userId: string, newRole: Role): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole, updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (error) throw error;
}

export interface UpdateUserInput {
  fullName: string;
  phone?: string | null;
  city?: string | null;
  address?: string | null;
  role: Role;
}

/** Admin edit of an existing profile — name, contact, city, address and role. */
export async function updateUser(userId: string, input: UpdateUserInput): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: input.fullName.trim(),
      phone: input.phone?.trim() || null,
      city: input.city?.trim() || null,
      address: input.address?.trim() || null,
      role: input.role,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (error) throw error;
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
