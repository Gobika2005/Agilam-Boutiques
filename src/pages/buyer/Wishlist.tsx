import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { usePageMeta } from '@/lib/pageMeta';
import { routes } from '@/lib/seo';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { Icon } from '@/components/ui/Icon';
import { WishButton, WishHeart } from '@/components/buyer/WishButton';
import { CardLink } from '@/components/buyer/CardLink';
import { AskMyPeopleSheet } from '@/components/buyer/AskMyPeopleSheet';
import { AccountSheet } from '@/components/buyer/AccountSheet';
import { useQuickAsk } from '@/hooks/useQuickAsk';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { TONES, fmt } from '@/data/demo';

export function Wishlist() {
  usePageMeta({ title: 'Wishlist', description: 'The pieces you have saved on MangaiMart.' });
  const navigate = useNavigate();
  const { wishlist, toggleWish } = useShop();
  const { products: PRODUCTS } = useCatalog();
  const [asking, setAsking] = useState(false);
  const quickAsk = useQuickAsk();

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

      {/* The wishlist is where someone is already torn between two pieces —
          which makes it the natural place to ask. Only offered once there is
          genuinely something to choose between.

          The primary button shares everything saved in one tap, because that is
          what she means most of the time. "Choose which ones" is there for a
          wishlist that has grown past one decision. */}
      {items.length > 1 && (
        <div style={css('display:flex;align-items:center;gap:11px;width:100%;margin-top:16px;padding:13px 15px;border:1.5px solid var(--ag-border);border-radius:16px;background:var(--ag-surface);')}>
          <span style={css('flex:none;width:38px;height:38px;border-radius:12px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
            <Icon name="groups" style={{ fontSize: 21, color: 'var(--ag-crimson)' }} />
          </span>
          <span style={css('flex:1;min-width:0;')}>
            <span style={css('display:block;font-size:14px;font-weight:800;color:var(--ag-ink);')}>Can't decide? Ask my people</span>
            <span style={css('display:block;font-size:12px;color:var(--ag-muted);margin-top:2px;line-height:1.4;')}>
              They vote without signing up.{' '}
              <button
                type="button"
                onClick={() => setAsking(true)}
                style={css('border:none;background:none;padding:0;font-family:inherit;font-size:12px;font-weight:800;color:var(--ag-crimson);cursor:pointer;text-decoration:underline;')}
              >
                Choose which ones
              </button>
            </span>
          </span>
          <button
            type="button"
            disabled={quickAsk.busy}
            onClick={() =>
              void quickAsk.ask({
                productIds: items.map((p) => p.id),
                images: items.map((p) => p.image),
              })
            }
            style={css(`flex:none;height:40px;padding:0 16px;border:none;border-radius:12px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13px;cursor:pointer;font-family:inherit;display:flex;align-items:center;gap:6px;opacity:${quickAsk.busy ? 0.6 : 1};`)}
          >
            <Icon name="share" style={{ fontSize: 17 }} />
            {quickAsk.busy ? 'Opening…' : 'Ask all'}
          </button>
        </div>
      )}

      {items.length > 0 ? (
        <div className="agx-rgrid" style={css('margin-top:20px;')}>
          {items.map((p) => (
            <CardLink key={p.id} to={routes.product(p)} label={p.title} className="agx-lift">
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
                    <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:13px;color:var(--ag-star);")}>star</span>{p.rating}
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
          <button onClick={() => navigate('/')} style={css('margin-top:20px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;border:none;border-radius:14px;padding:13px 24px;font-weight:800;font-size:14px;cursor:pointer;box-shadow:0 14px 30px -14px rgba(214,51,108,.8);')}>Browse collections</button>
        </div>
      )}

      {asking && <AskMyPeopleSheet onClose={() => setAsking(false)} />}

      {/* The one prompt a direct share cannot avoid: a board has to belong to
          someone, and the votes have to reach a person. */}
      {quickAsk.needsSignIn && (
        <AccountSheet
          title="Sign in to ask your people"
          subtitle="A shortlist is yours to keep and share — sign in and we'll tell you the moment someone votes."
          onDone={quickAsk.closeSignIn}
          onClose={quickAsk.closeSignIn}
        />
      )}
    </div>
  );
}
