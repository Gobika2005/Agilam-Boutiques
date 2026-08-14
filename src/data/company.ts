/**
 * Single source of truth for MangaiMart's real-world company details.
 *
 * The footer, policy pages, profile "Contact us" and every support link read
 * from here, so the business only ever has to be corrected in one file.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  TODO (business owner): replace every value marked `TODO` below with the
 *  registered details before going live. They are printed verbatim to buyers
 *  and appear inside the legal policy pages.
 * ─────────────────────────────────────────────────────────────────────────
 */

export const COMPANY = {
  /** Trading name shown across the app. */
  brand: 'MangaiMart',
  short: 'MangaiMart',
  /** TODO: registered legal entity as it appears on the incorporation certificate. */
  legalName: 'MangaiMart Private Limited',
  tagline: 'All Boutiques • One Place',
  description:
    'MangaiMart brings India’s independent boutiques online — discover verified stores, chat directly with the owner, and shop handpicked ethnic wear delivered across India.',

  /**
   * One mailbox answers everything. `hello@` and `grievance@` were never
   * created on the domain, so general, support and grievance contact all
   * point at the one address that is confirmed live.
   */
  email: 'support@mangaimart.com',
  /** Confirmed live — also the Supabase Auth sender, see AUTH_EMAIL_SETUP.md. */
  supportEmail: 'support@mangaimart.com',
  /** Required by the IT Rules 2021 — a named grievance officer contact. */
  grievanceEmail: 'support@mangaimart.com',
  /** TODO: the person actually accountable for grievances. */
  grievanceOfficer: 'Grievance Officer, MangaiMart',

  /** Live support number. `phoneDigits` must be E.164 without "+". */
  phone: '+91 93442 94969',
  phoneDigits: '919344294969',
  // No `supportHours`, by decision: publishing "Mon–Sat, 10:00–19:00" is a
  // promise to be reachable in that window and to be unreachable outside it.
  // The contact points (email, phone, chat) stand on their own.

  /** TODO: registered office address. */
  address: {
    line1: 'No. 12, Second Floor, Race Course Road',
    line2: 'RS Puram',
    city: 'Coimbatore',
    state: 'Tamil Nadu',
    pincode: '641018',
    country: 'India',
  },

  /** TODO: statutory identifiers (leave blank to hide them in the footer). */
  cin: '',
  gstin: '',

  /**
   * Live profile URLs. Stored whole rather than as handles because the
   * Facebook page is only reachable through a `/share/` link, which no
   * `facebook.com/{handle}` template can build. A blank value hides that
   * icon in the footer and drops it from the Organization `sameAs`.
   *
   * Keep these canonical — the `?igsh=` / `?mibextid=` / `utm_source=qr`
   * parameters Instagram and Facebook append when you copy a link out of the
   * app are share-session attribution, and Google wants a clean profile URL
   * in `sameAs`.
   */
  social: {
    instagram: 'https://www.instagram.com/mangaimartt',
    facebook: 'https://www.facebook.com/share/194ncrSXck/',
    youtube: 'https://www.youtube.com/@MangaiMart-n6u',
  },

  foundedYear: 2024,
} as const;

/** "No. 12…, RS Puram, Coimbatore, Tamil Nadu 641018, India" */
export const COMPANY_ADDRESS_LINE = [
  COMPANY.address.line1,
  COMPANY.address.line2,
  COMPANY.address.city,
  `${COMPANY.address.state} ${COMPANY.address.pincode}`,
  COMPANY.address.country,
]
  .filter(Boolean)
  .join(', ');

export const CONTACT_LINKS = {
  mail: `mailto:${COMPANY.email}`,
  support: `mailto:${COMPANY.supportEmail}`,
  grievance: `mailto:${COMPANY.grievanceEmail}`,
  call: `tel:+${COMPANY.phoneDigits}`,
  whatsapp: `https://wa.me/${COMPANY.phoneDigits}`,
  instagram: COMPANY.social.instagram,
  facebook: COMPANY.social.facebook,
  youtube: COMPANY.social.youtube,
};

/**
 * Commercial terms.
 *
 * ⚠ These are NO LONGER what the policy pages quote. The two admin-editable
 * ones — `returnWindowDays` and `commissionPct` — are read from the live
 * `platform_settings` row by `src/data/policies.ts`, so what the buyer is
 * promised cannot drift from what the console is set to. Keeping them in step
 * by hand is what failed: the Delivery Policy advertised a ₹79 fee while
 * checkout took ₹89.
 *
 * What remains live here is their role as the compile-time FALLBACK, via
 * `DEFAULT_SETTINGS` in src/data/settings.ts — the values in force for the
 * instant before the settings row loads, and on a deployment where migration
 * 0048 has not been applied. Keep them plausible, but the database is the
 * authority.
 *
 * Delivery is gone from this list entirely. Since migration 0076 each boutique
 * sets its own delivery charge and free-delivery threshold (`ShopTerms` in
 * src/lib/pricing.ts), so there is no platform-wide figure left to fall back to
 * — and a stale one sitting here would be the same trap as before, just quieter.
 * Cash on delivery is gone for a different reason: it was withdrawn from the
 * platform (migration 0085), so there is no fee or cap to state at all.
 *
 * The copy-only terms below (`refundWorkingDays`, `deliveryEstimate`,
 * `metroDeliveryEstimate`, `cancellationWindowHours`) have no settings column
 * and no pricing consequence — they are service promises, and this is still
 * the one place they are written.
 */
export const POLICY_TERMS = {
  returnWindowDays: 7,
  refundWorkingDays: '5–7 working days',
  deliveryEstimate: '3–7 working days',
  metroDeliveryEstimate: '2–4 working days',
  cancellationWindowHours: 24,
  commissionPct: 10,
} as const;

/** Build stamp shown on the profile screen. Injected by Vite from package.json. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
