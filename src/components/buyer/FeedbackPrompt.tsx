/**
 * The pop-up that asks about a delivered order on the buyer's next visit.
 *
 * Mounted app-wide from BuyerLayout, so it catches buyers who never reopen the
 * order screen — which is most of them. Deliberately restrained:
 *
 *   • Only ever for an order the courier/seller marked delivered, and only for
 *     a signed-in buyer whose order actually exists in the database.
 *   • One order at a time, most recent first. Never a queue.
 *   • Dismissing writes `review_dismissed_at`, so it does not come back — on
 *     this device or any other.
 *   • Held back briefly after load. Appearing during the first paint reads as
 *     an ad; letting the page settle first reads as a question.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useBuyerOrders } from '@/hooks/useBuyerOrders';
import { useOrderFeedback } from '@/hooks/useOrderFeedback';
import { OrderFeedbackSheet } from './OrderFeedbackSheet';

/**
 * Routes where interrupting would be actively unhelpful.
 *
 * `/chat` is here because a conversation is a live exchange with a person, and
 * a modal about last week's order is the wrong thing to put in front of someone
 * mid-sentence. It also caused a bug worth remembering: this sheet is
 * `position:fixed; inset:0; z-index:70` and the chat surface is `z-index:40`, so
 * the backdrop covered the composer completely. It reads as "the chat has no
 * message bar" — and because tapping the backdrop dismisses the sheet, tapping
 * where the bar should be made it appear, which made the whole thing look like
 * an intermittent rendering fault.
 */
const NEVER_ON = ['/checkout', '/payment', '/cart', '/order-confirmation', '/auth', '/chat'];

export function FeedbackPrompt() {
  const { pathname } = useLocation();
  const { orders } = useBuyerOrders();
  const { nextToAsk, reviewedProductIds, suppress, reload } = useOrderFeedback(orders);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSettled(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const blocked = NEVER_ON.some((p) => pathname.startsWith(p));
  if (!settled || blocked || !nextToAsk) return null;

  return (
    <OrderFeedbackSheet
      order={nextToAsk}
      alreadyReviewed={reviewedProductIds}
      onClose={(submitted) => {
        suppress(nextToAsk.rowId ?? '');
        if (submitted) reload();
      }}
    />
  );
}
