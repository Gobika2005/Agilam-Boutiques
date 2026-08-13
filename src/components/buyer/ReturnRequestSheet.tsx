/**
 * "Request a return" — the control the Return & Refund Policy has always told
 * buyers to use, which until now did not exist.
 *
 * `platform_settings.return_window_days` was an editable admin field that
 * nothing read: the policy page promised a window, and the only route to a
 * return was to message the boutique in chat and hope. Migration 0074 added the
 * table and the two SECURITY DEFINER functions behind it; this is the buyer's
 * half.
 *
 * The rule this sheet has to communicate — and deliberately does NOT enforce,
 * because `request_return()` is the authority and a browser check is only a
 * courtesy:
 *
 *   • A FAULT (damaged, defective, wrong item, not as described) is always
 *     accepted, up to 30 days from delivery, whatever the window is set to.
 *     That one is the marketplace's own commitment, not the shop's.
 *   • GOODWILL (size, changed mind) is gated on THIS BOUTIQUE's return window
 *     (migration 0078), and refused outright when that window is 0. Those two
 *     options are shown greyed with the reason rather than hidden, so the buyer
 *     learns the policy instead of wondering where the option went.
 *
 * The window comes from the boutique rather than from platform settings so the
 * promise on the product page and the rule the server enforces are the same
 * number. They were not: the product page printed a compile-time 7 while
 * `request_return()` checked an admin field set to 0.
 */
import { useState } from 'react';
import { css } from '@/lib/css';
import { useToast } from '@/components/ui/Toast';
import { useCatalog } from '@/state/CatalogContext';
import { shopFulfilment } from '@/lib/fulfilment';
import { uploadImage } from '@/lib/uploadImage';
import {
  requestReturn,
  isFaultReason,
  RETURN_REASON_LABEL,
  type ReturnReason,
} from '@/data/returns';

const REASONS: ReturnReason[] = [
  'damaged',
  'defective',
  'wrong_item',
  'not_as_described',
  'size_issue',
  'changed_mind',
];

const MAX_PHOTOS = 4;

export function ReturnRequestSheet({
  orderId,
  orderNumber,
  boutiqueId,
  onClose,
  onDone,
}: {
  orderId: string;
  orderNumber: string;
  /** Whose window applies. The order's boutique — see the note above. */
  boutiqueId?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const showToast = useToast();
  const { boutiqueById } = useCatalog();
  const { returnWindowDays: windowDays } = shopFulfilment(boutiqueById(boutiqueId));
  const [reason, setReason] = useState<ReturnReason | null>(null);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const goodwillOpen = windowDays > 0;
  const disabledReason = (r: ReturnReason) => (isFaultReason(r) || goodwillOpen ? null
    : 'We don’t accept change-of-mind returns');

  const addPhotos = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) return showToast(`You can add up to ${MAX_PHOTOS} photos`);
    setUploading(true);
    try {
      const picked = Array.from(files).slice(0, room);
      const urls = await Promise.all(
        picked.map((f) => uploadImage('review-images', orderId, f, '0041', 'return')),
      );
      setPhotos((p) => [...p, ...urls]);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not upload that photo');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!reason) return showToast('Pick a reason');
    // Photographs are what let a boutique settle a fault claim without an
    // argument, so they are required for one — and pointless for "changed my
    // mind", where there is nothing to show.
    if (isFaultReason(reason) && photos.length === 0) {
      return showToast('Please add at least one photo of the problem');
    }
    setBusy(true);
    try {
      await requestReturn({ orderId, reason, note: note.trim(), photos });
      showToast('Return requested — the boutique will be in touch');
      onDone();
    } catch (e) {
      // The server's messages are written to be read by the buyer.
      showToast(e instanceof Error ? e.message : 'Could not raise this return');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Request a return for order ${orderNumber}`}
      onClick={onClose}
      style={css('position:fixed;inset:0;z-index:70;background:rgba(20,8,14,.5);display:flex;align-items:flex-end;justify-content:center;')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="agx-scroll"
        style={css('width:100%;max-width:520px;max-height:88vh;overflow-y:auto;background:var(--ag-surface);border-radius:24px 24px 0 0;padding:22px 20px 28px;animation:agx-sheet .3s ease;')}
      >
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:21px;")}>Request a return</div>
        <div style={css('font-size:13px;color:var(--ag-muted);margin-top:5px;line-height:1.5;')}>
          Order {orderNumber}. Tell us what went wrong and the boutique will respond.
        </div>

        {/* Reasons */}
        <div style={css('display:flex;flex-direction:column;gap:8px;margin-top:18px;')}>
          {REASONS.map((r) => {
            const blocked = disabledReason(r);
            const on = reason === r;
            return (
              <button
                key={r}
                type="button"
                disabled={!!blocked}
                onClick={() => setReason(r)}
                style={css(
                  `display:flex;align-items:center;gap:11px;text-align:left;padding:13px 14px;border-radius:14px;font-family:inherit;` +
                    `border:1.5px solid ${on ? 'var(--ag-crimson)' : 'var(--ag-border)'};` +
                    `background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};` +
                    `cursor:${blocked ? 'not-allowed' : 'pointer'};opacity:${blocked ? 0.55 : 1};`,
                )}
              >
                <span
                  aria-hidden="true"
                  style={css(
                    `width:18px;height:18px;flex:none;border-radius:50%;border:2px solid ${on ? 'var(--ag-crimson)' : 'var(--ag-border)'};` +
                      `background:${on ? 'var(--ag-crimson)' : 'transparent'};`,
                  )}
                />
                <span style={css('flex:1;min-width:0;')}>
                  <span style={css('display:block;font-size:14px;font-weight:700;color:var(--ag-ink);')}>
                    {RETURN_REASON_LABEL[r]}
                  </span>
                  {blocked && (
                    <span style={css('display:block;font-size:11.5px;color:var(--ag-muted);margin-top:2px;')}>{blocked}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {/* Photos */}
        <div style={css('margin-top:18px;')}>
          <div style={css('font-size:13px;font-weight:700;color:var(--ag-label);')}>
            Photos {reason && isFaultReason(reason) ? '*' : '(optional)'}
          </div>
          <div style={css('display:flex;gap:9px;flex-wrap:wrap;margin-top:9px;')}>
            {photos.map((url) => (
              <div key={url} style={css('position:relative;width:66px;height:66px;border-radius:12px;overflow:hidden;border:1px solid var(--ag-border);')}>
                <img src={url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => setPhotos((p) => p.filter((u) => u !== url))}
                  style={css('position:absolute;top:2px;right:2px;border:none;background:rgba(0,0,0,.5);color:#fff;border-radius:7px;width:20px;height:20px;cursor:pointer;font-family:inherit;line-height:1;')}
                >
                  ×
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <label style={css('width:66px;height:66px;border-radius:12px;border:2px dashed var(--ag-border);display:flex;align-items:center;justify-content:center;cursor:pointer;background:var(--ag-surface-2);')}>
                <input type="file" accept="image/*" multiple hidden onChange={(e) => void addPhotos(e.target.files)} />
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:22px;color:var(--ag-crimson);")}>
                  {uploading ? 'hourglass_top' : 'add_a_photo'}
                </span>
              </label>
            )}
          </div>
        </div>

        {/* Note */}
        <label style={css('display:block;margin-top:18px;font-size:13px;font-weight:700;color:var(--ag-label);')}>
          Anything else?
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="Describe the problem in a line or two."
            style={css('display:block;width:100%;box-sizing:border-box;margin-top:7px;padding:11px 13px;border:1.5px solid var(--ag-border);border-radius:13px;background:var(--ag-bg);color:var(--ag-ink);font-family:inherit;font-size:14px;resize:vertical;')}
          />
        </label>

        <div style={css('display:flex;gap:10px;margin-top:20px;')}>
          <button
            type="button"
            onClick={onClose}
            style={css('flex:1;height:50px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:14px;font-weight:700;font-size:14px;color:var(--ag-label);cursor:pointer;font-family:inherit;')}
          >
            Not now
          </button>
          <button
            type="button"
            disabled={busy || uploading || !reason}
            onClick={() => void submit()}
            style={css(`flex:2;height:50px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit;opacity:${busy || uploading || !reason ? 0.6 : 1};`)}
          >
            {busy ? 'Sending…' : 'Request return'}
          </button>
        </div>
      </div>
    </div>
  );
}
