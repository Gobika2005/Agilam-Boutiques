import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { FullscreenLoader } from '@/auth/RequireRole';
import { useToast } from '@/components/ui/Toast';
import { Field, TextArea, ChipPicker, Toggle, SectionCard, Row } from '@/components/seller/FormKit';
import { resolveDisplayName } from '@/lib/displayName';
import { KNOWN_CITIES } from '@/lib/cities';
import { usePincodeLookup } from '@/hooks/usePincodeLookup';
import { isMapsLink } from '@/lib/geolocate';
import { adminPath } from '@/lib/adminPath';
import { ShopLocationPicker } from '@/components/seller/ShopLocationPicker';
import { DeliveryRateCard, describeReach, zoneRatesToForm, zoneRatesToPatch, type ZoneRateForm } from '@/components/seller/DeliveryRateCard';
import { FulfilmentCard, fulfilmentToForm, fulfilmentToPatch, validateFulfilment, type FulfilmentForm } from '@/components/seller/FulfilmentCard';
import { dispatchLabel, shopFulfilment } from '@/lib/fulfilment';
import { POLICY_TERMS } from '@/data/company';
import { CROP, useImageCropper } from '@/components/ui/ImageCropper';
import { signInWithGoogle, friendlyAuthError } from '@/lib/authMethods';
import { ConsentCheckbox, ConsentNotice, PolicyLinks, CONSENT_REQUIRED } from '@/components/legal/Consent';
import { GoogleIcon } from '@/components/ui/GoogleIcon';
import { useIfscLookup, type IfscStatus } from '@/hooks/useIfscLookup';
import {
  fetchMyBoutique,
  fetchBoutiquePrivate,
  createMyBoutique,
  updateBoutique,
  submitBoutiqueForReview,
  uploadBoutiqueImage,
  type BoutiquePatch,
} from '@/data/boutiques';
import { WORKING_DAYS, type BoutiqueRow } from '@/data/types';

/**
 * Boutique registration — creating the seller's login and the seven steps a
 * boutique completes before it can be submitted for admin verification, in one
 * continuous flow.
 *
 * Registration used to start on the shared /auth/signup/seller card, which asked
 * for the boutique name, owner name and city and then handed over to this wizard
 * — which asked for all three again. Account creation is step 0 here instead, so
 * every detail is entered exactly once.
 *
 * From step 1 on, every step saves to the boutique row as the seller advances
 * rather than buffering the whole form to the end, so an abandoned signup
 * resumes exactly where it stopped: `onboarding_step` records the furthest
 * completed step. Step 7 flips the boutique from `draft` to `pending` for the
 * admin queue.
 *
 * GST, business registration and the payout fields are withheld from the public
 * API by migration 0021's column grants, so they are read back through
 * `fetchBoutiquePrivate` rather than off the boutique row itself.
 */

const STEPS = [
  { n: 1, title: 'Boutique information', sub: 'How your shop appears to buyers', icon: 'storefront' },
  { n: 2, title: 'Contact information', sub: 'How customers reach you', icon: 'call' },
  { n: 3, title: 'Shop address', sub: 'Where your boutique is located', icon: 'location_on' },
  { n: 4, title: 'Business information', sub: 'Category and registration details', icon: 'business_center' },
  { n: 5, title: 'Store settings', sub: 'Timings, delivery and payments', icon: 'schedule' },
  { n: 6, title: 'Payment details', sub: 'Where your payouts are sent', icon: 'account_balance' },
  { n: 7, title: 'Review & submit', sub: 'Check everything, then send for verification', icon: 'task_alt' },
] as const;

/**
 * Step 0 — the MangaiMart login itself. It is numbered 0 so the DB's
 * `onboarding_step` (1–7, the boutique steps) keeps its existing meaning; only
 * the labels count from one.
 */
const ACCOUNT_STEP = { n: 0, title: 'Your account', sub: 'The login you will manage your boutique with', icon: 'person_add' } as const;
const ALL_STEPS = [ACCOUNT_STEP, ...STEPS];

const CATEGORIES = [
  'Sarees', 'Kurtis & Salwar', 'Bridal Wear', 'Lehengas & Gowns',
  'Kids Wear', 'Menswear', 'Accessories', 'Tailoring & Custom',
] as const;

/**
 * Every state and union territory, offered as suggestions rather than as the
 * twelve chips this used to be. The pincode lookup fills this field in on its
 * own, and it can legitimately answer with any of the 36 — a shop in Assam was
 * previously unable to say so.
 */
const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
] as const;

const PIN_RE = /^[1-9][0-9]{5}$/;
const PHONE_RE = /^[6-9][0-9]{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

type Form = {
  name: string; ownerName: string; description: string; logoUrl: string; coverUrl: string;
  phone: string; whatsapp: string; email: string; instagram: string;
  addressLine: string; area: string; city: string; district: string; state: string; pincode: string; mapUrl: string;
  /** The map pin, when we could get one — see the note on step 3's location block. */
  lat: string; lng: string;
  categories: string[]; gstNumber: string; businessReg: string; yearsInBusiness: string;
  openTime: string; closeTime: string; workingDays: string[];
  deliveryAvailable: boolean; deliveryAreas: string; rates: ZoneRateForm; freeDeliveryOver: string;
  fulfilment: FulfilmentForm;
  bankAccountName: string; bankAccountNumber: string; bankAccountNumberConfirm: string; bankIfsc: string;
};

const EMPTY: Form = {
  name: '', ownerName: '', description: '', logoUrl: '', coverUrl: '',
  phone: '', whatsapp: '', email: '', instagram: '',
  addressLine: '', area: '', city: '', district: '', state: '', pincode: '', mapUrl: '',
  lat: '', lng: '',
  categories: [], gstNumber: '', businessReg: '', yearsInBusiness: '',
  openTime: '10:00', closeTime: '20:00', workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  deliveryAvailable: true, deliveryAreas: '', rates: { local: '0', district: '', state: '', national: '' }, freeDeliveryOver: '0',
  fulfilment: { dispatchMin: '1', dispatchMax: '2', returnWindowDays: '7' },
  bankAccountName: '', bankAccountNumber: '', bankAccountNumberConfirm: '', bankIfsc: '',
};

type Errors = Partial<Record<keyof Form, string>>;

/** Step 0's own little form — it creates the auth user, not the boutique row. */
type Account = { fullName: string; email: string; password: string };
type AccountErrors = Partial<Record<keyof Account, string>>;

function validateAccount(a: Account): AccountErrors {
  const e: AccountErrors = {};
  if (a.fullName.trim().length < 2) e.fullName = 'Enter your full name';
  if (!EMAIL_RE.test(a.email.trim())) e.email = 'Enter a valid email address';
  if (a.password.length < 6) e.password = 'Use at least 6 characters';
  return e;
}

/** Per-step validation. Returns the fields that are wrong; empty means the step is good. */
function validateStep(step: number, f: Form, ifscKnownBad = false): Errors {
  const e: Errors = {};
  if (step === 1) {
    if (f.name.trim().length < 2) e.name = 'Enter your boutique name';
    if (f.ownerName.trim().length < 2) e.ownerName = 'Enter the owner name';
    if (!f.logoUrl) e.logoUrl = 'Add a boutique logo';
  }
  if (step === 2) {
    if (!PHONE_RE.test(f.phone.trim())) e.phone = 'Enter a 10-digit mobile number';
    if (f.whatsapp.trim() && !PHONE_RE.test(f.whatsapp.trim())) e.whatsapp = 'Enter a 10-digit WhatsApp number';
    if (!EMAIL_RE.test(f.email.trim())) e.email = 'Enter a valid email address';
  }
  if (step === 3) {
    if (f.addressLine.trim().length < 5) e.addressLine = 'Enter your shop address';
    if (!f.city.trim()) e.city = 'Enter your city or town';
    if (!f.district.trim()) e.district = 'Enter your district';
    if (!f.state.trim()) e.state = 'Enter your state';
    if (!PIN_RE.test(f.pincode.trim())) e.pincode = 'Enter a valid 6-digit pincode';
    // The map pin is required, not optional as it was.
    //
    // An address line alone is not a location: "12/4, Cross Cut Road" exists in
    // several towns, and a courier pickup, a buyer driving over and the "Shop
    // Location" button on the boutique page all need the actual point. The
    // wizard offers three ways to produce one — stand in the shop and tap "Use
    // my current location", paste a Maps share link, or drop a pin from the
    // address already typed — so requiring it does not corner anyone.
    if (!f.mapUrl.trim()) e.mapUrl = 'Set your exact shop location on the map';
    else if (!isMapsLink(f.mapUrl)) e.mapUrl = 'That is not a Google Maps link — use the buttons below, or Maps → Share → Copy link';
  }
  if (step === 4) {
    if (f.categories.length === 0) e.categories = 'Pick at least one category';
    if (f.gstNumber.trim() && !GST_RE.test(f.gstNumber.trim().toUpperCase())) e.gstNumber = 'Enter a valid 15-character GSTIN';
    if (f.yearsInBusiness.trim() && Number(f.yearsInBusiness) > 100) e.yearsInBusiness = 'Enter a number between 0 and 100';
  }
  if (step === 5) {
    if (!f.openTime) e.openTime = 'Set an opening time';
    if (!f.closeTime) e.closeTime = 'Set a closing time';
    if (f.workingDays.length === 0) e.workingDays = 'Pick at least one working day';
    if (f.deliveryAvailable && !f.deliveryAreas.trim()) e.deliveryAreas = 'List the areas you deliver to';
    const badFulfilment = validateFulfilment(f.fulfilment);
    if (badFulfilment) e.fulfilment = badFulfilment;
  }
  if (step === 6) {
    // Bank details are now the ONLY payout destination — payouts are made
    // manually by an admin reading exactly these three fields, so all three are
    // required and none can be left to "we'll sort it out later".
    if (f.bankAccountName.trim().length < 3) {
      e.bankAccountName = 'Enter the account holder name as printed on the passbook';
    } else if (!/^[A-Za-z][A-Za-z.\s'-]{2,}$/.test(f.bankAccountName.trim())) {
      // Bank names carry initials, apostrophes and hyphens, but never digits —
      // a number here is nearly always the account number typed into the wrong box.
      e.bankAccountName = 'Account holder name should not contain numbers';
    }
    if (!/^[0-9]{9,18}$/.test(f.bankAccountNumber.trim())) {
      e.bankAccountNumber = 'Enter a valid account number (9–18 digits)';
    } else if (f.bankAccountNumberConfirm.trim() !== f.bankAccountNumber.trim()) {
      // Re-entry catches the one mistake nothing downstream can: a typo in a
      // number no human recognises by sight.
      e.bankAccountNumberConfirm = 'Account numbers do not match';
    }
    if (!IFSC_RE.test(f.bankIfsc.trim().toUpperCase())) {
      e.bankIfsc = 'Enter a valid IFSC code (e.g. HDFC0001234)';
    } else if (ifscKnownBad) {
      // Only a confirmed 404 from the branch directory blocks. A lookup that
      // could not run (offline, outage) never stops the seller finishing setup.
      e.bankIfsc = 'No bank branch found for this IFSC — please check it';
    }
  }
  return e;
}

const orNull = (s: string) => s.trim() || null;

/**
 * `boutiques.category` is a single text column (migration 0021), but a boutique
 * that sells sarees usually sells blouses and lehengas too — so the wizard lets
 * the seller tick several and stores them comma-separated. Everywhere the value
 * is only ever displayed ("Sarees, Bridal Wear" under the shop name), so the
 * joined string reads correctly without a schema change.
 */
const joinCategories = (list: string[]) => list.join(', ');
const splitCategories = (raw: string | null | undefined) =>
  (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** The wizard form mapped onto the columns the boutique row actually stores. */
function toPatch(f: Form): BoutiquePatch {
  return {
    name: f.name.trim(),
    owner_name: f.ownerName.trim(),
    description: f.description.trim(),
    logo_url: orNull(f.logoUrl),
    cover_url: orNull(f.coverUrl),
    phone: orNull(f.phone),
    // A blank WhatsApp number falls back to the mobile number — the offline
    // billing flow sends bills over wa.me and needs something to dial.
    whatsapp: orNull(f.whatsapp) ?? orNull(f.phone),
    email: orNull(f.email),
    instagram: orNull(f.instagram.replace(/^@/, '')),
    address_line: f.addressLine.trim(),
    area: f.area.trim(),
    city: f.city.trim(),
    district: f.district.trim(),
    state: f.state.trim(),
    pincode: f.pincode.trim(),
    map_url: orNull(f.mapUrl),
    // Kept beside the link, not derived from it: a shortened maps.app.goo.gl
    // link carries no coordinates, so the pin would be lost on every reload.
    latitude: f.lat.trim() ? Number(f.lat) : null,
    longitude: f.lng.trim() ? Number(f.lng) : null,
    category: joinCategories(f.categories),
    gst_number: orNull(f.gstNumber.toUpperCase()),
    business_reg_number: orNull(f.businessReg),
    years_in_business: f.yearsInBusiness.trim() ? Number(f.yearsInBusiness) : null,
    open_time: f.openTime,
    close_time: f.closeTime,
    working_days: f.workingDays,
    delivery_available: f.deliveryAvailable,
    delivery_areas: f.deliveryAreas.trim(),
    ...zoneRatesToPatch(f.rates),
    ...fulfilmentToPatch(f.fulfilment),
    free_delivery_over: Number(f.freeDeliveryOver || 0),
    // Prepaid-only platform: every shop takes online payment, and there is no
    // COD switch to set. `cod_enabled` is deliberately NOT written here — a
    // trigger in migration 0085 pins it false on every insert and update, so the
    // database owns it and no client can turn it back on.
    online_payment_enabled: true,
    bank_account_name: orNull(f.bankAccountName),
    bank_account_number: orNull(f.bankAccountNumber),
    bank_ifsc: orNull(f.bankIfsc.toUpperCase()),
    // `upi_id` is deliberately NOT written here. MangaiMart pays out to bank
    // accounts only, so the wizard no longer collects a UPI ID — but the ~9
    // boutiques that onboarded with UPI and no bank details still have theirs on
    // file, and admin needs it to pay them during the transition. Including the
    // field would send `null` and silently wipe exactly that fallback.
  };
}

export function SellerOnboarding() {
  const navigate = useNavigate();
  const { session, profile, loading: authLoading, signUpWithPassword, signOut, claimRole } = useAuth();
  const toast = useToast();

  // A buyer who has ever opened a chat carries an anonymous Supabase session
  // (see ensureBuyerIdentity), so a session alone does not mean a real login —
  // without this check the wizard would happily create a boutique owned by an
  // anonymous buyer.
  const authed = !!session && !session.user.is_anonymous;

  const [boutique, setBoutique] = useState<BoutiqueRow | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [account, setAccount] = useState<Account>({ fullName: '', email: '', password: '' });
  const [accountErrors, setAccountErrors] = useState<AccountErrors>({});
  // Legal acceptance: the account step (Terms + Privacy) and the final shop
  // submission (Seller Agreement + commission) each need explicit opt-in.
  const [accountConsent, setAccountConsent] = useState(false);
  const [sellerConsent, setSellerConsent] = useState(false);
  const [step, setStep] = useState(1);
  // A boutique that has already been submitted re-opens the wizard from the
  // profile hub to edit its details rather than to register — no consent
  // re-acceptance, no re-submission for review, just save-in-place.
  const [editMode, setEditMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const { cropImage, cropper } = useImageCropper();
  const topRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  const setAcct = <K extends keyof Account>(key: K, value: Account[K]) => {
    setAccount((a) => ({ ...a, [key]: value }));
    setAccountErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };

  // Load (or create) the seller's boutique, then hydrate the form from it so a
  // half-finished wizard — or a "needs changes" resubmission — resumes in place.
  useEffect(() => {
    if (authLoading) return;
    if (!session || !authed) {
      // No real login yet: open on the account step rather than bouncing out to
      // a separate signup page. Creating the account re-runs this effect with a
      // session, which then creates the draft boutique and moves to step 1.
      setStep(0);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // An admin has no boutique to register — and the admin role is never
        // self-changeable, so send them back to their own console.
        if (profile?.role === 'admin') {
          navigate(adminPath('overview'), { replace: true });
          return;
        }
        // A shopper already signed in on the buyer app who picked "Create
        // Boutique" is promoted here — the same sanctioned buyer→seller upgrade
        // the Google sign-in path uses. Without it they would fill in the whole
        // wizard and then be bounced out of the seller console by RequireRole.
        if (profile?.role === 'buyer') await claimRole('seller');
        if (cancelled) return;

        let row = await fetchMyBoutique(session.user.id);
        if (!row) {
          const fallbackName = resolveDisplayName(profile, session);
          row = await createMyBoutique(session.user.id, {
            name: fallbackName ? `${fallbackName}'s Boutique` : 'My Boutique',
            city: profile?.city ?? '',
            owner_name: fallbackName,
          });
        }
        if (cancelled) return;

        // A finished boutique can still return here to manage its details.
        // Approved and under-review sellers open the wizard in edit mode; only a
        // rejected boutique — which has no editable path forward — is sent to
        // its status screen for the reason and support contact.
        if (row.onboarding_complete && row.status !== 'changes_requested') {
          if (row.status === 'approved' || row.status === 'pending') {
            setEditMode(true);
          } else {
            navigate('/seller/verification', { replace: true });
            return;
          }
        }

        const priv = await fetchBoutiquePrivate(row.id).catch(() => null);
        if (cancelled) return;

        setBoutique(row);
        setForm({
          name: row.name ?? '',
          ownerName: row.owner_name || resolveDisplayName(profile, session),
          description: row.description ?? '',
          logoUrl: row.logo_url ?? '',
          coverUrl: row.cover_url ?? '',
          phone: row.phone ?? profile?.phone ?? '',
          whatsapp: row.whatsapp ?? '',
          email: row.email ?? session.user.email ?? '',
          instagram: row.instagram ?? '',
          addressLine: row.address_line ?? '',
          area: row.area ?? '',
          city: row.city ?? '',
          district: row.district ?? '',
          state: row.state ?? '',
          pincode: row.pincode ?? '',
          mapUrl: row.map_url ?? '',
          lat: row.latitude != null ? String(row.latitude) : '',
          lng: row.longitude != null ? String(row.longitude) : '',
          categories: splitCategories(row.category),
          gstNumber: priv?.gst_number ?? '',
          businessReg: priv?.business_reg_number ?? '',
          yearsInBusiness: row.years_in_business != null ? String(row.years_in_business) : '',
          openTime: row.open_time || EMPTY.openTime,
          closeTime: row.close_time || EMPTY.closeTime,
          workingDays: row.working_days?.length ? row.working_days : EMPTY.workingDays,
          deliveryAvailable: row.delivery_available ?? true,
          deliveryAreas: row.delivery_areas ?? '',
          rates: zoneRatesToForm(row),
          fulfilment: fulfilmentToForm(row),
          freeDeliveryOver: row.free_delivery_over != null ? String(row.free_delivery_over) : '0',
          bankAccountName: priv?.bank_account_name ?? '',
          bankAccountNumber: priv?.bank_account_number ?? '',
          bankIfsc: priv?.bank_ifsc ?? '',
          // Pre-filled so an existing seller editing their profile isn't forced
          // to retype a number they already confirmed once.
          bankAccountNumberConfirm: priv?.bank_account_number ?? '',
        });
        // Resume on the step after the last completed one, capped at review.
        setStep(Math.min(7, Math.max(1, (row.onboarding_step ?? 0) + 1)));
      } catch (e) {
        if (!cancelled) toast(e instanceof Error ? e.message : 'Could not load your boutique');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // One-shot load per signed-in seller: re-running when `profile` or `toast`
    // changes identity would overwrite whatever the seller is mid-way typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, authed, authLoading]);

  const pickImage = async (kind: 'logo' | 'cover', picked: File | undefined) => {
    if (!boutique) return;
    // Same frames the buyer app renders these in — a square badge and a wide
    // banner — so the seller sees the crop before it goes live.
    const file = await cropImage(picked, kind === 'logo' ? CROP.logo : CROP.cover);
    if (!file) return;
    setUploading(kind);
    try {
      const url = await uploadBoutiqueImage(boutique.id, kind, file, boutique.name);
      set(kind === 'logo' ? 'logoUrl' : 'coverUrl', url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Image upload failed');
    } finally {
      setUploading(null);
    }
  };

  /* ── Where the shop actually is ──────────────────────────────────────────
     The pincode is the one part of an address a shop owner cannot really get
     wrong, so it drives the rest: India Post knows which district and state it
     belongs to, and every locality inside it, which is what the city field
     offers instead of a blank box. See src/lib/pincode.ts. */
  const pinStatus = usePincodeLookup(form.pincode);
  const pinArea = pinStatus.kind === 'found' ? pinStatus.area : null;

  // District and state are filled in from the pincode when the seller has not
  // typed them — never over the top of what they did type, since a shop on a
  // district boundary may legitimately disagree with the post office.
  useEffect(() => {
    if (!pinArea) return;
    setForm((f) => {
      if (f.pincode.trim() !== pinArea.pincode) return f;
      const next = { ...f };
      let changed = false;
      if (!f.district.trim() && pinArea.district) { next.district = pinArea.district; changed = true; }
      if (!f.state.trim() && pinArea.state) { next.state = pinArea.state; changed = true; }
      // Only when the pincode covers exactly one place is the city unambiguous;
      // otherwise the seller picks from the suggestion list.
      if (!f.city.trim() && pinArea.places.length === 1) { next.city = pinArea.places[0]; changed = true; }
      return changed ? next : f;
    });
  }, [pinArea]);

  const clearError = (key: keyof Form) => setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));

  // Resolves the typed IFSC to a real bank + branch so the seller can recognise
  // (or fail to recognise) their own. Only a confirmed "no such branch" blocks
  // submission — see useIfscLookup for why an outage must not.
  const ifscStatus = useIfscLookup(form.bankIfsc);
  const ifscKnownBad = ifscStatus.kind === 'invalid';

  // Steps the seller has not satisfied yet — drives the review checklist and
  // stops a half-filled boutique from reaching the admin queue. The IFSC lookup
  // is deliberately not consulted here: the checklist reflects what the seller
  // still has to fill in, not whether a third-party directory answered.
  const incomplete = useMemo(
    () => STEPS.slice(0, 6).filter((s) => Object.keys(validateStep(s.n, form)).length > 0),
    [form],
  );

  const goTo = (next: number) => {
    setStep(next);
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /**
   * Step 0's action. Only the auth user is created here — the boutique row is
   * left to the loader above, so the Google route below (which never passes
   * through this function) ends up with exactly the same draft.
   */
  const createAccount = async () => {
    const bad = validateAccount(account);
    if (Object.keys(bad).length) {
      setAccountErrors(bad);
      toast('Please fix the highlighted fields');
      return;
    }
    if (!accountConsent) {
      toast(CONSENT_REQUIRED);
      return;
    }
    setBusy(true);
    try {
      // Drop a lingering anonymous chat session first: signing up on top of one
      // would reuse that user id, whose profile row is already a buyer, and the
      // new seller would land back in the buyer app.
      if (session?.user?.is_anonymous) await signOut();
      const { confirmationRequired } = await signUpWithPassword(account.email.trim(), account.password, {
        full_name: account.fullName.trim(),
        role: 'seller',
      });
      if (confirmationRequired) {
        toast('Check your email to confirm your account, then sign in to finish setting up');
        navigate('/auth/signin/seller', { replace: true });
      }
      // Otherwise there is a session now and the loader takes over.
    } catch (e) {
      toast(e instanceof Error ? friendlyAuthError(e.message) : 'Could not create your account');
    } finally {
      setBusy(false);
    }
  };

  const continueWithGoogle = async () => {
    try {
      if (session?.user?.is_anonymous) await signOut();
      await signInWithGoogle('seller');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Google sign-in failed');
    }
  };

  const saveAndNext = async () => {
    const stepErrors = validateStep(step, form, ifscKnownBad);
    if (Object.keys(stepErrors).length) {
      setErrors(stepErrors);
      toast('Please fix the highlighted fields');
      return;
    }
    if (!boutique) return;

    const reached = Math.max(boutique.onboarding_step ?? 0, step);
    setBusy(true);
    try {
      await updateBoutique(boutique.id, { ...toPatch(form), onboarding_step: reached });
      setBoutique({ ...boutique, onboarding_step: reached });
      goTo(step + 1);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save this step');
    } finally {
      setBusy(false);
    }
  };

  // Edit-mode "Save changes": persist the whole form and return to the profile
  // hub. It never touches the boutique's status, so an approved shop stays
  // approved and a pending one stays in the queue.
  const saveEdits = async () => {
    if (!boutique) return;
    if (incomplete.length) {
      toast(`Finish ${incomplete[0].title} first`);
      goTo(incomplete[0].n);
      return;
    }
    setBusy(true);
    try {
      await updateBoutique(boutique.id, toPatch(form));
      toast('Business details updated');
      navigate('/seller/profile');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save your changes');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!boutique) return;
    if (incomplete.length) {
      toast(`Finish step ${incomplete[0].n} first`);
      goTo(incomplete[0].n);
      return;
    }
    if (!sellerConsent) {
      toast(CONSENT_REQUIRED);
      return;
    }
    setBusy(true);
    try {
      await submitBoutiqueForReview(boutique.id, toPatch(form));
      navigate('/seller/verification', { replace: true });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not submit your application');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <FullscreenLoader />;

  const active = step === 0 ? ACCOUNT_STEP : STEPS[step - 1];
  const completedCount = boutique?.onboarding_step ?? 0;
  const isResubmission = boutique?.status === 'changes_requested';

  return (
    <div ref={topRef} style={css('min-height:100vh;background:var(--ag-bg);padding-bottom:40px;')}>
      {cropper}
      {/* Header ------------------------------------------------------------ */}
      <div style={css('background:linear-gradient(135deg,#8E1C44 0%,#B02454 52%,#D6336C 100%);color:#fff;position:relative;overflow:hidden;')}>
        <div style={css('position:absolute;top:-90px;right:-50px;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(244,217,166,.22),transparent 70%);pointer-events:none;')} />
        <div style={css('max-width:900px;margin:0 auto;padding:clamp(22px,3.5vw,38px) clamp(18px,4vw,32px);position:relative;')}>
          <div className="agx-eyebrow" style={css('font-size:9.5px;color:#F4D9A6;')}>
            {editMode ? 'Manage boutique' : isResubmission ? 'Update & resubmit' : step === 0 ? 'Create your boutique' : 'Seller setup'}
          </div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(24px,3.2vw,34px);margin-top:6px;line-height:1.15;")}>
            {editMode ? 'Edit your business details' : isResubmission ? 'Fix the details and resubmit' : step === 0 ? 'Open your boutique on MangaiMart' : 'Set up your boutique'}
          </div>
          <div style={css('opacity:.88;font-size:13.5px;margin-top:6px;max-width:520px;')}>
            {editMode
              ? 'Update any section — bank & payout, GST, pickup address, timings and more. Changes save as you go and never need re-approval.'
              : 'Create your login, then eight quick steps to your boutique. Everything after the first step is saved as you go, so you can stop and come back any time.'}
          </div>

          <div style={css('display:flex;align-items:center;gap:6px;margin-top:22px;overflow-x:auto;padding-bottom:4px;')}>
            {ALL_STEPS.map((s, i) => {
              // The account step is "done" the moment there is a session, and it
              // can never be revisited — the login already exists by then.
              const done = s.n === 0 ? authed : completedCount >= s.n;
              const on = step === s.n;
              // Only completed steps and the next one are clickable — jumping
              // ahead would skip the validation each step performs on save.
              const reachable = s.n !== 0 && authed && (s.n <= completedCount + 1 || on);
              return (
                <div key={s.n} style={css('display:flex;align-items:center;gap:6px;flex:none;')}>
                  <button
                    type="button"
                    title={s.title}
                    onClick={() => reachable && goTo(s.n)}
                    style={css(`width:30px;height:30px;flex:none;border-radius:50%;border:1.5px solid ${on ? '#fff' : 'rgba(255,255,255,.4)'};background:${on ? '#fff' : done ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.1)'};color:${on ? '#B02454' : '#fff'};font-weight:800;font-size:12.5px;display:flex;align-items:center;justify-content:center;cursor:${reachable ? 'pointer' : 'default'};opacity:${reachable ? 1 : 0.55};font-family:inherit;`)}
                  >
                    {done && !on ? <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>check</span> : i + 1}
                  </button>
                  {i < ALL_STEPS.length - 1 && <span style={css(`width:18px;height:2px;border-radius:2px;background:${done ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.2)'};`)} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Step body --------------------------------------------------------- */}
      <div style={css('max-width:900px;margin:0 auto;padding:22px clamp(16px,4vw,32px) 0;')}>
        {isResubmission && step === 1 && (
          <div style={css('background:var(--ag-gold-bg);border:1px solid var(--ag-gold-border);border-radius:16px;padding:14px 16px;margin-bottom:16px;display:flex;gap:11px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#B9862F;")}>edit_note</span>
            <div style={css('font-size:13px;color:var(--ag-gold-text);font-weight:600;line-height:1.5;')}>
              Our team asked for a few changes. Update the details below and submit again — everything you already entered is filled in.
            </div>
          </div>
        )}

        <div style={css('display:flex;align-items:center;gap:12px;margin-bottom:16px;')}>
          <span style={css('width:44px;height:44px;flex:none;border-radius:14px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:23px;")}>{active.icon}</span>
          </span>
          <div>
            <div className="agx-eyebrow" style={css('font-size:9.5px;color:var(--ag-crimson);')}>Step {active.n + 1} of {ALL_STEPS.length}</div>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;line-height:1.2;margin-top:2px;")}>{active.title}</div>
            <div style={css('font-size:12.5px;color:var(--ag-muted);font-weight:600;')}>{active.sub}</div>
          </div>
        </div>

        {step === 0 && (
          <SectionCard subtitle="This is how you sign back in. Your boutique details come next — you only enter them once.">
            <Field label="Your full name *" value={account.fullName} onChange={(v) => setAcct('fullName', v)} placeholder="Lakshmi Priya" error={accountErrors.fullName} />
            <Field label="Email address *" value={account.email} onChange={(v) => setAcct('email', v)} placeholder="you@boutique.com" inputMode="email" error={accountErrors.email} />
            <Field
              label="Password *"
              value={account.password}
              onChange={(v) => setAcct('password', v)}
              type="password"
              placeholder="••••••••"
              error={accountErrors.password}
              hint="At least 6 characters."
            />

            <ConsentCheckbox checked={accountConsent} onChange={setAccountConsent} />

            <div style={css('display:flex;align-items:center;gap:10px;')}>
              <span style={css('flex:1;height:1px;background:var(--ag-surface-3);')} />
              <span style={css('font-size:11px;font-weight:700;color:#C0A5B0;')}>OR</span>
              <span style={css('flex:1;height:1px;background:var(--ag-surface-3);')} />
            </div>
            <button
              type="button"
              onClick={continueWithGoogle}
              style={css('height:50px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;font-weight:700;font-size:14px;cursor:pointer;color:var(--ag-ink);display:flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;')}
            >
              <GoogleIcon size={19} />Continue with Google
            </button>

            <ConsentNotice />

            <div style={css('text-align:center;font-size:13px;color:var(--ag-muted);font-weight:600;')}>
              Already have a boutique account?{' '}
              <button
                type="button"
                onClick={() => navigate('/auth/signin/seller')}
                style={css('border:none;background:none;color:var(--ag-crimson);font-weight:800;font-size:13px;cursor:pointer;padding:0;font-family:inherit;')}
              >
                Sign in
              </button>
            </div>
          </SectionCard>
        )}

        {step === 1 && (
          <SectionCard>
            <div>
              <div style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>Boutique logo & cover *</div>
              <div style={css('display:flex;gap:12px;margin-top:8px;align-items:stretch;')}>
                <div
                  onClick={() => logoInput.current?.click()}
                  style={css(`width:104px;height:104px;flex:none;border-radius:18px;border:2px dashed ${errors.logoUrl ? '#E7A7B4' : '#E6BCCF'};background:var(--ag-surface);position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;`)}
                >
                  {form.logoUrl ? (
                    <img src={form.logoUrl} alt="Boutique logo" style={css('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;')} />
                  ) : (
                    <>
                      <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:24px;")}>{uploading === 'logo' ? 'progress_activity' : 'add_a_photo'}</span>
                      <span style={css('font-size:10.5px;color:var(--ag-muted-soft);font-weight:700;')}>Logo *</span>
                    </>
                  )}
                  <input ref={logoInput} type="file" accept="image/*" style={css('display:none;')} onChange={(e) => { void pickImage('logo', e.target.files?.[0]); e.target.value = ''; }} />
                </div>
                <div
                  onClick={() => coverInput.current?.click()}
                  style={css('flex:1;min-width:0;height:104px;border-radius:18px;border:2px dashed #E6BCCF;background:var(--ag-surface);position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;')}
                >
                  {form.coverUrl ? (
                    <img src={form.coverUrl} alt="Boutique cover" style={css('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;')} />
                  ) : (
                    <>
                      <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:24px;")}>{uploading === 'cover' ? 'progress_activity' : 'wallpaper'}</span>
                      <span style={css('font-size:10.5px;color:var(--ag-muted-soft);font-weight:700;')}>Cover image</span>
                    </>
                  )}
                  <input ref={coverInput} type="file" accept="image/*" style={css('display:none;')} onChange={(e) => { void pickImage('cover', e.target.files?.[0]); e.target.value = ''; }} />
                </div>
              </div>
              {errors.logoUrl && <span style={css('display:block;margin-top:4px;font-size:11.5px;font-weight:700;color:var(--ag-danger-text);')}>{errors.logoUrl}</span>}
            </div>

            <Field label="Boutique name *" value={form.name} onChange={(v) => set('name', v)} placeholder="Uzhamagal Boutique" error={errors.name} />
            <Field label="Owner name *" value={form.ownerName} onChange={(v) => set('ownerName', v)} placeholder="Lakshmi Priya" error={errors.ownerName} />
            <TextArea
              label="Boutique bio"
              value={form.description}
              onChange={(v) => set('description', v)}
              placeholder="Handpicked Kanchipuram silks and bridal wear, crafted in Coimbatore since 2012."
              maxLength={400}
              hint={`${form.description.length}/400 — the first thing buyers read on your profile.`}
            />
          </SectionCard>
        )}

        {step === 2 && (
          <SectionCard>
            <Field label="Mobile number *" value={form.phone} onChange={(v) => set('phone', v.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" inputMode="tel" error={errors.phone} />
            <Field
              label="WhatsApp number"
              value={form.whatsapp}
              onChange={(v) => set('whatsapp', v.replace(/\D/g, '').slice(0, 10))}
              placeholder="9876543210"
              inputMode="tel"
              error={errors.whatsapp}
              hint="Leave blank to reuse your mobile number. Offline bills are sent to buyers here."
            />
            <Field label="Email address *" value={form.email} onChange={(v) => set('email', v)} placeholder="you@boutique.com" inputMode="email" error={errors.email} />
            <Field label="Instagram username" value={form.instagram} onChange={(v) => set('instagram', v)} placeholder="uzhamagal.boutique" hint="Without the @ — shown as a shortcut on your buyer-facing profile." />
          </SectionCard>
        )}

        {step === 3 && (
          <SectionCard>
            <TextArea label="Shop address *" value={form.addressLine} onChange={(v) => set('addressLine', v)} placeholder="12/4, Cross Cut Road, Gandhipuram" error={errors.addressLine} />

            {/* Pincode leads the block, because everything under it is derived
                from it. It used to sit last, next to the district, and a seller
                filled in three fields by hand that six digits can answer. */}
            <Field
              label="Pincode *"
              value={form.pincode}
              onChange={(v) => set('pincode', v.replace(/\D/g, '').slice(0, 6))}
              placeholder="641002"
              inputMode="numeric"
              error={errors.pincode}
              hint={errors.pincode ? undefined : 'Six digits — we fill in the district, state and nearby localities from it.'}
            />
            {pinStatus.kind === 'checking' && (
              <span style={css('font-size:11.5px;font-weight:700;color:var(--ag-muted);margin-top:-6px;')}>Looking up this pincode…</span>
            )}
            {pinArea && (
              <span style={css('font-size:11.5px;font-weight:700;color:var(--ag-good);margin-top:-6px;')}>
                {pinArea.district ? `${pinArea.district} district` : 'Found'}{pinArea.state ? `, ${pinArea.state}` : ''}
                {pinArea.places.length > 1 ? ` · ${pinArea.places.length} localities to pick from` : ''}
              </span>
            )}
            {pinStatus.kind === 'unknown' && (
              <span style={css('font-size:11.5px;font-weight:700;color:var(--ag-muted);margin-top:-6px;')}>
                We could not look that pincode up — fill in the city, district and state yourself.
              </span>
            )}

            <Row>
              {/* City and district are separate answers to separate questions —
                  a city sits inside a district, and filing "Coimbatore" as both
                  is only right for the district town. The city is what files the
                  shop into the buyer directory and its own /boutiques/<city>
                  page, so a short form like "Cbe" splits one city in two;
                  whatever is typed is canonicalised on save (src/lib/cities.ts).
                  The suggestions are the actual localities under the pincode,
                  falling back to the known-city list before one is entered. */}
              <Field
                label="City / town *"
                value={form.city}
                onChange={(v) => set('city', v)}
                placeholder="Coimbatore"
                error={errors.city}
                suggestions={pinArea?.places.length ? pinArea.places : KNOWN_CITIES}
                hint={pinArea?.places.length ? 'Pick the locality your shop is in.' : 'Full name, not a short form — buyers browse boutiques by city.'}
              />
              <Field
                label="District *"
                value={form.district}
                onChange={(v) => set('district', v)}
                placeholder="Coimbatore"
                error={errors.district}
                suggestions={pinArea?.district ? [pinArea.district] : undefined}
                hint={pinArea?.district ? 'From your pincode — change it if your shop sits on a district boundary.' : undefined}
              />
            </Row>
            <Row>
              <Field label="Area / locality" value={form.area} onChange={(v) => set('area', v)} placeholder="RS Puram" suggestions={pinArea?.places} />
              <Field
                label="State *"
                value={form.state}
                onChange={(v) => set('state', v)}
                placeholder="Tamil Nadu"
                error={errors.state}
                suggestions={INDIAN_STATES}
              />
            </Row>

            {/* ── The map pin ──────────────────────────────────────────────
                Required, and checked against the address above — see
                ShopLocationPicker for what it does about a fix taken 400km from
                the shop. The "find from my address" shortcut that used to sit
                beside the button is gone: it produced a Maps *search* for text
                the seller had already typed, which is not a location, and
                offering it next to a real GPS pin implied the two were
                equivalent. */}
            <ShopLocationPicker
              mapUrl={form.mapUrl}
              lat={form.lat}
              lng={form.lng}
              onChange={(next) => { setForm((f) => ({ ...f, ...next })); clearError('mapUrl'); }}
              error={errors.mapUrl}
              expected={{ pincode: form.pincode, city: form.city, district: form.district, state: form.state }}
            />
          </SectionCard>
        )}

        {step === 4 && (
          <SectionCard>
            <ChipPicker label="Boutique categories *" options={CATEGORIES} value={form.categories} onChange={(next) => set('categories', next)} multiple error={errors.categories} hint="Pick every kind of wear you sell — buyers see all of them on your shop." />
            <Field label="GST number" value={form.gstNumber} onChange={(v) => set('gstNumber', v.toUpperCase().slice(0, 15))} placeholder="33ABCDE1234F1Z5" error={errors.gstNumber} hint="Optional. Kept private — never shown to buyers." />
            <Field label="Business registration number" value={form.businessReg} onChange={(v) => set('businessReg', v)} placeholder="Udyam / shop licence number" hint="Optional. Speeds up verification. Kept private." />
            <Field label="Years in business" value={form.yearsInBusiness} onChange={(v) => set('yearsInBusiness', v.replace(/\D/g, '').slice(0, 3))} placeholder="12" inputMode="numeric" error={errors.yearsInBusiness} />
          </SectionCard>
        )}

        {step === 5 && (
          <div style={css('display:flex;flex-direction:column;gap:16px;')}>
            <SectionCard title="Store timing">
              <Row>
                <Field label="Opening time *" value={form.openTime} onChange={(v) => set('openTime', v)} type="time" error={errors.openTime} />
                <Field label="Closing time *" value={form.closeTime} onChange={(v) => set('closeTime', v)} type="time" error={errors.closeTime} />
              </Row>
              <ChipPicker label="Working days *" options={WORKING_DAYS} value={form.workingDays} onChange={(next) => set('workingDays', next)} multiple error={errors.workingDays} />
            </SectionCard>

            {/* Your numbers, charged to the buyer at checkout — MangaiMart adds
                no delivery fee of its own (migration 0076), and they vary with
                how far the parcel goes (0077). The rate bands, not the free-text
                box below them, are what decides who can order. */}
            <SectionCard title="Delivery" subtitle="What buyers pay you to deliver.">
              <Toggle label="Delivery available" description="Turn off if buyers must collect from your shop" icon="local_shipping" on={form.deliveryAvailable} onChange={(v) => set('deliveryAvailable', v)} />
              {form.deliveryAvailable && (
                <>
                  <DeliveryRateCard
                    value={form.rates}
                    onChange={(next) => set('rates', next)}
                    places={{ city: form.city, district: form.district, state: form.state }}
                    freeDeliveryOver={form.freeDeliveryOver}
                    onFreeDeliveryOverChange={(v) => set('freeDeliveryOver', v)}
                  />
                  <TextArea
                    label="Delivery areas *"
                    value={form.deliveryAreas}
                    onChange={(v) => set('deliveryAreas', v)}
                    placeholder="Coimbatore city, Tirupur, Erode"
                    error={errors.deliveryAreas}
                    hint="A description for your shop page. The bands above are what buyers are actually charged."
                  />
                </>
              )}
            </SectionCard>

            <SectionCard title="Dispatch & returns" subtitle="What buyers are promised on every product you list.">
              <FulfilmentCard value={form.fulfilment} onChange={(next) => set('fulfilment', next)} error={errors.fulfilment} />
            </SectionCard>

            {/* Not a choice any more: MangaiMart is prepaid-only, so there is no
                toggle to get wrong. Said out loud rather than left silent —
                "how do I turn on cash on delivery" is the question this
                answers. */}
            <SectionCard title="Payments accepted">
              <div style={css('display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:14px;background:var(--ag-surface-2);border:1px solid var(--ag-border);')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-good);")}>verified_user</span>
                <div style={css('font-size:13px;line-height:1.55;color:var(--ag-ink-2);')}>
                  <div style={css('font-weight:800;color:var(--ag-ink);')}>Online payment only</div>
                  Every order is paid in full through Razorpay — card, UPI or netbanking — before it reaches you.
                  MangaiMart does not offer cash on delivery, so you never send stock that has not been paid for.
                </div>
              </div>
            </SectionCard>
          </div>
        )}

        {step === 6 && (
          <SectionCard subtitle="MangaiMart transfers your earnings to this bank account. These details stay private — buyers and other sellers can never see them.">
            <Field
              label="Account holder name"
              value={form.bankAccountName}
              onChange={(v) => set('bankAccountName', v)}
              placeholder="Lakshmi Priya"
              error={errors.bankAccountName}
              hint="Exactly as printed on your passbook or cheque book."
            />
            <Field
              label="Bank account number"
              value={form.bankAccountNumber}
              onChange={(v) => set('bankAccountNumber', v.replace(/\D/g, '').slice(0, 18))}
              placeholder="123456789012"
              inputMode="numeric"
              error={errors.bankAccountNumber}
              hint="9–18 digits, exactly as printed in your passbook."
            />
            <Field
              label="Re-enter account number"
              value={form.bankAccountNumberConfirm}
              onChange={(v) => set('bankAccountNumberConfirm', v.replace(/\D/g, '').slice(0, 18))}
              placeholder="123456789012"
              inputMode="numeric"
              error={errors.bankAccountNumberConfirm}
              hint="A typo here is the one mistake we cannot catch for you."
            />
            <Field
              label="IFSC code"
              value={form.bankIfsc}
              onChange={(v) => set('bankIfsc', v.toUpperCase().slice(0, 11))}
              placeholder="HDFC0001234"
              error={errors.bankIfsc}
            />
            <IfscStatusLine status={ifscStatus} />
          </SectionCard>
        )}

        {step === 7 && <ReviewStep form={form} incomplete={incomplete} onEdit={goTo} editMode={editMode} />}

        {step === 7 && !editMode && (
          <div style={css('margin-top:16px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:16px;padding:16px 18px;box-shadow:0 16px 38px -30px rgba(107,20,54,.6);')}>
            <ConsentCheckbox checked={sellerConsent} onChange={setSellerConsent}>
              I have read and agree to the Seller Agreement, <PolicyLinks />, including the {POLICY_TERMS.commissionPct}% platform commission and payout terms.
            </ConsentCheckbox>
          </div>
        )}

        {/* Footer nav ------------------------------------------------------ */}
        <div style={css('display:flex;gap:12px;margin-top:20px;')}>
          {(step === 0 || step > 1 || editMode) && (
            <button
              type="button"
              // Step 1 has no Back during first-time setup: the account above it
              // already exists and cannot be re-entered. In edit mode the button
              // instead leaves the wizard back to the profile hub.
              onClick={() => (step === 0 ? navigate('/') : step === 1 ? navigate('/seller/profile') : goTo(step - 1))}
              disabled={busy}
              style={css('height:54px;padding:0 22px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:15px;font-weight:800;font-size:15px;cursor:pointer;font-family:inherit;')}
            >
              {editMode && step === 1 ? 'Cancel' : 'Back'}
            </button>
          )}
          <button
            type="button"
            onClick={step === 0 ? createAccount : step === 7 ? (editMode ? saveEdits : submit) : saveAndNext}
            disabled={busy || uploading != null}
            style={css(`flex:1;height:54px;border:none;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:${busy ? 'default' : 'pointer'};opacity:${busy || uploading ? 0.7 : 1};box-shadow:0 14px 30px -14px rgba(214,51,108,.8);display:flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;`)}
          >
            {uploading
              ? 'Uploading image…'
              : busy
                ? step === 0 ? 'Creating account…' : 'Saving…'
                : step === 0 ? 'Create account & continue' : step === 7 ? (editMode ? 'Save changes' : 'Submit for verification') : 'Save & continue'}
            {!busy && !uploading && <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>{step === 7 ? (editMode ? 'check' : 'send') : 'arrow_forward'}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Step 7 — a read-only summary with an Edit shortcut per section. */
/**
 * The resolved bank/branch for the IFSC currently typed.
 *
 * Shows a seller the human-readable consequence of the code they entered, which
 * is the only way a wrong-but-well-formed IFSC gets caught before an admin
 * transfers real money to it. Silent while the code is still being typed.
 */
function IfscStatusLine({ status }: { status: IfscStatus }) {
  if (status.kind === 'idle' || status.kind === 'typing') return null;

  const base = 'display:flex;align-items:flex-start;gap:8px;margin-top:-4px;font-size:11.5px;font-weight:700;line-height:1.45;';

  if (status.kind === 'checking') {
    return <span style={css(`${base}color:var(--ag-muted);`)}>Checking this IFSC…</span>;
  }
  if (status.kind === 'invalid') {
    return (
      <span style={css(`${base}color:var(--ag-danger-text);`)}>
        <span className="material-symbols-rounded" style={css('font-size:15px;')}>error</span>
        No bank branch is registered against this IFSC. Please check it against your passbook.
      </span>
    );
  }
  if (status.kind === 'unavailable') {
    return (
      <span style={css(`${base}color:var(--ag-muted);`)}>
        We couldn’t reach the IFSC directory just now — you can continue. Please check the code against your passbook yourself.
      </span>
    );
  }
  // Says what was matched, not just that something was. The tick sits below all
  // three bank fields, so an unlabelled "verified" reads as "your account is
  // verified" — which it is not: nothing here ever touches the account number.
  return (
    <span style={css(`${base}color:var(--ag-good);`)}>
      <span className="material-symbols-rounded" style={css('font-size:15px;')}>verified</span>
      <span>
        IFSC matched — {status.bank}
        {status.branch ? <><br /><span style={css('font-weight:600;color:var(--ag-muted);')}>{status.branch}{status.city ? `, ${status.city}` : ''}</span></> : null}
        <br />
        <span style={css('font-weight:600;color:var(--ag-muted);')}>
          This confirms the branch only — your account number is not checked here.
        </span>
      </span>
    </span>
  );
}

function ReviewStep({
  form, incomplete, onEdit, editMode,
}: {
  form: Form;
  incomplete: readonly { n: number; title: string }[];
  onEdit: (step: number) => void;
  editMode: boolean;
}) {
  // The account number is echoed back masked: the seller only needs to confirm
  // they typed the right one, and a shoulder-surfed review screen shouldn't
  // hand over a full account number.
  const maskAccount = (n: string) => (n.length > 4 ? `•••• ${n.slice(-4)}` : n);
  const dash = (s: string) => s.trim() || '—';

  const groups: { step: number; title: string; rows: [string, string][] }[] = [
    {
      step: 1, title: 'Boutique information',
      rows: [['Boutique name', dash(form.name)], ['Owner name', dash(form.ownerName)], ['Bio', dash(form.description)]],
    },
    {
      step: 2, title: 'Contact',
      rows: [['Mobile', dash(form.phone)], ['WhatsApp', form.whatsapp.trim() || form.phone || '—'], ['Email', dash(form.email)], ['Instagram', form.instagram.trim() ? `@${form.instagram.replace(/^@/, '')}` : '—']],
    },
    {
      step: 3, title: 'Shop address',
      rows: [['Address', dash(form.addressLine)], ['Area', dash(form.area)], ['City / district', `${dash(form.city)} · ${dash(form.district)}`], ['State / pincode', `${dash(form.state)} · ${dash(form.pincode)}`], ['Map location', form.mapUrl.trim() ? (form.lat && form.lng ? 'Pinned' : 'Link added') : '—']],
    },
    {
      step: 4, title: 'Business',
      rows: [['Categories', dash(joinCategories(form.categories))], ['GST number', dash(form.gstNumber)], ['Registration', dash(form.businessReg)], ['Years in business', dash(form.yearsInBusiness)]],
    },
    {
      step: 5, title: 'Store settings',
      rows: [
        ['Timing', form.openTime && form.closeTime ? `${form.openTime} – ${form.closeTime}` : '—'],
        ['Working days', form.workingDays.length ? form.workingDays.join(', ') : '—'],
        ['Delivery', form.deliveryAvailable ? `${describeReach(form.rates, form.city, form.district, form.state)} · from ₹${form.rates.local || 0}${Number(form.freeDeliveryOver) > 0 ? `, free over ₹${form.freeDeliveryOver} nearby` : ''}` : 'Store pickup only'],
        ['Dispatch', dispatchLabel(shopFulfilment({ dispatchMin: Number(form.fulfilment.dispatchMin), dispatchMax: Number(form.fulfilment.dispatchMax) }))],
        ['Returns', Number(form.fulfilment.returnWindowDays) > 0 ? `${form.fulfilment.returnWindowDays} days` : 'Faults only'],
        ['Payments', 'Online only — paid in full before the order reaches you'],
      ],
    },
    {
      step: 6, title: 'Payout details',
      rows: [['Account holder', dash(form.bankAccountName)], ['Account number', form.bankAccountNumber ? maskAccount(form.bankAccountNumber) : '—'], ['IFSC', dash(form.bankIfsc)]],
    },
  ];

  return (
    <div style={css('display:flex;flex-direction:column;gap:14px;')}>
      {incomplete.length > 0 && (
        <div style={css('background:var(--ag-surface-2);border:1px solid #F2C9D3;border-radius:16px;padding:14px 16px;display:flex;gap:11px;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-danger-text);")}>error</span>
          <div style={css('font-size:13px;color:#8E2B3C;font-weight:600;line-height:1.5;')}>
            {incomplete.length} step{incomplete.length > 1 ? 's are' : ' is'} still incomplete:{' '}
            {incomplete.map((s) => s.title).join(', ')}. Fix {incomplete.length > 1 ? 'them' : 'it'} before submitting.
          </div>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.step} style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:16px 18px;box-shadow:0 16px 38px -30px rgba(107,20,54,.6);')}>
          <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:17px;")}>{g.title}</div>
            <button
              type="button"
              onClick={() => onEdit(g.step)}
              style={css('border:none;background:none;color:var(--ag-crimson);font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:4px;font-family:inherit;')}
            >
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>edit</span>Edit
            </button>
          </div>
          <div style={css('margin-top:10px;display:flex;flex-direction:column;gap:8px;')}>
            {g.rows.map(([k, v]) => (
              <div key={k} style={css('display:flex;gap:12px;align-items:baseline;')}>
                <span style={css('flex:none;width:130px;font-size:12px;font-weight:700;color:var(--ag-muted);')}>{k}</span>
                <span style={css('flex:1;min-width:0;font-size:13.5px;font-weight:600;color:var(--ag-ink);word-break:break-word;')}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={css('background:var(--ag-good-bg);border:1px solid #CFE6D9;border-radius:16px;padding:14px 16px;display:flex;gap:11px;')}>
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-good);")}>verified_user</span>
        <div style={css('font-size:13px;color:#2C6249;font-weight:600;line-height:1.5;')}>
          {editMode
            ? 'Edit any section above, then Save changes. Your boutique stays live and your listings are unaffected — no re-approval needed.'
            : 'Our team reviews your boutique — usually within 24 hours. You can keep adding products while you wait; they go live to buyers the moment you are approved.'}
        </div>
      </div>
    </div>
  );
}
