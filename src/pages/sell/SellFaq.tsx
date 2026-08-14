import { useMemo } from 'react';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { graph, organizationSchema, breadcrumbSchema, faqSchema } from '@/lib/schema';
import { COMPANY, CONTACT_LINKS } from '@/data/company';
import { Icon } from '@/components/ui/Icon';
import { Band, Card, CtaPair, Display, Eyebrow, LABEL_SM, Lede, SERIF, Text, Wrap } from './parts';
import { ALL_FAQS, FAQ_GROUPS, START_SELLING } from './sellContent';
import { useSellerTerms } from './useSellerTerms';

/**
 * `/sell/faq` — the questions, answered in full, on the page.
 *
 * Not an accordion. A seller reading this is deciding whether to trust us with
 * her income, and hiding the answers behind twenty taps is the wrong instinct
 * for that; it also hides the text from the crawler that would otherwise put
 * these questions in front of the next person searching for them. The answers
 * are also fed to `faqSchema`, filled with the live rates first — a rich result
 * quoting a stale fee is worse than no rich result at all.
 */
export function SellFaq() {
  const terms = useSellerTerms();

  const filled = useMemo(
    () => ALL_FAQS.map((f) => ({ q: f.q, a: terms.fill(f.a) })),
    [terms],
  );

  usePageMeta({
    title: 'Seller Questions — GST, Fees, Payouts, Delivery',
    description:
      'Straight answers for boutique owners thinking about selling on MangaiMart: whether you need GST, what it costs, when you are paid, who delivers, and what happens to returns.',
    canonical: '/sell/faq',
    schema: graph(
      organizationSchema(),
      breadcrumbSchema([
        { name: 'Home', path: '/' },
        { name: 'Sell on MangaiMart', path: '/sell' },
        { name: 'Questions', path: '/sell/faq' },
      ]),
      faqSchema(filled),
    ),
  });

  return (
    <>
      <Band>
        <Wrap>
          <Eyebrow>Questions</Eyebrow>
          <Display level={1} size="lg">
            The things people actually ask before they sign up.
          </Display>
          <Lede>
            Answered here rather than after you have registered. If yours is not below, call or
            message us — a person answers, and there is no sales call afterwards.
          </Lede>
        </Wrap>
      </Band>

      <Band tone="panel">
        <Wrap wide style={css('padding-top:clamp(34px,4vw,48px);')}>
          <div className="agx-sell-lean" style={css('align-items:start;')}>
            {/* The answers. */}
            <div>
              {FAQ_GROUPS.map((group) => (
                <section
                  key={group.title}
                  id={slugForGroup(group.title)}
                  style={css('margin-bottom:clamp(36px,5vw,54px);scroll-margin-top:120px;')}
                >
                  <h2
                    style={css(
                      `${LABEL_SM}` +
                        'color:var(--ag-crimson);margin:0 0 6px;',
                    )}
                  >
                    {group.title}
                  </h2>
                  {group.items.map((item) => (
                    <div key={item.q} style={css('padding:22px 0;border-top:1px solid var(--ag-border);')}>
                      <h3
                        style={css(
                          `font-family:${SERIF};font-weight:700;font-size:20px;line-height:1.3;margin:0;color:var(--ag-ink);`,
                        )}
                      >
                        {item.q}
                      </h3>
                      <p style={css('margin:10px 0 0;font-size:15.5px;line-height:1.7;color:var(--ag-ink-2);max-width:64ch;')}>
                        {terms.fill(item.a)}
                      </p>
                    </div>
                  ))}
                </section>
              ))}
            </div>

            {/* The index. Sticky on desktop, an ordinary list on a phone. */}
            <aside className="agx-sell-faq-index">
              <Card pad={24}>
                <div
                  style={css(
                    `${LABEL_SM}color:var(--ag-muted);`,
                  )}
                >
                  On this page
                </div>
                <nav style={css('display:flex;flex-direction:column;gap:11px;margin-top:14px;')}>
                  {FAQ_GROUPS.map((g) => (
                    <a
                      key={g.title}
                      href={`#${slugForGroup(g.title)}`}
                      style={css('font-size:14.5px;font-weight:600;color:var(--ag-ink-2);text-decoration:none;')}
                    >
                      {g.title}
                    </a>
                  ))}
                </nav>

                <div style={css('height:1px;background:var(--ag-border);margin:20px 0;')} />

                <div style={css(`font-family:${SERIF};font-size:17px;font-weight:700;color:var(--ag-ink);`)}>
                  Not answered here?
                </div>
                <p style={css('margin:8px 0 0;font-size:13.5px;line-height:1.6;color:var(--ag-muted);')}>
                  Ask before you sign up, not after.
                </p>
                <div style={css('display:flex;flex-direction:column;gap:10px;margin-top:14px;')}>
                  <a href={CONTACT_LINKS.call} style={contactRow}>
                    <Icon name="call" style={css('font-size:18px;color:var(--ag-crimson);')} />
                    {COMPANY.phone}
                  </a>
                  <a href={CONTACT_LINKS.whatsapp} target="_blank" rel="noreferrer" style={contactRow}>
                    <Icon name="chat" style={css('font-size:18px;color:var(--ag-crimson);')} />
                    WhatsApp us
                  </a>
                  <a href={CONTACT_LINKS.mail} style={contactRow}>
                    <Icon name="mail" style={css('font-size:18px;color:var(--ag-crimson);')} />
                    {COMPANY.email}
                  </a>
                </div>
              </Card>
            </aside>
          </div>
        </Wrap>
      </Band>

      <Band>
        <Wrap>
          <Display>Ready when you are.</Display>
          <Text>
            Nothing is charged and nothing is committed at signup. You can fill in half of it, think
            about it, and come back — everything is saved.
          </Text>
          <CtaPair
            to={START_SELLING}
            label="Open your boutique"
            secondaryTo="/sell/how-it-works"
            secondaryLabel="See the steps first"
          />
        </Wrap>
      </Band>
    </>
  );
}

const contactRow = css(
  'display:flex;align-items:center;gap:10px;font-size:14px;font-weight:600;color:var(--ag-ink-2);text-decoration:none;',
);

function slugForGroup(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
