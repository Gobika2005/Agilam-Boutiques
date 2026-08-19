/**
 * Razorpay Standard Checkout helper.
 *
 * The secret key never lives in the browser: order creation and signature
 * verification both run in the Vercel serverless functions under /api. This
 * module only loads the hosted checkout widget and talks to those endpoints.
 */

import { supabase } from '@/lib/supabase';

const CHECKOUT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
const KEY_ID = import.meta.env.VITE_RAZORPAY_KEY_ID as string | undefined;

export type RazorpaySuccess = {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
};

type CheckoutInstance = {
  open: () => void;
  on: (event: string, cb: (resp: unknown) => void) => void;
};
type RazorpayCtor = new (options: Record<string, unknown>) => CheckoutInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let scriptPromise: Promise<void> | null = null;

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = CHECKOUT_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      scriptPromise = null;
      reject(new Error('Could not load the payment gateway. Check your connection.'));
    };
    document.body.appendChild(el);
  });
  return scriptPromise;
}

type PayArgs = {
  /**
   * Cart lines the server prices the order from (product id + quantity + size).
   * When provided, /api/create-order derives the Razorpay amount from DB prices
   * and `couponCode`, so the browser's own total is never trusted. `amountPaise`
   * is kept only as a fallback for the amount actually shown in the modal.
   */
  items?: { product_id: string; qty: number; size: string }[];
  couponCode?: string | null;
  /**
   * The delivery address's pincode. Not a price the browser is proposing — it
   * selects which of each boutique's distance bands applies (migration 0077),
   * and the server resolves it against the same `pincodes` directory the cart
   * quoted from. Omitting it prices every shop at its furthest zone, so the
   * amount would not match what the buyer was shown.
   */
  pincode?: string | null;
  /** Amount in paise (₹1 = 100). Must be at least 100. Fallback when `items` is absent. */
  amountPaise: number;
  name: string;
  description?: string;
  receipt?: string;
  prefill?: { name?: string; email?: string; contact?: string };
};

/**
 * Runs the full checkout: creates an order on the server, opens the modal, and
 * verifies the signature on the server. Resolves only after a verified success.
 * Rejects with a user-facing message on cancel, failure, or verification error.
 */
export async function payWithRazorpay({
  items,
  couponCode,
  pincode,
  amountPaise,
  name,
  description,
  receipt,
  prefill,
}: PayArgs): Promise<{ paymentId: string; orderId: string; signature: string }> {
  await loadCheckout();
  if (!window.Razorpay) throw new Error('Payment gateway unavailable');

  // Ordering requires an account, so the buyer's token goes with the request —
  // /api/create-order refuses to open checkout without it. getSession() also
  // refreshes an access token that expired while they were shopping, which is
  // what keeps a long browse from turning into a rejected payment.
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;

  const orderRes = await fetch('/api/create-order', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    // Send the cart so the server can price the order itself (defense-in-depth),
    // plus the displayed amount as a resilient fallback. The authoritative check
    // still happens at /api/place-order, which re-binds the paid amount.
    body: JSON.stringify({
      items: items && items.length ? items : undefined,
      couponCode: couponCode ?? null,
      pincode: pincode ?? null,
      amount: amountPaise,
      currency: 'INR',
      receipt,
    }),
  });

  // The endpoint can return HTML (e.g. an SPA fallback when /api isn't served),
  // so parse defensively rather than assuming JSON.
  const raw = await orderRes.text();
  let order: {
    order_id?: string; amount?: number; currency?: string; key_id?: string;
    error?: string; couponApplied?: boolean;
  } = {};
  try {
    order = raw ? JSON.parse(raw) : {};
  } catch {
    /* non-JSON body handled below */
  }

  if (!orderRes.ok || !order.order_id) {
    console.error('[razorpay] create-order failed', orderRes.status, raw.slice(0, 200));
    throw new Error(
      order.error ||
        `Could not start the payment (HTTP ${orderRes.status}). Make sure the /api routes are running.`,
    );
  }

  /**
   * Stop if the coupon the buyer applied did not survive the server's re-check.
   *
   * A code can be exhausted, expired or deactivated between the moment it was
   * applied to the bag and the moment Pay is tapped, and the redemption cap in
   * particular is invisible to the browser by design (`usage_limit` and
   * `used_count` are withheld from the buyer's coupon columns). The server
   * silently priced the order without it, so the modal would have opened for
   * MORE than the total the buyer had just agreed to — money taken on terms
   * they never saw.
   *
   * Aborting before the modal opens is the honest outcome: nothing is charged,
   * and the bag can be re-priced with the coupon removed.
   */
  if (couponCode && order.couponApplied === false) {
    throw new Error(
      `The code ${couponCode.trim().toUpperCase()} is no longer available — it may have expired or been fully claimed. ` +
        'Remove it from your bag to see the current total.',
    );
  }

  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      // Prefer the key the server used to create THIS order — it is guaranteed
      // valid and to match order_id. VITE_RAZORPAY_KEY_ID is only a fallback,
      // so a misconfigured build-time var can't break checkout. This is also
      // what makes the admin's emergency account switch work end to end: the
      // order is opened on whichever merchant account is selected server-side,
      // and the modal follows it without a rebuild.
      key: order.key_id || KEY_ID,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name,
      description,
      prefill,
      theme: { color: '#D6336C' },
      modal: {
        // User closed the modal without paying.
        ondismiss: () => reject(new Error('Payment cancelled')),
      },
      handler: async (resp: RazorpaySuccess) => {
        try {
          const verifyRes = await fetch('/api/verify-payment', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(resp),
          });
          const data = await verifyRes.json().catch(() => ({}));
          if (verifyRes.ok && data.verified) {
            resolve({
              paymentId: resp.razorpay_payment_id,
              orderId: resp.razorpay_order_id,
              signature: resp.razorpay_signature,
            });
          } else {
            reject(new Error(data.error || 'We could not verify your payment.'));
          }
        } catch {
          reject(new Error('We could not verify your payment.'));
        }
      },
    });

    rzp.on('payment.failed', (resp: unknown) => {
      const desc = (resp as { error?: { description?: string } })?.error?.description;
      reject(new Error(desc || 'Payment failed. Please try another method.'));
    });

    rzp.open();
  });
}

type PayForAdArgs = {
  /** The draft `ad_campaigns` row (status 'pending_payment') being paid for. */
  campaignId: string;
  /** The seller's Supabase access token — the API binds the campaign to its owner. */
  accessToken: string;
  name: string;
  description?: string;
  prefill?: { name?: string; email?: string; contact?: string };
};

/**
 * The ad-purchase sibling of payWithRazorpay: server-prices the campaign via
 * POST /api/ads {action:'create-order'}, opens the same hosted checkout, then
 * settles it through /api/ads {action:'activate'} (which verifies the signature,
 * binds the amount and moves the campaign to 'pending_review'). Resolves only
 * after a verified activation.
 */
export async function payForAd({
  campaignId,
  accessToken,
  name,
  description,
  prefill,
}: PayForAdArgs): Promise<{ campaign: unknown }> {
  await loadCheckout();
  if (!window.Razorpay) throw new Error('Payment gateway unavailable');

  const authHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };

  const orderRes = await fetch('/api/ads', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ action: 'create-order', campaignId }),
  });
  const raw = await orderRes.text();
  let order: { order_id?: string; amount?: number; currency?: string; key_id?: string; error?: string } = {};
  try {
    order = raw ? JSON.parse(raw) : {};
  } catch {
    /* non-JSON handled below */
  }
  if (!orderRes.ok || !order.order_id) {
    console.error('[razorpay] ads create-order failed', orderRes.status, raw.slice(0, 200));
    throw new Error(order.error || `Could not start the ad payment (HTTP ${orderRes.status}).`);
  }

  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.key_id || KEY_ID,
      order_id: order.order_id,
      amount: order.amount,
      currency: order.currency,
      name,
      description,
      prefill,
      theme: { color: '#D6336C' },
      modal: { ondismiss: () => reject(new Error('Payment cancelled')) },
      handler: async (resp: RazorpaySuccess) => {
        try {
          const actRes = await fetch('/api/ads', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ action: 'activate', campaignId, ...resp }),
          });
          const data = await actRes.json().catch(() => ({}));
          if (actRes.ok && data.status === 'pending_review') {
            resolve({ campaign: data.campaign });
          } else {
            reject(new Error(data.error || 'We could not activate your ad.'));
          }
        } catch {
          reject(new Error('We could not activate your ad.'));
        }
      },
    });

    rzp.on('payment.failed', (resp: unknown) => {
      const desc = (resp as { error?: { description?: string } })?.error?.description;
      reject(new Error(desc || 'Payment failed. Please try another method.'));
    });

    rzp.open();
  });
}
