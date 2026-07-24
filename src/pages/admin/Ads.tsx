import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useAsync } from '@/hooks/useAsync';
import {
  fetchAllCampaigns,
  fetchPlacements,
  approveCampaign,
  pauseCampaign,
  rejectAndRefund,
  updatePlacement,
  type AdCampaignAdmin,
  type AdPlacement,
} from '@/data/ads';
import type { AdStatus, AdPlacementCode } from '@/types/database';

const STATUS_META: Record<AdStatus, { label: string; bg: string; fg: string }> = {
  pending_payment: { label: 'Unpaid draft', bg: '#FBF0DA', fg: '#B8860B' },
  pending_review: { label: 'In review', bg: '#EFF4FB', fg: '#2F4C73' },
  scheduled: { label: 'Scheduled', bg: '#E7F0FB', fg: '#2F4C73' },
  live: { label: 'Live', bg: '#E5F3EC', fg: '#218456' },
  paused: { label: 'Paused', bg: '#F1E4EB', fg: '#8A7078' },
  rejected: { label: 'Rejected', bg: '#FCE3E7', fg: '#B0324B' },
  refunded: { label: 'Refunded', bg: '#F1E4EB', fg: '#8A7078' },
  expired: { label: 'Ended', bg: '#EEE9EC', fg: '#8A7078' },
};

// The order the review queue is shown in — pending review always first.
const STATUS_RANK: Record<AdStatus, number> = {
  pending_review: 0, live: 1, scheduled: 2, paused: 3, pending_payment: 4, rejected: 5, refunded: 6, expired: 7,
};

const money = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const compact = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

const FILTERS: { key: AdStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending_review', label: 'In review' },
  { key: 'live', label: 'Live' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'paused', label: 'Paused' },
  { key: 'expired', label: 'Ended' },
];

export function Ads() {
  const { showToast } = useShop();
  const [tab, setTab] = useState<'campaigns' | 'rates'>('campaigns');
  const [statusFilter, setStatusFilter] = useState<AdStatus | 'all'>('all');

  const { data: campaigns, loading, reload } = useAsync(
    () => fetchAllCampaigns({ status: statusFilter }),
    [statusFilter],
  );
  const { data: placements, reload: reloadPlacements } = useAsync(() => fetchPlacements(), []);

  const rows = useMemo(
    () => [...(campaigns ?? [])].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]),
    [campaigns],
  );

  // Revenue = every campaign that has actually been paid and not refunded.
  const summary = useMemo(() => {
    const paidStates: AdStatus[] = ['pending_review', 'scheduled', 'live', 'paused', 'expired'];
    let revenue = 0, impressions = 0, clicks = 0, inReview = 0;
    for (const c of campaigns ?? []) {
      if (paidStates.includes(c.status)) revenue += Number(c.amount);
      impressions += c.impressions;
      clicks += c.clicks;
      if (c.status === 'pending_review') inReview += 1;
    }
    return { revenue, impressions, clicks, inReview };
  }, [campaigns]);

  const [busyId, setBusyId] = useState<string | null>(null);

  const doApprove = async (c: AdCampaignAdmin) => {
    setBusyId(c.id);
    try {
      await approveCampaign(c.id);
      showToast('Campaign approved');
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not approve');
    } finally {
      setBusyId(null);
    }
  };

  const doPause = async (c: AdCampaignAdmin) => {
    setBusyId(c.id);
    try {
      await pauseCampaign(c.id);
      showToast('Campaign paused');
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not pause');
    } finally {
      setBusyId(null);
    }
  };

  const doReject = async (c: AdCampaignAdmin) => {
    const reason = window.prompt(`Reject "${c.boutique?.name ?? 'this ad'}" and refund ${money(c.amount)}?\n\nReason (shown to the seller):`, '');
    if (reason === null) return;
    setBusyId(c.id);
    try {
      await rejectAndRefund(c.id, reason.trim() || 'Did not meet our ad guidelines.');
      showToast('Rejected and refunded');
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not refund');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      {/* Summary */}
      <div className="agx-adm-g2" style={css('margin-bottom:16px;')}>
        <SummaryTile label="Ad revenue" value={money(summary.revenue)} icon="payments" />
        <SummaryTile label="Impressions" value={compact(summary.impressions)} icon="visibility" />
        <SummaryTile label="Clicks" value={compact(summary.clicks)} icon="ads_click" />
        <SummaryTile label="Awaiting review" value={String(summary.inReview)} icon="rate_review" highlight={summary.inReview > 0} />
      </div>

      {/* Tabs */}
      <div style={css('display:flex;gap:8px;background:#F3E6EC;border-radius:12px;padding:4px;margin-bottom:16px;width:fit-content;')}>
        {(['campaigns', 'rates'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={css(`border:none;cursor:pointer;padding:8px 16px;border-radius:9px;font-size:13px;font-weight:800;font-family:inherit;background:${tab === t ? '#fff' : 'transparent'};color:${tab === t ? '#B02454' : '#8A7078'};`)}>
            {t === 'campaigns' ? 'Campaigns' : 'Rate card'}
          </button>
        ))}
      </div>

      {tab === 'campaigns' && (
        <>
          <div style={css('display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;')}>
            {FILTERS.map((f) => {
              const on = statusFilter === f.key;
              return (
                <button key={f.key} onClick={() => setStatusFilter(f.key)} style={css(`border:1px solid ${on ? 'transparent' : '#EFDCE4'};background:${on ? 'linear-gradient(140deg,#E14A7E,#B02454)' : '#fff'};color:${on ? '#fff' : '#6B4A56'};cursor:pointer;padding:7px 14px;border-radius:999px;font-size:12.5px;font-weight:700;font-family:inherit;`)}>
                  {f.label}
                </button>
              );
            })}
          </div>

          {loading && <div style={css('color:#8A7078;font-size:13.5px;')}>Loading campaigns…</div>}
          {!loading && rows.length === 0 && (
            <div style={css('color:#8A7078;font-size:13.5px;')}>No campaigns to show.</div>
          )}

          <div style={css('display:flex;flex-direction:column;gap:12px;')}>
            {rows.map((c) => {
              const st = STATUS_META[c.status];
              const subject = c.subject_type === 'boutique' ? c.boutique?.name : ((c.product?.title ?? c.headline) || '—');
              const thumb = c.subject_type === 'boutique' ? c.boutique?.logo_url : (c.product?.image_url || c.image_url);
              const busy = busyId === c.id;
              return (
                <div key={c.id} style={css('background:#fff;border-radius:16px;padding:15px 16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);display:flex;gap:14px;')}>
                  <div style={css('width:60px;height:60px;flex:none;border-radius:12px;overflow:hidden;background:#F6E8EE;')}>
                    {thumb && <img src={thumb} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />}
                  </div>
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('display:flex;justify-content:space-between;align-items:flex-start;gap:10px;')}>
                      <div style={css('min-width:0;')}>
                        <div style={css('font-weight:800;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{c.boutique?.name ?? 'Boutique'}</div>
                        <div style={css('font-size:12.5px;color:#8A7078;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>
                          {c.placement_code.replace('_', ' ')} · {subject}
                        </div>
                      </div>
                      <span style={css(`font-size:11px;font-weight:800;padding:4px 10px;border-radius:8px;flex:none;background:${st.bg};color:${st.fg};`)}>{st.label}</span>
                    </div>

                    <div style={css('display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:#6B5560;')}>
                      <span><b>{money(c.amount)}</b> · {c.days}d</span>
                      {c.start_date && <span>{c.start_date} → {c.end_date}</span>}
                      <span>{compact(c.impressions)} views</span>
                      <span>{compact(c.clicks)} clicks</span>
                    </div>

                    {c.reject_reason && (
                      <div style={css('margin-top:8px;font-size:12px;color:#8A7078;')}>Reason: {c.reject_reason}</div>
                    )}

                    {(c.status === 'pending_review' || c.status === 'live' || c.status === 'scheduled' || c.status === 'paused') && (
                      <div style={css('display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;')}>
                        {(c.status === 'pending_review' || c.status === 'paused') && (
                          <button disabled={busy} onClick={() => doApprove(c)} style={css('height:34px;padding:0 14px;border-radius:10px;border:none;background:linear-gradient(135deg,#2FA36B,#218456);color:#fff;font-weight:800;font-size:12.5px;cursor:pointer;')}>
                            {c.status === 'paused' ? 'Resume' : 'Approve'}
                          </button>
                        )}
                        {(c.status === 'live' || c.status === 'scheduled') && (
                          <button disabled={busy} onClick={() => doPause(c)} style={css('height:34px;padding:0 14px;border-radius:10px;border:1.5px solid #F0D8E2;background:#fff;color:#8A7078;font-weight:700;font-size:12.5px;cursor:pointer;')}>
                            Pause
                          </button>
                        )}
                        <button disabled={busy} onClick={() => doReject(c)} style={css('height:34px;padding:0 14px;border-radius:10px;border:1.5px solid #E7A7B4;background:#fff;color:#D6455A;font-weight:700;font-size:12.5px;cursor:pointer;')}>
                          Reject & refund
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {tab === 'rates' && (
        <RateCard placements={placements ?? []} onSaved={reloadPlacements} />
      )}
    </div>
  );
}

function SummaryTile({ label, value, icon, highlight }: { label: string; value: string; icon: string; highlight?: boolean }) {
  return (
    <div style={css(`background:#fff;border-radius:16px;padding:16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);${highlight ? 'outline:2px solid #D6336C;' : ''}`)}>
      <div style={css('display:flex;align-items:center;gap:8px;color:#B79AA6;font-size:12px;font-weight:700;')}>
        <span style={css("font-family:'Material Symbols Outlined';font-size:17px;color:#D6336C;")}>{icon}</span>{label}
      </div>
      <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:6px;color:#2A1A20;")}>{value}</div>
    </div>
  );
}

function RateCard({ placements, onSaved }: { placements: AdPlacement[]; onSaved: () => void }) {
  const { showToast } = useShop();
  const [busy, setBusy] = useState<AdPlacementCode | null>(null);
  const [draft, setDraft] = useState<Record<string, { daily_rate: number; max_active: number; active: boolean }>>(() =>
    Object.fromEntries(placements.map((p) => [p.code, { daily_rate: p.daily_rate, max_active: p.max_active, active: p.active }])),
  );

  const set = (code: AdPlacementCode, patch: Partial<{ daily_rate: number; max_active: number; active: boolean }>) =>
    setDraft((d) => ({ ...d, [code]: { ...d[code], ...patch } }));

  const save = async (p: AdPlacement) => {
    const d = draft[p.code];
    setBusy(p.code);
    try {
      await updatePlacement(p.code, { daily_rate: Number(d.daily_rate), max_active: Number(d.max_active), active: d.active });
      showToast(`${p.name} updated`);
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const inputStyle = css('width:100%;margin-top:5px;border:1.5px solid #F0D8E2;background:#fff;border-radius:10px;padding:0 12px;height:42px;font-size:14px;font-weight:700;color:#2A1A20;font-family:inherit;');

  return (
    <div style={css('display:flex;flex-direction:column;gap:14px;')}>
      {placements.map((p) => {
        const d = draft[p.code] ?? { daily_rate: p.daily_rate, max_active: p.max_active, active: p.active };
        return (
          <div key={p.code} style={css('background:#fff;border-radius:16px;padding:16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
            <div style={css('display:flex;justify-content:space-between;align-items:center;gap:10px;')}>
              <div style={css('font-weight:800;font-size:15px;')}>{p.name}</div>
              <label style={css('display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:#6B5560;cursor:pointer;')}>
                <input type="checkbox" checked={d.active} onChange={(e) => set(p.code, { active: e.target.checked })} />
                Active
              </label>
            </div>
            <div style={css('font-size:12.5px;color:#8A7078;margin-top:4px;')}>{p.description}</div>
            <div style={css('display:flex;gap:12px;margin-top:12px;')}>
              <label style={css('flex:1;font-size:12px;font-weight:700;color:#7A5C67;')}>
                Daily rate (₹)
                <input type="number" min={0} value={d.daily_rate} onChange={(e) => set(p.code, { daily_rate: Number(e.target.value) })} style={inputStyle} />
              </label>
              <label style={css('flex:1;font-size:12px;font-weight:700;color:#7A5C67;')}>
                Max active slots
                <input type="number" min={1} value={d.max_active} onChange={(e) => set(p.code, { max_active: Number(e.target.value) })} style={inputStyle} />
              </label>
            </div>
            <button disabled={busy === p.code} onClick={() => save(p)} style={css('margin-top:14px;height:42px;padding:0 20px;border-radius:11px;border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13px;cursor:pointer;')}>
              {busy === p.code ? 'Saving…' : 'Save'}
            </button>
          </div>
        );
      })}
      {placements.length === 0 && <div style={css('color:#8A7078;font-size:13.5px;')}>No placements configured.</div>}
    </div>
  );
}
