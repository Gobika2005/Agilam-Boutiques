import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PAY_METHODS } from '@/data/demo';
import { computeTotals, codBlockedReason, findCoupon } from '@/lib/pricing';
import { fetchActiveCoupons, type CouponRow } from '@/data/coupons';
import { useCatalog } from '@/state/CatalogContext';
import { useAuth } from '@/auth/AuthContext';
import { EMPTY_GUEST, readGuest, writeGuest, hasContactDetails } from '@/lib/buyerDetails';
import { addOrders, type PlacedOrder, type PlacedOrderItem } from '@/lib/orderHistory';
import {
  savePendingPayment,
  readPendingPayment,
  clearPendingPayment,
  type PendingOrderItem,
} from '@/lib/pendingPayment';
import {
  readLocalCart,
  writeLocalCart,
  readLocalWishlist,
  writeLocalWishlist,
  readLocalFollows,
  writeLocalFollows,
  clearLocalCollections,
} from '@/lib/buyerLocal';
import { clearLocalFeedInteractions } from '@/lib/feedLocal';
import {
  loadCollections,
  mergeGuestCollections,
  dbUpsertCartItem,
  dbRemoveCartItem,
  dbClearCart,
  dbAddWishlist,
  dbRemoveWishlist,
  dbAddFollow,
  dbRemoveFollow,
} from '@/data/buyerCollections';
import { supabase } from '@/lib/supabase';

/**
 * Cross-screen shop state, mirroring the `state` object of the design's
 * single-file component (cart, wishlist, filters, coupon, payment method).
 * The design drives everything from one component; here the screens are
 * routed, so the shared slice lives in this context instead.
 */

export type Filters = {
  maxPrice: number;
  cats: string[];
  colors: string[];
  occasions: string[];
  sizes: string[];
  sort: string;
};

export type CartLine = { qty: number; size: string };
export type Cart = Record<string, CartLine>;

export type Guest = { name: string; phone: string; city: string; address: string; pincode: string };
export type PaymentInfo = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export const DEFAULT_FILTERS: Filters = { maxPrice: 10000, cats: [], colors: [], occasions: [], sizes: [], sort: 'Latest' };

// Buyers browse anonymously — their details start empty and are captured (and
// persisted) the first time they chat or check out. See `@/lib/buyerDetails`.
export const DEFAULT_GUEST: Guest = EMPTY_GUEST;

type ShopValue = {
  wishlist: Record<string, boolean>;
  toggleWish: (id: string) => void;

  /** Boutiques the buyer follows. Persisted to their account when signed in. */
  follows: Record<string, boolean>;
  isFollowing: (boutiqueId: string) => boolean;
  toggleFollow: (boutiqueId: string) => boolean;

  cart: Cart;
  cartCount: number;
  addToCart: (id: string, size?: string) => void;
  buyNow: (id: string) => void;
  cartQty: (id: string, delta: number) => void;
  setCartSize: (id: string, size: string) => void;
  removeCart: (id: string) => void;
  clearCart: () => void;

  filters: Filters;
  setFilters: (next: Filters) => void;
  toggleFilter: (group: 'cats' | 'colors' | 'occasions' | 'sizes', value: string) => void;
  setSort: (v: string) => void;
  setMaxPrice: (v: number) => void;
  resetFilters: () => void;

  query: string;
  setQuery: (q: string) => void;

  appliedCoupon: string | null;
  applyCoupon: (code: string) => void;
  removeCoupon: () => void;
  /** Active coupons (platform + all sellers') the buyer can browse / type. */
  coupons: CouponRow[];
  /** Goods value in the bag per boutique — a seller coupon measures against its
   *  own boutique's slice, so the coupon screen needs this to preview savings. */
  boutiqueSubtotals: Record<string, number>;

  /**
   * The cart as the server-priced order payload — product ids + quantities +
   * size. Sent to /api/create-order so the Razorpay amount is derived from
   * DB prices, not the browser's totals.
   */
  orderItems: { product_id: string; qty: number; size: string }[];

  payMethod: string;
  setPayMethod: (m: string) => void;

  guest: Guest;
  setGuest: (patch: Partial<Guest>) => void;
  /** Clears guest details and resets to empty state. */
  clearGuest: () => void;
  /** True once the buyer has saved a valid name + phone. */
  hasBuyerDetails: boolean;

  lastOrderId: string;
  /**
   * Creates the real prepaid order(s) server-side (one per boutique) and returns
   * the primary order number, taking the verified Razorpay payment. Throws with
   * a user-facing message on failure.
   */
  placeOrder: (payment: PaymentInfo) => Promise<string>;
  /**
   * Creates the same order(s) with no payment behind them, to be settled in cash
   * at the door. Throws if the bag isn't COD-eligible.
   */
  placeCodOrder: () => Promise<string>;
  /**
   * Completes an order whose payment was captured but never settled (see
   * `@/lib/pendingPayment`). Replays the stored payment — it never re-charges.
   */
  retryPendingPayment: () => Promise<string>;

  toast: string | null;
  showToast: (msg: string) => void;

  sellModal: boolean;
  openSellModal: () => void;
  closeSellModal: () => void;

  /** Totals derived from the cart, matching the design's pricing rules. */
  subtotal: number;
  discount: number;
  shipFee: number;
  /** COD handling fee across the bag; 0 unless paying cash. */
  codFee: number;
  total: number;
  coupon: CouponRow | undefined;

  /** True when the buyer has chosen cash on delivery. */
  payingCash: boolean;
  /** Why cash isn't offered on this bag, or null when it is available. */
  codUnavailableReason: string | null;
  /** How many separate deliveries (and cash collections) this bag becomes. */
  codDeliveries: number;
};

const ShopContext = createContext<ShopValue | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const { productById, boutiques } = useCatalog();
  const { session } = useAuth();
  const signedIn = !!session;

  // Collections are seeded from local storage so guests keep their bag / saved
  // items / follows across refreshes. On sign-in they're merged up into the
  // account and reloaded from the DB, which then becomes the source of truth
  // (see the account-sync effect below).
  const [wishlist, setWishlist] = useState<Record<string, boolean>>(() => readLocalWishlist());
  const [cart, setCart] = useState<Cart>(() => readLocalCart());
  const [follows, setFollows] = useState<Record<string, boolean>>(() => readLocalFollows());
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [query, setQuery] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [payMethod, setPayMethod] = useState(PAY_METHODS[0].key);
  const [guest, setGuestState] = useState<Guest>(() => readGuest());
  // Empty until this session actually places an order — the confirmation screen
  // uses it to tell a real completion apart from someone landing on the URL.
  const [lastOrderId, setLastOrderId] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [sellModal, setSellModal] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }, []);

  // The signed-in buyer's id, or null for a guest. Held in a ref so the
  // (stable) mutators below can decide at call time whether to write through to
  // the account without being re-created when the session changes.
  const buyerIdRef = useRef<string | null>(session?.user?.id ?? null);
  useEffect(() => {
    buyerIdRef.current = session?.user?.id ?? null;
  }, [session]);

  // Run an account write-through, fire-and-forget. Local state is already
  // updated optimistically; a failure only surfaces a toast (the change is kept
  // locally and re-synced on the next sign-in), so the UI never blocks on the DB.
  const pushToAccount = useCallback((op: () => Promise<unknown>) => {
    if (!buyerIdRef.current) return;
    op().catch(() => showToast("Couldn't sync — will retry when you're back online"));
  }, [showToast]);

  const toggleWish = useCallback((id: string) => {
    setWishlist((w) => {
      const next = { ...w };
      const nowSaved = !next[id];
      if (nowSaved) next[id] = true;
      else delete next[id];
      const uid = buyerIdRef.current;
      if (uid) pushToAccount(() => (nowSaved ? dbAddWishlist(uid, id) : dbRemoveWishlist(uid, id)));
      return next;
    });
  }, [pushToAccount]);

  // `size` comes from screens that let the buyer pick one (the product page);
  // grid cards omit it and keep whatever the line already had.
  const addToCart = useCallback((id: string, size?: string) => {
    setCart((c) => {
      const line = { qty: (c[id]?.qty ?? 0) + 1, size: size ?? c[id]?.size ?? 'M' };
      const uid = buyerIdRef.current;
      if (uid) pushToAccount(() => dbUpsertCartItem(uid, id, line.qty, line.size));
      return { ...c, [id]: line };
    });
    showToast('Added to cart');
  }, [showToast, pushToAccount]);

  const buyNow = useCallback((id: string) => {
    setCart((c) => {
      if (c[id]) return c;
      const line = { qty: 1, size: 'M' };
      const uid = buyerIdRef.current;
      if (uid) pushToAccount(() => dbUpsertCartItem(uid, id, line.qty, line.size));
      return { ...c, [id]: line };
    });
  }, [pushToAccount]);

  const cartQty = useCallback((id: string, delta: number) => {
    setCart((c) => {
      const line = c[id];
      if (!line) return c;
      const qty = line.qty + delta;
      const next = { ...c };
      const uid = buyerIdRef.current;
      if (qty <= 0) {
        delete next[id];
        if (uid) pushToAccount(() => dbRemoveCartItem(uid, id));
      } else {
        next[id] = { ...line, qty };
        if (uid) pushToAccount(() => dbUpsertCartItem(uid, id, qty, line.size));
      }
      return next;
    });
  }, [pushToAccount]);

  const setCartSize = useCallback((id: string, size: string) => {
    setCart((c) => {
      if (!c[id]) return c;
      const uid = buyerIdRef.current;
      if (uid) pushToAccount(() => dbUpsertCartItem(uid, id, c[id].qty, size));
      return { ...c, [id]: { ...c[id], size } };
    });
  }, [pushToAccount]);

  const removeCart = useCallback((id: string) => {
    setCart((c) => {
      const next = { ...c };
      delete next[id];
      const uid = buyerIdRef.current;
      if (uid) pushToAccount(() => dbRemoveCartItem(uid, id));
      return next;
    });
    showToast('Removed from cart');
  }, [showToast, pushToAccount]);

  const clearCart = useCallback(() => {
    setCart({});
    const uid = buyerIdRef.current;
    if (uid) pushToAccount(() => dbClearCart(uid));
  }, [pushToAccount]);

  const isFollowing = useCallback((boutiqueId: string) => !!follows[boutiqueId], [follows]);

  const toggleFollow = useCallback((boutiqueId: string): boolean => {
    const next = !follows[boutiqueId];
    setFollows((f) => {
      const m = { ...f };
      if (next) m[boutiqueId] = true;
      else delete m[boutiqueId];
      return m;
    });
    const uid = buyerIdRef.current;
    if (uid) pushToAccount(() => (next ? dbAddFollow(uid, boutiqueId) : dbRemoveFollow(uid, boutiqueId)));
    return next;
  }, [follows, pushToAccount]);

  // Guest durability: while browsing without an account, mirror every change to
  // local storage so a refresh keeps the bag / saved items / follows. When
  // signed in the account is the source of truth (write-through above), so we
  // skip local writes to avoid leaking one account's data onto the device.
  useEffect(() => { if (!signedIn) writeLocalCart(cart); }, [cart, signedIn]);
  useEffect(() => { if (!signedIn) writeLocalWishlist(wishlist); }, [wishlist, signedIn]);
  useEffect(() => { if (!signedIn) writeLocalFollows(follows); }, [follows, signedIn]);

  // Account sync on sign-in / sign-out.
  //  • Sign-in: merge whatever the guest built locally up into the account,
  //    then reload all three collections from the DB (source of truth) and
  //    clear the local copy.
  //  • Sign-out: drop the in-memory + local collections so the next person on
  //    this device starts clean (their data is safe on their account).
  const prevUidRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = session?.user?.id ?? null;
    if (uid) {
      let active = true;
      (async () => {
        const local = { cart: readLocalCart(), wishlist: readLocalWishlist(), follows: readLocalFollows() };
        try {
          await mergeGuestCollections(uid, local);
        } catch {
          /* merge is best-effort; still load what the account has */
        }
        const loaded = await loadCollections(uid);
        if (!active) return;
        setCart(loaded.cart);
        setWishlist(loaded.wishlist);
        setFollows(loaded.follows);
        clearLocalCollections();
      })().catch(() => {
        /* offline / RLS lag — keep whatever's on screen */
      });
      prevUidRef.current = uid;
      return () => { active = false; };
    }
    // uid is null: only wipe if we were previously signed in (a real logout).
    // A first-load guest keeps the collections seeded from local storage.
    if (prevUidRef.current) {
      prevUidRef.current = null;
      setCart({});
      setWishlist({});
      setFollows({});
      clearLocalCollections();
      // Feed likes/saves are per-buyer too — leaving them would show the next
      // person on this device the previous account's hearts.
      clearLocalFeedInteractions();
    }
  }, [session?.user?.id]);

  const toggleFilter = useCallback((group: 'cats' | 'colors' | 'occasions' | 'sizes', value: string) => {
    setFilters((f) => {
      const arr = f[group];
      return { ...f, [group]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value] };
    });
  }, []);

  const setSort = useCallback((v: string) => setFilters((f) => ({ ...f, sort: v })), []);
  const setMaxPrice = useCallback((v: number) => setFilters((f) => ({ ...f, maxPrice: v })), []);
  const resetFilters = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  // Validation and the confirmation message live on the coupon screen, which
  // knows the bag's subtotal and what the code is worth on it.
  const applyCoupon = useCallback((code: string) => setAppliedCoupon(code), []);

  const removeCoupon = useCallback(() => setAppliedCoupon(null), []);

  // Load the live coupon list once. Best-effort: a failure just leaves the buyer
  // with no offers to browse (they can still checkout), and the server re-derives
  // any typed code independently, so this never blocks a purchase.
  useEffect(() => {
    let active = true;
    fetchActiveCoupons()
      .then((list) => { if (active) setCoupons(list); })
      .catch(() => { /* offline / RLS lag — no offers shown */ });
    return () => { active = false; };
  }, []);

  const cartCount = useMemo(
    () => Object.values(cart).reduce((a, l) => a + l.qty, 0),
    [cart],
  );

  const subtotal = useMemo(
    () => Object.entries(cart).reduce((sum, [id, line]) => {
      const p = productById(id);
      return sum + (p ? p.price * line.qty : 0);
    }, 0),
    [cart, productById],
  );

  // Goods value per boutique in the bag, keyed by the same boutique id the server
  // groups orders on (see place-order.js). This is what lets a seller coupon
  // price against just its own boutique's slice, matching the server exactly.
  const boutiqueSubtotals = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [id, line] of Object.entries(cart)) {
      const p = productById(id);
      if (!p) continue;
      const bid = p.boutiqueId ?? boutiques.find((x) => x.name === p.boutique)?.id;
      if (!bid) continue;
      map[bid] = (map[bid] ?? 0) + p.price * line.qty;
    }
    return map;
  }, [cart, productById, boutiques]);

  /**
   * The boutiques this bag will split into — one order, and one cash
   * collection, per boutique. Also tells us whether every one of them accepts
   * cash, since a single opt-out disqualifies the whole bag.
   */
  const cartBoutiques = useMemo(() => {
    const ids = new Set<string>();
    let allAcceptCod = true;
    for (const id of Object.keys(cart)) {
      const p = productById(id);
      if (!p) continue;
      // Resolve by boutique id (unique); fall back to the display name only for
      // legacy records that predate boutiqueId. Two shops can share a name, so
      // the id path is what keeps COD splitting attached to the right boutique.
      const b = p.boutiqueId
        ? boutiques.find((x) => x.id === p.boutiqueId)
        : boutiques.find((x) => x.name === p.boutique);
      if (!b) continue;
      ids.add(b.id);
      if (b.codEnabled === false) allAcceptCod = false;
    }
    return { deliveries: ids.size, allAcceptCod };
  }, [cart, productById, boutiques]);

  const payingCash = payMethod === 'cod';

  // The applied code resolved to the coupon row that actually qualifies on this
  // bag (per-boutique aware), or undefined. Shared by the totals and the COD gate
  // so both price the identical discount.
  const coupon = useMemo(
    () => findCoupon(coupons, appliedCoupon, subtotal, boutiqueSubtotals),
    [coupons, appliedCoupon, subtotal, boutiqueSubtotals],
  );

  /** Why cash isn't offered on this bag, or null when it is. */
  const codUnavailableReason = useMemo(
    () => codBlockedReason(subtotal, boutiqueSubtotals, coupon, cartBoutiques.allAcceptCod),
    [subtotal, boutiqueSubtotals, coupon, cartBoutiques.allAcceptCod],
  );

  // Adding one more item can push a bag past the COD cap. Silently leaving
  // "Cash on Delivery" selected would then show a total including the handling
  // fee for a method the buyer can no longer use, so fall back to online.
  useEffect(() => {
    if (payMethod === 'cod' && codUnavailableReason) setPayMethod(PAY_METHODS[0].key);
  }, [payMethod, codUnavailableReason]);

  // Mirrors the design: a flat coupon only counts once its minimum is met.
  // Coupon eligibility, discount, delivery and total all come from the shared
  // rules in `@/lib/pricing`, so the coupon screen previews exactly what
  // checkout will charge (and both stay aligned with api/_pricing.js).
  //
  // The COD handling fee is one per delivery, so it only enters the total once
  // the buyer has actually chosen to pay cash.
  const { discount, shipFee, codFee, total } = useMemo(
    () => computeTotals(subtotal, boutiqueSubtotals, coupon, payingCash ? cartBoutiques.deliveries : 0),
    [subtotal, boutiqueSubtotals, coupon, payingCash, cartBoutiques.deliveries],
  );

  const orderItems = useMemo(
    () => Object.entries(cart).map(([product_id, line]) => ({ product_id, qty: line.qty, size: line.size })),
    [cart],
  );

  const setGuest = useCallback(
    (patch: Partial<Guest>) =>
      setGuestState((g) => {
        const next = { ...g, ...patch };
        writeGuest(next);
        return next;
      }),
    [],
  );

  const clearGuest = useCallback(() => {
    setGuestState(EMPTY_GUEST);
    writeGuest(EMPTY_GUEST);
  }, []);

  const hasBuyerDetails = useMemo(() => hasContactDetails(guest), [guest]);

  /**
   * Settles one order payload against the server. Split out of `placeOrder` so
   * the recovery path can replay a stranded payment with the exact cart it was
   * authorised for, rather than whatever happens to be in the bag now.
   */
  const settleOrder = useCallback(async (
    items: PendingOrderItem[],
    couponCode: string | null,
    payment: PaymentInfo | null,
    /** 'COD' writes an unpaid order; omitted means a verified prepaid one. */
    paymentMethod?: 'COD',
  ): Promise<string> => {
    // A signed-in buyer sends their token so the order is tied to their account
    // (readable cross-device via RLS); guests omit it and stay phone-keyed.
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    // The server re-derives the discount/shipping from this code and binds the
    // paid amount to it — the browser's discount value is never trusted. On the
    // COD path there is no amount to bind, so the server re-checks the cap and
    // each boutique's cod_enabled flag instead.
    const res = await fetch('/api/place-order', {
      method: 'POST',
      headers,
      body: JSON.stringify({ items, guest, payment, couponCode, paymentMethod }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      orders?: { order_number: string; boutique_id: string; total?: number; cod_fee?: number; shipping_fee?: number }[];
      error?: string;
    };

    // 409 means this payment already produced an order (the replay guard fired):
    // a previous attempt actually succeeded and we only lost the response. That
    // is a settled payment, not a failure — stop retrying it.
    if (res.status === 409) {
      clearPendingPayment();
      throw new Error(data.error || 'This payment has already been used for an order.');
    }
    if (!res.ok || !data.orders?.length) {
      throw new Error(data.error || 'Could not place the order. Please try again.');
    }

    // Mirror the just-paid cart into the buyer's local order history, grouped by
    // boutique the same way the server split it. Guest orders can't be read back
    // from Supabase (RLS), so this is what powers "My orders" and tracking.
    const boutiqueIdByName = new Map(boutiques.map((b) => [b.name, b.id]));
    const itemsByBoutique = new Map<string, PlacedOrderItem[]>();
    for (const line of items) {
      const p = productById(line.product_id);
      if (!p) continue;
      // Group by the product's boutique id — the same key the server split the
      // order on — so each line lands under the right boutique even when two
      // shops share a name. Name lookup remains only for legacy records.
      const bid = p.boutiqueId ?? boutiqueIdByName.get(p.boutique);
      if (!bid) continue;
      const arr = itemsByBoutique.get(bid) ?? [];
      arr.push({ pid: line.product_id, title: p.title, tone: p.tone, qty: line.qty, size: line.size, price: p.price });
      itemsByBoutique.set(bid, arr);
    }
    const placedAt = new Date().toISOString();
    const isCodOrder = paymentMethod === 'COD';
    const placed: PlacedOrder[] = data.orders.map((o) => {
      const orderLines = itemsByBoutique.get(o.boutique_id) ?? [];
      const fee = Number(o.cod_fee ?? 0);
      const shipping = Number(o.shipping_fee ?? 0);
      return {
        id: '#' + o.order_number,
        orderNumber: o.order_number,
        placedAt,
        boutique: boutiques.find((b) => b.id === o.boutique_id)?.name ?? 'Boutique',
        boutiqueId: o.boutique_id,
        status: 'pending',
        // Prefer the server's total: it's the authoritative goods figure, plus
        // the delivery and cash-handling this particular order carries.
        total: (o.total ?? orderLines.reduce((s, it) => s + it.price * it.qty, 0)) + shipping + fee,
        items: orderLines,
        paymentMethod: isCodOrder ? 'COD' : 'Razorpay',
        paymentStatus: isCodOrder ? 'pending' : 'paid',
        codFee: fee,
        shippingFee: shipping,
      };
    });
    addOrders(placed);

    // This order is on record, so its payment is no longer at risk.
    clearPendingPayment();

    const oid = data.orders[0].order_number;
    // Empty the bag through `clearCart`, not `setCart({})`: a signed-in buyer's
    // cart lives in the account, so wiping only the in-memory copy left the
    // just-ordered rows in the DB and the next load put them straight back.
    clearCart();
    setAppliedCoupon(null);
    setLastOrderId(oid);
    showToast(isCodOrder ? 'Order placed — pay cash on delivery' : 'Order placed successfully');
    return oid;
  }, [guest, boutiques, productById, showToast, clearCart]);

  const placeOrder = useCallback(async (payment: PaymentInfo): Promise<string> => {
    // The server prices the order from the product ids, so the browser only
    // sends what it can't derive: which products, how many, and the size.
    const items = Object.entries(cart).map(([product_id, line]) => ({
      product_id,
      qty: line.qty,
      size: line.size,
    }));
    if (items.length === 0) throw new Error('Your bag is empty');

    // Park the verified payment BEFORE attempting settlement. If this call never
    // returns — dropped network, closed tab, server error — the money is already
    // captured, and this record is what lets the buyer finish the order instead
    // of waiting on a manual refund.
    savePendingPayment({ payment, items, couponCode: appliedCoupon, total });

    return settleOrder(items, appliedCoupon, payment);
  }, [cart, appliedCoupon, total, settleOrder]);

  /**
   * Places an unpaid cash-on-delivery order.
   *
   * Nothing is parked in `pendingPayment` here: there is no captured money to
   * strand, so a failure means the order simply was not placed and the buyer can
   * retry safely. The server independently re-checks the cap and every
   * boutique's cod_enabled flag, so this refusal is a courtesy, not the gate.
   */
  const placeCodOrder = useCallback(async (): Promise<string> => {
    if (codUnavailableReason) throw new Error(codUnavailableReason);
    const items = Object.entries(cart).map(([product_id, line]) => ({
      product_id,
      qty: line.qty,
      size: line.size,
    }));
    if (items.length === 0) throw new Error('Your bag is empty');

    return settleOrder(items, appliedCoupon, null, 'COD');
  }, [cart, appliedCoupon, codUnavailableReason, settleOrder]);

  /**
   * Finishes a payment that was captured but never became an order. Replays the
   * stored cart and payment id; the server's replay guard guarantees this can't
   * double-charge or double-create.
   */
  const retryPendingPayment = useCallback(async (): Promise<string> => {
    const pending = readPendingPayment();
    if (!pending) throw new Error('Nothing left to complete.');
    return settleOrder(pending.items, pending.couponCode, pending.payment);
  }, [settleOrder]);

  const value: ShopValue = {
    wishlist, toggleWish,
    follows, isFollowing, toggleFollow,
    cart, cartCount, addToCart, buyNow, cartQty, setCartSize, removeCart, clearCart,
    filters, setFilters, toggleFilter, setSort, setMaxPrice, resetFilters,
    query, setQuery,
    appliedCoupon, applyCoupon, removeCoupon, coupons, boutiqueSubtotals,
    orderItems,
    payMethod, setPayMethod,
    guest, setGuest, clearGuest, hasBuyerDetails,
    lastOrderId, placeOrder, placeCodOrder, retryPendingPayment,
    toast, showToast,
    sellModal,
    openSellModal: useCallback(() => setSellModal(true), []),
    closeSellModal: useCallback(() => setSellModal(false), []),
    subtotal, discount, shipFee, codFee, total, coupon,
    payingCash, codUnavailableReason, codDeliveries: cartBoutiques.deliveries,
  };

  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop() {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error('useShop must be used within a ShopProvider');
  return ctx;
}
