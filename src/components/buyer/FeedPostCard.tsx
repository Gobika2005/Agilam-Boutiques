import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { useShop } from '@/state/ShopContext';
import { shareProduct } from '@/lib/share';
import { TONES, fmt } from '@/data/demo';
import type { FeedProduct } from '@/data/feed';

/** "2 mins ago" / "1 hour ago" / "3 Jul" — feed-style relative stamps. */
function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

/** How close two taps have to be to count as a double-tap. */
const DOUBLE_TAP_MS = 320;

/**
 * The size sheet.
 *
 * The card never shows a size row up front — most pieces are browsed, not
 * bought, and a strip of size chips on every card turns the feed into a form.
 * The question is only asked at the moment it matters: the buyer taps Add to
 * bag, the sheet comes up, they pick, and the piece goes in.
 *
 * Portalled to the body — the app header sets `backdrop-filter`, which makes it
 * a containing block for any fixed-position descendant rendered inside it.
 */
function SizeSheet({
  title,
  image,
  price,
  tone,
  options,
  initial,
  onConfirm,
  onClose,
}: {
  title: string;
  image?: string;
  price: number;
  tone: number;
  options: string[];
  initial: string | null;
  onConfirm: (size: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(initial);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={css('position:fixed;inset:0;z-index:1200;background:rgba(36,16,25,.5);backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center;animation:agx-fade .18s ease;')}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Choose a size"
        style={css('width:100%;max-width:620px;background:var(--ag-surface);border-radius:26px 26px 0 0;padding:10px 18px calc(20px + env(safe-area-inset-bottom));animation:agx-sheet .26s cubic-bezier(.2,.8,.25,1);max-height:88vh;overflow-y:auto;')}
      >
        <div style={css('width:44px;height:4px;border-radius:999px;background:var(--ag-surface-2);margin:0 auto 16px;')} />

        <div style={css('display:flex;align-items:center;gap:12px;')}>
          <span style={css(`flex:none;width:56px;height:70px;border-radius:14px;overflow:hidden;position:relative;background:${TONES[tone % TONES.length]};`)}>
            <ImageSlot src={image} placeholder={title} alt={title} className="agx-prod-fill" />
          </span>
          <span style={css('flex:1;min-width:0;')}>
            <span style={css("display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:16.5px;color:var(--ag-ink);line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;")}>
              {title}
            </span>
            <span style={css("display:block;font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:19px;margin-top:4px;")}>
              {fmt(price)}
            </span>
          </span>
        </div>

        <div className="agx-eyebrow" style={css('font-size:9.5px;color:var(--ag-muted);margin-top:20px;')}>
          {picked ? `Size · ${picked}` : 'Choose a size'}
        </div>
        <div style={css('display:flex;flex-wrap:wrap;gap:9px;margin-top:10px;')}>
          {options.map((s) => {
            const on = picked === s;
            return (
              <button
                key={s}
                onClick={() => setPicked(s)}
                aria-pressed={on}
                style={css(`min-width:52px;height:48px;padding:0 15px;border-radius:14px;border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-ink-2)'};font-weight:${on ? 800 : 700};font-size:14px;cursor:pointer;`)}
              >
                {s}
              </button>
            );
          })}
        </div>

        <button
          disabled={!picked}
          onClick={() => picked && onConfirm(picked)}
          style={css(`width:100%;height:54px;margin-top:22px;border:none;border-radius:16px;font-weight:800;font-size:15px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:${picked ? 'pointer' : 'not-allowed'};color:#fff;background:${picked ? 'linear-gradient(135deg,#D6336C,#B02454)' : 'var(--ag-border)'};box-shadow:${picked ? '0 16px 34px -16px rgba(214,51,108,.85)' : 'none'};transition:background .2s ease;`)}
        >
          <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>shopping_bag</span>
          {picked ? `Add ${picked} to bag` : 'Select a size'}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/**
 * One piece in the Inspire feed.
 *
 * The card *is* the listing — the boutique's own photos, title, price and
 * description, with nothing re-entered. It carries one buying action, Add to
 * bag, which becomes a quantity stepper once the piece is in; where the boutique
 * declared sizes, the sheet asks for one on the way through.
 *
 * The photo is for looking at, not for navigating: a double-tap likes it, the
 * way it does in every other feed. "View details" is the deliberate route to the
 * product page, where the size guide, full description and reviews live.
 */
export function FeedPostCard({
  product,
  liked,
  likes,
  onToggleLike,
}: {
  product: FeedProduct;
  liked: boolean;
  likes: number;
  onToggleLike: () => void;
}) {
  const navigate = useNavigate();
  const { showToast, addToCart, cart, cartQty, isFollowing, toggleFollow } = useShop();

  const [slide, setSlide] = useState(0);
  const [askSize, setAskSize] = useState(false);
  const [burst, setBurst] = useState(0);
  const stripRef = useRef<HTMLDivElement>(null);
  const lastTapRef = useRef(0);

  const boutique = product.boutique;
  // The listing's own gallery: the cover first, then the rest, de-duped.
  const images = [...new Set([product.image_url, ...(product.images ?? [])].filter(Boolean))] as string[];

  const price = Number(product.price);
  const mrp = product.mrp != null ? Number(product.mrp) : null;
  const hasMrp = !!mrp && mrp > price;
  const discountPct = hasMrp ? Math.round((1 - price / (mrp as number)) * 100) : null;

  // Only the sizes the boutique actually listed. When it declared none, there is
  // nothing to ask and the line goes in as free size.
  const sizeOptions = product.sizes ?? [];
  const needsSize = sizeOptions.length > 0;
  const bagLine = cart[product.id];
  const bagQty = bagLine?.qty ?? 0;
  // The size this piece is already in the bag at, so re-opening the sheet starts
  // where the buyer left off rather than blank.
  const bagSize = bagLine && sizeOptions.includes(bagLine.size) ? bagLine.size : null;

  const following = !!boutique && isFollowing(boutique.id);
  const soldOut = product.stock === 0;
  const lowStock = !soldOut && product.stock <= 5;
  const openProduct = () => navigate(`/products/${product.id}`);
  const openBoutique = () => boutique && navigate(`/boutique/${boutique.id}`);

  const onFollow = () => {
    if (!boutique) return;
    const now = toggleFollow(boutique.id);
    if (now) showToast(`Following ${boutique.name}`);
  };

  const onStripScroll = () => {
    const el = stripRef.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setSlide((prev) => (prev === i ? prev : i));
  };

  const goToSlide = (i: number) => {
    const el = stripRef.current;
    if (!el) return;
    setSlide(i);
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  // Double-tap to like. The first tap does nothing at all, so there is no
  // disambiguation delay to sit through and no accidental navigation — the burst
  // plays on every double-tap, but an already-liked piece is never un-liked by
  // one (that would make a mis-tap destructive).
  const onPhotoTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      lastTapRef.current = 0;
      if (!liked) onToggleLike();
      setBurst((n) => n + 1);
    } else {
      lastTapRef.current = now;
    }
  };

  const onShare = async () => {
    const result = await shareProduct({
      title: product.title,
      price: fmt(price),
      url: `${window.location.origin}/products/${product.id}`,
      image: images[slide] || images[0],
      boutique: boutique?.name,
    });
    if (result === 'copied') showToast('Product details copied — paste to share');
    else if (result === 'failed') showToast("Couldn't share this piece", 'error');
  };

  const onAddToBag = () => {
    if (soldOut) {
      showToast('This piece is out of stock', 'error');
      return;
    }
    // Ask for the size only now, on the way into the bag.
    if (needsSize) {
      setAskSize(true);
      return;
    }
    addToCart(product.id, 'Free');
  };

  const onIncrease = () => {
    if (bagQty >= product.stock) {
      showToast(`Only ${product.stock} left in stock`, 'error');
      return;
    }
    cartQty(product.id, 1);
  };

  return (
    <article style={css('background:var(--ag-surface);border:1px solid var(--ag-surface-3);border-radius:22px;overflow:hidden;box-shadow:0 18px 40px -32px rgba(107,20,54,.55);')}>
      {/* ── Boutique identity ── */}
      <div style={css('display:flex;align-items:center;gap:11px;padding:13px 14px;')}>
        <button onClick={openBoutique} aria-label={`Open ${boutique?.name ?? 'boutique'}`} style={css('border:none;background:none;padding:0;cursor:pointer;')}>
          <BoutiqueLogo name={boutique?.name ?? 'Boutique'} src={boutique?.logo_url} size={44} />
        </button>
        <button onClick={openBoutique} style={css('flex:1;min-width:0;border:none;background:none;padding:0;cursor:pointer;text-align:left;')}>
          <span style={css('display:flex;align-items:center;gap:5px;')}>
            <span style={css('font-weight:800;font-size:14.5px;color:var(--ag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;')}>
              {boutique?.name ?? 'Boutique'}
            </span>
            {boutique?.verified && (
              <span style={css("font-family:'Material Symbols Outlined';font-size:16px;color:#3A9BE0;flex:none;")}>verified</span>
            )}
          </span>
          <span style={css('display:block;font-size:12px;color:var(--ag-muted);margin-top:1px;')}>
            {timeAgo(product.created_at)}{boutique?.city ? ` · ${boutique.city}` : ''}
          </span>
        </button>

        {/* Follow lives top-right: a shop the buyer follows shows a "Following"
            tick, one they don't shows the Follow button. Either way it toggles. */}
        {boutique && (
          following ? (
            <button
              onClick={onFollow}
              aria-label={`Following ${boutique.name}`}
              style={css('flex:none;display:flex;align-items:center;gap:4px;height:34px;padding:0 13px;border:1.5px solid var(--ag-border);border-radius:999px;background:var(--ag-surface-2);color:var(--ag-ink-2);font-size:12.5px;font-weight:800;cursor:pointer;')}
            >
              <span style={css("font-family:'Material Symbols Outlined';font-size:16px;color:var(--ag-crimson);font-variation-settings:'FILL' 1;")}>check_circle</span>Following
            </button>
          ) : (
            <button
              onClick={onFollow}
              aria-label={`Follow ${boutique.name}`}
              style={css('flex:none;display:flex;align-items:center;gap:4px;height:34px;padding:0 14px;border:1.5px solid #D6336C;border-radius:999px;background:var(--ag-surface);color:var(--ag-crimson);font-size:12.5px;font-weight:800;cursor:pointer;')}
            >
              <span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>add</span>Follow
            </button>
          )
        )}
      </div>

      {/* ── Photos. Double-tap likes; the photo doesn't navigate. ── */}
      <div style={css('position:relative;')}>
        <div
          ref={stripRef}
          onScroll={onStripScroll}
          onClick={onPhotoTap}
          className="agx-scroll"
          style={css('display:flex;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;')}
        >
          {(images.length ? images : ['']).map((src, i) => (
            <div
              key={`${product.id}-${i}`}
              style={css(`position:relative;flex:0 0 100%;width:100%;aspect-ratio:4/5;scroll-snap-align:center;scroll-snap-stop:always;background:${TONES[product.tone % TONES.length]};`)}
            >
              <ImageSlot src={src || undefined} placeholder={product.title} alt={`${product.title} — photo ${i + 1}`} className="agx-prod-fill" />
            </div>
          ))}
        </div>

        {/* The double-tap burst. Keyed by tap count so a rapid second one restarts
            the animation instead of being swallowed mid-flight. */}
        {burst > 0 && (
          <span
            key={burst}
            onAnimationEnd={() => setBurst(0)}
            aria-hidden="true"
            style={css("position:absolute;left:50%;top:50%;font-family:'Material Symbols Outlined';font-variation-settings:'FILL' 1;font-size:96px;color:rgba(255,255,255,.95);pointer-events:none;text-shadow:0 10px 30px rgba(107,20,54,.55);animation:agx-burst .85s cubic-bezier(.2,.7,.2,1) forwards;")}
          >
            favorite
          </span>
        )}

        {hasMrp && (
          <div style={css('position:absolute;left:12px;top:12px;background:linear-gradient(135deg,var(--ag-good-text),#186B43);color:#fff;font-size:11.5px;font-weight:800;padding:6px 11px;border-radius:999px;box-shadow:0 8px 20px -10px rgba(30,132,85,.9);')}>
            {discountPct}% off
          </div>
        )}

        {images.length > 1 && (
          <>
            <div style={css("position:absolute;right:12px;top:12px;background:rgba(36,16,25,.55);backdrop-filter:blur(6px);color:#fff;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;padding:4px 9px;border-radius:999px;")}>
              {slide + 1}/{images.length}
            </div>
            <div style={css('position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;align-items:center;gap:5px;padding:6px 9px;border-radius:999px;background:rgba(36,16,25,.4);backdrop-filter:blur(6px);')}>
              {images.map((_, i) => (
                <button
                  key={`${product.id}-dot-${i}`}
                  aria-label={`Go to photo ${i + 1}`}
                  onClick={(e) => { e.stopPropagation(); goToSlide(i); }}
                  style={css(`width:${i === slide ? 16 : 6}px;height:6px;padding:0;border:none;border-radius:999px;cursor:pointer;background:${i === slide ? '#fff' : 'rgba(255,255,255,.5)'};transition:width .25s ease;`)}
                />
              ))}
            </div>
          </>
        )}

        {soldOut && (
          <div style={css('position:absolute;inset:0;background:rgba(255,255,255,.55);display:flex;align-items:center;justify-content:center;pointer-events:none;')}>
            <span style={css('background:#241019;color:#fff;font-size:12.5px;font-weight:800;padding:8px 16px;border-radius:999px;')}>Sold out</span>
          </div>
        )}
      </div>

      {/* ── Views + like + share ── */}
      <div style={css('display:flex;align-items:center;gap:14px;padding:11px 16px 4px;')}>
        {/* How many have seen this piece — sits first, ahead of the like. */}
        <span style={css('display:flex;align-items:center;gap:7px;padding:6px 2px;color:var(--ag-ink-2);')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:23px;")}>visibility</span>
          <span style={css('font-size:13.5px;font-weight:800;')}>{compact(product.views_count ?? 0)}</span>
        </span>

        <button
          onClick={onToggleLike}
          aria-label={liked ? 'Unlike' : 'Like this piece'}
          aria-pressed={liked}
          style={css('display:flex;align-items:center;gap:7px;border:none;background:none;padding:6px 2px;cursor:pointer;')}
        >
          <span className={`agx-heart${liked ? ' agx-heart-on' : ''}`} style={css(`font-size:24px;color:${liked ? '#E11D48' : 'var(--ag-ink-2)'};`)}>
            favorite
          </span>
          <span style={css('font-size:13.5px;font-weight:800;color:var(--ag-ink-2);')}>{compact(likes)}</span>
        </button>

        <button
          onClick={() => void onShare()}
          aria-label="Share this piece"
          style={css('display:flex;align-items:center;border:none;background:none;padding:6px 2px;cursor:pointer;')}
        >
          <span className="agx-heart" style={css('font-size:23px;color:var(--ag-ink-2);')}>send</span>
        </button>

        <div style={css('flex:1;')} />

        <button
          onClick={openProduct}
          style={css('display:flex;align-items:center;gap:4px;border:none;background:none;padding:6px 2px;cursor:pointer;color:var(--ag-crimson);font-size:12.5px;font-weight:800;')}
        >
          View details
          <span style={css("font-family:'Material Symbols Outlined';font-size:17px;")}>chevron_right</span>
        </button>
      </div>

      {/* ── The piece ──
          Title on one line with the price to the right, then the one-line
          description, then a bottom row pairing the rating — shown as a solid
          badge rather than a bare star — with the buying action. Views live up
          in the action row, ahead of the like. */}
      <div style={css('padding:6px 16px 16px;')}>
        {/* Title (single line) + price */}
        <div style={css('display:flex;align-items:flex-start;gap:12px;')}>
          <button onClick={openProduct} style={css('flex:1;min-width:0;border:none;background:none;padding:0;cursor:pointer;text-align:left;')}>
            <span style={css("display:block;font-family:'Playfair Display',serif;font-weight:700;font-size:18px;line-height:1.25;color:var(--ag-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;")}>
              {product.title}
            </span>
          </button>
          <span style={css('flex:none;display:flex;align-items:baseline;gap:6px;')}>
            <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:21px;line-height:1;")}>{fmt(price)}</span>
            {hasMrp && <span style={css('text-decoration:line-through;color:var(--ag-muted-soft);font-size:12.5px;font-weight:700;')}>{fmt(mrp as number)}</span>}
          </span>
        </div>

        {/* Description (single line) */}
        <div style={css('font-size:13px;line-height:1.4;color:var(--ag-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:7px;')}>
          {product.description || ' '}
        </div>

        {/* Rating badge + the buying action.
            The rating reads as a solid badge rather than a bare star. One
            tap; once the piece is in the bag it becomes a stepper, so a
            second tap adjusts the count instead of silently re-adding. */}
        <div style={css('display:flex;align-items:center;gap:12px;margin-top:11px;')}>
          <div style={css('flex:1;min-width:0;display:flex;align-items:center;gap:9px;')}>
            <span style={css('display:inline-flex;align-items:center;gap:4px;background:var(--ag-gold-bg);border:1px solid var(--ag-gold-border);color:#B8892B;font-size:12.5px;font-weight:800;padding:3px 9px;border-radius:9px;')}>
              {product.rating}
              <span style={css("font-family:'Material Symbols Outlined';font-size:14px;color:var(--ag-star);font-variation-settings:'FILL' 1;")}>star</span>
            </span>
            {lowStock && <span style={css('font-size:11.5px;font-weight:800;color:var(--ag-gold-text);')}>Only {product.stock} left</span>}
          </div>

          {soldOut ? (
            <button
              onClick={openProduct}
              style={css('flex:none;height:44px;padding:0 18px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:14px;font-weight:800;font-size:13.5px;cursor:pointer;white-space:nowrap;')}
            >
              View
            </button>
          ) : bagQty === 0 ? (
            <button
              onClick={onAddToBag}
              style={css('flex:none;height:44px;padding:0 18px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:7px;box-shadow:0 14px 30px -16px rgba(214,51,108,.85);white-space:nowrap;')}
            >
              <span style={css("font-family:'Material Symbols Outlined';font-size:19px;")}>shopping_bag</span>Add to Bag
            </button>
          ) : (
            <div style={css('flex:none;height:44px;display:flex;align-items:center;gap:5px;padding:5px;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);box-shadow:0 14px 30px -16px rgba(214,51,108,.85);')}>
              <button
                onClick={() => cartQty(product.id, -1)}
                aria-label={bagQty === 1 ? 'Remove from bag' : 'Reduce quantity'}
                style={css('width:34px;height:34px;flex:none;padding:0;border:none;border-radius:10px;background:rgba(255,255,255,.2);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
              >
                <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:#fff;")}>{bagQty === 1 ? 'delete' : 'remove'}</span>
              </button>
              <button
                onClick={() => navigate('/cart')}
                aria-label="View bag"
                style={css('flex:none;min-width:34px;padding:0 4px;height:34px;border:none;background:none;color:#fff;cursor:pointer;font-weight:800;font-size:15px;')}
              >
                {bagQty}
              </button>
              <button
                onClick={onIncrease}
                aria-label="Increase quantity"
                style={css(`width:34px;height:34px;flex:none;padding:0;border:none;border-radius:10px;background:rgba(255,255,255,.2);cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:${bagQty >= product.stock ? '.45' : '1'};`)}
              >
                <span style={css("font-family:'Material Symbols Outlined';font-size:19px;color:#fff;")}>add</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {askSize && (
        <SizeSheet
          title={product.title}
          image={images[slide] || images[0]}
          price={price}
          tone={product.tone}
          options={sizeOptions}
          initial={bagSize}
          onClose={() => setAskSize(false)}
          onConfirm={(size) => {
            setAskSize(false);
            addToCart(product.id, size);
          }}
        />
      )}
    </article>
  );
}
