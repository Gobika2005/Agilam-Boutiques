import { useState } from 'react';
import { css } from '@/lib/css';
import { useShop } from '@/state/ShopContext';
import { TONES, type Boutique } from '@/data/demo';

/**
 * Premium "share this boutique" sheet.
 *
 * Gives every boutique a self-serve sharing experience: a branded preview card
 * (the template a recipient sees), the clean shareable link, and one-tap share
 * to WhatsApp / Instagram / Facebook / X or the native share sheet. The link is
 * the slug-based public URL (`<site>/b/<slug>`) so it can live in an Instagram
 * bio or WhatsApp status and deep-link straight back to this profile.
 */

function monogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((w) => w[0]).join('');
  return (initials || name.slice(0, 2)).toUpperCase();
}

function compact(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + 'K';
}

export function ShareBoutiqueSheet({ boutique, link, onClose }: { boutique: Boutique; link: string; onClose: () => void }) {
  const { showToast } = useShop();
  const [copied, setCopied] = useState(false);
  const prettyLink = link.replace(/^https?:\/\//, '');
  const message = `Check out ${boutique.name} on Agilam ✨ ${boutique.desc}`;

  const copy = (silent = false) => {
    const done = () => {
      setCopied(true);
      if (!silent) showToast('Link copied');
      window.setTimeout(() => setCopied(false), 1800);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(done, () => showToast('Share: ' + link));
    else done();
  };

  const open = (url: string) => window.open(url, '_blank', 'noopener,noreferrer');

  const targets = [
    {
      label: 'WhatsApp',
      icon: 'chat',
      bg: 'linear-gradient(135deg,#25D366,#128C7E)',
      onClick: () => open(`https://wa.me/?text=${encodeURIComponent(message + ' ' + link)}`),
    },
    {
      label: 'Instagram',
      icon: 'photo_camera',
      bg: 'linear-gradient(135deg,#F58529,#DD2A7B 55%,#8134AF)',
      onClick: () => { copy(true); showToast('Link copied — paste it in your Instagram bio or story'); },
    },
    {
      label: 'Facebook',
      icon: 'thumb_up',
      bg: 'linear-gradient(135deg,#1877F2,#0C5BD1)',
      onClick: () => open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`),
    },
    {
      label: 'X',
      icon: 'tag',
      bg: 'linear-gradient(135deg,#2B2B2B,#000)',
      onClick: () => open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(link)}`),
    },
  ];

  const nativeShare = () => {
    if (navigator.share) navigator.share({ title: boutique.name, text: message, url: link }).catch(() => {});
    else copy();
  };

  return (
    <div
      onClick={onClose}
      style={css('position:fixed;inset:0;z-index:260;background:rgba(40,10,22,.55);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:18px;overflow-y:auto;')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="agx-reveal"
        style={css('width:100%;max-width:440px;margin:auto;background:var(--ag-surface);border-radius:30px;overflow:hidden;box-shadow:0 34px 90px -30px rgba(107,20,54,.7);')}
      >
        {/* Header */}
        <div style={css('display:flex;align-items:center;justify-content:space-between;padding:20px 22px 12px;')}>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Share boutique</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={css('width:36px;height:36px;border-radius:12px;border:none;background:var(--ag-surface-2);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
          >
            <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted);font-size:20px;")}>close</span>
          </button>
        </div>

        {/* Preview card — the template a recipient sees */}
        <div style={css('padding:0 22px;')}>
          <div style={css('position:relative;border:1px solid var(--ag-surface-3);border-radius:22px;overflow:hidden;background:var(--ag-surface);box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
            <div style={css(`height:74px;background:linear-gradient(135deg,${TONES[boutique.tone]},var(--ag-surface-2));`)} />
            <div style={css('padding:0 18px 18px;')}>
              <div style={css('display:flex;align-items:flex-end;gap:12px;margin-top:-30px;')}>
                <div style={css('width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#D6336C,#8E1E43);border:3px solid #fff;box-shadow:0 12px 26px -14px rgba(214,51,108,.9);display:flex;align-items:center;justify-content:center;flex:none;')}>
                  <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:21px;color:#fff;")}>{monogram(boutique.name)}</span>
                </div>
                <div style={css('flex:1;min-width:0;padding-bottom:2px;')}>
                  <div style={css('display:flex;align-items:center;gap:5px;')}>
                    <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:18px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>{boutique.name}</span>
                    {boutique.verified && <span style={css("font-family:'Material Symbols Outlined';font-size:16px;color:#3A9BE0;flex:none;")}>verified</span>}
                  </div>
                  <div style={css('display:flex;align-items:center;gap:4px;margin-top:3px;color:var(--ag-muted);font-size:12px;')}>
                    <span style={css("font-family:'Material Symbols Outlined';font-size:14px;color:#E0B84B;")}>star</span>
                    <span style={css('font-weight:700;color:var(--ag-ink-2);')}>{boutique.rating}</span>
                    <span>·</span>
                    <span style={css("font-family:'Material Symbols Outlined';font-size:13px;color:var(--ag-crimson);")}>location_on</span>
                    {boutique.area && boutique.area !== boutique.city ? `${boutique.area}, ${boutique.city}` : boutique.city}
                  </div>
                </div>
              </div>
              <p style={css("margin:12px 0 0;color:var(--ag-ink-2);font-size:13px;line-height:1.5;font-family:'Playfair Display',serif;font-style:italic;")}>{boutique.desc}</p>
              <div style={css('display:flex;gap:18px;margin-top:12px;padding-top:12px;border-top:1px solid var(--ag-border-soft);')}>
                {[
                  { v: compact(boutique.followers), l: 'Followers' },
                  { v: `${boutique.products}+`, l: 'Products' },
                  { v: `${boutique.positiveRating}%`, l: 'Positive' },
                ].map((s) => (
                  <div key={s.l}>
                    <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:15px;color:var(--ag-ink);")}>{s.v}</span>
                    <span style={css('font-size:11px;color:var(--ag-muted);margin-left:5px;')}>{s.l}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Clean link + copy */}
        <div style={css('display:flex;align-items:center;gap:10px;margin:18px 22px 0;padding:6px 6px 6px 16px;border:1.5px solid var(--ag-border);border-radius:16px;background:var(--ag-surface-2);')}>
          <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);font-size:19px;flex:none;")}>link</span>
          <span style={css('flex:1;min-width:0;font-size:13.5px;font-weight:700;color:var(--ag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{prettyLink}</span>
          <button
            onClick={() => copy()}
            style={css(`flex:none;display:flex;align-items:center;gap:6px;border:none;border-radius:12px;padding:10px 15px;font-weight:800;font-size:13px;cursor:pointer;color:#fff;background:${copied ? '#3FA45E' : 'linear-gradient(135deg,#D6336C,#B02454)'};`)}
          >
            <span style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>{copied ? 'check' : 'content_copy'}</span>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>

        {/* Share targets */}
        <div style={css('display:flex;justify-content:space-between;gap:8px;padding:20px 22px 6px;')}>
          {targets.map((t) => (
            <button
              key={t.label}
              onClick={t.onClick}
              aria-label={`Share on ${t.label}`}
              style={css('flex:1;display:flex;flex-direction:column;align-items:center;gap:8px;background:none;border:none;cursor:pointer;')}
            >
              <span style={css(`width:52px;height:52px;border-radius:17px;display:flex;align-items:center;justify-content:center;background:${t.bg};box-shadow:0 12px 26px -14px rgba(0,0,0,.5);`)}>
                <span style={css("font-family:'Material Symbols Outlined';color:#fff;font-size:25px;")}>{t.icon}</span>
              </span>
              <span style={css('font-size:11.5px;color:var(--ag-label);font-weight:700;')}>{t.label}</span>
            </button>
          ))}
        </div>

        {/* Native share / done */}
        <div style={css('padding:12px 22px 22px;')}>
          <button
            onClick={nativeShare}
            style={css('width:100%;height:50px;border:1.5px solid var(--ag-border);border-radius:16px;background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;')}
          >
            <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>ios_share</span>
            More options
          </button>
          <div style={css('text-align:center;margin-top:14px;font-size:11px;color:var(--ag-muted-soft);letter-spacing:.08em;font-weight:700;')}>
            POWERED BY <span style={css('color:var(--ag-crimson);')}>AGILAM</span>
          </div>
        </div>
      </div>
    </div>
  );
}
