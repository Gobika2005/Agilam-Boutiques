import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { COMPANY, CONTACT_LINKS } from '@/data/company';
import { useSettings } from '@/data/settings';

/**
 * Seller help & support.
 *
 * The FAQs expand to real answers (the previous version only echoed the
 * question in a toast), and the contact buttons open real channels — WhatsApp,
 * a phone dialler and email — from the single company-details source, so
 * support routing never drifts from the rest of the app. The old copy also
 * mentioned a "₹299 plan" that no longer exists: MangaiMart earns from commission
 * and optional ads only.
 */

/**
 * Built per render rather than frozen at module scope, because two of these
 * answers quote commercial terms the admin can change — the commission and the
 * payout promise. A hardcoded FAQ that contradicts what the console actually
 * does is worse than no FAQ, which is the failure the policy pages already had
 * to be rescued from.
 */
const buildFaqs = (commissionPct: number, slaHours: number): { q: string; a: string }[] => [
  {
    q: 'How do I add a new product?',
    a: 'Open the Products tab and tap "Add product". Add clear photos, a title, price, sizes and a short description, then publish. Your listing goes live to buyers the moment your boutique is approved.',
  },
  {
    q: 'When do I receive my payouts?',
    a: `Only delivered orders are paid out — while a parcel is on its way, that money is held. Once an order is marked delivered, your share is transferred to your registered bank account within ${slaHours} hours. MangaiMart keeps a ${commissionPct}% commission; the rest is yours. Every payout, with the orders and items it covered, is under Profile → Earnings & payouts.`,
  },
  {
    q: 'Why is my payout less than I expected?',
    a: `Three things reduce a transfer, and all of them are itemised order by order under Profile → Earnings & payouts. First, the ${commissionPct}% commission. Second, any order not yet delivered — it is held, not lost, and appears in your next payout. Third, cash-on-delivery orders: you already collected that money at the door, so MangaiMart's commission and the delivery fees you collected on our behalf are subtracted from your bank transfer instead of being billed to you.`,
  },
  {
    q: 'What does it cost to sell on MangaiMart?',
    a: `There is no monthly fee. MangaiMart takes a flat ${commissionPct}% commission on each delivered order. Advertising your boutique on the marketplace is optional and priced per day — set it up under Profile → Promote & Ads.`,
  },
  {
    q: 'How do I get the Verified badge?',
    a: 'Finish the setup wizard with your correct business, contact, address and payout details and submit for review. Our team verifies the details — usually within 24 hours — and approves your boutique. Follow your status under Profile → Verification status.',
  },
  {
    q: 'Why can buyers not see my boutique yet?',
    a: 'New boutiques stay hidden from buyers until an admin approves them. You can keep adding products in the meantime — they publish automatically once you are approved.',
  },
  {
    q: 'How do offline / walk-in sales work?',
    a: 'Use Profile → Billing to raise an invoice for a walk-in customer and share the bill on WhatsApp in one tap. It keeps your in-store sales and your online orders in one place.',
  },
];

export function Help() {
  const navigate = useNavigate();
  const [open, setOpen] = useState<number | null>(0);
  const { commission_pct: commissionPct, payout_sla_hours: slaHours } = useSettings();
  const FAQS = buildFaqs(commissionPct, slaHours);

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
      <div style={css('padding:6px 20px 12px;display:flex;align-items:center;gap:10px;')}>
        <button onClick={() => navigate('/seller/profile')} aria-label="Back" style={css('width:42px;height:42px;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
        </button>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;")}>Help &amp; Support</h1>
      </div>

      <div style={css('max-width:760px;')}>
        <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);margin:8px 24px 8px;')}>Frequently asked</div>
        <div style={css('margin:0 20px;background:var(--ag-surface);border-radius:18px;overflow:hidden;box-shadow:0 12px 30px -20px rgba(107,20,54,.6);')}>
          {FAQS.map((f, i) => {
            const isOpen = open === i;
            return (
              <div key={f.q} style={css(`border-bottom:${i === FAQS.length - 1 ? 'none' : '1px solid var(--ag-border-soft)'};`)}>
                <button
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  style={css('width:100%;display:flex;align-items:center;gap:11px;padding:15px 14px;border:none;background:none;cursor:pointer;text-align:left;font-family:inherit;')}
                >
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:20px;flex:none;")}>help</span>
                  <span style={css('flex:1;font-weight:700;font-size:13.5px;color:var(--ag-ink);')}>{f.q}</span>
                  <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';color:#CBB0BC;transition:transform .18s ease;transform:rotate(${isOpen ? 180 : 0}deg);`)}>expand_more</span>
                </button>
                {isOpen && (
                  <div style={css('padding:0 14px 15px 45px;font-size:13px;font-weight:500;line-height:1.65;color:#6A545E;')}>{f.a}</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);margin:22px 24px 8px;')}>Still need help?</div>
        <div style={css('margin:0 20px;background:var(--ag-surface);border-radius:18px;overflow:hidden;box-shadow:0 12px 30px -20px rgba(107,20,54,.6);')}>
          {[
            { icon: 'chat', label: 'Chat on WhatsApp', sub: 'Fastest reply during support hours', href: CONTACT_LINKS.whatsapp, ext: true },
            { icon: 'call', label: 'Call support', sub: COMPANY.phone, href: CONTACT_LINKS.call, ext: false },
            { icon: 'mail', label: 'Email support', sub: COMPANY.supportEmail, href: CONTACT_LINKS.support, ext: false },
          ].map((c, i, arr) => (
            <a
              key={c.label}
              href={c.href}
              {...(c.ext ? { target: '_blank', rel: 'noreferrer' } : {})}
              style={css(`display:flex;align-items:center;gap:13px;padding:14px 14px;text-decoration:none;color:inherit;border-bottom:${i === arr.length - 1 ? 'none' : '1px solid var(--ag-border-soft)'};`)}
            >
              <span style={css('width:40px;height:40px;flex:none;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
                <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:21px;")}>{c.icon}</span>
              </span>
              <span style={css('flex:1;min-width:0;')}>
                <span style={css('display:block;font-weight:800;font-size:14.5px;')}>{c.label}</span>
                <span style={css('display:block;font-size:12px;color:var(--ag-muted);font-weight:600;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>{c.sub}</span>
              </span>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#CBB0BC;")}>chevron_right</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
