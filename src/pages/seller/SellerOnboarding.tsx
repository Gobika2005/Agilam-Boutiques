import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { FullscreenLoader } from '@/auth/RequireRole';
import { useToast } from '@/components/ui/Toast';
import { Field, TextArea, ChipPicker, Toggle, SectionCard, Row } from '@/components/seller/FormKit';
import { resolveDisplayName } from '@/lib/displayName';
import { CROP, useImageCropper } from '@/components/ui/ImageCropper';
import { signInWithGoogle, friendlyAuthError } from '@/lib/authMethods';
import { ConsentCheckbox, ConsentNotice, PolicyLinks, CONSENT_REQUIRED } from '@/components/legal/Consent';
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
 * Step 0 — the Agilam login itself. It is numbered 0 so the DB's
 * `onboarding_step` (1–7, the boutique steps) keeps its existing meaning; only
 * the labels count from one.
 */
const ACCOUNT_STEP = { n: 0, title: 'Your account', sub: 'The login you will manage your boutique with', icon: 'person_add' } as const;
const ALL_STEPS = [ACCOUNT_STEP, ...STEPS];

const CATEGORIES = [
  'Sarees', 'Kurtis & Salwar', 'Bridal Wear', 'Lehengas & Gowns',
  'Kids Wear', 'Menswear', 'Accessories', 'Tailoring & Custom',
] as const;

const INDIAN_STATES = [
  'Tamil Nadu', 'Kerala', 'Karnataka', 'Andhra Pradesh', 'Telangana', 'Maharashtra',
  'Gujarat', 'Delhi', 'Puducherry', 'West Bengal', 'Rajasthan', 'Uttar Pradesh',
] as const;

const PIN_RE = /^[1-9][0-9]{5}$/;
const PHONE_RE = /^[6-9][0-9]{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const UPI_RE = /^[\w.-]{2,}@[a-zA-Z]{2,}$/;

type Form = {
  name: string; ownerName: string; description: string; logoUrl: string; coverUrl: string;
  phone: string; whatsapp: string; email: string; instagram: string;
  addressLine: string; area: string; city: string; district: string; state: string; pincode: string; mapUrl: string;
  categories: string[]; gstNumber: string; businessReg: string; yearsInBusiness: string;
  openTime: string; closeTime: string; workingDays: string[];
  deliveryAvailable: boolean; deliveryAreas: string; deliveryCharge: string;
  codEnabled: boolean; onlinePaymentEnabled: boolean;
  bankAccountName: string; bankAccountNumber: string; bankIfsc: string; upiId: string;
};

const EMPTY: Form = {
  name: '', ownerName: '', description: '', logoUrl: '', coverUrl: '',
  phone: '', whatsapp: '', email: '', instagram: '',
  addressLine: '', area: '', city: '', district: '', state: '', pincode: '', mapUrl: '',
  categories: [], gstNumber: '', businessReg: '', yearsInBusiness: '',
  openTime: '10:00', closeTime: '20:00', workingDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  deliveryAvailable: true, deliveryAreas: '', deliveryCharge: '0',
  codEnabled: true, onlinePaymentEnabled: true,
  bankAccountName: '', bankAccountNumber: '', bankIfsc: '', upiId: '',
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
function validateStep(step: number, f: Form): Errors {
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
    if (!f.city.trim()) e.city = 'Enter your city';
    if (!f.district.trim()) e.district = 'Enter your district';
    if (!f.state.trim()) e.state = 'Select your state';
    if (!PIN_RE.test(f.pincode.trim())) e.pincode = 'Enter a valid 6-digit pincode';
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
    if (!f.codEnabled && !f.onlinePaymentEnabled) e.codEnabled = 'Enable at least one payment method';
  }
  if (step === 6) {
    const hasBank = !!(f.bankAccountName.trim() || f.bankAccountNumber.trim() || f.bankIfsc.trim());
    const hasUpi = !!f.upiId.trim();
    if (!hasBank && !hasUpi) e.upiId = 'Add a UPI ID or your bank account details';
    if (hasBank) {
      if (f.bankAccountName.trim().length < 3) e.bankAccountName = 'Enter the account holder name';
      if (!/^[0-9]{9,18}$/.test(f.bankAccountNumber.trim())) e.bankAccountNumber = 'Enter a valid account number';
      if (!IFSC_RE.test(f.bankIfsc.trim().toUpperCase())) e.bankIfsc = 'Enter a valid IFSC code';
    }
    if (hasUpi && !UPI_RE.test(f.upiId.trim())) e.upiId = 'Enter a valid UPI ID (name@bank)';
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
    category: joinCategories(f.categories),
    gst_number: orNull(f.gstNumber.toUpperCase()),
    business_reg_number: orNull(f.businessReg),
    years_in_business: f.yearsInBusiness.trim() ? Number(f.yearsInBusiness) : null,
    open_time: f.openTime,
    close_time: f.closeTime,
    working_days: f.workingDays,
    delivery_available: f.deliveryAvailable,
    delivery_areas: f.deliveryAreas.trim(),
    delivery_charge: Number(f.deliveryCharge || 0),
    cod_enabled: f.codEnabled,
    online_payment_enabled: f.onlinePaymentEnabled,
    bank_account_name: orNull(f.bankAccountName),
    bank_account_number: orNull(f.bankAccountNumber),
    bank_ifsc: orNull(f.bankIfsc.toUpperCase()),
    upi_id: orNull(f.upiId),
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
          navigate('/admin/overview', { replace: true });
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

        // Already submitted or live? There is nothing left to fill in here.
        if (row.onboarding_complete && row.status !== 'changes_requested') {
          navigate(row.status === 'approved' ? '/seller/dashboard' : '/seller/verification', { replace: true });
          return;
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
          categories: splitCategories(row.category),
          gstNumber: priv?.gst_number ?? '',
          businessReg: priv?.business_reg_number ?? '',
          yearsInBusiness: row.years_in_business != null ? String(row.years_in_business) : '',
          openTime: row.open_time || EMPTY.openTime,
          closeTime: row.close_time || EMPTY.closeTime,
          workingDays: row.working_days?.length ? row.working_days : EMPTY.workingDays,
          deliveryAvailable: row.delivery_available ?? true,
          deliveryAreas: row.delivery_areas ?? '',
          deliveryCharge: row.delivery_charge != null ? String(row.delivery_charge) : '0',
          codEnabled: row.cod_enabled ?? true,
          onlinePaymentEnabled: row.online_payment_enabled ?? true,
          bankAccountName: priv?.bank_account_name ?? '',
          bankAccountNumber: priv?.bank_account_number ?? '',
          bankIfsc: priv?.bank_ifsc ?? '',
          upiId: priv?.upi_id ?? '',
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
      const url = await uploadBoutiqueImage(boutique.id, kind, file);
      set(kind === 'logo' ? 'logoUrl' : 'coverUrl', url);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Image upload failed');
    } finally {
      setUploading(null);
    }
  };

  // Steps the seller has not satisfied yet — drives the review checklist and
  // stops a half-filled boutique from reaching the admin queue.
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
    const stepErrors = validateStep(step, form);
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
    <div ref={topRef} style={css('min-height:100vh;background:#FBF6F2;padding-bottom:40px;')}>
      {cropper}
      {/* Header ------------------------------------------------------------ */}
      <div style={css('background:linear-gradient(135deg,#8E1C44 0%,#B02454 52%,#D6336C 100%);color:#fff;position:relative;overflow:hidden;')}>
        <div style={css('position:absolute;top:-90px;right:-50px;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(244,217,166,.22),transparent 70%);pointer-events:none;')} />
        <div style={css('max-width:900px;margin:0 auto;padding:clamp(22px,3.5vw,38px) clamp(18px,4vw,32px);position:relative;')}>
          <div className="agx-eyebrow" style={css('font-size:9.5px;color:#F4D9A6;')}>
            {isResubmission ? 'Update & resubmit' : step === 0 ? 'Create your boutique' : 'Seller setup'}
          </div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(24px,3.2vw,34px);margin-top:6px;line-height:1.15;")}>
            {isResubmission ? 'Fix the details and resubmit' : step === 0 ? 'Open your boutique on Agilam' : 'Set up your boutique'}
          </div>
          <div style={css('opacity:.88;font-size:13.5px;margin-top:6px;max-width:520px;')}>
            Create your login, then eight quick steps to your boutique. Everything after the first step is saved as you go, so you can stop and come back any time.
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
                    {done && !on ? <span style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>check</span> : i + 1}
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
          <div style={css('background:#FFF6E8;border:1px solid #F0DCB4;border-radius:16px;padding:14px 16px;margin-bottom:16px;display:flex;gap:11px;')}>
            <span style={css("font-family:'Material Symbols Outlined';color:#B9862F;")}>edit_note</span>
            <div style={css('font-size:13px;color:#7A5C2A;font-weight:600;line-height:1.5;')}>
              Our team asked for a few changes. Update the details below and submit again — everything you already entered is filled in.
            </div>
          </div>
        )}

        <div style={css('display:flex;align-items:center;gap:12px;margin-bottom:16px;')}>
          <span style={css('width:44px;height:44px;flex:none;border-radius:14px;background:#FCE0EC;display:flex;align-items:center;justify-content:center;')}>
            <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:23px;")}>{active.icon}</span>
          </span>
          <div>
            <div className="agx-eyebrow" style={css('font-size:9.5px;color:#B02454;')}>Step {active.n + 1} of {ALL_STEPS.length}</div>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;line-height:1.2;margin-top:2px;")}>{active.title}</div>
            <div style={css('font-size:12.5px;color:#A98D99;font-weight:600;')}>{active.sub}</div>
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
              <span style={css('flex:1;height:1px;background:#F2E4EA;')} />
              <span style={css('font-size:11px;font-weight:700;color:#C0A5B0;')}>OR</span>
              <span style={css('flex:1;height:1px;background:#F2E4EA;')} />
            </div>
            <button
              type="button"
              onClick={continueWithGoogle}
              style={css('height:50px;border:1.5px solid #F0D8E2;background:#fff;border-radius:14px;font-weight:700;font-size:14px;cursor:pointer;color:#2A1A20;display:flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;')}
            >
              <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:#D6336C;")}>g_translate</span>Continue with Google
            </button>

            <ConsentNotice />

            <div style={css('text-align:center;font-size:13px;color:#8A7078;font-weight:600;')}>
              Already have a boutique account?{' '}
              <button
                type="button"
                onClick={() => navigate('/auth/signin/seller')}
                style={css('border:none;background:none;color:#B02454;font-weight:800;font-size:13px;cursor:pointer;padding:0;font-family:inherit;')}
              >
                Sign in
              </button>
            </div>
          </SectionCard>
        )}

        {step === 1 && (
          <SectionCard>
            <div>
              <div style={css('font-size:13px;font-weight:700;color:#7A5C67;')}>Boutique logo & cover *</div>
              <div style={css('display:flex;gap:12px;margin-top:8px;align-items:stretch;')}>
                <div
                  onClick={() => logoInput.current?.click()}
                  style={css(`width:104px;height:104px;flex:none;border-radius:18px;border:2px dashed ${errors.logoUrl ? '#E7A7B4' : '#E6BCCF'};background:#fff;position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;`)}
                >
                  {form.logoUrl ? (
                    <img src={form.logoUrl} alt="Boutique logo" style={css('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;')} />
                  ) : (
                    <>
                      <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:24px;")}>{uploading === 'logo' ? 'progress_activity' : 'add_a_photo'}</span>
                      <span style={css('font-size:10.5px;color:#B79AA6;font-weight:700;')}>Logo *</span>
                    </>
                  )}
                  <input ref={logoInput} type="file" accept="image/*" style={css('display:none;')} onChange={(e) => { void pickImage('logo', e.target.files?.[0]); e.target.value = ''; }} />
                </div>
                <div
                  onClick={() => coverInput.current?.click()}
                  style={css('flex:1;min-width:0;height:104px;border-radius:18px;border:2px dashed #E6BCCF;background:#fff;position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;cursor:pointer;')}
                >
                  {form.coverUrl ? (
                    <img src={form.coverUrl} alt="Boutique cover" style={css('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;')} />
                  ) : (
                    <>
                      <span style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:24px;")}>{uploading === 'cover' ? 'progress_activity' : 'wallpaper'}</span>
                      <span style={css('font-size:10.5px;color:#B79AA6;font-weight:700;')}>Cover image</span>
                    </>
                  )}
                  <input ref={coverInput} type="file" accept="image/*" style={css('display:none;')} onChange={(e) => { void pickImage('cover', e.target.files?.[0]); e.target.value = ''; }} />
                </div>
              </div>
              {errors.logoUrl && <span style={css('display:block;margin-top:4px;font-size:11.5px;font-weight:700;color:#D6455A;')}>{errors.logoUrl}</span>}
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
            <Row>
              <Field label="Area / locality" value={form.area} onChange={(v) => set('area', v)} placeholder="RS Puram" />
              <Field label="City *" value={form.city} onChange={(v) => set('city', v)} placeholder="Coimbatore" error={errors.city} />
            </Row>
            <Row>
              <Field label="District *" value={form.district} onChange={(v) => set('district', v)} placeholder="Coimbatore" error={errors.district} />
              <Field label="Pincode *" value={form.pincode} onChange={(v) => set('pincode', v.replace(/\D/g, '').slice(0, 6))} placeholder="641002" inputMode="numeric" error={errors.pincode} />
            </Row>
            <ChipPicker label="State *" options={INDIAN_STATES} value={form.state ? [form.state] : []} onChange={(next) => set('state', next[0] ?? '')} error={errors.state} />
            <Field label="Google Maps link" value={form.mapUrl} onChange={(v) => set('mapUrl', v)} placeholder="https://maps.app.goo.gl/…" inputMode="url" hint="Open your shop in Google Maps, tap Share, and paste the link here." />
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

            <SectionCard title="Delivery">
              <Toggle label="Delivery available" description="Turn off if buyers must collect from your shop" icon="local_shipping" on={form.deliveryAvailable} onChange={(v) => set('deliveryAvailable', v)} />
              {form.deliveryAvailable && (
                <>
                  <TextArea label="Delivery areas *" value={form.deliveryAreas} onChange={(v) => set('deliveryAreas', v)} placeholder="Coimbatore city, Tirupur, Erode" error={errors.deliveryAreas} />
                  <Field label="Delivery charge (₹)" value={form.deliveryCharge} onChange={(v) => set('deliveryCharge', v.replace(/[^\d.]/g, ''))} placeholder="0" inputMode="numeric" hint="Enter 0 for free delivery." />
                </>
              )}
            </SectionCard>

            <SectionCard title="Payments accepted">
              <Toggle label="Cash on delivery" description="Buyers pay when the order arrives" icon="payments" on={form.codEnabled} onChange={(v) => set('codEnabled', v)} />
              <Toggle label="Online payment" description="Card, UPI and netbanking through Razorpay" icon="credit_card" on={form.onlinePaymentEnabled} onChange={(v) => set('onlinePaymentEnabled', v)} />
              {errors.codEnabled && <span style={css('font-size:11.5px;font-weight:700;color:#D6455A;')}>{errors.codEnabled}</span>}
            </SectionCard>
          </div>
        )}

        {step === 6 && (
          <SectionCard subtitle="Agilam sends your order payouts here. These details stay private — buyers and other sellers can never see them.">
            <Field label="UPI ID" value={form.upiId} onChange={(v) => set('upiId', v)} placeholder="boutique@okaxis" error={errors.upiId} hint="Fastest way to get paid. Add this, or your bank account below." />
            <div style={css('display:flex;align-items:center;gap:10px;')}>
              <span style={css('flex:1;height:1px;background:#F2E4EA;')} />
              <span style={css('font-size:11px;font-weight:700;color:#C0A5B0;')}>AND / OR BANK ACCOUNT</span>
              <span style={css('flex:1;height:1px;background:#F2E4EA;')} />
            </div>
            <Field label="Account holder name" value={form.bankAccountName} onChange={(v) => set('bankAccountName', v)} placeholder="Lakshmi Priya" error={errors.bankAccountName} />
            <Field label="Bank account number" value={form.bankAccountNumber} onChange={(v) => set('bankAccountNumber', v.replace(/\D/g, '').slice(0, 18))} placeholder="123456789012" inputMode="numeric" error={errors.bankAccountNumber} />
            <Field label="IFSC code" value={form.bankIfsc} onChange={(v) => set('bankIfsc', v.toUpperCase().slice(0, 11))} placeholder="HDFC0001234" error={errors.bankIfsc} />
          </SectionCard>
        )}

        {step === 7 && <ReviewStep form={form} incomplete={incomplete} onEdit={goTo} />}

        {step === 7 && (
          <div style={css('margin-top:16px;background:#fff;border:1px solid #F2E4EA;border-radius:16px;padding:16px 18px;box-shadow:0 16px 38px -30px rgba(107,20,54,.6);')}>
            <ConsentCheckbox checked={sellerConsent} onChange={setSellerConsent}>
              I have read and agree to the Seller Agreement, <PolicyLinks />, including the 8% platform commission and payout terms.
            </ConsentCheckbox>
          </div>
        )}

        {/* Footer nav ------------------------------------------------------ */}
        <div style={css('display:flex;gap:12px;margin-top:20px;')}>
          {(step === 0 || step > 1) && (
            <button
              type="button"
              // Step 1 has no Back on purpose: the account above it already
              // exists and cannot be re-entered.
              onClick={() => (step === 0 ? navigate('/buyer/home') : goTo(step - 1))}
              disabled={busy}
              style={css('height:54px;padding:0 22px;border:1.5px solid #F0D8E2;background:#fff;color:#B02454;border-radius:15px;font-weight:800;font-size:15px;cursor:pointer;font-family:inherit;')}
            >
              Back
            </button>
          )}
          <button
            type="button"
            onClick={step === 0 ? createAccount : step === 7 ? submit : saveAndNext}
            disabled={busy || uploading != null}
            style={css(`flex:1;height:54px;border:none;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:${busy ? 'default' : 'pointer'};opacity:${busy || uploading ? 0.7 : 1};box-shadow:0 14px 30px -14px rgba(214,51,108,.8);display:flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;`)}
          >
            {uploading
              ? 'Uploading image…'
              : busy
                ? step === 0 ? 'Creating account…' : 'Saving…'
                : step === 0 ? 'Create account & continue' : step === 7 ? 'Submit for verification' : 'Save & continue'}
            {!busy && !uploading && <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>{step === 7 ? 'send' : 'arrow_forward'}</span>}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Step 7 — a read-only summary with an Edit shortcut per section. */
function ReviewStep({
  form, incomplete, onEdit,
}: {
  form: Form;
  incomplete: readonly { n: number; title: string }[];
  onEdit: (step: number) => void;
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
      rows: [['Address', dash(form.addressLine)], ['Area', dash(form.area)], ['City / district', `${dash(form.city)} · ${dash(form.district)}`], ['State / pincode', `${dash(form.state)} · ${dash(form.pincode)}`], ['Map link', form.mapUrl.trim() ? 'Added' : '—']],
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
        ['Delivery', form.deliveryAvailable ? `${dash(form.deliveryAreas)} · ₹${form.deliveryCharge || 0}` : 'Store pickup only'],
        ['Payments', [form.codEnabled && 'Cash on delivery', form.onlinePaymentEnabled && 'Online'].filter(Boolean).join(', ') || '—'],
      ],
    },
    {
      step: 6, title: 'Payout details',
      rows: [['UPI ID', dash(form.upiId)], ['Account holder', dash(form.bankAccountName)], ['Account number', form.bankAccountNumber ? maskAccount(form.bankAccountNumber) : '—'], ['IFSC', dash(form.bankIfsc)]],
    },
  ];

  return (
    <div style={css('display:flex;flex-direction:column;gap:14px;')}>
      {incomplete.length > 0 && (
        <div style={css('background:#FFF3F5;border:1px solid #F2C9D3;border-radius:16px;padding:14px 16px;display:flex;gap:11px;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:#D6455A;")}>error</span>
          <div style={css('font-size:13px;color:#8E2B3C;font-weight:600;line-height:1.5;')}>
            {incomplete.length} step{incomplete.length > 1 ? 's are' : ' is'} still incomplete:{' '}
            {incomplete.map((s) => s.title).join(', ')}. Fix {incomplete.length > 1 ? 'them' : 'it'} before submitting.
          </div>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.step} style={css('background:#fff;border:1px solid #F2E4EA;border-radius:20px;padding:16px 18px;box-shadow:0 16px 38px -30px rgba(107,20,54,.6);')}>
          <div style={css('display:flex;align-items:center;justify-content:space-between;gap:10px;')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:17px;")}>{g.title}</div>
            <button
              type="button"
              onClick={() => onEdit(g.step)}
              style={css('border:none;background:none;color:#B02454;font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:4px;font-family:inherit;')}
            >
              <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>edit</span>Edit
            </button>
          </div>
          <div style={css('margin-top:10px;display:flex;flex-direction:column;gap:8px;')}>
            {g.rows.map(([k, v]) => (
              <div key={k} style={css('display:flex;gap:12px;align-items:baseline;')}>
                <span style={css('flex:none;width:130px;font-size:12px;font-weight:700;color:#A98D99;')}>{k}</span>
                <span style={css('flex:1;min-width:0;font-size:13.5px;font-weight:600;color:#2A1A20;word-break:break-word;')}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div style={css('background:#F3F9F5;border:1px solid #CFE6D9;border-radius:16px;padding:14px 16px;display:flex;gap:11px;')}>
        <span style={css("font-family:'Material Symbols Outlined';color:#2FA36B;")}>verified_user</span>
        <div style={css('font-size:13px;color:#2C6249;font-weight:600;line-height:1.5;')}>
          Our team reviews your boutique — usually within 24 hours. You can keep adding products while you wait; they go live to buyers the moment you are approved.
        </div>
      </div>
    </div>
  );
}
