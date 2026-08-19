import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { updateBoutique, type BoutiquePatch } from '@/data/boutiques';
import { fetchParcelDefaults, saveParcelDefaults, type ParcelDefaults } from '@/data/shipments';
import { Field, TextArea, ChipPicker, Toggle, SectionCard, Row } from '@/components/seller/FormKit';
import { DeliveryRateCard, zoneRatesToForm, zoneRatesToPatch, type ZoneRateForm } from '@/components/seller/DeliveryRateCard';
import { FulfilmentCard, fulfilmentToForm, fulfilmentToPatch, validateFulfilment, type FulfilmentForm } from '@/components/seller/FulfilmentCard';
import { isMapsLink } from '@/lib/geolocate';
import { ShopLocationPicker } from '@/components/seller/ShopLocationPicker';
import { ThemeToggle } from '@/components/ThemeToggle';
import { WORKING_DAYS } from '@/data/types';

/**
 * Seller settings — the store configuration the setup wizard collects, editable
 * afterwards.
 *
 * Every control here writes to the boutique row. The previous version kept its
 * toggles in component state with no persistence (and offered a "Dark mode"
 * switch the app has no support for), so a seller who turned delivery off found
 * it back on after a reload.
 */

type Form = {
  instagram: string; mapUrl: string; lat: string; lng: string; phone: string; whatsapp: string; email: string;
  openTime: string; closeTime: string; workingDays: string[];
  deliveryAvailable: boolean; deliveryAreas: string; rates: ZoneRateForm; freeDeliveryOver: string;
  fulfilment: FulfilmentForm;
  notifyOrders: boolean; notifyMessages: boolean; notifyPromotions: boolean;
};

const EMPTY: Form = {
  instagram: '', mapUrl: '', lat: '', lng: '', phone: '', whatsapp: '', email: '',
  openTime: '', closeTime: '', workingDays: [],
  deliveryAvailable: true, deliveryAreas: '', rates: { local: '0', district: '', state: '', national: '' }, freeDeliveryOver: '0',
  fulfilment: { dispatchMin: '1', dispatchMax: '2', returnWindowDays: '7' },
  notifyOrders: true, notifyMessages: true, notifyPromotions: false,
};

const PHONE_RE = /^[6-9][0-9]{9}$/;

export function Settings() {
  const navigate = useNavigate();
  const { showToast } = useShop();
  const { boutique, reload } = useMyBoutique();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [saving, setSaving] = useState(false);
  // Kept out of `Form` and loaded separately: these columns arrive with
  // migration 0065, and null means "not applied yet", which hides the section
  // rather than saving a value the database has nowhere to put.
  const [parcel, setParcel] = useState<ParcelDefaults | null>(null);

  const setParcelField = (key: keyof ParcelDefaults, raw: string) =>
    setParcel((p) => (p ? { ...p, [key]: Number(raw.replace(/[^\d.]/g, '')) || 0 } : p));

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  };


  // Seed from the signed-in seller's own boutique row rather than sample copy.
  useEffect(() => {
    if (!boutique) return;
    setForm({
      instagram: boutique.instagram ?? '',
      mapUrl: boutique.map_url ?? '',
      lat: boutique.latitude != null ? String(boutique.latitude) : '',
      lng: boutique.longitude != null ? String(boutique.longitude) : '',
      phone: boutique.phone ?? '',
      whatsapp: boutique.whatsapp ?? '',
      email: boutique.email ?? '',
      openTime: boutique.open_time || '10:00',
      closeTime: boutique.close_time || '20:00',
      workingDays: boutique.working_days?.length ? boutique.working_days : [...WORKING_DAYS].slice(0, 6),
      deliveryAvailable: boutique.delivery_available ?? true,
      deliveryAreas: boutique.delivery_areas ?? '',
      rates: zoneRatesToForm(boutique),
      fulfilment: fulfilmentToForm(boutique),
      freeDeliveryOver: boutique.free_delivery_over != null ? String(boutique.free_delivery_over) : '0',
      notifyOrders: boutique.notify_orders ?? true,
      notifyMessages: boutique.notify_messages ?? true,
      notifyPromotions: boutique.notify_promotions ?? false,
    });
  }, [boutique]);

  useEffect(() => {
    if (!boutique) return;
    let live = true;
    void fetchParcelDefaults(boutique.id).then((p) => { if (live) setParcel(p); });
    return () => { live = false; };
  }, [boutique]);

  const save = async () => {
    if (!boutique) return showToast('No boutique linked to this account yet');

    const next: Partial<Record<keyof Form, string>> = {};
    // The map pin is required here for the same reason it is in the setup wizard
    // — a courier, and a buyer driving over, need the point rather than the
    // street. An existing shop that never set one is asked for it on its next
    // save, which is the only moment we can ask without nagging.
    if (!form.mapUrl.trim()) next.mapUrl = 'Set your exact shop location on the map';
    else if (!isMapsLink(form.mapUrl)) next.mapUrl = 'That is not a Google Maps link — use the button, or Maps → Share → Copy link';
    if (form.phone.trim() && !PHONE_RE.test(form.phone.trim())) next.phone = 'Enter a 10-digit mobile number';
    if (form.whatsapp.trim() && !PHONE_RE.test(form.whatsapp.trim())) next.whatsapp = 'Enter a 10-digit WhatsApp number';
    if (form.workingDays.length === 0) next.workingDays = 'Pick at least one working day';
    if (form.deliveryAvailable && !form.deliveryAreas.trim()) next.deliveryAreas = 'List the areas you deliver to';
    const badFulfilment = validateFulfilment(form.fulfilment);
    if (badFulfilment) next.fulfilment = badFulfilment;
    if (Object.keys(next).length) {
      setErrors(next);
      return showToast('Please fix the highlighted fields');
    }

    const patch: BoutiquePatch = {
      instagram: form.instagram.trim().replace(/^@/, '') || null,
      map_url: form.mapUrl.trim() || null,
      latitude: form.lat.trim() ? Number(form.lat) : null,
      longitude: form.lng.trim() ? Number(form.lng) : null,
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || form.phone.trim() || null,
      email: form.email.trim() || null,
      open_time: form.openTime,
      close_time: form.closeTime,
      working_days: form.workingDays,
      delivery_available: form.deliveryAvailable,
      delivery_areas: form.deliveryAreas.trim(),
      ...zoneRatesToPatch(form.rates),
      ...fulfilmentToPatch(form.fulfilment),
      free_delivery_over: Number(form.freeDeliveryOver || 0),
      // Prepaid-only platform. `cod_enabled` is deliberately NOT written here —
      // a trigger in migration 0085 pins it false on every insert and update, so
      // the database owns it and no client can turn it back on.
      online_payment_enabled: true,
      notify_orders: form.notifyOrders,
      notify_messages: form.notifyMessages,
      notify_promotions: form.notifyPromotions,
    };

    setSaving(true);
    try {
      await updateBoutique(boutique.id, patch);
      // Separate write, same button. A failure here must not roll back the rest
      // of the settings, so it reports on its own rather than failing the save.
      if (parcel) {
        try {
          await saveParcelDefaults(boutique.id, parcel);
        } catch (e) {
          showToast(e instanceof Error ? e.message : 'Parcel defaults could not be saved');
        }
      }
      reload();
      showToast('Settings saved');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save your settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('padding:6px 0 14px;display:flex;align-items:center;gap:10px;')}>
        <button
          aria-label="Go back"
          onClick={() => navigate('/seller/profile')}
          style={css('width:42px;height:42px;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
        </button>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;")}>Settings</h1>
      </div>

      <div style={css('max-width:760px;display:flex;flex-direction:column;gap:16px;')}>
        <SectionCard title="Appearance" subtitle="Follows your device by default; switch to Light or Dark whenever you like.">
          <ThemeToggle variant="inline" />
        </SectionCard>

        <SectionCard title="Contact & social" subtitle="How buyers reach you from your boutique page.">
          <Row>
            <Field label="Mobile number" value={form.phone} onChange={(v) => set('phone', v.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" inputMode="tel" error={errors.phone} />
            <Field label="WhatsApp number" value={form.whatsapp} onChange={(v) => set('whatsapp', v.replace(/\D/g, '').slice(0, 10))} placeholder="9876543210" inputMode="tel" error={errors.whatsapp} hint="Blank reuses your mobile." />
          </Row>
          <Field label="Email address" value={form.email} onChange={(v) => set('email', v)} placeholder="you@boutique.com" inputMode="email" />
          <Field label="Instagram username" value={form.instagram} onChange={(v) => set('instagram', v)} placeholder="yourboutique" hint="Without the @. Opens your profile from the Instagram button on your shop page." />
          {/* Checked against the address on the boutique row, so a pin taken at
              home instead of at the shop is called out. See ShopLocationPicker. */}
          <ShopLocationPicker
            mapUrl={form.mapUrl}
            lat={form.lat}
            lng={form.lng}
            onChange={(next) => {
              setForm((f) => ({ ...f, ...next }));
              setErrors((e) => (e.mapUrl ? { ...e, mapUrl: undefined } : e));
            }}
            error={errors.mapUrl}
            expected={{
              pincode: boutique?.pincode ?? undefined,
              city: boutique?.city ?? undefined,
              district: boutique?.district ?? undefined,
              state: boutique?.state ?? undefined,
            }}
          />
        </SectionCard>

        <SectionCard title="Store timing" subtitle="Shown to buyers, so they know when you are open.">
          <Row>
            <Field label="Opening time" value={form.openTime} onChange={(v) => set('openTime', v)} type="time" />
            <Field label="Closing time" value={form.closeTime} onChange={(v) => set('closeTime', v)} type="time" />
          </Row>
          <ChipPicker label="Working days" options={WORKING_DAYS} value={form.workingDays} onChange={(next) => set('workingDays', next)} multiple error={errors.workingDays} />
        </SectionCard>

        {/* These are the buyer's actual charges, not notes to yourself — the
            platform no longer sets a delivery fee of its own (migration 0076),
            and they vary by distance (0077). */}
        <SectionCard title="Delivery" subtitle="What buyers pay you to deliver. Your numbers, charged at checkout.">
          <Toggle label="Delivery available" description="Turn off if buyers must collect from your shop" icon="local_shipping" on={form.deliveryAvailable} onChange={(v) => set('deliveryAvailable', v)} />
          {form.deliveryAvailable && (
            <>
              <DeliveryRateCard
                value={form.rates}
                onChange={(next) => set('rates', next)}
                places={{ city: boutique?.city, district: boutique?.district, state: boutique?.state }}
                freeDeliveryOver={form.freeDeliveryOver}
                onFreeDeliveryOverChange={(v) => set('freeDeliveryOver', v)}
              />
              <TextArea
                label="Delivery areas"
                value={form.deliveryAreas}
                onChange={(v) => set('deliveryAreas', v)}
                placeholder="Coimbatore city, Tirupur, Erode"
                error={errors.deliveryAreas}
                hint="Shown on your shop page as a description. What buyers are actually charged — and whether they can order at all — comes from the bands above."
              />
            </>
          )}
        </SectionCard>

        <SectionCard title="Dispatch & returns" subtitle="What buyers are promised on every product you list.">
          <FulfilmentCard value={form.fulfilment} onChange={(next) => set('fulfilment', next)} error={errors.fulfilment} />
        </SectionCard>

        {parcel && (
          <SectionCard
            title="Parcel defaults"
            subtitle="Used when a courier is booked, for any product with no weight of its own."
          >
            <Field
              label="Default weight (grams)"
              value={String(parcel.default_weight_grams)}
              onChange={(v) => setParcelField('default_weight_grams', v)}
              inputMode="numeric"
              placeholder="500"
              hint="A typical packed piece from your shop. Set weights on individual products where they differ."
            />
            <Row>
              <Field label="Box length (cm)" value={String(parcel.package_length_cm)} onChange={(v) => setParcelField('package_length_cm', v)} inputMode="numeric" placeholder="30" />
              <Field label="Box breadth (cm)" value={String(parcel.package_breadth_cm)} onChange={(v) => setParcelField('package_breadth_cm', v)} inputMode="numeric" placeholder="24" />
            </Row>
            <Field
              label="Box height (cm)"
              value={String(parcel.package_height_cm)}
              onChange={(v) => setParcelField('package_height_cm', v)}
              inputMode="numeric"
              placeholder="6"
              hint="Couriers charge on whichever is greater — the real weight or the size of the box — so an oversized box costs you money."
            />
          </SectionCard>
        )}

        {/* No longer a setting — MangaiMart withdrew cash on delivery. Kept as a
            visible statement rather than deleted outright, because a seller who
            had it switched on will come looking for the toggle. */}
        <SectionCard title="Payments accepted">
          <div style={css('display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:14px;background:var(--ag-surface-2);border:1px solid var(--ag-border);')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-good);")}>verified_user</span>
            <div style={css('font-size:13px;line-height:1.55;color:var(--ag-ink-2);')}>
              <div style={css('font-weight:800;color:var(--ag-ink);')}>Online payment only</div>
              Every order is paid in full through Razorpay before it reaches you — card, UPI or netbanking.
              Cash on delivery has been withdrawn across MangaiMart, so you no longer send stock that has not
              been paid for, and there is no cash to count or hand back at the door.
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Notifications" subtitle="What lands in your notifications inbox.">
          <Toggle label="New orders" description="Every time a buyer places an order" icon="shopping_bag" on={form.notifyOrders} onChange={(v) => set('notifyOrders', v)} />
          <Toggle label="Customer messages" description="When a buyer starts or replies to a chat" icon="chat_bubble" on={form.notifyMessages} onChange={(v) => set('notifyMessages', v)} />
          <Toggle label="Offers & platform updates" description="MangaiMart news, promotions and feature announcements" icon="campaign" on={form.notifyPromotions} onChange={(v) => set('notifyPromotions', v)} />
        </SectionCard>

        <button
          onClick={save}
          disabled={saving || !boutique}
          style={css(`width:100%;height:54px;border:none;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);opacity:${saving || !boutique ? 0.6 : 1};font-family:inherit;`)}
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>

        <button
          onClick={() => navigate('/')}
          style={css('width:100%;display:flex;align-items:center;gap:13px;padding:14px 15px;border:1px solid var(--ag-surface-3);border-radius:16px;background:var(--ag-surface);color:var(--ag-crimson);cursor:pointer;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);text-align:left;font-family:inherit;')}
        >
          <span style={css('width:40px;height:40px;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;flex:none;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:22px;")}>swap_horiz</span>
          </span>
          <span style={css('flex:1;')}>
            <span style={css('display:block;font-weight:800;font-size:15px;')}>Switch to Buyer</span>
            <span style={css('display:block;font-size:12.5px;color:var(--ag-muted);margin-top:2px;')}>Shop on MangaiMart as a customer</span>
          </span>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;")}>chevron_right</span>
        </button>
      </div>
    </div>
  );
}
