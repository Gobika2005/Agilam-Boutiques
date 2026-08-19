/**
 * The shape every console's global search speaks in.
 *
 * Buyer, seller and admin search completely different things — a saree, an
 * order, a payout — but they all present the same way: grouped rows with a
 * title, a subtitle, an optional trailing value and somewhere to go. Keeping
 * that contract in one place is what lets a single search box and a single
 * results page serve all three.
 */

/** Drives which avatar a row draws — a photo, a shop logo, an initial, a glyph. */
export type SearchKind = 'row' | 'product' | 'boutique' | 'person' | 'page';

export type SearchHit = {
  /** Unique inside its group; `${group}:${id}` is the React key. */
  id: string;
  group: string;
  kind: SearchKind;
  title: string;
  sub: string;
  /** Right-aligned trailing text — a price, an amount, a status. */
  right?: string;
  /** Material Symbols glyph, used when the row has no image. */
  icon?: string;
  image?: string | null;
  logo?: string | null;
  tone?: number;
  /** Where picking this row navigates to. */
  to: string;
};

export type SearchGroup = {
  key: string;
  label: string;
  icon: string;
  hits: SearchHit[];
  /** True when the source returned exactly `limit` rows, so there are likely more. */
  more: boolean;
};

export type SearchRunArgs<C> = {
  term: string;
  limit: number;
  signal: AbortSignal;
  ctx: C;
};

export type SearchSource<C> = {
  key: string;
  /** Group heading on the results page. */
  label: string;
  icon: string;
  /**
   * Skipped entirely when this returns false — e.g. the seller sources before
   * `useMyBoutique` has resolved, which would otherwise query with a null id.
   */
  enabled?: (ctx: C) => boolean;
  run: (args: SearchRunArgs<C>) => Promise<SearchHit[]>;
};

export type SearchOutcome = {
  /** The term these results are for. Compare before rendering: an in-flight
   *  request can land after the box has been retyped. */
  term: string;
  groups: SearchGroup[];
  total: number;
  /**
   * Sources that failed rather than returned nothing — an unapplied migration,
   * a revoked column grant. Surfaced so "no results" never quietly means
   * "half the console is unreachable".
   */
  degraded: string[];
};
