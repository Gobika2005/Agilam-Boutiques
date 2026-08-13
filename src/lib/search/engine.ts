import { MIN_TERM, warnSourceOnce } from './query';
import type { SearchGroup, SearchOutcome, SearchSource } from './types';

const EMPTY: SearchOutcome = { term: '', groups: [], total: 0, degraded: [] };

/**
 * Run every source for a console in parallel and collect the groups.
 *
 * Three rules make this safe to call on every keystroke:
 *
 *  1. **One source cannot break the search.** Each is caught on its own. An
 *     unapplied migration or a revoked column grant costs that group only, and
 *     the source is named in `degraded` so the UI can say so out loud.
 *  2. **Aborted runs are silent.** The caller aborts the previous controller
 *     before starting the next, so the tail of every keystroke lands here as a
 *     rejection; those are dropped without a warning and without a result.
 *  3. **The term travels with the result.** Responses come back out of order,
 *     so the caller compares `outcome.term` against what is in the box before
 *     rendering rather than trusting arrival order.
 */
export async function runSearch<C>(
  sources: SearchSource<C>[],
  term: string,
  { limit, signal, ctx }: { limit: number; signal: AbortSignal; ctx: C },
): Promise<SearchOutcome> {
  const t = term.trim();
  if (t.length < MIN_TERM) return { ...EMPTY, term: t };

  const active = sources.filter((s) => !s.enabled || s.enabled(ctx));

  const settled = await Promise.all(
    active.map(async (source) => {
      try {
        const hits = await source.run({ term: t, limit, signal, ctx });
        return { source, hits, failed: false };
      } catch (error) {
        // An abort is the expected end of a superseded keystroke, not a fault.
        if (!signal.aborted) warnSourceOnce(source.key, error);
        return { source, hits: [], failed: !signal.aborted };
      }
    }),
  );

  const groups: SearchGroup[] = [];
  const degraded: string[] = [];
  let total = 0;

  for (const { source, hits, failed } of settled) {
    if (failed) degraded.push(source.label);
    if (hits.length === 0) continue;
    groups.push({
      key: source.key,
      label: source.label,
      icon: source.icon,
      hits: hits.slice(0, limit),
      more: hits.length >= limit,
    });
    total += Math.min(hits.length, limit);
  }

  // Sources are declared in the order the console wants them read, and
  // `Promise.all` preserves that order, so the grouping above is already right.
  return { term: t, groups, total, degraded };
}
