/**
 * Demo content ported verbatim from the `MangaiMart v2.dc.html` design.
 * Values must stay in sync with the design file so the screens render the
 * same copy, pricing and imagery tones it was composed against.
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
  title: string;
  price: number;
  cat: string;
  boutique: string;
  /** The owning boutique's id. The reliable join key — `boutique` (name) is for
   *  display only and is not unique. Absent on the legacy demo records, which
   *  fall back to the name match. */
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
   *  the demo records and on any product listed before the seller form grew
   *  them — the product page hides whatever is empty. */
  badges?: string[];
  feedingFriendly?: boolean;
  feedingNote?: string;
  shippingInfo?: string;
  colorDisclaimer?: string;
  specs?: { label: string; value: string }[];
  /** When the piece was listed. Drives New arrivals and the freshness term in
   *  the best-seller score — see @/lib/ranking. Absent on the demo records. */
  createdAt?: string;
  /** Units sold on orders the seller accepted (migration 0023). Absent until
   *  that migration is applied, which the ranking degrades around. */
  soldCount?: number;
};

export const PRODUCTS: Product[] = [
  { id: 'p1', title: 'Rose Zari Silk Saree', price: 4899, cat: 'Sarees', boutique: 'Elegance Boutique', city: 'Coimbatore', color: 'Pink', occasion: 'Wedding', rating: 4.7, reviews: 128, tone: 0, featured: true, stock: 12, fabric: 'Kanchipuram Silk', image: img('1618901185975-d59f7091bcfe') },
  { id: 'p2', title: 'Emerald Bridal Lehenga', price: 12999, cat: 'Lehengas', boutique: 'Pinky’s Boutique', city: 'Madurai', color: 'Green', occasion: 'Bridal', rating: 4.9, reviews: 96, tone: 3, featured: true, stock: 4, fabric: 'Velvet', image: img('1746372283841-dbb3838f9935') },
  { id: 'p3', title: 'Blush Georgette Gown', price: 6499, cat: 'Gowns', boutique: 'Trendz Wardrobe', city: 'Chennai', color: 'Pink', occasion: 'Reception', rating: 4.6, reviews: 74, tone: 0, stock: 8, fabric: 'Georgette', image: img('1679006831648-7c9ea12e5807') },
  { id: 'p4', title: 'Mustard Cotton Kurti', price: 1899, cat: 'Kurtis', boutique: 'Style Studio', city: 'Salem', color: 'Yellow', occasion: 'Casual', rating: 4.5, reviews: 203, tone: 1, stock: 24, fabric: 'Cotton', image: img('1727430228383-aa1fb59db8bf') },
  { id: 'p5', title: 'Lavender Anarkali Gown', price: 5299, cat: 'Gowns', boutique: 'Elegance Boutique', city: 'Coimbatore', color: 'Purple', occasion: 'Party', rating: 4.8, reviews: 61, tone: 2, stock: 6, fabric: 'Net', image: img('1617627143750-d86bc21e42bb') },
  { id: 'p6', title: 'Maroon Kanjivaram Saree', price: 8999, cat: 'Sarees', boutique: 'Trendz Wardrobe', city: 'Chennai', color: 'Red', occasion: 'Festive', rating: 4.7, reviews: 154, tone: 7, featured: true, stock: 9, fabric: 'Silk', image: img('1610030469983-98e550d6193c') },
  { id: 'p7', title: 'Peach Party Lehenga', price: 7499, cat: 'Lehengas', boutique: 'Style Studio', city: 'Salem', color: 'Peach', occasion: 'Party', rating: 4.4, reviews: 47, tone: 4, stock: 0, fabric: 'Organza', image: img('1668371679302-a8ec781e876e') },
  { id: 'p8', title: 'Teal Silk Kurti Set', price: 2499, cat: 'Kurtis', boutique: 'Pinky’s Boutique', city: 'Madurai', color: 'Teal', occasion: 'Festive', rating: 4.6, reviews: 88, tone: 3, stock: 15, fabric: 'Art Silk', image: img('1641699862936-be9f49b1c38d') },
];

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
   * Undefined on the demo records, which are treated as accepting.
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
   * Undefined on the demo records, which are treated as delivering free.
   */
  deliveryAvailable?: boolean;
  deliveryAreas?: string;
  deliveryCharge?: number;
};

export const BOUTIQUES: Boutique[] = [
  { id: 'b1', name: 'Elegance Boutique', slug: 'elegance-boutique', city: 'Coimbatore', area: 'RS Puram', insta: 'elegance.boutique', phone: '+91 98430 12345', since: 2018, followers: 1240, positiveRating: 99, rating: 4.7, reviews: 128, tone: 0, verified: true, featured: true, products: 64, desc: 'Elegant ethnic wear for every occasion. Curated with love and elegance.', image: img('1441984904996-e0b6ba687e04', 800) },
  { id: 'b2', name: 'Trendz Wardrobe', slug: 'trendz-wardrobe', city: 'Chennai', area: 'T. Nagar', insta: 'trendz.wardrobe', phone: '+91 98410 23456', since: 2019, followers: 860, positiveRating: 96, rating: 4.6, reviews: 96, tone: 7, verified: true, products: 120, desc: 'Contemporary ethnic fusion for the modern woman.', image: img('1555529771-835f59fc5efe', 800) },
  { id: 'b3', name: 'Pinky’s Boutique', slug: 'pinkys-boutique', city: 'Madurai', area: 'KK Nagar', insta: 'pinkys.boutique', phone: '+91 90470 34567', since: 2014, followers: 2100, positiveRating: 98, rating: 4.9, reviews: 212, tone: 2, verified: true, featured: true, products: 88, desc: 'Luxury bridal lehengas and heirloom sarees.', image: img('1521335629791-ce4aec67dd15', 800) },
  { id: 'b4', name: 'Style Studio', slug: 'style-studio', city: 'Salem', area: 'Fairlands', insta: 'style.studio', phone: '+91 94430 45678', since: 2020, followers: 430, positiveRating: 92, rating: 4.4, reviews: 54, tone: 4, verified: false, products: 41, desc: 'Everyday elegance in kurtis, gowns and daily wear.', image: img('1525562723836-dca67a71d5f1', 800) },
  { id: 'b5', name: 'Silk Symphony', slug: 'silk-symphony', city: 'Coimbatore', area: 'Gandhipuram', insta: 'silk.symphony', phone: '+91 90030 56789', since: 2012, followers: 1710, positiveRating: 97, rating: 4.8, reviews: 171, tone: 3, verified: true, products: 97, desc: 'Pure silk sarees, direct from the loom.', image: img('1595991209266-5ff5a3a2f008', 800) },
];

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

export const MESSAGES: Thread[] = [
  { id: 'm1', name: 'Elegance Boutique', last: 'Yes, the Rose Zari saree is available in your size!', time: '2m', unread: 2, online: true, tone: 0 },
  { id: 'm2', name: 'Pinky’s Boutique', last: 'We can customise the blouse. Shall I share options?', time: '1h', unread: 0, online: true, tone: 2 },
  { id: 'm3', name: 'Trendz Wardrobe', last: 'Thank you for shopping with us ❤', time: '3h', unread: 0, online: false, tone: 7 },
  { id: 'm4', name: 'Style Studio', last: 'Your order has been shipped.', time: '1d', unread: 0, online: false, tone: 4 },
];

export const SELLER_MSGS: Thread[] = [
  { id: 'sm1', name: 'Priya Sharma', last: 'Is the emerald lehenga available in M?', time: '5m', unread: 1, online: true, tone: 0 },
  { id: 'sm2', name: 'Anitha R', last: 'Please share the price for the maroon saree.', time: '40m', unread: 0, online: true, tone: 2 },
  { id: 'sm3', name: 'Neha Verma', last: 'Thank you! Order received 😊', time: '2h', unread: 0, online: false, tone: 3 },
];

export const CHAT_THREAD = [
  { me: false, text: 'Hi! Is the Rose Zari Silk Saree still available?', time: '10:02' },
  { me: true, text: 'Hello Priya! Yes it is, in blouse sizes S–XL.', time: '10:04' },
  { me: false, text: 'Lovely. Can you do a custom blouse?', time: '10:05' },
  { me: true, text: 'Absolutely. Custom stitching adds ₹450. Shall I reserve it for you?', time: '10:06' },
];

export type SellerOrder = { id: string; customer: string; item: string; qty: number; amount: number; status: string; date: string; tone: number };

export const ORDERS: SellerOrder[] = [
  { id: '#AGL-2481', customer: 'Priya Sharma', item: 'Rose Zari Silk Saree', qty: 1, amount: 4899, status: 'Pending', date: '15 Jul', tone: 0 },
  { id: '#AGL-2478', customer: 'Anitha R', item: 'Emerald Bridal Lehenga', qty: 1, amount: 12999, status: 'Shipped', date: '14 Jul', tone: 3 },
  { id: '#AGL-2472', customer: 'Neha Verma', item: 'Mustard Cotton Kurti', qty: 2, amount: 3798, status: 'Delivered', date: '12 Jul', tone: 1 },
  { id: '#AGL-2465', customer: 'Divya K', item: 'Lavender Anarkali Gown', qty: 1, amount: 5299, status: 'Pending', date: '11 Jul', tone: 2 },
];

export const CUSTOMERS = [
  { name: 'Priya Sharma', city: 'Coimbatore', orders: 6, spent: 24500, tone: 0 },
  { name: 'Anitha R', city: 'Chennai', orders: 3, spent: 31200, tone: 2 },
  { name: 'Neha Verma', city: 'Madurai', orders: 9, spent: 18900, tone: 3 },
  { name: 'Divya K', city: 'Salem', orders: 2, spent: 9800, tone: 4 },
];

export const NOTIFS = [
  { type: 'Orders', icon: 'shopping_bag', title: 'New order received', body: 'Priya Sharma ordered Rose Zari Silk Saree · ₹4,899', time: '2m', unread: true, tint: '#FCE0EC', ic: '#D6336C' },
  { type: 'Messages', icon: 'chat_bubble', title: 'New message', body: 'Anitha R: Please share the price for the maroon saree.', time: '40m', unread: true, tint: '#E6F0FA', ic: '#3A6EA5' },
  { type: 'Updates', icon: 'local_shipping', title: 'Order shipped', body: 'Order #AGL-2478 marked as shipped.', time: '3h', unread: false, tint: '#E5F3EC', ic: '#2FA36B' },
  { type: 'Updates', icon: 'payments', title: 'Payment received', body: '₹12,999 credited for order #AGL-2478.', time: '5h', unread: false, tint: '#FBF0DA', ic: 'var(--ag-gold-text)' },
  { type: 'Updates', icon: 'star', title: 'New review', body: 'Neha Verma rated Mustard Cotton Kurti 5 ★.', time: '1d', unread: false, tint: '#F3EAF5', ic: '#9B7FC7' },
];

export const APPROVALS = [
  { name: 'Silk Symphony', city: 'Coimbatore', owner: 'Lakshmi N', date: '15 Jul', status: 'Pending', tone: 3 },
  { name: 'Rangoli Threads', city: 'Erode', owner: 'Kavya S', date: '14 Jul', status: 'Pending', tone: 5 },
  { name: 'Trendz Wardrobe', city: 'Chennai', owner: 'Meena R', date: '12 Jul', status: 'Approved', tone: 7 },
  { name: 'Style Studio', city: 'Salem', owner: 'Deepa V', date: '10 Jul', status: 'Approved', tone: 4 },
  { name: 'Quick Fashions', city: 'Tiruppur', owner: 'Ramesh K', date: '09 Jul', status: 'Rejected', tone: 1 },
];

export type BuyerOrder = { id: string; pid: string; title: string; boutique: string; qty: number; size: string; amount: number; placed: string; tone: number; stage: number; eta: string };

export const BUYER_ORDERS: BuyerOrder[] = [
  { id: '#AGL-2481', pid: 'p1', title: 'Rose Zari Silk Saree', boutique: 'Elegance Boutique', qty: 1, size: 'M', amount: 4899, placed: '15 Jul 2026', tone: 0, stage: 2, eta: 'Arrives 19 Jul' },
  { id: '#AGL-2455', pid: 'p6', title: 'Maroon Kanjivaram Saree', boutique: 'Trendz Wardrobe', qty: 1, size: 'Free', amount: 8999, placed: '8 Jul 2026', tone: 7, stage: 4, eta: 'Arriving today' },
  { id: '#AGL-2402', pid: 'p8', title: 'Teal Silk Kurti Set', boutique: 'Pinky’s Boutique', qty: 2, size: 'L', amount: 4998, placed: '27 Jun 2026', tone: 3, stage: 5, eta: 'Delivered 1 Jul' },
];

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

export const ANALYTICS = {
  bestSellers: [
    { title: 'Rose Zari Silk Saree', units: 48, revenue: 235152, tone: 0 },
    { title: 'Emerald Bridal Lehenga', units: 31, revenue: 402969, tone: 3 },
    { title: 'Maroon Kanjivaram Saree', units: 27, revenue: 242973, tone: 7 },
    { title: 'Lavender Anarkali Gown', units: 22, revenue: 116578, tone: 2 },
  ],
  topCustomers: [
    { name: 'Anitha R', orders: 3, spent: 31200, tone: 2 },
    { name: 'Priya Sharma', orders: 6, spent: 24500, tone: 0 },
    { name: 'Divya K', orders: 2, spent: 9800, tone: 4 },
  ],
  categories: [
    { name: 'Sarees', pct: 42, color: '#D6336C' },
    { name: 'Lehengas', pct: 28, color: '#B0863B' },
    { name: 'Gowns', pct: 18, color: '#9B7FC7' },
    { name: 'Kurtis', pct: 12, color: '#5FA37E' },
  ],
  revenueBars: [{ m: 'Feb', h: '38%' }, { m: 'Mar', h: '52%' }, { m: 'Apr', h: '46%' }, { m: 'May', h: '68%' }, { m: 'Jun', h: '82%' }, { m: 'Jul', h: '96%' }],
};

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
