import { useEffect, useState } from 'react';
import { PINCODE_RE, lookupPincode, type PincodeArea } from '@/lib/pincode';

export type PincodeStatus =
  | { kind: 'idle' }
  | { kind: 'typing' }
  | { kind: 'checking' }
  | { kind: 'found'; area: PincodeArea }
  | { kind: 'unknown' };

/**
 * Resolves a pincode to its places, district and state as the seller types.
 *
 * Debounced by 400ms, and nothing is requested until six digits are actually
 * there — a half-typed pincode is `typing`, not `unknown`, so the field never
 * flashes "we couldn't find that" at someone mid-number.
 *
 * `unknown` is a normal outcome, not a failure to recover from: it covers both
 * a pincode India Post has no record of and a lookup that could not run at all.
 * Either way the seller keeps typing the district themselves, which is exactly
 * what they did before this existed.
 */
export function usePincodeLookup(pincode: string): PincodeStatus {
  const [status, setStatus] = useState<PincodeStatus>({ kind: 'idle' });

  useEffect(() => {
    const pin = (pincode ?? '').trim();
    if (!pin) {
      setStatus({ kind: 'idle' });
      return;
    }
    if (!PINCODE_RE.test(pin)) {
      setStatus({ kind: 'typing' });
      return;
    }

    let live = true;
    setStatus({ kind: 'checking' });
    const t = setTimeout(() => {
      void lookupPincode(pin).then((area) => {
        if (!live) return;
        setStatus(area ? { kind: 'found', area } : { kind: 'unknown' });
      });
    }, 400);

    return () => { live = false; clearTimeout(t); };
  }, [pincode]);

  return status;
}
