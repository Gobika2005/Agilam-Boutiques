/**
 * The feature badges a seller picks for a product — the icon grid at the top of
 * the buyer's product detail page (Breathable · Premium Fabric · Everyday Wear…).
 *
 * A fixed list in code rather than an admin-managed vocabulary, by decision: the
 * set is small, each badge needs a hand-picked Material Symbols icon, and the
 * claims are ones the platform is willing to stand behind. Changing the list is
 * a deploy, not an admin edit.
 *
 * Products store the `id`, never the label, so rewording a badge later doesn't
 * orphan every product that picked it.
 */
export type ProductBadge = { id: string; label: string; icon: string };

export const PRODUCT_BADGES: ProductBadge[] = [
  // Fabric & feel
  { id: 'breathable', label: 'Breathable', icon: 'air' },
  { id: 'premium_fabric', label: 'Premium Fabric', icon: 'diamond' },
  { id: 'pure_cotton', label: 'Pure Cotton', icon: 'eco' },
  { id: 'lightweight', label: 'Lightweight', icon: 'feather' },
  { id: 'skin_friendly', label: 'Skin Friendly', icon: 'spa' },
  { id: 'colourfast', label: 'Colourfast', icon: 'palette' },
  { id: 'wrinkle_free', label: 'Wrinkle Free', icon: 'iron' },
  // Craft
  { id: 'handloom', label: 'Handloom', icon: 'gesture' },
  { id: 'zari_work', label: 'Zari Work', icon: 'auto_awesome' },
  { id: 'made_in_tn', label: 'Made in Tamil Nadu', icon: 'location_on' },
  { id: 'limited_edition', label: 'Limited Edition', icon: 'workspace_premium' },
  // Occasion & fit
  { id: 'everyday_wear', label: 'Everyday Wear', icon: 'calendar_month' },
  { id: 'party_ready', label: 'Party Ready', icon: 'celebration' },
  { id: 'bridal_special', label: 'Bridal Special', icon: 'favorite' },
  { id: 'feeding_friendly', label: 'Feeding Friendly', icon: 'child_care' },
  { id: 'easy_wash', label: 'Easy Wash', icon: 'local_laundry_service' },
  // Service promises
  { id: 'secured_packing', label: 'Secured Packing', icon: 'inventory_2' },
  { id: 'genuine', label: '100% Genuine', icon: 'verified' },
  { id: 'dedicated_support', label: 'Dedicated support', icon: 'support_agent' },
  { id: 'gift_ready', label: 'Gift Ready', icon: 'card_giftcard' },
];

/** The buyer grid is 3 across, 2 deep. */
export const MAX_PRODUCT_BADGES = 6;
/** Enough to fill the first row — below this the grid looks broken. */
export const MIN_PRODUCT_BADGES = 3;

const BY_ID = new Map(PRODUCT_BADGES.map((b) => [b.id, b]));

/**
 * Resolve stored ids to renderable badges, in the seller's chosen order.
 * Unknown ids (a badge retired from the list above) are dropped rather than
 * rendered as a blank tile.
 */
export function badgesFor(ids: readonly string[] | null | undefined): ProductBadge[] {
  return (ids ?? []).map((id) => BY_ID.get(id)).filter((b): b is ProductBadge => !!b).slice(0, MAX_PRODUCT_BADGES);
}

/**
 * The wording every product falls back to when its seller hasn't written a
 * colour note. Kept here (not copied into each row at save time) so improving it
 * reaches every existing product.
 */
export const DEFAULT_COLOR_DISCLAIMER =
  'The colour you see can vary slightly from the actual piece depending on your screen, the lighting and the photography. A small difference in shade is normal for handcrafted and hand-dyed fabric, and is not a defect.';
