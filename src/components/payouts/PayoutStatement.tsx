import { useState } from 'react';
import { css } from '@/lib/css';
import { fmtInr } from '@/lib/tokens';
import { PAYOUT_RATE, type StatementOrder } from '@/data/payouts';

/**
 * The order-by-order payout statement, shared by both consoles.
 *
 * The admin sees it in the payout drawer *before* transferring ("what am I
 * paying for"); the seller sees the same rows in Earnings *after* the credit
 * lands ("what was this ₹12,480 for, and where did the deduction go"). One
 * component because the answer must be identical on both sides — a seller
 * querying a figure and an admin checking it should be reading the same lines.
 *
 * Every row expands to the products in that order, because "order #MM-1043,
 * ₹2,610" is not an answer when the question is "you paid me for the wrong
 * kurta". Titles and prices come from `order_items`, which snapshots them at
 * purchase, so a later catalogue edit never rewrites a settled statement.
 *
 * COD lines are the ones that confuse sellers, so they are labelled rather than
 * left to be inferred from a minus sign: on those the seller already holds the
 * cash and the platform is only recovering its take, which makes the line
 * NEGATIVE against a payout that is otherwise money arriving.
 */

const RATE_PCT = Math.round(PAYOUT_RATE * 100);
const MUTED = 'var(--ag-muted)';

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—';

export function PayoutStatement({
  orders,
  loading,
  emptyLabel = 'No orders in this statement.',
}: {
  orders: StatementOrder[];
  loading?: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  if (loading) {
    return <div style={css(`padding:14px 2px;font-size:13px;color:${MUTED};`)}>Loading the order breakdown…</div>;
  }
  if (orders.length === 0) {
    return <div style={css(`padding:14px 2px;font-size:13px;color:${MUTED};`)}>{emptyLabel}</div>;
  }

  const goods = orders.reduce((s, o) => s + o.goods, 0);
  const commission = orders.reduce((s, o) => s + o.commission, 0);
  const codRecovery = orders.filter((o) => o.isCod).reduce((s, o) => s + o.shippingFee + o.codFee, 0);
  const coupons = orders.filter((o) => o.isCod).reduce((s, o) => s + o.platformDiscount, 0);
  const net = orders.reduce((s, o) => s + o.net, 0);

  return (
    <div style={css('display:flex;flex-direction:column;gap:10px;')}>
      {orders.map((o) => {
        const isOpen = open.has(o.id);
        return (
          <div
            key={o.id}
            style={css('background:var(--ag-surface);border:1px solid var(--ag-border-soft);border-radius:14px;overflow:hidden;')}
          >
            <button
              type="button"
              onClick={() => toggle(o.id)}
              aria-expanded={isOpen}
              style={css('display:flex;align-items:center;gap:10px;width:100%;padding:12px 14px;background:none;border:0;font-family:inherit;text-align:left;cursor:pointer;color:inherit;')}
            >
              <span
                aria-hidden="true"
                style={css(`font-family:'Material Symbols Outlined';font-size:19px;color:${MUTED};transition:transform .18s ease;transform:rotate(${isOpen ? 90 : 0}deg);`)}
              >
                chevron_right
              </span>
              <span style={css('flex:1;min-width:0;')}>
                <span style={css('display:block;font-size:13px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>
                  {o.orderNumber}
                  {o.isCod && (
                    <span style={css('margin-left:7px;font-size:10px;font-weight:800;letter-spacing:.04em;padding:2px 6px;border-radius:6px;background:var(--ag-warn-bg);color:var(--ag-warn-text);vertical-align:middle;')}>
                      COD
                    </span>
                  )}
                </span>
                <span style={css(`display:block;margin-top:2px;font-size:11.5px;font-weight:600;color:${MUTED};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`)}>
                  {o.buyerName} · delivered {shortDate(o.delivered_at)} · {o.items.length} item{o.items.length === 1 ? '' : 's'}
                </span>
              </span>
              <span style={css(`font-size:13.5px;font-weight:800;flex:none;color:${o.net < 0 ? 'var(--ag-bad-text)' : 'var(--ag-good-text)'};`)}>
                {o.net < 0 ? '−' : ''}{fmtInr(Math.abs(o.net))}
              </span>
            </button>

            {isOpen && (
              <div style={css('padding:0 14px 13px 43px;')}>
                {/* Products — what the buyer actually received. */}
                <div style={css('border-top:1px solid var(--ag-border-soft);padding-top:10px;')}>
                  {o.items.map((it) => (
                    <div key={it.id} style={css('display:flex;align-items:baseline;gap:10px;padding:4px 0;')}>
                      <span style={css('flex:1;min-width:0;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;')}>
                        {it.title}
                        {(it.size || it.color) && (
                          <span style={css(`color:${MUTED};font-weight:600;`)}>
                            {' '}· {[it.size, it.color].filter(Boolean).join(' / ')}
                          </span>
                        )}
                      </span>
                      <span style={css(`font-size:12px;font-weight:600;color:${MUTED};flex:none;`)}>
                        {it.qty} × {fmtInr(it.price)}
                      </span>
                      <span style={css('font-size:12.5px;font-weight:700;flex:none;min-width:64px;text-align:right;')}>
                        {fmtInr(it.price * it.qty)}
                      </span>
                    </div>
                  ))}
                  {o.items.length === 0 && (
                    <div style={css(`font-size:12px;color:${MUTED};padding:4px 0;`)}>Item details are not available for this order.</div>
                  )}
                </div>

                {/* How the order total became this line's contribution. */}
                <div style={css('border-top:1px solid var(--ag-border-soft);margin-top:9px;padding-top:9px;display:flex;flex-direction:column;gap:5px;')}>
                  <Line label="Order value" value={fmtInr(o.goods)} />
                  <Line label={`MangaiMart commission (${RATE_PCT}%)`} value={`− ${fmtInr(o.commission)}`} tone="bad" />
                  {o.isCod && (o.shippingFee > 0 || o.codFee > 0) && (
                    <Line
                      label="Delivery / COD fees you collected"
                      value={`− ${fmtInr(o.shippingFee + o.codFee)}`}
                      tone="bad"
                    />
                  )}
                  {o.isCod && o.platformDiscount > 0 && (
                    <Line label="MangaiMart coupon you honoured in cash" value={`+ ${fmtInr(o.platformDiscount)}`} tone="good" />
                  )}
                  {o.isCod && (
                    <div style={css(`font-size:11.5px;font-weight:600;color:${MUTED};line-height:1.5;padding-top:2px;`)}>
                      You collected {fmtInr(o.goods + o.shippingFee + o.codFee - o.platformDiscount)} in cash at the door, so this order
                      reduces the transfer instead of adding to it.
                    </div>
                  )}
                  <Line label="Contributes to payout" value={`${o.net < 0 ? '−' : ''}${fmtInr(Math.abs(o.net))}`} strong tone={o.net < 0 ? 'bad' : 'good'} />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* The same arithmetic, totalled — the figure that must match the bank. */}
      <div style={css('background:var(--ag-surface-2);border:1px solid var(--ag-border-soft);border-radius:14px;padding:13px 15px;display:flex;flex-direction:column;gap:6px;')}>
        <Line label={`Order value · ${orders.length} order${orders.length === 1 ? '' : 's'}`} value={fmtInr(goods)} />
        <Line label={`Commission (${RATE_PCT}%)`} value={`− ${fmtInr(commission)}`} tone="bad" />
        {codRecovery > 0 && <Line label="Delivery / COD fees on cash orders" value={`− ${fmtInr(codRecovery)}`} tone="bad" />}
        {coupons > 0 && <Line label="Platform coupons refunded to you" value={`+ ${fmtInr(coupons)}`} tone="good" />}
        <div style={css('border-top:1px solid var(--ag-border-soft);margin-top:3px;padding-top:8px;')}>
          <Line
            label={net < 0 ? 'You owe MangaiMart' : 'Total transferred'}
            value={`${net < 0 ? '−' : ''}${fmtInr(Math.abs(net))}`}
            strong
            tone={net < 0 ? 'bad' : 'good'}
          />
        </div>
      </div>
    </div>
  );
}

function Line({ label, value, tone, strong }: { label: string; value: string; tone?: 'good' | 'bad'; strong?: boolean }) {
  const colour = tone === 'good' ? 'var(--ag-good-text)' : tone === 'bad' ? 'var(--ag-bad-text)' : 'var(--ag-ink)';
  return (
    <div style={css('display:flex;align-items:baseline;justify-content:space-between;gap:14px;')}>
      <span style={css(`font-size:${strong ? '13' : '12.5'}px;font-weight:${strong ? 800 : 600};color:${strong ? 'var(--ag-ink)' : MUTED};`)}>{label}</span>
      <span style={css(`font-size:${strong ? '14' : '12.5'}px;font-weight:${strong ? 800 : 700};color:${colour};flex:none;`)}>{value}</span>
    </div>
  );
}
