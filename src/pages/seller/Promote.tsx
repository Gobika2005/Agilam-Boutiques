import { useMemo, useRef, useState, type ReactNode } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useAsync } from '@/hooks/useAsync';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { fetchProductsByBoutique, uploadProductImage } from '@/data/products';
import {
  fetchMyCampaigns,
  fetchPlacements,
  saveCampaignDraft,
  updateCampaignDraft,
  sellerEditCreative,
  deleteDraft,
  payForCampaign,
  effectiveAdStatus,
  type AdCampaign,
  type AdPlacement,
  type CreativeInput,
} from '@/data/ads';
import type { AdStatus, AdPlacementCode, AdSubjectType } from '@/types/database';
import type { ProductWithBoutique, BoutiqueRow } from '@/data/types';

const STATUS_META: Record<AdStatus, { label: string; bg: string; fg: string }> = {
  pending_payment: { label: 'Draft · unpaid', bg: 'var(--ag-warn-bg)', fg: 'var(--ag-warn-text)' },
  pending_review: { label: 'In review', bg: 'var(--ag-info-bg)', fg: 'var(--ag-info-text)' },
  changes_requested: { label: 'Needs changes', bg: 'var(--ag-gold-bg)', fg: 'var(--ag-gold-text)' },
  scheduled: { label: 'Scheduled', bg: 'var(--ag-info-bg)', fg: 'var(--ag-info-text)' },
  live: { label: 'Live', bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' },
  paused: { label: 'Paused', bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' },
  rejected: { label: 'Rejected', bg: 'var(--ag-bad-bg)', fg: 'var(--ag-crimson)' },
  refunded: { label: 'Refunded', bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' },
  expired: { label: 'Ended', bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' },
};

// A seller may reopen these to change the creative. rejected/refunded/expired are
// terminal, so they don't get an edit button.
const EDITABLE: AdStatus[] = ['pending_payment', 'changes_requested', 'pending_review', 'scheduled', 'live', 'paused'];

// CTA button presets, offered by what the hero links to.
const CTA_PRESETS: Record<AdSubjectType, string[]> = {
  product: ['Shop now', 'Buy now', 'View product'],
  boutique: ['Visit store', 'Shop the store', 'Explore'],
};

const money = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
const compact = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));
const todayISO = () => new Date().toISOString().slice(0, 10);

export function Promote() {
  const { showToast } = useShop();
  const { boutique } = useMyBoutique();
  const boutiqueId = boutique?.id;

  const { data: campaigns, loading, reload } = useAsync(
    () => (boutiqueId ? fetchMyCampaigns(boutiqueId) : Promise.resolve([] as AdCampaign[])),
    [boutiqueId],
  );
  const { data: placements } = useAsync(() => fetchPlacements(), []);
  // null = closed; { campaign: null } = new ad; { campaign } = editing that one.
  const [wizard, setWizard] = useState<{ campaign: AdCampaign | null } | null>(null);

  const rows = campaigns ?? [];
  const rateByCode = useMemo(() => {
    const m = new Map<string, AdPlacement>();
    (placements ?? []).forEach((p) => m.set(p.code, p));
    return m;
  }, [placements]);

  // Two-step inline confirm, matching how MyProducts and OrderDetail guard their
  // destructive actions — a native window.confirm was the only browser dialog
  // left in the console and broke out of the app's own visual language.
  const [confirmDraft, setConfirmDraft] = useState<string | null>(null);

  const removeDraft = async (id: string) => {
    try {
      await deleteDraft(id);
      showToast('Draft deleted');
      setConfirmDraft(null);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete draft');
    }
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:28px;')}>
      <div style={css('background:linear-gradient(150deg,#D6336C,#B02454);padding:22px 20px 26px;color:#fff;')}>
        <div className="agx-eyebrow" style={css('font-size:10.5px;opacity:.85;')}>Grow your reach</div>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:25px;margin-top:4px;")}>Promote & Ads</h1>
        <div style={css('opacity:.85;font-size:13px;margin-top:4px;max-width:440px;')}>
          Book a slot on the marketplace, pay online, and go live after a quick review. You’re charged a flat daily rate — no bidding, no surprises.
        </div>
        <button
          onClick={() => setWizard({ campaign: null })}
          disabled={!boutiqueId}
          style={css('margin-top:16px;background:var(--ag-surface);color:var(--ag-crimson);border:none;border-radius:13px;padding:12px 20px;font-weight:800;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;opacity:' + (boutiqueId ? '1' : '.6') + ';')}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>add</span>Create an ad
        </button>
      </div>

      <div style={css('padding:18px 20px 0;')}>
        <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);margin:0 2px 10px;')}>Your campaigns</div>

        {loading && <div style={css('color:var(--ag-muted);font-size:13.5px;')}>Loading campaigns…</div>}
        {!loading && rows.length === 0 && (
          <div style={css('background:var(--ag-surface);border-radius:16px;padding:26px 18px;text-align:center;color:var(--ag-muted);font-size:13.5px;box-shadow:0 12px 30px -22px rgba(107,20,54,.6);')}>
            No campaigns yet. Tap <b>Create an ad</b> to get your products in front of more buyers.
          </div>
        )}

        <div style={css('display:flex;flex-direction:column;gap:12px;')}>
          {rows.map((c) => {
            // Show where the ad really stands: its window may have ended (or
            // started) before the nightly lifecycle job updates the stored status.
            const status = effectiveAdStatus(c);
            const st = STATUS_META[status];
            const rate = rateByCode.get(c.placement_code);
            return (
              <div key={c.id} style={css('background:var(--ag-surface);border-radius:16px;padding:15px 16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
                <div style={css('display:flex;justify-content:space-between;align-items:flex-start;gap:10px;')}>
                  <div style={css('min-width:0;')}>
                    <div style={css('font-weight:800;font-size:14.5px;')}>{rate?.name ?? c.placement_code}</div>
                    <div style={css('font-size:12px;color:var(--ag-muted);margin-top:2px;')}>
                      {/* A house ad (migration 0070) was placed by MangaiMart and
                          costs the seller nothing. Its `amount` is 0, and the
                          rate-card fallback below would otherwise quote them a
                          price for an ad they were given. */}
                      {c.days} day{c.days === 1 ? '' : 's'} ({c.days * 24}h) · {c.house_ad ? 'Placed by MangaiMart · free' : money(c.amount || (rate ? rate.daily_rate * c.days : 0))}
                      {status === 'live' && c.end_at ? ` · ends ${new Date(c.end_at).toLocaleDateString()}` : status === 'expired' && c.end_at ? ` · ended ${new Date(c.end_at).toLocaleDateString()}` : c.start_date ? ` · from ${c.start_date}` : ''}
                    </div>
                  </div>
                  <span style={css(`font-size:11px;font-weight:800;padding:4px 10px;border-radius:8px;flex:none;background:${st.bg};color:${st.fg};`)}>{st.label}</span>
                </div>

                {(status === 'live' || status === 'expired' || status === 'paused') && (
                  <div style={css('display:flex;gap:22px;margin-top:12px;')}>
                    <Stat label="impressions" value={compact(c.impressions)} />
                    <Stat label="clicks" value={compact(c.clicks)} />
                    <Stat label="CTR" value={c.impressions ? ((c.clicks / c.impressions) * 100).toFixed(1) + '%' : '—'} />
                  </div>
                )}

                {/* The admin's rework note (or a rejection reason). */}
                {(c.status === 'changes_requested' || c.status === 'rejected') && c.reject_reason && (
                  <div style={css('margin-top:10px;font-size:12.5px;color:#B26B1B;background:var(--ag-gold-bg);border-radius:10px;padding:9px 11px;')}>
                    <b>Reviewer:</b> {c.reject_reason}
                  </div>
                )}

                <div style={css('display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;')}>
                  {EDITABLE.includes(status) && (
                    <button onClick={() => setWizard({ campaign: c })} style={css('height:36px;border-radius:10px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);font-weight:700;font-size:12.5px;cursor:pointer;padding:0 14px;')}>
                      {status === 'pending_payment' ? 'Finish & pay' : status === 'changes_requested' ? 'Edit & resubmit' : 'Edit ad'}
                    </button>
                  )}
                  {status === 'pending_payment' && confirmDraft !== c.id && (
                    <button onClick={() => setConfirmDraft(c.id)} style={css('height:36px;border-radius:10px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-danger-text);font-weight:700;font-size:12.5px;cursor:pointer;padding:0 14px;')}>
                      Delete draft
                    </button>
                  )}
                </div>

                {status === 'pending_payment' && confirmDraft === c.id && (
                  <div style={css('margin-top:10px;background:var(--ag-bad-bg);border:1px solid var(--ag-border);border-radius:12px;padding:11px 13px;')}>
                    <div style={css('font-size:12.5px;font-weight:700;color:var(--ag-bad-text);')}>Delete this unpaid draft? This can’t be undone.</div>
                    <div style={css('display:flex;gap:8px;margin-top:9px;')}>
                      <button onClick={() => setConfirmDraft(null)} style={css('flex:1;height:38px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);border-radius:10px;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;')}>Cancel</button>
                      <button onClick={() => removeDraft(c.id)} style={css('flex:1;height:38px;border:none;background:var(--ag-danger-text);color:#fff;border-radius:10px;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;')}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {wizard && boutique && (
        <AdWizard
          boutique={boutique}
          placements={(placements ?? [])}
          editCampaign={wizard.campaign}
          onClose={() => setWizard(null)}
          onDone={() => {
            setWizard(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;line-height:1;")}>{value}</div>
      <div style={css('font-size:10.5px;color:var(--ag-muted-soft);margin-top:2px;')}>{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / edit wizard
// ─────────────────────────────────────────────────────────────────────────────

type WizardProps = {
  boutique: BoutiqueRow;
  placements: AdPlacement[];
  /** null → creating a new ad; a row → editing that campaign. */
  editCampaign: AdCampaign | null;
  onClose: () => void;
  onDone: () => void;
};

const field = 'width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:12px;padding:0 14px;height:46px;font-size:14px;font-weight:600;color:var(--ag-ink);font-family:inherit;';
const STEP_TITLES = ['Placement', 'Design', 'Schedule'];

function AdWizard({ boutique, placements, editCampaign, onClose, onDone }: WizardProps) {
  const { showToast } = useShop();
  const boutiqueId = boutique.id;
  const boutiqueName = boutique.name;

  const editing = !!editCampaign;
  // A paid campaign is edited creative-only and re-enters review; an unpaid draft
  // behaves like a fresh create that ends in payment.
  const paidEdit = editing && editCampaign!.status !== 'pending_payment';

  const [step, setStep] = useState(paidEdit ? 1 : 0);
  const [placementCode, setPlacementCode] = useState<AdPlacementCode | null>(editCampaign?.placement_code ?? null);
  const [heroTarget, setHeroTarget] = useState<AdSubjectType>(editCampaign?.subject_type ?? 'product');
  const [productId, setProductId] = useState<string | null>(editCampaign?.product_id ?? null);
  const [headline, setHeadline] = useState(editCampaign?.headline ?? '');
  const [subtext, setSubtext] = useState(editCampaign?.subtext ?? '');
  const [tag, setTag] = useState(editCampaign?.tag ?? '');
  const [ctaLabel, setCtaLabel] = useState(editCampaign?.cta_label ?? '');
  const [heroImage, setHeroImage] = useState(editing ? editCampaign!.image_url : '');
  const [days, setDays] = useState(editCampaign?.days ?? 7);
  const [startDate, setStartDate] = useState(editCampaign?.start_date ?? todayISO());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: products } = useAsync(() => fetchProductsByBoutique(boutiqueId), [boutiqueId]);
  const placement = placements.find((p) => p.code === placementCode) ?? null;
  const isHero = placementCode === 'home_hero';
  const heroBoutique = isHero && heroTarget === 'boutique';
  // A product is chosen for sponsored cards, and for a hero that links to a product.
  const needsProduct = placementCode === 'sponsored_card' || (isHero && heroTarget === 'product');
  const selectedProduct = (products ?? []).find((p) => p.id === productId) ?? null;
  const price = placement ? placement.daily_rate * days : 0;

  // subject_type as it will be saved.
  const subjectType: AdSubjectType =
    placementCode === 'boutique_promo' ? 'boutique' : isHero ? heroTarget : 'product';
  const ctaPresets = CTA_PRESETS[subjectType === 'boutique' ? 'boutique' : 'product'];
  const resolvedCta = ctaLabel && ctaPresets.includes(ctaLabel) ? ctaLabel : ctaPresets[0];

  // Hero image: the seller's upload, else the product photo, else the boutique's
  // cover/logo — matching what the buyer render falls back to.
  const heroImageResolved =
    heroImage || (heroBoutique ? boutique.cover_url || boutique.logo_url || '' : selectedProduct?.image_url || '');

  const canNext =
    (step === 0 && !!placementCode) ||
    (step === 1 && (!needsProduct || !!productId)) ||
    step === 2;

  const pickHeroImage = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadProductImage(boutiqueId, file);
      setHeroImage(url);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not upload the image');
    } finally {
      setUploading(false);
    }
  };

  const creative = (): CreativeInput => ({
    subject_type: subjectType,
    product_id: subjectType === 'product' ? productId : null,
    headline: headline.trim() || (isHero ? (subjectType === 'product' ? selectedProduct?.title ?? '' : boutiqueName) : ''),
    subtext: subtext.trim(),
    image_url: isHero ? heroImageResolved : '',
    cta_label: isHero ? resolvedCta : '',
    tag: isHero ? tag.trim() : '',
  });

  const finish = async () => {
    if (!placementCode) return;
    setBusy(true);
    try {
      if (paidEdit && editCampaign) {
        await sellerEditCreative(editCampaign.id, creative());
        showToast('Saved — your ad is back in review.');
        onDone();
        return;
      }
      if (editing && editCampaign) {
        await updateCampaignDraft(editCampaign.id, { placement_code: placementCode, days, start_date: startDate, ...creative() });
        await payForCampaign(editCampaign.id, boutiqueName);
      } else {
        const draft = await saveCampaignDraft({ boutique_id: boutiqueId, placement_code: placementCode, days, start_date: startDate, ...creative() });
        await payForCampaign(draft.id, boutiqueName);
      }
      showToast('Payment received — your ad is now in review.');
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      if (msg === 'Payment cancelled') showToast('Payment cancelled — your draft was saved.');
      else showToast(msg);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const title = paidEdit ? 'Edit ad' : editing ? 'Finish your ad' : 'Create an ad';

  return (
    <div style={css('position:fixed;inset:0;background:var(--ag-bg);z-index:60;display:flex;flex-direction:column;')}>
      {/* Header + step progress */}
      <div style={css('background:linear-gradient(150deg,#D6336C,#B02454);color:#fff;padding:16px 18px 14px;')}>
        <div style={css('display:flex;align-items:center;gap:12px;')}>
          <button onClick={onClose} disabled={busy} style={css('width:36px;height:36px;border-radius:11px;border:none;background:rgba(255,255,255,.2);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>close</span>
          </button>
          <div>
            <div style={css('font-weight:800;font-size:16px;')}>{title}</div>
            <div style={css('opacity:.85;font-size:12px;')}>
              {paidEdit ? 'Changes go back for review' : `${STEP_TITLES[step]} · step ${step + 1} of 3`}
            </div>
          </div>
        </div>
        {!paidEdit && (
          <div style={css('display:flex;gap:6px;margin-top:12px;')}>
            {STEP_TITLES.map((_, i) => (
              <span key={i} style={css(`flex:1;height:4px;border-radius:2px;background:${i <= step ? '#fff' : 'rgba(255,255,255,.3)'};transition:background .2s;`)} />
            ))}
          </div>
        )}
      </div>

      <div style={css('flex:1;overflow-y:auto;padding:20px 18px;')}>
        {/* Step 0 — placement (skipped when editing) */}
        {!paidEdit && step === 0 && (
          <div>
            <SectionTitle>Where should it appear?</SectionTitle>
            <div style={css('font-size:12.5px;color:var(--ag-muted);margin-top:4px;')}>Pick a slot — you’ll see a live preview on the next step.</div>
            <div style={css('display:flex;flex-direction:column;gap:12px;margin-top:14px;')}>
              {placements.filter((p) => p.active || p.code === placementCode).map((p) => {
                const active = p.code === placementCode;
                return (
                  <button key={p.code} onClick={() => setPlacementCode(p.code)} style={css(`text-align:left;border:1.5px solid ${active ? '#D6336C' : 'var(--ag-border)'};background:${active ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};border-radius:14px;padding:14px 15px;cursor:pointer;`)}>
                    <div style={css('display:flex;justify-content:space-between;align-items:center;gap:10px;')}>
                      <span style={css('font-weight:800;font-size:14.5px;color:var(--ag-ink);')}>{p.name}</span>
                      <span style={css('font-weight:800;font-size:13.5px;color:var(--ag-crimson);flex:none;')}>{money(p.daily_rate)}/day</span>
                    </div>
                    <div style={css('font-size:12.5px;color:var(--ag-muted);margin-top:5px;')}>{p.description}</div>
                  </button>
                );
              })}
              {placements.length === 0 && <div style={css('color:var(--ag-muted);font-size:13px;')}>No ad slots are available right now.</div>}
            </div>
          </div>
        )}

        {/* Step 1 (or the only screen when editing a paid ad) — design */}
        {(paidEdit || step === 1) && placementCode && (
          <div>
            <div style={css('display:flex;align-items:center;gap:7px;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;color:var(--ag-crimson);")}>visibility</span>
              <SectionTitle>Live preview</SectionTitle>
            </div>
            <div style={css('font-size:12px;color:var(--ag-muted);margin-top:3px;margin-bottom:12px;')}>This is exactly how buyers will see your ad.</div>
            <AdPreview
              placementCode={placementCode}
              subjectType={subjectType}
              product={selectedProduct}
              boutique={boutique}
              tag={tag}
              headline={headline}
              subtext={subtext}
              ctaLabel={resolvedCta}
              heroImage={heroImageResolved}
            />

            <div style={css('height:1px;background:var(--ag-surface-2);margin:20px 0;')} />

            {/* Hero: choose what it links to */}
            {isHero && (
              <div style={css('margin-bottom:18px;')}>
                <SectionTitle>What should it open?</SectionTitle>
                <div style={css('display:flex;gap:8px;margin-top:10px;')}>
                  {(['product', 'boutique'] as AdSubjectType[]).map((t) => (
                    <button key={t} onClick={() => setHeroTarget(t)} style={css(`flex:1;height:44px;border-radius:12px;border:1.5px solid ${heroTarget === t ? '#D6336C' : 'var(--ag-border)'};background:${heroTarget === t ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${heroTarget === t ? 'var(--ag-crimson)' : 'var(--ag-muted)'};font-weight:800;font-size:13px;cursor:pointer;`)}>
                      {t === 'product' ? 'A product' : 'My boutique'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {needsProduct ? (
              <>
                <SectionTitle>Choose the product</SectionTitle>
                <div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-top:12px;')}>
                  {(products ?? []).map((p: ProductWithBoutique) => {
                    const active = p.id === productId;
                    return (
                      <button key={p.id} onClick={() => setProductId(p.id)} style={css(`position:relative;text-align:left;border:1.5px solid ${active ? '#D6336C' : 'var(--ag-border)'};background:var(--ag-surface);border-radius:14px;overflow:hidden;cursor:pointer;padding:0;`)}>
                        <div style={css('aspect-ratio:1;background:var(--ag-surface-2);')}>
                          {p.image_url && <img src={p.image_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />}
                        </div>
                        {active && (
                          <span style={css('position:absolute;top:7px;right:7px;width:24px;height:24px;border-radius:50%;background:#D6336C;display:flex;align-items:center;justify-content:center;')}>
                            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;color:#fff;")}>check</span>
                          </span>
                        )}
                        <div style={css('padding:8px 9px;')}>
                          <div style={css('font-weight:700;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{p.title}</div>
                          <div style={css('font-size:12px;color:var(--ag-crimson);font-weight:800;margin-top:2px;')}>{money(p.price)}</div>
                        </div>
                      </button>
                    );
                  })}
                  {(products ?? []).length === 0 && <div style={css('color:var(--ag-muted);font-size:13px;')}>Add a product first, then promote it.</div>}
                </div>
              </>
            ) : placementCode === 'boutique_promo' ? (
              <div style={css('background:var(--ag-surface);border:1.5px solid var(--ag-border);border-radius:14px;padding:16px;font-size:13.5px;color:var(--ag-label);')}>
                Your boutique <b>{boutiqueName}</b> will be boosted to the top of the Boutiques page with a “Promoted” tag for the whole campaign.
              </div>
            ) : null}

            {/* Hero creative fields */}
            {isHero && (
              <div style={css('margin-top:20px;')}>
                <SectionTitle>Customise the hero</SectionTitle>

                <label style={css('font-size:12.5px;font-weight:700;color:var(--ag-label);display:block;margin-top:12px;')}>
                  Tag <span style={css('font-weight:600;color:var(--ag-muted);')}>· small label above the title</span>
                  <input value={tag} onChange={(e) => setTag(e.target.value)} maxLength={24} placeholder="Festive Edit" style={css(field)} />
                </label>

                <label style={css('font-size:12.5px;font-weight:700;color:var(--ag-label);display:block;margin-top:14px;')}>
                  Headline
                  <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={40} placeholder={heroBoutique ? boutiqueName : selectedProduct?.title ?? 'Wedding Season Edit'} style={css(field)} />
                </label>
                <label style={css('font-size:12.5px;font-weight:700;color:var(--ag-label);display:block;margin-top:12px;')}>
                  Subtext
                  <input value={subtext} onChange={(e) => setSubtext(e.target.value)} maxLength={70} placeholder="Handpicked bridal pieces" style={css(field)} />
                </label>

                <label style={css('font-size:12.5px;font-weight:700;color:var(--ag-label);display:block;margin-top:12px;')}>
                  Button label
                  <select value={resolvedCta} onChange={(e) => setCtaLabel(e.target.value)} style={css(field + 'cursor:pointer;')}>
                    {ctaPresets.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>

                <div style={css('font-size:12.5px;font-weight:700;color:var(--ag-label);margin-top:14px;')}>Banner image</div>
                <input ref={fileInput} type="file" accept="image/*" style={css('display:none;')} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickHeroImage(f); e.target.value = ''; }} />
                <div style={css('display:flex;gap:10px;margin-top:6px;')}>
                  <button onClick={() => fileInput.current?.click()} disabled={uploading} style={css('flex:1;height:46px;border-radius:12px;border:1.5px dashed #D9A9BE;background:var(--ag-surface-2);color:var(--ag-crimson);font-weight:800;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;')}>
                    <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>{uploading ? 'progress_activity' : 'add_photo_alternate'}</span>
                    {uploading ? 'Uploading…' : heroImage ? 'Change image' : 'Upload image'}
                  </button>
                  {heroImage && (
                    <button onClick={() => setHeroImage('')} disabled={uploading} style={css('flex:none;height:46px;padding:0 16px;border-radius:12px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-muted);font-weight:700;font-size:13px;cursor:pointer;')}>Reset</button>
                  )}
                </div>
                <div style={css('font-size:11.5px;color:var(--ag-muted);margin-top:6px;')}>
                  Recommended: <b>1600 × 1000&nbsp;px</b> landscape (16:10), JPG or PNG under 2&nbsp;MB.
                  {!heroBoutique && ' Leave it and we’ll use the product’s own photo.'}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2 — schedule + pay (not shown when editing a paid ad) */}
        {!paidEdit && step === 2 && placement && (
          <div>
            <SectionTitle>How long, and when?</SectionTitle>
            <label style={css('font-size:12.5px;font-weight:700;color:var(--ag-label);display:block;margin-top:12px;')}>
              Duration (days)
              <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.min(90, Math.max(1, Number(e.target.value) || 1)))} style={css(field)} />
            </label>
            <div style={css('display:flex;gap:8px;margin-top:8px;')}>
              {[3, 7, 14, 30].map((d) => (
                <button key={d} onClick={() => setDays(d)} style={css(`flex:1;height:38px;border-radius:10px;border:1.5px solid ${days === d ? '#D6336C' : 'var(--ag-border)'};background:${days === d ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${days === d ? 'var(--ag-crimson)' : 'var(--ag-muted)'};font-weight:800;font-size:12.5px;cursor:pointer;`)}>{d}d</button>
              ))}
            </div>
            <div style={css('font-size:11.5px;color:var(--ag-muted);margin-top:8px;')}>Each day is a full 24 hours, counted from when your ad goes live.</div>
            <label style={css('font-size:12.5px;font-weight:700;color:var(--ag-label);display:block;margin-top:14px;')}>
              Start date
              <input type="date" min={todayISO()} value={startDate} onChange={(e) => setStartDate(e.target.value)} style={css(field)} />
            </label>

            <div style={css('margin-top:20px;background:var(--ag-surface);border-radius:16px;padding:16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
              <Row k="Placement" v={placement.name} />
              {subjectType === 'product' && <Row k="Product" v={selectedProduct?.title ?? '—'} />}
              {subjectType === 'boutique' && <Row k="Boutique" v={boutiqueName} />}
              <Row k="Daily rate" v={`${money(placement.daily_rate)} × ${days}`} />
              <div style={css('height:1px;background:var(--ag-border-soft);margin:11px 0;')} />
              <div style={css('display:flex;justify-content:space-between;align-items:center;')}>
                <span style={css('font-weight:800;font-size:15px;')}>Total</span>
                <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;color:var(--ag-crimson);")}>{money(price)}</span>
              </div>
            </div>
            <div style={css('font-size:11.5px;color:var(--ag-muted);margin-top:10px;text-align:center;')}>
              Paid securely via Razorpay. Your ad goes live after our team approves it.
            </div>
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div style={css('padding:14px 18px;border-top:1px solid var(--ag-border);background:var(--ag-surface);display:flex;gap:10px;')}>
        {paidEdit ? (
          <>
            <button onClick={onClose} disabled={busy} style={css('flex:none;height:50px;padding:0 20px;border-radius:14px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);font-weight:700;cursor:pointer;')}>Cancel</button>
            <button onClick={finish} disabled={busy || (needsProduct && !productId)} style={css('flex:1;height:50px;border-radius:14px;border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:pointer;opacity:' + (busy || (needsProduct && !productId) ? '.6' : '1') + ';')}>{busy ? 'Saving…' : 'Save & resubmit'}</button>
          </>
        ) : (
          <>
            {step > 0 && (
              <button onClick={() => setStep((s) => s - 1)} disabled={busy} style={css('flex:none;height:50px;padding:0 20px;border-radius:14px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);font-weight:700;cursor:pointer;')}>Back</button>
            )}
            {step < 2 ? (
              <button onClick={() => canNext && setStep((s) => s + 1)} disabled={!canNext} style={css('flex:1;height:50px;border-radius:14px;border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:pointer;opacity:' + (canNext ? '1' : '.5') + ';')}>Continue</button>
            ) : (
              <button onClick={finish} disabled={busy} style={css('flex:1;height:50px;border-radius:14px;border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:pointer;opacity:' + (busy ? '.6' : '1') + ';')}>{busy ? 'Processing…' : `Pay ${money(price)}`}</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Live ad preview — a faithful miniature of each buyer-facing render.
// ─────────────────────────────────────────────────────────────────────────────

const PROMOTED_PILL = 'display:inline-flex;align-items:center;gap:3px;background:rgba(42,26,32,.72);color:#fff;border-radius:7px;padding:2px 7px;font-size:9px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;';

function AdPreview({
  placementCode,
  subjectType,
  product,
  boutique,
  tag,
  headline,
  subtext,
  ctaLabel,
  heroImage,
}: {
  placementCode: AdPlacementCode;
  subjectType: AdSubjectType;
  product: ProductWithBoutique | null;
  boutique: BoutiqueRow;
  tag: string;
  headline: string;
  subtext: string;
  ctaLabel: string;
  heroImage: string;
}) {
  const frame = 'background:var(--ag-bg);border:1px solid var(--ag-border);border-radius:16px;padding:16px;display:flex;justify-content:center;';

  // Sponsored product card.
  if (placementCode === 'sponsored_card') {
    if (!product) {
      return (
        <div style={css(frame + 'color:var(--ag-muted);font-size:13px;text-align:center;flex-direction:column;gap:8px;padding:28px 16px;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:26px;color:#D9A9BE;")}>image</span>
          Choose a product below to preview your ad.
        </div>
      );
    }
    return (
      <div style={css(frame)}>
        <div style={css('width:172px;')}>
          <div style={css('font-size:11px;font-weight:800;color:var(--ag-crimson);letter-spacing:.03em;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:5px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:13px;")}>bolt</span>Sponsored for you
          </div>
          <div style={css('border-radius:14px;overflow:hidden;background:var(--ag-surface-2);aspect-ratio:3/4;position:relative;')}>
            {product.image_url && <img src={product.image_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />}
            <span style={css('position:absolute;left:9px;top:9px;' + PROMOTED_PILL)}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:11px;")}>bolt</span>Sponsored
            </span>
          </div>
          <div style={css('padding:9px 2px 0;')}>
            <div style={css('font-size:13.5px;font-weight:700;color:var(--ag-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{product.title}</div>
            <div style={css('font-size:12px;color:var(--ag-muted);')}>{boutique.name}</div>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:16.5px;margin-top:4px;")}>{money(product.price)}</div>
          </div>
        </div>
      </div>
    );
  }

  // Home hero — the wide banner card at the top of the homepage. Links to a
  // product or the boutique. The curve and the pill CTA are scaled-down copies
  // of the real thing in buyer/Home.tsx: this is what the seller is buying, so
  // it should not be a differently-shaped approximation.
  if (placementCode === 'home_hero') {
    if (subjectType === 'product' && !product) {
      return (
        <div style={css(frame + 'color:var(--ag-muted);font-size:13px;text-align:center;flex-direction:column;gap:8px;padding:28px 16px;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:26px;color:#D9A9BE;")}>image</span>
          Choose a product below to preview your ad.
        </div>
      );
    }
    const t = headline.trim() || (subjectType === 'product' ? product?.title ?? '' : boutique.name);
    return (
      <div style={css(frame)}>
        <div style={css('width:100%;max-width:340px;border-radius:20px;overflow:hidden;position:relative;aspect-ratio:16/10;background:linear-gradient(120deg,#8E1C44,#B02454 55%,#D6336C);box-shadow:0 22px 44px -30px var(--ag-shadow);')}>
          {heroImage && <img src={heroImage} alt="" style={css('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;')} />}
          <div style={css('position:absolute;inset:0;background:linear-gradient(100deg,rgba(38,6,20,.82) 0%,rgba(74,12,38,.44) 44%,rgba(74,12,38,.02) 82%);')} />
          <div style={css('position:absolute;inset:0;padding:16px 18px;display:flex;flex-direction:column;justify-content:center;color:#fff;')}>
            {tag.trim() && (
              <div style={css('align-self:flex-start;font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#F4D9A6;')}>{tag.trim()}</div>
            )}
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;line-height:1.15;margin-top:10px;text-shadow:0 1px 8px rgba(45,8,24,.5);")}>{t}</div>
            {subtext.trim() && <div style={css('font-size:12px;opacity:.92;margin-top:6px;max-width:230px;text-shadow:0 1px 8px rgba(45,8,24,.5);')}>{subtext.trim()}</div>}
            {/* Literal colours, matching buyer/Home.tsx: the inside of the hero
                is a dark scrim over a photo in both themes, so the theme
                tokens would put a near-black pill on it in dark mode. */}
            <span style={css('align-self:flex-start;margin-top:12px;background:#FFFFFF;color:#A81F4E;border-radius:999px;padding:6px 7px 6px 14px;font-weight:800;font-size:12px;display:inline-flex;align-items:center;gap:7px;')}>
              {ctaLabel}
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:13px;width:20px;height:20px;border-radius:999px;background:#FDE7EF;display:inline-flex;align-items:center;justify-content:center;")}>arrow_forward</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Boutique promo — the shop's own card lifted to the top of the Boutiques list.
  const initials = boutique.name.trim().slice(0, 2).toUpperCase();
  return (
    <div style={css(frame)}>
      <div style={css('width:100%;max-width:340px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:16px;padding:13px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 12px 30px -26px rgba(107,20,54,.6);')}>
        <div style={css('width:52px;height:52px;flex:none;border-radius:14px;background:linear-gradient(135deg,var(--ag-surface-2),var(--ag-surface-3));overflow:hidden;display:flex;align-items:center;justify-content:center;')}>
          {boutique.logo_url ? <img src={boutique.logo_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} /> : <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:19px;color:var(--ag-crimson);")}>{initials}</span>}
        </div>
        <div style={css('min-width:0;flex:1;')}>
          <div style={css('display:flex;align-items:center;gap:6px;')}>
            <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:var(--ag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{boutique.name}</span>
            {boutique.verified && <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:#3E9BE0;flex:none;")}>verified</span>}
            <span style={css('flex:none;' + PROMOTED_PILL)}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:11px;")}>bolt</span>Promoted
            </span>
          </div>
          <div style={css('display:flex;align-items:center;gap:5px;margin-top:5px;font-size:12.5px;color:var(--ag-muted);')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:15px;color:var(--ag-star);")}>star</span>
            {(boutique.rating ?? 0).toFixed(1)}
            {boutique.city && <span>· {boutique.city}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:19px;color:var(--ag-ink);")}>{children}</div>;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={css('display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:3px 0;')}>
      <span style={css('color:var(--ag-muted);')}>{k}</span>
      <span style={css('font-weight:700;color:var(--ag-ink);text-align:right;min-width:0;')}>{v}</span>
    </div>
  );
}

export default Promote;
