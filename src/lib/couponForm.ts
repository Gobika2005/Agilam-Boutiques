import type { CouponInput, CouponRow, CouponType } from '@/data/coupons';

/**
 * Shared coupon form helpers used by the admin console and the seller app, so
 * both validate and describe a coupon identically. The pricing maths live in
 * `@/lib/pricing`; this is only about the create/edit form.
 */

const CODE_RE = /^[A-Z0-9]{3,20}$/;

/** Above this, a percentage coupon must carry a max-discount cap. */
export const MAX_UNCAPPED_PCT = 25;

export function emptyCouponInput(boutiqueId: string | null): CouponInput {
  return {
    code: '',
    boutique_id: boutiqueId,
    type: 'pct',
    off: 10,
    min_subtotal: 0,
    max_discount: null,
    usage_limit: null,
    description: '',
    // Default a month out — a sensible, clearly-temporary window.
    expires_at: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10),
    active: true,
  };
}

export function couponInputFromRow(row: CouponRow): CouponInput {
  return {
    code: row.code,
    boutique_id: row.boutique_id,
    type: row.type,
    off: row.off,
    min_subtotal: row.min_subtotal,
    max_discount: row.max_discount,
    usage_limit: row.usage_limit,
    description: row.description,
    expires_at: row.expires_at,
    active: row.active,
  };
}

export type CouponFieldErrors = Partial<Record<keyof CouponInput, string>>;

/** Returns the fields that are wrong; an empty object means the form is good. */
export function validateCouponInput(input: CouponInput, opts: { allowShip: boolean }): CouponFieldErrors {
  const e: CouponFieldErrors = {};
  const code = input.code.trim().toUpperCase();
  if (!CODE_RE.test(code)) e.code = '3–20 letters or numbers, no spaces';

  if (input.type === 'ship' && !opts.allowShip) {
    e.type = 'Free-delivery coupons are platform-only';
  }

  if (input.type === 'pct') {
    if (!(input.off >= 1 && input.off <= 90)) e.off = 'Enter a percentage between 1 and 90';
    if (input.max_discount != null && input.max_discount < 1) {
      e.max_discount = 'Cap must be at least ₹1, or leave blank';
    } else if (input.max_discount == null && input.off > MAX_UNCAPPED_PCT) {
      // An uncapped percentage is unbounded spend: a live 90%-off platform code
      // with no cap would take 90% off a ₹50,000 bag. Small percentages stay
      // cap-optional so routine "10% off" codes are still one field.
      e.max_discount = `Set a maximum discount — anything over ${MAX_UNCAPPED_PCT}% must be capped`;
    }
  } else if (input.type === 'flat') {
    if (!(input.off >= 1)) e.off = 'Enter an amount of at least ₹1';
    // "₹200 off, orders over ₹1" cannot pay out what it advertises: the discount
    // is clamped to the cart's value, so the buyer sees a promise the maths
    // silently shrinks. Require a minimum that the discount actually fits under.
    else if (input.min_subtotal < input.off) e.min_subtotal = `Must be at least the discount (₹${Math.round(input.off)})`;
  }

  if (input.min_subtotal < 0) e.min_subtotal = 'Cannot be negative';

  if (input.usage_limit != null && !(Number.isFinite(input.usage_limit) && input.usage_limit >= 1)) {
    e.usage_limit = 'Enter at least 1, or leave blank for unlimited';
  }

  if (!input.expires_at) {
    e.expires_at = 'Pick an expiry date';
  } else {
    const today = new Date().toISOString().slice(0, 10);
    if (input.expires_at < today) e.expires_at = 'Expiry must be today or later';
  }

  return e;
}

/** Human summary of what a coupon gives, e.g. "10% off up to ₹600, orders over ₹2,000". */
export function describeCoupon(c: { type: CouponType; off: number; max_discount: number | null; min_subtotal: number }): string {
  const rupees = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
  let head: string;
  if (c.type === 'pct') head = `${c.off}% off${c.max_discount ? ` up to ${rupees(c.max_discount)}` : ''}`;
  else if (c.type === 'flat') head = `${rupees(c.off)} off`;
  else head = 'Free delivery';
  return c.min_subtotal > 0 ? `${head}, orders over ${rupees(c.min_subtotal)}` : head;
}
