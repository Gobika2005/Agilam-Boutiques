import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useShop, DEFAULT_FILTERS } from '@/state/ShopContext';
import { COMPANY, COMPANY_ADDRESS_LINE, CONTACT_LINKS } from '@/data/company';

/**
 * The marketplace footer, shared by every full-bleed buyer page.
 *
 * Everything factual here — address, phone, email, handles, statutory ids —
 * comes from `@/data/company`, so the business is corrected in exactly one
 * place. Policy links resolve to the real pages under /:slug.
 */

const SHOP_LINKS: { label: string; to: string; sort?: string }[] = [
  { label: 'New arrivals', to: '/shop', sort: 'Latest' },
  { label: 'Best sellers', to: '/shop', sort: 'Popularity' },
  { label: 'All collections', to: '/shop' },
  { label: 'Boutiques', to: '/boutiques' },
  { label: 'Coupons & offers', to: '/coupons' },
];

const COMPANY_LINKS = [
  { label: `About ${COMPANY.short}`, to: '/about' },
  { label: 'Help & support', to: '/help' },
  { label: 'Track your order', to: '/orders' },
  { label: 'Wishlist', to: '/wishlist' },
];

const POLICY_LINKS = [
  { label: 'Delivery Policy', to: '/delivery-policy' },
  { label: 'Shipping Policy', to: '/shipping-policy' },
  { label: 'Return & Refund', to: '/return-refund-policy' },
  { label: 'Cancellation Policy', to: '/cancellation-policy' },
  { label: 'Product Policy', to: '/product-policy' },
];

const SOCIALS = [
  { icon: 'photo_camera', label: 'Instagram', href: CONTACT_LINKS.instagram },
  { icon: 'thumb_up', label: 'Facebook', href: CONTACT_LINKS.facebook },
  { icon: 'smart_display', label: 'YouTube', href: CONTACT_LINKS.youtube },
  { icon: 'chat', label: 'WhatsApp', href: CONTACT_LINKS.whatsapp },
].filter((s) => !!s.href);

const linkStyle = css('color:#fff;font-size:13.5px;opacity:.86;');

export function SiteFooter() {
  const navigate = useNavigate();
  const { setFilters, setQuery } = useShop();

  // Footer shop links land on a clean results grid rather than inheriting
  // whatever filters the buyer left behind on a previous screen.
  const goShop = (to: string, sort?: string) => {
    if (to === '/shop') {
      setQuery('');
      setFilters({ ...DEFAULT_FILTERS, sort: sort ?? DEFAULT_FILTERS.sort });
    }
    navigate(to);
  };

  const col = (title: string, children: React.ReactNode) => (
    <div>
      <div className="agx-eyebrow" style={css('font-size:10px;color:#F4D9A6;')}>{title}</div>
      <div style={css('display:flex;flex-direction:column;gap:11px;margin-top:16px;')}>{children}</div>
    </div>
  );

  return (
    <footer style={css('width:100vw;margin-left:calc(50% - 50vw);margin-top:44px;background:linear-gradient(140deg,#5C1330,#8E1C44 60%,#B02454);color:#fff;')}>
      <div style={css('max-width:1440px;margin:0 auto;padding:clamp(40px,5vw,64px) clamp(20px,4vw,56px) 28px;')}>
        <div style={css('display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:36px;')}>
          {/* Identity + contact */}
          <div style={css('max-width:340px;')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;letter-spacing:-.01em;")}>{COMPANY.short}</div>
            <div style={css('font-size:13.5px;line-height:1.6;opacity:.82;margin-top:10px;')}>{COMPANY.description}</div>

            <div style={css('display:flex;flex-direction:column;gap:10px;margin-top:18px;font-size:13px;opacity:.9;')}>
              <a href={CONTACT_LINKS.mail} style={css('color:#fff;display:flex;align-items:flex-start;gap:9px;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;color:#F4D9A6;flex:none;")}>mail</span>
                {COMPANY.email}
              </a>
              <a href={CONTACT_LINKS.call} style={css('color:#fff;display:flex;align-items:flex-start;gap:9px;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;color:#F4D9A6;flex:none;")}>call</span>
                {COMPANY.phone}
              </a>
              <div style={css('display:flex;align-items:flex-start;gap:9px;line-height:1.55;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;color:#F4D9A6;flex:none;")}>location_on</span>
                {COMPANY_ADDRESS_LINE}
              </div>
              <div style={css('display:flex;align-items:flex-start;gap:9px;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:18px;color:#F4D9A6;flex:none;")}>schedule</span>
                {COMPANY.supportHours}
              </div>
            </div>

            {SOCIALS.length > 0 && (
              <div style={css('display:flex;gap:10px;margin-top:18px;')}>
                {SOCIALS.map((s) => (
                  <a
                    key={s.label}
                    href={s.href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={s.label}
                    title={s.label}
                    style={css('width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,.12);display:flex;align-items:center;justify-content:center;')}
                  >
                    <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;color:#F4D9A6;")}>{s.icon}</span>
                  </a>
                ))}
              </div>
            )}
          </div>

          {col('Shop', SHOP_LINKS.map((l) => (
            <a key={l.label} href={l.to} onClick={(e) => { e.preventDefault(); goShop(l.to, l.sort); }} style={linkStyle}>{l.label}</a>
          )))}

          {col('Company', COMPANY_LINKS.map((l) => (
            <a key={l.label} href={l.to} onClick={(e) => { e.preventDefault(); navigate(l.to); }} style={linkStyle}>{l.label}</a>
          )))}

          {col('Policies', POLICY_LINKS.map((l) => (
            <a key={l.label} href={l.to} onClick={(e) => { e.preventDefault(); navigate(l.to); }} style={linkStyle}>{l.label}</a>
          )))}

          {col('For boutiques', (
            <>
              <a href="/about" onClick={(e) => { e.preventDefault(); navigate('/about'); }} style={linkStyle}>Sell on {COMPANY.short}</a>
              <a href="/seller/register" onClick={(e) => { e.preventDefault(); navigate('/seller/register'); }} style={linkStyle}>Open your boutique</a>
              <a href="/auth/signin/seller" onClick={(e) => { e.preventDefault(); navigate('/auth/signin/seller'); }} style={linkStyle}>Boutique sign in</a>
              <a href={CONTACT_LINKS.whatsapp} target="_blank" rel="noreferrer noopener" style={linkStyle}>Partner support</a>
            </>
          ))}
        </div>

        <div style={css('border-top:1px solid rgba(255,255,255,.15);margin-top:36px;padding-top:20px;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;font-size:12.5px;opacity:.75;')}>
          <span>
            © {new Date().getFullYear()} {COMPANY.legalName}. Made in {COMPANY.address.state}.
            {COMPANY.cin && <> · CIN {COMPANY.cin}</>}
            {COMPANY.gstin && <> · GSTIN {COMPANY.gstin}</>}
          </span>
          <span style={css('display:flex;gap:18px;flex-wrap:wrap;')}>
            <a href="/privacy-policy" onClick={(e) => { e.preventDefault(); navigate('/privacy-policy'); }} style={css('color:#fff;')}>Privacy</a>
            <a href="/terms" onClick={(e) => { e.preventDefault(); navigate('/terms'); }} style={css('color:#fff;')}>Terms</a>
            <a href={CONTACT_LINKS.grievance} style={css('color:#fff;')}>Grievance</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
