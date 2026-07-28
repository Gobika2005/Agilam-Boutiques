import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { nameOk, phoneOk, pincodeOk } from '@/lib/buyerDetails';
import { fmt } from '@/data/demo';
import { POLICY_TERMS } from '@/data/company';

export function Checkout() {
  const navigate = useNavigate();
  const { cart, subtotal, discount, shipFee, total, guest, setGuest, showToast } = useShop();
  const { productById, boutiques } = useCatalog();
  const [touched, setTouched] = useState(false);

  // The boutiques actually in the bag — checkout becomes one order per
  // boutique, so each one's own delivery setting (not a single generic
  // line) is what the buyer needs to see before paying.
  const cartBoutiques = useMemo(() => {
    const ids = new Set<string>();
    const list: typeof boutiques = [];
    for (const id of Object.keys(cart)) {
      const p = productById(id);
      if (!p) continue;
      const b = p.boutiqueId ? boutiques.find((x) => x.id === p.boutiqueId) : boutiques.find((x) => x.name === p.boutique);
      if (!b || ids.has(b.id)) continue;
      ids.add(b.id);
      list.push(b);
    }
    return list;
  }, [cart, productById, boutiques]);

  const errors = {
    name: !nameOk(guest.name),
    phone: !phoneOk(guest.phone),
    address: guest.address.trim().length < 5,
    city: guest.city.trim().length < 2,
    pincode: !pincodeOk(guest.pincode),
  };
  const invalid = errors.name || errors.phone || errors.address || errors.city || errors.pincode;

  const continueToPayment = () => {
    if (invalid) {
      setTouched(true);
      showToast('Please fill in your delivery details');
      return;
    }
    navigate('/buyer/payment');
  };

  const errorRing = (bad: boolean) => (touched && bad ? '#E0748C' : 'var(--ag-border)');

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('max-width:980px;margin:0 auto;')}>
        <div style={css('padding:4px 0 2px;')}>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Step 2 of 3 · Delivery</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(28px,3vw,40px);line-height:1.05;margin-top:4px;")}>Where should we deliver?</div>
        </div>

        <div className="agx-cart-grid" style={css('display:grid;gap:22px;align-items:start;margin-top:18px;')}>
          <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;padding:22px;box-shadow:0 14px 32px -28px rgba(107,20,54,.5);display:flex;flex-direction:column;gap:15px;')}>
            <label style={css('font-size:12.5px;font-weight:800;color:var(--ag-label);')}>
              Full name
              <input value={guest.name} onChange={(e) => setGuest({ name: e.target.value })} placeholder="Your name" style={css(`display:block;width:100%;margin-top:7px;border:1.5px solid ${errorRing(errors.name)};background:var(--ag-bg);border-radius:14px;padding:0 15px;height:52px;font-size:15px;font-weight:600;color:var(--ag-ink);`)} />
            </label>
            <label style={css('font-size:12.5px;font-weight:800;color:var(--ag-label);')}>
              Mobile number
              <div style={css(`display:flex;align-items:center;margin-top:7px;border:1.5px solid ${errorRing(errors.phone)};background:var(--ag-bg);border-radius:14px;padding:0 15px;height:52px;`)}>
                <span style={css('font-weight:800;color:var(--ag-muted);font-size:15px;')}>+91</span>
                <input value={guest.phone} onChange={(e) => setGuest({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} inputMode="numeric" placeholder="10-digit number" style={css('border:none;background:none;flex:1;margin-left:10px;font-size:15px;font-weight:600;color:var(--ag-ink);min-width:0;')} />
              </div>
            </label>
            <label style={css('font-size:12.5px;font-weight:800;color:var(--ag-label);')}>
              Flat / House no. &amp; area
              <textarea rows={2} value={guest.address} onChange={(e) => setGuest({ address: e.target.value })} placeholder="House / flat no., street, area" style={css(`display:block;width:100%;margin-top:7px;border:1.5px solid ${errorRing(errors.address)};background:var(--ag-bg);border-radius:14px;padding:12px 15px;font-size:15px;font-weight:600;color:var(--ag-ink);resize:none;line-height:1.5;`)} />
            </label>
            <div style={css('display:flex;gap:14px;flex-wrap:wrap;')}>
              <label style={css('flex:1;min-width:130px;font-size:12.5px;font-weight:800;color:var(--ag-label);')}>
                City
                <input value={guest.city} onChange={(e) => setGuest({ city: e.target.value })} placeholder="City" style={css(`display:block;width:100%;margin-top:7px;border:1.5px solid ${errorRing(errors.city)};background:var(--ag-bg);border-radius:14px;padding:0 15px;height:52px;font-size:15px;font-weight:600;color:var(--ag-ink);`)} />
              </label>
              <label style={css('flex:1;min-width:130px;font-size:12.5px;font-weight:800;color:var(--ag-label);')}>
                Pincode
                <input value={guest.pincode} onChange={(e) => setGuest({ pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} inputMode="numeric" placeholder="6-digit PIN" style={css(`display:block;width:100%;margin-top:7px;border:1.5px solid ${errorRing(errors.pincode)};background:var(--ag-bg);border-radius:14px;padding:0 15px;height:52px;font-size:15px;font-weight:600;color:var(--ag-ink);`)} />
              </label>
            </div>
            <div>
              <div className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-muted);')}>Delivery{cartBoutiques.length > 1 ? ` · ${cartBoutiques.length} boutiques` : ''}</div>
              <div style={css('display:flex;flex-direction:column;gap:8px;margin-top:9px;')}>
                {cartBoutiques.map((b) => (
                  <div key={b.id} style={css('display:flex;align-items:center;gap:12px;border:1.5px solid #D6336C;background:var(--ag-surface-2);border-radius:15px;padding:13px 15px;')}>
                    <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;")}>local_shipping</span>
                    <div style={css('flex:1;min-width:0;')}>
                      <div style={css('font-weight:800;font-size:14px;color:var(--ag-crimson);')}>
                        {b.name}{cartBoutiques.length > 1 ? '' : ' · ' + (b.deliveryAvailable === false ? 'Store pickup only' : b.deliveryCharge ? `₹${b.deliveryCharge} delivery` : 'Free delivery')}
                      </div>
                      <div style={css('color:var(--ag-muted);font-size:12px;margin-top:3px;')}>
                        {cartBoutiques.length > 1 && (b.deliveryAvailable === false ? 'Store pickup only · ' : b.deliveryCharge ? `₹${b.deliveryCharge} delivery · ` : 'Free delivery · ')}
                        {POLICY_TERMS.deliveryEstimate} from dispatch{b.deliveryAreas ? ` · Delivers to ${b.deliveryAreas}` : ''}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="agx-cart-sticky" style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;padding:20px;box-shadow:0 20px 44px -30px rgba(107,20,54,.55);position:sticky;top:80px;')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Summary</div>
            <div style={css('display:flex;flex-direction:column;gap:11px;margin-top:16px;font-size:14px;')}>
              <div style={css('display:flex;justify-content:space-between;color:var(--ag-ink-2);')}><span>Subtotal</span><span style={css('font-weight:700;')}>{fmt(subtotal)}</span></div>
              {discount > 0 && (
                <div style={css('display:flex;justify-content:space-between;color:var(--ag-good);')}><span>Discount</span><span style={css('font-weight:800;')}>– {fmt(discount)}</span></div>
              )}
              <div style={css('display:flex;justify-content:space-between;color:var(--ag-ink-2);')}><span>Delivery</span><span style={css('font-weight:800;color:var(--ag-good);')}>{shipFee === 0 ? 'FREE' : fmt(shipFee)}</span></div>
            </div>
            <div style={css('height:1px;background:var(--ag-surface-3);margin:16px 0;')} />
            <div style={css('display:flex;justify-content:space-between;align-items:baseline;')}>
              <span style={css('font-weight:800;')}>Total</span>
              <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:26px;")}>{fmt(total)}</span>
            </div>
            {touched && invalid && (
              <div style={css('color:#C0455E;font-size:12px;font-weight:700;margin-top:16px;text-align:center;')}>
                Enter your name, a 10-digit mobile number, full address and a valid 6-digit pincode to continue.
              </div>
            )}
            <button onClick={continueToPayment} style={css(`width:100%;height:54px;margin-top:${touched && invalid ? '10px' : '18px'};border:none;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);`)}>
              Continue to payment<span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>arrow_forward</span>
            </button>
            <div style={css('text-align:center;font-size:11.5px;line-height:1.5;color:#9A8088;font-weight:600;margin-top:11px;')}>
              By placing your order you agree to our{' '}
              <a href="/buyer/policy/terms" target="_blank" rel="noopener noreferrer" style={css('font-weight:800;color:var(--ag-crimson);text-decoration:underline;')}>Terms</a>,{' '}
              <a href="/buyer/policy/return-refund-policy" target="_blank" rel="noopener noreferrer" style={css('font-weight:800;color:var(--ag-crimson);text-decoration:underline;')}>Return &amp; Refund</a> and{' '}
              <a href="/buyer/policy/cancellation-policy" target="_blank" rel="noopener noreferrer" style={css('font-weight:800;color:var(--ag-crimson);text-decoration:underline;')}>Cancellation</a> policies.
            </div>
            <button onClick={() => navigate('/buyer/cart')} style={css('width:100%;height:44px;margin-top:9px;border:none;background:none;cursor:pointer;color:var(--ag-muted);font-weight:800;font-size:13px;')}>Back to bag</button>
          </div>
        </div>
      </div>
    </div>
  );
}
