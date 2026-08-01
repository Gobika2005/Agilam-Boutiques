export interface ProductWithBoutique {
  id: string;
  boutique_id: string;
  title: string;
  category: string;
  price: number;
  stock: number;
  fabric: string | null;
  color: string | null;
  occasion: string | null;
  image_url: string | null;
  tone: number;
  featured: boolean;
  rating: number;
  reviews_count: number;
  created_at: string;
  /** Units sold on accepted/shipped/delivered orders — maintained by the
   *  triggers in migration 0023, never written by the app. */
  sold_count?: number;
  /** Public Inspire-feed hearts (migration 0020). */
  likes_count?: number;
  /** Buyer-side engagement, all trigger/RPC-maintained (migration 0031). */
  views_count?: number;
  shares_count?: number;
  wishlist_count?: number;
  last_viewed_at?: string | null;
  description?: string | null;
  mrp?: number | null;
  sizes?: string[] | null;
  wash_care?: string | null;
  images?: string[] | null;
  /** PDP detail sections (migration 0054). Optional so a project that hasn't
   *  run it yet still reads products — the buyer page hides what's missing. */
  badges?: string[] | null;
  feeding_friendly?: boolean | null;
  feeding_note?: string | null;
  shipping_info?: string | null;
  color_disclaimer?: string | null;
  specs?: ProductSpec[] | null;
  boutique: { name: string; city: string; tone: number } | null;
}

/** One seller-written specification row, shown under the derived ones. */
export interface ProductSpec {
  label: string;
  value: string;
}

// The lifecycle status is declared alongside the generated table types so the
// Supabase client and the app agree on it; re-exported here because every
// consumer already imports its boutique types from this module.
export type { BoutiqueStatus, OrderStatus, PaymentStatus } from '@/types/database';
import type { BoutiqueStatus, OrderStatus, PaymentStatus } from '@/types/database';

/**
 * Human labels for the lifecycle status. Capitalising the raw value is not
 * enough — it would surface `changes_requested` as "Changes_requested".
 */
export const BOUTIQUE_STATUS_LABEL: Record<BoutiqueStatus, string> = {
  draft: 'Setting up',
  pending: 'Awaiting review',
  changes_requested: 'Needs changes',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const WORKING_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/**
 * A boutique as the app reads it. Every field here is covered by the
 * column-level SELECT grant in migration 0021 — the sensitive ones (GST, bank,
 * review note) live on `BoutiquePrivate` and only arrive via the
 * `boutique_private` RPC, so they can never leak into a buyer-facing payload.
 */
export interface BoutiqueRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string | null;
  city: string;
  area: string;
  description: string;
  tone: number;
  cover_url: string | null;
  logo_url: string | null;
  phone: string | null;
  instagram: string | null;
  established_year: number | null;
  verified: boolean;
  status: BoutiqueStatus;
  featured: boolean;
  rating: number;
  reviews_count: number;
  followers_count: number;
  positive_rating: number;
  created_at: string;
  /** Shop-wide sales counters (migration 0023), maintained by trigger. */
  units_sold?: number;
  orders_count?: number;

  // Step 1 — boutique information
  owner_name: string;
  // Step 2 — contact
  whatsapp: string | null;
  email: string | null;
  // Step 3 — shop address
  address_line: string;
  district: string;
  state: string;
  pincode: string;
  map_url: string | null;
  // Step 4 — business
  category: string;
  years_in_business: number | null;
  // Step 5 — store settings
  open_time: string;
  close_time: string;
  working_days: string[];
  delivery_available: boolean;
  delivery_areas: string;
  delivery_charge: number;
  cod_enabled: boolean;
  online_payment_enabled: boolean;
  // Step 7 — submission
  onboarding_step: number;
  onboarding_complete: boolean;
  submitted_at: string | null;
  reviewed_at: string | null;
  // Notification preferences
  notify_orders: boolean;
  notify_messages: boolean;
  notify_promotions: boolean;
}

/** The withheld columns, readable by the owner or an admin only. */
export interface BoutiquePrivate {
  gst_number: string | null;
  business_reg_number: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_ifsc: string | null;
  upi_id: string | null;
  review_note: string | null;
  /** Penny-drop state of the payout account (migration 0027). */
  payout_verification_status?: 'unverified' | 'pending' | 'verified' | 'failed' | null;
  payout_verification_note?: string | null;
}

export interface OrderWithDetails {
  id: string;
  order_number: string;
  buyer_id: string | null;
  boutique_id: string;
  status: OrderStatus;
  total: number;
  created_at: string;
  /** When the boutique moved this order into each stage (migration 0042). */
  accepted_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  guest_name: string | null;
  guest_phone: string | null;
  guest_city: string | null;
  guest_address?: string | null;
  guest_pincode?: string | null;
  payment_id?: string | null;
  refunded?: boolean;
  channel?: 'online' | 'offline';
  payment_method?: string | null;
  /** Settlement state — 'pending' on a COD order until the cash is collected. */
  payment_status?: PaymentStatus;
  paid_at?: string | null;
  /** COD handling fee on this delivery; 0 on prepaid orders. */
  cod_fee?: number;
  /** Delivery fee on this order (cart-level, so it lands on the first order). */
  shipping_fee?: number;
  /** Platform-funded coupon discount (migration 0053). Not deducted from
   *  `total` — the seller is paid in full — but it is off what the buyer owes. */
  platform_discount?: number;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  buyer: { full_name: string; phone: string | null; city: string | null } | null;
  boutique: { name: string; tone: number } | null;
  items: { id: string; product_id: string | null; title: string; price: number; qty: number; size: string | null; color: string | null }[];
}

export interface ConversationWithPeer {
  id: string;
  buyer_id: string;
  boutique_id: string;
  created_at: string;
  buyer_name: string;
  boutique_name: string;
  boutique_tone: number;
  last_message: string;
  last_message_at: string | null;
  unread: number;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
}
