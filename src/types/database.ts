export type Role = 'buyer' | 'seller' | 'admin';
/**
 * Where a boutique sits in the seller lifecycle (migration 0021).
 *
 * `draft`             — created, still working through the 7-step setup wizard.
 * `pending`           — submitted, waiting on an admin.
 * `changes_requested` — admin sent back a correction list (`review_note`).
 * `approved`          — live to buyers.
 * `rejected`          — turned down, with the reason in `review_note`.
 */
export type BoutiqueStatus = 'draft' | 'pending' | 'changes_requested' | 'approved' | 'rejected';
/**
 * Fulfilment state. `rejected` is the seller turning the order down; `cancelled`
 * is the buyer walking away from a COD order before dispatch (migration 0022) —
 * they read differently to both sides and report differently.
 */
export type OrderStatus = 'pending' | 'accepted' | 'shipped' | 'delivered' | 'rejected' | 'cancelled';

/**
 * Settlement state, tracked separately from fulfilment because the two move
 * independently: a prepaid order is `paid` the moment it is written, while a
 * COD order stays `pending` until the seller confirms the cash arrived.
 */
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type ProductStatus = 'pending' | 'active' | 'hidden' | 'rejected';
export type AccountStatus = 'active' | 'blocked';
export type SubPlan = 'boutique' | 'featured';
export type SubStatus = 'active' | 'due' | 'expired';
export type AdStatus =
  | 'pending_payment'
  | 'pending_review'
  | 'changes_requested'
  | 'scheduled'
  | 'live'
  | 'paused'
  | 'rejected'
  | 'refunded'
  | 'expired';
export type AdPlacementCode = 'sponsored_card' | 'home_hero' | 'boutique_promo';
export type AdSubjectType = 'product' | 'boutique';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          role: Role;
          full_name: string;
          phone: string | null;
          email: string | null;
          city: string | null;
          address: string | null;
          pincode: string | null;
          status: AccountStatus;
          deleted_at: string | null;
          updated_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['profiles']['Row']> & { id: string };
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
        Relationships: [];
      };
      boutiques: {
        Row: {
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
          // ── Seller setup wizard (migration 0021) ──────────────────────────
          owner_name: string;
          whatsapp: string | null;
          email: string | null;
          address_line: string;
          district: string;
          state: string;
          pincode: string;
          map_url: string | null;
          category: string;
          years_in_business: number | null;
          open_time: string;
          close_time: string;
          working_days: string[];
          delivery_available: boolean;
          delivery_areas: string;
          delivery_charge: number;
          cod_enabled: boolean;
          online_payment_enabled: boolean;
          onboarding_step: number;
          onboarding_complete: boolean;
          submitted_at: string | null;
          reviewed_at: string | null;
          notify_orders: boolean;
          notify_messages: boolean;
          notify_promotions: boolean;
          /** Parcel defaults (migration 0065) — the fallback weight for a
           *  product with none of its own, and the box this shop packs in.
           *  Granted in 0065; read via fetchParcelDefaults, NOT BOUTIQUE_COLUMNS. */
          default_weight_grams: number;
          package_length_cm: number;
          package_breadth_cm: number;
          package_height_cm: number;
          /** Shiprocket (migration 0067). The pickup-location nickname registered
           *  under the platform account; NULL means this shop cannot book. */
          shiprocket_pickup_location: string | null;
          shiprocket_enabled: boolean;
          /** Migration 0068. Set when the pickup address was created through
           *  the Shiprocket API; NULL with a location set means an admin pasted
           *  it in by hand. `_error` holds the last refusal, verbatim. */
          shiprocket_pickup_registered_at: string | null;
          shiprocket_pickup_error: string | null;
          /**
           * Withheld from anon/authenticated by 0021's column-level SELECT
           * grants: writable by the owner, but only readable through the
           * `boutique_private` function. Never add these to BOUTIQUE_COLUMNS.
           */
          gst_number: string | null;
          business_reg_number: string | null;
          bank_account_name: string | null;
          bank_account_number: string | null;
          bank_ifsc: string | null;
          upi_id: string | null;
          review_note: string | null;
        };
        Insert: Partial<Database['public']['Tables']['boutiques']['Row']> & { owner_id: string; name: string };
        Update: Partial<Database['public']['Tables']['boutiques']['Row']>;
        Relationships: [];
      };
      products: {
        Row: {
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
          status: ProductStatus;
          deleted_at: string | null;
          description: string;
          mrp: number | null;
          /** Packed weight of one unit in grams (migration 0065). NULL falls
           *  back to boutiques.default_weight_grams when a parcel is booked. */
          weight_grams: number | null;
          sizes: string[];
          wash_care: string;
          images: string[];
          /** Buyer-facing detail sections (migration 0054). */
          badges: string[];
          feeding_friendly: boolean;
          feeding_note: string;
          shipping_info: string;
          color_disclaimer: string;
          specs: { label: string; value: string }[];
          /** Public hearts on the Inspire feed card (migration 0020). */
          likes_count: number;
          /** Buyer-side engagement counters (migration 0031) — RPC/trigger
           *  maintained, never app-writable. */
          views_count: number;
          shares_count: number;
          wishlist_count: number;
          last_viewed_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['products']['Row']> & { boutique_id: string; title: string };
        Update: Partial<Database['public']['Tables']['products']['Row']>;
        Relationships: [];
      };
      wishlist: {
        Row: { buyer_id: string; product_id: string; created_at: string };
        Insert: { buyer_id: string; product_id: string };
        Update: Partial<{ buyer_id: string; product_id: string }>;
        Relationships: [];
      };
      cart_items: {
        Row: { buyer_id: string; product_id: string; qty: number; size: string; updated_at: string };
        Insert: { buyer_id: string; product_id: string; qty?: number; size?: string; updated_at?: string };
        Update: Partial<{ qty: number; size: string; updated_at: string }>;
        Relationships: [];
      };
      boutique_followers: {
        Row: { buyer_id: string; boutique_id: string; created_at: string };
        Insert: { buyer_id: string; boutique_id: string };
        Update: Partial<{ buyer_id: string; boutique_id: string }>;
        Relationships: [];
      };
      // ── Inspire feed (migration 0020) ──────────────────────────────────
      // The feed is the catalogue, so the only new table is the public like.
      // Saving a piece is the wishlist above.
      product_likes: {
        Row: { product_id: string; buyer_id: string; created_at: string };
        Insert: { product_id: string; buyer_id: string };
        Update: Partial<{ product_id: string; buyer_id: string }>;
        Relationships: [];
      };
      /**
       * The catalogue vocabulary (migration 0024) — the categories, occasions,
       * fabrics, colours and sizes sellers pick from and buyers browse by.
       * `name_key` is the case- and space-normalised identity, written by
       * trigger; supplying it on insert only satisfies NOT NULL.
       */
      taxonomy: {
        Row: {
          id: string;
          kind: 'category' | 'occasion' | 'fabric' | 'color' | 'size';
          name: string;
          name_key: string;
          status: 'pending' | 'approved' | 'rejected';
          hex: string | null;
          icon: string | null;
          image_url: string | null;
          sort_order: number;
          requested_by: string | null;
          boutique_id: string | null;
          note: string | null;
          review_note: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['taxonomy']['Row']> & {
          kind: 'category' | 'occasion' | 'fabric' | 'color' | 'size';
          name: string;
          name_key: string;
        };
        Update: Partial<Database['public']['Tables']['taxonomy']['Row']>;
        Relationships: [];
      };
      reviews: {
        Row: {
          id: string;
          product_id: string;
          boutique_id: string;
          buyer_id: string;
          rating: number;
          body: string;
          author_name: string | null;
          verified_purchase: boolean;
          created_at: string;
          updated_at: string;
          /** Buyer-uploaded photos of the piece as delivered (migration 0041). */
          images: string[];
          /** The boutique's public reply and when it was posted (migration 0045). */
          seller_reply: string | null;
          seller_reply_at: string | null;
          /** Admin moderation flag — buyer/seller reads skip it (migration 0048). */
          hidden: boolean;
        };
        Insert: Partial<Database['public']['Tables']['reviews']['Row']> & {
          product_id: string;
          boutique_id: string;
          buyer_id: string;
          rating: number;
        };
        Update: Partial<Database['public']['Tables']['reviews']['Row']>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          order_number: string;
          buyer_id: string;
          boutique_id: string;
          status: OrderStatus;
          total: number;
          refunded: boolean;
          refunded_at: string | null;
          created_at: string;
          // ── Per-milestone timestamps (migration 0042) ────────────────────
          accepted_at: string | null;
          shipped_at: string | null;
          delivered_at: string | null;
          /** Discount code this order was placed with, if any (migration 0049). */
          coupon_code: string | null;
          // ── Cash on Delivery (migration 0022) ────────────────────────────
          payment_status: PaymentStatus;
          paid_at: string | null;
          /** Handling fee charged on this delivery; 0 on prepaid orders. */
          cod_fee: number;
          /**
           * Delivery fee on this order. A cart-level charge, so on a
           * multi-boutique checkout it sits on the first order only —
           * total + shipping_fee + cod_fee summed across the batch is what the
           * buyer was quoted.
           */
          shipping_fee: number;
          /** Seller-coupon discount netted off this boutique's order (migration
           *  0036); 0 unless a seller coupon applied. `total` is already net of
           *  it, so payouts settle unchanged. */
          discount: number;
          /** Platform-coupon discount carried by this order (migration 0053).
           *  The platform funds it, so it is NOT taken off `total` — but it IS
           *  off the buyer's bill: they pay
           *  total + shipping_fee + cod_fee − platform_discount. */
          platform_discount: number;
          cancelled_at: string | null;
          cancel_reason: string | null;
          payment_method: string | null;
          payment_id: string | null;
          channel: 'online' | 'offline';
          guest_name: string | null;
          guest_phone: string | null;
          guest_city: string | null;
          guest_address: string | null;
          guest_pincode: string | null;
          // ── Courier tracking (migration 0063) ────────────────────────────
          /** Filled by the seller's optional "Mark packed" step. */
          packed_at: string | null;
          /** Only a courier scan can honestly set this, and no webhook exists
           *  yet — so the buyer's "Out for delivery" stage stays blank rather
           *  than being invented from a timer. */
          out_for_delivery_at: string | null;
          /** The buyer reported the order never arrived. Excludes it from both
           *  the automatic and manual payout sweeps until an admin resolves it;
           *  a seller cannot clear it (0063's guard trigger reverts them). */
          delivery_disputed: boolean;
          delivery_disputed_at: string | null;
          delivery_dispute_note: string | null;
          delivery_resolved_at: string | null;
          /** "Don't ask me to review this one" (migration 0071). One flag, read
           *  by all four prompt surfaces so answering silences every one. */
          review_dismissed_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['orders']['Row']> & { order_number: string; buyer_id: string; boutique_id: string };
        Update: Partial<Database['public']['Tables']['orders']['Row']>;
        Relationships: [];
      };
      order_items: {
        Row: { id: string; order_id: string; product_id: string | null; title: string; price: number; qty: number; size: string | null; color: string | null };
        Insert: Partial<Database['public']['Tables']['order_items']['Row']> & { order_id: string; title: string };
        Update: Partial<Database['public']['Tables']['order_items']['Row']>;
        Relationships: [];
      };
      // Buyer discount codes (migration 0036). boutique_id null = platform coupon
      // (admin, whole cart, platform-funded); set = seller coupon (that boutique's
      // items only, seller-funded).
      coupons: {
        Row: {
          id: string;
          code: string;
          boutique_id: string | null;
          type: 'pct' | 'flat' | 'ship';
          off: number;
          min_subtotal: number;
          max_discount: number | null;
          /** Total redemptions allowed; null = unlimited (migration 0049). */
          usage_limit: number | null;
          /** Redemptions taken, maintained by redeem_coupon() (migration 0049). */
          used_count: number;
          description: string;
          expires_at: string;
          active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['coupons']['Row']> & { code: string; type: 'pct' | 'flat' | 'ship'; expires_at: string };
        Update: Partial<Database['public']['Tables']['coupons']['Row']>;
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          buyer_id: string;
          boutique_id: string;
          created_at: string;
          /** Read-receipt timestamps, one per side (migration 0043). */
          buyer_last_read_at: string | null;
          boutique_last_read_at: string | null;
        };
        Insert: { buyer_id: string; boutique_id: string };
        Update: Partial<{ buyer_id: string; boutique_id: string; buyer_last_read_at: string; boutique_last_read_at: string }>;
        Relationships: [];
      };
      messages: {
        Row: { id: string; conversation_id: string; sender_id: string; body: string; created_at: string };
        Insert: { conversation_id: string; sender_id: string; body: string };
        Update: Partial<{ body: string }>;
        Relationships: [];
      };
      notifications: {
        Row: { id: string; profile_id: string; type: string; title: string; body: string; read: boolean; created_at: string };
        Insert: Partial<Database['public']['Tables']['notifications']['Row']> & { profile_id: string; title: string };
        Update: Partial<Database['public']['Tables']['notifications']['Row']>;
        Relationships: [];
      };
      subscriptions: {
        Row: { id: string; boutique_id: string; plan: SubPlan; status: SubStatus; price: number; renewal_date: string | null; created_at: string };
        Insert: Partial<Database['public']['Tables']['subscriptions']['Row']> & { boutique_id: string };
        Update: Partial<Database['public']['Tables']['subscriptions']['Row']>;
        Relationships: [];
      };
      admin_activity_log: {
        Row: {
          id: string;
          actor_id: string | null;
          actor_name: string;
          action: string;
          entity_type: string;
          entity_id: string | null;
          meta: Record<string, unknown>;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['admin_activity_log']['Row']>;
        Update: never;
        Relationships: [];
      };
      ad_placements: {
        Row: {
          code: AdPlacementCode;
          name: string;
          description: string;
          daily_rate: number;
          max_active: number;
          active: boolean;
          sort: number;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['ad_placements']['Row']> & { code: AdPlacementCode; name: string };
        Update: Partial<Database['public']['Tables']['ad_placements']['Row']>;
        Relationships: [];
      };
      ad_campaigns: {
        Row: {
          id: string;
          boutique_id: string;
          placement_code: AdPlacementCode;
          subject_type: AdSubjectType;
          product_id: string | null;
          headline: string;
          subtext: string;
          image_url: string;
          cta_label: string;
          tag: string;
          status: AdStatus;
          start_date: string | null;
          end_date: string | null;
          /** The real serving window (migration 0037): N days = N × 24h from go-live. */
          start_at: string | null;
          end_at: string | null;
          days: number;
          daily_rate_snapshot: number;
          amount: number;
          payment_order_id: string | null;
          payment_id: string | null;
          paid_at: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          reject_reason: string | null;
          /** Published by an admin with no payment (migration 0070). `amount`
           *  stays 0 and it is left out of ad revenue. */
          house_ad: boolean;
          impressions: number;
          clicks: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['ad_campaigns']['Row']> & {
          boutique_id: string;
          placement_code: AdPlacementCode;
        };
        Update: Partial<Database['public']['Tables']['ad_campaigns']['Row']>;
        Relationships: [];
      };
      /** Singleton (id is forced to 1) store of admin-editable commercial knobs
       *  — commission, fees, hold window, maintenance mode (migration 0048). */
      platform_settings: {
        Row: {
          id: number;
          commission_pct: number;
          cod_fee: number;
          cod_max_order: number;
          free_delivery_over: number;
          standard_shipping: number;
          return_window_days: number;
          payout_hold_days: number;
          maintenance_mode: boolean;
          support_email: string;
          /** Which Razorpay merchant account collects money (migration 0064).
           *  Names an env-var slot, never a key. */
          razorpay_account: 'primary' | 'backup';
          /** Master COD switch (migration 0066). False makes api/place-order.js
           *  refuse every cash order regardless of the per-boutique flag. */
          cod_enabled: boolean;
          /** Master Shiprocket switch (migration 0067). Off by default — an
           *  admin turns it on once credentials are set. */
          shiprocket_enabled: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: Partial<Database['public']['Tables']['platform_settings']['Row']>;
        Update: Partial<Database['public']['Tables']['platform_settings']['Row']>;
        Relationships: [];
      };
      /** Platform spend, admin-only, with receipts in the private
       *  `expense-proofs` bucket (migration 0056). */
      // Private post-delivery feedback about the platform itself (0071).
      // Deliberately separate from `reviews`: those are public and feed
      // `boutiques.rating`; this is confidential and affects no boutique.
      platform_feedback: {
        Row: {
          id: string;
          buyer_id: string;
          /** Which order prompted it. Null once an order is deleted, or if
           *  feedback is ever collected outside an order. */
          order_id: string | null;
          rating: number;
          body: string;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['platform_feedback']['Row']> & { buyer_id: string; rating: number };
        Update: Partial<Database['public']['Tables']['platform_feedback']['Row']>;
        Relationships: [];
      };
      expenses: {
        Row: {
          id: string;
          spent_on: string;
          category: string;
          title: string;
          vendor: string;
          amount: number;
          payment_method: string;
          reference: string;
          notes: string;
          /** Storage paths inside `expense-proofs`, never public URLs. */
          proofs: string[];
          created_by: string | null;
          created_by_name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['expenses']['Row']>;
        Update: Partial<Database['public']['Tables']['expenses']['Row']>;
        Relationships: [];
      };
      // ── Courier tracking (migration 0063) ────────────────────────────────
      // The list sellers pick from when shipping. Admin-managed, same pattern
      // as the catalogue vocabulary.
      couriers: {
        Row: {
          id: string;
          name: string;
          /** '{awb}' is substituted at render time. Null is normal: most Indian
           *  courier tracking pages are form-POST and take no AWB in the URL. */
          tracking_url_template: string | null;
          active: boolean;
          sort_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['couriers']['Row']> & { name: string };
        Update: Partial<Database['public']['Tables']['couriers']['Row']>;
        Relationships: [];
      };
      // One parcel per order. Its existence is what gates the seller's payout —
      // an AWB does not prove delivery, but it proves a parcel left the shop.
      shipments: {
        Row: {
          id: string;
          order_id: string;
          boutique_id: string;
          courier_id: string | null;
          /** Denormalised so renaming or hiding a courier never rewrites the
           *  history of parcels already sent; also holds the free-text name
           *  when the seller picked "Other". */
          courier_name: string;
          awb: string;
          tracking_url: string | null;
          shipped_at: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          // ── Aggregator booking (migration 0067) ───────────────────────────
          /** 'manual' = the seller typed the docket. 'shiprocket' = we booked
           *  it, so a courier scan drives the timeline instead of the seller. */
          provider: 'manual' | 'shiprocket';
          sr_order_id: string | null;
          sr_shipment_id: string | null;
          sr_courier_name: string | null;
          label_url: string | null;
          manifest_url: string | null;
          /** What the aggregator charged US for this parcel. */
          freight_charge: number | null;
          declared_weight_kg: number | null;
          /** Latest normalised scan, denormalised off shipment_events so an
           *  order list needs no join per row. */
          last_status: string | null;
          last_status_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['shipments']['Row']> & {
          order_id: string; boutique_id: string; courier_name: string; awb: string;
        };
        Update: Partial<Database['public']['Tables']['shipments']['Row']>;
        Relationships: [];
      };
      /** Courier scans, append-only (migration 0067). Written only by the
       *  webhook Edge Function through the service role; readable by the buyer,
       *  the seller and an admin. */
      shipment_events: {
        Row: {
          id: string;
          shipment_id: string;
          order_id: string;
          awb: string | null;
          /** The courier's own wording, kept verbatim for support. */
          raw_status: string;
          stage: 'picked_up' | 'in_transit' | 'out_for_delivery' | 'delivered' | 'rto' | 'failed';
          location: string | null;
          occurred_at: string | null;
          payload: unknown;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['shipment_events']['Row']>;
        Update: Partial<Database['public']['Tables']['shipment_events']['Row']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      toggle_boutique_follow: {
        Args: { bid: string; do_follow: boolean };
        Returns: number;
      };
      /** Admin fans a single notification out to a whole audience (migration 0048). */
      broadcast_notification: {
        Args: { p_audience: string; p_title: string; p_body: string };
        Returns: number;
      };
      toggle_product_like: {
        Args: { pid: string; do_like: boolean };
        Returns: number;
      };
      /**
       * The coupon columns migration 0058 withheld from `authenticated`, for
       * every coupon the caller may manage (migration 0059). An admin gets all
       * of them, a seller their own boutiques', a buyer none.
       */
      coupon_private_all: {
        Args: Record<string, never>;
        Returns: { id: string; created_by: string | null; usage_limit: number | null; used_count: number }[];
      };
      /** Post/edit/clear the boutique's public reply to a review (migration 0045). */
      reply_to_review: {
        Args: { p_review_id: string; p_reply: string };
        Returns: Database['public']['Tables']['reviews']['Row'];
      };
      /** Stamp a participant's read-receipt on a conversation (migration 0043). */
      mark_conversation_read: {
        Args: { p_conversation_id: string; p_role: string };
        Returns: undefined;
      };
      /** Record a buyer view / share of a product (migration 0031). */
      record_product_view: {
        Args: { pid: string };
        Returns: undefined;
      };
      record_product_share: {
        Args: { pid: string };
        Returns: undefined;
      };
      /** Record a buyer impression / click of a live ad campaign (migration 0032). */
      record_ad_impression: {
        Args: { p_id: string };
        Returns: undefined;
      };
      record_ad_click: {
        Args: { p_id: string };
        Returns: undefined;
      };
      /** Admin approve / pause an ad campaign (migration 0032). */
      admin_approve_ad: {
        Args: { p_id: string };
        Returns: Database['public']['Tables']['ad_campaigns']['Row'];
      };
      admin_pause_ad: {
        Args: { p_id: string };
        Returns: Database['public']['Tables']['ad_campaigns']['Row'];
      };
      /** Admin sends a paid ad back for rework with a note (migration 0033). */
      admin_request_ad_changes: {
        Args: { p_id: string; p_reason?: string | null };
        Returns: Database['public']['Tables']['ad_campaigns']['Row'];
      };
      /** Admin edits an ad's creative in place, status unchanged (migration 0046). */
      admin_edit_ad_creative: {
        Args: {
          p_id: string;
          p_subject_type: string;
          p_product_id: string | null;
          p_headline: string;
          p_subtext: string;
          p_image_url: string;
          p_tag: string;
          p_cta_label: string;
        };
        Returns: Database['public']['Tables']['ad_campaigns']['Row'];
      };
      /** Admin publishes an ad itself — no payment, no review (migration 0070). */
      admin_create_ad_campaign: {
        Args: {
          p_boutique_id: string;
          p_placement_code: AdPlacementCode;
          p_subject_type: AdSubjectType;
          p_product_id: string | null;
          p_headline: string;
          p_subtext: string;
          p_image_url: string;
          p_tag: string;
          p_cta_label: string;
          p_days: number;
          /** ISO yyyy-mm-dd; null means today. */
          p_start: string | null;
          p_go_live: boolean;
        };
        Returns: Database['public']['Tables']['ad_campaigns']['Row'];
      };
      /** Seller edits a paid ad's creative → back to review (migration 0033). */
      seller_edit_ad_creative: {
        Args: {
          p_id: string;
          p_subject_type: string;
          p_product_id: string | null;
          p_headline: string;
          p_subtext: string;
          p_image_url: string;
          p_tag: string;
          p_cta_label: string;
        };
        Returns: Database['public']['Tables']['ad_campaigns']['Row'];
      };
      create_offline_sale: {
        Args: {
          p_boutique_id: string;
          p_buyer_name: string;
          p_buyer_phone: string;
          p_items: { product_id: string | null; title: string; price: number; qty: number }[];
          p_discount?: number;
          p_payment_method?: string;
        };
        Returns: { id: string; order_number: string; total: number; created_at: string }[];
      };
      /**
       * Buyer-initiated cancellation of an un-dispatched, uncollected COD
       * order (migration 0022). Authorises on order number + the phone captured
       * at checkout, so a guest with no account can still cancel; releases the
       * reserved stock in the same transaction.
       */
      cancel_cod_order: {
        Args: { p_order_number: string; p_phone: string; p_reason?: string | null };
        Returns: { id: string; status: string }[];
      };
      /**
       * The boutique columns 0021 withholds from the public API. SECURITY
       * DEFINER, and answers only for the boutique's owner or an admin — so it
       * returns an empty set rather than erroring for anyone else.
       */
      boutique_private: {
        Args: { bid: string };
        Returns: {
          gst_number: string | null;
          business_reg_number: string | null;
          bank_account_name: string | null;
          bank_account_number: string | null;
          bank_ifsc: string | null;
          upi_id: string | null;
          review_note: string | null;
        }[];
      };
      /**
       * Settle a boutique's outstanding balance (migration 0025). SECURITY
       * DEFINER; recomputes the amount from the boutique's unsettled orders,
       * stamps them, and returns the inserted `payouts` row.
       */
      /**
       * The buyer's "it never arrived" report (migration 0063).
       *
       * An RPC rather than an UPDATE because `orders` has no buyer update
       * policy and must not get one — a broad grant would let a buyer edit
       * status or total. This verifies ownership and writes only the dispute
       * columns.
       */
      report_delivery_issue: {
        Args: { p_order_id: string; p_note?: string | null };
        Returns: void;
      };
      /**
       * "Stop asking me to review this order" (migration 0071). An RPC for the
       * same reason as above — `orders` has no buyer update policy, and giving
       * it one to set a single flag would also expose status and total.
       */
      dismiss_order_review: {
        Args: { p_order_id: string };
        Returns: void;
      };
      /**
       * Raise a return on a delivered order (migration 0074). SECURITY DEFINER:
       * it re-derives the boutique from the order, checks the caller owns it,
       * and applies the return window server-side — a fault reason bypasses the
       * window, a goodwill reason does not. Returns the new request's id, or
       * raises with a message written to be shown to the buyer verbatim.
       */
      request_return: {
        Args: { p_order_id: string; p_reason: string; p_note?: string; p_photos?: string[] };
        Returns: string;
      };
      /** Seller/admin answer to a return request (migration 0074). */
      resolve_return_request: {
        Args: { p_request_id: string; p_status: string; p_note?: string | null };
        Returns: void;
      };
      settle_boutique_payout: {
        Args: { p_boutique_id: string; p_note?: string | null };
        Returns: {
          id: string;
          boutique_id: string;
          amount: number;
          orders_count: number;
          gross: number;
          commission: number;
          fees: number;
          cod_adjustment: number;
          note: string | null;
          created_by: string | null;
          created_by_name: string;
          created_at: string;
          status: string;
          provider: string;
          method: string | null;
          utr: string | null;
          failure_reason: string | null;
        };
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
