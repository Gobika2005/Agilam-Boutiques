import { useMemo, useRef, useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useAsync } from '@/hooks/useAsync';
import { fetchProductsByBoutique, uploadProductImage } from '@/data/products';
import {
  fetchAllCampaigns,
  fetchPlacements,
  approveCampaign,
  pauseCampaign,
  requestChanges,
  rejectAndRefund,
  adminEditCreative,
  updatePlacement,
  effectiveAdStatus,
  type AdCampaignAdmin,
  type AdPlacement,
  type CreativeInput,
} from '@/data/ads';
import type { AdStatus, AdPlacementCode, AdSubjectType } from '@/types/database';

// Terminal states carry no creative to fix; everything else is admin-editable.
const ADMIN_EDITABLE: AdStatus[] = ['pending_payment', 'pending_review', 'changes_requested', 'scheduled', 'live', 'paused'];

const CTA_PRESETS: Record<AdSubjectType, string[]> = {
  product: ['Shop now', 'Buy now', 'View product'],
  boutique: ['Visit store', 'Shop the store', 'Explore'],
};

const STATUS_META: Record<AdStatus, { label: string; bg: string; fg: string }> = {
  pending_payment: { label: 'Unpaid draft', bg: 'var(--ag-warn-bg)', fg: 'var(--ag-warn-text)' },
  pending_review: { label: 'In review', bg: 'var(--ag-info-bg)', fg: 'var(--ag-info-text)' },
  changes_requested: { label: 'Needs changes', bg: 'var(--ag-gold-bg)', fg: 'var(--ag-gold-text)' },
  scheduled: { label: 'Scheduled', bg: 'var(--ag-info-bg)', fg: 'var(--ag-info-text)' },
  live: { label: 'Live', bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' },
  paused: { label: 'Paused', bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' },
  rejected: { label: 'Rejected', bg: 'var(--ag-bad-bg)', fg: 'var(--ag-crimson)' },
  refunded: { label: 'Refunded', bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' },
  expired: { label: 'Ended', bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' },
};

// The order the review queue is shown in — pending review always first.
const STATUS_RANK: Record<AdStatus, number> = {
  pending_review: 0, changes_requested: 1, live: 2, scheduled: 3, paused: 4, pending_payment: 5, rejected: 6, refunded: 7, expired: 8,
};

const money = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const compact = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

const FILTERS: { key: AdStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending_review', label: 'In review' },
  { key: 'changes_requested', label: 'Needs changes' },
  { key: 'live', label: 'Live' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'paused', label: 'Paused' },
  { key: 'expired', label: 'Ended' },
];

export function Ads() {
  const { showToast } = useShop();
  const [tab, setTab] = useState<'campaigns' | 'rates'>('campaigns');
  const [statusFilter, setStatusFilter] = useState<AdStatus | 'all'>('all');

  // Fetch every campaign and filter client-side on the *effective* status, so a
  // live-but-expired ad falls under "Ended" (not "Live") the moment its window
  // closes — the DB's own status only catches up at the nightly lifecycle run.
  const { data: campaigns, loading, reload } = useAsync(() => fetchAllCampaigns(), []);
  const { data: placements, reload: reloadPlacements } = useAsync(() => fetchPlacements(), []);

  const rows = useMemo(() => {
    const withEff = (campaigns ?? []).map((c) => ({ c, status: effectiveAdStatus(c) }));
    const shown = statusFilter === 'all' ? withEff : withEff.filter((r) => r.status === statusFilter);
    return shown.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  }, [campaigns, statusFilter]);

  // Revenue = every campaign that has actually been paid and not refunded.
  const summary = useMemo(() => {
    const paidStates: AdStatus[] = ['pending_review', 'changes_requested', 'scheduled', 'live', 'paused', 'expired'];
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
  const [preview, setPreview] = useState<AdCampaignAdmin | null>(null);
  const [editing, setEditing] = useState<AdCampaignAdmin | null>(null);

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

  // Rework: send back for changes with a note, payment held (no refund). The
  // seller edits the creative and resubmits, and it returns to the review queue.
  const doRework = async (c: AdCampaignAdmin) => {
    const reason = window.prompt(`Send "${c.boutique?.name ?? 'this ad'}" back for changes.\n\nWhat should the seller fix? (shown to them):`, '');
    if (reason === null) return;
    if (!reason.trim()) { showToast('Add a short note so the seller knows what to change'); return; }
    setBusyId(c.id);
    try {
      await requestChanges(c.id, reason.trim());
      showToast('Sent back for changes');
      setPreview(null);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not send back');
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
      <div style={css('display:flex;gap:8px;background:var(--ag-surface-2);border-radius:12px;padding:4px;margin-bottom:16px;width:fit-content;')}>
        {(['campaigns', 'rates'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={css(`border:none;cursor:pointer;padding:8px 16px;border-radius:9px;font-size:13px;font-weight:800;font-family:inherit;background:${tab === t ? 'var(--ag-surface)' : 'transparent'};color:${tab === t ? 'var(--ag-crimson)' : 'var(--ag-muted)'};`)}>
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
                <button key={f.key} onClick={() => setStatusFilter(f.key)} style={css(`border:1px solid ${on ? 'transparent' : 'var(--ag-border-soft)'};background:${on ? 'linear-gradient(140deg,#E14A7E,#B02454)' : 'var(--ag-surface)'};color:${on ? '#fff' : 'var(--ag-ink-3)'};cursor:pointer;padding:7px 14px;border-radius:999px;font-size:12.5px;font-weight:700;font-family:inherit;`)}>
                  {f.label}
                </button>
              );
            })}
          </div>

          {loading && <div style={css('color:var(--ag-muted);font-size:13.5px;')}>Loading campaigns…</div>}
          {!loading && rows.length === 0 && (
            <div style={css('color:var(--ag-muted);font-size:13.5px;')}>No campaigns to show.</div>
          )}

          <div style={css('display:flex;flex-direction:column;gap:12px;')}>
            {rows.map(({ c, status }) => {
              const st = STATUS_META[status];
              const subject = c.subject_type === 'boutique' ? c.boutique?.name : ((c.product?.title ?? c.headline) || '—');
              const thumb = c.subject_type === 'boutique' ? c.boutique?.logo_url : (c.product?.image_url || c.image_url);
              const busy = busyId === c.id;
              return (
                <div key={c.id} style={css('background:var(--ag-surface);border-radius:16px;padding:15px 16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);display:flex;gap:14px;')}>
                  <div style={css('width:60px;height:60px;flex:none;border-radius:12px;overflow:hidden;background:var(--ag-surface-2);')}>
                    {thumb && <img src={thumb} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />}
                  </div>
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('display:flex;justify-content:space-between;align-items:flex-start;gap:10px;')}>
                      <div style={css('min-width:0;')}>
                        <div style={css('font-weight:800;font-size:14.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{c.boutique?.name ?? 'Boutique'}</div>
                        <div style={css('font-size:12.5px;color:var(--ag-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>
                          {c.placement_code.replace('_', ' ')} · {subject}
                        </div>
                      </div>
                      <span style={css(`font-size:11px;font-weight:800;padding:4px 10px;border-radius:8px;flex:none;background:${st.bg};color:${st.fg};`)}>{st.label}</span>
                    </div>

                    <div style={css('display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--ag-label);')}>
                      <span><b>{money(c.amount)}</b> · {c.days}d ({c.days * 24}h)</span>
                      {c.end_at ? (
                        <span>ends {new Date(c.end_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      ) : c.start_date ? (
                        <span>from {c.start_date}</span>
                      ) : null}
                      <span>{compact(c.impressions)} views</span>
                      <span>{compact(c.clicks)} clicks</span>
                    </div>

                    {c.reject_reason && (
                      <div style={css('margin-top:8px;font-size:12px;color:var(--ag-muted);')}>Reason: {c.reject_reason}</div>
                    )}

                    <div style={css('display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;')}>
                      <button onClick={() => setPreview(c)} style={css('height:34px;padding:0 14px;border-radius:10px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;')}>
                        <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>visibility</span>Preview
                      </button>
                      {ADMIN_EDITABLE.includes(status) && (
                        <button onClick={() => setEditing(c)} style={css('height:34px;padding:0 14px;border-radius:10px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-ink-3);font-weight:800;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;')}>
                          <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>edit</span>Edit
                        </button>
                      )}
                      {(status === 'pending_review' || status === 'paused') && (
                        <button disabled={busy} onClick={() => doApprove(c)} style={css('height:34px;padding:0 14px;border-radius:10px;border:none;background:linear-gradient(135deg,var(--ag-good),var(--ag-good-text));color:#fff;font-weight:800;font-size:12.5px;cursor:pointer;')}>
                          {status === 'paused' ? 'Resume' : 'Approve'}
                        </button>
                      )}
                      {(status === 'live' || status === 'scheduled') && (
                        <button disabled={busy} onClick={() => doPause(c)} style={css('height:34px;padding:0 14px;border-radius:10px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-muted);font-weight:700;font-size:12.5px;cursor:pointer;')}>
                          Pause
                        </button>
                      )}
                      {(status === 'pending_review' || status === 'scheduled' || status === 'live' || status === 'paused') && (
                        <button disabled={busy} onClick={() => doRework(c)} style={css('height:34px;padding:0 14px;border-radius:10px;border:1.5px solid var(--ag-gold-border);background:var(--ag-surface);color:#B26B1B;font-weight:700;font-size:12.5px;cursor:pointer;')}>
                          Rework
                        </button>
                      )}
                      {(status === 'pending_review' || status === 'changes_requested' || status === 'scheduled' || status === 'live' || status === 'paused') && (
                        <button disabled={busy} onClick={() => doReject(c)} style={css('height:34px;padding:0 14px;border-radius:10px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-danger-text);font-weight:700;font-size:12.5px;cursor:pointer;')}>
                          Reject & refund
                        </button>
                      )}
                    </div>
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

      {preview && (
        <div onClick={() => setPreview(null)} style={css('position:fixed;inset:0;background:rgba(42,26,32,.5);display:flex;align-items:center;justify-content:center;z-index:60;padding:20px;')}>
          <div onClick={(e) => e.stopPropagation()} style={css('width:460px;max-width:100%;max-height:90vh;overflow-y:auto;background:var(--ag-surface);border-radius:20px;padding:22px;box-shadow:0 30px 70px -30px rgba(107,20,54,.7);')}>
            <div style={css('display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px;')}>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Ad preview</div>
              <button onClick={() => setPreview(null)} style={css('width:34px;height:34px;border-radius:10px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-muted);cursor:pointer;')}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>close</span>
              </button>
            </div>
            <div style={css('font-size:12.5px;color:var(--ag-muted);margin-bottom:14px;')}>
              {preview.boutique?.name} · {preview.placement_code.replace('_', ' ')}
            </div>

            <CreativePreview c={preview} />

            <div style={css('display:flex;gap:8px;margin-top:18px;flex-wrap:wrap;')}>
              {ADMIN_EDITABLE.includes(effectiveAdStatus(preview)) && (
                <button onClick={() => { setEditing(preview); setPreview(null); }} style={css('flex:1;height:44px;border-radius:12px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-ink-3);font-weight:800;font-size:13.5px;cursor:pointer;')}>
                  Edit
                </button>
              )}
              {(effectiveAdStatus(preview) === 'pending_review' || effectiveAdStatus(preview) === 'paused') && (
                <button disabled={busyId === preview.id} onClick={() => doApprove(preview)} style={css('flex:1;height:44px;border-radius:12px;border:none;background:linear-gradient(135deg,var(--ag-good),var(--ag-good-text));color:#fff;font-weight:800;font-size:13.5px;cursor:pointer;')}>
                  {effectiveAdStatus(preview) === 'paused' ? 'Resume' : 'Approve'}
                </button>
              )}
              {(effectiveAdStatus(preview) === 'pending_review' || effectiveAdStatus(preview) === 'scheduled' || effectiveAdStatus(preview) === 'live' || effectiveAdStatus(preview) === 'paused') && (
                <button disabled={busyId === preview.id} onClick={() => doRework(preview)} style={css('flex:1;height:44px;border-radius:12px;border:1.5px solid var(--ag-gold-border);background:var(--ag-surface);color:#B26B1B;font-weight:800;font-size:13.5px;cursor:pointer;')}>
                  Rework
                </button>
              )}
              {(effectiveAdStatus(preview) === 'pending_review' || effectiveAdStatus(preview) === 'changes_requested' || effectiveAdStatus(preview) === 'scheduled' || effectiveAdStatus(preview) === 'live' || effectiveAdStatus(preview) === 'paused') && (
                <button disabled={busyId === preview.id} onClick={() => doReject(preview)} style={css('flex:1;height:44px;border-radius:12px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-danger-text);font-weight:800;font-size:13.5px;cursor:pointer;')}>
                  Reject & refund
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {editing && (
        <AdEditor
          campaign={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin creative editor — full edit of an ad (image + every field) in place.
// Mirrors the seller's design step, but saves through admin_edit_ad_creative so
// the campaign's lifecycle status is preserved (no bounce back to review).
// ─────────────────────────────────────────────────────────────────────────────

function AdEditor({ campaign, onClose, onSaved }: { campaign: AdCampaignAdmin; onClose: () => void; onSaved: () => void }) {
  const { showToast } = useShop();
  const boutiqueId = campaign.boutique_id;
  const isHero = campaign.placement_code === 'home_hero';

  const [subjectType, setSubjectType] = useState<AdSubjectType>(campaign.subject_type);
  const [productId, setProductId] = useState<string | null>(campaign.product_id ?? null);
  const [headline, setHeadline] = useState(campaign.headline ?? '');
  const [subtext, setSubtext] = useState(campaign.subtext ?? '');
  const [tag, setTag] = useState(campaign.tag ?? '');
  const [ctaLabel, setCtaLabel] = useState(campaign.cta_label ?? '');
  const [image, setImage] = useState(campaign.image_url ?? '');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: products } = useAsync(() => fetchProductsByBoutique(boutiqueId), [boutiqueId]);
  const heroBoutique = isHero && subjectType === 'boutique';
  const needsProduct = campaign.placement_code === 'sponsored_card' || (isHero && subjectType === 'product');
  const selectedProduct = (products ?? []).find((p) => p.id === productId) ?? null;

  const ctaPresets = CTA_PRESETS[subjectType === 'boutique' ? 'boutique' : 'product'];
  const resolvedCta = ctaLabel && ctaPresets.includes(ctaLabel) ? ctaLabel : ctaPresets[0];

  // Same fallback chain the buyer render uses: upload → product photo → boutique logo.
  const heroImageResolved =
    image || (heroBoutique ? campaign.boutique?.logo_url || '' : selectedProduct?.image_url || campaign.product?.image_url || '');

  const pickImage = async (file: File) => {
    setUploading(true);
    try {
      setImage(await uploadProductImage(boutiqueId, file));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not upload the image');
    } finally {
      setUploading(false);
    }
  };

  // A merged campaign so the live preview reflects the in-progress edits.
  const previewCampaign: AdCampaignAdmin = {
    ...campaign,
    subject_type: subjectType,
    product_id: productId,
    headline,
    subtext,
    tag,
    cta_label: resolvedCta,
    image_url: isHero ? heroImageResolved : image,
    product: selectedProduct
      ? { title: selectedProduct.title, image_url: selectedProduct.image_url ?? null }
      : campaign.product,
  };

  const creative = (): CreativeInput => ({
    subject_type: subjectType,
    product_id: subjectType === 'product' ? productId : null,
    headline: headline.trim() || (isHero ? (subjectType === 'product' ? selectedProduct?.title ?? '' : campaign.boutique?.name ?? '') : ''),
    subtext: subtext.trim(),
    image_url: isHero ? heroImageResolved : '',
    cta_label: isHero ? resolvedCta : '',
    tag: isHero ? tag.trim() : '',
  });

  const save = async () => {
    if (needsProduct && !productId) { showToast('Choose a product for this ad'); return; }
    setBusy(true);
    try {
      await adminEditCreative(campaign.id, creative());
      showToast('Ad updated');
      onSaved();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const label = css('font-size:12.5px;font-weight:700;color:var(--ag-label);display:block;margin-top:14px;');
  const field = css('width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:12px;padding:0 14px;height:44px;font-size:14px;font-weight:600;color:var(--ag-ink);font-family:inherit;');

  return (
    <div onClick={onClose} style={css('position:fixed;inset:0;background:rgba(42,26,32,.5);display:flex;align-items:center;justify-content:center;z-index:70;padding:20px;')}>
      <div onClick={(e) => e.stopPropagation()} style={css('width:480px;max-width:100%;max-height:92vh;overflow-y:auto;background:var(--ag-surface);border-radius:20px;padding:22px;box-shadow:0 30px 70px -30px rgba(107,20,54,.7);')}>
        <div style={css('display:flex;justify-content:space-between;align-items:center;gap:10px;')}>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Edit ad</div>
          <button onClick={onClose} style={css('width:34px;height:34px;border-radius:10px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-muted);cursor:pointer;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>close</span>
          </button>
        </div>
        <div style={css('font-size:12.5px;color:var(--ag-muted);margin-top:2px;margin-bottom:14px;')}>
          {campaign.boutique?.name} · {campaign.placement_code.replace('_', ' ')} · edits keep the current status
        </div>

        <CreativePreview c={previewCampaign} />

        {/* Hero: what the banner links to */}
        {isHero && (
          <div style={css('margin-top:18px;')}>
            <div style={css('font-size:12.5px;font-weight:700;color:var(--ag-label);')}>What it opens</div>
            <div style={css('display:flex;gap:8px;margin-top:8px;')}>
              {(['product', 'boutique'] as AdSubjectType[]).map((t) => (
                <button key={t} onClick={() => setSubjectType(t)} style={css(`flex:1;height:42px;border-radius:12px;border:1.5px solid ${subjectType === t ? '#D6336C' : 'var(--ag-border)'};background:${subjectType === t ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${subjectType === t ? 'var(--ag-crimson)' : 'var(--ag-muted)'};font-weight:800;font-size:13px;cursor:pointer;`)}>
                  {t === 'product' ? 'A product' : 'The boutique'}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Product picker for sponsored cards + product heroes */}
        {needsProduct && (
          <div style={css('margin-top:16px;')}>
            <div style={css('font-size:12.5px;font-weight:700;color:var(--ag-label);')}>Product</div>
            <div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-top:10px;')}>
              {(products ?? []).map((p) => {
                const active = p.id === productId;
                return (
                  <button key={p.id} onClick={() => setProductId(p.id)} style={css(`position:relative;text-align:left;border:1.5px solid ${active ? '#D6336C' : 'var(--ag-border)'};background:var(--ag-surface);border-radius:12px;overflow:hidden;cursor:pointer;padding:0;`)}>
                    <div style={css('aspect-ratio:1;background:var(--ag-surface-2);')}>
                      {p.image_url && <img src={p.image_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />}
                    </div>
                    {active && (
                      <span style={css('position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;background:#D6336C;display:flex;align-items:center;justify-content:center;')}>
                        <span style={css("font-family:'Material Symbols Outlined';font-size:15px;color:#fff;")}>check</span>
                      </span>
                    )}
                    <div style={css('padding:7px 8px;')}>
                      <div style={css('font-weight:700;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{p.title}</div>
                    </div>
                  </button>
                );
              })}
              {(products ?? []).length === 0 && <div style={css('color:var(--ag-muted);font-size:13px;')}>This boutique has no products.</div>}
            </div>
          </div>
        )}

        {/* Hero creative fields */}
        {isHero && (
          <div>
            <label style={label}>
              Tag <span style={css('font-weight:600;color:var(--ag-muted);')}>· small label above the title</span>
              <input value={tag} onChange={(e) => setTag(e.target.value)} maxLength={24} placeholder="Festive Edit" style={field} />
            </label>
            <label style={label}>
              Headline
              <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={40} placeholder={heroBoutique ? campaign.boutique?.name ?? '' : selectedProduct?.title ?? ''} style={field} />
            </label>
            <label style={label}>
              Subtext
              <input value={subtext} onChange={(e) => setSubtext(e.target.value)} maxLength={70} placeholder="Handpicked bridal pieces" style={field} />
            </label>
            <label style={label}>
              Button label
              <select value={resolvedCta} onChange={(e) => setCtaLabel(e.target.value)} style={css(field + 'cursor:pointer;')}>
                {ctaPresets.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>

            <div style={css('font-size:12.5px;font-weight:700;color:var(--ag-label);margin-top:14px;')}>Banner image</div>
            <input ref={fileInput} type="file" accept="image/*" style={css('display:none;')} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickImage(f); e.target.value = ''; }} />
            <div style={css('display:flex;gap:10px;margin-top:6px;')}>
              <button onClick={() => fileInput.current?.click()} disabled={uploading} style={css('flex:1;height:44px;border-radius:12px;border:1.5px dashed #D9A9BE;background:var(--ag-surface-2);color:var(--ag-crimson);font-weight:800;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;')}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>{uploading ? 'progress_activity' : 'add_photo_alternate'}</span>
                {uploading ? 'Uploading…' : image ? 'Change image' : 'Upload image'}
              </button>
              {image && (
                <button onClick={() => setImage('')} disabled={uploading} style={css('flex:none;height:44px;padding:0 16px;border-radius:12px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-muted);font-weight:700;font-size:13px;cursor:pointer;')}>Reset</button>
              )}
            </div>
            <div style={css('font-size:11.5px;color:var(--ag-muted);margin-top:6px;')}>
              Recommended: <b>1600 × 1000&nbsp;px</b> landscape (16:10), JPG or PNG under 2&nbsp;MB.
            </div>
          </div>
        )}

        {campaign.placement_code === 'boutique_promo' && (
          <div style={css('margin-top:16px;background:var(--ag-surface-2);border-radius:12px;padding:14px;font-size:13px;color:var(--ag-label);')}>
            A boutique promo uses the shop’s own name and logo — there’s no separate creative to edit here.
          </div>
        )}

        <div style={css('display:flex;gap:10px;margin-top:20px;')}>
          <button onClick={onClose} disabled={busy} style={css('flex:none;height:46px;padding:0 20px;border-radius:12px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);font-weight:700;font-size:13.5px;cursor:pointer;')}>Cancel</button>
          <button onClick={save} disabled={busy || uploading} style={css('flex:1;height:46px;border-radius:12px;border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14px;cursor:pointer;opacity:' + (busy || uploading ? '.6' : '1') + ';')}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}

// A faithful render of a campaign's creative, from the admin's joined data, so a
// reviewer sees exactly what a buyer would before approving.
const A_PILL = 'display:inline-flex;align-items:center;gap:3px;background:rgba(42,26,32,.72);color:#fff;border-radius:7px;padding:2px 7px;font-size:9px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;';

function CreativePreview({ c }: { c: AdCampaignAdmin }) {
  const frame = 'background:var(--ag-bg);border:1px solid var(--ag-border);border-radius:16px;padding:16px;display:flex;justify-content:center;';

  if (c.placement_code === 'home_hero') {
    const image = c.image_url || c.product?.image_url || '';
    const title = c.headline || c.product?.title || c.boutique?.name || '';
    return (
      <div style={css(frame)}>
        <div style={css('width:100%;max-width:380px;border-radius:16px;overflow:hidden;position:relative;aspect-ratio:16/10;background:linear-gradient(120deg,#8E1C44,#B02454 55%,#D6336C);')}>
          {image && <img src={image} alt="" style={css('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;')} />}
          <div style={css('position:absolute;inset:0;background:linear-gradient(90deg,rgba(30,6,16,.72),rgba(30,6,16,.15));')} />
          <div style={css('position:absolute;inset:0;padding:16px 18px;display:flex;flex-direction:column;justify-content:center;color:#fff;')}>
            {c.tag && <div style={css('align-self:flex-start;font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#F4D9A6;')}>{c.tag}</div>}
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:21px;line-height:1.15;margin-top:10px;text-shadow:0 1px 8px rgba(45,8,24,.5);")}>{title}</div>
            {c.subtext && <div style={css('font-size:12px;opacity:.92;margin-top:6px;max-width:250px;text-shadow:0 1px 8px rgba(45,8,24,.5);')}>{c.subtext}</div>}
            <span style={css('align-self:flex-start;margin-top:12px;background:var(--ag-surface);color:var(--ag-crimson);border-radius:10px;padding:7px 14px;font-weight:800;font-size:12px;display:inline-flex;align-items:center;gap:5px;')}>
              {c.cta_label || 'Shop now'}<span style={css("font-family:'Material Symbols Outlined';font-size:14px;")}>arrow_forward</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  if (c.placement_code === 'sponsored_card') {
    return (
      <div style={css(frame)}>
        <div style={css('width:180px;')}>
          <div style={css('border-radius:14px;overflow:hidden;background:var(--ag-surface-2);aspect-ratio:3/4;position:relative;')}>
            {c.product?.image_url && <img src={c.product.image_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />}
            <span style={css('position:absolute;left:9px;top:9px;' + A_PILL)}><span style={css("font-family:'Material Symbols Outlined';font-size:11px;")}>bolt</span>Sponsored</span>
          </div>
          <div style={css('padding:9px 2px 0;')}>
            <div style={css('font-size:13.5px;font-weight:700;color:var(--ag-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{c.product?.title ?? '—'}</div>
            <div style={css('font-size:12px;color:var(--ag-muted);')}>{c.boutique?.name}</div>
          </div>
        </div>
      </div>
    );
  }

  // boutique_promo
  return (
    <div style={css(frame)}>
      <div style={css('width:100%;max-width:340px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:16px;padding:13px 14px;display:flex;align-items:center;gap:12px;')}>
        <div style={css('width:52px;height:52px;flex:none;border-radius:14px;background:linear-gradient(135deg,var(--ag-surface-2),var(--ag-surface-3));overflow:hidden;display:flex;align-items:center;justify-content:center;')}>
          {c.boutique?.logo_url ? <img src={c.boutique.logo_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} /> : <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:19px;color:var(--ag-crimson);")}>{(c.boutique?.name ?? 'B').slice(0, 2).toUpperCase()}</span>}
        </div>
        <div style={css('min-width:0;flex:1;')}>
          <div style={css('display:flex;align-items:center;gap:6px;')}>
            <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:var(--ag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{c.boutique?.name}</span>
            <span style={css('flex:none;' + A_PILL)}><span style={css("font-family:'Material Symbols Outlined';font-size:11px;")}>bolt</span>Promoted</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, icon, highlight }: { label: string; value: string; icon: string; highlight?: boolean }) {
  return (
    <div style={css(`background:var(--ag-surface);border-radius:16px;padding:16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);${highlight ? 'outline:2px solid #D6336C;' : ''}`)}>
      <div style={css('display:flex;align-items:center;gap:8px;color:var(--ag-muted-soft);font-size:12px;font-weight:700;')}>
        <span style={css("font-family:'Material Symbols Outlined';font-size:17px;color:#D6336C;")}>{icon}</span>{label}
      </div>
      <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:6px;color:var(--ag-ink);")}>{value}</div>
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

  const inputStyle = css('width:100%;margin-top:5px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:10px;padding:0 12px;height:42px;font-size:14px;font-weight:700;color:var(--ag-ink);font-family:inherit;');

  return (
    <div style={css('display:flex;flex-direction:column;gap:14px;')}>
      {placements.map((p) => {
        const d = draft[p.code] ?? { daily_rate: p.daily_rate, max_active: p.max_active, active: p.active };
        return (
          <div key={p.code} style={css('background:var(--ag-surface);border-radius:16px;padding:16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
            <div style={css('display:flex;justify-content:space-between;align-items:center;gap:10px;')}>
              <div style={css('font-weight:800;font-size:15px;')}>{p.name}</div>
              <label style={css('display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--ag-label);cursor:pointer;')}>
                <input type="checkbox" checked={d.active} onChange={(e) => set(p.code, { active: e.target.checked })} />
                Active
              </label>
            </div>
            <div style={css('font-size:12.5px;color:var(--ag-muted);margin-top:4px;')}>{p.description}</div>
            <div style={css('display:flex;gap:12px;margin-top:12px;')}>
              <label style={css('flex:1;font-size:12px;font-weight:700;color:var(--ag-label);')}>
                Daily rate (₹)
                <input type="number" min={0} value={d.daily_rate} onChange={(e) => set(p.code, { daily_rate: Number(e.target.value) })} style={inputStyle} />
              </label>
              <label style={css('flex:1;font-size:12px;font-weight:700;color:var(--ag-label);')}>
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
      {placements.length === 0 && <div style={css('color:var(--ag-muted);font-size:13.5px;')}>No placements configured.</div>}
    </div>
  );
}
