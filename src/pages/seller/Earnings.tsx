import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { fmt } from '@/data/demo';
import { useSettings } from '@/data/settings';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchOrdersForBoutique } from '@/data/orders';
import { fetchBoutiquePrivate } from '@/data/boutiques';
import type { OrderWithDetails } from '@/data/types';

/**
 * Seller earnings, computed from the boutique's own orders.
 *
 * Three money streams are kept apart, because conflating them would misstate
 * what MangaiMart actually owes the seller — or what the seller owes MangaiMart:
 *
 *   • Prepaid online orders are collected by MangaiMart, so commission comes off
 *     the top and the remainder is settled to the seller's payout account.
 *   • Cash on delivery is collected by the SELLER at the door. MangaiMart never
 *     touches that money, so its commission on those orders becomes a debt the
 *     seller carries, netted off their next online payout rather than invoiced.
 *   • Offline / walk-in bills (the POS flow) are the seller's own trade — no
 *     payout is due and no commission is charged.
 *
 * Rejected and cancelled orders are excluded throughout: they are not money
 * anyone earned. So is any COD order whose cash has not been collected yet —
 * a promise of payment is not revenue.
 */

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const startOfMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

const startOfPrevMonth = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
};

/** Total of the last 7 calendar days, oldest first, for the bar chart. */
function lastSevenDays(orders: OrderWithDetails[]): { label: string; total: number }[] {
  const buckets: { label: string; total: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    const next = day.getTime() + 24 * 60 * 60 * 1000;
    const total = orders
      .filter((o) => {
        const t = new Date(o.created_at).getTime();
        return t >= day.getTime() && t < next;
      })
      .reduce((s, o) => s + Number(o.total), 0);
    buckets.push({ label: DAY_LABELS[day.getDay()], total });
  }
  return buckets;
}

const maskAccount = (n: string | null) => (n && n.length > 4 ? `•••• ${n.slice(-4)}` : n ?? '');

export function Earnings() {
  // The platform commission is admin-editable, so the seller's take-home is
  // derived from the live rate rather than a compile-time constant.
  const { commission_pct: commissionPct } = useSettings();
  const COMMISSION = commissionPct / 100;
  const navigate = useNavigate();
  const { boutique } = useMyBoutique();
  const { data: orderRows, loading } = useAsync(
    () => (boutique ? fetchOrdersForBoutique(boutique.id) : Promise.resolve([])),
    [boutique?.id],
  );
  // Payouts are made to a bank account only. A seller who onboarded under the
  // old "UPI or bank" rule may still have a UPI id on file — we keep it (admin
  // can still pay them with it) but never present it as a valid destination
  // here, because what they need to do is add a bank account.
  const [payout, setPayout] = useState<{ account: string | null; ifsc: string | null } | null>(null);
  const boutiqueId = boutique?.id;

  useEffect(() => {
    if (!boutiqueId) return;
    let cancelled = false;
    fetchBoutiquePrivate(boutiqueId)
      .then((p) => {
        if (cancelled || !p) return;
        setPayout({ account: maskAccount(p.bank_account_number), ifsc: p.bank_ifsc });
      })
      .catch(() => { /* payout destination is supporting detail, never blocking */ });
    return () => { cancelled = true; };
  }, [boutiqueId]);

  const live = (orderRows ?? []).filter((o) => o.status !== 'rejected' && o.status !== 'cancelled');
  const monthStart = startOfMonth();
  const prevStart = startOfPrevMonth();
  const at = (o: OrderWithDetails) => new Date(o.created_at).getTime();
  const isCod = (o: OrderWithDetails) => o.payment_method === 'COD';
  const collected = (o: OrderWithDetails) => (o.payment_status ?? 'paid') === 'paid';

  const thisMonth = live.filter((o) => at(o) >= monthStart);
  const lastMonth = live.filter((o) => at(o) >= prevStart && at(o) < monthStart);

  const online = thisMonth.filter((o) => (o.channel ?? 'online') === 'online');
  const offline = thisMonth.filter((o) => o.channel === 'offline');
  const prepaid = online.filter((o) => !isCod(o));
  const cod = online.filter(isCod);

  // MangaiMart holds this money and settles it to the seller, less commission.
  const prepaidGross = prepaid.reduce((s, o) => s + Number(o.total), 0);
  const prepaidCommission = Math.round(prepaidGross * COMMISSION);
  const prepaidNet = prepaidGross - prepaidCommission;

  // The seller holds this money. Only counted once they confirm the cash
  // arrived — an uncollected COD order is a promise, not revenue.
  const codCollected = cod.filter(collected);
  // A MangaiMart-funded coupon comes off the cash at the door but never off
  // `total` — the seller is still settled on the full goods value, so it is
  // netted out of the cash they hold and credited back below (migration 0053).
  const cashAtDoor = (o: OrderWithDetails) =>
    Number(o.total) + Number(o.cod_fee ?? 0) - Number(o.platform_discount ?? 0);
  const codCash = codCollected.reduce((s, o) => s + cashAtDoor(o), 0);
  // Commission is charged on the goods value, not on MangaiMart's own handling fee.
  const codCommissionOwed = Math.round(codCollected.reduce((s, o) => s + Number(o.total), 0) * COMMISSION);
  // The coupon money the seller honoured out of their own goods — MangaiMart
  // funds it, so it comes back on the next payout rather than being lost.
  const codPlatformCredit = codCollected.reduce((s, o) => s + Number(o.platform_discount ?? 0), 0);
  const codOutstanding = cod.filter((o) => !collected(o)).reduce((s, o) => s + cashAtDoor(o), 0);

  const offlineCollected = offline.reduce((s, o) => s + Number(o.total), 0);

  // What the seller actually takes home this month: their share of the prepaid
  // orders, plus the cash they already hold and the coupon money MangaiMart
  // reimburses them for, minus what they owe on that cash.
  const netEarnings = prepaidNet + codCash + codPlatformCredit - codCommissionOwed;

  // Settled once the buyer has the goods; anything still in flight is money
  // MangaiMart is holding, which is what the seller wants to see as "pending".
  const settledGross = prepaid.filter((o) => o.status === 'delivered').reduce((s, o) => s + Number(o.total), 0);
  const pendingPayout = Math.round((prepaidGross - settledGross) * (1 - COMMISSION));
  // The COD debt comes out of the payout MangaiMart is about to make, which is why
  // it is netted here rather than billed separately.
  const settledPayout = prepaidNet - pendingPayout - codCommissionOwed + codPlatformCredit;

  const lastMonthNet = lastMonth
    .filter((o) => (o.channel ?? 'online') === 'online' && (!isCod(o) || collected(o)))
    .reduce((s, o) => s + Number(o.total), 0) * (1 - COMMISSION);
  const deltaPct = lastMonthNet > 0 ? Math.round(((netEarnings - lastMonthNet) / lastMonthNet) * 100) : null;

  const bars = lastSevenDays(live);
  const peak = Math.max(...bars.map((b) => b.total), 1);

  const TILES = [
    { label: 'Orders this month', value: String(thisMonth.length), color: 'var(--ag-ink)' },
    { label: 'Pending payout', value: fmt(pendingPayout), color: 'var(--ag-gold-text)' },
    { label: 'Settled to you', value: fmt(Math.max(0, settledPayout)), color: 'var(--ag-good)' },
    { label: `Commission (${commissionPct}%)`, value: fmt(prepaidCommission + codCommissionOwed), color: 'var(--ag-muted)' },
  ];

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('padding:6px 0 12px;display:flex;align-items:center;gap:10px;')}>
        <button
          onClick={() => navigate('/seller/profile')}
          aria-label="Go back" style={css('width:42px;height:42px;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
        >
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
        </button>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;")}>Earnings</h1>
      </div>

      {/* Hero — net earnings after commission ------------------------------ */}
      <div style={css('border-radius:22px;background:linear-gradient(135deg,#8E1C44 0%,#B02454 52%,#D6336C 100%);color:#fff;padding:22px;position:relative;overflow:hidden;box-shadow:0 20px 44px -26px rgba(176,36,84,.9);')}>
        <div style={css('position:absolute;top:-80px;right:-40px;width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(244,217,166,.22),transparent 70%);pointer-events:none;')} />
        <div style={css('position:relative;')}>
          <div style={css('font-size:13px;opacity:.85;')}>
            Your earnings · {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
          </div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(34px,5vw,44px);line-height:1;margin-top:6px;")}>
            {loading ? '—' : fmt(netEarnings)}
          </div>
          <div style={css('font-size:12.5px;opacity:.82;margin-top:6px;')}>
            {fmt(prepaidGross)} prepaid{codCash > 0 ? ` + ${fmt(codCash)} collected in cash` : ''}, less {commissionPct}% MangaiMart commission
          </div>
          {deltaPct != null && (
            <div style={css('display:flex;gap:6px;align-items:center;margin-top:10px;font-size:13px;font-weight:700;')}>
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>{deltaPct >= 0 ? 'trending_up' : 'trending_down'}</span>
              {deltaPct >= 0 ? '+' : ''}{deltaPct}% vs last month
            </div>
          )}
        </div>
      </div>

      <div className="agx-sd-quick" style={css('margin-top:14px;')}>
        {TILES.map((t) => (
          <div key={t.label} style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:14px;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}>
            <div style={css('font-size:11.5px;color:var(--ag-muted);font-weight:700;')}>{t.label}</div>
            <div style={css(`font-family:'Playfair Display',serif;font-weight:700;font-size:24px;line-height:1.1;margin-top:5px;color:${t.color};word-break:break-word;`)}>{t.value}</div>
          </div>
        ))}
      </div>

      {/* Cash on delivery — the seller holds the money, so MangaiMart's cut on it
          is a debt rather than a deduction. Stated plainly, with the figure. */}
      {(codCommissionOwed > 0 || codOutstanding > 0) && (
        <div style={css('margin-top:14px;background:var(--ag-gold-bg);border:1px solid var(--ag-gold-border);border-radius:20px;padding:16px 18px;')}>
          <div style={css('display:flex;align-items:center;gap:9px;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-gold-text);font-size:20px;")}>payments</span>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:18px;color:var(--ag-gold-text);")}>Cash on delivery</div>
          </div>

          <div style={css('display:flex;gap:14px;flex-wrap:wrap;margin-top:13px;')}>
            <div style={css('flex:1;min-width:130px;')}>
              <div style={css('font-size:11.5px;color:var(--ag-gold-text);font-weight:700;')}>Cash you collected</div>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:23px;line-height:1.1;margin-top:4px;color:var(--ag-gold-text);")}>{fmt(codCash)}</div>
            </div>
            <div style={css('flex:1;min-width:130px;')}>
              <div style={css('font-size:11.5px;color:var(--ag-gold-text);font-weight:700;')}>Commission owed on it</div>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:23px;line-height:1.1;margin-top:4px;color:var(--ag-bad-text);")}>– {fmt(codCommissionOwed)}</div>
            </div>
            <div style={css('flex:1;min-width:130px;')}>
              <div style={css('font-size:11.5px;color:var(--ag-gold-text);font-weight:700;')}>Still to collect</div>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:23px;line-height:1.1;margin-top:4px;color:var(--ag-gold-text);")}>{fmt(codOutstanding)}</div>
            </div>
          </div>

          <div style={css('font-size:12.5px;color:var(--ag-gold-text);font-weight:600;line-height:1.6;margin-top:12px;')}>
            You keep the cash your customers hand over. MangaiMart’s {commissionPct}% on those orders is deducted from your next online payout — nothing is debited from your account, and there is no invoice to pay.
            {codOutstanding > 0 && ' Cash you have not collected yet is not counted as earnings.'}
          </div>

          {codOutstanding > 0 && (
            <button
              onClick={() => navigate('/seller/orders')}
              style={css('margin-top:12px;height:44px;padding:0 18px;border:none;border-radius:12px;background:var(--ag-gold-text);color:#fff;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;')}
            >
              See orders to collect
            </button>
          )}
        </div>
      )}

      {/* Offline takings — collected by the seller, not settled by MangaiMart --- */}
      {offline.length > 0 && (
        <div style={css('margin-top:14px;background:var(--ag-good-bg);border:1px solid #CFE6D9;border-radius:18px;padding:14px 16px;display:flex;align-items:center;gap:11px;flex-wrap:wrap;')}>
          <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-good);")}>storefront</span>
          <span style={css('flex:1;min-width:200px;font-size:13px;font-weight:600;color:#2C6249;line-height:1.5;')}>
            You also collected <strong>{fmt(offlineCollected)}</strong> from {offline.length} walk-in bill{offline.length > 1 ? 's' : ''} this month. MangaiMart charges no commission on offline sales, so this is yours in full and is not part of the payout above.
          </span>
        </div>
      )}

      {/* Last 7 days -------------------------------------------------------- */}
      <div style={css("padding:22px 0 10px;font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Last 7 days</div>
      <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:18px 16px;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}>
        {peak === 1 && !loading ? (
          <div style={css('padding:14px 4px;text-align:center;color:var(--ag-muted);font-size:13.5px;font-weight:600;')}>
            No sales in the last 7 days yet.
          </div>
        ) : (
          <div style={css('display:flex;align-items:flex-end;gap:10px;height:150px;')}>
            {bars.map((b, i) => (
              <div key={i} title={fmt(b.total)} style={css('flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;justify-content:flex-end;height:100%;')}>
                <span style={css('font-size:10px;color:var(--ag-muted-soft);font-weight:800;')}>{b.total > 0 ? fmt(b.total) : ''}</span>
                <div style={css(`width:100%;border-radius:7px 7px 3px 3px;background:linear-gradient(180deg,#E7719F,#D6336C);height:${Math.max(3, Math.round((b.total / peak) * 100))}%;`)} />
                <span style={css('font-size:10.5px;color:var(--ag-muted-soft);font-weight:700;')}>{b.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Payout destination -------------------------------------------------- */}
      <div style={css("padding:22px 0 10px;font-family:'Playfair Display',serif;font-weight:700;font-size:20px;")}>Payout account</div>
      <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:16px 18px;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}>
        {payout?.account ? (
          <div style={css('display:flex;flex-direction:column;gap:9px;')}>
            {payout.account && (
              <div style={css('display:flex;gap:12px;align-items:baseline;')}>
                <span style={css('flex:none;width:110px;font-size:12px;font-weight:700;color:var(--ag-muted);')}>Bank account</span>
                <span style={css('font-size:13.5px;font-weight:700;color:var(--ag-ink);')}>{payout.account}{payout.ifsc ? ` · ${payout.ifsc}` : ''}</span>
              </div>
            )}
            <button
              onClick={() => navigate('/seller/onboarding')}
              style={css('align-self:flex-start;margin-top:4px;border:none;background:none;color:var(--ag-crimson);font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;gap:4px;font-family:inherit;')}
            >
              <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>edit</span>Change payout details
            </button>
          </div>
        ) : (
          <div style={css('display:flex;align-items:center;gap:11px;flex-wrap:wrap;')}>
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';color:var(--ag-gold-text);")}>account_balance</span>
            <span style={css('flex:1;min-width:180px;font-size:13px;font-weight:600;color:var(--ag-gold-text);line-height:1.5;')}>
              No bank account on file — MangaiMart settles earnings by bank transfer only, so we cannot pay you until you add one.
            </span>
            <button
              onClick={() => navigate('/seller/onboarding')}
              style={css('height:40px;padding:0 16px;border:none;border-radius:12px;background:#B02454;color:#fff;font-weight:800;font-size:12.5px;cursor:pointer;font-family:inherit;')}
            >
              Add bank details
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
