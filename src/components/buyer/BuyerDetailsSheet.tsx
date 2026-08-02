import { useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { nameOk, phoneOk } from '@/lib/buyerDetails';

/**
 * Lightweight identity gate. Buyers browse anonymously, so before they can chat
 * with a boutique or place an order we ask for a name + phone once. It writes
 * through to the shared `guest` details (held in memory for this visit), so
 * it's captured a single time and reused across chat and checkout.
 */
export function BuyerDetailsSheet({
  title = 'Almost there',
  subtitle = 'Add your name and number so the boutique can reach you.',
  cta = 'Continue',
  onDone,
  onClose,
}: {
  title?: string;
  subtitle?: string;
  cta?: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const { guest, setGuest } = useShop();
  const [name, setName] = useState(guest.name);
  const [phone, setPhone] = useState(guest.phone);
  const [touched, setTouched] = useState(false);

  const nameValid = nameOk(name);
  const phoneValid = phoneOk(phone);

  const submit = () => {
    if (!nameValid || !phoneValid) {
      setTouched(true);
      return;
    }
    setGuest({ name: name.trim(), phone: phone.trim() });
    onDone();
  };

  const fieldStyle = (valid: boolean) =>
    css(`display:block;width:100%;margin-top:7px;border:1.5px solid ${touched && !valid ? '#E0748C' : 'var(--ag-border)'};background:var(--ag-bg);border-radius:14px;padding:0 15px;height:52px;font-size:15px;font-weight:600;color:var(--ag-ink);`);

  return (
    <div
      onClick={onClose}
      style={css('position:fixed;inset:0;z-index:220;background:rgba(40,10,22,.5);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto;')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={css('width:100%;max-width:440px;margin:auto;background:var(--ag-surface);border-radius:28px;padding:24px 24px 26px;box-shadow:0 30px 80px -30px rgba(107,20,54,.6);')}
      >
        <div style={css('width:56px;height:56px;border-radius:17px;background:linear-gradient(135deg,#D6336C,#B02454);display:flex;align-items:center;justify-content:center;margin:0 auto;box-shadow:0 16px 34px -16px rgba(214,51,108,.8);')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#fff;font-size:28px;")}>badge</span>
        </div>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;text-align:center;margin-top:15px;line-height:1.15;")}>{title}</div>
        <div style={css('text-align:center;color:var(--ag-muted);font-size:13.5px;margin-top:8px;line-height:1.5;max-width:330px;margin-left:auto;margin-right:auto;')}>{subtitle}</div>

        <div style={css('display:flex;flex-direction:column;gap:14px;margin-top:22px;')}>
          <label style={css('font-size:12.5px;font-weight:800;color:var(--ag-label);')}>
            Full name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              autoFocus
              style={fieldStyle(nameValid)}
            />
          </label>
          <label style={css('font-size:12.5px;font-weight:800;color:var(--ag-label);')}>
            Mobile number
            <div style={css(`display:flex;align-items:center;margin-top:7px;border:1.5px solid ${touched && !phoneValid ? '#E0748C' : 'var(--ag-border)'};background:var(--ag-bg);border-radius:14px;padding:0 15px;height:52px;`)}>
              <span style={css('font-weight:800;color:var(--ag-muted);font-size:15px;')}>+91</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                inputMode="numeric"
                placeholder="10-digit number"
                style={css('border:none;background:none;flex:1;margin-left:10px;font-size:15px;font-weight:600;color:var(--ag-ink);min-width:0;')}
              />
            </div>
          </label>
          {touched && (!nameValid || !phoneValid) && (
            <div style={css('color:#C0455E;font-size:12px;font-weight:700;margin-top:-4px;')}>
              {!nameValid ? 'Please enter your name. ' : ''}{!phoneValid ? 'Enter a valid 10-digit mobile number.' : ''}
            </div>
          )}
        </div>

        <div style={css('display:flex;flex-direction:column;gap:10px;margin-top:22px;')}>
          <button
            onClick={submit}
            style={css('height:54px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:16px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);display:flex;align-items:center;justify-content:center;gap:8px;')}
          >
            {cta}<span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>arrow_forward</span>
          </button>
          <button onClick={onClose} style={css('height:44px;border:none;background:none;color:var(--ag-muted);font-weight:700;font-size:14px;cursor:pointer;')}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
