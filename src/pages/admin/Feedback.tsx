import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { useAsync } from '@/hooks/useAsync';
import { T, Card, DataTable, EmptyState, Select, type Column } from '@/components/admin/kit';
import { fetchPlatformFeedback, type AdminFeedbackRow } from '@/data/feedback';

/**
 * What buyers say about MangaiMart itself (migration 0071).
 *
 * Private by design: there is no public read policy on `platform_feedback`, and
 * none should be added. It is collected in confidence after delivery, and a
 * seller being able to read it — attached to a buyer's name — would change what
 * buyers are willing to write.
 *
 * Deliberately NOT the same thing as product reviews. Those are public, feed
 * `boutiques.rating`, and are moderated at /admin/reviews. This is the signal
 * about us, and nothing here affects any boutique's score.
 */

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function Stars({ n }: { n: number }) {
  return (
    <span style={css('display:inline-flex;gap:1px;')} aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          aria-hidden="true"
          style={css(`font-family:'Material Symbols Outlined';font-size:16px;color:${i <= n ? '#E8A33D' : 'var(--ag-muted-soft)'};${i <= n ? "font-variation-settings:'FILL' 1;" : ''}`)}
        >
          star
        </span>
      ))}
    </span>
  );
}

export function Feedback() {
  const { data, loading } = useAsync(fetchPlatformFeedback, []);
  const [filter, setFilter] = useState('all');

  const rows = useMemo(() => {
    const all = data ?? [];
    if (filter === 'low') return all.filter((r) => r.rating <= 2);
    if (filter === 'high') return all.filter((r) => r.rating >= 4);
    if (filter === 'written') return all.filter((r) => r.body.trim().length > 0);
    return all;
  }, [data, filter]);

  const stats = useMemo(() => {
    const all = data ?? [];
    if (all.length === 0) return { avg: 0, count: 0, detractors: 0 };
    const sum = all.reduce((s, r) => s + r.rating, 0);
    return {
      avg: sum / all.length,
      count: all.length,
      detractors: all.filter((r) => r.rating <= 2).length,
    };
  }, [data]);

  const columns: Column<AdminFeedbackRow>[] = [
    {
      key: 'rating', header: 'RATING', width: '140px',
      render: (r) => <Stars n={r.rating} />,
    },
    {
      key: 'body', header: 'WHAT THEY SAID', width: '2.4fr',
      render: (r) => (
        r.body.trim()
          ? <span style={css('font-size:13px;line-height:1.55;')}>{r.body}</span>
          : <span style={css(`font-size:13px;color:${T.muted};`)}>Rating only — no comment</span>
      ),
    },
    {
      key: 'buyer', header: 'BUYER', width: '1fr',
      render: (r) => (
        <div>
          <div style={css('font-size:13px;')}>{r.buyer?.full_name ?? 'Buyer'}</div>
          <div style={css(`font-size:12px;color:${T.muted};`)}>{r.buyer?.city ?? '—'}</div>
        </div>
      ),
    },
    {
      key: 'when', header: 'WHEN', width: '130px',
      render: (r) => <span style={css(`font-size:12.5px;color:${T.muted};`)}>{fmtDate(r.created_at)}</span>,
    },
  ];

  return (
    <div>
      <div style={css('display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px;')}>
        <Card style="padding:14px 18px;flex:1;min-width:150px;">
          <div style={css(`font-size:11.5px;font-weight:800;color:${T.muted};letter-spacing:.05em;`)}>AVERAGE</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:2px;")}>
            {stats.count ? stats.avg.toFixed(2) : '—'}
          </div>
        </Card>
        <Card style="padding:14px 18px;flex:1;min-width:150px;">
          <div style={css(`font-size:11.5px;font-weight:800;color:${T.muted};letter-spacing:.05em;`)}>RESPONSES</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:2px;")}>{stats.count}</div>
        </Card>
        <Card style="padding:14px 18px;flex:1;min-width:150px;">
          {/* The number worth acting on. An average hides the handful of people
              who had a bad time, and those are the ones who tell others. */}
          <div style={css(`font-size:11.5px;font-weight:800;color:${T.muted};letter-spacing:.05em;`)}>1–2 STARS</div>
          <div style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:2px;color:${stats.detractors ? '#C0455E' : 'inherit'};`)}>
            {stats.detractors}
          </div>
        </Card>
      </div>

      <Card style="padding:14px 18px;margin-bottom:14px;">
        <div style={css(`font-size:13px;color:${T.muted};line-height:1.6;`)}>
          Collected after delivery and <strong>never published</strong> — no boutique can see it and it does not affect
          any shop’s rating. Public product reviews are moderated separately at <strong>/admin/reviews</strong>.
        </div>
      </Card>

      <div style={css('display:flex;justify-content:flex-end;margin-bottom:12px;max-width:240px;margin-left:auto;')}>
        <Select
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All feedback' },
            { value: 'low', label: 'Unhappy (1–2★)' },
            { value: 'high', label: 'Happy (4–5★)' },
            { value: 'written', label: 'With a comment' },
          ]}
        />
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        getId={(r) => r.id}
        empty={
          <EmptyState
            icon="rate_review"
            title="No feedback yet"
            sub="Buyers are asked once an order is delivered. Nothing will appear here until orders start arriving."
          />
        }
      />
    </div>
  );
}
