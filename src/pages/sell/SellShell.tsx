import { useEffect } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { css } from '@/lib/css';
import { Icon } from '@/components/ui/Icon';
import { COMPANY, CONTACT_LINKS } from '@/data/company';
import { LABEL_LG, LABEL_SM, SERIF } from './parts';
import { SELL_NAV, SELLER_SIGNIN, START_SELLING } from './sellContent';

/**
 * The shell around the public seller site.
 *
 * Deliberately NOT `BuyerLayout`. That shell is a shopping app — bottom tab
 * bar, floating bag, search, notification bell — and every one of those is
 * noise to a boutique owner deciding whether to open a shop. It is also not
 * `SellerLayout`, which is the signed-in console behind `RequireRole`. This is
 * a third thing: a marketing site, with one job, which is to explain the deal
 * honestly and then get out of the way of the "Open your boutique" button.
 *
 * Two entry points and no others, both existing routes: `/seller/register`
 * (the onboarding wizard, which opens on its own account step for a signed-out
 * visitor) and `/auth/signin/seller` for someone who already has a shop.
 */

const SELL_FOOTER_COMPANY = [
  { label: `About ${COMPANY.short}`, to: '/about' },
  { label: 'Browse the storefront', to: '/' },
  { label: 'Terms & conditions', to: '/terms' },
  { label: 'Privacy policy', to: '/privacy-policy' },
];

export function SellShell() {
  const { pathname } = useLocation();
  useLightOnly();

  return (
    // `agx-sell-light` pins the whole seller site to the light palette whatever
    // the visitor's theme is — see the block by that name in index.css.
    //
    // `overflow-x:clip` contains the full-bleed `Band`s, which step outside the
    // centred column with `width:100vw`. On a desktop with a classic scrollbar
    // 100vw is wider than the content box, and without this the whole page can
    // be dragged sideways. `clip` rather than `hidden` so it does not create a
    // scroll container and break `position:sticky` on the header.
    <div className="agx-sell-light" style={css('min-height:100vh;background:var(--ag-bg);overflow-x:clip;')}>
      <SellHeader pathname={pathname} />
      <main className="agx-app">
        <Outlet />
      </main>
      <SellFooter />
    </div>
  );
}

/**
 * Keeps the phone's browser chrome in step with the light page.
 *
 * The palette is pinned in CSS, but `<meta name="theme-color">` is not a CSS
 * variable — `ThemeContext` writes the dark value into it, and a dark-mode
 * visitor would otherwise get a near-black address bar sitting on top of a
 * cream page. The previous value is restored on the way out, so the storefront
 * is exactly as it was.
 *
 * Nothing races here: the seller site's header has no theme toggle (there is no
 * ProfileMenu on it), so `ThemeContext`'s own effect cannot fire while these
 * pages are mounted.
 */
function useLightOnly() {
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const previous = meta.getAttribute('content');
    meta.setAttribute('content', LIGHT_BG);
    return () => { if (previous) meta.setAttribute('content', previous); };
  }, []);
}

/** `--ag-bg` in the light palette. Mirrors index.css and ThemeContext. */
const LIGHT_BG = '#FBF6F2';

function SellHeader({ pathname }: { pathname: string }) {
  return (
    <header
      style={css(
        'position:sticky;top:0;z-index:40;background:var(--ag-surface);' +
          'border-bottom:1px solid var(--ag-border);',
      )}
    >
      <div
        style={css(
          'max-width:1280px;margin:0 auto;padding:0 clamp(16px,3vw,24px);height:80px;' +
            'display:flex;align-items:center;gap:clamp(14px,3vw,32px);',
        )}
      >
        {/* Brand. The wordmark links to the storefront, not to /sell — a seller
            who wants to see what buyers see should be one tap away from it. */}
        <Link to="/" style={css('display:flex;align-items:center;gap:11px;text-decoration:none;flex:none;')}>
          <img
            className="agx-brand-mark"
            src="/mangaimart-wordmark.webp"
            alt={COMPANY.short}
            width={150}
            height={60}
            style={css('display:block;width:132px;height:53px;object-fit:contain;object-position:left center;')}
          />
          <span
            style={css(
              `${LABEL_SM}font-size:10px;` +
                'color:var(--ag-crimson);border-left:1px solid var(--ag-border);padding-left:11px;white-space:nowrap;',
            )}
          >
            for sellers
          </span>
        </Link>

        <nav className="agx-sell-nav" style={css('display:flex;align-items:center;gap:clamp(12px,2vw,26px);margin-left:auto;')}>
          {SELL_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/sell'}
              style={({ isActive }) =>
                css(
                  `${LABEL_LG}text-decoration:none;white-space:nowrap;padding-bottom:4px;` +
                    (isActive
                      ? 'color:var(--ag-deep);border-bottom:2px solid var(--ag-deep);'
                      : 'color:var(--ag-muted);border-bottom:2px solid transparent;'),
                )
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div style={css('display:flex;align-items:center;gap:10px;margin-left:auto;flex:none;')}>
          <Link
            to={SELLER_SIGNIN}
            className="agx-hide-sm"
            style={css(`${LABEL_LG}color:var(--ag-muted);text-decoration:none;padding:8px 6px;`)}
          >
            Sign in
          </Link>
          <Link
            to={START_SELLING}
            style={css(
              'display:inline-flex;align-items:center;gap:7px;padding:10px 20px;border-radius:0.5rem;' +
                `background:var(--ag-deep);color:#fff;${LABEL_LG}` +
                'text-decoration:none;white-space:nowrap;',
            )}
          >
            Start selling
          </Link>
        </div>
      </div>

      {/* Below 940px the nav drops out of the bar and becomes this scrollable
          rail, which keeps all five destinations reachable on a phone without a
          hamburger nobody opens. */}
      <div
        className="agx-sell-rail agx-scroll"
        style={css(
          'display:none;overflow-x:auto;border-top:1px solid var(--ag-border-soft);' +
            'padding:0 clamp(14px,4vw,20px);gap:18px;',
        )}
      >
        {SELL_NAV.map((item) => {
          const active = item.to === '/sell' ? pathname === '/sell' : pathname.startsWith(item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              style={css(
                'font-size:13.5px;font-weight:600;text-decoration:none;white-space:nowrap;padding:11px 0;' +
                  (active
                    ? 'color:var(--ag-deep);box-shadow:inset 0 -2px 0 var(--ag-crimson);'
                    : 'color:var(--ag-muted);'),
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}

function SellFooter() {
  return (
    <footer
      style={css(
        'width:100vw;margin-left:calc(50% - 50vw);margin-top:0;' +
          'background:linear-gradient(140deg,#5C1330,#8E1C44 60%,#B02454);color:#fff;',
      )}
    >
      <div style={css('max-width:1280px;margin:0 auto;padding:clamp(48px,6vw,80px) clamp(20px,3vw,24px) 32px;')}>
        <div style={css('display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:34px;')}>
          <div style={css('max-width:330px;')}>
            <img
              className="agx-brand-mark-footer"
              src="/mangaimart-wordmark.webp"
              alt={COMPANY.short}
              width={204}
              height={82}
              loading="lazy"
              decoding="async"
              style={css('display:block;width:186px;height:75px;max-width:100%;object-fit:contain;object-position:left center;')}
            />
            <p style={css('font-size:13.5px;line-height:1.65;opacity:.86;margin:10px 0 0;')}>
              A marketplace for India’s independent boutiques. You keep your shop, your name and your
              way of working — we bring the buyers, hold the money and settle it to you after delivery.
            </p>
            <Link
              to={START_SELLING}
              style={css(
                'display:inline-flex;align-items:center;gap:8px;margin-top:20px;height:46px;padding:0 20px;' +
                  'border-radius:14px;background:#fff;color:#8E1C44;font-size:14px;font-weight:800;text-decoration:none;',
              )}
            >
              Open your boutique
              <Icon name="arrow_forward" style={css('font-size:18px;')} />
            </Link>
          </div>

          <FooterCol title="For sellers">
            {SELL_NAV.map((item) => (
              <Link key={item.to} to={item.to} style={footerLink}>
                {item.label}
              </Link>
            ))}
            <Link to={SELLER_SIGNIN} style={footerLink}>
              Seller sign in
            </Link>
          </FooterCol>

          <FooterCol title="MangaiMart">
            {SELL_FOOTER_COMPANY.map((item) => (
              <Link key={item.to} to={item.to} style={footerLink}>
                {item.label}
              </Link>
            ))}
          </FooterCol>

          <FooterCol title="Talk to a person">
            <a href={CONTACT_LINKS.call} style={footerLink}>
              {COMPANY.phone}
            </a>
            <a href={CONTACT_LINKS.mail} style={footerLink}>
              {COMPANY.email}
            </a>
            <a href={CONTACT_LINKS.whatsapp} style={footerLink} target="_blank" rel="noreferrer">
              WhatsApp us
            </a>
            <span style={css('font-size:12.5px;line-height:1.6;opacity:.7;')}>
              Ask anything before you sign up. There is no sales call afterwards.
            </span>
          </FooterCol>
        </div>

        <div
          style={css(
            'margin-top:34px;padding-top:18px;border-top:1px solid rgba(255,255,255,.2);' +
              'display:flex;flex-wrap:wrap;gap:10px 22px;justify-content:space-between;font-size:12.5px;opacity:.78;',
          )}
        >
          <span>
            © {new Date().getFullYear()} {COMPANY.legalName}
          </span>
          <span>{COMPANY.address.city}, {COMPANY.address.state} · Selling open across India</span>
        </div>
      </div>
    </footer>
  );
}

const footerLink = css('color:#fff;font-size:13.5px;opacity:.86;text-decoration:none;');

function FooterCol({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={css(
          `font-family:${SERIF};font-size:15px;font-weight:700;color:#F4D9A6;letter-spacing:.01em;`,
        )}
      >
        {title}
      </div>
      <div style={css('display:flex;flex-direction:column;gap:11px;margin-top:15px;')}>{children}</div>
    </div>
  );
}
