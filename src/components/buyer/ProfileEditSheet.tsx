import { useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { nameOk, phoneOk } from '@/lib/buyerDetails';

/**
 * Edit the buyer's saved profile — name, mobile, city and delivery address.
 *
 * These are the same anonymous `guest` details captured at the chat/checkout
 * gate (localStorage-backed via `@/lib/buyerDetails`). Editing them here writes
 * through to the shared shop state, so the profile header, chat identity and
 * checkout all reflect the change immediately. Name + phone are required; city
 * and address are optional here (checkout captures them if still missing).
 */
export function ProfileEditSheet({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  /** Fires with the saved details after a successful save (for DB sync). */
  onSaved?: (patch: { name: string; phone: string; city: string; address: string }) => void;
}) {
  const { guest, setGuest, showToast } = useShop();
  const [name, setName] = useState(guest.name);
  const [phone, setPhone] = useState(guest.phone);
  const [city, setCity] = useState(guest.city);
  const [address, setAddress] = useState(guest.address);
  const [touched, setTouched] = useState(false);

  const nameValid = nameOk(name);
  const phoneValid = phoneOk(phone);

  const save = () => {
    if (!nameValid || !phoneValid) {
      setTouched(true);
      return;
    }
    const patch = { name: name.trim(), phone: phone.trim(), city: city.trim(), address: address.trim() };
    setGuest(patch);
    showToast('Profile updated');
    onSaved?.(patch);
    onClose();
  };

  const labelStyle = css('font-size:12.5px;font-weight:800;color:var(--ag-label);display:block;');
  const inputStyle = (valid: boolean) =>
    css(`display:block;width:100%;margin-top:7px;border:1.5px solid ${touched && !valid ? '#E0748C' : 'var(--ag-border)'};background:var(--ag-bg);border-radius:14px;padding:0 15px;height:52px;font-size:15px;font-weight:600;color:var(--ag-ink);box-sizing:border-box;`);

  return (
    <div
      onClick={onClose}
      style={css('position:fixed;inset:0;z-index:220;background:rgba(40,10,22,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={css('width:100%;max-width:440px;margin:auto;background:var(--ag-surface);border-radius:28px;padding:24px 24px 26px;box-shadow:0 30px 80px -30px rgba(107,20,54,.6);')}
      >
        <div style={css('display:flex;align-items:center;gap:12px;')}>
          <div style={css('width:48px;height:48px;border-radius:15px;background:linear-gradient(135deg,#D6336C,#B02454);display:flex;align-items:center;justify-content:center;flex:none;box-shadow:0 14px 30px -16px rgba(214,51,108,.8);')}>
            <span style={css("font-family:'Material Symbols Outlined';color:#fff;font-size:24px;")}>person_edit</span>
          </div>
          <div>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;line-height:1.1;")}>Your details</div>
            <div style={css('color:var(--ag-muted);font-size:12.5px;margin-top:3px;')}>Used for chat &amp; delivery</div>
          </div>
        </div>

        <div style={css('display:flex;flex-direction:column;gap:14px;margin-top:22px;')}>
          <label style={labelStyle}>
            Full name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoFocus style={inputStyle(nameValid)} />
          </label>

          <label style={labelStyle}>
            Mobile number
            <div style={css(`display:flex;align-items:center;margin-top:7px;border:1.5px solid ${touched && !phoneValid ? '#E0748C' : 'var(--ag-border)'};background:var(--ag-bg);border-radius:14px;padding:0 15px;height:52px;`)}>
              <span style={css('font-weight:800;color:var(--ag-muted);font-size:15px;')}>+91</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                placeholder="10-digit number"
                style={css('border:none;background:none;flex:1;margin-left:10px;font-size:15px;font-weight:600;color:var(--ag-ink);min-width:0;')}
              />
            </div>
          </label>

          <label style={labelStyle}>
            City
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Coimbatore" style={inputStyle(true)} />
          </label>

          <label style={labelStyle}>
            Delivery address
            <textarea
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Flat / house no, street, area, pincode"
              rows={3}
              style={css('display:block;width:100%;margin-top:7px;border:1.5px solid var(--ag-border);background:var(--ag-bg);border-radius:14px;padding:12px 15px;font-size:15px;font-weight:600;color:var(--ag-ink);box-sizing:border-box;resize:none;line-height:1.5;font-family:inherit;')}
            />
          </label>

          {touched && (!nameValid || !phoneValid) && (
            <div style={css('color:#C0455E;font-size:12px;font-weight:700;margin-top:-4px;')}>
              {!nameValid ? 'Please enter your name. ' : ''}
              {!phoneValid ? 'Enter a valid 10-digit mobile number.' : ''}
            </div>
          )}
        </div>

        <div style={css('display:flex;flex-direction:column;gap:10px;margin-top:22px;')}>
          <button
            onClick={save}
            style={css('height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);display:flex;align-items:center;justify-content:center;gap:8px;')}
          >
            <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>check</span>Save details
          </button>
          <button onClick={onClose} style={css('height:44px;border:none;background:none;color:var(--ag-muted);font-weight:700;font-size:14px;cursor:pointer;')}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
