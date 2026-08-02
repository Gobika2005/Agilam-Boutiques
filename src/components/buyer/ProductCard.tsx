import { Icon } from '@/components/ui/Icon';
import { WishButton } from '@/components/buyer/WishButton';
import { imageFallback, imageSrcSet } from '@/lib/imageUrl';
import { fmtInr, toneHex } from '@/lib/tokens';
import type { ProductWithBoutique } from '@/data/types';

type Props = {
  product: ProductWithBoutique;
  onOpen: () => void;
  wished?: boolean;
  onToggleWish?: (e: React.MouseEvent) => void;
  showRating?: boolean;
  showBoutique?: boolean;
  width?: number;
};

/**
 * Tailwind-flavoured product card. The catalogue surfaces use the `css()`
 * variants inline; this shares their 3:4 crop (`.agx-prod-media`) and the
 * shared heart so the two can't drift apart.
 */
export function ProductCard({ product: p, onOpen, wished, onToggleWish, showRating, showBoutique, width }: Props) {
  return (
    <div onClick={onOpen} className="cursor-pointer" style={width ? { flex: 'none', width } : undefined}>
      <div className="agx-prod-media shadow-soft" style={{ background: toneHex(p.tone) }}>
        {p.image_url ? (
          <img
            src={imageFallback(p.image_url)}
            srcSet={imageSrcSet(p.image_url)}
            sizes={width ? `${width}px` : '(min-width: 768px) 320px, 50vw'}
            alt={p.title}
            width={800}
            height={1000}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs font-semibold text-black/40">{p.title}</div>
        )}
        {onToggleWish && (
          <WishButton wished={!!wished} title={p.title} onToggle={onToggleWish} className="agx-card-wish" />
        )}
      </div>
      <div className="pt-2">
        <div className="agx-card-title text-[13.5px] font-bold">{p.title}</div>
        {showBoutique && <div className="agx-card-sub mt-0.5 text-xs text-rose-muted">{p.boutique?.name}</div>}
        <div className="mt-1 flex items-center justify-between">
          <span className="text-[15px] font-extrabold text-rose-primaryDark">{fmtInr(p.price)}</span>
          {showRating && (
            <span className="flex items-center gap-0.5 text-[11.5px] font-bold text-rose-label">
              <Icon name="star" className="text-sm" style={{ color: 'var(--ag-star)' }} />
              {p.rating}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
