/**
 * Single source of truth for Agilam's real-world company details.
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
  brand: 'Agilam Boutiques',
  short: 'Agilam',
  /** TODO: registered legal entity as it appears on the incorporation certificate. */
  legalName: 'Agilam Boutiques Private Limited',
  tagline: "Tamil Nadu's home for local boutiques",
  description:
    'Agilam brings Tamil Nadu’s independent boutiques online — discover verified stores, chat directly with the owner, and shop handpicked ethnic wear delivered across India.',

  /** TODO: confirm the live support inbox. */
  email: 'hello@agilam.in',
  supportEmail: 'support@agilam.in',
  /** Required by the IT Rules 2021 — a named grievance officer contact. */
  grievanceEmail: 'grievance@agilam.in',
  /** TODO: the person actually accountable for grievances. */
  grievanceOfficer: 'Grievance Officer, Agilam Boutiques',

  /** Live support number. `phoneDigits` must be E.164 without "+". */
  phone: '+91 63790 07829',
  phoneDigits: '916379007829',
  supportHours: 'Monday – Saturday, 10:00 – 19:00 IST',

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

  /** TODO: the live handles. A blank value hides that icon in the footer. */
  social: {
    instagram: 'agilamboutiques',
    facebook: 'agilamboutiques',
    youtube: '',
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
  instagram: COMPANY.social.instagram ? `https://instagram.com/${COMPANY.social.instagram}` : '',
  facebook: COMPANY.social.facebook ? `https://facebook.com/${COMPANY.social.facebook}` : '',
  youtube: COMPANY.social.youtube ? `https://youtube.com/@${COMPANY.social.youtube}` : '',
};

/**
 * Commercial terms the buyer-facing screens and the policy pages both quote.
 * Keep these aligned with `src/lib/pricing.ts` and `api/_pricing.js` — the
 * policy pages state them as the promise, the pricing module enforces it.
 */
export const POLICY_TERMS = {
  freeDeliveryOver: 2000,
  standardShipping: 79,
  returnWindowDays: 7,
  refundWorkingDays: '5–7 working days',
  deliveryEstimate: '3–7 working days',
  metroDeliveryEstimate: '2–4 working days',
  cancellationWindowHours: 24,
  commissionPct: 8,
  /** Cash on delivery — mirrors COD_FEE / COD_MAX_ORDER in src/lib/pricing.ts. */
  codFee: 49,
  codMaxOrder: 10000,
} as const;

/** Build stamp shown on the profile screen. Injected by Vite from package.json. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
