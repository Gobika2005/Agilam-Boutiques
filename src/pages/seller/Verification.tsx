import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { fetchBoutiquePrivate } from '@/data/boutiques';
import type { BoutiqueStatus } from '@/data/types';
import { Skeleton, SkeletonGroup, SkeletonText } from '@/components/ui/Skeleton';

/**
 * Where a seller lands after submitting their setup wizard, and the screen the
 * console's status banner links to.
 *
 * The three non-approved outcomes each get their own copy: waiting on review,
 * a correction list they can act on, and a rejection with the reason. The
 * admin's note lives in a column withheld from the public API, so it arrives
 * via `fetchBoutiquePrivate` rather than off the boutique row.
 */

const CHECKS = [
  { label: 'Boutique details', icon: 'storefront' },
  { label: 'Contact information', icon: 'call' },
  { label: 'Shop address', icon: 'location_on' },
  { label: 'Business documents', icon: 'business_center' },
  { label: 'Payout details', icon: 'account_balance' },
];

type Tone = { bg: string; border: string; fg: string; icon: string; accent: string };

const TONE: Record<Exclude<BoutiqueStatus, 'approved'>, Tone> = {
  draft: { bg: 'var(--ag-gold-bg)', border: 'var(--ag-gold-border)', fg: 'var(--ag-gold-text)', icon: 'edit_note', accent: 'var(--ag-gold-text)' },
  pending: { bg: 'var(--ag-info-bg)', border: 'var(--ag-info-bg)', fg: 'var(--ag-info-text)', icon: 'hourglass_top', accent: 'var(--ag-info-text)' },
  changes_requested: { bg: 'var(--ag-gold-bg)', border: 'var(--ag-gold-border)', fg: 'var(--ag-gold-text)', icon: 'edit_note', accent: 'var(--ag-gold-text)' },
  rejected: { bg: 'var(--ag-bad-bg)', border: 'var(--ag-bad-bg)', fg: 'var(--ag-crimson)', icon: 'cancel', accent: 'var(--ag-danger-text)' },
};

const COPY: Record<Exclude<BoutiqueStatus, 'approved'>, { eyebrow: string; heading: string; body: string; cta: string | null }> = {
  draft: {
    eyebrow: 'Setup incomplete',
    heading: 'Finish setting up your boutique',
    body: 'You have not submitted your boutique for verification yet. Complete the seven setup steps and send it to our team to go live.',
    cta: 'Continue setup',
  },
  pending: {
    eyebrow: 'Under review',
    heading: 'Your application is with our team',
    body: 'We are verifying your boutique details. This usually takes under 24 hours. You can keep adding products in the meantime — they publish to buyers the moment you are approved.',
    cta: null,
  },
  changes_requested: {
    eyebrow: 'Action needed',
    heading: 'A few details need correcting',
    body: 'Our team reviewed your application and needs some changes before your boutique can go live. Update the details below and resubmit.',
    cta: 'Edit & resubmit',
  },
  rejected: {
    eyebrow: 'Not approved',
    heading: 'Your application was not approved',
    body: 'Our team could not verify this boutique. The reason is below. If you believe this is a mistake, contact support and we will take another look.',
    cta: null,
  },
};

export function Verification() {
  const navigate = useNavigate();
  const { boutique, loading } = useMyBoutique();
  const [note, setNote] = useState<string | null>(null);
  const boutiqueId = boutique?.id;

  useEffect(() => {
    if (!boutiqueId) return;
    let cancelled = false;
    fetchBoutiquePrivate(boutiqueId)
      .then((p) => { if (!cancelled) setNote(p?.review_note ?? null); })
      .catch(() => { /* the note is supporting detail, never blocking */ });
    return () => { cancelled = true; };
  }, [boutiqueId]);

  // Approved sellers have no business on this screen; a seller with no boutique
  // row at all has not started the wizard yet.
  useEffect(() => {
    if (loading) return;
    if (!boutique) navigate('/seller/onboarding', { replace: true });
    else if (boutique.status === 'approved') navigate('/seller/dashboard', { replace: true });
  }, [loading, boutique, navigate]);

  if (loading || !boutique) {
    return (
      <div style={css('min-height:100%;background:var(--ag-bg);padding:28px 20px;')}>
        <SkeletonGroup label="Loading your verification status…">
          <Skeleton w={64} h={64} radius={20} />
          <Skeleton w="62%" h={24} radius={9} style="margin-top:18px;" />
          <div style={css('margin-top:14px;')}><SkeletonText lines={2} /></div>
          <Skeleton w="100%" h={140} radius={18} style="margin-top:24px;" />
        </SkeletonGroup>
      </div>
    );
  }

  const status = (boutique.status === 'approved' ? 'pending' : boutique.status) as Exclude<BoutiqueStatus, 'approved'>;
  const tone = TONE[status];
  const copy = COPY[status];
  const submitted = boutique.submitted_at ? new Date(boutique.submitted_at) : null;

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:24px;')}>
      <div style={css('max-width:760px;margin:0 auto;padding:8px clamp(16px,4vw,24px) 0;')}>
        <div style={css('display:flex;align-items:center;gap:10px;padding:6px 0 14px;')}>
          <button
            aria-label="Go back"
            onClick={() => navigate('/seller/profile')}
            style={css('width:42px;height:42px;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
          </button>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;")}>Verification</div>
        </div>

        {/* Status hero */}
        <div style={css(`background:${tone.bg};border:1px solid ${tone.border};border-radius:22px;padding:22px;`)}>
          <div style={css('display:flex;align-items:center;gap:13px;')}>
            <span style={css(`width:52px;height:52px;flex:none;border-radius:16px;background:var(--ag-surface);display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px -18px rgba(0,0,0,.5);`)}>
              <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:27px;color:${tone.accent};`)}>{tone.icon}</span>
            </span>
            <div>
              <div className="agx-eyebrow" style={css(`font-size:9.5px;color:${tone.accent};`)}>{copy.eyebrow}</div>
              <div style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(20px,2.6vw,26px);line-height:1.2;margin-top:3px;color:${tone.fg};`)}>{copy.heading}</div>
            </div>
          </div>
          <div style={css(`font-size:13.5px;font-weight:600;line-height:1.6;margin-top:14px;color:${tone.fg};opacity:.9;`)}>{copy.body}</div>

          {submitted && status !== 'draft' && (
            <div style={css(`font-size:12px;font-weight:700;margin-top:12px;color:${tone.accent};`)}>
              Submitted {submitted.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} at{' '}
              {submitted.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}

          {copy.cta && (
            <button
              onClick={() => navigate('/seller/onboarding')}
              style={css('margin-top:16px;height:50px;padding:0 24px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:pointer;display:inline-flex;align-items:center;gap:8px;box-shadow:0 14px 30px -16px rgba(214,51,108,.85);font-family:inherit;')}
            >
              {copy.cta}
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>arrow_forward</span>
            </button>
          )}
        </div>

        {/* The admin's correction list / rejection reason */}
        {note && (
          <div style={css('margin-top:16px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:18px;box-shadow:0 16px 38px -30px rgba(107,20,54,.6);')}>
            <div style={css('display:flex;align-items:center;gap:8px;')}>
              <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:20px;color:${tone.accent};`)}>feedback</span>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:18px;")}>
                {status === 'rejected' ? 'Reason' : 'What needs changing'}
              </div>
            </div>
            <div style={css('margin-top:10px;font-size:13.5px;font-weight:600;color:var(--ag-ink-2);line-height:1.65;white-space:pre-wrap;')}>{note}</div>
          </div>
        )}

        {/* What the team checks */}
        <div style={css('margin-top:16px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:18px;box-shadow:0 16px 38px -30px rgba(107,20,54,.6);')}>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:18px;")}>What our team verifies</div>
          <div style={css('margin-top:12px;display:flex;flex-direction:column;gap:10px;')}>
            {CHECKS.map((c) => (
              <div key={c.label} style={css('display:flex;align-items:center;gap:11px;')}>
                <span style={css('width:34px;height:34px;flex:none;border-radius:11px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
                  <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:#D6336C;font-size:18px;")}>{c.icon}</span>
                </span>
                <span style={css('flex:1;font-weight:700;font-size:13.5px;color:var(--ag-ink);')}>{c.label}</span>
                <span aria-hidden="true" style={css(`font-family:'Material Symbols Outlined';font-size:19px;color:${status === 'pending' ? '#C7B2BC' : tone.accent};`)}>
                  {status === 'pending' ? 'pending' : status === 'rejected' ? 'close' : 'edit'}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div style={css('margin-top:16px;display:flex;gap:12px;flex-wrap:wrap;')}>
          <button
            onClick={() => navigate('/seller/add-product')}
            style={css('flex:1;min-width:180px;height:50px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:14px;font-weight:800;font-size:14.5px;cursor:pointer;font-family:inherit;')}
          >
            Add products while you wait
          </button>
          <button
            onClick={() => navigate('/seller/help')}
            style={css('flex:1;min-width:180px;height:50px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);border-radius:14px;font-weight:800;font-size:14.5px;cursor:pointer;font-family:inherit;')}
          >
            Contact support
          </button>
        </div>
      </div>
    </div>
  );
}
