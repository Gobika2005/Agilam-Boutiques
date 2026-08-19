import { useLocation, useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { SiteFooter } from '@/components/buyer/SiteFooter';
import { COMPANY, CONTACT_LINKS } from '@/data/company';
import { POLICIES_UPDATED, usePolicies, usePolicy, useLegalPages } from '@/data/policies';
import { articleSchema, breadcrumbSchema, faqSchema, graph, organizationSchema } from '@/lib/schema';

/**
 * One component for every informational page — the seven legal policies plus
 * About and Help. The content lives in `@/data/policies`; this only lays it out.
 */
export function Policy() {
  const navigate = useNavigate();
  // These pages live at the root now — `/privacy-policy` rather than the old
  // `/buyer/policy/privacy-policy` — so the slug is the path itself. One route
  // is registered per known slug in App.tsx, so this always resolves.
  const { pathname } = useLocation();
  const slug = pathname.replace(/^\/+|\/+$/g, '');
  // All three read the same live settings row, so the quoted fees and windows
  // match what checkout charges. Called unconditionally, above the "not found"
  // early return, because they are hooks.
  const page = usePolicy(slug);
  const allPolicies = usePolicies();
  const legalPages = useLegalPages();

  /**
   * Help is a genuine Q&A page, so it is marked up as one — an FAQ rich result
   * is the difference between one blue link and a block of expandable answers.
   * The other pages are documents, not storefront surfaces.
   */
  const faqs = page?.slug === 'help'
    ? page.sections
        .filter((s) => s.heading && s.blocks.length)
        // One entry per section — repeating a heading once per paragraph would
        // emit duplicate Questions, which the Rich Results test rejects.
        .map((s) => ({ q: s.heading, a: s.blocks.join(' ') }))
        .slice(0, 10)
    : [];

  usePageMeta({
    title: page?.title ?? null,
    description: page?.summary ?? null,
    type: 'article',
    schema: page
      ? graph(
          organizationSchema(),
          articleSchema({
            title: page.title,
            description: page.summary,
            path: `/${page.slug}`,
            updated: '2026-07-22',
          }),
          breadcrumbSchema([
            { name: 'Home', path: '/' },
            { name: page.title, path: `/${page.slug}` },
          ]),
          faqs.length ? faqSchema(faqs) : null,
        )
      : null,
  });

  if (!page) {
    return (
      <div style={css('min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;')}>
        <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:44px;color:var(--ag-border);")}>description</span>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;")}>Page not found</div>
        <div style={css('color:var(--ag-muted);font-size:14px;')}>That policy doesn’t exist (or has moved).</div>
        <button onClick={() => navigate('/')} style={css('margin-top:4px;background:#B02454;color:#fff;border:none;border-radius:12px;padding:11px 22px;font-weight:800;cursor:pointer;')}>
          Back to home
        </button>
      </div>
    );
  }

  const others = allPolicies.filter((p) => p.slug !== page.slug);

  return (
    <div style={css('width:100vw;margin-left:calc(50% - 50vw);min-height:100%;background:var(--ag-bg);')}>
      <div style={css('max-width:1120px;margin:0 auto;padding:14px clamp(16px,4vw,44px) 0;')}>
        {/* Breadcrumb */}
        <div style={css('display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ag-muted);flex-wrap:wrap;')}>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }} style={css('color:var(--ag-muted);')}>Home</a>
          <span>/</span>
          <span style={css('color:var(--ag-ink);font-weight:700;')}>{page.title}</span>
        </div>

        {/* Title block */}
        <div style={css('display:flex;align-items:flex-start;gap:16px;margin-top:18px;')}>
          <div style={css('width:56px;height:56px;flex:none;border-radius:18px;background:linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44);display:flex;align-items:center;justify-content:center;box-shadow:0 16px 30px -16px rgba(176,36,84,.9);')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:27px;color:#fff;")}>{page.icon}</span>
          </div>
          <div style={css('flex:1;min-width:0;')}>
            <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>{page.eyebrow}</div>
            <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(28px,3.4vw,44px);line-height:1.06;letter-spacing:-.015em;margin:6px 0 0;")}>{page.title}</h1>
            <div style={css('color:var(--ag-ink-2);font-size:15px;margin-top:10px;line-height:1.55;max-width:640px;')}>{page.summary}</div>
            <div style={css("font-family:'IBM Plex Mono',monospace;font-size:11px;color:var(--ag-muted-soft);margin-top:12px;letter-spacing:.04em;")}>
              Last updated {POLICIES_UPDATED}
            </div>
          </div>
        </div>

        <div className="agx-policy-grid" style={css('display:grid;gap:34px;align-items:start;margin-top:30px;padding-bottom:48px;')}>
          {/* Body */}
          <article style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:24px;padding:clamp(20px,3vw,36px);box-shadow:0 20px 48px -36px rgba(107,20,54,.55);')}>
            {page.sections.map((s, si) => (
              <section key={s.heading} style={css(si > 0 ? 'margin-top:32px;' : '')}>
                <h2 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(19px,2.1vw,24px);line-height:1.2;margin:0 0 12px;color:var(--ag-ink);")}>
                  {s.heading}
                </h2>
                {s.blocks.map((b, bi) => {
                  const bullet = b.startsWith('- ');
                  const text = bullet ? b.slice(2) : b;
                  return (
                    <p
                      key={bi}
                      style={css(
                        `color:var(--ag-ink-2);font-size:14.8px;line-height:1.72;margin:${bi === 0 ? '0' : '11px'} 0 0;${
                          bullet ? 'display:flex;gap:11px;padding-left:2px;' : 'text-wrap:pretty;'
                        }`,
                      )}
                    >
                      {bullet && (
                        <span style={css('flex:none;width:6px;height:6px;border-radius:50%;background:#D6336C;margin-top:9px;')} />
                      )}
                      <span style={css('flex:1;')}>{text}</span>
                    </p>
                  );
                })}
              </section>
            ))}

            {/* Direct contact actions — every policy ends by pointing at a human. */}
            <div style={css('display:flex;flex-wrap:wrap;gap:10px;margin-top:30px;padding-top:24px;border-top:1px solid var(--ag-border-soft);')}>
              <a href={CONTACT_LINKS.support} style={css('display:flex;align-items:center;gap:8px;height:46px;padding:0 18px;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13.5px;box-shadow:0 14px 28px -16px rgba(214,51,108,.85);')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>mail</span>Email support
              </a>
              <a href={CONTACT_LINKS.call} style={css('display:flex;align-items:center;gap:8px;height:46px;padding:0 18px;border-radius:14px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:13.5px;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>call</span>{COMPANY.phone}
              </a>
            </div>
          </article>

          {/* Other pages */}
          <aside className="agx-policy-aside">
            <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;padding:8px;box-shadow:0 18px 40px -34px rgba(107,20,54,.55);')}>
              <div className="agx-eyebrow" style={css('font-size:9.5px;color:var(--ag-muted);padding:12px 12px 8px;')}>More from MangaiMart</div>
              {others.map((o, i) => (
                <button
                  key={o.slug}
                  onClick={() => navigate(`/${o.slug}`)}
                  style={css(`width:100%;display:flex;align-items:center;gap:12px;padding:12px;border:none;background:none;cursor:pointer;text-align:left;${i < others.length - 1 ? 'border-bottom:1px solid #F7EBF1;' : ''}`)}
                >
                  <span style={css('width:36px;height:36px;flex:none;border-radius:11px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
                    <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:19px;")}>{o.icon}</span>
                  </span>
                  <span style={css('flex:1;min-width:0;font-weight:800;font-size:13.5px;color:var(--ag-ink);')}>{o.title}</span>
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;font-size:20px;flex:none;")}>chevron_right</span>
                </button>
              ))}
            </div>

            {/* The legal set, compactly, so a buyer on a policy page can always
                see the full list they're inside. */}
            <div style={css('margin-top:14px;padding:16px 18px;background:var(--ag-surface-2);border:1px solid var(--ag-border);border-radius:20px;')}>
              <div className="agx-eyebrow" style={css('font-size:9.5px;color:var(--ag-crimson);')}>Policies</div>
              <div style={css('display:flex;flex-direction:column;gap:9px;margin-top:12px;')}>
                {legalPages.map((p) => (
                  <a
                    key={p.slug}
                    href={`/${p.slug}`}
                    onClick={(e) => { e.preventDefault(); navigate(`/${p.slug}`); }}
                    style={css(`font-size:13px;font-weight:${p.slug === page.slug ? 800 : 600};color:${p.slug === page.slug ? 'var(--ag-crimson)' : 'var(--ag-label)'};`)}
                  >
                    {p.title}
                  </a>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
