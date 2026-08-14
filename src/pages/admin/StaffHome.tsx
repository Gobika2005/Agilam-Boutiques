import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAsync } from '@/hooks/useAsync';
import { useAuth } from '@/auth/AuthContext';
import { supabase } from '@/lib/supabase';
import { fetchAllOrdersAdmin } from '@/data/orders';
import { StatCard, SectionCard, EmptyState, Icon, T } from '@/components/admin/kit';
import { adminPath } from '@/lib/adminPath';

/**
 * The employee's landing page — the console's Overview is the revenue screen
 * and staff cannot open it (migration 0086).
 *
 * Deliberately not a smaller Overview. Overview answers "how is the business
 * doing", which is a question staff are not being given the numbers to ask;
 * this answers "what is waiting on me", which is the whole of their job. Every
 * tile is a count of work outstanding and a way into the screen that clears it.
 *
 * No money figure appears here. Order totals are visible on the Orders screen
 * itself, where they are needed to handle an order — an aggregate on a
 * dashboard is revenue reporting by another name.
 */

type Queue = {
  awaitingDispatch: number;
  inTransit: number;
  disputed: number;
  pendingBoutiques: number;
  pendingTerms: number;
  adsInReview: number;
  unrepliedReviews: number;
};

async function loadQueues(): Promise<Queue> {
  const orders = await fetchAllOrdersAdmin();

  // Counted in one pass rather than three `head: true` count queries, because
  // staff read orders through a single RPC that returns the feed whole — the
  // round trip has already happened by the time we get here.
  const awaitingDispatch = orders.filter((o) => o.status === 'pending').length;
  const inTransit = orders.filter((o) => o.status === 'shipped').length;
  const disputed = orders.filter((o) => o.delivery_disputed).length;

  // The rest are cheap count-only reads, each one against a table staff hold a
  // policy on. `head: true` fetches no rows at all, just the count.
  //
  // A tile whose query fails settles at zero rather than blanking the page: on
  // a database where 0086 has not been applied yet, every one of these is a
  // permission error, and a work queue that renders "0 waiting" is a great deal
  // less alarming to an employee than a crash.
  const zeroOnError = async (p: PromiseLike<{ count: number | null; error: unknown }>) => {
    try {
      const { count, error } = await p;
      return error ? 0 : (count ?? 0);
    } catch {
      return 0;
    }
  };
  const head = { count: 'exact' as const, head: true };

  const [pendingBoutiques, pendingTerms, adsInReview, unrepliedReviews] = await Promise.all([
    zeroOnError(supabase.from('boutiques').select('id', head).eq('status', 'pending')),
    zeroOnError(supabase.from('taxonomy').select('id', head).eq('status', 'pending')),
    zeroOnError(supabase.from('ad_campaigns').select('id', head).eq('status', 'pending_review')),
    zeroOnError(supabase.from('reviews').select('id', head).is('seller_reply', null)),
  ]);

  return { awaitingDispatch, inTransit, disputed, pendingBoutiques, pendingTerms, adsInReview, unrepliedReviews };
}

export function StaffHome() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { data, loading } = useAsync(() => loadQueues(), []);

  const q = data;
  const firstName = (profile?.full_name ?? '').trim().split(/\s+/)[0] || 'there';

  const rows: { label: string; sub: string; n: number; icon: string; to: string }[] = [
    { label: 'Orders awaiting dispatch', sub: 'Paid, not yet shipped', n: q?.awaitingDispatch ?? 0, icon: 'inventory_2', to: adminPath('orders') },
    { label: 'Parcels in transit', sub: 'Shipped, not yet delivered', n: q?.inTransit ?? 0, icon: 'local_shipping', to: adminPath('deliveries') },
    { label: 'Delivery disputes', sub: 'Buyer says it never arrived', n: q?.disputed ?? 0, icon: 'report', to: adminPath('deliveries') },
    { label: 'Boutiques awaiting approval', sub: 'New shops to review', n: q?.pendingBoutiques ?? 0, icon: 'verified', to: adminPath('approvals') },
    { label: 'Catalogue terms requested', sub: 'Sellers asking for a new category or fabric', n: q?.pendingTerms ?? 0, icon: 'sell', to: adminPath('catalogue') },
    { label: 'Ads in review', sub: 'Paid campaigns waiting on a decision', n: q?.adsInReview ?? 0, icon: 'campaign', to: adminPath('ads') },
    { label: 'Reviews with no reply', sub: 'Buyers still waiting to hear back', n: q?.unrepliedReviews ?? 0, icon: 'reviews', to: adminPath('reviews') },
  ];

  const open = rows.filter((r) => r.n > 0);
  const urgent = (q?.disputed ?? 0) + (q?.awaitingDispatch ?? 0);

  return (
    <div style={css('display:flex;flex-direction:column;gap:16px;')}>
      <div>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;line-height:1.2;")}>
          Good to see you, {firstName}.
        </div>
        <div style={css(`color:${T.muted};font-size:13.5px;margin-top:4px;`)}>
          {loading
            ? 'Counting what needs doing…'
            : open.length === 0
              ? 'Nothing is waiting. The queues are clear.'
              : `${open.reduce((s, r) => s + r.n, 0)} things need attention across ${open.length} ${open.length === 1 ? 'queue' : 'queues'}.`}
        </div>
      </div>

      <div className="agx-adm-g4">
        <StatCard label="Needs you now" value={String(urgent)} icon="bolt" tint="var(--ag-warn-bg)" ic="var(--ag-gold-text)" sub="dispatch + disputes" />
        <StatCard label="Awaiting dispatch" value={String(q?.awaitingDispatch ?? 0)} icon="inventory_2" tint="var(--ag-surface-2)" ic="#D6336C" />
        <StatCard label="In transit" value={String(q?.inTransit ?? 0)} icon="local_shipping" tint="var(--ag-info-bg)" ic="var(--ag-info-text)" />
        <StatCard label="Awaiting approval" value={String((q?.pendingBoutiques ?? 0) + (q?.pendingTerms ?? 0) + (q?.adsInReview ?? 0))} icon="verified" tint="var(--ag-good-bg)" ic="var(--ag-good-text)" sub="shops, terms, ads" />
      </div>

      <SectionCard title="Your queues">
        {!loading && open.length === 0 ? (
          <EmptyState icon="task_alt" title="All clear" sub="Nothing is waiting on you right now." />
        ) : (
          <div style={css('display:flex;flex-direction:column;')}>
            {rows.map((r, i) => (
              <button
                key={r.label}
                onClick={() => navigate(r.to)}
                style={css(`display:flex;align-items:center;gap:14px;padding:14px 4px;border:none;background:transparent;cursor:pointer;text-align:left;font-family:inherit;width:100%;border-top:${i === 0 ? 'none' : `1px solid ${T.border}`};opacity:${r.n === 0 ? 0.5 : 1};`)}
              >
                <div style={css(`width:38px;height:38px;flex:none;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;`)}>
                  <Icon name={r.icon} size={20} color={r.n > 0 ? '#D6336C' : T.muted} />
                </div>
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('font-weight:700;font-size:14px;')}>{r.label}</div>
                  <div style={css(`font-size:12px;color:${T.muted};`)}>{r.sub}</div>
                </div>
                <div style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:22px;color:${r.n > 0 ? 'var(--ag-crimson)' : T.muted};`)}>
                  {loading ? '·' : r.n}
                </div>
                <Icon name="chevron_right" size={20} color={T.muted} />
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <div style={css(`display:flex;gap:10px;align-items:flex-start;padding:14px 16px;border-radius:14px;background:var(--ag-surface-2);color:${T.muted};font-size:12.5px;line-height:1.6;`)}>
        <Icon name="lock" size={18} color={T.muted} />
        <span>
          Payouts, refunds, expenses, coupons, platform settings and account management are the
          owner's. Buyer phone numbers and email addresses are hidden throughout — the delivery
          address is not, so you can still chase a parcel.
        </span>
      </div>
    </div>
  );
}
