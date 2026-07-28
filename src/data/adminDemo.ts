/**
 * Admin console demo content.
 *
 * The design file `MangaiMart v2.dc.html` is only retrievable up to a
 * 256 KiB cap, which truncates it partway through the admin `subscriptions`
 * array. Everything above that point is ported verbatim; the values below
 * marked RECONSTRUCTED were rebuilt from the surviving markup's shape and the
 * design's established colour/format conventions, so they are our best
 * approximation rather than a faithful copy. Re-sync them if the full design
 * file ever becomes reachable.
 */

// --- verbatim from the design (above the truncation point) ---

export const METRICS = [
  { label: 'Gross merchandise value', value: '₹42.6L', icon: 'payments', tint: '#FCE0EC', ic: '#D6336C', delta: '+18%', deltaColor: '#218456' },
  { label: 'Active boutiques', value: '218', icon: 'storefront', tint: '#E6F0FA', ic: '#3A6EA5', delta: '+12', deltaColor: '#218456' },
  { label: 'Orders this month', value: '1,842', icon: 'receipt_long', tint: '#F3EAF5', ic: '#9B7FC7', delta: '+9%', deltaColor: '#218456' },
  { label: 'Platform revenue', value: '₹3.4L', icon: 'account_balance', tint: '#FBF0DA', ic: '#C99A3F', delta: '+21%', deltaColor: '#218456' },
];

export const GMV_BARS = ['38%', '52%', '44%', '60%', '48%', '66%', '58%', '74%', '62%', '82%', '76%', '94%'];

export const APPROVAL_TABS = [
  { label: 'Pending · 3', bg: '#B02454', fg: '#fff' },
  { label: 'Approved · 2', bg: '#fff', fg: '#6B5560' },
  { label: 'Rejected · 1', bg: '#fff', fg: '#6B5560' },
];

// --- RECONSTRUCTED (below the truncation point) ---

/** Mirrors ANALYTICS.categories, which the design reuses for category splits. */
export const CAT_STATS = [
  { name: 'Sarees', pct: 42 },
  { name: 'Lehengas', pct: 28 },
  { name: 'Gowns', pct: 18 },
  { name: 'Kurtis', pct: 12 },
];

export const CITY_BARS = [
  { d: 'Coimbatore', h: '92%' },
  { d: 'Chennai', h: '78%' },
  { d: 'Madurai', h: '60%' },
  { d: 'Salem', h: '44%' },
  { d: 'Erode', h: '32%' },
];

export const PAYMENTS = [
  { txn: '#TXN-9241', name: 'Elegance Boutique', amount: '₹4,899', commission: '₹392', status: 'Settled', bg: '#E5F3EC', fg: '#218456' },
  { txn: '#TXN-9238', name: 'Pinky’s Boutique', amount: '₹12,999', commission: '₹1,040', status: 'Settled', bg: '#E5F3EC', fg: '#218456' },
  { txn: '#TXN-9232', name: 'Trendz Wardrobe', amount: '₹8,999', commission: '₹720', status: 'Pending', bg: '#FBF0DA', fg: '#B8860B' },
  { txn: '#TXN-9225', name: 'Style Studio', amount: '₹3,798', commission: '₹304', status: 'Pending', bg: '#FBF0DA', fg: '#B8860B' },
  { txn: '#TXN-9217', name: 'Silk Symphony', amount: '₹5,299', commission: '₹424', status: 'Failed', bg: '#FBE3E3', fg: '#C0392B' },
];

export const ADS = [
  { title: 'Wedding Season Edit', placement: 'Home hero · carousel slot 1', status: 'Live', bg: '#E5F3EC', fg: '#218456', impressions: '48.2k', clicks: '3.1k' },
  { title: 'Festive Silk Push', placement: 'Results · top banner', status: 'Live', bg: '#E5F3EC', fg: '#218456', impressions: '31.7k', clicks: '2.4k' },
  { title: 'Boutique Spotlight', placement: 'Boutiques · top row', status: 'Scheduled', bg: '#FBF0DA', fg: '#B8860B', impressions: '—', clicks: '—' },
  { title: 'Monsoon Clearance', placement: 'Home · mid-page strip', status: 'Ended', bg: '#F1E4EB', fg: '#8A7078', impressions: '22.9k', clicks: '1.2k' },
];
