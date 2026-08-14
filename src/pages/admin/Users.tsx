import { useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth/AuthContext';
import {
  DataTable,
  SearchInput,
  Select,
  GhostButton,
  IconButton,
  StatusPill,
  Avatar,
  Pagination,
  Drawer,
  ConfirmDialog,
  Field,
  EmptyState,
  Icon,
  TabBar,
  T,
  type Column,
} from '@/components/admin/kit';
import { Customers } from '@/pages/admin/Customers';
import { logAdminAction } from '@/data/activityLog';
import {
  fetchUsers,
  setUserStatus,
  deleteUserEverywhere,
  restoreUser,
  fetchUserDetail,
  usersToCsv,
  createUser,
  updateUser,
  type AdminUserRow,
  type CreateUserInput,
  type UpdateUserInput,
} from '@/data/adminUsers';
import { useAsync } from '@/hooks/useAsync';
import { useDebounced } from '@/hooks/useDebounced';
import { LivePresence } from '@/pages/admin/LivePresence';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { useShop } from '@/state/ShopContext';
import type { Role } from '@/types/database';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useSeededSearch } from '@/hooks/useSeededSearch';

const PAGE_SIZE = 12;
const ROLE_PILL: Record<Role, { bg: string; fg: string }> = {
  buyer: { bg: 'var(--ag-info-bg)', fg: 'var(--ag-info-text)' },
  seller: { bg: 'var(--ag-purple-bg)', fg: '#9B7FC7' },
  admin: { bg: 'var(--ag-surface-2)', fg: '#D6336C' },
  staff: { bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' },
};

/**
 * Users — the account directory, plus Customer 360° as a tab.
 *
 * The two were separate sidebar entries and were both a searchable list of
 * people; this one is every account, the other ranks buyers by what they have
 * spent. Merged rather than deleted, so the spend view survives while the nav
 * gets shorter. `/admin/customers` still resolves — App.tsx redirects it here.
 */
const USER_TABS = [
  { key: 'accounts' as const, label: 'Accounts' },
  { key: 'customers' as const, label: 'Customer 360°' },
];

export function Users() {
  const [tab, setTab] = useState<'accounts' | 'customers'>('accounts');
  return (
    <div>
      <TabBar tabs={USER_TABS} value={tab} onChange={setTab} />
      {tab === 'accounts' ? <UserDirectory /> : <Customers />}
    </div>
  );
}

function UserDirectory() {
  const { showToast } = useShop();
  const { profile } = useAuth();
  const [page, setPage] = useState(0);
  const [rawSearch, setRawSearch] = useSeededSearch();
  const search = useDebounced(rawSearch, 300);
  const [role, setRole] = useState<'all' | Role>('all');
  const [status, setStatus] = useState<'all' | 'active' | 'blocked' | 'deleted'>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ user: AdminUserRow } | null>(null);
  const [blockUser, setBlockUser] = useState<AdminUserRow | null>(null);
  // Typed by the admin, quoted verbatim to the user in the block/close email.
  // One field serves both dialogs — only ever one of them is open.
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createData, setCreateData] = useState<CreateUserInput>({
    email: '',
    fullName: '',
    phone: '',
    city: '',
    role: 'buyer',
  });
  const [editUser, setEditUser] = useState<AdminUserRow | null>(null);
  const [editData, setEditData] = useState<UpdateUserInput>({ fullName: '', phone: '', city: '', address: '', role: 'buyer' });
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);

  const openEdit = (user: AdminUserRow) => {
    setEditData({
      fullName: user.full_name,
      phone: user.phone ?? '',
      city: user.city ?? '',
      address: user.address ?? '',
      role: user.role,
    });
    setEditUser(user);
  };

  const doUpdate = async () => {
    if (!editUser) return;
    if (!editData.fullName.trim()) {
      showToast('Name is required');
      return;
    }
    setBusy(true);
    try {
      const result = await updateUser(editUser.id, editData);
      await log('user.update', editUser.id, { name: editData.fullName, role: editData.role });
      // The server's message says whether the role moved and whether the user
      // was emailed about it — more useful than a flat "updated".
      showToast(editUser.role === editData.role ? `${editData.fullName} updated` : result.message);
      setEditUser(null);
      reload();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  // Bumped after a create/promote to force a foreground refetch. A new user
  // sorts to the top of page 0; reload()'s background refresh can miss it if the
  // admin isn't on a freshly-loaded page 0, so we reset to page 0 and hard-reload.
  const [refreshKey, setRefreshKey] = useState(0);
  const q = useMemo(() => ({ page, pageSize: PAGE_SIZE, search, role, status }), [page, search, role, status]);
  const { data, loading, reload, error } = useAsync(() => fetchUsers(q), [q, refreshKey]);
  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  const showFreshest = () => {
    setPage(0);
    setRefreshKey((k) => k + 1);
  };

  const changeFilter = (fn: () => void) => {
    fn();
    setPage(0);
  };

  const log = (action: string, entityId: string, meta?: Record<string, unknown>) =>
    logAdminAction({
      actor_id: profile?.id,
      actor_name: profile?.full_name ?? 'Admin',
      action,
      entity_type: 'profile',
      entity_id: entityId,
      meta,
    });

  /**
   * Unblocking needs no explanation, so it acts immediately. Blocking opens a
   * dialog instead — the user now receives an email about it, and "your account
   * has been suspended" with no reason attached is the message that generates a
   * support ticket.
   */
  const doUnblock = async (user: AdminUserRow) => {
    try {
      const result = await setUserStatus(user.id, 'active');
      await log('user.unblock', user.id, { name: user.full_name });
      showToast(result.message);
      reload();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Update failed');
    }
  };

  const doBlock = async () => {
    if (!blockUser) return;
    setBusy(true);
    try {
      const result = await setUserStatus(blockUser.id, 'blocked', reason);
      await log('user.block', blockUser.id, { name: blockUser.full_name, reason: reason.trim() || null });
      showToast(result.message);
      setBlockUser(null);
      setReason('');
      reload();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      const result = await deleteUserEverywhere(confirm.user.id, reason);
      await log(result.mode === 'archived' ? 'user.archive' : 'user.delete', confirm.user.id, {
        name: confirm.user.full_name,
        mode: result.mode,
        reason: reason.trim() || null,
      });
      showToast(result.message);
      setConfirm(null);
      setReason('');
      showFreshest();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async (user: AdminUserRow) => {
    try {
      const result = await restoreUser(user.id);
      await log('user.restore', user.id, { name: user.full_name });
      showToast(result.message);
      reload();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Restore failed');
    }
  };

  const exportCsv = () => {
    const csv = usersToCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mangaimart-users-page-${page + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported current page to CSV');
  };

  const doCreate = async () => {
    if (!createData.email.trim() || !createData.fullName.trim()) {
      showToast('Email and name are required');
      return;
    }

    setBusy(true);
    try {
      const result = await createUser(createData);
      await log('user.create', result.userId, { name: createData.fullName, role: createData.role });
      showToast(result.message);
      // If the welcome email didn't go out, the temp password would otherwise be
      // lost — surface it so the admin can hand it over. Only then do we hold the
      // drawer; on a clean send we reset and close as before.
      if (!result.emailSent && result.tempPassword) {
        setCredentials({ email: createData.email.trim().toLowerCase(), password: result.tempPassword });
      }
      setCreateOpen(false);
      setCreateData({ email: '', fullName: '', phone: '', city: '', role: 'buyer' });
      showFreshest();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Creation failed');
    } finally {
      setBusy(false);
    }
  };

  const columns: Column<AdminUserRow>[] = [
    {
      key: 'user',
      header: 'USER',
      width: '2.2fr',
      render: (user) => (
        <div style={css('display:flex;align-items:center;gap:10px;min-width:0;')}>
          <Avatar name={user.full_name} tone={user.full_name.charCodeAt(0) % 8} />
          <div style={css('min-width:0;')}>
            <div style={css('font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>
              {user.full_name}
            </div>
            <div style={css(`font-size:11.5px;color:${T.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>
              {user.email ?? user.phone ?? '-'}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'ROLE',
      width: '.9fr',
      render: (user) => (
        <span style={css(`font-size:11px;font-weight:800;padding:4px 10px;border-radius:8px;background:${ROLE_PILL[user.role].bg};color:${ROLE_PILL[user.role].fg};`)}>
          {user.role}
        </span>
      ),
    },
    {
      key: 'city',
      header: 'CITY',
      width: '1fr',
      render: (user) => <span style={css('font-size:13px;color:var(--ag-label);')}>{user.city || '-'}</span>,
    },
    {
      key: 'orders',
      header: 'ORDERS',
      width: '.7fr',
      render: (user) => <span style={css('font-size:13px;color:var(--ag-label);')}>{user.orders}</span>,
    },
    {
      key: 'spent',
      header: 'SPENT',
      width: '1fr',
      render: (user) => <span style={css(`font-size:13px;font-weight:700;color:${T.accent};`)}>{fmtInr(user.spent)}</span>,
    },
    {
      key: 'status',
      header: 'STATUS',
      width: '1fr',
      render: (user) => <StatusPill status={user.deleted_at ? 'rejected' : user.status} label={user.deleted_at ? 'Deleted' : undefined} />,
    },
    {
      key: 'actions',
      header: 'ACTIONS',
      width: '1.5fr',
      align: 'right',
      render: (user) => (
        <div style={css('display:flex;gap:8px;justify-content:flex-end;')} onClick={(e) => e.stopPropagation()}>
          {user.deleted_at ? (
            <IconButton icon="restore_from_trash" tone="success" title="Restore" onClick={() => doRestore(user)} />
          ) : (
            <>
              <IconButton icon="visibility" title="View" onClick={() => setDetailId(user.id)} />
              <IconButton icon="edit" title="Edit" onClick={() => openEdit(user)} />
              {/* Never let an active admin be blocked (that would lock them out of
                  the console); unblocking one is still allowed. */}
              {(user.status === 'blocked' || user.role !== 'admin') && (
                <IconButton
                  icon={user.status === 'blocked' ? 'lock_open' : 'block'}
                  tone={user.status === 'blocked' ? 'success' : 'warn'}
                  title={user.status === 'blocked' ? 'Unblock' : 'Block'}
                  onClick={() => {
                    if (user.status === 'blocked') {
                      doUnblock(user);
                    } else {
                      setReason('');
                      setBlockUser(user);
                    }
                  }}
                />
              )}
              {/* Admins can't be deleted (change their role first); can't delete self. */}
              {user.id !== profile?.id && user.role !== 'admin' && (
                <IconButton
                  icon="delete"
                  tone="danger"
                  title="Delete"
                  onClick={() => {
                    setReason('');
                    setConfirm({ user });
                  }}
                />
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <LivePresence />

      <div className="agx-adm-toolbar" style={css('display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;')}>
        <SearchInput
          value={rawSearch}
          onChange={(value) => changeFilter(() => setRawSearch(value))}
          placeholder="Search name, email, phone, city..."
        />
        <Select
          value={role}
          onChange={(value) => changeFilter(() => setRole(value as 'all' | Role))}
          options={[
            { value: 'all', label: 'All roles' },
            { value: 'buyer', label: 'Buyers' },
            { value: 'seller', label: 'Sellers' },
            { value: 'staff', label: 'Staff' },
            { value: 'admin', label: 'Admins' },
          ]}
        />
        <Select
          value={status}
          onChange={(value) => changeFilter(() => setStatus(value as typeof status))}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'blocked', label: 'Blocked' },
            { value: 'deleted', label: 'Deleted' },
          ]}
        />
        {/* Both of these go through the same service-role endpoint the list
            uses. Offering them while it is down just produces a second 500. */}
        <GhostButton icon="download" onClick={exportCsv} disabled={!!error}>Export</GhostButton>
        <GhostButton icon="person_add" tone="primary" onClick={() => setCreateOpen(true)} disabled={!!error}>Create User</GhostButton>
      </div>

      {error && (
        <div style={css('background:var(--ag-bad-bg);border:1px solid var(--ag-border);color:#8A1F3D;border-radius:12px;padding:12px 16px;margin-bottom:14px;font-size:13px;font-weight:600;display:flex;align-items:flex-start;gap:8px;line-height:1.5;')}>
          <Icon name="error" size={18} color="#B02454" />
          <span>
            Couldn&apos;t load users: {error}
            <br />
            <span style={css('font-weight:600;opacity:.85;')}>
              Creating, exporting and editing users are unavailable until this is resolved. The rest of the console is unaffected.
            </span>
          </span>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        getId={(user) => user.id}
        onRowClick={(user) => !user.deleted_at && setDetailId(user.id)}
        empty={<EmptyState icon="group" title="No users found" sub="Try a different search or filter." />}
      />
      {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />}

      <UserDrawer id={detailId} onClose={() => setDetailId(null)} row={rows.find((row) => row.id === detailId) ?? null} />

      <ConfirmDialog
        open={!!blockUser}
        title="Block this account?"
        message={`${blockUser?.full_name} will not be able to sign in. They are emailed about it${blockUser?.email ? ` at ${blockUser.email}` : ''}, and any reason you give below is quoted to them word for word.`}
        confirmLabel="Block"
        danger
        busy={busy}
        onConfirm={doBlock}
        onCancel={() => {
          setBlockUser(null);
          setReason('');
        }}
      >
        <ReasonField value={reason} onChange={setReason} placeholder="e.g. Repeated chargebacks on delivered orders" />
      </ConfirmDialog>

      <ConfirmDialog
        open={!!confirm}
        title="Delete user permanently?"
        message={`${confirm?.user.full_name} will be permanently deleted from the database, including their login. If they have orders or chat history, those records are kept and the account is archived instead. This can't be undone.`}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={doDelete}
        onCancel={() => {
          setConfirm(null);
          setReason('');
        }}
      >
        <ReasonField value={reason} onChange={setReason} placeholder="e.g. Closed at the account holder's request" />
      </ConfirmDialog>

      {credentials && (
        <div
          style={css('position:fixed;inset:0;z-index:1000;background:rgba(36,22,29,0.55);display:flex;align-items:center;justify-content:center;padding:20px;')}
          onClick={() => setCredentials(null)}
        >
          <div
            style={css('background:var(--ag-surface);border-radius:18px;padding:24px;max-width:420px;width:100%;box-shadow:0 28px 80px -40px rgba(83,24,43,0.55);')}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={css('font-weight:800;font-size:16px;margin-bottom:6px;')}>Share these credentials</div>
            <div style={css(`font-size:12.5px;color:${T.muted};line-height:1.6;margin-bottom:16px;`)}>
              The welcome email could not be sent, so give the new user their sign-in details directly. They should change the password on first login.
            </div>
            <div style={css('background:var(--ag-surface-2);border:1px solid var(--ag-border);border-radius:12px;padding:14px;margin-bottom:16px;')}>
              <div style={css(`font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${T.muted};margin-bottom:4px;`)}>Email</div>
              <div style={css('font-size:14px;font-weight:600;word-break:break-word;margin-bottom:12px;')}>{credentials.email}</div>
              <div style={css(`font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${T.muted};margin-bottom:4px;`)}>Temporary password</div>
              <div style={css("font-family:'Courier New',monospace;font-size:16px;font-weight:700;letter-spacing:0.08em;color:#651B36;")}>{credentials.password}</div>
            </div>
            <div style={css('display:flex;gap:10px;justify-content:flex-end;')}>
              <GhostButton
                icon="content_copy"
                onClick={() => {
                  navigator.clipboard?.writeText(`Email: ${credentials.email}\nTemporary password: ${credentials.password}`);
                  showToast('Credentials copied');
                }}
              >
                Copy
              </GhostButton>
              <GhostButton tone="primary" onClick={() => setCredentials(null)}>Done</GhostButton>
            </div>
          </div>
        </div>
      )}

      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create New User"
        footer={(
          <div style={css('display:flex;gap:10px;')}>
            <GhostButton onClick={() => setCreateOpen(false)}>Cancel</GhostButton>
            <button
              type="button"
              onClick={() => void doCreate()}
              disabled={busy}
              style={css(`height:42px;border:none;border-radius:12px;padding:0 14px;font-weight:700;font-size:13px;cursor:${busy ? 'not-allowed' : 'pointer'};display:flex;align-items:center;gap:6px;font-family:inherit;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;opacity:${busy ? 0.7 : 1};`)}
            >
              <Icon name="person_add" size={18} />
              {busy ? 'Creating...' : 'Create User'}
            </button>
          </div>
        )}
      >
        <form
          id="admin-create-user-form"
          onSubmit={(e) => {
            e.preventDefault();
            void doCreate();
          }}
          style={css('display:flex;flex-direction:column;gap:14px;')}
        >
          <div>
            <label style={css('display:block;font-weight:700;font-size:12.5px;margin-bottom:6px;color:var(--ag-label);')}>Full Name *</label>
            <input
              value={createData.fullName}
              onChange={(e) => setCreateData({ ...createData, fullName: e.target.value })}
              placeholder="John Doe"
              style={css('width:100%;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:12px;padding:10px 14px;font-size:14px;font-family:inherit;')}
            />
          </div>
          <div>
            <label style={css('display:block;font-weight:700;font-size:12.5px;margin-bottom:6px;color:var(--ag-label);')}>Email *</label>
            <input
              value={createData.email}
              onChange={(e) => setCreateData({ ...createData, email: e.target.value })}
              placeholder="john@example.com"
              type="email"
              style={css('width:100%;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:12px;padding:10px 14px;font-size:14px;font-family:inherit;')}
            />
          </div>
          <div>
            <label style={css('display:block;font-weight:700;font-size:12.5px;margin-bottom:6px;color:var(--ag-label);')}>Phone</label>
            <input
              value={createData.phone}
              onChange={(e) => setCreateData({ ...createData, phone: e.target.value })}
              placeholder="+91 98765 43210"
              style={css('width:100%;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:12px;padding:10px 14px;font-size:14px;font-family:inherit;')}
            />
          </div>
          <div>
            <label style={css('display:block;font-weight:700;font-size:12.5px;margin-bottom:6px;color:var(--ag-label);')}>City</label>
            <input
              value={createData.city}
              onChange={(e) => setCreateData({ ...createData, city: e.target.value })}
              placeholder="Chennai"
              style={css('width:100%;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:12px;padding:10px 14px;font-size:14px;font-family:inherit;')}
            />
          </div>
          <div>
            <label style={css('display:block;font-weight:700;font-size:12.5px;margin-bottom:6px;color:var(--ag-label);')}>Role *</label>
            <select
              value={createData.role}
              onChange={(e) => setCreateData({ ...createData, role: e.target.value as Role })}
              style={css('width:100%;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:12px;padding:10px 14px;font-size:14px;font-family:inherit;cursor:pointer;')}
            >
              <option value="buyer">Buyer</option>
              <option value="seller">Seller</option>
              <option value="staff">Staff &mdash; console, no money or settings</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div style={css('background:var(--ag-surface-2);border-left:4px solid #B02454;padding:12px;border-radius:8px;font-size:12px;color:var(--ag-label);line-height:1.5;')}>
            <strong>Note:</strong> A temporary password will be generated and sent to the email address. The user must change it on first login.
          </div>
        </form>
      </Drawer>

      <Drawer
        open={!!editUser}
        onClose={() => setEditUser(null)}
        title="Edit User"
        footer={(
          <div style={css('display:flex;gap:10px;')}>
            <GhostButton onClick={() => setEditUser(null)}>Cancel</GhostButton>
            <button
              type="button"
              onClick={() => void doUpdate()}
              disabled={busy}
              style={css(`height:42px;border:none;border-radius:12px;padding:0 14px;font-weight:700;font-size:13px;cursor:${busy ? 'not-allowed' : 'pointer'};display:flex;align-items:center;gap:6px;font-family:inherit;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;opacity:${busy ? 0.7 : 1};`)}
            >
              <Icon name="save" size={18} />
              {busy ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      >
        <form
          id="admin-edit-user-form"
          onSubmit={(e) => {
            e.preventDefault();
            void doUpdate();
          }}
          style={css('display:flex;flex-direction:column;gap:14px;')}
        >
          {editUser?.email && (
            <div style={css(`font-size:12.5px;color:${T.muted};background:var(--ag-surface);border-radius:12px;padding:12px 14px;`)}>
              <Icon name="mail" size={16} color="var(--ag-muted-soft)" /> {editUser.email}
              <div style={css('font-size:11px;margin-top:4px;')}>Email is the login identity and can't be changed here.</div>
            </div>
          )}
          <FormField label="Full Name *">
            <input value={editData.fullName} onChange={(e) => setEditData({ ...editData, fullName: e.target.value })} placeholder="John Doe" style={css(EDIT_FIELD)} />
          </FormField>
          <FormField label="Phone">
            <input value={editData.phone ?? ''} onChange={(e) => setEditData({ ...editData, phone: e.target.value })} placeholder="+91 98765 43210" style={css(EDIT_FIELD)} />
          </FormField>
          <FormField label="City">
            <input value={editData.city ?? ''} onChange={(e) => setEditData({ ...editData, city: e.target.value })} placeholder="Chennai" style={css(EDIT_FIELD)} />
          </FormField>
          <FormField label="Address">
            <textarea value={editData.address ?? ''} onChange={(e) => setEditData({ ...editData, address: e.target.value })} placeholder="Full delivery address" rows={3} style={css(EDIT_FIELD + 'resize:vertical;')} />
          </FormField>
          <FormField label="Role *">
            <select value={editData.role} onChange={(e) => setEditData({ ...editData, role: e.target.value as Role })} style={css(EDIT_FIELD + 'cursor:pointer;')}>
              <option value="buyer">Buyer</option>
              <option value="seller">Seller</option>
              <option value="staff">Staff &mdash; console, no money or settings</option>
              <option value="admin">Admin</option>
            </select>
          </FormField>
        </form>
      </Drawer>
    </div>
  );
}

const EDIT_FIELD = 'width:100%;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:12px;padding:10px 14px;font-size:14px;font-family:inherit;';

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label style={css('display:block;font-weight:700;font-size:12.5px;margin-bottom:6px;color:var(--ag-label);')}>{label}</label>
      {children}
    </div>
  );
}

/**
 * The reason an admin types when blocking or closing an account.
 *
 * Optional by design — the email reads perfectly well without one — but what is
 * typed here is sent to that person verbatim, so the label says so plainly. It
 * also lands in the admin audit log next to the action.
 */
function ReasonField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={css('margin-top:16px;text-align:left;')}>
      <label style={css('display:block;font-weight:700;font-size:12.5px;margin-bottom:6px;color:var(--ag-label);')}>
        Reason <span style={css('font-weight:600;color:var(--ag-muted);')}>(optional — the user will see this)</span>
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 500))}
        placeholder={placeholder}
        rows={3}
        style={css(EDIT_FIELD + 'resize:vertical;line-height:1.5;')}
      />
    </div>
  );
}

function UserDrawer({ id, row, onClose }: { id: string | null; row: AdminUserRow | null; onClose: () => void }) {
  const { data, loading } = useAsync(() => (id ? fetchUserDetail(id) : Promise.resolve(null)), [id]);

  return (
    <Drawer open={!!id} onClose={onClose} title={row?.full_name ?? 'User'}>
      {row && (
        <div style={css('display:flex;align-items:center;gap:12px;margin-bottom:16px;')}>
          <Avatar name={row.full_name} tone={row.full_name.charCodeAt(0) % 8} />
          <div>
            <div style={css('font-weight:800;font-size:15px;')}>{row.full_name}</div>
            <div style={css(`font-size:12.5px;color:${T.muted};`)}>{row.email ?? row.phone ?? '-'}</div>
          </div>
        </div>
      )}

      {row && (
        <div style={css('background:var(--ag-surface);border-radius:14px;padding:4px 16px;margin-bottom:16px;')}>
          <Field label="Role" value={row.role} />
          <Field label="Status" value={<StatusPill status={row.deleted_at ? 'rejected' : row.status} label={row.deleted_at ? 'Deleted' : undefined} />} />
          <Field label="City" value={row.city || '-'} />
          <Field label="Address" value={row.address || '-'} />
          <Field label="Joined" value={new Date(row.created_at).toLocaleDateString('en-IN')} />
        </div>
      )}

      <div style={css('display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px;')}>
        <Stat label="Orders" value={String(data?.orders.length ?? 0)} />
        <Stat label="Spent" value={fmtInr(data?.totalSpent ?? 0)} />
        <Stat label="Wishlist" value={String(data?.wishlist ?? 0)} />
      </div>

      <div style={css('font-weight:800;font-size:13px;margin-bottom:8px;')}>Order history</div>
      {loading && <SkeletonRows rows={3} height={54} thumb={false} label="Loading order history…" />}
      {!loading && (data?.orders.length ?? 0) === 0 && <EmptyState icon="receipt_long" title="No orders" />}
      <div style={css('display:flex;flex-direction:column;gap:8px;')}>
        {(data?.orders ?? []).map((order) => (
          <div key={order.id} style={css('background:var(--ag-surface);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;')}>
            <Icon name="receipt_long" size={18} color="var(--ag-muted-soft)" />
            <div style={css('flex:1;min-width:0;')}>
              <div style={css('font-weight:700;font-size:12.5px;')}>{order.order_number}</div>
              <div style={css(`font-size:11px;color:${T.muted};`)}>
                {order.boutique} · {new Date(order.created_at).toLocaleDateString('en-IN')}
              </div>
            </div>
            <div style={css('text-align:right;')}>
              <div style={css('font-weight:800;font-size:12.5px;')}>{fmtInr(order.total)}</div>
              <StatusPill status={order.status} />
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={css('background:var(--ag-surface);border-radius:12px;padding:12px;text-align:center;')}>
      <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:18px;line-height:1;")}>{value}</div>
      <div style={css(`font-size:11px;color:${T.muted};margin-top:3px;`)}>{label}</div>
    </div>
  );
}
