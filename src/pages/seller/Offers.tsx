import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { TONES, fmt } from '@/data/demo';
import { useShop } from '@/state/ShopContext';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchProductsByBoutique, updateProduct } from '@/data/products';
import { ImageSlot } from '@/components/ui/ImageSlot';
import type { ProductWithBoutique } from '@/data/types';

/**
 * Offers & sales — the seller-side counterpart to the OFFERS badge and the
 * strike-through pricing a buyer already sees. An "offer" here is nothing new in
 * the schema: it is simply a product whose selling price sits below its MRP, so
 * setting one just adjusts the existing `price`/`mrp` columns and the buyer app
 * lights up on its own (strike-through card, OFFERS story badge, the Offers
 * browser). No coupon code, no campaign table — a visible markdown.
 *
 * Two ways in: a boutique-wide sale that marks every in-stock piece down by one
 * percentage, and a per-product control for a single piece. Ending an offer
 * restores the price to the MRP and leaves the MRP in place.
 */

const DISCOUNTS = [10, 20, 30, 40, 50] as const;

const pctOff = (p: ProductWithBoutique) =>
  p.mrp && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;

/** The price + mrp a given discount off the product's *original* price implies. */
function markdown(p: ProductWithBoutique, pct: number): { price: number; mrp: number } {
  // The original price is the MRP if one is set, else today's price becomes it.
  const original = Math.max(p.mrp ?? 0, p.price);
  return { mrp: original, price: Math.max(1, Math.round(original * (1 - pct / 100))) };
}

export function Offers() {
  const { showToast } = useShop();
  const { boutique } = useMyBoutique();
  const { data, loading, reload } = useAsync(
    () => (boutique ? fetchProductsByBoutique(boutique.id) : Promise.resolve([])),
    [boutique?.id],
  );
  const products = useMemo<ProductWithBoutique[]>(() => data ?? [], [data]);

  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saleBusy, setSaleBusy] = useState(false);
  const [salePct, setSalePct] = useState<number>(20);

  const onOffer = useMemo(() => products.filter((p) => pctOff(p) > 0), [products]);
  const avgOff = onOffer.length ? Math.round(onOffer.reduce((s, p) => s + pctOff(p), 0) / onOffer.length) : 0;

  const applyToProduct = async (p: ProductWithBoutique, pct: number) => {
    setBusyId(p.id);
    try {
      const patch = pct === 0 ? { price: Math.max(p.mrp ?? p.price, p.price), mrp: p.mrp ?? null } : markdown(p, pct);
      await updateProduct(p.id, patch);
      showToast(pct === 0 ? 'Offer ended' : `${pct}% off applied`);
      setOpenId(null);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not update offer');
    } finally {
      setBusyId(null);
    }
  };

  const runSale = async () => {
    // Mark down every in-stock piece by the chosen percentage in one pass.
    const targets = products.filter((p) => p.stock > 0);
    if (targets.length === 0) {
      showToast('No in-stock products to put on sale');
      return;
    }
    setSaleBusy(true);
    try {
      await Promise.all(targets.map((p) => updateProduct(p.id, markdown(p, salePct))));
      showToast(`${salePct}% off applied to ${targets.length} piece${targets.length === 1 ? '' : 's'}`);
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start the sale');
    } finally {
      setSaleBusy(false);
    }
  };

  const endAll = async () => {
    setSaleBusy(true);
    try {
      await Promise.all(onOffer.map((p) => updateProduct(p.id, { price: Math.max(p.mrp ?? p.price, p.price) })));
      showToast('All offers ended');
      reload();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not end offers');
    } finally {
      setSaleBusy(false);
    }
  };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('padding:6px 20px 4px;')}>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;")}>Offers &amp; sales</div>
        <div style={css('font-size:12.5px;color:var(--ag-muted);font-weight:600;margin-top:2px;')}>
          Mark pieces down from MRP — buyers see the saving and the OFFERS badge.
        </div>
      </div>

      {/* Summary ---------------------------------------------------------- */}
      <div style={css('margin:12px 20px 0;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:16px 18px;display:flex;gap:12px;flex-wrap:wrap;box-shadow:0 18px 40px -30px rgba(107,20,54,.55);')}>
        <div style={css('flex:1;min-width:90px;')}>
          <div style={css('font-size:11.5px;color:#A98D99;font-weight:700;')}>On offer</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:23px;color:var(--ag-crimson);margin-top:3px;")}>{onOffer.length}<span style={css('font-size:13px;color:#A98D99;')}> / {products.length}</span></div>
        </div>
        <div style={css('flex:1;min-width:90px;')}>
          <div style={css('font-size:11.5px;color:#A98D99;font-weight:700;')}>Average discount</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:23px;margin-top:3px;color:var(--ag-good);")}>{avgOff ? `${avgOff}%` : '—'}</div>
        </div>
      </div>

      {/* Boutique-wide sale ----------------------------------------------- */}
      <div style={css('margin:14px 20px 0;background:linear-gradient(135deg,#8E1C44,#B02454 60%,#D6336C);border-radius:20px;padding:16px 18px;color:#fff;')}>
        <div style={css('display:flex;align-items:center;gap:8px;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>sell</span>
          <span style={css('font-weight:800;font-size:15px;')}>Run a boutique-wide sale</span>
        </div>
        <div style={css('font-size:12px;opacity:.9;margin-top:5px;line-height:1.5;')}>
          Mark every in-stock piece down by one percentage. Each price drops from its MRP.
        </div>
        <div style={css('display:flex;gap:7px;flex-wrap:wrap;margin-top:12px;')}>
          {DISCOUNTS.map((d) => {
            const on = d === salePct;
            return (
              <button
                key={d}
                onClick={() => setSalePct(d)}
                style={css(`height:34px;padding:0 15px;border-radius:999px;border:1.5px solid rgba(255,255,255,.5);background:${on ? '#fff' : 'rgba(255,255,255,.14)'};color:${on ? '#B02454' : '#fff'};font-weight:800;font-size:13px;cursor:pointer;`)}
              >
                {d}% off
              </button>
            );
          })}
        </div>
        <div style={css('display:flex;gap:9px;margin-top:12px;flex-wrap:wrap;')}>
          <button
            onClick={runSale}
            disabled={saleBusy}
            style={css(`flex:1;min-width:150px;height:44px;border:none;border-radius:13px;background:#fff;color:#B02454;font-weight:800;font-size:14px;cursor:${saleBusy ? 'wait' : 'pointer'};opacity:${saleBusy ? '.7' : '1'};`)}
          >
            {saleBusy ? 'Working…' : `Put everything ${salePct}% off`}
          </button>
          {onOffer.length > 0 && (
            <button
              onClick={endAll}
              disabled={saleBusy}
              style={css('height:44px;padding:0 16px;border:1.5px solid rgba(255,255,255,.5);background:transparent;color:#fff;border-radius:13px;font-weight:800;font-size:13px;cursor:pointer;')}
            >
              End all offers
            </button>
          )}
        </div>
      </div>

      {/* Per-product ------------------------------------------------------ */}
      <div style={css('padding:16px 20px 6px;')}>
        <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Per product</div>
      </div>
      <div style={css('display:flex;flex-direction:column;gap:10px;padding:0 20px;')}>
        {loading && products.length === 0 && <div style={css('color:var(--ag-muted);font-size:14px;padding:8px 2px;')}>Loading products…</div>}
        {!loading && products.length === 0 && (
          <div style={css('color:var(--ag-muted);font-size:14px;padding:8px 2px;')}>No products yet — list a piece before putting it on offer.</div>
        )}

        {products.map((p) => {
          const off = pctOff(p);
          const editing = openId === p.id;
          const busy = busyId === p.id;
          return (
            <div key={p.id} style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:16px;padding:11px;box-shadow:0 10px 26px -22px rgba(107,20,54,.6);')}>
              <div style={css('display:flex;gap:11px;align-items:center;')}>
                <div style={css(`width:52px;height:52px;flex:none;border-radius:13px;background:${TONES[p.tone % TONES.length]};position:relative;overflow:hidden;`)}>
                  <ImageSlot src={p.image_url ?? undefined} placeholder={p.title} style={css('position:absolute;inset:0;')} />
                </div>
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('font-weight:800;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{p.title}</div>
                  <div style={css('display:flex;align-items:center;gap:7px;margin-top:3px;')}>
                    <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:15px;color:var(--ag-crimson);")}>{fmt(Number(p.price))}</span>
                    {off > 0 && p.mrp && <span style={css('font-size:12px;color:var(--ag-muted);text-decoration:line-through;')}>{fmt(Number(p.mrp))}</span>}
                  </div>
                </div>
                {off > 0 ? (
                  <span style={css('flex:none;font-size:11px;font-weight:800;padding:4px 9px;border-radius:8px;background:var(--ag-bad-bg);color:var(--ag-bad-text);')}>{off}% OFF</span>
                ) : (
                  <span style={css('flex:none;font-size:11px;font-weight:700;padding:4px 9px;border-radius:8px;background:var(--ag-surface-2);color:var(--ag-muted);')}>Full price</span>
                )}
              </div>

              {editing ? (
                <div style={css('margin-top:11px;padding-top:11px;border-top:1px solid var(--ag-border-soft);')}>
                  <div style={css('font-size:11.5px;color:#A98D99;font-weight:700;margin-bottom:8px;')}>Discount off {fmt(Math.max(p.mrp ?? 0, p.price))}</div>
                  <div style={css('display:flex;gap:7px;flex-wrap:wrap;')}>
                    {DISCOUNTS.map((d) => (
                      <button
                        key={d}
                        onClick={() => applyToProduct(p, d)}
                        disabled={busy}
                        style={css(`height:36px;padding:0 14px;border-radius:999px;border:1.5px solid ${off === d ? '#D6336C' : 'var(--ag-border)'};background:${off === d ? 'linear-gradient(135deg,#D6336C,#B02454)' : 'var(--ag-surface)'};color:${off === d ? '#fff' : 'var(--ag-ink-2)'};font-weight:800;font-size:12.5px;cursor:${busy ? 'wait' : 'pointer'};`)}
                      >
                        {d}%
                      </button>
                    ))}
                    {off > 0 && (
                      <button onClick={() => applyToProduct(p, 0)} disabled={busy} style={css('height:36px;padding:0 14px;border-radius:999px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:#D6455A;font-weight:800;font-size:12.5px;cursor:pointer;')}>End offer</button>
                    )}
                    <button onClick={() => setOpenId(null)} disabled={busy} style={css('height:36px;padding:0 14px;border-radius:999px;border:none;background:none;color:var(--ag-muted);font-weight:800;font-size:12.5px;cursor:pointer;')}>Close</button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setOpenId(p.id)}
                  style={css(`margin-top:10px;height:38px;width:100%;border:1.5px solid ${off > 0 ? 'var(--ag-border)' : '#D6336C'};background:var(--ag-surface);color:var(--ag-crimson);border-radius:11px;font-weight:800;font-size:12.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;`)}
                >
                  <span style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>local_offer</span>
                  {off > 0 ? 'Change offer' : 'Set an offer'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
