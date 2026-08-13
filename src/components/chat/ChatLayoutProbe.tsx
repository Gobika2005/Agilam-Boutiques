import { useEffect, useState } from 'react';
import { css } from '@/lib/css';

/**
 * A read-out of exactly where the chat surface and its composer are sitting.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The composer going missing on the buyer's chat has survived three fixes, each
 * of which addressed a real defect that was NOT the whole story. The remaining
 * gap is that the failure only happens on a real Android phone, where the
 * numbers that decide the layout — the layout viewport, the visual viewport and
 * the URL bar's share of the difference — cannot be reproduced from a desktop
 * or reasoned out of the source. Guessing again is worse than measuring.
 *
 * So: opt in with `?debugchat` on any chat URL and this paints the measurements
 * over the screen, ready to screenshot. Nothing renders without that parameter,
 * so it cannot reach a real buyer by accident, and it reads the DOM without
 * touching it.
 *
 * Delete this file once the chat layout is settled.
 */

/** Rendered only when the URL carries `?debugchat`. */
export function useChatProbeEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      setOn(new URLSearchParams(window.location.search).has('debugchat'));
    } catch {
      setOn(false);
    }
  }, []);
  return on;
}

type Row = { label: string; value: string; bad?: boolean };

/**
 * Which ancestor, if any, has turned itself into the containing block for a
 * `position:fixed` descendant.
 *
 * `transform`, `filter`, `backdrop-filter`, `perspective`, `contain` and
 * `will-change` on any of those all do it, and the effect is that `fixed` stops
 * meaning "relative to the viewport" — which would move the chat surface and
 * everything in it. Reported by name so the fix has somewhere to go.
 */
function containingBlockCulprit(el: HTMLElement | null): string {
  let p = el?.parentElement ?? null;
  while (p && p !== document.documentElement) {
    const s = getComputedStyle(p);
    const why =
      (s.transform && s.transform !== 'none' && 'transform') ||
      (s.filter && s.filter !== 'none' && 'filter') ||
      ((s as unknown as { backdropFilter?: string }).backdropFilter &&
        (s as unknown as { backdropFilter?: string }).backdropFilter !== 'none' &&
        'backdrop-filter') ||
      (s.perspective && s.perspective !== 'none' && 'perspective') ||
      (s.contain && /paint|layout|strict|content/.test(s.contain) && 'contain') ||
      (s.willChange && /transform|filter|perspective/.test(s.willChange) && 'will-change');
    if (why) {
      const name = p.tagName.toLowerCase() + (p.className ? '.' + String(p.className).split(' ')[0] : '');
      return `${name} (${why})`;
    }
    p = p.parentElement;
  }
  return 'nothing (ok)';
}

export function ChatLayoutProbe() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const read = () => {
      const vv = window.visualViewport;
      const root = document.querySelector('.agx-chat-root') as HTMLElement | null;
      const comp = document.querySelector('.agx-chat-composer') as HTMLElement | null;
      const rootR = root?.getBoundingClientRect();
      const compR = comp?.getBoundingClientRect();
      const cs = root ? getComputedStyle(root) : null;
      const n = (v: number | undefined) => (v === undefined ? '—' : String(Math.round(v)));

      // The one number that matters: how far the composer's bottom edge is from
      // the bottom of what the user can actually see. Positive = off-screen.
      const visibleH = vv?.height ?? window.innerHeight;
      const overshoot = compR ? Math.round(compR.bottom - visibleH) : NaN;

      /*
       * The composer overflows the root rather than the root overflowing the
       * screen, so the interesting elements are the ones in between. None of
       * them carry a class, so they are reached by position: the root's only
       * child is the 900px column, and inside it sit the header, the scrolling
       * thread and the composer.
       */
      const wrap = root?.firstElementChild as HTMLElement | null;
      const head = wrap?.children[0] as HTMLElement | undefined;
      const thread = root?.querySelector('.agx-scroll') as HTMLElement | null;
      const wrapR = wrap?.getBoundingClientRect();
      const headR = head?.getBoundingClientRect();
      const threadR = thread?.getBoundingClientRect();
      const wrapCs = wrap ? getComputedStyle(wrap) : null;
      const threadCs = thread ? getComputedStyle(thread) : null;

      setRows([
        { label: 'composer found', value: comp ? 'yes' : 'NO', bad: !comp },
        {
          label: 'composer off-screen by',
          value: Number.isNaN(overshoot) ? '—' : `${overshoot}px`,
          bad: !Number.isNaN(overshoot) && overshoot > 2,
        },
        { label: 'composer top/bottom', value: `${n(compR?.top)} / ${n(compR?.bottom)}` },
        { label: 'composer height', value: n(compR?.height) },
        { label: 'root top/height', value: `${n(rootR?.top)} / ${n(rootR?.height)}` },
        { label: 'root bottom', value: n(rootR?.bottom) },
        // Which element is the one that overflows.
        {
          label: 'wrapper h / bottom',
          value: `${n(wrapR?.height)} / ${n(wrapR?.bottom)}`,
          bad: !!wrapR && !!rootR && wrapR.bottom - rootR.bottom > 2,
        },
        { label: 'wrapper flex/min-h', value: `${wrapCs?.flexGrow ?? '—'}/${wrapCs?.flexShrink ?? '—'}/${wrapCs?.flexBasis ?? '—'} min:${wrapCs?.minHeight ?? '—'}` },
        { label: 'wrapper height css', value: wrapCs?.height ?? '—' },
        { label: 'header h', value: n(headR?.height) },
        { label: 'thread h / bottom', value: `${n(threadR?.height)} / ${n(threadR?.bottom)}` },
        { label: 'thread min-h / flex', value: `${threadCs?.minHeight ?? '—'} / ${threadCs?.flexGrow ?? '—'}` },
        { label: 'root box-sizing', value: cs?.boxSizing ?? '—' },
        { label: 'root pad-bottom', value: cs?.paddingBottom ?? '—' },
        { label: 'root overflow', value: cs?.overflow ?? '—' },
        { label: 'root max-height', value: cs?.maxHeight ?? '—' },
        { label: 'window.innerHeight', value: n(window.innerHeight) },
        { label: 'visualViewport h', value: n(vv?.height) },
        { label: 'vv offsetTop / scale', value: `${n(vv?.offsetTop)} / ${(vv?.scale ?? 1).toFixed(2)}` },
        { label: '--ag-kb-inset', value: cs?.getPropertyValue('--ag-kb-inset').trim() || '(unset)' },
        { label: '--ag-banner-h', value: cs?.getPropertyValue('--ag-banner-h').trim() || '(unset)' },
        { label: 'root position', value: cs?.position ?? '—', bad: !!cs && cs.position !== 'fixed' },
        /*
         * Whether a transformed/filtered ancestor has captured the fixed
         * positioning. NOT `offsetParent`: the spec says that is always null for
         * a fixed element, so the earlier reading of "null (ok)" proved nothing
         * and wrongly cleared this suspect. Walk the ancestors and look for the
         * properties that actually create a containing block.
         */
        { label: 'fixed captured by', value: containingBlockCulprit(root), bad: containingBlockCulprit(root) !== 'nothing (ok)' },
        { label: 'doc scrollTop/H', value: `${n(document.documentElement.scrollTop)} / ${n(document.documentElement.scrollHeight)}` },
        { label: 'body class', value: document.body.className || '(none)' },
      ]);
    };

    read();
    const t = setInterval(read, 500);
    window.visualViewport?.addEventListener('resize', read);
    window.visualViewport?.addEventListener('scroll', read);
    window.addEventListener('scroll', read, { passive: true });
    return () => {
      clearInterval(t);
      window.visualViewport?.removeEventListener('resize', read);
      window.visualViewport?.removeEventListener('scroll', read);
      window.removeEventListener('scroll', read);
    };
  }, []);

  return (
    <div
      // Literal colours: this is a diagnostic overlay that has to stay legible
      // whatever the theme is doing, and it never ships to a buyer.
      style={css(
        'position:fixed;left:6px;right:6px;top:6px;z-index:9999;background:rgba(0,0,0,.88);color:#fff;' +
          'border:1px solid #E14A7E;border-radius:10px;padding:8px 10px;font-family:monospace;font-size:10.5px;line-height:1.5;pointer-events:none;',
      )}
    >
      <div style={css('color:#E14A7E;font-weight:700;margin-bottom:3px;')}>chat layout probe — screenshot this</div>
      {rows.map((r) => (
        <div key={r.label} style={css('display:flex;justify-content:space-between;gap:8px;')}>
          <span style={css('opacity:.75;')}>{r.label}</span>
          <span style={css(`font-weight:700;color:${r.bad ? '#FF6B6B' : '#9BE8A0'};`)}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}
