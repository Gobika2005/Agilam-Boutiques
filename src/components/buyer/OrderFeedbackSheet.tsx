/**
 * "How was your order?" — the ask that never existed.
 *
 * Reviews have worked since migration 0014, but the only way to leave one was
 * to navigate back to the product page, so almost nobody did. This is the
 * prompt, shown once an order is actually delivered.
 *
 * Two things, in one pass:
 *
 *   1. **The items.** The buyer picks whichever they want to rate — nothing is
 *      compulsory, and anything already reviewed shows as done rather than
 *      asking twice. Rating the item is also what rates the boutique: 0014's
 *      trigger recomputes `boutiques.rating` from these, which is why there is
 *      no separate "rate the shop" step.
 *   2. **MangaiMart.** Private (migration 0071) — it goes to the operator, is
 *      never published, and no seller can read it.
 *
 * Closing without submitting records a dismissal, so the other three prompt
 * surfaces stop asking too.
 */
import { useMemo, useState } from 'react';
import { css } from '@/lib/css';
import { useAuth } from '@/auth/AuthContext';
import { useShop } from '@/state/ShopContext';
import { useCatalog } from '@/state/CatalogContext';
import { ImageSlot } from '@/components/ui/ImageSlot';
import { TONES } from '@/data/demo';
import { submitReview } from '@/data/reviews';
import { dismissOrderReview, submitPlatformFeedback } from '@/data/feedback';
import type { PlacedOrder } from '@/lib/orderHistory';

function Stars({
  value,
  onChange,
  size = 30,
}: {
  value: number;
  onChange: (v: number) => void;
  size?: number;
}) {
  return (
    <div style={css('display:flex;gap:4px;')} role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange(n)}
          style={css('border:none;background:none;padding:0;cursor:pointer;line-height:1;')}
        >
          <span
            aria-hidden="true"
            style={css(`font-family:'Material Symbols Outlined';font-size:${size}px;color:${n <= value ? '#E8A33D' : 'var(--ag-muted-soft)'};${n <= value ? "font-variation-settings:'FILL' 1;" : ''}`)}
          >
            star
          </span>
        </button>
      ))}
    </div>
  );
}

export function OrderFeedbackSheet({
  order,
  alreadyReviewed,
  onClose,
}: {
  order: PlacedOrder;
  /** Product ids this buyer has already reviewed — shown as done, not re-asked. */
  alreadyReviewed: Set<string>;
  /** `submitted` is false when the buyer simply dismissed the sheet. */
  onClose: (submitted: boolean) => void;
}) {
  const { session, profile } = useAuth();
  const { showToast } = useShop();
  const { productById } = useCatalog();
  const buyerId = session?.user?.id ?? '';

  // One entry per distinct product — an order can list the same product twice
  // in different sizes, and nobody wants to rate the same saree twice.
  const items = useMemo(() => {
    const seen = new Set<string>();
    return order.items.filter((it) => {
      if (!it.pid || seen.has(it.pid)) return false;
      seen.add(it.pid);
      return true;
    });
  }, [order.items]);

  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [platformRating, setPlatformRating] = useState(0);
  const [platformBody, setPlatformBody] = useState('');
  const [busy, setBusy] = useState(false);

  const rated = Object.entries(ratings).filter(([, v]) => v > 0);
  const canSubmit = (rated.length > 0 || platformRating > 0) && !busy;

  const close = async (submitted: boolean) => {
    if (!submitted) await dismissOrderReview(order.rowId ?? '');
    onClose(submitted);
  };

  const submit = async () => {
    if (!buyerId) {
      showToast('Please sign in to leave a review');
      return;
    }
    setBusy(true);
    try {
      // Product reviews first: they are the public, load-bearing half, and the
      // one the boutique's rating depends on.
      for (const [pid, rating] of rated) {
        const result = await submitReview({
          productId: pid,
          boutiqueId: order.boutiqueId,
          buyerId,
          rating,
          body: bodies[pid] ?? '',
          authorName: profile?.full_name ?? null,
        });
        if (!result.ok) throw new Error(result.error);
      }

      if (platformRating > 0 && order.rowId) {
        await submitPlatformFeedback({
          buyerId,
          orderId: order.rowId,
          rating: platformRating,
          body: platformBody,
        });
      }

      showToast('Thank you — that really helps');
      onClose(true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not save your feedback');
    } finally {
      setBusy(false);
    }
  };

  const field =
    'width:100%;border-radius:12px;border:1.5px solid var(--ag-border);background:var(--ag-bg);color:var(--ag-ink);padding:10px 12px;font-size:13.5px;font-family:inherit;box-sizing:border-box;resize:vertical;';

  return (
    <div
      style={css('position:fixed;inset:0;z-index:70;background:rgba(20,8,14,.5);display:flex;align-items:flex-end;justify-content:center;')}
      onClick={() => void close(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={css('width:100%;max-width:560px;background:var(--ag-surface);border-radius:22px 22px 0 0;padding:20px 20px 24px;box-shadow:0 -14px 44px -20px rgba(107,20,54,.6);max-height:90vh;overflow-y:auto;')}
      >
        <div style={css('display:flex;align-items:flex-start;justify-content:space-between;gap:12px;')}>
          <div>
            <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;line-height:1.15;")}>
              How was your order?
            </div>
            <div style={css('font-size:12.5px;color:var(--ag-muted);margin-top:4px;line-height:1.5;')}>
              {order.boutique} · {order.id}
            </div>
          </div>
          <button
            onClick={() => void close(false)}
            aria-label="Close"
            style={css('width:36px;height:36px;flex:none;border-radius:11px;border:none;background:var(--ag-surface-2);cursor:pointer;display:flex;align-items:center;justify-content:center;')}
          >
            <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:20px;color:var(--ag-muted);")}>close</span>
          </button>
        </div>

        {/* ---------- The items ---------- */}
        <div style={css('font-size:11.5px;font-weight:800;color:var(--ag-muted);letter-spacing:.05em;margin-top:20px;')}>
          RATE WHAT YOU BOUGHT
        </div>
        <div style={css('font-size:12px;color:var(--ag-muted);margin-top:4px;line-height:1.5;')}>
          Rate as many or as few as you like — your rating is also what gives {order.boutique} its score.
        </div>

        {items.map((it) => {
          const done = alreadyReviewed.has(it.pid);
          const value = ratings[it.pid] ?? 0;
          return (
            <div key={it.pid} style={css('margin-top:14px;padding:13px;border-radius:16px;background:var(--ag-surface-2);border:1px solid var(--ag-border);')}>
              <div style={css('display:flex;gap:11px;align-items:center;')}>
                <ImageSlot
                  src={productById(it.pid)?.image}
                  placeholder={it.title}
                  alt={it.title}
                  style={css(`width:48px;height:48px;flex:none;border-radius:12px;background:${TONES[it.tone % 8]};`)}
                />
                <div style={css('flex:1;min-width:0;')}>
                  <div style={css('font-weight:700;font-size:13.5px;line-height:1.35;')}>{it.title}</div>
                  {it.size && <div style={css('font-size:12px;color:var(--ag-muted);')}>Size {it.size}</div>}
                </div>
                {done && (
                  <span style={css('display:flex;align-items:center;gap:4px;font-size:11.5px;font-weight:800;color:var(--ag-good);flex:none;')}>
                    <span aria-hidden="true" style={css("font-family:'Material Symbols Outlined';font-size:16px;")}>task_alt</span>
                    Rated
                  </span>
                )}
              </div>

              {/* Already-reviewed items still allow a change — 0014 upserts on
                  (product_id, buyer_id) — but they don't demand attention. */}
              <div style={css('margin-top:10px;')}>
                <Stars value={value} onChange={(v) => setRatings((s) => ({ ...s, [it.pid]: v }))} size={26} />
              </div>
              {value > 0 && (
                <textarea
                  rows={2}
                  value={bodies[it.pid] ?? ''}
                  onChange={(e) => setBodies((s) => ({ ...s, [it.pid]: e.target.value }))}
                  placeholder="What did you think? (optional)"
                  style={css(field + 'margin-top:9px;')}
                />
              )}
            </div>
          );
        })}

        {/* ---------- The platform ---------- */}
        <div style={css('margin-top:22px;padding:15px;border-radius:16px;border:1.5px solid var(--ag-gold-border);background:var(--ag-gold-bg);')}>
          <div style={css('font-size:11.5px;font-weight:800;color:var(--ag-gold-text);letter-spacing:.05em;')}>
            AND HOW WAS MANGAIMART?
          </div>
          <div style={css('font-size:12px;color:var(--ag-gold-text);margin-top:4px;line-height:1.5;opacity:.9;')}>
            Just for us — this stays private and isn’t shown to the boutique or anyone else.
          </div>
          <div style={css('margin-top:11px;')}>
            <Stars value={platformRating} onChange={setPlatformRating} size={28} />
          </div>
          {platformRating > 0 && (
            <textarea
              rows={3}
              value={platformBody}
              onChange={(e) => setPlatformBody(e.target.value)}
              placeholder="Anything we could do better?"
              style={css(field + 'margin-top:10px;')}
            />
          )}
        </div>

        <div style={css('display:flex;gap:10px;margin-top:20px;')}>
          <button
            onClick={() => void close(false)}
            style={css('flex:1;height:50px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);border-radius:14px;font-weight:800;cursor:pointer;font-family:inherit;')}
          >
            Not now
          </button>
          <button
            disabled={!canSubmit}
            onClick={submit}
            style={css(`flex:1.5;height:50px;border:none;border-radius:14px;background:${canSubmit ? 'linear-gradient(135deg,#D6336C,#B02454)' : 'var(--ag-surface-2)'};color:${canSubmit ? '#fff' : 'var(--ag-muted)'};font-weight:800;cursor:${canSubmit ? 'pointer' : 'default'};font-family:inherit;`)}
          >
            {busy ? 'Sending…' : 'Send feedback'}
          </button>
        </div>
      </div>
    </div>
  );
}
