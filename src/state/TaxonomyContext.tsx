import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAsync } from '@/hooks/useAsync';
import { fetchTaxonomy, type TaxonomyKind, type TaxonomyRow } from '@/data/taxonomy';
import { COLORS, OCCASIONS, SIZES } from '@/data/demo';
import { colorFromName } from '@/lib/colorName';

/**
 * The catalogue vocabulary, loaded once for the whole app.
 *
 * Buyer filters, the collection tiles and the seller's product form all read
 * from here, so there is exactly one answer to "what categories exist" and it
 * is the admin's. Approved terms only — a seller's pending request is visible
 * to that seller through `myRequests`, never through the browsing lists.
 *
 * If the table is missing (migration 0024 unapplied) or the fetch fails, the
 * design's hardcoded lists stand in. That is not a nicety: without a fallback,
 * an unapplied migration would leave the buyer app with no filters at all and
 * the seller unable to pick a category.
 */

const FALLBACK: Record<TaxonomyKind, string[]> = {
  category: ['Sarees', 'Lehengas', 'Gowns', 'Kurtis', 'Bridal'],
  occasion: [...OCCASIONS],
  fabric: ['Kanchipuram Silk', 'Silk', 'Cotton', 'Georgette', 'Organza', 'Velvet', 'Net'],
  color: COLORS.map((c) => c.name),
  // The product form has always offered "Free Size" alongside the S–XL ladder.
  size: [...SIZES, 'Free Size'],
};

export type TaxonomyValue = {
  /** Approved names for a vocabulary, in the admin's order. */
  names: (kind: TaxonomyKind) => string[];
  /** Approved rows, when the caller needs the swatch or glyph too. */
  rows: (kind: TaxonomyKind) => TaxonomyRow[];
  /** Swatch hex for a colour name, falling back to a neutral rose. */
  hexOf: (name: string) => string;
  /** Material Symbols glyph for a category/occasion name. */
  iconOf: (kind: TaxonomyKind, name: string) => string | undefined;
  /** Whether a name is an approved, browsable term. */
  isApproved: (kind: TaxonomyKind, name: string) => boolean;
  /** This seller's own requests — pending and rejected included. */
  myRequests: TaxonomyRow[];
  loading: boolean;
  /** True when the vocabulary came from the fallback, not the database. */
  degraded: boolean;
  reload: () => void;
};

const TaxonomyContext = createContext<TaxonomyValue | null>(null);

const key = (kind: TaxonomyKind, name: string) => `${kind}:${name.trim().toLowerCase().replace(/\s+/g, ' ')}`;

export function TaxonomyProvider({ children }: { children: ReactNode }) {
  // Categories, occasions and fabrics only move when an admin approves a
  // seller's request, so a long leash keeps the vocabulary current without
  // polling for a list that changes a few times a week.
  const { data, loading, error, reload } = useAsync(() => fetchTaxonomy(), [], { staleMs: 600_000 });

  const value = useMemo<TaxonomyValue>(() => {
    const all = data ?? [];
    const degraded = !!error || (!loading && all.length === 0);

    const approved = all.filter((r) => r.status === 'approved');
    const byKind = new Map<TaxonomyKind, TaxonomyRow[]>();
    approved.forEach((r) => {
      const list = byKind.get(r.kind);
      if (list) list.push(r);
      else byKind.set(r.kind, [r]);
    });

    const approvedKeys = new Set(approved.map((r) => key(r.kind, r.name)));
    const hexByName = new Map(approved.filter((r) => r.hex).map((r) => [r.name.toLowerCase(), r.hex as string]));
    const iconByKey = new Map(approved.filter((r) => r.icon).map((r) => [key(r.kind, r.name), r.icon as string]));

    /**
     * Never empty. A screen asking for the colour swatches has to render
     * something, and "no filters at all" is a worse failure than "the design's
     * original filters" — so an unapplied migration or a failed fetch falls
     * back to the hardcoded lists rather than to a blank sheet.
     */
    const rows = (kind: TaxonomyKind): TaxonomyRow[] => {
      const live = byKind.get(kind);
      if (live && live.length > 0) return live;
      return FALLBACK[kind].map((name, i) => ({
        id: `fallback:${kind}:${name}`,
        kind,
        name,
        name_key: name.toLowerCase(),
        status: 'approved' as const,
        hex: COLORS.find((c) => c.name === name)?.hex ?? null,
        icon: null,
        image_url: null,
        sort_order: i * 10,
        requested_by: null,
        boutique_id: null,
        note: null,
        review_note: null,
        reviewed_at: null,
        created_at: '',
      }));
    };
    const names = (kind: TaxonomyKind) => rows(kind).map((r) => r.name);

    return {
      names,
      rows,
      // Priority: the admin's own swatch → the seed palette → a hue read from
      // the colour's name ("Olive Brown…" → olive) → mauve, only when the name
      // says nothing. This keeps un-swatched colours from all sharing one tone.
      hexOf: (name) =>
        hexByName.get(name.toLowerCase()) ??
        COLORS.find((c) => c.name.toLowerCase() === name.toLowerCase())?.hex ??
        colorFromName(name) ??
        '#C9A9B6',
      iconOf: (kind, name) => iconByKey.get(key(kind, name)),
      // With no vocabulary loaded for this kind, nothing would be browsable —
      // so a degraded fetch treats every term as approved rather than hiding
      // the catalogue behind a table that isn't there.
      isApproved: (kind, name) =>
        !byKind.get(kind)?.length ? true : approvedKeys.has(key(kind, name)),
      myRequests: all.filter((r) => r.status !== 'approved'),
      loading,
      degraded,
      reload,
    };
  }, [data, loading, error, reload]);

  return <TaxonomyContext.Provider value={value}>{children}</TaxonomyContext.Provider>;
}

export function useTaxonomy() {
  const ctx = useContext(TaxonomyContext);
  if (!ctx) throw new Error('useTaxonomy must be used within a TaxonomyProvider');
  return ctx;
}
