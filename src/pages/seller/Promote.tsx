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
  deleteDraft,
  payForCampaign,
  type AdCampaign,
  type AdPlacement,
} from '@/data/ads';
import type { AdStatus, AdPlacementCode } from '@/types/database';
import type { ProductWithBoutique, BoutiqueRow } from '@/data/types';

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
          boutique={boutique}
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
  boutique: BoutiqueRow;
  placements: AdPlacement[];
  onClose: () => void;
  onDone: () => void;
};

const field = 'width:100%;margin-top:6px;border:1.5px solid #F0D8E2;background:#fff;border-radius:12px;padding:0 14px;height:46px;font-size:14px;font-weight:600;color:#2A1A20;font-family:inherit;';

const STEP_TITLES = ['Placement', 'Design', 'Schedule'];

function AdWizard({ boutique, placements, onClose, onDone }: WizardProps) {
  const { showToast } = useShop();
  const boutiqueId = boutique.id;
  const boutiqueName = boutique.name;
  const [step, setStep] = useState(0);
  const [placementCode, setPlacementCode] = useState<AdPlacementCode | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [headline, setHeadline] = useState('');
  const [subtext, setSubtext] = useState('');
  const [heroImage, setHeroImage] = useState('');
  const [days, setDays] = useState(7);
  const [startDate, setStartDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: products } = useAsync(() => fetchProductsByBoutique(boutiqueId), [boutiqueId]);
  const placement = placements.find((p) => p.code === placementCode) ?? null;
  const needsProduct = placementCode === 'sponsored_card' || placementCode === 'home_hero';
  const isHero = placementCode === 'home_hero';
  const selectedProduct = (products ?? []).find((p) => p.id === productId) ?? null;
  const price = placement ? placement.daily_rate * days : 0;

  // The hero shows a custom upload if the seller added one, else the product's
  // own photo — exactly what the buyer's Home render falls back to.
  const heroImageResolved = heroImage || selectedProduct?.image_url || '';

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
        headline: headline.trim() || (isHero ? selectedProduct?.title ?? '' : ''),
        subtext: subtext.trim(),
        image_url: isHero ? heroImageResolved : '',
        cta_label: isHero ? 'Shop now' : '',
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
      {/* Header + step progress */}
      <div style={css('background:linear-gradient(150deg,#D6336C,#B02454);color:#fff;padding:16px 18px 14px;')}>
        <div style={css('display:flex;align-items:center;gap:12px;')}>
          <button onClick={onClose} disabled={busy} style={css('width:36px;height:36px;border-radius:11px;border:none;background:rgba(255,255,255,.2);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>close</span>
          </button>
          <div>
            <div style={css('font-weight:800;font-size:16px;')}>Create an ad</div>
            <div style={css('opacity:.85;font-size:12px;')}>{STEP_TITLES[step]} · step {step + 1} of 3</div>
          </div>
        </div>
        <div style={css('display:flex;gap:6px;margin-top:12px;')}>
          {STEP_TITLES.map((_, i) => (
            <span key={i} style={css(`flex:1;height:4px;border-radius:2px;background:${i <= step ? '#fff' : 'rgba(255,255,255,.3)'};transition:background .2s;`)} />
          ))}
        </div>
      </div>

      <div style={css('flex:1;overflow-y:auto;padding:20px 18px;')}>
        {/* Step 0 — placement */}
        {step === 0 && (
          <div>
            <SectionTitle>Where should it appear?</SectionTitle>
            <div style={css('font-size:12.5px;color:#8A7078;margin-top:4px;')}>Pick a slot — you’ll see a live preview on the next step.</div>
            <div style={css('display:flex;flex-direction:column;gap:12px;margin-top:14px;')}>
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

        {/* Step 1 — design the ad, with a live preview pinned on top */}
        {step === 1 && placementCode && (
          <div>
            <div style={css('display:flex;align-items:center;gap:7px;')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:#B02454;")}>visibility</span>
              <SectionTitle>Live preview</SectionTitle>
            </div>
            <div style={css('font-size:12px;color:#8A7078;margin-top:3px;margin-bottom:12px;')}>This is exactly how buyers will see your ad.</div>
            <AdPreview
              placementCode={placementCode}
              product={selectedProduct}
              boutique={boutique}
              headline={headline}
              subtext={subtext}
              heroImage={heroImageResolved}
            />

            <div style={css('height:1px;background:#F0E0E8;margin:20px 0;')} />

            {needsProduct ? (
              <>
                <SectionTitle>Choose the product</SectionTitle>
                <div style={css('display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-top:12px;')}>
                  {(products ?? []).map((p: ProductWithBoutique) => {
                    const active = p.id === productId;
                    return (
                      <button key={p.id} onClick={() => setProductId(p.id)} style={css(`position:relative;text-align:left;border:1.5px solid ${active ? '#D6336C' : '#F0D8E2'};background:#fff;border-radius:14px;overflow:hidden;cursor:pointer;padding:0;`)}>
                        <div style={css('aspect-ratio:1;background:#F6E8EE;')}>
                          {p.image_url && <img src={p.image_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />}
                        </div>
                        {active && (
                          <span style={css('position:absolute;top:7px;right:7px;width:24px;height:24px;border-radius:50%;background:#D6336C;display:flex;align-items:center;justify-content:center;')}>
                            <span style={css("font-family:'Material Symbols Outlined';font-size:16px;color:#fff;")}>check</span>
                          </span>
                        )}
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
              <div style={css('background:#fff;border:1.5px solid #F0D8E2;border-radius:14px;padding:16px;font-size:13.5px;color:#6B5560;')}>
                Your boutique <b>{boutiqueName}</b> will be boosted to the top of the Boutiques page with a “Promoted” tag for the whole campaign.
              </div>
            )}

            {isHero && (
              <div style={css('margin-top:20px;')}>
                <SectionTitle>Customise the hero</SectionTitle>
                <label style={css('font-size:12.5px;font-weight:700;color:#7A5C67;display:block;margin-top:12px;')}>
                  Headline
                  <input value={headline} onChange={(e) => setHeadline(e.target.value)} maxLength={40} placeholder={selectedProduct?.title ?? 'Wedding Season Edit'} style={css(field)} />
                </label>
                <label style={css('font-size:12.5px;font-weight:700;color:#7A5C67;display:block;margin-top:12px;')}>
                  Subtext
                  <input value={subtext} onChange={(e) => setSubtext(e.target.value)} maxLength={70} placeholder="Handpicked bridal pieces" style={css(field)} />
                </label>

                <div style={css('font-size:12.5px;font-weight:700;color:#7A5C67;margin-top:14px;')}>Banner image</div>
                <input ref={fileInput} type="file" accept="image/*" style={css('display:none;')} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickHeroImage(f); e.target.value = ''; }} />
                <div style={css('display:flex;gap:10px;margin-top:6px;')}>
                  <button onClick={() => fileInput.current?.click()} disabled={uploading} style={css('flex:1;height:46px;border-radius:12px;border:1.5px dashed #D9A9BE;background:#FFF4F8;color:#B02454;font-weight:800;font-size:13px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;')}>
                    <span style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>{uploading ? 'progress_activity' : 'add_photo_alternate'}</span>
                    {uploading ? 'Uploading…' : heroImage ? 'Change image' : 'Upload image'}
                  </button>
                  {heroImage && (
                    <button onClick={() => setHeroImage('')} disabled={uploading} style={css('flex:none;height:46px;padding:0 16px;border-radius:12px;border:1.5px solid #F0D8E2;background:#fff;color:#8A7078;font-weight:700;font-size:13px;cursor:pointer;')}>Reset</button>
                  )}
                </div>
                <div style={css('font-size:11.5px;color:#A98D99;margin-top:6px;')}>Optional — leave it and we’ll use the product’s own photo.</div>
              </div>
            )}
          </div>
        )}

        {/* Step 2 — schedule, preview and pay */}
        {step === 2 && placement && (
          <div>
            <SectionTitle>How long, and when?</SectionTitle>
            <label style={css('font-size:12.5px;font-weight:700;color:#7A5C67;display:block;margin-top:12px;')}>
              Duration (days)
              <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Math.min(90, Math.max(1, Number(e.target.value) || 1)))} style={css(field)} />
            </label>
            <div style={css('display:flex;gap:8px;margin-top:8px;')}>
              {[3, 7, 14, 30].map((d) => (
                <button key={d} onClick={() => setDays(d)} style={css(`flex:1;height:38px;border-radius:10px;border:1.5px solid ${days === d ? '#D6336C' : '#F0D8E2'};background:${days === d ? '#FCE9F0' : '#fff'};color:${days === d ? '#B02454' : '#8A7078'};font-weight:800;font-size:12.5px;cursor:pointer;`)}>{d}d</button>
              ))}
            </div>
            <label style={css('font-size:12.5px;font-weight:700;color:#7A5C67;display:block;margin-top:14px;')}>
              Start date
              <input type="date" min={todayISO()} value={startDate} onChange={(e) => setStartDate(e.target.value)} style={css(field)} />
            </label>

            <div style={css('display:flex;align-items:center;gap:7px;margin-top:20px;')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:18px;color:#B02454;")}>visibility</span>
              <SectionTitle>Preview</SectionTitle>
            </div>
            <div style={css('margin-top:12px;')}>
              <AdPreview
                placementCode={placement.code}
                product={selectedProduct}
                boutique={boutique}
                headline={headline}
                subtext={subtext}
                heroImage={heroImageResolved}
              />
            </div>

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

// ─────────────────────────────────────────────────────────────────────────────
// Live ad preview — a faithful miniature of each buyer-facing render, so the
// seller sees precisely what they are buying before they pay. Mirrors
// SponsoredStrip (sponsored_card), the Home hero slide (home_hero) and the
// Boutiques list card (boutique_promo).
// ─────────────────────────────────────────────────────────────────────────────

const PROMOTED_PILL = 'display:inline-flex;align-items:center;gap:3px;background:rgba(42,26,32,.72);color:#fff;border-radius:7px;padding:2px 7px;font-size:9px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;';

function AdPreview({
  placementCode,
  product,
  boutique,
  headline,
  subtext,
  heroImage,
}: {
  placementCode: AdPlacementCode;
  product: ProductWithBoutique | null;
  boutique: BoutiqueRow;
  headline: string;
  subtext: string;
  heroImage: string;
}) {
  const frame = 'background:#FBF6F2;border:1px solid #F0E0E8;border-radius:16px;padding:16px;display:flex;justify-content:center;';

  const needProduct = placementCode === 'sponsored_card' || placementCode === 'home_hero';
  if (needProduct && !product) {
    return (
      <div style={css(frame + 'color:#A98D99;font-size:13px;text-align:center;flex-direction:column;gap:8px;padding:28px 16px;')}>
        <span style={css("font-family:'Material Symbols Outlined';font-size:26px;color:#D9A9BE;")}>image</span>
        Choose a product below to preview your ad.
      </div>
    );
  }

  // Sponsored product card — a single card from the "Sponsored for you" rail.
  if (placementCode === 'sponsored_card' && product) {
    return (
      <div style={css(frame)}>
        <div style={css('width:172px;')}>
          <div style={css('font-size:11px;font-weight:800;color:#B02454;letter-spacing:.03em;text-transform:uppercase;margin-bottom:8px;display:flex;align-items:center;gap:5px;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:13px;")}>bolt</span>Sponsored for you
          </div>
          <div style={css('border-radius:14px;overflow:hidden;background:#F6E8EE;aspect-ratio:3/4;position:relative;')}>
            {product.image_url && <img src={product.image_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />}
            <span style={css('position:absolute;left:9px;top:9px;' + PROMOTED_PILL)}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:11px;")}>bolt</span>Sponsored
            </span>
          </div>
          <div style={css('padding:9px 2px 0;')}>
            <div style={css('font-size:13.5px;font-weight:700;color:#2A1A20;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{product.title}</div>
            <div style={css('font-size:12px;color:#8A7078;')}>{boutique.name}</div>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;color:#B02454;font-size:16.5px;margin-top:4px;")}>{money(product.price)}</div>
          </div>
        </div>
      </div>
    );
  }

  // Home hero — the full-bleed rotating banner at the top of Home.
  if (placementCode === 'home_hero' && product) {
    const title = headline.trim() || product.title;
    return (
      <div style={css(frame)}>
        <div style={css('width:100%;max-width:340px;border-radius:16px;overflow:hidden;position:relative;aspect-ratio:16/10;background:linear-gradient(120deg,#8E1C44,#B02454 55%,#D6336C);')}>
          {heroImage && <img src={heroImage} alt="" style={css('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;')} />}
          <div style={css('position:absolute;inset:0;background:linear-gradient(90deg,rgba(30,6,16,.72),rgba(30,6,16,.15));')} />
          <div style={css('position:absolute;inset:0;padding:16px 18px;display:flex;flex-direction:column;justify-content:center;color:#fff;')}>
            <span style={css('align-self:flex-start;' + PROMOTED_PILL)}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:11px;")}>bolt</span>Sponsored
            </span>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;line-height:1.15;margin-top:10px;text-shadow:0 1px 8px rgba(45,8,24,.5);")}>{title}</div>
            {subtext.trim() && <div style={css('font-size:12px;opacity:.92;margin-top:6px;max-width:230px;text-shadow:0 1px 8px rgba(45,8,24,.5);')}>{subtext.trim()}</div>}
            <span style={css('align-self:flex-start;margin-top:12px;background:#fff;color:#B02454;border-radius:10px;padding:7px 14px;font-weight:800;font-size:12px;display:inline-flex;align-items:center;gap:5px;')}>
              Shop now<span style={css("font-family:'Material Symbols Outlined';font-size:14px;")}>arrow_forward</span>
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Boutique promo — the shop's own card, lifted to the top of the Boutiques list.
  const initials = boutique.name.trim().slice(0, 2).toUpperCase();
  return (
    <div style={css(frame)}>
      <div style={css('width:100%;max-width:340px;background:#fff;border:1px solid #F2E4EA;border-radius:16px;padding:13px 14px;display:flex;align-items:center;gap:12px;box-shadow:0 12px 30px -26px rgba(107,20,54,.6);')}>
        <div style={css('width:52px;height:52px;flex:none;border-radius:14px;background:linear-gradient(135deg,#FCE9F0,#F6D8E4);overflow:hidden;display:flex;align-items:center;justify-content:center;')}>
          {boutique.logo_url ? <img src={boutique.logo_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} /> : <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:19px;color:#B02454;")}>{initials}</span>}
        </div>
        <div style={css('min-width:0;flex:1;')}>
          <div style={css('display:flex;align-items:center;gap:6px;')}>
            <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:16px;color:#2A1A20;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{boutique.name}</span>
            {boutique.verified && <span style={css("font-family:'Material Symbols Outlined';font-size:15px;color:#3E9BE0;flex:none;")}>verified</span>}
            <span style={css('flex:none;' + PROMOTED_PILL)}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:11px;")}>bolt</span>Promoted
            </span>
          </div>
          <div style={css('display:flex;align-items:center;gap:5px;margin-top:5px;font-size:12.5px;color:#8A7078;')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:15px;color:#E0B84B;")}>star</span>
            {(boutique.rating ?? 0).toFixed(1)}
            {boutique.city && <span>· {boutique.city}</span>}
          </div>
        </div>
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
