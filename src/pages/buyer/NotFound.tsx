import { Link } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { SiteFooter } from '@/components/buyer/SiteFooter';
import { routes } from '@/lib/seo';

/**
 * A real 404.
 *
 * Every unknown URL used to `<Navigate to="/" replace />` — which returns HTTP
 * 200 with the homepage. To a crawler that is a "soft 404": it means every
 * typo, every dead link and every URL an old sitemap ever contained looks like
 * a valid, indexable page, and Google ends up with an unbounded set of
 * duplicate homepages. It also means a shopper who mistypes a URL is silently
 * teleported home with no explanation.
 *
 * This page says what happened, is `noindex`, and — because a dead end is a
 * lost sale — offers the routes a lost shopper actually wants.
 */

const WAYS_OUT: { to: string; icon: string; label: string; note: string }[] = [
  { to: routes.home(), icon: 'home', label: 'Home', note: 'Start again from the top' },
  { to: routes.collections(), icon: 'grid_view', label: 'Shop by collection', note: 'Every category and occasion' },
  { to: routes.newArrivals(), icon: 'auto_awesome', label: 'New arrivals', note: 'Listed in the last 30 days' },
  { to: routes.boutiques(), icon: 'storefront', label: 'Boutiques', note: 'Every verified shop' },
];

export function NotFound() {
  usePageMeta({
    title: 'Page not found',
    description: 'This page doesn’t exist on MangaiMart. Browse verified Tamil Nadu boutiques, sarees, kurta sets and more.',
    noindex: true,
  });

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);')}>
      <div style={css('max-width:760px;margin:0 auto;padding:56px 20px 40px;text-align:center;')}>
        <div style={css('width:96px;height:96px;margin:0 auto;border-radius:30px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:48px;color:#D6336C;")} aria-hidden="true">
            explore_off
          </span>
        </div>

        <p className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);margin:22px 0 0;')}>
          Error 404
        </p>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(28px,3.6vw,44px);line-height:1.06;letter-spacing:-.015em;margin:8px 0 0;")}>
          We couldn’t find that page
        </h1>
        <p style={css('color:var(--ag-muted);font-size:15px;line-height:1.6;margin:12px auto 0;max-width:460px;')}>
          The link may be out of date, or the piece may have sold out and been taken down by its boutique.
          Everything else is still here.
        </p>

        <h2 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:20px;margin:38px 0 0;")}>
          Where would you like to go?
        </h2>

        <div style={css('display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:18px;text-align:left;')}>
          {WAYS_OUT.map((w) => (
            <Link
              key={w.to}
              to={w.to}
              className="agx-lift"
              style={css('display:flex;align-items:center;gap:12px;padding:16px;border:1.5px solid var(--ag-border);border-radius:18px;background:var(--ag-surface);color:inherit;text-decoration:none;min-height:44px;')}
            >
              <span style={css("font-family:'Material Symbols Outlined';font-size:24px;color:#D6336C;flex:none;")} aria-hidden="true">
                {w.icon}
              </span>
              <span>
                <span style={css('display:block;font-weight:800;font-size:14.5px;')}>{w.label}</span>
                <span style={css('display:block;color:var(--ag-muted);font-size:12px;margin-top:2px;')}>{w.note}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
