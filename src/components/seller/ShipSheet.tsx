/**
 * "Mark shipped" — the form that replaced a one-tap status change.
 *
 * Tracking is mandatory to ship, and that rule lives in the database (migration
 * 0063's trg_orders_require_shipment), not here. This sheet exists so the seller
 * meets the rule comfortably rather than hitting it as an error; if it is ever
 * bypassed, the transition still fails.
 *
 * The tracking link is prefilled from the chosen courier's template and stays
 * editable. Most Indian courier tracking pages are form-POST with no addressable
 * URL, so many couriers have no template at all — the seller can paste the link
 * their courier gave them instead, and a parcel with no link still ships (the
 * buyer sees courier + AWB, which beats a dead URL).
 */
import { useEffect, useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { buildTrackingUrl, type Courier } from '@/data/shipments';

const OTHER = '__other__';

export function ShipSheet({
  couriers,
  busy,
  onCancel,
  onConfirm,
}: {
  couriers: Courier[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (v: { courierId: string | null; courierName: string; awb: string; trackingUrl: string | null }) => void;
}) {
  const [courierKey, setCourierKey] = useState('');
  const [otherName, setOtherName] = useState('');
  const [awb, setAwb] = useState('');
  const [link, setLink] = useState('');
  // Once the seller edits the link themselves we stop overwriting it, or typing
  // the AWB would wipe what they pasted.
  const [linkTouched, setLinkTouched] = useState(false);

  const courier = useMemo(() => couriers.find((c) => c.id === courierKey), [couriers, courierKey]);
  const isOther = courierKey === OTHER;
  const autoLink = useMemo(() => buildTrackingUrl(courier?.tracking_url_template, awb), [courier, awb]);

  useEffect(() => {
    if (!linkTouched) setLink(autoLink ?? '');
  }, [autoLink, linkTouched]);

  const courierName = isOther ? otherName.trim() : (courier?.name ?? '');
  const ready = courierName.length > 0 && awb.trim().length > 0 && !busy;

  const field = 'width:100%;height:46px;border-radius:12px;border:1.5px solid var(--ag-border);background:var(--ag-bg);color:var(--ag-ink);padding:0 13px;font-size:14px;font-family:inherit;box-sizing:border-box;';
  const label = 'font-size:11.5px;font-weight:800;color:var(--ag-muted);letter-spacing:.05em;margin-bottom:6px;';

  return (
    <div
      style={css('position:fixed;inset:0;z-index:60;background:rgba(20,8,14,.45);display:flex;align-items:flex-end;justify-content:center;')}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={css('width:100%;max-width:520px;background:var(--ag-surface);border-radius:20px 20px 0 0;padding:18px 20px 22px;box-shadow:0 -12px 40px -18px rgba(107,20,54,.6);max-height:88vh;overflow-y:auto;')}
      >
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Ship this order</div>
        <div style={css('font-size:12.5px;color:var(--ag-muted);margin-top:3px;line-height:1.5;')}>
          The courier and tracking number are required — they are what the customer follows, and what proves the parcel left your shop.
        </div>

        <div style={css('margin-top:16px;')}>
          <div style={css(label)}>COURIER</div>
          <select
            value={courierKey}
            onChange={(e) => { setCourierKey(e.target.value); setLinkTouched(false); }}
            style={css(field)}
          >
            <option value="">Select a courier…</option>
            {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value={OTHER}>Other courier…</option>
          </select>
        </div>

        {isOther && (
          <div style={css('margin-top:12px;')}>
            <div style={css(label)}>COURIER NAME</div>
            <input
              value={otherName}
              onChange={(e) => setOtherName(e.target.value)}
              placeholder="e.g. Sri Balaji Couriers"
              style={css(field)}
            />
          </div>
        )}

        <div style={css('margin-top:12px;')}>
          <div style={css(label)}>TRACKING / DOCKET NUMBER</div>
          <input
            value={awb}
            onChange={(e) => setAwb(e.target.value)}
            placeholder="e.g. 1234567890123"
            autoCapitalize="characters"
            style={css(field)}
          />
        </div>

        <div style={css('margin-top:12px;')}>
          <div style={css(label)}>TRACKING LINK · OPTIONAL</div>
          <input
            value={link}
            onChange={(e) => { setLink(e.target.value); setLinkTouched(true); }}
            placeholder="Paste the link your courier gave you"
            style={css(field)}
          />
          <div style={css('font-size:11.5px;color:var(--ag-muted);margin-top:6px;line-height:1.5;')}>
            {autoLink && !linkTouched
              ? 'Filled in from the courier’s tracking page — edit it if it doesn’t open.'
              : 'Leave blank if your courier has no tracking page. The customer still sees the courier and docket number.'}
          </div>
        </div>

        <div style={css('display:flex;gap:10px;margin-top:20px;')}>
          <button
            onClick={onCancel}
            style={css('flex:1;height:50px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);border-radius:13px;font-weight:800;cursor:pointer;font-family:inherit;')}
          >
            Cancel
          </button>
          <button
            disabled={!ready}
            onClick={() => onConfirm({
              courierId: isOther ? null : (courier?.id ?? null),
              courierName,
              awb: awb.trim(),
              trackingUrl: link.trim() || null,
            })}
            style={css(`flex:1.4;height:50px;border:none;border-radius:13px;background:${ready ? 'linear-gradient(135deg,#D6336C,#B02454)' : 'var(--ag-surface-2)'};color:${ready ? '#fff' : 'var(--ag-muted)'};font-weight:800;cursor:${ready ? 'pointer' : 'default'};font-family:inherit;`)}
          >
            {busy ? 'Shipping…' : 'Ship order'}
          </button>
        </div>
      </div>
    </div>
  );
}
