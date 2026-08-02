/**
 * Shared shapes, design tokens and formatting helpers, ported from the
 * `MangaiMart v2.dc.html` design so the screens keep the palette, copy and
 * imagery tones they were composed against.
 *
 * There is NO sample content here. The mock `PRODUCTS`/`BOUTIQUES`/`ORDERS`/
 * `ANALYTICS` records this file used to carry were deleted once every surface
 * read from Supabase — nothing imported them any more, and keeping them around
 * invited them back onto a screen. Everything the app renders comes from the
 * database. Sample rows for a local database live in `supabase/seed.sql`,
 * which is locked; `supabase/purge_seed.sql` removes them again.
 */

export const TONES = ['#F4D6E2', '#F1DCC7', '#E2DAEF', '#D7E7DE', '#F3DFD0', '#E7D9E6', '#DCE4EF', '#F0DAD4'];

/**
 * Demo photography. Builds a sized, cropped Unsplash CDN URL from a photo id.
 * These are free-to-use images used only to populate the demo; `ImageSlot`
 * falls back to its tinted placeholder if any fail to load.
 */
export const img = (id: string, w = 640): string =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=80`;

export type Product = {
  id: string;
  /** URL slug, generated and indexed by the database (migration 0057). The
   *  authority for the product's public address — see @/lib/seo. */
  slug?: string | null;
  title: string;
  price: number;
  cat: string;
  boutique: string;
  /** The owning boutique's id. The reliable join key — `boutique` (name) is for
   *  display only and is not unique. Absent on legacy rows, which fall back to
   *  the name match. */
  boutiqueId?: string;
  city: string;
  color: string;
  occasion: string;
  rating: number;
  reviews: number;
  tone: number;
  featured?: boolean;
  stock: number;
  fabric: string;
  image: string;
  description?: string;
  mrp?: number | null;
  sizes?: string[];
  washCare?: string;
  images?: string[];
  /** Buyer PDP detail sections the seller fills in (migration 0054). Absent on
   *  any product listed before the seller form grew them — the product page
   *  hides whatever is empty. */
  badges?: string[];
  feedingFriendly?: boolean;
  feedingNote?: string;
  shippingInfo?: string;
  colorDisclaimer?: string;
  specs?: { label: string; value: string }[];
  /** When the piece was listed. Drives New arrivals and the freshness term in
   *  the best-seller score — see @/lib/ranking. */
  createdAt?: string;
  /** Units sold on orders the seller accepted (migration 0023). Absent until
   *  that migration is applied, which the ranking degrades around. */
  soldCount?: number;
};

export type Boutique = {
  id: string;
  name: string;
  slug: string;
  city: string;
  area: string;
  insta: string;
  /** Google Maps share link (`boutiques.map_url`) — the "Shop Location" tap target. */
  mapUrl?: string;
  phone: string;
  since?: number;
  followers: number;
  positiveRating: number;
  rating: number;
  reviews: number;
  tone: number;
  verified: boolean;
  featured?: boolean;
  products: number;
  desc: string;
  /** Cover photo. */
  image: string;
  /** Shop logo (`boutiques.logo_url`). Optional — surfaces fall back to a monogram. */
  logo?: string;
  /**
   * Whether this boutique takes cash on delivery (its store setting). Checkout
   * offers COD only when every boutique in the bag accepts it; the server
   * re-checks the same flag, so this is for the buyer's benefit, not security.
   * Undefined on older rows, which are treated as accepting.
   */
  codEnabled?: boolean;
  /** When the boutique row was created — the denominator of its sales rate. */
  createdAt?: string;
  /** Units and fulfilled orders across the shop (migration 0023). */
  unitsSold?: number;
  ordersCount?: number;
  /**
   * The boutique's own delivery setting (`boutiques.delivery_available` etc,
   * migration 0021) — replaces the generic "Standard delivery" copy on the
   * product page and checkout with what this seller actually offers.
   * Undefined on older rows, which are treated as delivering free.
   */
  deliveryAvailable?: boolean;
  deliveryAreas?: string;
  deliveryCharge?: number;
};

export const CATEGORIES = [
  { name: 'Sarees', icon: 'checkroom', slotId: 'cat-sarees', toneHex: '#F3D3DF', image: img('1616756141603-6d37d5cde2a2') },
  { name: 'Lehengas', icon: 'apparel', slotId: 'cat-lehengas', toneHex: '#EAD6E8', image: img('1619715613791-89d35b51ff81') },
  { name: 'Gowns', icon: 'woman', slotId: 'cat-gowns', toneHex: '#E6D8EC', image: img('1756483509254-3cc48a5a15b2') },
  { name: 'Kurtis', icon: 'styler', slotId: 'cat-kurtis', toneHex: '#F1DAD0', image: img('1745313452052-0e4e341f326c') },
  { name: 'Bridal', icon: 'diamond', slotId: 'cat-bridal', toneHex: '#F0CBD6', image: img('1649930055986-ca57250a7fd4') },
  { name: 'More', icon: 'grid_view', slotId: 'cat-more', toneHex: '#E3DCEC', image: img('1610189025857-f42fe6e8dd91') },
];

export const COLORS = [
  { name: 'Pink', hex: '#E7719F' },
  { name: 'Red', hex: 'var(--ag-danger-text)' },
  { name: 'Green', hex: '#5FA37E' },
  { name: 'Purple', hex: '#9B7FC7' },
  { name: 'Yellow', hex: 'var(--ag-star)' },
  { name: 'Teal', hex: '#4F9CA3' },
  { name: 'Peach', hex: '#E8A583' },
];

export const OCCASIONS = ['Bridal', 'Wedding', 'Reception', 'Festive', 'Party', 'Casual'];
export const SORTS = ['Latest', 'Price: Low to High', 'Price: High to Low', 'Popularity'];
export const SIZES = ['S', 'M', 'L', 'XL'];

/**
 * Sizes a product is currently available in. Per-variant inventory isn't in the
 * catalogue yet, so this is derived deterministically from the product id
 * (stable across renders) — enough to make the size filter narrow results.
 * Swap the body for a real `sizes` column when variant stock lands in the DB.
 */
export function productSizes(p: Pick<Product, 'id' | 'stock'>): string[] {
  if (p.stock === 0) return [];
  const seed = [...p.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const sizes = SIZES.filter((_, i) => (seed + i) % 4 !== 0);
  return sizes.length ? sizes : SIZES;
}

export type Thread = {
  id: string;
  name: string;
  last: string;
  time: string;
  unread: number;
  online: boolean;
  tone: number;
  /** Boutique logo, where the inbox knows one. Falls back to a monogram. */
  avatar?: string;
};

export const TRACK_STAGES = [
  { label: 'Order Placed', icon: 'receipt_long', sub: 'We’ve received your order' },
  { label: 'Confirmed', icon: 'task_alt', sub: 'Boutique confirmed your order' },
  { label: 'Packed', icon: 'inventory_2', sub: 'Your item is packed & ready' },
  { label: 'Shipped', icon: 'local_shipping', sub: 'Handed to the delivery partner' },
  { label: 'Out for Delivery', icon: 'moped', sub: 'On the way to your address' },
  { label: 'Delivered', icon: 'home', sub: 'Order delivered — enjoy!' },
];

// Coupons now live in the `coupons` table (migration 0036) and are served from
// `@/data/coupons`; the pricing maths are in `@/lib/pricing`, mirrored by the
// server in api/_pricing.js. The old hardcoded COUPONS list was removed with that
// migration.

// Prepaid only — every order settles through the gateway before it is placed.
/**
 * `online` methods all open the same Razorpay modal — the buyer picks the exact
 * instrument there — so they differ only in copy. `cod` is the one method that
 * skips the gateway entirely and writes an unpaid order.
 */
export const PAY_METHODS = [
  { key: 'upi', label: 'UPI', sub: 'GPay, PhonePe, Paytm & more', icon: 'qr_code_2', kind: 'online' as const },
  { key: 'card', label: 'Credit / Debit Card', sub: 'Visa, Mastercard, RuPay', icon: 'credit_card', kind: 'online' as const },
  { key: 'netbanking', label: 'Net Banking', sub: 'All major banks supported', icon: 'account_balance', kind: 'online' as const },
  { key: 'cod', label: 'Cash on Delivery', sub: 'Pay the delivery partner in cash', icon: 'payments', kind: 'cod' as const },
];

/**
 * Status chip colours. These MUST stay as `--ag-*` custom properties rather
 * than literal hex: the console is themeable, and hardcoded pastels left the
 * badge glowing light-pink on the dark page background.
 */
export function statusStyle(status: string): { bg: string; fg: string } {
  const neutral = { bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' };
  const map: Record<string, { bg: string; fg: string }> = {
    'Pending': { bg: 'var(--ag-warn-bg)', fg: 'var(--ag-warn-text)' },
    'Accepted': { bg: 'var(--ag-purple-bg)', fg: 'var(--ag-purple-text)' },
    'Shipped': { bg: 'var(--ag-info-bg)', fg: 'var(--ag-info-text)' },
    'Delivered': { bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' },
    'Approved': { bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' },
    'Rejected': { bg: 'var(--ag-bad-bg)', fg: 'var(--ag-bad-text)' },
    'Cancelled': neutral,
  };
  return map[status] || neutral;
}

export const fmt = (n: number) => '₹' + n.toLocaleString('en-IN');
