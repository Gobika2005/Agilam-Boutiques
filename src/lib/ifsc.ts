/**
 * IFSC lookup — turns a typed IFSC code into the real bank and branch behind it.
 *
 * A regex can only prove an IFSC is well-SHAPED (`HDFC0001234`). It cannot catch
 * the mistake that actually loses money: a valid-looking code for the wrong
 * branch, or a transposed character. Since MangaiMart now pays sellers by bank
 * transfer only, and payouts are made MANUALLY by an admin reading these
 * details, a wrong IFSC is not caught by anything downstream — it is discovered
 * when a real transfer bounces or lands somewhere else.
 *
 * So the wizard shows the seller what their code resolves to ("HDFC Bank ·
 * T NAGAR, CHENNAI") while they type. A human immediately recognises their own
 * branch, or immediately sees that it is wrong.
 *
 * Backed by Razorpay's public IFSC directory (razorpay.com/ifsc): no API key, no
 * authentication, no money movement, CORS-enabled for browser use. It is a
 * read-only reference dataset.
 *
 * Failure policy — deliberately asymmetric:
 *   • a 404 is a DEFINITIVE "no such branch" and blocks submission;
 *   • a network/DNS/5xx failure resolves to `unavailable` and does NOT block,
 *     because a seller must never be locked out of onboarding by someone else's
 *     outage. Format validation still applies in that case.
 */

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export type IfscResult =
  | { state: 'valid'; bank: string; branch: string; city: string }
  | { state: 'invalid' }
  | { state: 'unavailable' };

/** Resolved lookups, keyed by uppercased IFSC. Branch data is effectively
 *  static, so one lookup per code per session is plenty. */
const cache = new Map<string, IfscResult>();

export async function lookupIfsc(rawCode: string, signal?: AbortSignal): Promise<IfscResult> {
  const code = rawCode.trim().toUpperCase();
  if (!IFSC_RE.test(code)) return { state: 'invalid' };

  const cached = cache.get(code);
  if (cached) return cached;

  let result: IfscResult;
  try {
    const res = await fetch(`https://ifsc.razorpay.com/${encodeURIComponent(code)}`, { signal });
    if (res.status === 404) {
      result = { state: 'invalid' };
    } else if (!res.ok) {
      // 5xx / rate limit — the code may well be fine, we just can't confirm it.
      return { state: 'unavailable' };
    } else {
      const data = await res.json();
      result = {
        state: 'valid',
        bank: String(data?.BANK ?? '').trim(),
        branch: String(data?.BRANCH ?? '').trim(),
        city: String(data?.CITY ?? '').trim(),
      };
    }
  } catch {
    // Aborted, offline, blocked, DNS failure — never treated as "invalid".
    return { state: 'unavailable' };
  }

  // Only definitive answers are cached; `unavailable` must stay retryable.
  cache.set(code, result);
  return result;
}
