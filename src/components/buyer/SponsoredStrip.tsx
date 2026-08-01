import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { AdImpression } from '@/components/buyer/AdImpression';
import { PromotedBadge } from '@/components/buyer/PromotedBadge';
import { useCatalog } from '@/state/CatalogContext';
import { TONES, fmt } from '@/data/demo';
import { trackAdClick, type AdCampaign } from '@/data/ads';

/**
 * A horizontal rail of Sponsored product cards, rendered from the live
 * `sponsored_card` ads. Each card resolves its product from the catalogue the
 * buyer already holds, so there is no extra fetch; ads whose product has since
 * been removed simply drop out. Impressions fire when a card scrolls into view;
 * a tap records a click before deep-linking to the product.
 */
export function SponsoredStrip({ ads, title = 'Sponsored for you' }: { ads: AdCampaign[]; title?: string }) {
  const navigate = useNavigate();
  const { productById } = useCatalog();

  const cards = ads
    .map((ad) => ({ ad, product: productById(ad.product_id ?? undefined) }))
    .filter((c) => c.product);

  if (cards.length === 0) return null;

  const open = (ad: AdCampaign, productId: string) => {
    void trackAdClick(ad.id);
    navigate(`/products/${productId}`);
  };

  return (
    <div style={css('margin:26px 0 0;')}>
      <div style={css('display:flex;align-items:center;gap:8px;margin-bottom:12px;')}>
        <span style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(19px,2.4vw,24px);color:var(--ag-ink);")}>{title}</span>
        <PromotedBadge style={{ background: 'rgba(214,51,108,.12)', color: 'var(--ag-crimson)' }} />
      </div>
      <div style={css('display:flex;gap:14px;overflow-x:auto;padding-bottom:6px;scrollbar-width:none;')}>
        {cards.map(({ ad, product: p }) => (
          <AdImpression key={ad.id} adId={ad.id} style={{ flex: 'none', width: 168 }}>
            <div onClick={() => open(ad, p!.id)} className="agx-lift" style={css('cursor:pointer;')}>
              <div className="agx-prod-media agx-zoom" style={css(`background:${TONES[p!.tone]};position:relative;`)}>
                <ImageSlot src={p!.image} placeholder={p!.title} className="agx-prod-fill" />
                <div style={css('position:absolute;left:9px;top:9px;')}>
                  <PromotedBadge />
                </div>
              </div>
              <div style={css('padding:9px 2px 0;')}>
                <div className="agx-card-title" style={css('font-size:13.5px;font-weight:700;')}>{p!.title}</div>
                <div className="agx-card-sub" style={css('font-size:12px;color:var(--ag-muted);')}>{p!.boutique}</div>
                <div style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:16.5px;margin-top:4px;")}>{fmt(p!.price)}</div>
              </div>
            </div>
          </AdImpression>
        ))}
      </div>
    </div>
  );
}
