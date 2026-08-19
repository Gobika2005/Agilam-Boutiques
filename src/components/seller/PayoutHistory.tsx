import { useState } from 'react';
import { css } from '@/lib/css';
import { fmt } from '@/data/demo';
import { useAsync } from '@/hooks/useAsync';
import { fetchBoutiquePayouts, fetchPayoutStatement, type PayoutRecord, type StatementOrder } from '@/data/payouts';
import { PayoutStatement } from '@/components/payouts/PayoutStatement';

/**
 * The seller's own payout statements.
 *
 * Earnings above this answers "how much did I make". This answers the question
 * sellers actually ask when a bank credit lands: "what is this ₹12,480 FOR, and
 * why is it not what I expected?" — so every payout opens into the orders it
 * covered, and every order opens into the items in it.
 *
 * Statements load one at a time, on expand. A seller with two years of payouts
 * would otherwise pull every order they have ever sold to render a list of
 * dates, and this screen is on a phone.
 */
export function PayoutHistory({ boutiqueId, slaHours }: { boutiqueId: string | undefined; slaHours: number }) {
  const { data: payouts, loading } = useAsync(
    () => (boutiqueId ? fetchBoutiquePayouts(boutiqueId) : Promise.resolve([] as PayoutRecord[])),
    [boutiqueId],
  );

  const [openId, setOpenId] = useState<string | null>(null);
  const [statements, setStatements] = useState<Record<string, StatementOrder[]>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggle = (id: string) => {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (statements[id]) return;
    setBusyId(id);
    fetchPayoutStatement(id)
      .then((rows) => setStatements((m) => ({ ...m, [id]: rows })))
      .catch(() => setStatements((m) => ({ ...m, [id]: [] })))
      .finally(() => setBusyId(null));
  };

  const list = payouts ?? [];
  const paidTotal = list.filter((p) => p.status === 'paid' && p.amount > 0).reduce((s, p) => s + Number(p.amount), 0);

  return (
    <>
      <div style={css("padding:22px 0 10px;font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Your payouts</div>

      {/* The rule, in the seller's own words. Two facts decide when they get
          paid, and neither is visible from a list of amounts. */}
      <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:16px 18px;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}>
        <div style={css('display:flex;align-items:center;gap:9px;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-good);font-size:20px;")}>local_shipping</span>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:17px;")}>How you get paid</div>
        </div>
        <div style={css('font-size:12.5px;color:var(--ag-muted);font-weight:600;line-height:1.65;margin-top:9px;')}>
          A payout is released <strong style={css('color:var(--ag-ink);')}>only after the order is delivered</strong> — while a parcel is
          on its way, that money is held. Once delivery is recorded, MangaiMart transfers your share to your bank account
          <strong style={css('color:var(--ag-ink);')}> within {slaHours} hours</strong>.
          <br /><br />
          {/* The single most common payout query, answered before it is asked. */}
          Cash-on-delivery orders work the other way round: you already hold that money, so MangaiMart's commission and the
          delivery fees you collected are subtracted from your next transfer instead of being billed to you.
        </div>
      </div>

      {loading && (
        <div style={css('margin-top:12px;font-size:13px;color:var(--ag-muted);font-weight:600;')}>Loading your payouts…</div>
      )}

      {!loading && list.length === 0 && (
        <div style={css('margin-top:12px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:18px;text-align:center;')}>
          <div style={css('font-size:13.5px;font-weight:700;')}>No payouts yet</div>
          <div style={css('font-size:12.5px;color:var(--ag-muted);font-weight:600;margin-top:5px;line-height:1.6;')}>
            Your first transfer is released once one of your orders is delivered. Every payout will appear here with the orders and
            items it covered.
          </div>
        </div>
      )}

      {!loading && list.length > 0 && (
        <>
          <div style={css('margin-top:12px;font-size:12.5px;color:var(--ag-muted);font-weight:700;')}>
            {fmt(paidTotal)} paid to you across {list.length} payout{list.length === 1 ? '' : 's'}
          </div>
          <div style={css('margin-top:9px;display:flex;flex-direction:column;gap:10px;')}>
            {list.map((p) => {
              const isOpen = openId === p.id;
              const owed = Number(p.amount) < 0;
              const state =
                p.status === 'processing' ? { label: 'Processing', colour: 'var(--ag-gold-text)', bg: 'var(--ag-gold-bg)' }
                : p.status === 'failed' ? { label: 'Failed', colour: 'var(--ag-bad-text)', bg: 'var(--ag-bad-bg)' }
                : p.status === 'reversed' ? { label: 'Reversed', colour: 'var(--ag-bad-text)', bg: 'var(--ag-bad-bg)' }
                : owed ? { label: 'Adjusted', colour: 'var(--ag-gold-text)', bg: 'var(--ag-gold-bg)' }
                : { label: 'Paid', colour: 'var(--ag-good)', bg: 'var(--ag-good-bg)' };

              return (
                <div key={p.id} style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;overflow:hidden;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}>
                  <button
                    type="button"
                    onClick={() => toggle(p.id)}
                    aria-expanded={isOpen}
                    style={css('display:flex;align-items:center;gap:11px;width:100%;padding:15px 16px;background:none;border:0;font-family:inherit;text-align:left;cursor:pointer;color:inherit;')}
                  >
                    <span style={css('flex:1;min-width:0;')}>
                      <span style={css("display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:21px;line-height:1.1;")}>
                        {owed ? '– ' : ''}{fmt(Math.abs(Number(p.amount)))}
                      </span>
                      <span style={css('display:block;margin-top:4px;font-size:11.5px;color:var(--ag-muted);font-weight:700;')}>
                        {new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {' · '}{p.orders_count} delivered order{p.orders_count === 1 ? '' : 's'}
                        {p.utr ? ` · ref ${p.utr}` : ''}
                      </span>
                    </span>
                    <span style={css(`flex:none;font-size:10.5px;font-weight:800;letter-spacing:.03em;padding:4px 9px;border-radius:8px;background:${state.bg};color:${state.colour};`)}>
                      {state.label}
                    </span>
                    <span
                      aria-hidden="true"
                      style={css(`font-family:'Material Symbols Outlined';font-size:20px;color:var(--ag-muted);transition:transform .18s ease;transform:rotate(${isOpen ? 90 : 0}deg);`)}
                    >
                      chevron_right
                    </span>
                  </button>

                  {isOpen && (
                    <div style={css('padding:0 14px 14px;')}>
                      {p.status === 'failed' && p.failure_reason && (
                        <div style={css('margin-bottom:10px;font-size:12.5px;font-weight:700;color:var(--ag-bad-text);line-height:1.55;')}>
                          This transfer did not go through: {p.failure_reason}. The orders below are back in your next payout — nothing
                          is lost.
                        </div>
                      )}
                      <PayoutStatement
                        orders={statements[p.id] ?? []}
                        loading={busyId === p.id}
                        emptyLabel="The order breakdown for this payout is not available."
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
