import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { WishButton, WishHeart } from '@/components/buyer/WishButton';
import { CardLink } from '@/components/buyer/CardLink';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { TONES, fmt } from '@/data/demo';

export function Wishlist() {
  usePageMeta({ title: 'Wishlist', description: 'The pieces you have saved on MangaiMart.' });
  const navigate = useNavigate();
  const { wishlist, toggleWish } = useShop();
  const { products: PRODUCTS } = useCatalog();

  const items = PRODUCTS.filter((p) => wishlist[p.id]);

  return (
    <div style={css('min-height:100%;background:var(--ag-bg);padding-bottom:20px;')}>
      <div style={css('display:flex;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;gap:12px;padding:4px 0 6px;')}>
        <div>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Saved by you</div>
          <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(27px,3.2vw,42px);line-height:1.1;padding-bottom:2px;margin:6px 0 0;letter-spacing:-.01em;")}>Wishlist</h1>
        </div>
        {/* Counts what is actually on screen (a saved piece the boutique has
            since removed is no longer in `items`), and says "1 piece", not
            "1 pieces". */}
        {items.length > 0 && (
          <span style={css('color:var(--ag-muted);font-size:13.5px;font-weight:600;')}>
            {items.length} {items.length === 1 ? 'piece' : 'pieces'} saved
          </span>
        )}
      </div>

      {items.length > 0 ? (
        <div className="agx-rgrid" style={css('margin-top:20px;')}>
          {items.map((p) => (
            <CardLink key={p.id} to={`/buyer/product/${p.id}`} label={p.title} className="agx-lift">
              <div className="agx-prod-media agx-zoom" style={css(`background:${TONES[p.tone]};`)}>
                <ImageSlot src={p.image} placeholder={p.title} className="agx-prod-fill" />
                <WishButton
                  wished
                  title={p.title}
                  onToggle={(e) => { e.stopPropagation(); toggleWish(p.id); }}
                  className="agx-card-wish"
                />
                {p.reviews > 0 && (
                  <div style={css('position:absolute;left:10px;bottom:10px;display:flex;align-items:center;gap:4px;background:rgba(255,255,255,.96);border-radius:9px;padding:3px 8px;font-size:11px;font-weight:800;color:#241019;box-shadow:0 4px 10px rgba(0,0,0,.14);')}>
                    <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:13px;color:#E0B84B;")}>star</span>{p.rating}
                  </div>
                )}
              </div>
              <div style={css('padding:11px 2px 0;')}>
                <div className="agx-card-title" style={css('font-size:14px;font-weight:700;')}>{p.title}</div>
                <div style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:19px;margin-top:2px;")}>{fmt(p.price)}</div>
              </div>
            </CardLink>
          ))}
        </div>
      ) : (
        <div style={css('display:flex;flex-direction:column;align-items:center;text-align:center;padding:80px 30px;')}>
          <div style={css('width:82px;height:82px;border-radius:50%;background:linear-gradient(145deg,var(--ag-surface-2),var(--ag-surface-2));display:flex;align-items:center;justify-content:center;box-shadow:inset 0 2px 3px rgba(255,255,255,.7),0 12px 26px -12px rgba(214,51,108,.55);')}>
            <WishHeart wished={false} size={40} />
          </div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:26px;margin-top:20px;")}>Your wishlist is empty</div>
          <div style={css('color:var(--ag-muted);font-size:14.5px;margin-top:8px;max-width:340px;line-height:1.55;')}>Tap the heart on any piece and it lands here — your personal edit, ready when you are.</div>
          <button onClick={() => navigate('/buyer/home')} style={css('margin-top:20px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;border:none;border-radius:14px;padding:13px 24px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);')}>Browse collections</button>
        </div>
      )}
    </div>
  );
}
