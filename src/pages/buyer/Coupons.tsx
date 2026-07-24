import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { couponSavings, isEligible } from '@/lib/pricing';
import { COUPONS, TONES, fmt } from '@/data/demo';

// Where "Apply" sends the buyer back to. The bag and the payment screen both
// open this page, and landing back on the one you came from — with the new
// total already on it — is what makes applying a coupon feel finished.
const RETURN_LABELS: Record<string, string> = {
  '/buyer/cart': 'bag',
  '/buyer/payment': 'payment',
  '/buyer/checkout': 'delivery',
};

export function Coupons() {
  const navigate = useNavigate();
  const { state } = useLocation() as { state: { from?: string } | null };
  const { appliedCoupon, applyCoupon, removeCoupon, coupon, subtotal, discount, shipFee, total, showToast } = useShop();
  const [code, setCode] = useState('');

  const from = state?.from && RETURN_LABELS[state.from] ? state.from : '/buyer/cart';
  const backLabel = RETURN_LABELS[from];
  const emptyBag = subtotal === 0;

  const list = COUPONS.map((c) => {
    const eligible = isEligible(c, subtotal);
    const savings = couponSavings(c, subtotal);
    return {
      ...c,
      eligible,
      savings,
      applied: appliedCoupon === c.code,
      shortfall: eligible ? 0 : c.min - subtotal,
    };
  });

  // Apply, say what it saved, and hand the buyer back to where they were.
  const redeem = (c: (typeof list)[number]) => {
    if (emptyBag) {
      showToast('Add something to your bag first');
      return;
    }
    if (!c.eligible) {
      showToast(`Add ${fmt(c.shortfall)} more to use ${c.code}`);
      return;
    }
    applyCoupon(c.code);
    showToast(c.savings > 0 ? `${c.code} applied · you save ${fmt(c.savings)}` : `${c.code} applied`);
    navigate(from);
  };

  const applyTyped = () => {
    const typed = code.trim().toUpperCase();
    if (!typed) return showToast('Enter a coupon code');
    const match = list.find((c) => c.code === typed);
    if (!match) return showToast(`${typed} isn’t a valid coupon`);
    redeem(match);
  };

  const drop = () => {
    removeCoupon();
    showToast('Coupon removed');
  };

  return (
    <div style={css('min-height:100%;background:#FBF6F2;padding-bottom:20px;')}>
      <div style={css('max-width:720px;margin:0 auto;')}>
        <button onClick={() => navigate(from)} style={css('display:flex;align-items:center;gap:6px;padding:6px 0;border:none;background:none;cursor:pointer;color:#8A7078;font-weight:800;font-size:13px;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:18px;color:#B02454;")}>arrow_back</span>
          Back to {backLabel}
        </button>

        <div style={css('padding:2px 0 6px;')}>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:#B02454;')}>Save more</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(28px,3vw,40px);line-height:1.05;margin-top:4px;")}>Coupons &amp; offers</div>
          <div style={css('color:#8A7078;font-size:13px;margin-top:6px;')}>
            {emptyBag
              ? 'Your bag is empty — add a piece to use a coupon.'
              : `Bag total ${fmt(subtotal)}. Pick an offer and we’ll take you back to ${backLabel}.`}
          </div>
        </div>

        {coupon && (
          <div style={css('display:flex;align-items:center;gap:11px;margin-top:14px;background:#F3FBF5;border:1.5px solid #9BD3B0;border-radius:16px;padding:14px;')}>
            <span style={css("font-family:'Material Symbols Outlined';color:#2FA36B;font-size:22px;")}>verified</span>
            <div style={css('flex:1;min-width:0;')}>
              <div style={css('font-weight:800;font-size:13.5px;color:#218456;')}>{coupon.code} applied</div>
              <div style={css('color:#4B7A61;font-size:12px;margin-top:2px;')}>
                {discount > 0 ? `You save ${fmt(discount)} on this order` : 'Delivery is free on this order'}
              </div>
            </div>
            <button onClick={drop} style={css('flex:none;height:36px;padding:0 14px;border:1.5px solid #C8E3D3;background:#fff;border-radius:11px;cursor:pointer;color:#4B7A61;font-weight:800;font-size:12.5px;')}>Remove</button>
          </div>
        )}

        <div style={css('display:flex;align-items:center;margin-top:14px;background:#fff;border:1.5px dashed #E7B7CB;border-radius:15px;padding:5px 5px 5px 16px;box-shadow:0 14px 32px -30px rgba(107,20,54,.5);')}>
          <span style={css("font-family:'Material Symbols Outlined';color:#B02454;")}>confirmation_number</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && applyTyped()}
            placeholder="Enter coupon code"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            style={css('border:none;background:none;flex:1;margin-left:11px;font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#241019;min-width:0;')}
          />
          <button onClick={applyTyped} style={css('height:44px;padding:0 20px;border:none;border-radius:12px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13.5px;cursor:pointer;')}>Apply</button>
        </div>

        <div style={css('display:flex;flex-direction:column;gap:14px;margin-top:18px;')}>
          {list.map((c) => (
            <div key={c.code} style={css(`display:flex;background:#fff;border:1.5px solid ${c.applied ? '#9BD3B0' : '#F2E4EA'};border-radius:20px;overflow:hidden;box-shadow:0 16px 36px -30px rgba(107,20,54,.55);opacity:${c.eligible ? 1 : 0.72};`)}>
              <div style={css(`width:66px;flex:none;background:${TONES[c.tone]};display:flex;align-items:center;justify-content:center;`)}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:30px;color:rgba(42,26,32,.55);")}>local_offer</span>
              </div>
              <div style={css('flex:1;min-width:0;padding:15px;')}>
                <div style={css('display:flex;align-items:center;gap:9px;flex-wrap:wrap;')}>
                  <span style={css("font-family:'IBM Plex Mono',monospace;font-weight:600;font-size:15px;color:#B02454;letter-spacing:.04em;")}>{c.code}</span>
                  {c.applied && <span style={css('font-size:10px;font-weight:800;color:#218456;background:#E5F3EC;border-radius:6px;padding:2px 7px;')}>APPLIED</span>}
                  {!c.applied && c.eligible && c.savings > 0 && (
                    <span style={css('font-size:10.5px;font-weight:800;color:#B02454;background:#FCE0EC;border-radius:6px;padding:2px 7px;')}>SAVE {fmt(c.savings)}</span>
                  )}
                </div>
                <div style={css('font-weight:700;font-size:13.5px;color:#4B3840;margin-top:5px;')}>{c.desc}</div>
                <div style={css(`font-size:11.5px;margin-top:4px;color:${c.eligible ? '#8A7078' : '#C08A2E'};`)}>
                  {c.eligible ? `Valid till ${c.expires}` : `Add ${fmt(c.shortfall)} more to use this`}
                </div>
              </div>
              <button
                onClick={() => (c.applied ? drop() : redeem(c))}
                style={css(`align-self:center;margin-right:14px;flex:none;height:40px;padding:0 18px;border:1.5px solid ${c.applied ? '#C8E3D3' : '#D6336C'};background:#fff;color:${c.applied ? '#4B7A61' : '#B02454'};border-radius:12px;font-weight:800;font-size:13px;cursor:pointer;`)}
              >
                {c.applied ? 'Remove' : 'Apply'}
              </button>
            </div>
          ))}
        </div>

        {!emptyBag && (
          <div style={css('margin-top:18px;background:#fff;border:1px solid #F2E4EA;border-radius:20px;padding:18px;box-shadow:0 16px 36px -30px rgba(107,20,54,.55);')}>
            <div style={css('display:flex;flex-direction:column;gap:10px;font-size:14px;')}>
              <div style={css('display:flex;justify-content:space-between;color:#5C4650;')}><span>Subtotal</span><span style={css('font-weight:700;')}>{fmt(subtotal)}</span></div>
              {discount > 0 && (
                <div style={css('display:flex;justify-content:space-between;color:#2FA36B;')}><span>Coupon discount</span><span style={css('font-weight:800;')}>– {fmt(discount)}</span></div>
              )}
              <div style={css('display:flex;justify-content:space-between;color:#5C4650;')}><span>Delivery</span><span style={css('font-weight:800;color:#2FA36B;')}>{shipFee === 0 ? 'FREE' : fmt(shipFee)}</span></div>
            </div>
            <div style={css('height:1px;background:#F0E2E9;margin:15px 0;')} />
            <div style={css('display:flex;justify-content:space-between;align-items:baseline;')}>
              <span style={css('font-weight:800;')}>Total</span>
              <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:#B02454;font-size:26px;")}>{fmt(total)}</span>
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
