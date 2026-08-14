import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { css } from '@/lib/css';

/**
 * Where the unsubscribe link in a marketing email lands.
 *
 * Reached by someone who is almost certainly signed out, on a device that has
 * never seen this site, in a mood that ranges from neutral to annoyed. So: no
 * account, no form, no "are you sure", no attempt to talk them out of it. The
 * work is already done by the time this renders in the normal flow — the public
 * `unsubscribe` Edge Function acts on the token and redirects here with `done=1`
 * — and this page's whole job is to say so clearly and offer one undo.
 *
 * It still handles the token itself when `done` is absent, which covers a link
 * pasted straight into a browser and the case where the function is not deployed
 * yet. `unsubscribe_by_token` is idempotent, so doing it twice is harmless.
 *
 * Marketing only. The copy is explicit that order and account email keeps
 * coming, because someone who unsubscribes and then misses a delivery notice has
 * been failed twice.
 */
export function Unsubscribe() {
  const [params] = useSearchParams();
  const token = (params.get('t') ?? '').trim();
  const alreadyDone = params.get('done') === '1';
  const linkError = params.get('error') ?? '';

  const [state, setState] = useState<'working' | 'done' | 'resubscribed' | 'error'>(
    alreadyDone ? 'done' : linkError ? 'error' : 'working',
  );
  const [masked, setMasked] = useState(params.get('e') ?? '');
  const [message, setMessage] = useState(linkError);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (alreadyDone || linkError) return;
    if (!token) {
      setState('error');
      setMessage('This link is missing its unsubscribe code.');
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc('unsubscribe_by_token', { p_token: token });
      if (cancelled) return;
      const row = Array.isArray(data) ? data[0] : data;
      if (error) {
        setState('error');
        setMessage(
          /function .*unsubscribe_by_token.* does not exist/i.test(error.message)
            ? 'Unsubscribes are not switched on yet. Please email support@mangaimart.com and we will remove you by hand.'
            : 'Something went wrong. Please email support@mangaimart.com and we will remove you by hand.',
        );
        return;
      }
      if (!row?.ok) {
        setState('error');
        setMessage('That link has already been used, or is no longer valid.');
        return;
      }
      setMasked(String(row.masked_email ?? ''));
      setState('done');
    })();
    return () => {
      cancelled = true;
    };
  }, [token, alreadyDone, linkError]);

  const resubscribe = async () => {
    if (!token) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('resubscribe_by_token', { p_token: token });
    setBusy(false);
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row?.ok) {
      setMessage('Could not turn marketing email back on. Please email support@mangaimart.com.');
      setState('error');
      return;
    }
    setState('resubscribed');
  };

  const card = 'max-width:520px;margin:0 auto;padding:32px 24px 48px;text-align:center;';
  const title = "font-family:'Playfair Display',Georgia,serif;font-size:26px;font-weight:700;color:var(--ag-ink);line-height:1.3;margin:0 0 10px;";
  const para = 'font-size:14.5px;line-height:1.75;color:var(--ag-label);margin:0 0 14px;';

  return (
    <div style={css(card)}>
      <div style={css('width:64px;height:64px;border-radius:20px;background:var(--ag-surface-2);display:flex;align-items:center;justify-content:center;margin:24px auto 18px;')}>
        <span translate="no" aria-hidden style={css("font-family:'Material Symbols Outlined';font-size:32px;line-height:1;color:var(--ag-crimson);")}>
          {state === 'resubscribed' ? 'mark_email_read' : state === 'error' ? 'error' : 'unsubscribe'}
        </span>
      </div>

      {state === 'working' && (
        <>
          <h1 style={css(title)}>One moment…</h1>
          <p style={css(para)}>Updating your email preferences.</p>
        </>
      )}

      {state === 'done' && (
        <>
          <h1 style={css(title)}>You&apos;re unsubscribed</h1>
          <p style={css(para)}>
            {masked ? <>We&apos;ve stopped marketing email to <b>{masked}</b>.</> : <>We&apos;ve stopped sending you marketing email.</>}
          </p>
          <p style={css(para)}>
            You will still receive messages about things you asked for — order confirmations, delivery updates,
            refunds and anything about your account. Those are not marketing and cannot be turned off while you have
            orders with us.
          </p>
          <button
            type="button"
            onClick={resubscribe}
            disabled={busy || !token}
            style={css('margin-top:6px;background:none;border:none;color:var(--ag-crimson);font-size:13.5px;font-weight:700;text-decoration:underline;cursor:pointer;font-family:inherit;')}
          >
            {busy ? 'Working…' : 'Unsubscribed by mistake? Turn it back on'}
          </button>
        </>
      )}

      {state === 'resubscribed' && (
        <>
          <h1 style={css(title)}>You&apos;re back on the list</h1>
          <p style={css(para)}>
            {masked ? <>Marketing email to <b>{masked}</b> is on again.</> : <>Marketing email is on again.</>} You can
            unsubscribe from any future message.
          </p>
        </>
      )}

      {state === 'error' && (
        <>
          <h1 style={css(title)}>We couldn&apos;t update that</h1>
          <p style={css(para)}>{message || 'That link is not valid.'}</p>
          <p style={css(para)}>
            Email <a href="mailto:support@mangaimart.com" style={css('color:var(--ag-crimson);font-weight:700;')}>support@mangaimart.com</a>{' '}
            and we will sort it out by hand.
          </p>
        </>
      )}

      <div style={css('margin-top:26px;')}>
        <Link to="/" style={css('font-size:13.5px;font-weight:700;color:var(--ag-label);text-decoration:none;border:1.5px solid var(--ag-border);border-radius:12px;padding:11px 20px;display:inline-block;')}>
          Back to MangaiMart
        </Link>
      </div>
    </div>
  );
}
