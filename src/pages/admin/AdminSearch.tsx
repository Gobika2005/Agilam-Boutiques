import { SearchResultsView } from '@/components/search/SearchResultsView';
import { ADMIN_SOURCES, type AdminCtx } from '@/lib/search/adminSources';

const CTX: AdminCtx = {};

/**
 * `/admin/search?q=…` — everything the console can find for one term.
 *
 * The header field is the fast path; this is where "See all results" lands, and
 * it is the surface an operator can link someone to.
 */
export function AdminSearch() {
  return (
    <SearchResultsView
      sources={ADMIN_SOURCES}
      ctx={CTX}
      emptyHint="Search the whole console — an order number or a Razorpay payment id, a customer's name, email or phone, a boutique, a product, a coupon code, a payout, an expense. You can also type a page name to jump straight to it."
    />
  );
}
