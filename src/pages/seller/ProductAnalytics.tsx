import { useNavigate, useParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { TONES, fmt } from '@/data/demo';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchProduct } from '@/data/products';
import { fetchOrdersForBoutique } from '@/data/orders';

/**
 * Per-product analytics — the buyer-side story of one piece: how many people saw
 * it, liked it, shared it, saved it, and what it has actually sold. Views/shares
 * come from the engagement counters in migration 0031; orders and revenue are
 * aggregated live from the boutique's order line items.
 */

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function ProductAnalytics() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { boutique } = useMyBoutique();

  const { data: product, loading } = useAsync(() => (id ? fetchProduct(id) : Promise.resolve(null)), [id]);
  const { data: orderRows } = useAsync(
    () => (boutique ? fetchOrdersForBoutique(boutique.id) : Promise.resolve([])),
    [boutique?.id],
  );

  if (!loading && !product) {
    return (
      <div style={css('min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:var(--ag-muted);')}>
        <span style={css("font-family:'Material Symbols Outlined';font-size:40px;color:var(--ag-border);")}>search_off</span>
        <div style={css('font-size:15px;')}>Product not found.</div>
        <button onClick={() => navigate('/seller/products')} style={css('height:44px;padding:0 18px;border:none;border-radius:12px;background:#B02454;color:#fff;font-weight:800;cursor:pointer;')}>
          Back to products
        </button>
      </div>
    );
  }

  // Orders and revenue this piece actually earned — a rejected/cancelled order
  // sold nothing, so it does not count toward either.
  const orders = orderRows ?? [];
  let units = 0;
  let revenue = 0;
  let orderCount = 0;
  orders.forEach((o) => {
    if (o.status === 'rejected' || o.status === 'cancelled') return;
    const lines = (o.items ?? []).filter((it) => it.product_id === id || it.title === product?.title);
    if (!lines.length) return;
    orderCount += 1;
    lines.forEach((it) => {
      units += it.qty;
      revenue += Number(it.price) * it.qty;
    });
  });

  const p = product;
  const tiles = [
    { icon: 'visibility', label: 'Views', value: String(p?.views_count ?? 0), tint: 'var(--ag-info-bg)', ic: 'var(--ag-info-text)' },
    { icon: 'favorite', label: 'Likes', value: String(p?.likes_count ?? 0), tint: 'var(--ag-surface-2)', ic: '#D6336C' },
    { icon: 'ios_share', label: 'Shares', value: String(p?.shares_count ?? 0), tint: 'var(--ag-purple-bg)', ic: '#9B7FC7' },
    { icon: 'bookmark', label: 'Wishlist saves', value: String(p?.wishlist_count ?? 0), tint: 'var(--ag-warn-bg)', ic: '#C99A3F' },
    { icon: 'shopping_bag', label: 'Orders', value: String(orderCount), tint: 'var(--ag-good-bg)', ic: 'var(--ag-good)' },
    { icon: 'payments', label: 'Revenue generated', value: fmt(revenue), tint: 'var(--ag-gold-bg)', ic: 'var(--ag-warn-text)' },
  ];

  const stock = p?.stock ?? 0;
  const stockTag =
    stock === 0
      ? { label: 'Out of stock', bg: 'var(--ag-bad-bg)', fg: '#D6455A' }
      : stock <= 5
        ? { label: `Low · ${stock} left`, bg: 'var(--ag-warn-bg)', fg: '#C99A3F' }
        : { label: `${stock} in stock`, bg: 'var(--ag-good-bg)', fg: 'var(--ag-good)' };

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('padding:6px 20px 12px;display:flex;align-items:center;gap:10px;')}>
        <button onClick={() => navigate('/seller/products')} aria-label="Back" style={css('width:42px;height:42px;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
        </button>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;")}>Product analytics</div>
      </div>

      {loading && <div style={css('color:var(--ag-muted);font-size:14px;padding:8px 22px;')}>Loading…</div>}

      {p && (
        <div style={css('padding:0 20px;')}>
          {/* Identity */}
          <div style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:20px;padding:14px;display:flex;gap:13px;align-items:center;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}>
            <div style={css(`width:64px;height:64px;flex:none;border-radius:16px;background:${TONES[p.tone]};position:relative;overflow:hidden;`)}>
              <ImageSlot src={p.image_url ?? undefined} placeholder={p.title} style={css('position:absolute;inset:0;')} />
            </div>
            <div style={css('flex:1;min-width:0;')}>
              <div style={css('font-weight:800;font-size:15px;color:var(--ag-ink);')}>{p.title}</div>
              <div style={css('font-size:12.5px;color:var(--ag-muted);margin-top:1px;')}>{p.category} · {fmt(Number(p.price))}</div>
              <span style={css(`display:inline-block;margin-top:6px;font-size:10.5px;font-weight:800;padding:3px 9px;border-radius:8px;background:${stockTag.bg};color:${stockTag.fg};`)}>{stockTag.label}</span>
            </div>
            <button onClick={() => navigate('/seller/products')} aria-label="Edit" style={css('width:38px;height:38px;flex:none;border-radius:11px;border:1.5px solid var(--ag-border);background:var(--ag-surface);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:var(--ag-crimson);")}>edit</span>
            </button>
          </div>

          {/* Metrics grid */}
          <div className="agx-sd-stats" style={css('margin-top:14px;')}>
            {tiles.map((t) => (
              <div key={t.label} style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:15px;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);')}>
                <span style={css(`width:38px;height:38px;border-radius:12px;background:${t.tint};display:flex;align-items:center;justify-content:center;`)}>
                  <span style={css(`font-family:'Material Symbols Outlined';font-size:20px;color:${t.ic};`)}>{t.icon}</span>
                </span>
                <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;margin-top:11px;color:var(--ag-ink);word-break:break-word;")}>{t.value}</div>
                <div style={css('color:var(--ag-muted);font-size:12px;font-weight:700;margin-top:3px;')}>{t.label}</div>
              </div>
            ))}
          </div>

          {/* Footnotes */}
          <div style={css('margin-top:14px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:18px;padding:14px 16px;box-shadow:0 14px 32px -28px rgba(107,20,54,.55);display:flex;flex-direction:column;gap:10px;')}>
            <div style={css('display:flex;align-items:center;gap:9px;font-size:13px;color:var(--ag-ink-2);')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:var(--ag-info-text);")}>schedule</span>
              <span style={css('flex:1;')}>Last viewed</span>
              <span style={css('font-weight:800;color:var(--ag-ink);')}>{fmtDate(p.last_viewed_at)}</span>
            </div>
            <div style={css('display:flex;align-items:center;gap:9px;font-size:13px;color:var(--ag-ink-2);border-top:1px solid var(--ag-border-soft);padding-top:10px;')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:var(--ag-good);")}>sell</span>
              <span style={css('flex:1;')}>Units sold</span>
              <span style={css('font-weight:800;color:var(--ag-ink);')}>{units}</span>
            </div>
            <div style={css('display:flex;align-items:center;gap:9px;font-size:13px;color:var(--ag-ink-2);border-top:1px solid var(--ag-border-soft);padding-top:10px;')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:var(--ag-purple);")}>event</span>
              <span style={css('flex:1;')}>Listed on</span>
              <span style={css('font-weight:800;color:var(--ag-ink);')}>{new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
