import { useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { useShop } from '@/state/ShopContext';
import { hasDeliveryDetails } from '@/lib/buyerDetails';
import { payWithRazorpay } from '@/lib/razorpay';
import { readPendingPayment, clearPendingPayment } from '@/lib/pendingPayment';
import { useSettings } from '@/data/settings';
import { PAY_METHODS, fmt } from '@/data/demo';

export function Payment() {
  usePageMeta({ title: 'Payment', description: 'Choose how to pay for your MangaiMart order.' });
  const navigate = useNavigate();
  const terms = useSettings();
  const {
    payMethod, setPayMethod, subtotal, discount, shipFee, codFee, total,
    guest, orderItems, appliedCoupon, coupon,
    placeOrder, placeCodOrder, retryPendingPayment, showToast,
    payingCash, codUnavailableReason, codDeliveries,
    cart,
  } = useShop();
  // Same guard as checkout: an empty bag has nothing to pay for, and a step-3
  // screen quoting ₹0 is only a slower way of saying so.
  const bagIsEmpty = Object.keys(cart).length === 0;
  const [processing, setProcessing] = useState(false);
  // `processing` disables the button, but React re-renders asynchronously, so a
  // same-frame double-tap can fire onPlaceOrder twice before the DOM updates.
  // A synchronous ref closes that window — critical for COD, which has no
  // payment_id replay guard server-side and would otherwise write two orders.
  const inFlight = useRef(false);
  // A payment that was captured but never became an order (dropped connection,
  // server hiccup, closed tab). Read once on mount so the buyer is offered the
  // free retry instead of being asked to pay a second time.
  const [pending, setPending] = useState(() => readPendingPayment());

  const onPlaceOrder = async () => {
    if (inFlight.current) return;
    if (total < 1) {
      showToast('Your bag is empty', 'error');
      return;
    }
    // Safety net if the buyer deep-linked past the checkout gate.
    if (!hasDeliveryDetails(guest)) {
      showToast('Please add your delivery details first', 'error');
      navigate('/buyer/checkout');
      return;
    }

    inFlight.current = true;
    setProcessing(true);
    try {
      if (payingCash) {
        // No gateway involved: the order is written unpaid and the money is
        // counted at the door. Nothing can be stranded, so there is no pending
        // payment to recover from if this fails.
        await placeCodOrder();
        navigate('/buyer/order-confirmation');
        return;
      }

      // Prepaid: the gateway settles first, then we record the order
      // server-side with the verified payment.
      const payment = await payWithRazorpay({
        items: orderItems,
        couponCode: appliedCoupon,
        amountPaise: Math.round(total * 100),
        name: 'MangaiMart',
        description: 'Order payment',
        prefill: { name: guest.name, contact: guest.phone },
      });

      await placeOrder({
        razorpay_order_id: payment.orderId,
        razorpay_payment_id: payment.paymentId,
        razorpay_signature: payment.signature,
      });
      navigate('/buyer/order-confirmation');
    } catch (err) {
      const msg = err instanceof Error ? err.message : payingCash ? 'Could not place the order' : 'Payment failed';
      // If the money left the buyer's account but the order didn't land, say so
      // plainly and show the retry — "Payment failed" would be a lie that sends
      // them to pay twice.
      const stranded = payingCash ? null : readPendingPayment();
      setPending(stranded);
      showToast(stranded ? `${msg} Your payment is safe — tap Complete my order.` : msg, 'error');
    } finally {
      setProcessing(false);
      inFlight.current = false;
    }
  };

  const onCompletePending = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setProcessing(true);
    try {
      await retryPendingPayment();
      setPending(null);
      navigate('/buyer/order-confirmation');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not complete the order';
      // `retryPendingPayment` clears the record when the payment turns out to
      // have already been used, so re-read rather than assuming it survived.
      const still = readPendingPayment();
      setPending(still);
      if (!still) navigate('/buyer/orders');
      showToast(msg, 'error');
    } finally {
      setProcessing(false);
      inFlight.current = false;
    }
  };

  const openCoupons = () => navigate('/buyer/coupons', { state: { from: '/buyer/payment' } });

  const onDismissPending = () => {
    clearPendingPayment();
    setPending(null);
    // Razorpay's webhook flags a captured-but-unfulfilled payment for an
    // operator; it is not refunded automatically, so don't promise that it is.
    showToast('Dismissed. Contact support with your payment reference for a refund.');
  };

  // A stranded payment still needs this screen even with an empty bag — that is
  // exactly the state after the bag was cleared but the order never landed.
  if (bagIsEmpty && !pending) return <Navigate to="/buyer/cart" replace />;

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('max-width:980px;margin:0 auto;')}>
        <div style={css('padding:4px 0 2px;')}>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Step 3 of 3 · Payment</div>
          <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(28px,3vw,40px);line-height:1.05;margin:4px 0 0;")}>How would you like to pay?</h1>
        </div>

        {pending && (
          <div style={css('margin-top:16px;background:var(--ag-gold-bg);border:1.5px solid var(--ag-gold-border);border-radius:18px;padding:16px;display:flex;gap:13px;align-items:flex-start;')}>
            <span style={css("font-family:'Material Symbols Outlined';color:#C99A3F;font-size:24px;")}>error</span>
            <div style={css('flex:1;min-width:0;')}>
              <div style={css('font-weight:800;font-size:14.5px;')}>We received your {fmt(pending.total)} payment</div>
              <div style={css('color:#7A6450;font-size:12.5px;margin-top:3px;line-height:1.5;')}>
                Your last order didn’t finish saving. Tap below to complete it — you won’t be charged again.
              </div>
              <div style={css('display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;')}>
                <button onClick={onCompletePending} disabled={processing} style={css(`height:44px;padding:0 18px;border:none;border-radius:13px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13.5px;cursor:${processing ? 'wait' : 'pointer'};opacity:${processing ? '.7' : '1'};`)}>
                  {processing ? 'Completing…' : 'Complete my order'}
                </button>
                <button onClick={onDismissPending} disabled={processing} style={css('height:44px;padding:0 14px;border:none;background:none;color:var(--ag-muted);font-weight:800;font-size:13px;cursor:pointer;')}>
                  Not now
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="agx-cart-grid" style={css('display:grid;gap:22px;align-items:start;margin-top:18px;')}>
          <div style={css('display:flex;flex-direction:column;gap:12px;')}>
            {PAY_METHODS.map((m) => {
              const on = payMethod === m.key;
              // Cash is offered only when the whole bag qualifies. Showing it
              // greyed out with the reason beats hiding it, which just leaves
              // the buyer wondering where COD went.
              const blocked = m.kind === 'cod' ? codUnavailableReason : null;
              return (
                <div
                  key={m.key}
                  onClick={() => !blocked && setPayMethod(m.key)}
                  style={css(`display:flex;align-items:center;gap:13px;padding:15px 16px;border-radius:16px;cursor:${blocked ? 'default' : 'pointer'};border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};opacity:${blocked ? 0.55 : 1};`)}
                >
                  <span style={css(`width:46px;height:46px;flex:none;border-radius:13px;background:${on ? '#D6336C' : 'var(--ag-surface-2)'};display:flex;align-items:center;justify-content:center;`)}>
                    <span style={css(`font-family:'Material Symbols Outlined';color:${on ? '#fff' : '#D6336C'};`)}>{m.icon}</span>
                  </span>
                  <div style={css('flex:1;min-width:0;')}>
                    <div style={css('font-weight:800;font-size:14.5px;')}>{m.label}</div>
                    <div style={css('color:var(--ag-muted);font-size:12.5px;margin-top:2px;line-height:1.45;')}>
                      {blocked ?? (m.kind === 'cod' && codDeliveries > 1
                        ? `${m.sub} · ${fmt(terms.cod_fee)} handling fee × ${codDeliveries} deliveries`
                        : m.kind === 'cod'
                          ? `${m.sub} · ${fmt(terms.cod_fee)} handling fee`
                          : m.sub)}
                    </div>
                  </div>
                  {!blocked && (
                    <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;")}>{on ? 'radio_button_checked' : 'radio_button_unchecked'}</span>
                  )}
                </div>
              );
            })}
            <div style={css('display:flex;align-items:center;gap:9px;margin-top:6px;color:var(--ag-muted);font-size:12.5px;')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:18px;color:var(--ag-good);")}>lock</span>
              {payingCash ? 'Keep the exact amount ready — our partner may not carry change.' : '100% secure payments · encrypted end-to-end'}
            </div>
          </div>

          <div className="agx-cart-sticky" style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;padding:20px;box-shadow:0 20px 44px -30px rgba(107,20,54,.55);position:sticky;top:80px;')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Order total</div>
            {/* Coupons are worth one last offer here: this is the screen where
                the buyer is looking hardest at the number they're about to pay. */}
            {coupon ? (
              <div style={css('display:flex;align-items:center;gap:10px;margin-top:15px;background:var(--ag-good-bg);border:1px dashed #9BD3B0;border-radius:13px;padding:11px 13px;')}>
                <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-good);")}>verified</span>
                <div style={css('flex:1;min-width:0;font-weight:800;font-size:13px;color:var(--ag-good-text);')}>{coupon.code} applied</div>
                <button onClick={openCoupons} style={css('border:none;background:none;cursor:pointer;color:#4B7A61;font-size:12px;font-weight:800;')}>Change</button>
              </div>
            ) : (
              <button onClick={openCoupons} style={css('width:100%;margin-top:15px;display:flex;align-items:center;gap:10px;padding:12px 13px;border:1.5px dashed var(--ag-border);background:var(--ag-surface-2);border-radius:13px;cursor:pointer;text-align:left;')}>
                <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>confirmation_number</span>
                <span style={css('flex:1;font-weight:800;font-size:13px;color:var(--ag-crimson);')}>Have a coupon?</span>
                <span style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;")}>chevron_right</span>
              </button>
            )}

            <div style={css('display:flex;flex-direction:column;gap:11px;margin-top:16px;font-size:14px;')}>
              <div style={css('display:flex;justify-content:space-between;color:var(--ag-ink-2);')}><span>Subtotal</span><span style={css('font-weight:700;')}>{fmt(subtotal)}</span></div>
              {discount > 0 && (
                <div style={css('display:flex;justify-content:space-between;color:var(--ag-good);')}><span>Discount</span><span style={css('font-weight:800;')}>– {fmt(discount)}</span></div>
              )}
              <div style={css('display:flex;justify-content:space-between;color:var(--ag-ink-2);')}><span>Delivery</span><span style={css('font-weight:800;color:var(--ag-good);')}>{shipFee === 0 ? 'FREE' : fmt(shipFee)}</span></div>
              {codFee > 0 && (
                <div style={css('display:flex;justify-content:space-between;color:var(--ag-ink-2);')}>
                  <span>Cash handling{codDeliveries > 1 ? ` (${codDeliveries} deliveries)` : ''}</span>
                  <span style={css('font-weight:700;')}>{fmt(codFee)}</span>
                </div>
              )}
            </div>
            <div style={css('height:1px;background:var(--ag-surface-3);margin:16px 0;')} />
            <div style={css('display:flex;justify-content:space-between;align-items:baseline;')}>
              <span style={css('font-weight:800;')}>{payingCash ? 'Pay on delivery' : 'To pay'}</span>
              <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:26px;")}>{fmt(total)}</span>
            </div>
            {payingCash && codDeliveries > 1 && (
              <div style={css('margin-top:8px;font-size:12px;color:var(--ag-muted);line-height:1.5;')}>
                Your bag comes from {codDeliveries} boutiques, so it arrives as {codDeliveries} separate deliveries — you pay each one on arrival.
              </div>
            )}
            <button onClick={onPlaceOrder} disabled={processing} style={css(`width:100%;height:54px;margin-top:18px;border:none;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:${processing ? 'wait' : 'pointer'};opacity:${processing ? '.7' : '1'};display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);`)}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>{payingCash ? 'local_shipping' : 'lock'}</span>
              {processing ? 'Processing…' : payingCash ? 'Place order' : `Pay ${fmt(total)}`}
            </button>
            <button onClick={() => navigate('/buyer/checkout')} style={css('width:100%;height:44px;margin-top:9px;border:none;background:none;cursor:pointer;color:var(--ag-muted);font-weight:800;font-size:13px;')}>Back to delivery</button>
          </div>
        </div>
      </div>
    </div>
  );
}
