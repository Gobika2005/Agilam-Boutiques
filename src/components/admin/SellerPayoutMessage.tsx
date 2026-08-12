import { useState } from 'react';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { sendPayoutAdvice, payoutWhatsAppText, type PayoutRecord, type PayoutDestination } from '@/data/payouts';
import { T, Card, GhostButton } from '@/components/admin/kit';

/**
 * "The money has gone — now tell the seller."
 *
 * Shown immediately after a settlement, because that is the only moment the
 * admin has the reference in their hand and the seller is waiting. Before this,
 * a hand-settled seller found out from their bank statement: 0044's notification
 * trigger fired on an UPDATE of `payouts.status`, and a manual settlement
 * INSERTs a row that is already 'paid', so it never ran. Migration 0078 fixes
 * the trigger, which is why the in-app line below is stated as already done
 * rather than offered as a button.
 *
 * The three channels are deliberately not equal:
 *   • In-app  — automatic, by database trigger. Cannot fail silently or be
 *               forgotten, and does not depend on a deploy.
 *   • Email   — one tap, via the `payout-advice` Edge Function. Optional
 *               because it needs RESEND_API_KEY set on the Supabase project;
 *               a failure here is reported and changes nothing about the money.
 *   • WhatsApp— a wa.me link the admin sends themselves. The Cloud API
 *               automation (migration 0061) is planned, not built, so pretending
 *               this is automatic would be a lie the seller would notice.
 */
export function SellerPayoutMessage({
  payout,
  boutiqueName,
  dest,
  onDone,
}: {
  payout: PayoutRecord;
  boutiqueName: string;
  dest: PayoutDestination | null;
  onDone: () => void;
}) {
  const [emailState, setEmailState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');
  const [emailError, setEmailError] = useState<string | null>(null);

  const text = payoutWhatsAppText({
    boutiqueName,
    amount: payout.amount,
    orders: payout.orders_count,
    commission: payout.commission,
    reference: payout.utr ?? payout.note,
  });

  // wa.me wants a bare international number. Indian sellers store theirs in
  // every format under the sun, so strip to digits and add 91 when it is a
  // plain 10-digit mobile.
  const raw = (dest?.whatsapp ?? dest?.phone ?? '').replace(/\D/g, '');
  const waNumber = raw.length === 10 ? `91${raw}` : raw;
  const waHref = waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(text)}` : null;

  const doEmail = async () => {
    setEmailState('sending');
    const res = await sendPayoutAdvice(payout.id);
    if (res.ok) {
      setEmailState('sent');
      setEmailError(null);
    } else {
      setEmailState('failed');
      setEmailError(res.error ?? 'Could not send');
    }
  };

  return (
    <div style={css('display:flex;flex-direction:column;gap:14px;')}>
      <Card style="padding:16px 18px;background:var(--ag-good-bg);">
        <div style={css('font-size:13.5px;font-weight:800;color:var(--ag-good-text);')}>
          {payout.amount < 0 ? 'Settlement recorded' : `${fmtInr(payout.amount)} recorded as paid`}
        </div>
        <div style={css('margin-top:5px;font-size:12.5px;font-weight:600;color:var(--ag-good-text);line-height:1.55;')}>
          {boutiqueName} · {payout.orders_count} delivered order{payout.orders_count === 1 ? '' : 's'}
          {payout.utr ? ` · ref ${payout.utr}` : payout.note ? ` · ref ${payout.note}` : ''}
        </div>
      </Card>

      <Channel
        icon="notifications_active"
        title="In-app notification"
        state="done"
        detail="Sent automatically with the amount, the order count and the commission deducted. The seller sees it the moment they open the app."
      />

      <Channel
        icon="mail"
        title="Payout advice email"
        state={emailState === 'sent' ? 'done' : emailState === 'failed' ? 'failed' : 'idle'}
        detail={
          emailState === 'sent' ? `Sent to ${dest?.email ?? 'the boutique'} with the full order-by-order statement.`
          : emailState === 'failed' ? (emailError ?? 'Could not send.')
          : dest?.email ? `Sends the itemised statement to ${dest.email}.`
          : 'This boutique has no email address on file.'
        }
        action={
          emailState !== 'sent' && dest?.email ? (
            <GhostButton icon="send" onClick={doEmail} disabled={emailState === 'sending'}>
              {emailState === 'sending' ? 'Sending…' : emailState === 'failed' ? 'Retry' : 'Send email'}
            </GhostButton>
          ) : undefined
        }
      />

      <Channel
        icon="chat"
        title="WhatsApp"
        state="idle"
        detail={
          waHref
            ? 'Opens WhatsApp with the message written. Automated WhatsApp is not live yet, so this one is sent by you.'
            : 'No phone or WhatsApp number on file for this boutique.'
        }
        action={
          waHref ? (
            <GhostButton icon="open_in_new" onClick={() => window.open(waHref, '_blank', 'noopener')}>
              Open WhatsApp
            </GhostButton>
          ) : undefined
        }
      />

      <div style={css(`font-size:11.5px;font-weight:600;color:${T.muted};line-height:1.55;`)}>
        None of these move money. The transfer is already recorded and these orders will not be paid again.
      </div>

      <div>
        <GhostButton tone="primary" icon="check" onClick={onDone}>Done</GhostButton>
      </div>
    </div>
  );
}

function Channel({ icon, title, detail, state, action }: {
  icon: string; title: string; detail: string; state: 'idle' | 'done' | 'failed'; action?: React.ReactNode;
}) {
  const tint = state === 'done' ? 'var(--ag-good-text)' : state === 'failed' ? 'var(--ag-bad-text)' : T.muted;
  return (
    <div style={css(`display:flex;align-items:flex-start;gap:12px;background:var(--ag-surface);border:1px solid ${T.border};border-radius:14px;padding:13px 15px;`)}>
      <span className="material-symbols-rounded" aria-hidden="true" style={css(`font-size:20px;color:${tint};flex:none;`)}>
        {state === 'done' ? 'check_circle' : icon}
      </span>
      <div style={css('flex:1;min-width:0;')}>
        <div style={css('font-size:13px;font-weight:800;')}>{title}</div>
        <div style={css(`margin-top:3px;font-size:12px;font-weight:600;color:${tint};line-height:1.55;`)}>{detail}</div>
        {action && <div style={css('margin-top:9px;')}>{action}</div>}
      </div>
    </div>
  );
}
