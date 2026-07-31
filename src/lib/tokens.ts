export const TONES = ['#F4D6E2', '#F1DCC7', '#E2DAEF', '#D7E7DE', '#F3DFD0', '#E7D9E6', '#DCE4EF', '#F0DAD4'];

export function toneHex(tone: number) {
  return TONES[tone % TONES.length];
}

export function fmtInr(n: number) {
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

export function initial(name: string) {
  return (name?.trim()?.[0] ?? '?').toUpperCase();
}

type StatusStyle = { bg: string; fg: string };

/** Theme tokens, never literal hex — see the note on `statusStyle` in
 *  @/data/demo, which these mirror. */
export function statusStyle(status: string): StatusStyle {
  const good = { bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' };
  const warn = { bg: 'var(--ag-warn-bg)', fg: 'var(--ag-warn-text)' };
  const bad = { bg: 'var(--ag-bad-bg)', fg: 'var(--ag-bad-text)' };
  const neutral = { bg: 'var(--ag-surface-2)', fg: 'var(--ag-muted)' };
  const map: Record<string, StatusStyle> = {
    Pending: warn,
    Shipped: { bg: 'var(--ag-info-bg)', fg: 'var(--ag-info-text)' },
    Delivered: good,
    Approved: good,
    Active: good,
    Live: good,
    Settled: good,
    Due: warn,
    Paused: warn,
    Rejected: bad,
    Expired: bad,
    Draft: neutral,
  };
  return map[status] || neutral;
}

export function stockInfo(stock: number) {
  if (stock === 0) return { label: 'Out of stock', bg: 'var(--ag-bad-bg)', fg: 'var(--ag-bad-text)' };
  if (stock <= 5) return { label: `Low · ${stock} left`, bg: 'var(--ag-warn-bg)', fg: 'var(--ag-warn-text)' };
  return { label: 'In stock', bg: 'var(--ag-good-bg)', fg: 'var(--ag-good-text)' };
}
