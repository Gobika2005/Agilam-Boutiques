import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { css } from '@/lib/css';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { ProductReviews } from '@/components/buyer/ProductReviews';
import { ImageZoom } from '@/components/buyer/ImageZoom';
import { WishButton } from '@/components/buyer/WishButton';
import { CardLink } from '@/components/buyer/CardLink';
import { BoutiqueLogo } from '@/components/buyer/BoutiqueLogo';
import { shareProduct } from '@/lib/shareProduct';
import { recordProductView, recordProductShare } from '@/data/products';
import { sortSizes } from '@/lib/sizes';
import { usePageMeta } from '@/lib/pageMeta';
import { TONES, fmt } from '@/data/demo';
import { FREE_SHIP_MIN, SHIP_FEE } from '@/lib/pricing';
import { POLICY_TERMS } from '@/data/company';

const reviewsF = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

const FALLBACK_SIZES = ['S', 'M', 'L', 'XL'];

// Reference body measurements in inches. Sarees ship with an unstitched
// blouse piece tailored to these; every other category is a finished
// garment, so the chart shows how the buyer's own body compares instead of
// claiming a "blouse" fit no non-saree piece has.
// `measurements` is a plain Record rather than fixed fields so the blouse and
// body charts — which don't share every column — can be rendered by the same
// generic table without TypeScript narrowing the row to whichever shape has
// fewer keys.
// The chart has to reach every size a boutique can actually list, or a buyer
// choosing XXL is sent to a "fit guide" that stops at XL and tells them nothing.
const BLOUSE_SIZE_CHART: { size: string; measurements: Record<string, string> }[] = [
  { size: 'XS', measurements: { bust: '30', waist: '26', shoulder: '13', length: '14.5' } },
  { size: 'S', measurements: { bust: '32', waist: '28', shoulder: '13.5', length: '15' } },
  { size: 'M', measurements: { bust: '34', waist: '30', shoulder: '14', length: '15' } },
  { size: 'L', measurements: { bust: '36', waist: '32', shoulder: '14.5', length: '15.5' } },
  { size: 'XL', measurements: { bust: '38', waist: '34', shoulder: '15', length: '15.5' } },
  { size: 'XXL', measurements: { bust: '40', waist: '36', shoulder: '15.5', length: '16' } },
  { size: '3XL', measurements: { bust: '42', waist: '38', shoulder: '16', length: '16' } },
  { size: '4XL', measurements: { bust: '44', waist: '40', shoulder: '16.5', length: '16.5' } },
  { size: '5XL', measurements: { bust: '46', waist: '42', shoulder: '17', length: '16.5' } },
  { size: '6XL', measurements: { bust: '48', waist: '44', shoulder: '17.5', length: '17' } },
];
const BODY_SIZE_CHART: { size: string; measurements: Record<string, string> }[] = [
  { size: 'XS', measurements: { bust: '30', waist: '24', hip: '33' } },
  { size: 'S', measurements: { bust: '32', waist: '26', hip: '35' } },
  { size: 'M', measurements: { bust: '34', waist: '28', hip: '37' } },
  { size: 'L', measurements: { bust: '36', waist: '30', hip: '39' } },
  { size: 'XL', measurements: { bust: '38', waist: '32', hip: '41' } },
  { size: 'XXL', measurements: { bust: '40', waist: '34', hip: '43' } },
  { size: '3XL', measurements: { bust: '42', waist: '36', hip: '45' } },
  { size: '4XL', measurements: { bust: '44', waist: '38', hip: '47' } },
  { size: '5XL', measurements: { bust: '46', waist: '40', hip: '49' } },
  { size: '6XL', measurements: { bust: '48', waist: '42', hip: '51' } },
];

export function ProductDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { wishlist, toggleWish, addToCart, cart, cartQty, setCartSize, showToast } = useShop();
  const { products: PRODUCTS, boutiques: BOUTIQUES, loading } = useCatalog();
  // Null until the buyer picks one, so the shown size can fall back to what the
  // bag already holds for this piece (see `selectedSize` below).
  const [pickedSize, setPickedSize] = useState<string | null>(null);
  const [showSizeChart, setShowSizeChart] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({ details: true });
  const togglePanel = (k: string) => setOpenPanels((p) => ({ ...p, [k]: !p[k] }));

  // Gallery: the main frame is a horizontal snap-scroller so the photo can be
  // swiped on touch; thumbnails and the arrows scroll it to the picked slide.
  const galleryRef = useRef<HTMLDivElement>(null);
  const [activeImg, setActiveImg] = useState(0);
  const reviewsRef = useRef<HTMLDivElement>(null);

  // "1 Review" in the summary opens the Ratings & reviews panel and scrolls it
  // into view, rather than leaving the buyer to hunt for it further down.
  const jumpToReviews = () => {
    setOpenPanels((p) => ({ ...p, ratings: true }));
    requestAnimationFrame(() => reviewsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  // Navigating straight from one product to another reuses this component, so
  // reset the gallery and the size choice instead of carrying the previous
  // product's slide and size over.
  useEffect(() => {
    setActiveImg(0);
    setPickedSize(null);
    setZoomOpen(false);
    galleryRef.current?.scrollTo({ left: 0 });
  }, [id]);

  // Tell the seller their piece was viewed. Fire-and-forget and throttled once
  // per session inside recordProductView, so a re-render never double-counts.
  useEffect(() => {
    if (id) void recordProductView(id);
  }, [id]);

  // Escape closes the size chart, like every other overlay in the app (the
  // photo viewer already handles its own).
  useEffect(() => {
    if (!showSizeChart) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowSizeChart(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showSizeChart]);

  /**
   * The photo viewer is a full-screen surface, but the floating nav dock and
   * the PDP's own sticky action bar are fixed siblings that kept drawing over
   * the photo — the viewer's zoom controls ended up sitting on top of "Add to
   * Bag". Mark the body while it is open and let CSS retire both, the same way
   * an open chat already does.
   */
  useEffect(() => {
    document.body.classList.toggle('agx-photo-open', zoomOpen);
    return () => document.body.classList.remove('agx-photo-open');
  }, [zoomOpen]);

  const goToImage = (i: number) => {
    const el = galleryRef.current;
    if (!el) return;
    setActiveImg(i);
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  };

  const onGalleryScroll = () => {
    const el = galleryRef.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    setActiveImg((prev) => (prev === i ? prev : i));
  };

  const ap = PRODUCTS.find((p) => p.id === id);

  // A shared product link used to preview as "MangaiMart" with no description;
  // now it carries the piece, its boutique and its photo.
  usePageMeta({
    title: ap ? `${ap.title} — ${ap.boutique}` : null,
    description: ap
      ? `${ap.title} from ${ap.boutique}, ${ap.city}. ${fmt(ap.price)}${ap.fabric ? ` · ${ap.fabric}` : ''}. Shop verified Tamil Nadu boutiques on MangaiMart.`
      : null,
    image: ap?.image ?? null,
  });

  if (!ap) {
    // A bare "Product not found." line was the only thing on screen here, with
    // no way onward. Match the empty state the policy and order screens use: say
    // what happened, and give the buyer somewhere to go.
    return (
      <div style={css('min-height:60vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 20px;')}>
        <div style={css('width:88px;height:88px;border-radius:26px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:44px;color:#D6336C;")}>
            {loading ? 'hourglass_top' : 'search_off'}
          </span>
        </div>
        <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;margin:20px 0 0;")}>
          {loading ? 'Loading this piece…' : 'This piece isn’t available'}
        </h1>
        {!loading && (
          <>
            <p style={css('color:var(--ag-muted);font-size:14px;margin:6px 0 0;max-width:380px;')}>
              It may have sold out or been taken down by the boutique. There is plenty more to see.
            </p>
            <div style={css('display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:22px;')}>
              <button onClick={() => navigate('/buyer/results')} style={css('height:50px;padding:0 26px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer;')}>Browse collections</button>
              <button onClick={() => navigate('/buyer/home')} style={css('height:50px;padding:0 26px;border:1.5px solid var(--ag-border);border-radius:14px;background:var(--ag-surface);color:var(--ag-crimson);font-weight:800;font-size:14.5px;cursor:pointer;')}>Back to home</button>
            </div>
          </>
        )}
      </div>
    );
  }
  // More from the same boutique/shop
  const sameBoutique = PRODUCTS.filter((p) => p.boutique === ap.boutique && p.id !== ap.id).slice(0, 12);
  const boutique = BOUTIQUES.find((x) => x.name === ap.boutique);
  // Always prefer the product's own foreign key. Matching a boutique by *name*
  // fails whenever two shops share a name or the name isn't in the loaded list,
  // and the old 'b1' fallback was a demo id that doesn't exist in the database —
  // opening a chat with it made conversation creation fail ("Could not start
  // chat"). The real boutique_id the product carries can't miss.
  const boutiqueId = ap.boutiqueId || boutique?.id || '';
  // Broad "you may also like" — same category surfaced first, up to 30 items
  const youMayLike = [...PRODUCTS.filter((p) => p.id !== ap.id)]
    .sort((a, b) => (b.cat === ap.cat ? 1 : 0) - (a.cat === ap.cat ? 1 : 0))
    .slice(0, 30);

  const stockLabel = ap.stock === 0 ? 'Out of stock' : ap.stock <= 5 ? `Low · ${ap.stock} left` : 'In stock';
  const stockFg = ap.stock === 0 ? '#D6455A' : ap.stock <= 5 ? '#C99A3F' : 'var(--ag-good)';

  const sizeOptions = sortSizes(ap.sizes?.length ? ap.sizes : FALLBACK_SIZES);
  const isSaree = ap.cat.trim().toLowerCase() === 'sarees';
  const sizeChart = isSaree ? BLOUSE_SIZE_CHART : BODY_SIZE_CHART;
  const sizeChartCols = isSaree
    ? (['bust', 'waist', 'shoulder', 'length'] as const)
    : (['bust', 'waist', 'hip'] as const);
  const sizeChartHeaders = isSaree ? ['Bust', 'Waist', 'Shoulder', 'Length'] : ['Bust', 'Waist', 'Hip'];
  // What the buyer picked, else the size this piece is already in the bag at,
  // else M when the boutique offers it — never a size that isn't on sale.
  const bagLine = cart[ap.id];
  // No default size — a buyer must pick one before the piece can be added to
  // the bag, rather than silently shipping in whatever the code guessed.
  const selectedSize =
    (pickedSize && sizeOptions.includes(pickedSize) ? pickedSize : null) ??
    (bagLine && sizeOptions.includes(bagLine.size) ? bagLine.size : null);
  const hasMrp = !!ap.mrp && ap.mrp > ap.price;
  const discountPct = hasMrp ? Math.round((1 - ap.price / (ap.mrp as number)) * 100) : null;
  const gallery = [...new Set([ap.image, ...(ap.images ?? [])].filter(Boolean))];
  if (!gallery.length) gallery.push(ap.image);
  const imgIndex = Math.min(activeImg, gallery.length - 1);

  // Only chips backed by what the seller actually entered — no invented
  // "Handcrafted" claim, and no fallback text standing in for a blank field.
  const highlights = [
    ...(ap.fabric ? [{ icon: 'diamond', label: ap.fabric }] : []),
    ...(ap.occasion ? [{ icon: 'event_available', label: `${ap.occasion} wear` }] : []),
  ];

  const specs = [
    { label: 'Fabric', value: ap.fabric || 'Premium fabric' },
    { label: 'Category', value: ap.cat },
    { label: 'Occasion', value: `${ap.occasion} wear` },
    { label: 'Colour', value: ap.color || '—' },
    { label: 'Wash care', value: ap.washCare || 'Dry clean only' },
    { label: 'Crafted in', value: ap.city },
    { label: 'SKU', value: ap.id.toUpperCase() },
  ];

  const thumbs = gallery.map((src, i) => ({
    id: `prod-${ap.id}-t${i}`,
    src,
    ring: i === imgIndex ? '2px #D6336C' : '1px var(--ag-border-soft)',
  }));

  const openBoutique = () => {
    if (!boutiqueId) return showToast('This boutique is unavailable right now', 'error');
    navigate(`/buyer/boutique/${boutiqueId}`);
  };
  const openChat = () => {
    if (!boutiqueId) return showToast('This boutique is unavailable right now', 'error');
    navigate(`/buyer/chat/${boutiqueId}`, {
      state: {
        product: { id: ap.id, title: ap.title, price: ap.price, image: ap.image, tone: ap.tone, cat: ap.cat },
      },
    });
  };
  // Shares the photo alongside the caption where the browser supports it, so
  // the piece arrives in WhatsApp looking like the piece — see `shareProduct`.
  const onShare = async () => {
    const result = await shareProduct({
      title: ap.title,
      price: fmt(ap.price),
      url: window.location.href,
      image: gallery[imgIndex] || ap.image,
      boutique: ap.boutique,
    });
    if (result === 'copied') showToast('Product details copied — paste to share');
    else if (result === 'failed') showToast("Couldn't share this product", 'error');
    // Count everything except an outright failure — a native share or a copy
    // both mean the buyer sent the piece on. Best-effort.
    if (result !== 'failed') void recordProductShare(ap.id);
  };

  // Once the piece is in the bag the "Add to Bag" button becomes a quantity
  // stepper, so a second tap adjusts the count instead of silently re-adding.
  const bagQty = bagLine?.qty ?? 0;
  const atStockCap = bagQty >= ap.stock;
  const soldOut = ap.stock === 0;

  // Changing the size while the piece is already in the bag has to follow it
  // through, or the bag would keep whichever size was picked at add time.
  const pickSize = (s: string) => {
    setPickedSize(s);
    if (bagQty > 0) setCartSize(ap.id, s);
  };

  // `idx > 0` means this entry has somewhere to go back to inside the app; a
  // cold deep link (a shared WhatsApp URL, a bookmark) starts at 0 and would
  // otherwise navigate out of the site entirely.
  const goBack = () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate('/buyer/home');
  };

  const onAddToBag = () => {
    if (soldOut) {
      showToast('This piece is out of stock', 'error');
      return;
    }
    if (!selectedSize) {
      showToast('Please select a size', 'error');
      return;
    }
    addToCart(ap.id, selectedSize);
  };

  const onIncrease = () => {
    if (atStockCap) {
      showToast(`Only ${ap.stock} left in stock`, 'error');
      return;
    }
    cartQty(ap.id, 1);
  };

  const renderBagControl = (height: number) => {
    // A sold-out piece used to keep a live crimson "Add to Bag" that silently
    // did nothing when tapped. Say so on the button itself instead — the buyer
    // can still chat to the boutique about a restock.
    if (soldOut) {
      return (
        <button
          disabled
          aria-disabled="true"
          style={css(`flex:1;min-width:160px;height:${height}px;border:1.5px solid var(--ag-border);border-radius:16px;background:var(--ag-surface-2);color:var(--ag-muted);font-weight:800;font-size:15px;cursor:not-allowed;display:flex;align-items:center;justify-content:center;gap:8px;`)}
        >
          <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>remove_shopping_cart</span>Out of stock
        </button>
      );
    }
    if (bagQty === 0) {
      return (
        <button onClick={onAddToBag} style={css(`flex:1;min-width:160px;height:${height}px;border:none;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 16px 34px -16px rgba(214,51,108,.85);`)}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>shopping_bag</span>Add to Bag
        </button>
      );
    }
    const step = height - 12;
    return (
      <div style={css(`flex:1;min-width:160px;height:${height}px;display:flex;align-items:center;gap:6px;padding:6px;border-radius:16px;background:linear-gradient(135deg,#D6336C,#B02454);box-shadow:0 16px 34px -16px rgba(214,51,108,.85);`)}>
        <button
          onClick={() => cartQty(ap.id, -1)}
          aria-label={bagQty === 1 ? 'Remove from bag' : 'Reduce quantity'}
          style={css(`width:${step}px;height:${step}px;flex:none;padding:0;border:none;border-radius:12px;background:rgba(255,255,255,.2);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;`)}
        >
          <span style={css("font-family:'Material Symbols Outlined';font-size:20px;color:#fff;")}>{bagQty === 1 ? 'delete' : 'remove'}</span>
        </button>
        <button
          onClick={() => navigate('/buyer/cart')}
          style={css('flex:1;min-width:0;height:100%;padding:0;border:none;background:none;color:#fff;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;')}
        >
          <span style={css('font-weight:800;font-size:15px;')}>{bagQty} in bag</span>
          <span className="agx-eyebrow" style={css('font-size:8.5px;color:rgba(255,255,255,.8);')}>View bag</span>
        </button>
        <button
          onClick={onIncrease}
          aria-label="Increase quantity"
          style={css(`width:${step}px;height:${step}px;flex:none;padding:0;border:none;border-radius:12px;background:rgba(255,255,255,.2);color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;opacity:${atStockCap ? '.45' : '1'};`)}
        >
          <span style={css("font-family:'Material Symbols Outlined';font-size:20px;color:#fff;")}>add</span>
        </button>
      </div>
    );
  };

  const renderPanel = (id: string, icon: string, title: string, meta: string, body: JSX.Element) => {
    const isOpen = !!openPanels[id];
    return (
      <div style={css('border:1px solid var(--ag-surface-3);border-radius:16px;overflow:hidden;background:var(--ag-surface);')}>
        <button onClick={() => togglePanel(id)} style={css('width:100%;display:flex;align-items:center;gap:12px;padding:16px 16px;border:none;background:none;cursor:pointer;text-align:left;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:20px;color:var(--ag-crimson);")}>{icon}</span>
          <span style={css('flex:1;font-weight:800;font-size:14.5px;color:var(--ag-ink);')}>{title}</span>
          {meta && <span style={css('font-size:12px;color:var(--ag-muted);font-weight:600;')}>{meta}</span>}
          <span style={css(`font-family:'Material Symbols Outlined';font-size:22px;color:var(--ag-crimson);transition:transform .2s;transform:rotate(${isOpen ? 180 : 0}deg);`)}>expand_more</span>
        </button>
        {isOpen && <div style={css('padding:0 16px 18px;')}>{body}</div>}
      </div>
    );
  };

  const renderCard = (p: (typeof PRODUCTS)[number]) => {
    return (
      <CardLink key={p.id} to={`/buyer/product/${p.id}`} label={p.title} className="agx-lift">
        <div className="agx-prod-media agx-zoom" style={css(`background:${TONES[p.tone]};`)}>
          <ImageSlot src={p.image} placeholder={p.title} className="agx-prod-fill" />
          {p.featured && (
            <div style={css('position:absolute;left:9px;top:9px;display:flex;align-items:center;gap:5px;background:linear-gradient(135deg,#D9B25A,#B0863B);color:#fff;padding:4px 9px;border-radius:999px;')}>
              <span className="agx-eyebrow" style={css('font-size:8px;letter-spacing:.14em;')}>Featured</span>
            </div>
          )}
          <WishButton
            wished={!!wishlist[p.id]}
            title={p.title}
            size={34}
            onToggle={(e) => { e.stopPropagation(); toggleWish(p.id); }}
            className="agx-card-wish"
          />
        </div>
        <div style={css('padding:10px 2px 0;')}>
          <div className="agx-card-title" style={css('font-size:14px;font-weight:700;')}>{p.title}</div>
          <div className="agx-card-sub" style={css('font-size:12px;color:var(--ag-muted);margin-top:2px;')}>{p.boutique}</div>
          <div style={css('display:flex;align-items:center;justify-content:space-between;margin-top:6px;')}>
            <span style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:18px;")}>{fmt(p.price)}</span>
            <span style={css('display:flex;align-items:center;gap:3px;font-size:12px;font-weight:700;color:var(--ag-ink-2);')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:14px;color:#E0B84B;")}>star</span>{p.rating}
            </span>
          </div>
        </div>
      </CardLink>
    );
  };

  return (
    <div className="agx-blend-root agx-pdp-root" style={css('width:100vw;margin-left:calc(50% - 50vw);min-height:100%;background:var(--ag-bg);')}>
      <div style={css('max-width:1300px;margin:0 auto;padding:14px clamp(16px,4vw,44px) 0;')}>
        <nav aria-label="Breadcrumb" style={css('display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ag-muted);')}>
          <Link to="/buyer/home" style={css('color:var(--ag-muted);')}>Home</Link><span aria-hidden="true">/</span>
          <Link to="/buyer/results" style={css('color:var(--ag-muted);')}>{ap.cat}</Link><span aria-hidden="true">/</span>
          <span aria-current="page" style={css('color:var(--ag-ink);font-weight:700;')}>{ap.title}</span>
        </nav>
      </div>

      <div className="agx-pdp" style={css('max-width:1300px;margin:0 auto;')}>
        <div className="agx-pdp-media" style={css('padding:clamp(16px,2.5vw,28px) 0 clamp(16px,2.5vw,28px) clamp(16px,4vw,44px);')}>
          <div style={css(`position:relative;aspect-ratio:4/5;max-height:78vh;background:${TONES[ap.tone]};overflow:hidden;border-radius:24px;box-shadow:0 24px 54px -34px rgba(107,20,54,.5);`)}>
            <div
              ref={galleryRef}
              onScroll={onGalleryScroll}
              className="agx-scroll"
              style={css('position:absolute;inset:0;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain;')}
            >
              {gallery.map((src, i) => (
                <div
                  key={`${ap.id}-g${i}`}
                  onClick={() => setZoomOpen(true)}
                  style={css('position:relative;flex:0 0 100%;width:100%;height:100%;scroll-snap-align:center;scroll-snap-stop:always;cursor:zoom-in;')}
                >
                  <ImageSlot src={src} placeholder={ap.title} alt={`${ap.title} — photo ${i + 1}`} style={css('position:absolute;inset:0;')} />
                </div>
              ))}
            </div>
            {/* Goes back where the buyer came from — a search, a boutique, a
                "See all" grid — instead of always dropping them on Home and
                losing their place. Home is only the fallback for a cold deep
                link with no history behind it. */}
            <button onClick={goBack} aria-label="Go back" title="Back" style={css('position:absolute;left:16px;top:16px;width:44px;height:44px;border-radius:14px;border:none;background:rgba(255,255,255,.92);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 26px -12px rgba(0,0,0,.4);')}>
              <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>arrow_back</span>
            </button>
            {/* No zoom button: the photo itself opens the viewer on tap, and
                `cursor:zoom-in` on the slide says so without extra chrome. */}
            <div style={css('position:absolute;right:16px;top:16px;display:flex;gap:10px;')}>
              <button
                onClick={onShare}
                aria-label={`Share ${ap.title}`}
                title="Share"
                style={css('width:44px;height:44px;border-radius:14px;border:none;background:rgba(255,255,255,.92);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 26px -12px rgba(0,0,0,.4);')}
              >
                <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>share</span>
              </button>
              <WishButton
                wished={!!wishlist[ap.id]}
                title={ap.title}
                size={44}
                onToggle={() => toggleWish(ap.id)}
              />
            </div>

            {gallery.length > 1 && (
              <>
                {imgIndex > 0 && (
                  <button aria-label="Previous photo" className="agx-gal-arrow" onClick={() => goToImage(imgIndex - 1)} style={css('position:absolute;left:14px;top:50%;transform:translateY(-50%);width:42px;height:42px;border-radius:50%;border:none;background:rgba(255,255,255,.94);cursor:pointer;align-items:center;justify-content:center;box-shadow:0 10px 26px -12px rgba(0,0,0,.45);')}>
                    <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>chevron_left</span>
                  </button>
                )}
                {imgIndex < gallery.length - 1 && (
                  <button aria-label="Next photo" className="agx-gal-arrow" onClick={() => goToImage(imgIndex + 1)} style={css('position:absolute;right:14px;top:50%;transform:translateY(-50%);width:42px;height:42px;border-radius:50%;border:none;background:rgba(255,255,255,.94);cursor:pointer;align-items:center;justify-content:center;box-shadow:0 10px 26px -12px rgba(0,0,0,.45);')}>
                    <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>chevron_right</span>
                  </button>
                )}
                <div style={css('position:absolute;left:50%;bottom:16px;transform:translateX(-50%);display:flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;background:rgba(36,16,25,.42);backdrop-filter:blur(6px);')}>
                  {gallery.map((_, i) => (
                    <button
                      key={`${ap.id}-d${i}`}
                      aria-label={`Go to photo ${i + 1}`}
                      onClick={() => goToImage(i)}
                      style={css(`width:${i === imgIndex ? 18 : 7}px;height:7px;padding:0;border:none;border-radius:999px;cursor:pointer;background:${i === imgIndex ? '#fff' : 'rgba(255,255,255,.5)'};transition:width .25s ease,background .25s ease;`)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
          {thumbs.length > 1 && (
            <div className="agx-scroll" style={css('display:flex;gap:10px;margin-top:14px;overflow-x:auto;padding-bottom:2px;')}>
              {thumbs.map((t, i) => (
                <button
                  key={t.id}
                  onClick={() => goToImage(i)}
                  aria-label={`Show photo ${i + 1}`}
                  style={css(`width:64px;height:64px;flex:none;padding:0;border:none;border-radius:12px;overflow:hidden;background:${TONES[ap.tone]};box-shadow:0 0 0 ${t.ring};cursor:pointer;position:relative;opacity:${i === imgIndex ? 1 : 0.72};transition:opacity .2s ease,box-shadow .2s ease;`)}
                >
                  <ImageSlot src={t.src} style={css('position:absolute;inset:0;')} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={css('padding:clamp(20px,3vw,40px) clamp(16px,4vw,44px);display:flex;flex-direction:column;')}>
          <div className="agx-eyebrow" style={css('font-size:11px;color:var(--ag-crimson);')}>{ap.cat} · {ap.occasion}</div>
          <h1 style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(30px,3.2vw,46px);line-height:1.06;letter-spacing:-.015em;margin:10px 0 0;padding-bottom:2px;")}>{ap.title}</h1>
          <div style={css('display:flex;align-items:center;gap:14px;margin-top:12px;flex-wrap:wrap;')}>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;color:var(--ag-crimson);font-size:clamp(26px,2.8vw,38px);")}>{fmt(ap.price)}</div>
            {hasMrp && (
              <>
                <span style={css('text-decoration:line-through;color:var(--ag-muted-soft);font-size:16px;font-weight:700;')}>{fmt(ap.mrp as number)}</span>
                <span style={css('background:var(--ag-good-bg);color:var(--ag-good);font-size:11px;font-weight:800;padding:5px 9px;border-radius:8px;')}>{discountPct}% off</span>
              </>
            )}
            <button
              onClick={jumpToReviews}
              style={css('display:flex;align-items:center;gap:5px;font-size:13px;font-weight:700;color:var(--ag-ink-2);background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:10px;padding:6px 10px;cursor:pointer;')}
            >
              <span style={css("font-family:'Material Symbols Outlined';font-size:16px;color:#E0B84B;")}>star</span>{ap.rating} <span style={css('color:var(--ag-muted);font-weight:500;')}>· {reviewsF(ap.reviews)} {ap.reviews === 1 ? 'review' : 'reviews'}</span>
            </button>
            <span style={css(`font-size:12.5px;font-weight:800;color:${stockFg};`)}>{stockLabel}</span>
          </div>

          <div style={css('display:flex;flex-wrap:wrap;gap:9px;margin-top:20px;')}>
            {highlights.map((h) => (
              <span key={h.label} style={css('display:flex;align-items:center;gap:7px;background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:12px;padding:9px 13px;font-size:12.5px;font-weight:700;color:var(--ag-ink-2);')}>
                <span style={css("font-family:'Material Symbols Outlined';font-size:17px;color:var(--ag-crimson);")}>{h.icon}</span>{h.label}
              </span>
            ))}
          </div>

          <div onClick={openBoutique} className="agx-lift" style={css('display:flex;align-items:center;gap:11px;margin-top:20px;padding:13px 15px;background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:16px;cursor:pointer;')}>
            <BoutiqueLogo name={ap.boutique} src={boutique?.logo} size={42} radius={12} />
            <div style={css('flex:1;')}>
              <div style={css('display:flex;align-items:center;gap:5px;')}>
                <span style={css('font-weight:700;font-size:14.5px;')}>{ap.boutique}</span>
                <span style={css("font-family:'Material Symbols Outlined';font-size:16px;color:#3A8DD6;")}>verified</span>
              </div>
              <div style={css('color:var(--ag-muted);font-size:12.5px;')}>{ap.city} · ★ {ap.rating}</div>
            </div>
            <span style={css("font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;letter-spacing:.12em;color:var(--ag-crimson);")}>VISIT →</span>
          </div>

          <div style={css('display:flex;align-items:flex-start;gap:36px;margin-top:24px;flex-wrap:wrap;')}>
            <div>
              <div style={css('display:flex;align-items:center;justify-content:space-between;gap:14px;')}>
                <span id="agx-size-label" className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-muted);')}>Size{selectedSize ? ` · ${selectedSize}` : ' · Select a size'}</span>
                <button type="button" onClick={() => setShowSizeChart(true)} style={css('display:flex;align-items:center;gap:4px;font-size:11px;font-weight:700;color:var(--ag-crimson);border:none;background:none;padding:0;cursor:pointer;')}>
                  <span style={css("font-family:'Material Symbols Outlined';font-size:14px;")}>straighten</span>Size guide
                </button>
              </div>
              {/* Real buttons in a radiogroup, not styled spans: the chips were
                  unreachable by keyboard and announced as plain text, so a
                  buyer who can't use a pointer could never choose a size — and
                  a size is required before the piece can be bagged. */}
              <div role="radiogroup" aria-labelledby="agx-size-label" style={css('display:flex;gap:8px;margin-top:9px;flex-wrap:wrap;')}>
                {sizeOptions.map((s) => {
                  const on = selectedSize === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={`Size ${s}`}
                      onClick={() => pickSize(s)}
                      style={css(`width:44px;height:44px;padding:0;border-radius:12px;border:1.5px solid ${on ? '#D6336C' : 'var(--ag-border)'};background:${on ? 'var(--ag-surface-2)' : 'transparent'};color:${on ? 'var(--ag-crimson)' : 'var(--ag-ink-2)'};display:flex;align-items:center;justify-content:center;font-weight:${on ? 800 : 700};font-size:14px;cursor:pointer;font-family:inherit;`)}
                    >{s}</button>
                  );
                })}
              </div>
            </div>
            {ap.color && (
              <div>
                <div className="agx-eyebrow" style={css('font-size:10px;color:var(--ag-muted);')}>Colour</div>
                <div style={css('display:flex;align-items:center;height:44px;margin-top:9px;padding:0 16px;border-radius:12px;border:1.5px solid var(--ag-border);background:var(--ag-bg);font-weight:700;font-size:14px;color:var(--ag-ink-2);')}>{ap.color}</div>
              </div>
            )}
          </div>

          <div className="agx-pdp-actions" style={css('display:flex;gap:12px;margin-top:26px;flex-wrap:wrap;')}>
            <button onClick={openChat} style={css('flex:1;min-width:160px;height:56px;border:1.5px solid #D6336C;background:var(--ag-surface);color:var(--ag-crimson);border-radius:16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:21px;")}>chat</span>Chat
            </button>
            {renderBagControl(56)}
          </div>

          {/* ACCORDION PANELS */}
          <div style={css('display:flex;flex-direction:column;gap:10px;margin-top:24px;')}>
            {renderPanel('details', 'description', 'Product details', '', (
              <>
                <div style={css('color:var(--ag-ink-2);font-size:14.5px;line-height:1.65;')}>
                  {ap.description || `${ap.fabric} · ${ap.occasion} wear. Handcrafted with intricate zari work and tailored for a graceful drape.`}
                </div>
                <div style={css('margin-top:12px;border:1px solid var(--ag-surface-3);border-radius:14px;overflow:hidden;')}>
                  {specs.map((s, i) => (
                    <div key={s.label} style={css(`display:flex;align-items:center;gap:12px;padding:11px 14px;font-size:13.5px;background:${i % 2 === 0 ? 'var(--ag-bg)' : 'var(--ag-surface)'};`)}>
                      <span style={css('flex:none;width:104px;color:var(--ag-muted);font-weight:600;')}>{s.label}</span>
                      <span style={css('flex:1;color:var(--ag-ink);font-weight:700;')}>{s.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ))}

            {renderPanel('delivery', 'local_shipping', 'Delivery & returns', '', (
              <>
                <div style={css('display:grid;grid-template-columns:repeat(3,1fr);gap:10px;')}>
                  <div style={css('text-align:center;padding:14px 8px;background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:14px;')}>
                    <span style={css("font-family:'Material Symbols Outlined';font-size:22px;color:var(--ag-crimson);")}>local_shipping</span>
                    <div style={css('font-size:11.5px;font-weight:700;color:var(--ag-ink-2);margin-top:6px;line-height:1.3;')}>
                      {/* The platform's delivery rule, which is what the buyer
                          is charged. This used to print the seller's private
                          `delivery_charge` — a figure the checkout total never
                          used, so the two contradicted each other. */}
                      {boutique?.deliveryAvailable === false
                        ? 'Store pickup only'
                        : `${fmt(SHIP_FEE)} delivery · free over ${fmt(FREE_SHIP_MIN)}`}
                    </div>
                  </div>
                  <div style={css('text-align:center;padding:14px 8px;background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:14px;')}>
                    <span style={css("font-family:'Material Symbols Outlined';font-size:22px;color:var(--ag-crimson);")}>verified_user</span>
                    <div style={css('font-size:11.5px;font-weight:700;color:var(--ag-ink-2);margin-top:6px;line-height:1.3;')}>{boutique?.verified ? 'Verified boutique' : 'Independent boutique'}</div>
                  </div>
                  <div style={css('text-align:center;padding:14px 8px;background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:14px;')}>
                    <span style={css("font-family:'Material Symbols Outlined';font-size:22px;color:var(--ag-crimson);")}>autorenew</span>
                    <div style={css('font-size:11.5px;font-weight:700;color:var(--ag-ink-2);margin-top:6px;line-height:1.3;')}>{POLICY_TERMS.returnWindowDays}-day easy returns</div>
                  </div>
                </div>
                {/* The seller's own coverage area, in their words — not every
                    boutique delivers everywhere, and this is the only place
                    that says so before checkout. */}
                {boutique?.deliveryAvailable !== false && boutique?.deliveryAreas && (
                  <div style={css('display:flex;gap:8px;margin-top:10px;padding:11px 13px;background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:12px;')}>
                    <span style={css("font-family:'Material Symbols Outlined';font-size:17px;color:var(--ag-crimson);flex:none;")}>near_me</span>
                    <div style={css('font-size:12px;color:var(--ag-ink-2);line-height:1.5;')}>
                      <span style={css('font-weight:700;')}>Delivers to:</span> {boutique.deliveryAreas}
                    </div>
                  </div>
                )}
              </>
            ))}

            {/* Ratings and reviews are one thing to the buyer — the score, the
                spread, then the reviews themselves — so they share one panel. */}
            <div ref={reviewsRef}>
              {renderPanel('ratings', 'star', 'Ratings & reviews', `${ap.rating} ★ · ${reviewsF(ap.reviews)}`, (
                <ProductReviews productId={ap.id} boutiqueId={boutiqueId} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* MORE FROM THIS BOUTIQUE */}
      {sameBoutique.length > 0 && (
        <div style={css('max-width:1300px;margin:0 auto;padding:clamp(20px,3vw,36px) clamp(16px,4vw,44px) 0;')}>
          <div style={css('display:flex;align-items:center;gap:12px;flex-wrap:wrap;')}>
            <BoutiqueLogo name={ap.boutique} src={boutique?.logo} size={44} radius={13} />
            <div style={css('flex:1;min-width:0;')}>
              <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>From the same shop</div>
              <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(22px,2.6vw,32px);line-height:1.08;margin-top:2px;")}>More from {ap.boutique}</div>
            </div>
            <a href="#" onClick={(e) => { e.preventDefault(); openBoutique(); }} style={css('display:flex;align-items:center;gap:5px;font-size:11px;font-weight:800;color:var(--ag-crimson);border:1.5px solid var(--ag-border);border-radius:999px;padding:9px 15px;')}>
              Visit shop<span style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>arrow_forward</span>
            </a>
          </div>
          <div className="agx-pgrid" style={css('gap:clamp(12px,1.8vw,20px);margin-top:20px;')}>
            {sameBoutique.map((p) => renderCard(p))}
          </div>
        </div>
      )}

      {/* YOU MAY ALSO LIKE */}
      <div style={css('max-width:1300px;margin:0 auto;padding:clamp(24px,4vw,44px) clamp(16px,4vw,44px) clamp(28px,4vw,56px);')}>
        <div>
          <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Complete the look</div>
          <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:clamp(26px,3vw,38px);line-height:1.06;margin-top:6px;")}>You may also like</div>
          <div style={css('color:var(--ag-muted);font-size:13px;margin-top:6px;')}>
            {youMayLike.length} more {youMayLike.length === 1 ? 'piece' : 'pieces'} to explore — tap the heart to save any for later.
          </div>
        </div>
        <div className="agx-pgrid" style={css('gap:clamp(12px,1.8vw,20px);margin-top:22px;')}>
          {youMayLike.map((p) => renderCard(p))}
        </div>
      </div>

      {/* STICKY MOBILE ACTION BAR */}
      <div className="agx-pdp-sticky">
        <button onClick={openChat} style={css('flex:none;width:128px;height:52px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-crimson);border-radius:16px;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;')}>
          <span style={css("font-family:'Material Symbols Outlined';font-size:20px;")}>chat</span>Chat
        </button>
        {renderBagControl(52)}
      </div>

      {/* FULL-SCREEN PHOTO VIEWER */}
      {zoomOpen && (
        <ImageZoom
          images={gallery}
          index={imgIndex}
          title={ap.title}
          onIndexChange={goToImage}
          onClose={() => setZoomOpen(false)}
        />
      )}

      {/* SIZE CHART MODAL */}
      {showSizeChart && (
        <div onClick={() => setShowSizeChart(false)} style={css('position:fixed;inset:0;z-index:1000;background:rgba(36,16,25,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:20px;')}>
          <div onClick={(e) => e.stopPropagation()} style={css('width:100%;max-width:520px;max-height:88vh;overflow-y:auto;background:var(--ag-surface);border-radius:22px;box-shadow:0 30px 70px -30px rgba(107,20,54,.6);padding:24px clamp(18px,3vw,28px);')}>
            <div style={css('display:flex;align-items:flex-start;justify-content:space-between;gap:14px;')}>
              <div>
                <div className="agx-eyebrow" style={css('font-size:10.5px;color:var(--ag-crimson);')}>Fit guide</div>
                <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:24px;line-height:1.1;margin-top:4px;")}>Size chart</div>
                <div style={css('color:var(--ag-muted);font-size:12.5px;margin-top:4px;')}>{isSaree ? 'Blouse measurements in inches' : 'Body measurements in inches'}</div>
              </div>
              <button onClick={() => setShowSizeChart(false)} style={css('width:38px;height:38px;flex:none;border-radius:11px;border:none;background:var(--ag-bg);cursor:pointer;display:flex;align-items:center;justify-content:center;')}>
                <span style={css("font-family:'Material Symbols Outlined';color:var(--ag-crimson);")}>close</span>
              </button>
            </div>

            <div style={css('margin-top:18px;border:1px solid var(--ag-surface-3);border-radius:16px;overflow:hidden;')}>
              <table style={css('width:100%;border-collapse:collapse;font-size:13px;')}>
                <thead>
                  <tr style={css('background:var(--ag-bg);')}>
                    {['Size', ...sizeChartHeaders].map((h) => (
                      <th key={h} style={css('text-align:left;padding:11px 12px;font-size:10.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--ag-muted);')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sizeChart.map((r) => {
                    const on = r.size === selectedSize;
                    return (
                      <tr key={r.size} onClick={() => { pickSize(r.size); setShowSizeChart(false); }} style={css(`cursor:pointer;border-top:1px solid var(--ag-surface-3);background:${on ? 'var(--ag-surface-2)' : 'var(--ag-surface)'};`)}>
                        <td style={css(`padding:12px;font-weight:800;color:${on ? 'var(--ag-crimson)' : 'var(--ag-ink)'};`)}>{r.size}</td>
                        {sizeChartCols.map((c) => (
                          <td key={c} style={css('padding:12px;color:var(--ag-ink-2);')}>{r.measurements[c]}"</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={css('display:flex;gap:10px;margin-top:16px;padding:14px;background:var(--ag-bg);border:1px solid var(--ag-surface-3);border-radius:14px;')}>
              <span style={css("font-family:'Material Symbols Outlined';font-size:20px;color:var(--ag-crimson);")}>info</span>
              <div style={css('color:var(--ag-ink-2);font-size:12.5px;line-height:1.5;')}>
                Measure around the fullest part of your bust and natural waistline. If you fall between two sizes, we recommend sizing up. Need a custom fit? <a href="#" onClick={(e) => { e.preventDefault(); setShowSizeChart(false); openChat(); }} style={css('color:var(--ag-crimson);font-weight:700;')}>Chat with the boutique</a>.
              </div>
            </div>

            <button onClick={() => setShowSizeChart(false)} style={css('width:100%;margin-top:16px;height:50px;border:none;border-radius:14px;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:14.5px;cursor:pointer;')}>
              {selectedSize ? `Done · ${selectedSize}` : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
