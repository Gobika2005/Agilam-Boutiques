import { css } from '@/lib/css';
import { Field } from '@/components/seller/FormKit';

/**
 * The shop's delivery rate card — one charge per distance band.
 *
 * A seller used to set ONE delivery charge, next to a free-text "delivery areas"
 * box they could fill with "All Over Tamil Nadu" or "All India". So the same
 * rupees had to cover a parcel handed over the counter and a parcel crossing
 * three states, and one of those two was always priced wrong. Since migration
 * 0077 the bands are priced separately and the buyer's pincode picks one.
 *
 * Blank is a real answer, and the most important one on this screen: it means
 * "I don't deliver that far", and checkout then refuses that address rather than
 * quoting a price the seller never agreed to. That is why the fields are not
 * required and why the empty state says so rather than defaulting to 0 — 0 here
 * would mean free delivery to the far end of India.
 *
 * Shared by the setup wizard's store-settings step and the seller settings
 * screen so the two cannot drift.
 */

export type ZoneRateForm = {
  local: string;
  district: string;
  state: string;
  national: string;
};

/** '' ↔ null at the edges: the form holds strings, the row holds nullable numbers. */
export const zoneRatesToForm = (row: {
  delivery_charge?: number | null;
  delivery_charge_district?: number | null;
  delivery_charge_state?: number | null;
  delivery_charge_national?: number | null;
}): ZoneRateForm => ({
  local: row.delivery_charge != null ? String(row.delivery_charge) : '0',
  district: row.delivery_charge_district != null ? String(row.delivery_charge_district) : '',
  state: row.delivery_charge_state != null ? String(row.delivery_charge_state) : '',
  national: row.delivery_charge_national != null ? String(row.delivery_charge_national) : '',
});

export const zoneRatesToPatch = (f: ZoneRateForm) => ({
  delivery_charge: Number(f.local || 0),
  delivery_charge_district: f.district.trim() === '' ? null : Number(f.district),
  delivery_charge_state: f.state.trim() === '' ? null : Number(f.state),
  delivery_charge_national: f.national.trim() === '' ? null : Number(f.national),
});

/** How far the shop reaches, in one line, for the review screen. */
export function describeReach(f: ZoneRateForm, city?: string, district?: string, state?: string): string {
  if (f.national.trim() !== '') return 'All India';
  if (f.state.trim() !== '') return state ? `Within ${state}` : 'Within your state';
  if (f.district.trim() !== '') return district ? `${district} district` : 'Your district only';
  return city ? `${city} only` : 'Your town only';
}

type Places = { city?: string; district?: string; state?: string };

const ZONES: { key: keyof ZoneRateForm; label: (p: Places) => string; hint: string; required?: boolean }[] = [
  {
    key: 'local',
    label: (p) => (p.city ? `Within ${p.city}` : 'Within your town'),
    hint: 'Your own town. 0 means you deliver free here.',
    required: true,
  },
  {
    key: 'district',
    label: (p) => (p.district ? `Rest of ${p.district} district` : 'Rest of your district'),
    hint: 'Nearby towns in your district.',
  },
  {
    key: 'state',
    label: (p) => (p.state ? `Rest of ${p.state}` : 'Rest of your state'),
    hint: 'Anywhere else in your state.',
  },
  {
    key: 'national',
    label: () => 'Rest of India',
    hint: 'Every other state.',
  },
];

/**
 * Bands that undercut a nearer band, keyed by the band at fault.
 *
 * The fields are listed nearest-first and read as a ladder, which makes it easy
 * to type ₹40 for "Rest of India" under a ₹200 "Rest of Tamil Nadu" without
 * noticing — the shop then eats the courier bill on exactly its most expensive
 * parcels. A cheaper far band is not impossible (a bulk contract to one metro,
 * say), so this warns rather than blocks: nothing here stops a save.
 *
 * Blank bands are "I don't deliver there", not a price, so they neither warn nor
 * count as the band to beat. Each band is compared against the dearest nearer
 * band, so a gap in the middle can't hide an undercut further out.
 */
export function zoneRateWarnings(f: ZoneRateForm, places: Places = {}): Partial<Record<keyof ZoneRateForm, string>> {
  const out: Partial<Record<keyof ZoneRateForm, string>> = {};
  let dearest: { label: string; amount: number } | null = null;

  for (const z of ZONES) {
    const raw = f[z.key].trim();
    if (raw === '') continue;
    const amount = Number(raw);
    if (!Number.isFinite(amount)) continue;

    if (dearest && amount < dearest.amount) {
      out[z.key] = `Cheaper than ${dearest.label} (₹${dearest.amount}). Farther usually costs more — check this.`;
    }
    if (!dearest || amount > dearest.amount) dearest = { label: z.label(places), amount };
  }

  return out;
}

export function DeliveryRateCard({
  value, onChange, places, freeDeliveryOver, onFreeDeliveryOverChange,
}: {
  value: ZoneRateForm;
  onChange: (next: ZoneRateForm) => void;
  /** The shop's own address, so each band is named after a real place. */
  places: Places;
  freeDeliveryOver: string;
  onFreeDeliveryOverChange: (v: string) => void;
}) {
  const set = (key: keyof ZoneRateForm, raw: string) =>
    onChange({ ...value, [key]: raw.replace(/[^\d.]/g, '') });

  const reaches = describeReach(value, places.city, places.district, places.state);
  const warnings = zoneRateWarnings(value, places);
  const undercut = ZONES.filter((z) => warnings[z.key]);

  return (
    <div style={css('display:flex;flex-direction:column;gap:14px;')}>
      <div style={css('font-size:12px;font-weight:600;color:var(--ag-muted);line-height:1.6;')}>
        What buyers pay you to deliver, by how far the parcel goes. Leave a band
        blank if you don’t deliver there — buyers at those addresses simply won’t
        be able to order from you.
      </div>

      {ZONES.map((z) => (
        <Field
          key={z.key}
          label={`${z.label(places)} (₹)${z.required ? ' *' : ''}`}
          value={value[z.key]}
          onChange={(v) => set(z.key, v)}
          placeholder={z.required ? '0' : 'Not delivered'}
          inputMode="numeric"
          warning={warnings[z.key]}
          hint={z.hint}
        />
      ))}

      {/* The per-field line is easy to scroll past on a phone, where only one or
          two bands are on screen at a time, so the mismatch is also stated once
          where the seller can see both numbers together. */}
      {undercut.length > 0 && (
        <div style={css('display:flex;gap:8px;padding:11px 13px;border-radius:12px;background:var(--ag-warn-bg);font-size:11.5px;font-weight:600;color:var(--ag-warn-text);line-height:1.6;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;flex:none;")}>warning</span>
          <span>
            <strong style={css('font-weight:800;')}>Check your rate card.</strong>{' '}
            {undercut.map((z) => `${z.label(places)} (₹${Number(value[z.key])})`).join(', ')}{' '}
            {undercut.length > 1 ? 'cost' : 'costs'} a buyer less than a nearer
            band. You can still save this — just make sure the courier bill on
            those parcels is one you meant to carry.
          </span>
        </div>
      )}

      <Field
        label="Free delivery over (₹)"
        value={freeDeliveryOver}
        onChange={(v) => onFreeDeliveryOverChange(v.replace(/[^\d.]/g, ''))}
        placeholder="0"
        inputMode="numeric"
        hint="Applies in your own town and district only, where your carriage is cheap. 0 = always charged."
      />

      {/* Says back what the seller has just built, because four numbers with a
          blank in the middle is easy to misread. */}
      <div style={css('display:flex;align-items:center;gap:8px;padding:11px 13px;border-radius:12px;background:var(--ag-surface-2);font-size:12px;font-weight:700;color:var(--ag-ink-2);')}>
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;color:var(--ag-crimson);")}>local_shipping</span>
        You deliver to: {reaches}
      </div>
    </div>
  );
}
