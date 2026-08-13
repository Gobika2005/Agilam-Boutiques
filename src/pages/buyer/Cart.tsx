import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { useSignedIn, signInPath } from '@/auth/SignInGate';
import { TONES, fmt } from '@/data/demo';

export function Cart() {
  usePageMeta({ title: 'Your bag', description: 'Review the pieces in your MangaiMart bag before checkout.' });
  const navigate = useNavigate();
  const {
    cart, cartQty, removeCart,
    appliedCoupon, removeCoupon, coupon,
    subtotal, discount, shipFee, total, buyerPlace, undeliverable,
  } = useShop();
  const { productById } = useCatalog();
  // Ordering needs a real account (see @/auth/SignInGate). The route guard on
  // /checkout would catch it anyway, but saying so on the button is kinder than
  // a silent bounce to a login screen the buyer didn't ask for.
  const { signedIn, loading: authLoading } = useSignedIn();

  const items = Object.entries(cart)
    .map(([id, line]) => {
      const p = productById(id);
      if (!p) return null;
      // `atStock` drives the disabled "+" so the cap is visible before it is
      // hit, rather than only reported by a toast after the tap.
      return {
        ...p,
        qtyN: line.qty,
        size: line.size,
        lineTotal: p.price * line.qty,
        atStock: typeof p.stock === 'number' && line.qty >= p.stock,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const hasCart = items.length > 0;
  const checkoutLabel = signedIn || authLoading ? 'Proceed to checkout' : 'Sign in to checkout';
  const goCheckout = () => navigate(signedIn ? '/checkout' : signInPath('/checkout'));

  return (
    // `agx-cart-root` is what retires the nav dock in favour of the pinned
    // checkout bar below 840px — and only when there is something to check out,
    // so an empty bag keeps the dock and is not a dead end. See index.css.
    <div className={hasCart ? 'agx-cart-root' : undefined} style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('max-width:980px;margin:0 auto;')}>
        <div style={css('padding:4px 0 2px;')}>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Step 1 of 3 · Bag</div>
          <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(28px,3vw,40px);line-height:1.05;margin:4px 0 0;")}>Your shopping bag</h1>
        </div>

        {hasCart ? (
          <div className="agx-cart-grid" style={css('display:grid;gap:22px;align-items:start;margin-top:18px;')}>
            <div style={css('display:flex;flex-direction:column;gap:14px;')}>
              {items.map((c) => (
                <div key={c.id} style={css('display:flex;gap:14px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:14px;box-shadow:0 14px 32px -28px rgba(107,20,54,.5);')}>
                  <div className="agx-thumb-media agx-zoom" style={css(`width:96px;border-radius:14px;background:${TONES[c.tone]};`)}>
                    <ImageSlot src={c.image} placeholder={c.title} className="agx-prod-fill" sizes="96px" />
                  </div>
                  <div style={css('flex:1;min-width:0;display:flex;flex-direction:column;')}>
                    <div style={css('display:flex;justify-content:space-between;gap:10px;')}>
                      <div style={css('min-width:0;')}>
                        <div style={css('font-weight:800;font-size:15.5px;line-height:1.2;')}>{c.title}</div>
                        <div style={css('color:var(--ag-muted);font-size:12.5px;margin-top:3px;')}>{c.boutique} · Size {c.size}</div>
                        {c.atStock && (
                          <div style={css('color:var(--ag-warn,#B7791F);font-size:12px;font-weight:700;margin-top:4px;')}>
                            {c.stock === 0 ? 'Out of stock' : `Only ${c.stock} left — that's all this boutique has`}
                          </div>
                        )}
                      </div>
                      <button onClick={() => removeCart(c.id)} aria-label={`Remove ${c.title} from bag`} style={css('border:none;background:none;cursor:pointer;color:var(--ag-muted-soft);padding:0;height:fit-content;')}>
                        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>delete</span>
                      </button>
                    </div>
                    <div style={css('flex:1;min-height:12px;')} />
                    <div style={css('display:flex;align-items:center;justify-content:space-between;')}>
                      <div style={css('display:flex;align-items:center;border:1.5px solid var(--ag-border);border-radius:12px;overflow:hidden;')}>
                        <button onClick={() => cartQty(c.id, -1)} aria-label={`Reduce quantity of ${c.title}`} style={css('width:34px;height:34px;border:none;background:var(--ag-surface);cursor:pointer;color:var(--ag-crimson);font-size:19px;font-weight:700;')}>−</button>
                        <span style={css('min-width:28px;text-align:center;font-weight:800;font-size:14px;')}>{c.qtyN}</span>
                        <button
                          onClick={() => cartQty(c.id, 1)}
                          disabled={c.atStock}
                          aria-label={`Increase quantity of ${c.title}`}
                          style={css(`width:34px;height:34px;border:none;background:var(--ag-surface);cursor:${c.atStock ? 'not-allowed' : 'pointer'};color:${c.atStock ? 'var(--ag-muted-soft)' : 'var(--ag-crimson)'};font-size:18px;font-weight:700;`)}
                        >+</button>
                      </div>
                      <div style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:20px;")}>{fmt(c.lineTotal)}</div>
                    </div>
                  </div>
                </div>
              ))}
              <button onClick={() => navigate('/')} style={css('align-self:flex-start;border:none;background:none;cursor:pointer;color:var(--ag-crimson);font-weight:800;font-size:13.5px;display:flex;align-items:center;gap:6px;padding:4px 0;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;")}>arrow_back</span>Continue shopping
              </button>
            </div>

            <div className="agx-cart-sticky" style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;padding:20px;box-shadow:0 20px 44px -30px rgba(107,20,54,.55);position:sticky;top:80px;')}>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Order summary</div>

              {coupon && (
                <div style={css('display:flex;align-items:center;gap:10px;margin-top:15px;background:var(--ag-good-bg);border:1px dashed #9BD3B0;border-radius:13px;padding:11px 13px;')}>
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-good);")}>verified</span>
                  <div style={css('flex:1;font-weight:800;font-size:13px;color:var(--ag-good-text);')}>{appliedCoupon} applied</div>
                  <button onClick={removeCoupon} style={css('border:none;background:none;cursor:pointer;color:var(--ag-muted);font-size:12px;font-weight:700;')}>Remove</button>
                </div>
              )}

              <button onClick={() => navigate('/coupons', { state: { from: '/cart' } })} style={css('width:100%;margin-top:13px;display:flex;align-items:center;gap:10px;padding:12px 13px;border:1.5px dashed var(--ag-border);background:var(--ag-surface-2);border-radius:13px;cursor:pointer;text-align:left;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>confirmation_number</span>
                <span style={css('flex:1;font-weight:800;font-size:13px;color:var(--ag-crimson);')}>{coupon ? 'Change coupon' : 'View coupons & offers'}</span>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;")}>chevron_right</span>
              </button>

              <div style={css('display:flex;flex-direction:column;gap:11px;margin-top:18px;font-size:14px;')}>
                <div style={css('display:flex;justify-content:space-between;color:var(--ag-ink-2);')}><span>Subtotal</span><span style={css('font-weight:700;')}>{fmt(subtotal)}</span></div>
                {discount > 0 && (
                  <div style={css('display:flex;justify-content:space-between;color:var(--ag-good);')}><span>Coupon discount</span><span style={css('font-weight:800;')}>– {fmt(discount)}</span></div>
                )}
                <div style={css('display:flex;justify-content:space-between;color:var(--ag-ink-2);')}>
                  <span>Delivery{buyerPlace ? '' : ' (estimate)'}</span>
                  <span style={css('font-weight:800;color:var(--ag-good);')}>{shipFee === 0 ? 'FREE' : fmt(shipFee)}</span>
                </div>
                {/* Each shop charges by distance (migration 0077), so without a
                    pincode this is their furthest rate. It can only fall at
                    checkout, never rise — but say which it is. */}
                {!buyerPlace && (
                  <div style={css('font-size:11.5px;color:var(--ag-muted);font-weight:600;line-height:1.5;')}>
                    Delivery is priced by distance. The exact charge is confirmed once you enter your pincode at checkout.
                  </div>
                )}
                {undeliverable && (
                  <div style={css('font-size:11.5px;color:var(--ag-danger-text);font-weight:700;line-height:1.5;')}>{undeliverable}</div>
                )}
              </div>

              <div style={css('height:1px;background:var(--ag-surface-3);margin:16px 0;')} />
              <div style={css('display:flex;justify-content:space-between;align-items:baseline;')}>
                <span style={css('font-weight:800;')}>Total</span>
                <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:26px;")}>{fmt(total)}</span>
              </div>

              {/* Desktop only. Below 840px this card is no longer a sticky
                  sidebar, so its button would sit at the very bottom of the
                  page — the pinned bar at the end of this file carries the
                  action there instead. */}
              <button
                className="agx-cart-cta"
                onClick={goCheckout}
                disabled={authLoading}
                style={css(`width:100%;height:54px;margin-top:18px;border:none;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:${authLoading ? 'wait' : 'pointer'};opacity:${authLoading ? '.7' : '1'};display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);`)}
              >
                {checkoutLabel}
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>{signedIn || authLoading ? 'arrow_forward' : 'lock'}</span>
              </button>
              {!signedIn && !authLoading && (
                <div className="agx-cart-cta" style={css('text-align:center;font-size:12px;line-height:1.5;color:var(--ag-muted);font-weight:600;margin-top:10px;')}>
                  You need an account to place an order — it keeps your order history, tracking and returns in one place. Your bag is saved.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div style={css('text-align:center;padding:60px 20px;')}>
            <div style={css('width:88px;height:88px;margin:0 auto;border-radius:26px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:44px;color:#D6336C;")}>shopping_bag</span>
            </div>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;margin-top:20px;")}>Your bag is empty</div>
            <div style={css('color:var(--ag-muted);font-size:14px;margin-top:6px;')}>Discover beautiful pieces from India&apos;s finest boutiques.</div>
            <button onClick={() => navigate('/')} style={css('margin-top:22px;height:50px;padding:0 28px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer;')}>Start shopping</button>
          </div>
        )}
      </div>

      {/* The phone's checkout bar — pinned to the bottom edge, in the dock's
          place. It restates the total because on a phone the summary card is
          several screens up by the time the bag has more than a couple of
          pieces, and the number is the thing you check before you commit.
          CSS-hidden from 840px up, where the sidebar's own button is in view. */}
      {hasCart && (
        <div className="agx-cart-bar">
          {!signedIn && !authLoading && (
            <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12.5px;font-weight:700;color:var(--ag-ink-2);')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;color:var(--ag-crimson);")}>lock</span>
              <span style={css('flex:1;min-width:0;')}>Sign in to place this order — your bag is saved.</span>
            </div>
          )}
          <div className="agx-cart-bar-row" style={css('display:flex;align-items:center;gap:14px;')}>
            <div style={css('flex:none;')}>
              <div className="agx-eyebrow" style={css('font-size:9.5px;color:var(--ag-muted);')}>Total</div>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:22px;line-height:1.15;")}>{fmt(total)}</div>
            </div>
            <button
              onClick={goCheckout}
              disabled={authLoading}
              style={css(`flex:1;min-width:0;height:52px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:${authLoading ? 'wait' : 'pointer'};opacity:${authLoading ? '.7' : '1'};display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 14px 30px -16px rgba(214,51,108,.85);`)}
            >
              {checkoutLabel}
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>{signedIn || authLoading ? 'arrow_forward' : 'lock'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
