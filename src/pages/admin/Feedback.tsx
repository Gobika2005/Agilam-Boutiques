import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { useAsync } from '@/hooks/useAsync';
import { T, Card, DataTable, EmptyState, GhostButton, Select, type Column } from '@/components/admin/kit';
import { fetchPlatformFeedback, setPlatformFeedbackPublished, type AdminFeedbackRow } from '@/data/feedback';

/**
 * What buyers say about MangaiMart itself (migration 0071).
 *
 * Private by default, and there is still no public read policy on
 * `platform_feedback` — nor should one be added. It is collected in confidence
 * after delivery, and a seller being able to read it, attached to a buyer's
 * name, would change what buyers are willing to write.
 *
 * Migration 0084 opens exactly one door: a buyer may tick "you may quote this",
 * and a quote they consented to can then be approved here for the Home page's
 * "What shoppers say about MangaiMart" section. Two locks, and both are needed —
 * consent without approval publishes nothing, and approval is refused outright
 * on a row with no consent (a CHECK constraint, not just this UI).
 *
 * Everything without the tick stays exactly as private as it was.
 *
 * Deliberately NOT the same thing as product reviews. Those are public by
 * default, feed `boutiques.rating`, and are moderated at /admin/reviews. This is
 * the signal about us, and nothing here affects any boutique's score.
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
  const { data, loading, reload } = useAsync(fetchPlatformFeedback, []);
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const rows = useMemo(() => {
    const all = data ?? [];
    if (filter === 'low') return all.filter((r) => r.rating <= 2);
    if (filter === 'high') return all.filter((r) => r.rating >= 4);
    if (filter === 'written') return all.filter((r) => r.body.trim().length > 0);
    // The queue that actually needs a decision: the buyer said yes, we haven't.
    if (filter === 'consented') return all.filter((r) => r.publish_consent && !r.published);
    if (filter === 'published') return all.filter((r) => r.published);
    return all;
  }, [data, filter]);

  const stats = useMemo(() => {
    const all = data ?? [];
    if (all.length === 0) return { avg: 0, count: 0, detractors: 0, awaiting: 0, published: 0 };
    const sum = all.reduce((s, r) => s + r.rating, 0);
    return {
      avg: sum / all.length,
      count: all.length,
      detractors: all.filter((r) => r.rating <= 2).length,
      awaiting: all.filter((r) => r.publish_consent && !r.published && r.body.trim()).length,
      published: all.filter((r) => r.published).length,
    };
  }, [data]);

  const togglePublish = async (row: AdminFeedbackRow) => {
    setBusyId(row.id);
    setError('');
    try {
      await setPlatformFeedbackPublished(row.id, !row.published);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update that.');
    } finally {
      setBusyId(null);
    }
  };

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
    {
      // Three distinct states, and the difference matters: "not shareable" is
      // the buyer's decision and there is no button for it, because there is no
      // admin action that can override a missing consent.
      key: 'publish', header: 'ON HOME PAGE', width: '190px',
      render: (r) => {
        if (!r.publish_consent) {
          return (
            <span style={css(`font-size:12px;color:${T.muted};display:flex;align-items:center;gap:5px;`)} title="The buyer did not agree to be quoted">
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;")}>lock</span>
              Private
            </span>
          );
        }
        if (!r.body.trim()) {
          return <span style={css(`font-size:12px;color:${T.muted};`)}>Nothing to quote</span>;
        }
        return (
          <GhostButton
            icon={r.published ? 'visibility_off' : 'publish'}
            tone={r.published ? 'default' : 'primary'}
            disabled={busyId === r.id}
            onClick={() => void togglePublish(r)}
            title={r.published ? 'Remove from the Home page' : 'Show this on the Home page'}
          >
            {r.published ? 'Unpublish' : 'Publish'}
          </GhostButton>
        );
      },
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
        <Card style="padding:14px 18px;flex:1;min-width:150px;">
          {/* Buyers who said we may quote them and are still waiting on us.
              A queue, so it should look like one. */}
          <div style={css(`font-size:11.5px;font-weight:800;color:${T.muted};letter-spacing:.05em;`)}>AWAITING REVIEW</div>
          <div style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:2px;color:${stats.awaiting ? '#B02454' : 'inherit'};`)}>
            {stats.awaiting}
          </div>
        </Card>
        <Card style="padding:14px 18px;flex:1;min-width:150px;">
          <div style={css(`font-size:11.5px;font-weight:800;color:${T.muted};letter-spacing:.05em;`)}>ON HOME PAGE</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:2px;")}>{stats.published}</div>
        </Card>
      </div>

      <Card style="padding:14px 18px;margin-bottom:14px;">
        <div style={css(`font-size:13px;color:${T.muted};line-height:1.6;`)}>
          Collected after delivery. <strong>Private unless the buyer ticked “you may quote this”</strong> — no boutique
          can see any of it, and none of it affects a shop’s rating. A consented comment can be put on the Home page
          from the last column; without that tick there is no way to publish it. Public product reviews are moderated
          separately at <strong>/admin/reviews</strong>.
        </div>
      </Card>

      {error && (
        <Card style="padding:12px 16px;margin-bottom:14px;border-color:#C0455E;">
          <div style={css('font-size:13px;color:#C0455E;')}>{error}</div>
        </Card>
      )}

      <div style={css('display:flex;justify-content:flex-end;margin-bottom:12px;max-width:240px;margin-left:auto;')}>
        <Select
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All feedback' },
            { value: 'consented', label: 'Awaiting review' },
            { value: 'published', label: 'On the Home page' },
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
