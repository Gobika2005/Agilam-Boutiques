import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebounced } from './useDebounced';
import { runSearch } from '@/lib/search/engine';
import { MIN_TERM } from '@/lib/search/query';
import type { SearchHit, SearchOutcome, SearchSource } from '@/lib/search/types';

const EMPTY: SearchOutcome = { term: '', groups: [], total: 0, degraded: [] };

/**
 * Drive a console's search sources from a text box.
 *
 * The three things this exists to get right:
 *
 *  - **One request in flight.** Every new term aborts the previous controller,
 *    so a fast typist does not leave eight queries racing on the server.
 *  - **No stale render.** A response is dropped unless its term still matches
 *    what the box asked for, because responses do not come back in order.
 *  - **No flicker.** The previous results stay on screen while the next term
 *    loads, so the dropdown does not empty and refill on every keystroke.
 */
export function useGlobalSearch<C>({
  sources,
  ctx,
  term,
  limit = 5,
  delay = 180,
}: {
  sources: SearchSource<C>[];
  ctx: C;
  term: string;
  limit?: number;
  delay?: number;
}) {
  const debounced = useDebounced(term, delay);
  const [outcome, setOutcome] = useState<SearchOutcome>(EMPTY);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef<AbortController | null>(null);

  // `ctx` is an object literal at every call site, so it is a new reference on
  // every render. Its contents are a couple of ids — cheap to compare by value,
  // and the alternative is asking every caller to remember a `useMemo`.
  const ctxKey = JSON.stringify(ctx ?? null);

  useEffect(() => {
    const t = debounced.trim();
    inFlight.current?.abort();

    if (t.length < MIN_TERM) {
      inFlight.current = null;
      setLoading(false);
      setOutcome(EMPTY);
      return;
    }

    const controller = new AbortController();
    inFlight.current = controller;
    setLoading(true);

    runSearch(sources, t, { limit, signal: controller.signal, ctx })
      .then((result) => {
        if (controller.signal.aborted) return;
        setOutcome(result);
      })
      .catch(() => {
        // `runSearch` already absorbs per-source failures; anything reaching
        // here is the abort itself.
        if (!controller.signal.aborted) setOutcome({ ...EMPTY, term: t });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, ctxKey, limit, sources]);

  // Abort whatever is open when the box unmounts (sheet closed, route changed).
  useEffect(() => () => inFlight.current?.abort(), []);

  /** Every hit in display order — what the arrow keys walk. */
  const flat = useMemo<SearchHit[]>(() => outcome.groups.flatMap((g) => g.hits), [outcome]);

  const trimmed = term.trim();
  return {
    outcome,
    flat,
    loading,
    /** True once the term is long enough to have produced these results. */
    active: trimmed.length >= MIN_TERM,
    /** True when the results on screen are for an older term than what is typed. */
    stale: trimmed.length >= MIN_TERM && outcome.term !== trimmed,
  };
}
