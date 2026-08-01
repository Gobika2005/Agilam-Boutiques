import { useEffect, useRef, useState } from 'react';
import { IFSC_RE, lookupIfsc, type IfscResult } from '@/lib/ifsc';

export type IfscStatus =
  | { kind: 'idle' }
  | { kind: 'typing' }
  | { kind: 'checking' }
  | { kind: 'valid'; bank: string; branch: string; city: string }
  | { kind: 'invalid' }
  | { kind: 'unavailable' };

/**
 * Resolves an IFSC to its bank/branch as the seller types.
 *
 * Debounced by 450ms and aborted on every keystroke, so typing an 11-character
 * code issues one request rather than eleven. Nothing is requested until the
 * code is the right SHAPE — a half-typed code is `typing`, not `invalid`, so the
 * field doesn't flash an error at someone mid-word.
 */
export function useIfscLookup(code: string): IfscStatus {
  const [status, setStatus] = useState<IfscStatus>({ kind: 'idle' });
  const abort = useRef<AbortController>();

  useEffect(() => {
    const trimmed = code.trim().toUpperCase();

    abort.current?.abort();

    if (!trimmed) {
      setStatus({ kind: 'idle' });
      return;
    }
    if (!IFSC_RE.test(trimmed)) {
      // Still being typed — say nothing yet. Submit-time validation is what
      // reports a genuinely malformed code.
      setStatus({ kind: 'typing' });
      return;
    }

    setStatus({ kind: 'checking' });
    const controller = new AbortController();
    abort.current = controller;

    const t = setTimeout(() => {
      lookupIfsc(trimmed, controller.signal).then((r: IfscResult) => {
        if (controller.signal.aborted) return;
        if (r.state === 'valid') setStatus({ kind: 'valid', bank: r.bank, branch: r.branch, city: r.city });
        else if (r.state === 'invalid') setStatus({ kind: 'invalid' });
        else setStatus({ kind: 'unavailable' });
      });
    }, 450);

    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [code]);

  return status;
}
