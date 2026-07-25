import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { TONES, fmt } from '@/data/demo';

/**
 * The bag, as a floating button.
 *
 * Cart gave up its slot in the bottom nav to Inspire, so it lives here instead:
 * pinned bottom-right above the nav dock, across the buyer app. It only appears
 * once there is something in it — a permanent button reading "0" is noise, and
 * an empty bag has nothing to show.
 *
 * It reads as a *receipt* rather than a button: a frosted ivory capsule showing
 * the actual garments the buyer picked, what they add up to, and one crimson
 * arrow to act on. The earlier solid-pink pill fought the crimson Sort button
 * on the results page for attention and told the buyer nothing they didn't
 * already know; the photos are what make it feel like their bag.
 *
 * It hides itself on the screens that *are* the checkout flow, where a shortcut
 * back to the bag would be at best redundant and at worst a way to loop out of a
 * payment mid-flight.
 */

const HIDE_ON = ['/buyer/cart', '/buyer/checkout', '/buyer/payment', '/buyer/order-confirmation', '/buyer/chat'];

/** How many garment thumbnails the capsule shows before it collapses to "+n". */
const MAX_THUMBS = 3;

export function FloatingBag() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { cart, cartCount, subtotal } = useShop();
  const { productById } = useCatalog();

  // Pulse when the count goes up, so adding from the feed is visibly acknowledged
  // even though the button is at the other end of the screen.
  const [bumped, setBumped] = useState(false);
  const previous = useRef(cartCount);
  useEffect(() => {
    if (cartCount > previous.current) {
      setBumped(true);
      const t = setTimeout(() => setBumped(false), 520);
      previous.current = cartCount;
      return () => clearTimeout(t);
    }
    previous.current = cartCount;
  }, [cartCount]);

  if (cartCount === 0) return null;
  if (HIDE_ON.some((p) => pathname.startsWith(p))) return null;

  // Newest first — the thing just added is the thing the buyer wants to see.
  const lines = Object.keys(cart)
    .map((id) => productById(id))
    .filter((p): p is NonNullable<typeof p> => p != null)
    .reverse();
  const thumbs = lines.slice(0, MAX_THUMBS);
  const hidden = lines.length - thumbs.length;

  return (
    <button
      onClick={() => navigate('/buyer/cart')}
      aria-label={`Open bag — ${cartCount} ${cartCount === 1 ? 'item' : 'items'}, ${fmt(subtotal)}`}
      className={`agx-fab-bag agx-bag-pill${bumped ? ' agx-bag-bump' : ''}`}
      style={css(
        'display:flex;align-items:center;gap:12px;padding:7px 8px 7px 7px;border-radius:999px;cursor:pointer;' +
          'border:1px solid var(--ag-border);background:var(--ag-frost-strong);' +
          'box-shadow:0 1px 0 rgba(255,255,255,.18) inset,0 24px 46px -24px var(--ag-shadow),0 4px 12px -6px rgba(107,20,54,.22);',
      )}
    >
      {/* The garments themselves, overlapped like cards fanned in the hand. */}
      <span style={css('display:flex;align-items:center;flex:none;')}>
        {thumbs.map((p, i) => (
          <span
            key={p.id}
            style={css(
              `position:relative;width:38px;height:38px;border-radius:12px;overflow:hidden;flex:none;` +
                `border:2px solid #fff;background:${TONES[p.tone] ?? '#F5E4EB'};` +
                `box-shadow:0 6px 14px -8px rgba(107,20,54,.75);z-index:${MAX_THUMBS - i};` +
                (i === 0 ? '' : 'margin-left:-15px;'),
            )}
          >
            <ImageSlot src={p.image} placeholder={p.title} className="agx-prod-fill" />
          </span>
        ))}
        {hidden > 0 && (
          <span
            style={css(
              'width:38px;height:38px;margin-left:-15px;border-radius:12px;border:2px solid #fff;flex:none;' +
                'background:var(--ag-surface-2);color:var(--ag-crimson);font-size:11.5px;font-weight:800;' +
                'display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px -8px rgba(107,20,54,.75);',
            )}
          >
            +{hidden}
          </span>
        )}
      </span>

      <span style={css('display:flex;flex-direction:column;align-items:flex-start;gap:2px;line-height:1;padding-right:2px;')}>
        <span className="agx-eyebrow" style={css('font-size:8.5px;color:var(--ag-muted);')}>
          {cartCount} {cartCount === 1 ? 'item' : 'items'}
        </span>
        {/* A ₹0 subtotal means the catalogue hasn't priced these lines yet — show
            the destination instead of a number that reads like a broken bag. */}
        <span style={css('font-weight:800;font-size:15px;color:var(--ag-ink);letter-spacing:-.01em;')}>
          {subtotal > 0 ? fmt(subtotal) : 'View bag'}
        </span>
      </span>

      <span
        className="agx-bag-go"
        style={css(
          'width:38px;height:38px;flex:none;border-radius:999px;display:flex;align-items:center;justify-content:center;' +
            'background:linear-gradient(140deg,#E14A7E,#B02454 70%,#8E1C44);color:#fff;' +
            'box-shadow:0 1px 0 rgba(255,255,255,.35) inset,0 10px 20px -10px rgba(176,36,84,.95);',
        )}
      >
        <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>arrow_forward</span>
      </span>
    </button>
  );
}
