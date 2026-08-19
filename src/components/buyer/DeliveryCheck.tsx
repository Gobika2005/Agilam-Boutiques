import { useEffect, useState } from 'react';
import { css } from '@/lib/css';
import { fmt } from '@/data/demo';
import { useShop } from '@/state/ShopContext';
import { PINCODE_RE } from '@/lib/pincode';
import { rateForZone, resolveZone, zoneEarnsFreeDelivery, zoneLabel, type ShopPlace, type ZoneRates } from '@/lib/deliveryZone';

/**
 * "Deliver to ______" — what this shop charges to send a parcel to you.
 *
 * Delivery is priced by distance since migration 0077, so there is no single
 * number a product page can print: the same piece is ₹30 to the next street and
 * ₹150 to another state. The options were to show the cheapest ("from ₹30",
 * which becomes a larger number at the payment screen — the moment carts are
 * abandoned), the dearest (which makes every nearby buyer overestimate), or to
 * ask. Asking is what every Indian marketplace does, so buyers already expect
 * the box, and it is the only one of the three that is never wrong.
 *
 * The answer is kept for the session and across visits (`deliveryPincode` in
 * ShopContext), so it is asked once and the cart, checkout and payment screens
 * all price from it. The checkout address overrides it once entered — that is
 * the address the parcel actually goes to.
 */

export function DeliveryCheck({
  rates, place, freeDeliveryOver, boutiqueName,
}: {
  rates: ZoneRates;
  /** The shop's own address — what the buyer's is measured against. */
  place: ShopPlace;
  freeDeliveryOver: number;
  boutiqueName?: string;
}) {
  const { deliveryPincode, setDeliveryPincode, buyerPlace } = useShop();
  const [typed, setTyped] = useState(deliveryPincode);

  // Follow the shared value when another screen changes it (the checkout
  // address, or this same box on a different product).
  useEffect(() => { setTyped(deliveryPincode); }, [deliveryPincode]);

  const complete = PINCODE_RE.test(typed);
  const showing = complete && buyerPlace?.pincode === typed ? buyerPlace : null;
  // Typed six digits but no resolved place yet: either still loading, or a
  // pincode India Post does not know. Both read as "checking" for a moment.
  const checking = complete && !showing;

  const zone = showing ? resolveZone(place, showing) : null;
  const rate = zone ? rateForZone(rates, zone) : null;
  const freeHere = zone != null && freeDeliveryOver > 0 && zoneEarnsFreeDelivery(zone);

  const line = 'font-size:12.5px;font-weight:700;margin-top:8px;line-height:1.55;';

  return (
    <div style={css('margin-top:14px;padding:14px;border:1px solid var(--ag-surface-3);border-radius:16px;background:var(--ag-surface);')}>
      <label style={css('display:block;font-size:12px;font-weight:800;color:var(--ag-label);letter-spacing:.02em;')}>
        Deliver to
      </label>
      <div style={css('display:flex;gap:8px;margin-top:7px;')}>
        <input
          value={typed}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6);
            setTyped(v);
            // Commit as soon as it is a whole pincode; no button to hunt for,
            // and a half-typed one never re-prices the page.
            if (PINCODE_RE.test(v)) setDeliveryPincode(v);
          }}
          placeholder="6-digit pincode"
          inputMode="numeric"
          autoComplete="postal-code"
          aria-label="Delivery pincode"
          style={css('flex:1;min-width:0;border:1.5px solid var(--ag-border);background:var(--ag-surface-2);border-radius:12px;padding:0 13px;height:44px;font-size:14px;font-weight:700;letter-spacing:.06em;color:var(--ag-ink);box-sizing:border-box;font-family:inherit;')}
        />
        {typed && (
          <button
            type="button"
            onClick={() => { setTyped(''); setDeliveryPincode(''); }}
            style={css('flex:none;padding:0 14px;height:44px;border-radius:12px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-muted);font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;')}
          >
            Change
          </button>
        )}
      </div>

      {!typed && (
        <div style={css(line + 'color:var(--ag-muted);font-weight:600;')}>
          Delivery is priced by distance — enter your pincode to see the exact charge.
        </div>
      )}
      {checking && <div style={css(line + 'color:var(--ag-muted);')}>Checking…</div>}

      {showing && rate == null && (
        <div style={css(line + 'color:var(--ag-danger-text);')}>
          {boutiqueName ?? 'This boutique'} does not deliver to {showing.district || showing.pincode}.
        </div>
      )}
      {showing && rate != null && (
        <div style={css(line + 'color:var(--ag-good);')}>
          {rate === 0 ? 'Free delivery' : `Delivery ${fmt(rate)}`}
          <span style={css('color:var(--ag-muted);font-weight:600;')}>
            {' · '}{showing.district ? `${showing.district}, ${showing.state}` : showing.pincode}
            {zone ? ` · ${zoneLabel(zone, place).toLowerCase()}` : ''}
          </span>
          {freeHere && rate > 0 && (
            <div style={css('color:var(--ag-muted);font-weight:600;font-size:11.5px;margin-top:3px;')}>
              Free on orders from this boutique over {fmt(freeDeliveryOver)}.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
