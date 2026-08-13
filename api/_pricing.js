/**
 * Server-side pricing — the single source of truth for what a cart costs.
 *
 * These rules MUST stay identical to the client's pricing (src/lib/pricing.ts,
 * used by src/state/ShopContext.tsx), because api/place-order.js re-derives the
 * amount here and asserts the Razorpay order was created (and paid) for exactly
 * this many paise. Any drift between this file and the client would reject
 * legitimate checkouts, so change both together.
 *
 * Coupons live in the `coupons` table (migration 0036), not a hardcoded list.
 * `loadCoupon` fetches the row by code; `computeCartPricing` applies it:
 *   • a PLATFORM coupon (boutique_id null) discounts the whole cart and is
 *     platform-funded — it is NOT allocated to any boutique's order.
 *   • a SELLER coupon (boutique_id set) discounts only that boutique's goods and
 *     is returned in `perBoutiqueDiscount` so place-order.js can store that one
 *     boutique's order `total` net of it (which is how the seller funds it).
 *
 * The leading underscore keeps this out of Vercel's /api routing — it is a
 * helper imported by create-order.js / place-order.js, not an endpoint.
 */

/**
 * Delivery and cash-on-delivery are the SELLER's terms (migration 0076), read
 * off the `boutiques` rows in the bag — not the admin-editable platform fees
 * they used to be. See the long note on `ShopTerms` in src/lib/pricing.ts for
 * why per-boutique changes the arithmetic; this file must mirror it exactly.
 *
 * `freeDeliveryOver: 0` means "never free", `codMaxOrder: 0` means "no cap", and
 * a boutique we could not read terms for charges nothing — the same fallback the
 * browser applies, which is what keeps the two totals equal on a deployment
 * where 0076 has not been applied yet.
 */
const DEFAULT_SHOP_TERMS = {
  rates: { local: 0, district: 0, state: 0, national: 0 },
  freeDeliveryOver: 0,
  codFee: 0,
  codMaxOrder: 0,
  place: {},
  name: '',
};

function termsFor(shops, id) {
  return shops?.[id] ?? DEFAULT_SHOP_TERMS;
}

/** Boutiques with something in the bag — one order, one parcel, one fee each. */
function shopsInBag(groupTotals) {
  return Object.keys(groupTotals).filter((id) => groupTotals[id] > 0);
}

/* ── Delivery zones ─────────────────────────────────────────────────────────
 * Mirror of src/lib/deliveryZone.ts and src/lib/nameMatch.ts. Delivery is
 * priced by how far the parcel goes (migration 0077), so the buyer's pincode
 * has to resolve to the same zone here as it did in the browser — otherwise a
 * correctly-quoted payment is rejected as the wrong amount. Change together.
 * ────────────────────────────────────────────────────────────────────────── */

const nameKeyOf = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '');

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const row = [i];
    for (let j = 1; j <= n; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[n];
}

function namesAgree(a, b) {
  const x = nameKeyOf(a);
  const y = nameKeyOf(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return Math.min(x.length, y.length) >= 6 && editDistance(x, y) <= 2;
}

/** Mirror of resolveZone(): widest test first, so a shop with a blank district
 *  or state falls back to its national rate rather than its local one. */
function zoneFor(place, buyer) {
  const shopPin = String(place?.pincode ?? '').replace(/\D/g, '');
  const buyerPin = String(buyer?.pincode ?? '').replace(/\D/g, '');
  if (shopPin.length === 6 && shopPin === buyerPin) return 'local';
  if (!namesAgree(place?.state, buyer?.state)) return 'national';
  if (!namesAgree(place?.district, buyer?.district)) return 'state';
  const town = place?.city ?? '';
  const covers = (buyer?.places ?? []).some((p) => namesAgree(town, p));
  return covers || namesAgree(town, buyer?.district) ? 'local' : 'district';
}

/** Mirror of zoneForShop(): no address yet means the furthest zone served. */
function zoneForShop(t, buyer) {
  if (buyer) return zoneFor(t.place, buyer);
  if (t.rates.national != null) return 'national';
  if (t.rates.state != null) return 'state';
  if (t.rates.district != null) return 'district';
  return 'local';
}

const rateForZone = (rates, zone) => (zone === 'local' ? rates.local : rates[zone]);
const zoneEarnsFreeDelivery = (zone) => zone === 'local' || zone === 'district';

/**
 * Where a delivery pincode is, from the shared `pincodes` directory that the
 * browser fills in (migration 0077).
 *
 * Reads the stored row and nothing else — no call out to India Post from inside
 * a checkout. If the row is missing, this returns null and every shop prices at
 * its furthest zone, which can only ever over-quote relative to the browser…
 * except that the browser would then have quoted lower, so `place-order` would
 * reject the payment. That is the right failure: it is loud, it is rare (the
 * browser writes the row while the buyer is still typing their address), and it
 * refuses money rather than taking the wrong amount.
 */
export async function loadBuyerPlace(supabase, pincode) {
  const code = String(pincode ?? '').replace(/\D/g, '');
  if (!supabase || !/^[1-9][0-9]{5}$/.test(code)) return null;
  try {
    const { data, error } = await supabase
      .from('pincodes')
      .select('pincode, district, state, places')
      .eq('pincode', code)
      .maybeSingle();
    if (error) {
      console.warn('loadBuyerPlace: pincode directory unavailable, apply migration 0077 —', error.message ?? error);
      return null;
    }
    if (!data || !data.district || !data.state) return null;
    return {
      pincode: data.pincode,
      district: data.district,
      state: data.state,
      places: Array.isArray(data.places) ? data.places : [],
    };
  } catch (e) {
    console.error('loadBuyerPlace threw:', e?.message ?? e);
    return null;
  }
}

/**
 * The delivery/COD terms of the boutiques in this bag, keyed by id.
 *
 * Two queries deep on purpose: naming a column that does not exist fails the
 * WHOLE select, so on a deployment without 0076 the first attempt errors and the
 * retry asks only for the columns that have always been there. The browser's
 * fallback (src/data/boutiques.ts) degrades to exactly the same numbers.
 *
 * Never throws — an unreadable boutique prices as "charges nothing", which can
 * only ever under-charge, never over-charge someone.
 */
export async function loadShopTerms(supabase, boutiqueIds) {
  const ids = [...new Set((boutiqueIds ?? []).filter(Boolean))];
  const shops = {};
  if (!supabase || ids.length === 0) return shops;

  // `full` says which optional column groups the SELECT actually got back: the
  // 0076 terms, and the 0077 zone rates. A missing group degrades to the same
  // numbers the browser degrades to (src/data/boutiques.ts), which is what keeps
  // the two totals equal on a part-migrated deployment.
  const build = (rows, full) => {
    for (const b of rows ?? []) {
      const local = Number(b.delivery_charge) || 0;
      const rate = (v) => (full.zones ? (v == null ? null : Number(v) || 0) : local);
      shops[b.id] = {
        rates: {
          local,
          district: rate(b.delivery_charge_district),
          state: rate(b.delivery_charge_state),
          national: rate(b.delivery_charge_national),
        },
        freeDeliveryOver: full.terms ? Number(b.free_delivery_over) || 0 : 0,
        codFee: full.terms ? Number(b.cod_fee) || 0 : 0,
        codMaxOrder: full.terms ? Number(b.cod_max_order) || 0 : 0,
        place: {
          pincode: b.pincode ?? '',
          city: b.city ?? '',
          district: b.district ?? '',
          state: b.state ?? '',
        },
        name: b.name ?? '',
      };
    }
  };

  const BASE = 'id, name, pincode, city, district, state, delivery_charge';
  const TERMS = 'free_delivery_over, cod_fee, cod_max_order';
  const ZONES = 'delivery_charge_district, delivery_charge_state, delivery_charge_national';

  try {
    const attempts = [
      { cols: `${BASE}, ${TERMS}, ${ZONES}`, full: { terms: true, zones: true }, note: null },
      { cols: `${BASE}, ${TERMS}`, full: { terms: true, zones: false }, note: 'zone rates unavailable — apply migration 0077' },
      { cols: BASE, full: { terms: false, zones: false }, note: 'seller terms unavailable — apply migration 0076' },
    ];
    for (const attempt of attempts) {
      const { data, error } = await supabase.from('boutiques').select(attempt.cols).in('id', ids);
      if (!error) {
        build(data, attempt.full);
        return shops;
      }
      console.warn(`loadShopTerms: ${attempt.note ?? error.message ?? error}`);
    }
    console.error('loadShopTerms failed: even the base columns could not be read');
    return shops;
  } catch (e) {
    console.error('loadShopTerms threw:', e?.message ?? e);
    return shops;
  }
}

// Mirror of shopShipFee() in src/lib/pricing.ts. Null = this shop does not
// deliver to that zone at all, which is not the same as delivering free.
function shopShipFee(subtotal, t, buyer) {
  if (subtotal <= 0) return 0;
  const zone = zoneForShop(t, buyer);
  const rate = rateForZone(t.rates, zone);
  if (rate == null) return null;
  if (t.freeDeliveryOver > 0 && subtotal >= t.freeDeliveryOver && zoneEarnsFreeDelivery(zone)) return 0;
  return rate;
}

// Mirror of baseShipFee(): each boutique ships its own parcel and charges for it.
function shipFeeFor(groupTotals, shops, buyer) {
  return shopsInBag(groupTotals).reduce(
    (sum, id) => sum + (shopShipFee(groupTotals[id], termsFor(shops, id), buyer) ?? 0),
    0,
  );
}

/**
 * Mirror of undeliverableReason(): the boutique in this bag that cannot reach
 * the address, or null. Returned as a name so place-order can say which shop.
 */
export function undeliverableShop(groupTotals, shops, buyer) {
  if (!buyer) return null;
  for (const id of shopsInBag(groupTotals)) {
    const t = termsFor(shops, id);
    if (rateForZone(t.rates, zoneFor(t.place, buyer)) == null) return t.name || 'One of the boutiques in your bag';
  }
  return null;
}

// Mirror of baseCodFee(): one cash-handling fee per boutique, i.e. per delivery.
function codFeeFor(groupTotals, shops) {
  return shopsInBag(groupTotals).reduce((sum, id) => sum + Math.max(0, termsFor(shops, id).codFee), 0);
}

/**
 * Fetch the coupon row for a code, or null. Only an active, unexpired coupon is
 * returned — the same filter the buyer app's active list uses — so an expired or
 * deactivated code simply prices as no coupon on both sides. Codes are stored
 * uppercased (unique on upper(code)), so an exact uppercased match is correct.
 *
 * Never throws: a lookup failure prices the cart without the coupon rather than
 * failing the whole checkout on a discount the buyer may not even have.
 */
export async function loadCoupon(supabase, code) {
  if (!supabase || !code) return null;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data, error } = await supabase
      .from('coupons')
      .select('id, code, boutique_id, type, off, min_subtotal, max_discount, usage_limit, used_count, expires_at, active')
      .eq('code', String(code).trim().toUpperCase())
      .eq('active', true)
      .gte('expires_at', today)
      .maybeSingle();
    if (error) {
      console.error('loadCoupon failed:', error?.message ?? error);
      return null;
    }
    if (!data) return null;
    // A code that has hit its redemption cap (migration 0049) prices as no
    // coupon, the same as an expired one. `redeemCoupon` below re-checks this
    // atomically at the moment the order is written — this is the cheap
    // pre-check so the buyer sees the right total rather than a late failure.
    const limit = data.usage_limit == null ? null : Number(data.usage_limit);
    if (limit != null && Number(data.used_count ?? 0) >= limit) return null;
    return {
      id: data.id,
      code: data.code,
      boutique_id: data.boutique_id ?? null,
      type: data.type,
      off: Number(data.off) || 0,
      min_subtotal: Number(data.min_subtotal) || 0,
      max_discount: data.max_discount == null ? null : Number(data.max_discount),
    };
  } catch (e) {
    console.error('loadCoupon threw:', e?.message ?? e);
    return null;
  }
}

/**
 * Atomically take one redemption of a code, returning false if the cap was
 * already reached. Backed by the `redeem_coupon` function in migration 0049, so
 * two checkouts racing for the last redemption cannot both win.
 *
 * A missing function (migration not yet applied) resolves to `true`: an
 * un-migrated deploy keeps behaving exactly as it did before rather than
 * refusing every coupon.
 */
export async function redeemCoupon(supabase, code) {
  if (!supabase || !code) return true;
  try {
    const { data, error } = await supabase.rpc('redeem_coupon', { p_code: String(code).trim().toUpperCase() });
    if (error) {
      console.error('redeemCoupon failed:', error?.message ?? error);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.error('redeemCoupon threw:', e?.message ?? e);
    return true;
  }
}

// The subtotal a coupon measures against: the owning boutique's goods for a
// seller coupon, the whole cart for a platform coupon.
function couponBase(coupon, cartSubtotal, groupTotals) {
  return coupon.boutique_id ? (groupTotals[coupon.boutique_id] ?? 0) : cartSubtotal;
}

// Mirror of isEligible() in src/lib/pricing.ts (expiry is already filtered out by
// loadCoupon; the min / in-the-bag checks are what remain).
function isEligible(coupon, cartSubtotal, groupTotals) {
  const base = couponBase(coupon, cartSubtotal, groupTotals);
  if (coupon.boutique_id && base <= 0) return false; // seller coupon, its shop not in the bag
  return base >= coupon.min_subtotal;
}

// Mirror of couponSavings() in src/lib/pricing.ts. `max_discount` is no longer
// settable from either console, but rows created while it was still carry it.
function couponSavings(coupon, cartSubtotal, groupTotals, shops, buyer) {
  if (!isEligible(coupon, cartSubtotal, groupTotals)) return 0;
  const base = couponBase(coupon, cartSubtotal, groupTotals);
  if (coupon.type === 'pct') {
    return Math.min(Math.round((base * coupon.off) / 100), coupon.max_discount ?? Infinity);
  }
  if (coupon.type === 'flat') return Math.min(coupon.off, base);
  return shipFeeFor(groupTotals, shops, buyer); // 'ship' — the delivery fee waived
}

/**
 * Given the DB-derived per-boutique goods totals (`{ boutiqueId: rupees }`) and
 * an optional coupon row, return the same figures the browser shows plus the
 * paise the payment must carry — using the exact same arithmetic as
 * src/lib/pricing.ts so the value matches to the rupee.
 *
 * `perBoutiqueDiscount` is the seller-funded portion to net off each boutique's
 * order total (empty for a platform coupon). `payingCash` says whether this is a
 * cash-on-delivery checkout, which is what adds each boutique's own handling
 * fee. `shops` comes from `loadShopTerms(supabase, ids)`; an empty map prices
 * delivery and COD at zero rather than at NaN. `buyer` is where the parcel is
 * going (`loadBuyerPlace`), which picks each shop's delivery zone — null prices
 * every shop at its furthest zone, exactly as the browser does.
 *
 * `perBoutiquePlatformDiscount` is the mirror of that for a PLATFORM coupon: it
 * is NOT netted off any order total (the platform funds it, so the seller is
 * still paid in full) but it IS what the buyer stops owing, so each order
 * records its share in `orders.platform_discount` (migration 0053). Without it
 * a cash-on-delivery buyer was quoted the discounted total at checkout and then
 * asked for the undiscounted one at the door.
 */
export function computeCartPricing(groupTotals, coupon, payingCash = false, shops = {}, buyer = null) {
  const cartSubtotal = Object.values(groupTotals).reduce((sum, v) => sum + v, 0);
  const eligible = coupon && isEligible(coupon, cartSubtotal, groupTotals) ? coupon : null;

  const freeShip = eligible?.type === 'ship';
  const discount = eligible && !freeShip ? couponSavings(eligible, cartSubtotal, groupTotals, shops, buyer) : 0;

  // Only a seller coupon's discount is allocated to a boutique (and so funded by
  // that seller). A platform coupon reduces the buyer's payment but no order.
  const perBoutiqueDiscount = {};
  if (eligible && eligible.boutique_id && discount > 0) {
    perBoutiqueDiscount[eligible.boutique_id] = discount;
  }

  // A platform coupon applies to the whole cart, so a bag spanning boutiques has
  // to share it out — proportionally to each boutique's goods, with the rounding
  // remainder on the largest so the shares add back up to `discount` exactly.
  const perBoutiquePlatformDiscount = {};
  if (eligible && !eligible.boutique_id && discount > 0 && cartSubtotal > 0) {
    const ids = Object.keys(groupTotals).sort((a, b) => groupTotals[b] - groupTotals[a]);
    let remaining = discount;
    for (const id of ids.slice(1)) {
      const share = Math.floor((discount * groupTotals[id]) / cartSubtotal);
      if (share > 0) perBoutiquePlatformDiscount[id] = share;
      remaining -= share;
    }
    if (ids.length > 0) perBoutiquePlatformDiscount[ids[0]] = remaining;
  }

  const shipFee = freeShip ? 0 : shipFeeFor(groupTotals, shops, buyer);
  const codFee = payingCash ? codFeeFor(groupTotals, shops) : 0;
  const total = Math.max(0, cartSubtotal - discount) + shipFee + codFee;

  // What each boutique's own order comes to — its goods, less whichever discount
  // was allocated to it, plus its own delivery and cash-handling fees. The
  // per-boutique COD cap is checked against this, and src/lib/pricing.ts derives
  // the identical map so the browser blocks (or allows) cash on exactly the same
  // bags the server does.
  const perBoutiquePayable = {};
  // Each boutique's own fees, so place-order.js can store them on that
  // boutique's order rather than piling the cart's delivery onto the first one
  // — with a per-shop charge, "the cart's delivery fee" is no longer a single
  // number that belongs to any one order.
  const perBoutiqueShipFee = {};
  const perBoutiqueCodFee = {};
  for (const id of shopsInBag(groupTotals)) {
    const t = termsFor(shops, id);
    const allocated = (perBoutiqueDiscount[id] ?? 0) + (perBoutiquePlatformDiscount[id] ?? 0);
    perBoutiqueShipFee[id] = freeShip ? 0 : (shopShipFee(groupTotals[id], t, buyer) ?? 0);
    perBoutiqueCodFee[id] = payingCash ? Math.max(0, t.codFee) : 0;
    perBoutiquePayable[id] = Math.max(
      0,
      groupTotals[id] - allocated + perBoutiqueShipFee[id] + perBoutiqueCodFee[id],
    );
  }

  return {
    cartSubtotal,
    discount,
    perBoutiqueDiscount,
    perBoutiquePlatformDiscount,
    perBoutiquePayable,
    perBoutiqueShipFee,
    perBoutiqueCodFee,
    shipFee,
    codFee,
    total,
    totalPaise: Math.round(total * 100),
  };
}
