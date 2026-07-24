import { useMemo, useState, type ReactNode } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useAsync } from '@/hooks/useAsync';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { fetchProductsByBoutique } from '@/data/products';
import {
  fetchMyCampaigns,
  fetchPlacements,
  saveCampaignDraft,
  deleteDraft,
  payForCampaign,
  type AdCampaign,
  type AdPlacement,
} from '@/data/ads';
import type { AdStatus, AdPlacementCode } from '@/types/database';
import type { ProductWithBoutique } from '@/data/types';

const STATUS_META: Record<AdStatus, { label: string; bg: string; fg: string }> = {
  pending_payment: { label: 'Draft · unpaid', bg: '#FBF0DA', fg: '#B8860B' },
  pending_review: { label: 'In review', bg: '#EFF4FB', fg: '#2F4C73' },
  scheduled: { label: 'Scheduled', bg: '#E7F0FB', fg: '#2F4C73' },
  live: { label: 'Live', bg: '#E5F3EC', fg: '#218456' },
  paused: { label: 'Paused', bg: '#F1E4EB', fg: '#8A7078' },
  rejected: { label: 'Rejected', bg: '#FCE3E7', fg: '#B0324B' },
  refunded: { label: 'Refunded', bg: '#F1E4EB', fg: '#8A7078' },
  expired: { label: 'Ended', bg: '#EEE9EC', fg: '#8A7078' },
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
  const [wizardOpen, setWizardOpen] = useState(false);

  const rows = campaigns ?? [];
  const rateByCode = useMemo(() => {
    const m = new Map<string, AdPlacement>();
    (placements ?? []).forEach((p) => m.set(p.code, p));
    return m;
  }, [placements]);

  const removeDraft = async (id: string) => {
    if (!window.confirm('Delete this unpaid draft?')) return;
    try {
      await deleteDraft(id);
      showToast('Draft deleted');
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not delete draft');
    }
  };

  return (
    <div style={css('min-height:100%;background:#FBF6F2;padding-bottom:28px;')}>
      <div style={css('background:linear-gradient(150deg,#D6336C,#B02454);padding:22px 20px 26px;color:#fff;')}>
        <div className="agx-eyebrow" style={css('font-size:10.5px;opacity:.85;')}>Grow your reach</div>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:25px;margin-top:4px;")}>Promote & Ads</div>
        <div style={css('opacity:.85;font-size:13px;margin-top:4px;max-width:440px;')}>
          Book a slot on the marketplace, pay online, and go live after a quick review. You’re charged a flat daily rate — no bidding, no surprises.
        </div>
        <button
          onClick={() => setWizardOpen(true)}
          disabled={!boutiqueId}
          style={css('margin-top:16px;background:#fff;color:#B02454;border:none;border-radius:13px;padding:12px 20px;font-weight:800;font-size:14px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;opacity:' + (boutiqueId ? '1' : '.6') + ';')}
        >
          <span style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>add</span>Create an ad
        </button>
      </div>

      <div style={css('padding:18px 20px 0;')}>
        <div className="agx-eyebrow" style={css('font-size:10.5px;color:#B02454;margin:0 2px 10px;')}>Your campaigns</div>

        {loading && <div style={css('color:#8A7078;font-size:13.5px;')}>Loading campaigns…</div>}
        {!loading && rows.length === 0 && (
          <div style={css('background:#fff;border-radius:16px;padding:26px 18px;text-align:center;color:#8A7078;font-size:13.5px;box-shadow:0 12px 30px -22px rgba(107,20,54,.6);')}>
            No campaigns yet. Tap <b>Create an ad</b> to get your products in front of more buyers.
          </div>
        )}

        <div style={css('display:flex;flex-direction:column;gap:12px;')}>
          {rows.map((c) => {
            const st = STATUS_META[c.status];
            const rate = rateByCode.get(c.placement_code);
            return (
              <div key={c.id} style={css('background:#fff;border-radius:16px;padding:15px 16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
                <div style={css('display:flex;justify-content:space-between;align-items:flex-start;gap:10px;')}>
                  <div style={css('min-width:0;')}>
                    <div style={css('font-weight:800;font-size:14.5px;')}>{rate?.name ?? c.placement_code}</div>
                    <div style={css('font-size:12px;color:#A98D99;margin-top:2px;')}>
                      {c.days} day{c.days === 1 ? '' : 's'} · {money(c.amount || (rate ? rate.daily_rate * c.days : 0))}
                      {c.start_date ? ` · from ${c.start_date}` : ''}
                    </div>
                  </div>
                  <span style={css(`font-size:11px;font-weight:800;padding:4px 10px;border-radius:8px;flex:none;background:${st.bg};color:${st.fg};`)}>{st.label}</span>
                </div>

                {(c.status === 'live' || c.status === 'expired' || c.status === 'paused') && (
                  <div style={css('display:flex;gap:22px;margin-top:12px;')}>
                    <Stat label="impressions" value={compact(c.impressions)} />
                    <Stat label="clicks" value={compact(c.clicks)} />
                    <Stat label="CTR" value={c.impressions ? ((c.clicks / c.impressions) * 100).toFixed(1) + '%' : '—'} />
                  </div>
                )}

                {c.status === 'rejected' && c.reject_reason && (
                  <div style={css('margin-top:10px;font-size:12.5px;color:#B0324B;background:#FCE3E7;border-radius:10px;padding:9px 11px;')}>
                    {c.reject_reason}
                  </div>
                )}

                {c.status === 'pending_payment' && (
                  <button onClick={() => removeDraft(c.id)} style={css('margin-top:12px;height:36px;border-radius:10px;border:1.5px solid #E7A7B4;background:#fff;color:#D6455A;font-weight:700;font-size:12.5px;cursor:pointer;padding:0 14px;')}>
                    Delete draft
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {wizardOpen && boutique && (
        <AdWizard
          boutiqueId={boutique.id}
          boutiqueName={boutique.name}
          placements={(placements ?? []).filter((p) => p.active)}
          onClose={() => setWizardOpen(false)}
          onDone={() => {
            setWizardOpen(false);
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
      <div style={css('font-size:10.5px;color:#B79AA6;margin-top:2px;')}>{label}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create-ad wizard
// ─────────────────────────────────────────────────────────────────────────────

type WizardProps = {
  boutiqueId: string;
  boutiqueName: string;
  placements: AdPlacement[];
  onClose: () => void;
  onDone: () => void;
};

const field = 'width:100%;margin-top:6px;border:1.5px solid #F0D8E2;background:#fff;border-radius:12px;padding:0 14px;height:46px;font-size:14px;font-weight:600;color:#2A1A20;font-family:inherit;';

function AdWizard({ boutiqueId, boutiqueName, placements, onClose, onDone }: WizardProps) {
  const { showToast } = useShop();
  const [step, setStep] = useState(0);
  const [placementCode, setPlacementCode] = useState<AdPlacementCode | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [headline, setHeadline] = useState('');
  const [subtext, setSubtext] = useState('');
  const [days, setDays] = useState(7);
  const [startDate, setStartDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);

  const { data: products } = useAsync(() => fetchProductsByBoutique(boutiqueId), [boutiqueId]);
  const placement = placements.find((p) => p.code === placementCode) ?? null;
  const needsProduct = placementCode === 'sponsored_card' || placementCode === 'home_hero';
  const selectedProduct = (products ?? []).find((p) => p.id === productId) ?? null;
  const price = placement ? placement.daily_rate * days : 0;

  const canNext =
    (step === 0 && !!placementCode) ||
    (step === 1 && (!needsProduct || !!productId)) ||
    step === 2;

  const pay = async () => {
    if (!placement || !placementCode) return;
    setBusy(true);
    try {
      const subject_type = placementCode === 'boutique_promo' ? 'boutique' : 'product';
      const draft = await saveCampaignDraft({
        boutique_id: boutiqueId,
        placement_code: placementCode,
        subject_type,
        product_id: subject_type === 'product' ? productId : null,
        headline: headline.trim() || (placementCode === 'home_hero' ? selectedProduct?.title ?? '' : ''),
        subtext: subtext.trim(),
        image_url: placementCode === 'home_hero' ? selectedProduct?.image_url ?? '' : '',
        cta_label: placementCode === 'home_hero' ? 'Shop now' : '',
        days,
        start_date: startDate,
      });
      await payForCampaign(draft.id, boutiqueName);
      showToast('Payment received — your ad is now in review.');
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not complete the payment';
      if (msg === 'Payment cancelled') showToast('Payment cancelled — your draft was saved.');
      else showToast(msg);
      onDone(); // reload so a saved draft shows even if payment was cancelled
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={css('position:fixed;inset:0;background:#FBF6F2;z-index:60;display:flex;flex-direction:column;')}>
      {/* Header */}
      <div style={css('background:linear-gradient(150deg,#D6336C,#B02454);color:#fff;padding:16px 18px;display:flex;align-items:center;gap:12px;')}>
        <button onClick={onClose} disabled={busy} style={css('width:36px;height:36px;border-radius:11px;border:none;background:rgba(255,255,255,.2);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>close</span>
        </button>
        <div>
          <div style={css('font-weight:800;font-size:16px;')}>Create an ad</div>
          <div style={css('opacity:.8;font-size:12px;')}>Step {step + 1} of 3</div>
        </div>
      </div>

      <div style={css('flex:1;overflow-y:auto;padding:20px 18px;')}>
        {/* Step 0 — placement */}
        {step === 0 && (
          <div>
            <SectionTitle>Where should it appear?</SectionTitle>
            <div style={css('display:flex;flex-direction:column;gap:12px;margin-top:12px;')}>
              {placements.map((p) => {
                const active = p.code === placementCode;
                return (
                  <button key={p.code} onClick={() => setPlacementCode(p.code)} style={css(`text-align:left;border:1.5px solid ${active ? '#D6336C' : '#F0D8E2'};background:${active ? '#FCE9F0' : '#fff'};border-radius:14px;padding:14px 15px;cursor:pointer;`)}>
                    <div style={css('display:flex;justify-content:space-between;align-items:center;gap:10px;')}>
                      <span style={css('font-weight:800;font-size:14.5px;color:#2A1A20;')}>{p.name}</span>
                      <span style={css('font-weight:800;font-size:13.5px;color:#B02454;flex:none;')}>{money(p.daily_rate)}/day</span>
                    </div>
                    <div style={css('font-size:12.5px;color:#8A7078;margin-top:5px;')}>{p.description}</div>
                  </button>
                );
              })}
              {placements.length === 0 && <div style={css('color:#8A7078;font-size:13px;')}>No ad slots are available right now.</div>}
            </div>
          </div>
        )}

        {/* Step 1 — subject */}
        {step === 1 && (
          <div>
            {needsProduct ? (
              <>
                <SectionTitle>Which product?</SectionTitle>
                <div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-top:12px;')}>
                  {(products ?? []).map((p: ProductWithBoutique) => {
                    const active = p.id === productId;
                    return (
                      <button key={p.id} onClick={() => setProductId(p.id)} style={css(`text-align:left;border:1.5px solid ${active ? '#D6336C' : '#F0D8E2'};background:#fff;border-radius:14px;overflow:hidden;cursor:pointer;padding:0;`)}>
                        <div style={css('aspect-ratio:1;background:#F6E8EE;')}>
                          {p.image_url && <img src={p.image_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />}
                        </div>
                        <div style={css('padding:8px 9px;')}>
                          <div style={css('font-weight:700;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{p.title}</div>
                          <div style={css('font-size:12px;color:#B02454;font-weight:800;margin-top:2px;')}>{money(p.price)}</div>
                        </div>
                      </button>
                    );
                  })}
                  {(products ?? []).length === 0 && <div style={css('color:#8A7078;font-size:13px;')}>Add a product first, then promote it.</div>}
                </div>
              </>
            ) : (
              <>
                <SectionTitle>Promote your boutique</SectionTitle>
                <div style={css('margin-top:12px;background:#fff;border:1.5px solid #F0D8E2;border-radius:14px;padding:16px;font-size:13.5px;color:#6B5560;')}>
                  Your boutique <b>{boutiqueName}</b> will be boosted to the top of the Boutiques page with a “Promoted” tag for the whole campaign.
                </div>
              </>
            )}

            {placementCode === 'home_hero' && (
              <div style={css('margin-top:18px;')}>
                <SectionTitle>Hero text (optional)</SectionTitle>
                <label style={css('font-size:12.5px;font-weight:700;color:#7A5C67;display:block;margin-top:10px;')}>
                  Headline
                  <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder={selectedProduct?.title ?? 'Wedding Season Edit'} style={css(field)} />
                </label>
                <label style={css('font-size:12.5px;font-weight:700;color:#7A5C67;display:block;margin-top:12px;')}>
                  Subtext
                  <input value={subtext} onChange={(e) => setSubtext(e.target.value)} placeholder="Handpicked bridal pieces" style={css(field)} />
                </label>
              </div>
            )}
          </div>
        )}

        {/* Step 2 — duration + review */}
        {step === 2 && placement && (
          <div>
            <SectionTitle>How long, and when?</SectionTitle>
            <label style={css('font-size:12.5px;font-weight:700;color:#7A5C67;display:block;margin-top:12px;')}>
              Duration (days)
              <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.min(90, Math.max(1, Number(e.target.value) || 1)))} style={css(field)} />
            </label>
            <label style={css('font-size:12.5px;font-weight:700;color:#7A5C67;display:block;margin-top:12px;')}>
              Start date
              <input type="date" min={todayISO()} value={startDate} onChange={(e) => setStartDate(e.target.value)} style={css(field)} />
            </label>

            <div style={css('margin-top:20px;background:#fff;border-radius:16px;padding:16px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
              <Row k="Placement" v={placement.name} />
              {needsProduct && <Row k="Product" v={selectedProduct?.title ?? '—'} />}
              {!needsProduct && <Row k="Boutique" v={boutiqueName} />}
              <Row k="Daily rate" v={`${money(placement.daily_rate)} × ${days}`} />
              <div style={css('height:1px;background:#F5E4EC;margin:11px 0;')} />
              <div style={css('display:flex;justify-content:space-between;align-items:center;')}>
                <span style={css('font-weight:800;font-size:15px;')}>Total</span>
                <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;color:#B02454;")}>{money(price)}</span>
              </div>
            </div>
            <div style={css('font-size:11.5px;color:#A98D99;margin-top:10px;text-align:center;')}>
              Paid securely via Razorpay. Your ad goes live after our team approves it.
            </div>
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div style={css('padding:14px 18px;border-top:1px solid #F0E0E8;background:#fff;display:flex;gap:10px;')}>
        {step > 0 && (
          <button onClick={() => setStep((s) => s - 1)} disabled={busy} style={css('flex:none;height:50px;padding:0 20px;border-radius:14px;border:1.5px solid #F0D8E2;background:#fff;color:#6B5560;font-weight:700;cursor:pointer;')}>Back</button>
        )}
        {step < 2 ? (
          <button onClick={() => canNext && setStep((s) => s + 1)} disabled={!canNext} style={css('flex:1;height:50px;border-radius:14px;border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:pointer;opacity:' + (canNext ? '1' : '.5') + ';')}>Continue</button>
        ) : (
          <button onClick={pay} disabled={busy} style={css('flex:1;height:50px;border-radius:14px;border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:pointer;opacity:' + (busy ? '.6' : '1') + ';')}>{busy ? 'Processing…' : `Pay ${money(price)}`}</button>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:19px;color:#2A1A20;")}>{children}</div>;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={css('display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:3px 0;')}>
      <span style={css('color:#8A7078;')}>{k}</span>
      <span style={css('font-weight:700;color:#2A1A20;text-align:right;min-width:0;')}>{v}</span>
    </div>
  );
}

export default Promote;
