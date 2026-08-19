/**
 * How MangaiMart decides what is "new", what "sells best", and which boutiques lead.
 *
 * These rails are the shop window. Whatever they show is what most buyers will
 * ever see of the catalogue, and what every seller will compare themselves
 * against — so the rules have to be defensible in one sentence each, and they
 * have to be the *same* rules on Home and on the See-all pages. That is why the
 * scoring lives here rather than inline in the screens.
 *
 * Three principles run through all of it:
 *
 *  1. Rate, not total. A piece listed last week that sold 8 is doing better
 *     than one listed two years ago that sold 30. Totals rank the oldest
 *     listing first, forever, and a new seller can never break in.
 *  2. Confidence, not averages. One 5★ review is not better than two hundred
 *     4.6★ reviews; ratings are pulled toward the catalogue mean until they
 *     have earned their number (`bayesianRating`).
 *  3. Diminishing returns. Every count goes through log1p before it is
 *     normalised, so the one runaway product in the catalogue lifts itself
 *     without flattening everything below it into a rounding error.
 *
 * Nothing here is paid placement: `featured` and any ad slot are deliberately
 * absent from every formula. Ads are sold as ads and are labelled as ads.
 */

import type { Product, Boutique } from '@/data/demo';

// ── Tunables ────────────────────────────────────────────────────────────────

/**
 * Reviews a product needs before its own rating is trusted outright. Below it,
 * the rating is blended with the catalogue average — see `bayesianRating`.
 * Boutiques use a higher bar because a shop accumulates reviews far faster than
 * any single piece.
 */
export const RATING_CONFIDENCE_PRODUCT = 10;
export const RATING_CONFIDENCE_BOUTIQUE = 20;

/** Fallback mean used while the catalogue is too small to have one of its own. */
const ASSUMED_MEAN_RATING = 4.3;

/** A listing counts as a "new arrival" for this long. */
export const NEW_ARRIVAL_DAYS = 30;

/**
 * …but a quiet month must not leave the rail empty. If fewer than this many
 * pieces were listed inside the window, the newest are topped up regardless of
 * age — an empty "New arrivals" reads as a broken shop, not as an honest one.
 */
export const NEW_ARRIVAL_MIN = 12;

/**
 * A brand-new listing has no sales history, so a pure velocity score would rank
 * it first on a technicality (0 sold ÷ 0 days). Velocity is measured over at
 * least this many days.
 */
const MIN_DAYS_FOR_VELOCITY = 7;

/**
 * Sold-out pieces are demoted rather than hidden. Hiding them makes a popular
 * boutique look thin and loses the "this is in demand" signal; leaving them at
 * full weight sends buyers to a dead end. They keep 40% of their score and
 * carry a Sold out badge.
 */
const OUT_OF_STOCK_FACTOR = 0.4;

/**
 * Unverified boutiques rank slightly below equals. "Best-selling" is a
 * recommendation, and recommending a shop that has not completed verification
 * is a risk the buyer did not ask to take. It is a nudge, not a ban — a genuinely
 * top-selling unverified shop still appears.
 */
const UNVERIFIED_FACTOR = 0.92;

// ── Primitives ──────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Whole days since `iso`; 0 when the date is missing or in the future. */
export function daysSince(iso?: string): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / DAY_MS);
}

/**
 * Compresses a count to 0…1 against the largest in the set, on a log scale.
 * Linear normalisation would let a single 900-unit product push every 40-unit
 * product to ~0.04, which is not how a shopper perceives the difference.
 */
function normLog(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.log1p(Math.max(0, value)) / Math.log1p(max);
}

/** Mean rating across everything that has at least one review. */
export function meanRating(items: { rating: number; reviews: number }[]): number {
  const rated = items.filter((i) => i.reviews > 0 && i.rating > 0);
  if (rated.length === 0) return ASSUMED_MEAN_RATING;
  return rated.reduce((s, i) => s + i.rating, 0) / rated.length;
}

/**
 * IMDb-style Bayesian rating.
 *
 *     weighted = (v / (v + m)) · R  +  (m / (v + m)) · C
 *
 * R = this item's rating, v = its review count, C = the catalogue mean,
 * m = the confidence threshold. With one review the score is almost entirely
 * the catalogue mean; by 10× m it is almost entirely the item's own rating.
 * This is what stops a single five-star review from topping the rail.
 */
export function bayesianRating(rating: number, reviews: number, mean: number, m = RATING_CONFIDENCE_PRODUCT): number {
  const v = Math.max(0, reviews);
  if (v + m === 0) return mean;
  return (v / (v + m)) * rating + (m / (v + m)) * mean;
}

/** Rating on a 0…1 scale (1★ = 0, 5★ = 1), for mixing with the other terms. */
const ratingUnit = (r: number) => Math.min(1, Math.max(0, (r - 1) / 4));

/** Recency on a 0…1 scale — halves roughly every 90 days, never reaches 0. */
const freshnessUnit = (days: number) => 1 / (1 + days / 90);

// ── Best sellers ────────────────────────────────────────────────────────────

export type ScoredProduct = {
  product: Product;
  score: number;
  /** Units sold per day since listing — what the badge on the card shows. */
  velocity: number;
  parts: { sales: number; rating: number; reviews: number; freshness: number };
};

/**
 * Best sellers.
 *
 *     score = 0.55·sales + 0.25·rating + 0.15·reviews + 0.05·freshness
 *             (× 0.4 if out of stock)
 *
 *   sales     — units/day since listing, log-normalised against the fastest
 *               mover in the catalogue. Rate, not total, so a piece listed on
 *               Monday can out-rank one listed last year.
 *   rating    — Bayesian rating, so quality is weighed by confidence.
 *   reviews   — log-normalised review count: proof that real buyers, plural,
 *               have been through it.
 *   freshness — a light thumb on the scale so an evergreen best seller does not
 *               own the top slot forever and newer stock gets a turn.
 *
 * Before migration 0023 is applied `soldCount` is 0 everywhere, the sales term
 * is 0 for every product, and the ranking degrades cleanly into
 * "best-reviewed, best-rated, recent" — the same order as before, never an
 * empty rail.
 */
export function scoreProducts(products: Product[]): ScoredProduct[] {
  const mean = meanRating(products);

  const rows = products.map((p) => {
    const days = Math.max(MIN_DAYS_FOR_VELOCITY, daysSince(p.createdAt));
    return { product: p, velocity: (p.soldCount ?? 0) / days };
  });

  const maxVelocity = Math.max(0, ...rows.map((r) => r.velocity));
  const maxReviews = Math.max(0, ...products.map((p) => p.reviews));

  return rows
    .map(({ product: p, velocity }) => {
      const parts = {
        sales: normLog(velocity * 100, maxVelocity * 100),
        rating: ratingUnit(bayesianRating(p.rating, p.reviews, mean, RATING_CONFIDENCE_PRODUCT)),
        reviews: normLog(p.reviews, maxReviews),
        freshness: freshnessUnit(daysSince(p.createdAt)),
      };
      const raw =
        0.55 * parts.sales + 0.25 * parts.rating + 0.15 * parts.reviews + 0.05 * parts.freshness;
      const score = p.stock === 0 ? raw * OUT_OF_STOCK_FACTOR : raw;
      return { product: p, score, velocity, parts };
    })
    .sort((a, b) => b.score - a.score);
}

/** Just the products, best first. */
export const bestSellers = (products: Product[]): Product[] =>
  scoreProducts(products).map((r) => r.product);

// ── New arrivals ────────────────────────────────────────────────────────────

/**
 * New arrivals — strictly newest first, no quality weighting.
 *
 * This rail answers one question ("what's landed since I last looked?"), and
 * mixing a popularity signal into it would quietly turn it into a second best
 * sellers rail. The only judgement applied is the top-up: if the last
 * NEW_ARRIVAL_DAYS produced fewer than NEW_ARRIVAL_MIN pieces, the newest are
 * carried in past the window so the rail is never a near-empty row.
 */
export function newArrivals(products: Product[]): Product[] {
  const byNewest = [...products].sort((a, b) => daysSince(a.createdAt) - daysSince(b.createdAt));
  const inWindow = byNewest.filter((p) => daysSince(p.createdAt) <= NEW_ARRIVAL_DAYS);
  return inWindow.length >= NEW_ARRIVAL_MIN ? inWindow : byNewest.slice(0, NEW_ARRIVAL_MIN);
}

/** Whether this piece earns the "New" badge — inside the window, full stop. */
export const isNewArrival = (p: Product): boolean =>
  !!p.createdAt && daysSince(p.createdAt) <= NEW_ARRIVAL_DAYS;

// ── The Inspire feed ────────────────────────────────────────────────────────

/**
 * The minimum a piece has to carry to be ranked into the feed. Deliberately the
 * raw database row rather than the `Product` shape: the feed reads `products`
 * directly (see src/data/feed.ts) and never goes through the catalogue adapter.
 *
 * The three counters are optional because they arrive with migrations
 * 0020/0023/0031 — on a deployment missing one, the term is simply 0 for
 * everybody and the ranking degrades into "recent, with a shuffle".
 */
export type FeedCandidate = {
  id: string;
  boutique_id: string;
  created_at: string;
  likes_count?: number | null;
  views_count?: number | null;
  sold_count?: number | null;
};

/** Weights for `rankFeed`, named so the tuning is legible in one place. */
const FEED_WEIGHTS = { freshness: 0.32, likes: 0.22, views: 0.15, orders: 0.16, jitter: 0.15 };

/**
 * A stable pseudo-random 0…1 for one piece under one seed.
 *
 * Stable is the whole point: the shuffle has to survive the buyer scrolling.
 * `Math.random()` per render would re-deal the feed on every re-render, and a
 * card would move out from under a thumb mid-tap. Hashing (seed, id) instead
 * means the same visit always scores the same piece the same way, while a new
 * visit — a new seed — deals a different feed. FNV-1a, which is plenty for
 * shuffling a shop window.
 */
function jitterFor(id: string, seed: number): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h / 0x100000000;
}

/**
 * The Inspire feed's order.
 *
 *     score = 0.32·freshness + 0.22·likes + 0.15·views + 0.16·orders + 0.15·jitter
 *
 *   freshness — halves roughly every 90 days. The feed is a shop window, and a
 *               piece listed this week is the reason to open it.
 *   likes     — the feed's own signal: the heart on the card.
 *   views     — what buyers opened, which moves long before anything sells.
 *   orders    — what they actually bought. Weighted above views on purpose.
 *   jitter    — a stable per-visit random term, heavy enough to visibly reorder
 *               pieces of similar standing and light enough that a genuinely
 *               popular piece still leads. It is what stops the feed being the
 *               same six cards in the same order every day, and what gives a
 *               boutique that listed nothing this week a way onto the screen.
 *
 * All three counters are log-normalised against the best in the batch, so one
 * runaway piece lifts itself without flattening everything below it (the same
 * rule the rest of this file follows).
 *
 * The ranking is applied per fetched batch rather than to the whole catalogue —
 * the client only ever holds a window of it. In practice the first batch is the
 * entire catalogue at today's size; as it grows, the effect is that a much older
 * piece cannot leapfrog into the first screen on likes alone, which is the
 * behaviour a feed wants anyway.
 */
export function rankFeed<T extends FeedCandidate>(
  items: T[],
  seed: number,
  /** Boutique that ended the previous batch, so the spread survives paging. */
  after?: string,
): T[] {
  const maxLikes = Math.max(0, ...items.map((p) => p.likes_count ?? 0));
  const maxViews = Math.max(0, ...items.map((p) => p.views_count ?? 0));
  const maxSold = Math.max(0, ...items.map((p) => p.sold_count ?? 0));

  const scored = items
    .map((p) => ({
      item: p,
      score:
        FEED_WEIGHTS.freshness * freshnessUnit(daysSince(p.created_at)) +
        FEED_WEIGHTS.likes * normLog(p.likes_count ?? 0, maxLikes) +
        FEED_WEIGHTS.views * normLog(p.views_count ?? 0, maxViews) +
        FEED_WEIGHTS.orders * normLog(p.sold_count ?? 0, maxSold) +
        FEED_WEIGHTS.jitter * jitterFor(p.id, seed),
    }))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.item);

  return spreadByBoutique(scored, after);
}

/**
 * Pull the same shop's pieces apart.
 *
 * Score order alone gives runs of one boutique — a shop that listed six pieces
 * on Tuesday holds six adjacent slots, and the feed reads as though the
 * marketplace has one shop in it. This walks the scored list and takes the
 * best-scoring piece whose boutique is not the one just emitted, falling back to
 * the plain next piece once only one shop has anything left (better a run at the
 * bottom than dropping pieces to avoid one).
 *
 * Order within a boutique is never changed — only how far apart its pieces sit.
 */
function spreadByBoutique<T extends { boutique_id: string }>(sorted: T[], after?: string): T[] {
  const pool = [...sorted];
  const out: T[] = [];
  let last = after;
  while (pool.length) {
    const i = pool.findIndex((p) => p.boutique_id !== last);
    const [next] = pool.splice(i === -1 ? 0 : i, 1);
    out.push(next);
    last = next.boutique_id;
  }
  return out;
}

// ── Best-selling boutiques ──────────────────────────────────────────────────

export type ScoredBoutique = {
  boutique: Boutique;
  score: number;
  parts: { sales: number; rating: number; orders: number; audience: number; depth: number };
};

/**
 * Best-selling boutiques.
 *
 *     score = ( 0.40·sales + 0.20·rating + 0.15·orders
 *             + 0.15·audience + 0.10·depth ) × (verified ? 1 : 0.92)
 *
 *   sales    — units sold per month active. Again a rate: a shop that opened in
 *              March is compared fairly against one trading since 2014.
 *   rating   — Bayesian, with a higher confidence threshold than products.
 *   orders   — distinct fulfilled orders, log-normalised. Separated from units
 *              on purpose: 60 orders of one piece is a broader business than
 *              one order of 60, and this is the term that tells them apart.
 *   audience — followers, log-normalised. The buyers who came back.
 *   depth    — how many styles are actually listed. A shop with three pieces
 *              may be selling all of them and still is not what a buyer means
 *              by "best-selling boutique".
 *
 * Same graceful degradation as products: with migration 0023 unapplied the
 * sales and orders terms are 0 for everyone and the list falls back to
 * rating + audience + depth.
 */
export function scoreBoutiques(boutiques: Boutique[]): ScoredBoutique[] {
  const mean = meanRating(boutiques);

  const rows = boutiques.map((b) => {
    // At least one month, so a shop approved yesterday is not dividing by ~0.
    const months = Math.max(1, daysSince(b.createdAt) / 30);
    return { boutique: b, rate: (b.unitsSold ?? 0) / months };
  });

  const maxRate = Math.max(0, ...rows.map((r) => r.rate));
  const maxOrders = Math.max(0, ...boutiques.map((b) => b.ordersCount ?? 0));
  const maxFollowers = Math.max(0, ...boutiques.map((b) => b.followers));
  const maxProducts = Math.max(0, ...boutiques.map((b) => b.products));

  return rows
    .map(({ boutique: b, rate }) => {
      const parts = {
        sales: normLog(rate * 10, maxRate * 10),
        rating: ratingUnit(bayesianRating(b.rating, b.reviews, mean, RATING_CONFIDENCE_BOUTIQUE)),
        orders: normLog(b.ordersCount ?? 0, maxOrders),
        audience: normLog(b.followers, maxFollowers),
        depth: normLog(b.products, maxProducts),
      };
      const raw =
        0.40 * parts.sales + 0.20 * parts.rating + 0.15 * parts.orders +
        0.15 * parts.audience + 0.10 * parts.depth;
      return { boutique: b, score: b.verified ? raw : raw * UNVERIFIED_FACTOR, parts };
    })
    .sort((a, b) => b.score - a.score);
}

/** Just the boutiques, best first. */
export const bestSellingBoutiques = (boutiques: Boutique[]): Boutique[] =>
  scoreBoutiques(boutiques).map((r) => r.boutique);

// ── Presentation helpers ────────────────────────────────────────────────────

/** 2100 → "2.1k". Used wherever a count is shown on a card. */
export function compactCount(n: number): string {
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

/**
 * The honest, human line under a best seller — never invented. Returns null
 * when there is genuinely nothing to claim, and the card shows nothing rather
 * than filler.
 */
export function salesProof(p: Product): string | null {
  const sold = p.soldCount ?? 0;
  if (sold >= 10) return `${compactCount(sold)} sold`;
  if (p.reviews >= 5) return `${compactCount(p.reviews)} reviews`;
  if (sold > 0) return `${sold} sold`;
  return null;
}
