import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { useAuth } from '@/auth/AuthContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { updateBoutique, uploadBoutiqueImage } from '@/data/boutiques';
import { updateMyProfile } from '@/data/profiles';
import { resolveDisplayName } from '@/lib/displayName';
import { CROP, useImageCropper } from '@/components/ui/ImageCropper';

const inputStyle = 'width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;padding:0 14px;height:50px;font-size:14px;font-weight:600;box-sizing:border-box;';
const labelStyle = 'font-size:13px;font-weight:700;color:var(--ag-label);';

export function BoutiqueProfileEdit() {
  const navigate = useNavigate();
  const { showToast } = useShop();
  const { profile, session, refreshProfile } = useAuth();
  const { boutique, loading, reload } = useMyBoutique();

  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [owner, setOwner] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'logo' | 'cover' | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const { cropImage, cropper } = useImageCropper();

  // Seed the form from the seller's own row once it arrives (and again if they
  // save elsewhere), so the fields always reflect the logged-in account.
  useEffect(() => {
    if (!boutique) return;
    setName(boutique.name ?? '');
    setCity(boutique.city ?? '');
    setArea(boutique.area ?? '');
    setDescription(boutique.description ?? '');
    setPhone(boutique.phone ?? '');
  }, [boutique]);

  useEffect(() => {
    setOwner(resolveDisplayName(profile, session));
  }, [profile, session]);

  const initial = (name || owner || 'B').trim().charAt(0).toUpperCase();

  // Branding images save immediately — they have no "unsaved" state to hold.
  const pickImage = async (kind: 'logo' | 'cover', picked: File | undefined) => {
    if (!boutique) return;
    // The logo renders in a square badge and the cover as a wide banner — both
    // crop on the buyer's side, so the seller places the crop themselves.
    const file = await cropImage(picked, kind === 'logo' ? CROP.logo : CROP.cover);
    if (!file) return;
    setUploading(kind);
    try {
      const url = await uploadBoutiqueImage(boutique.id, kind, file);
      await updateBoutique(boutique.id, kind === 'logo' ? { logo_url: url } : { cover_url: url });
      reload();
      showToast(kind === 'logo' ? 'Logo updated' : 'Cover updated');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!boutique) return showToast('No boutique linked to this account yet');
    if (name.trim().length < 2) return showToast('Enter your boutique name');
    setSaving(true);
    try {
      await updateBoutique(boutique.id, {
        name: name.trim(),
        city: city.trim(),
        area: area.trim(),
        description: description.trim(),
        phone: phone.trim() || null,
      });
      // The owner name lives on the profile row, not the boutique.
      if (profile && owner.trim() && owner.trim() !== profile.full_name) {
        await updateMyProfile(profile.id, { full_name: owner.trim() });
        await refreshProfile();
      }
      reload();
      showToast('Boutique profile saved');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save your profile');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
      <div style={css('padding:6px 20px 12px;display:flex;align-items:center;gap:10px;')}>
        <button onClick={() => navigate('/seller/profile')} aria-label="Go back" style={css('width:42px;height:42px;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
        </button>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:23px;")}>Boutique Profile</h1>
      </div>

      {cropper}
      <div style={css('padding:4px 20px 0;')}>
        <input ref={coverInput} type="file" accept="image/*" hidden onChange={(e) => { void pickImage('cover', e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={logoInput} type="file" accept="image/*" hidden onChange={(e) => { void pickImage('logo', e.target.files?.[0]); e.target.value = ''; }} />

        <div onClick={() => boutique && coverInput.current?.click()} style={css('height:110px;border-radius:16px;background:var(--ag-surface-2);position:relative;overflow:hidden;display:flex;align-items:center;justify-content:center;cursor:pointer;')}>
          {boutique?.cover_url && <img src={boutique.cover_url} alt="" style={css('position:absolute;inset:0;width:100%;height:100%;object-fit:cover;')} />}
          {!boutique?.cover_url && <div style={css('position:absolute;inset:0;background:repeating-linear-gradient(135deg,rgba(255,255,255,.3) 0 1px,transparent 1px 16px);')} />}
          <span style={css("font-family:'IBM Plex Mono',monospace;font-size:11px;color:rgba(42,26,32,.5);background:rgba(255,255,255,.7);padding:4px 10px;border-radius:8px;position:relative;")}>
            {uploading === 'cover' ? 'uploading…' : 'cover image · tap to change'}
          </span>
        </div>

        <div style={css('display:flex;align-items:center;gap:12px;margin-top:-24px;padding-left:6px;position:relative;')}>
          <div onClick={() => boutique && logoInput.current?.click()} title="Tap to change your logo" style={css("width:70px;height:70px;border-radius:20px;background:var(--ag-purple-bg);border:3px solid var(--ag-bg);display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-weight:700;font-size:28px;color:rgba(42,26,32,.5);cursor:pointer;overflow:hidden;")}>
            {boutique?.logo_url
              ? <img src={boutique.logo_url} alt="" style={css('width:100%;height:100%;object-fit:cover;')} />
              : uploading === 'logo' ? '…' : initial}
          </div>
          {boutique?.verified && (
            <div style={css('display:flex;align-items:center;gap:5px;background:var(--ag-good-bg);color:var(--ag-good);padding:5px 11px;border-radius:9px;font-weight:800;font-size:12px;margin-top:24px;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>verified</span>Verified
            </div>
          )}
        </div>

        {loading && <div style={css('margin-top:16px;font-size:13px;color:var(--ag-muted);')}>Loading your boutique…</div>}
        {!loading && !boutique && (
          <div style={css('margin-top:16px;background:var(--ag-surface);border:1.5px solid var(--ag-border);border-radius:14px;padding:14px;font-size:13px;color:var(--ag-muted);')}>
            No boutique is linked to this account yet.
            <button onClick={() => navigate('/seller/onboarding')} style={css('display:block;margin-top:10px;border:none;background:none;color:var(--ag-crimson);font-weight:800;cursor:pointer;padding:0;')}>Set up your boutique →</button>
          </div>
        )}

        <div style={css('display:flex;flex-direction:column;gap:14px;margin-top:16px;')}>
          <label style={css(labelStyle)}>
            Owner name<input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Your name" style={css(inputStyle)} />
          </label>
          <label style={css(labelStyle)}>
            Boutique name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your boutique" style={css(inputStyle)} />
          </label>
          <label style={css(labelStyle)}>
            City<input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Coimbatore" style={css(inputStyle)} />
          </label>
          <label style={css(labelStyle)}>
            Area<input value={area} onChange={(e) => setArea(e.target.value)} placeholder="RS Puram" style={css(inputStyle)} />
          </label>
          <label style={css(labelStyle)}>
            Contact number<input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="98765 43210" style={css(inputStyle)} />
          </label>
          <label style={css(labelStyle)}>
            Description
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Tell buyers what makes your boutique special." style={css('width:100%;margin-top:6px;border:1.5px solid var(--ag-border);background:var(--ag-surface);border-radius:13px;padding:12px 14px;font-size:14px;font-weight:500;resize:none;box-sizing:border-box;')} />
          </label>
          <button onClick={save} disabled={saving || !boutique} style={css(`width:100%;height:52px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);opacity:${saving || !boutique ? 0.6 : 1};`)}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
