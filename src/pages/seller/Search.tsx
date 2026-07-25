import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { TONES, fmt } from '@/data/demo';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { useMyBoutique } from '@/hooks/useMyBoutique';
import { useAsync } from '@/hooks/useAsync';
import { fetchProductsByBoutique } from '@/data/products';
import { fetchOrdersForBoutique } from '@/data/orders';
import { fetchConversationsForBoutique } from '@/data/chat';
import { toOrderView } from '@/lib/orderView';

/**
 * Global search across the seller's own catalogue, orders, customers and chats.
 * Everything is scoped to the signed-in boutique and matched client-side over
 * data the console already loads elsewhere, so a query resolves instantly.
 */
export function Search() {
  const navigate = useNavigate();
  const { boutique } = useMyBoutique();
  const [q, setQ] = useState('');

  const { data: products } = useAsync(() => (boutique ? fetchProductsByBoutique(boutique.id) : Promise.resolve([])), [boutique?.id]);
  const { data: orderRows } = useAsync(() => (boutique ? fetchOrdersForBoutique(boutique.id) : Promise.resolve([])), [boutique?.id]);
  const { data: convos } = useAsync(() => (boutique ? fetchConversationsForBoutique(boutique.id) : Promise.resolve([])), [boutique?.id]);

  const term = q.trim().toLowerCase();

  const results = useMemo(() => {
    if (!term) return null;
    const prod = (products ?? [])
      .filter((p) => p.title.toLowerCase().includes(term) || p.category.toLowerCase().includes(term))
      .slice(0, 6);

    const orderViews = (orderRows ?? []).map((o, i) => toOrderView(o, i));
    const ord = orderViews
      .filter((o) => o.number.toLowerCase().includes(term) || o.customer.toLowerCase().includes(term) || (o.items ?? []).some((it) => it.title.toLowerCase().includes(term)))
      .slice(0, 6);

    // Customers grouped from orders — match by name.
    const seen = new Set<string>();
    const cust = orderViews
      .filter((o) => {
        if (!o.customer.toLowerCase().includes(term)) return false;
        const key = o.customer.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);

    const msg = (convos ?? [])
      .filter((c) => (c.buyer_name || 'Customer').toLowerCase().includes(term) || c.last_message.toLowerCase().includes(term))
      .slice(0, 6);

    return { prod, ord, cust, msg, total: prod.length + ord.length + cust.length + msg.length };
  }, [term, products, orderRows, convos]);

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={css('margin-top:18px;')}>
      <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);margin:0 2px 8px;')}>{title}</div>
      <div style={css('display:flex;flex-direction:column;gap:8px;')}>{children}</div>
    </div>
  );

  const Row = ({ icon, tone, image, title, sub, right, onClick }: { icon?: string; tone?: number; image?: string | null; title: string; sub: string; right?: string; onClick: () => void }) => (
    <div onClick={onClick} style={css('display:flex;align-items:center;gap:11px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:14px;padding:10px;cursor:pointer;box-shadow:0 10px 26px -24px rgba(107,20,54,.6);')}>
      <div style={css(`width:44px;height:44px;flex:none;border-radius:12px;background:${TONES[(tone ?? 0) % TONES.length]};display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;`)}>
        {image !== undefined ? <ImageSlot src={image ?? undefined} placeholder={title} style={css('position:absolute;inset:0;')} /> : <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>{icon}</span>}
      </div>
      <div style={css('flex:1;min-width:0;')}>
        <div style={css('font-weight:800;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{title}</div>
        <div style={css('font-size:12px;color:var(--ag-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>{sub}</div>
      </div>
      {right && <div style={css('font-weight:800;color:var(--ag-crimson);font-size:13px;flex:none;')}>{right}</div>}
    </div>
  );

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('padding:6px 20px 8px;display:flex;align-items:center;gap:10px;')}>
        <button onClick={() => navigate(-1)} aria-label="Back" style={css('width:42px;height:42px;flex:none;border-radius:12px;border:none;background:var(--ag-surface);box-shadow:0 6px 18px -12px rgba(107,20,54,.6);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
        </button>
        <div style={css('flex:1;display:flex;align-items:center;gap:9px;background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:14px;padding:0 14px;height:46px;')}>
          <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-muted-soft);font-size:20px;")}>search</span>
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products, orders, customers, chats"
            style={css('flex:1;border:none;outline:none;background:none;font-family:inherit;font-size:14px;color:var(--ag-ink);')}
          />
        </div>
      </div>

      <div style={css('padding:0 20px;')}>
        {!results && (
          <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:56px 20px;color:var(--ag-muted);')}>
            <span style={css("font-family:'Material Symbols Outlined';font-size:38px;color:var(--ag-border);")}>search</span>
            <div style={css('font-size:14px;margin-top:10px;max-width:280px;line-height:1.5;')}>Search across your products, orders, customers and conversations.</div>
          </div>
        )}

        {results && results.total === 0 && (
          <div style={css('color:var(--ag-muted);font-size:14px;padding:24px 2px;text-align:center;')}>No matches for “{q}”.</div>
        )}

        {results && results.prod.length > 0 && (
          <Section title="Products">
            {results.prod.map((p) => (
              <Row key={p.id} image={p.image_url} tone={p.tone} title={p.title} sub={`${p.category} · ${fmt(Number(p.price))}`} onClick={() => navigate(`/seller/products/${p.id}`)} />
            ))}
          </Section>
        )}

        {results && results.ord.length > 0 && (
          <Section title="Orders">
            {results.ord.map((o) => (
              <Row key={o.id} icon="receipt_long" tone={o.tone} title={`${o.number} · ${o.customer}`} sub={`${o.item} · ${o.date}`} right={fmt(o.amount)} onClick={() => navigate(`/seller/orders/${encodeURIComponent(o.id)}`)} />
            ))}
          </Section>
        )}

        {results && results.cust.length > 0 && (
          <Section title="Customers">
            {results.cust.map((o) => (
              <Row key={`c-${o.id}`} icon="person" tone={o.tone} title={o.customer} sub={o.city ?? o.phone ?? 'Customer'} onClick={() => navigate('/seller/customers')} />
            ))}
          </Section>
        )}

        {results && results.msg.length > 0 && (
          <Section title="Messages">
            {results.msg.map((c) => (
              <Row key={c.id} icon="chat" tone={c.boutique_tone} title={c.buyer_name || 'Customer'} sub={c.last_message} onClick={() => navigate(`/seller/chat/${c.id}`)} />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
