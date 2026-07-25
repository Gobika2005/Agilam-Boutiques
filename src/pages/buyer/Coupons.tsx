import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { couponSavings, isEligible, isExpired } from '@/lib/pricing';
import { TONES, fmt } from '@/data/demo';
import type { CouponRow } from '@/data/coupons';

// Where "Apply" sends the buyer back to. The bag and the payment screen both
// open this page, and landing back on the one you came from — with the new
// total already on it — is what makes applying a coupon feel finished.
const RETURN_LABELS: Record<string, string> = {
  '/buyer/cart': 'bag',
  '/buyer/payment': 'payment',
  '/buyer/checkout': 'delivery',
};

// A coupon row carries no colour of its own (the tone lived on the old hardcoded
// list). Pick a stable one from the shared palette by hashing the code, so a
// given code always shows the same colour without a schema field for it.
function toneFor(code: string): string {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}

const prettyDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function Coupons() {
  const navigate = useNavigate();
  const { state } = useLocation() as { state: { from?: string } | null };
  const {
    appliedCoupon, applyCoupon, removeCoupon, coupon, coupons, boutiqueSubtotals,
    subtotal, discount, shipFee, total, showToast,
  } = useShop();
  const { boutiques } = useCatalog();
  const [code, setCode] = useState('');

  const from = state?.from && RETURN_LABELS[state.from] ? state.from : '/buyer/cart';
  const backLabel = RETURN_LABELS[from];
  const emptyBag = subtotal === 0;

  const boutiqueName = (id: string) => boutiques.find((b) => b.id === id)?.name ?? 'this boutique';

  // Show every platform coupon, plus a seller's coupon only when that seller has
  // something in the bag — an offer for a shop you aren't buying from is noise.
  const relevant = coupons.filter((c) => !c.boutique_id || (boutiqueSubtotals[c.boutique_id] ?? 0) > 0);

  const list = relevant.map((c) => {
    const base = c.boutique_id ? (boutiqueSubtotals[c.boutique_id] ?? 0) : subtotal;
    const expired = isExpired(c);
    // An expired coupon can never be redeemed, so it can't be "eligible" however
    // full the bag is — that keeps the button and savings badge honest.
    const eligible = !expired && isEligible(c, subtotal, boutiqueSubtotals);
    const savings = expired ? 0 : couponSavings(c, subtotal, boutiqueSubtotals);
    return {
      ...c,
      base,
      expired,
      eligible,
      savings,
      applied: appliedCoupon?.toUpperCase() === c.code.toUpperCase(),
      shortfall: eligible ? 0 : Math.max(0, c.min_subtotal - base),
    };
  });

  // Apply, say what it saved, and hand the buyer back to where they were.
  const redeem = (c: CouponRow) => {
    if (isExpired(c)) {
      showToast(`${c.code} has expired`);
      return;
    }
    if (emptyBag) {
      showToast('Add something to your bag first');
      return;
    }
    if (!isEligible(c, subtotal, boutiqueSubtotals)) {
      const base = c.boutique_id ? (boutiqueSubtotals[c.boutique_id] ?? 0) : subtotal;
      if (c.boutique_id && base <= 0) {
        showToast(`${c.code} only applies to items from ${boutiqueName(c.boutique_id)}`);
        return;
      }
      showToast(`Add ${fmt(Math.max(0, c.min_subtotal - base))} more to use ${c.code}`);
      return;
    }
    applyCoupon(c.code);
    const savings = couponSavings(c, subtotal, boutiqueSubtotals);
    showToast(savings > 0 ? `${c.code} applied · you save ${fmt(savings)}` : `${c.code} applied`);
    navigate(from);
  };

  const applyTyped = () => {
    const typed = code.trim().toUpperCase();
    if (!typed) return showToast('Enter a coupon code');
    // Typed codes match against ALL active coupons, not just the ones on screen.
    const match = coupons.find((c) => c.code.toUpperCase() === typed);
    if (!match) return showToast(`${typed} isn’t a valid coupon`);
    redeem(match);
  };

  const drop = () => {
    removeCoupon();
    showToast('Coupon removed');
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('max-width:720px;margin:0 auto;')}>
        <button onClick={() => navigate(from)} style={css('display:flex;align-items:center;gap:6px;padding:6px 0;border:none;background:none;cursor:pointer;color:var(--ag-muted);font-weight:800;font-size:13px;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:18px;color:var(--ag-crimson);")}>arrow_back</span>
          Back to {backLabel}
        </button>

        <div style={css('padding:2px 0 6px;')}>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Save more</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(28px,3vw,40px);line-height:1.05;margin-top:4px;")}>Coupons &amp; offers</div>
          <div style={css('color:var(--ag-muted);font-size:13px;margin-top:6px;')}>
            {emptyBag
              ? 'Your bag is empty — add a piece to use a coupon.'
              : `Bag total ${fmt(subtotal)}. Pick an offer and we’ll take you back to ${backLabel}.`}
          </div>
        </div>

        {coupon && (
          <div style={css('display:flex;align-items:center;gap:11px;margin-top:14px;background:var(--ag-good-bg);border:1.5px solid #9BD3B0;border-radius:16px;padding:14px;')}>
            <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-good);font-size:22px;")}>verified</span>
            <div style={css('flex:1;min-width:0;')}>
              <div style={css('font-weight:800;font-size:13.5px;color:var(--ag-good-text);')}>{coupon.code} applied</div>
              <div style={css('color:#4B7A61;font-size:12px;margin-top:2px;')}>
                {discount > 0 ? `You save ${fmt(discount)} on this order` : 'Delivery is free on this order'}
              </div>
            </div>
            <button onClick={drop} style={css('flex:none;height:36px;padding:0 14px;border:1.5px solid #C8E3D3;background:var(--ag-surface);border-radius:11px;cursor:pointer;color:#4B7A61;font-weight:800;font-size:12.5px;')}>Remove</button>
          </div>
        )}

        <div style={css('display:flex;align-items:center;margin-top:14px;background:var(--ag-surface);border:1.5px dashed #E7B7CB;border-radius:15px;padding:5px 5px 5px 16px;box-shadow:0 14px 32px -30px rgba(107,20,54,.5);')}>
          <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>confirmation_number</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyTyped()}
            placeholder="Enter coupon code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            style={css('border:none;background:none;flex:1;margin-left:11px;font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--ag-ink);min-width:0;')}
          />
          <button onClick={applyTyped} style={css('height:44px;padding:0 20px;border:none;border-radius:12px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13.5px;cursor:pointer;')}>Apply</button>
        </div>

        {list.length === 0 && (
          <div style={css('margin-top:18px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:26px 18px;text-align:center;box-shadow:0 16px 36px -30px rgba(107,20,54,.55);')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:34px;color:#E0C4D0;")}>local_offer</span>
            <div style={css('font-weight:800;font-size:14px;color:var(--ag-ink-2);margin-top:8px;')}>No offers right now</div>
            <div style={css('color:var(--ag-muted);font-size:12.5px;margin-top:4px;')}>Have a code? Enter it above — it still works.</div>
          </div>
        )}

        <div style={css('display:flex;flex-direction:column;gap:14px;margin-top:18px;')}>
          {list.map((c) => (
            <div key={c.id} style={css(`display:flex;background:var(--ag-surface);border:1.5px solid ${c.applied ? '#9BD3B0' : 'var(--ag-surface-3)'};border-radius:20px;overflow:hidden;box-shadow:0 16px 36px -30px rgba(107,20,54,.55);opacity:${c.eligible ? 1 : 0.72};`)}>
              <div style={css(`width:66px;flex:none;background:${toneFor(c.code)};display:flex;align-items:center;justify-content:center;`)}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:30px;color:rgba(42,26,32,.55);")}>local_offer</span>
              </div>
              <div style={css('flex:1;min-width:0;padding:15px;')}>
                <div style={css('display:flex;align-items:center;gap:9px;flex-wrap:wrap;')}>
                  <span style={css("font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:15px;color:var(--ag-crimson);letter-spacing:.04em;")}>{c.code}</span>
                  {c.boutique_id && (
                    <span style={css('font-size:10px;font-weight:800;color:#8A5A20;background:var(--ag-gold-bg);border-radius:6px;padding:2px 7px;')}>{boutiqueName(c.boutique_id)}</span>
                  )}
                  {c.applied && <span style={css('font-size:10px;font-weight:800;color:var(--ag-good-text);background:var(--ag-good-bg);border-radius:6px;padding:2px 7px;')}>APPLIED</span>}
                  {!c.applied && c.eligible && c.savings > 0 && (
                    <span style={css('font-size:10.5px;font-weight:800;color:var(--ag-crimson);background:var(--ag-surface-2);border-radius:6px;padding:2px 7px;')}>SAVE {fmt(c.savings)}</span>
                  )}
                </div>
                <div style={css('font-weight:700;font-size:13.5px;color:var(--ag-ink-2);margin-top:5px;')}>{c.description || c.code}</div>
                <div style={css(`font-size:11.5px;margin-top:4px;color:${c.expired ? '#B03A3A' : c.eligible ? 'var(--ag-muted)' : '#C08A2E'};`)}>
                  {c.expired ? `Expired on ${prettyDate(c.expires_at)}` : c.eligible ? `Valid till ${prettyDate(c.expires_at)}` : `Add ${fmt(c.shortfall)} more to use this`}
                </div>
              </div>
              <button
                onClick={() => (c.applied ? drop() : redeem(c))}
                disabled={c.expired && !c.applied}
                style={css(`align-self:center;margin-right:14px;flex:none;height:40px;padding:0 18px;border:1.5px solid ${c.expired && !c.applied ? '#E3D6DB' : c.applied ? '#C8E3D3' : '#D6336C'};background:var(--ag-surface);color:${c.expired && !c.applied ? '#B79FA9' : c.applied ? '#4B7A61' : 'var(--ag-crimson)'};border-radius:12px;font-weight:800;font-size:13px;cursor:${c.expired && !c.applied ? 'not-allowed' : 'pointer'};`)}
              >
                {c.applied ? 'Remove' : c.expired ? 'Expired' : 'Apply'}
              </button>
            </div>
          ))}
        </div>

        {!emptyBag && (
          <div style={css('margin-top:18px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:18px;box-shadow:0 16px 36px -30px rgba(107,20,54,.55);')}>
            <div style={css('display:flex;flex-direction:column;gap:10px;font-size:14px;')}>
              <div style={css('display:flex;justify-content:space-between;color:var(--ag-ink-2);')}><span>Subtotal</span><span style={css('font-weight:700;')}>{fmt(subtotal)}</span></div>
              {discount > 0 && (
                <div style={css('display:flex;justify-content:space-between;color:var(--ag-good);')}><span>Coupon discount</span><span style={css('font-weight:800;')}>– {fmt(discount)}</span></div>
              )}
              <div style={css('display:flex;justify-content:space-between;color:var(--ag-ink-2);')}><span>Delivery</span><span style={css('font-weight:800;color:var(--ag-good);')}>{shipFee === 0 ? 'FREE' : fmt(shipFee)}</span></div>
            </div>
            <div style={css('height:1px;background:var(--ag-surface-3);margin:15px 0;')} />
            <div style={css('display:flex;justify-content:space-between;align-items:baseline;')}>
              <span style={css('font-weight:800;')}>Total</span>
              <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:26px;")}>{fmt(total)}</span>
            </div>
            <button onClick={() => navigate(from)} style={css('width:100%;height:52px;margin-top:16px;border:none;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);')}>
              Back to {backLabel}<span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>arrow_forward</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
