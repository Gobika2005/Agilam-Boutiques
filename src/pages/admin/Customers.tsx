import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { useAsync } from '@/hooks/useAsync';
import { fetchCustomersAdmin } from '@/data/orders';
import { StatCard, SearchInput, Select, DataTable, Avatar, T, type Column } from '@/components/admin/kit';
import type { CustomerStat } from '@/data/orders';

const compactInr = (n: number) =>
  n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L' : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'k' : fmtInr(n);

type SortKey = 'spent' | 'orders' | 'name';

export function Customers() {
  const { data, loading } = useAsync(() => fetchCustomersAdmin(), []);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('spent');

  const all = data ?? [];
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? all.filter((c) => c.name.toLowerCase().includes(needle) || (c.city ?? '').toLowerCase().includes(needle))
      : all;
    return [...filtered].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name) : sort === 'orders' ? b.orders - a.orders : b.spent - a.spent,
    );
  }, [all, q, sort]);

  const totalRevenue = all.reduce((s, c) => s + c.spent, 0);
  const totalOrders = all.reduce((s, c) => s + c.orders, 0);
  const repeat = all.filter((c) => c.orders > 1).length;
  const avgSpend = all.length ? totalRevenue / all.length : 0;

  const columns: Column<CustomerStat>[] = [
    {
      key: 'name', header: 'CUSTOMER', width: '2fr',
      render: (c) => (
        <div style={css('display:flex;align-items:center;gap:10px;min-width:0;')}>
          <Avatar name={c.name} tone={c.tone} />
          <div style={css('min-width:0;')}>
            <div style={css('font-weight:700;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{c.name}</div>
            <div style={css(`font-size:11.5px;color:${T.muted};`)}>{c.orders > 1 ? 'Repeat buyer' : 'First order'}</div>
          </div>
        </div>
      ),
    },
    { key: 'city', header: 'CITY', width: '1fr', render: (c) => <span style={css('font-size:13px;color:var(--ag-label);')}>{c.city ?? '—'}</span> },
    { key: 'orders', header: 'ORDERS', width: '90px', align: 'right', render: (c) => <span style={css('font-weight:700;font-size:13px;')}>{c.orders}</span> },
    { key: 'aov', header: 'AVG ORDER', width: '120px', align: 'right', render: (c) => <span style={css(`font-size:12.5px;color:${T.muted};`)}>{compactInr(c.orders ? c.spent / c.orders : 0)}</span> },
    { key: 'spent', header: 'LIFETIME', width: '130px', align: 'right', render: (c) => <span style={css('font-weight:800;font-size:13.5px;color:var(--ag-crimson);')}>{fmtInr(c.spent)}</span> },
  ];

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      <div className="agx-adm-g4">
        <StatCard label="Customers" value={String(all.length)} icon="group" tint="var(--ag-surface-2)" ic="#D6336C" />
        <StatCard label="Repeat buyers" value={String(repeat)} icon="autorenew" tint="var(--ag-good-bg)" ic="var(--ag-good-text)" sub={all.length ? `${Math.round((repeat / all.length) * 100)}%` : '0%'} />
        <StatCard label="Total orders" value={String(totalOrders)} icon="receipt_long" tint="var(--ag-info-bg)" ic="var(--ag-info-text)" />
        <StatCard label="Avg. lifetime" value={compactInr(avgSpend)} icon="payments" tint="var(--ag-warn-bg)" ic="#C99A3F" />
      </div>

      <div style={css('display:flex;gap:10px;flex-wrap:wrap;')}>
        <SearchInput value={q} onChange={setQ} placeholder="Search customers or city…" />
        <Select value={sort} onChange={(v) => setSort(v as SortKey)} options={[
          { value: 'spent', label: 'Top spenders' },
          { value: 'orders', label: 'Most orders' },
          { value: 'name', label: 'Name A–Z' },
        ]} />
      </div>

      <DataTable columns={columns} rows={rows} loading={loading} getId={(c) => c.buyer_id} />
    </div>
  );
}
