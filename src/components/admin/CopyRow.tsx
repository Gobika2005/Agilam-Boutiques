import { useEffect, useState } from 'react';
import { css } from '@/lib/css';
import { T } from './kit';

/**
 * A payout detail with a one-tap copy button.
 *
 * Payouts are made by hand: an admin reads these values out of this drawer and
 * into their bank's transfer form. Re-typing a 12-digit account number is the
 * single most likely way for real money to reach the wrong person, and it is a
 * mistake nothing downstream can catch — so every value that has to be
 * transcribed is copyable instead.
 *
 * `mono` is used for account numbers and IFSC codes, where a tabular font makes
 * a transposed digit visible at a glance.
 */
export function CopyRow({
  label, value, hint, mono, missing,
}: {
  label: string;
  value: string | null | undefined;
  hint?: string;
  mono?: boolean;
  missing?: string;
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard is permission-gated and unavailable over plain http on some
      // browsers. Selecting the text is the fallback, so say nothing rather
      // than claim a copy that did not happen.
    }
  };

  return (
    <div style={css(`display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid ${T.border};`)}>
      <span style={css(`flex:none;width:104px;font-size:11.5px;font-weight:700;color:${T.muted};letter-spacing:.02em;`)}>{label}</span>
      <span style={css('flex:1;min-width:0;')}>
        {value ? (
          <span style={css(`display:block;font-size:14px;font-weight:800;word-break:break-all;${mono ? "font-family:ui-monospace,'SF Mono',Menlo,monospace;letter-spacing:.04em;" : ''}`)}>
            {value}
          </span>
        ) : (
          <span style={css('display:block;font-size:13px;font-weight:700;color:var(--ag-bad-text);')}>{missing ?? 'Not provided'}</span>
        )}
        {hint && <span style={css(`display:block;margin-top:2px;font-size:11.5px;font-weight:600;color:${T.muted};`)}>{hint}</span>}
      </span>
      {value && (
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          style={css(`flex:none;display:inline-flex;align-items:center;gap:5px;height:34px;padding:0 11px;border-radius:10px;border:1px solid ${T.border};background:${copied ? 'var(--ag-good-bg)' : 'var(--ag-surface)'};color:${copied ? 'var(--ag-good-text)' : T.muted};font-size:11.5px;font-weight:800;cursor:pointer;font-family:inherit;`)}
        >
          <span className="material-symbols-rounded" style={css('font-size:15px;')}>{copied ? 'check' : 'content_copy'}</span>
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}
