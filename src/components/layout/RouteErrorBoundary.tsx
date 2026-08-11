import { Component, type ErrorInfo, type ReactNode } from 'react';
import { css } from '@/lib/css';

/**
 * Catches render/runtime errors in a routed page so one broken screen shows a
 * recoverable message instead of blanking the whole app. Without this, an
 * uncaught error unmounts the entire React tree — a white page with no clue.
 *
 * Mounted in `AdminLayout` and in `AppShell`, which is the shell both the buyer
 * storefront and the seller console render through — so all three consoles are
 * covered. It used to guard only the admin console, which left an uncaught
 * render error on the storefront white-screening the one surface that takes
 * money.
 *
 * IMPORTANT: React never clears a boundary by itself. Callers key this on the
 * current pathname so navigating away from a broken screen recovers; without
 * that key a single crash pins the error card over every subsequent route.
 */
export class RouteErrorBoundary extends Component<
  { children: ReactNode; surface?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.surface ?? 'Page'} crashed:`, error, info);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={css('max-width:560px;margin:40px auto;background:var(--ag-surface);border-radius:18px;padding:28px;box-shadow:0 12px 30px -24px rgba(107,20,54,.6);')}>
        <div style={css('width:52px;height:52px;border-radius:15px;background:var(--ag-bad-bg);display:flex;align-items:center;justify-content:center;')}>
          <span aria-hidden="true" translate="no" style={css("font-family:'Material Symbols Outlined';font-size:26px;color:var(--ag-bad-text);")}>error</span>
        </div>
        <div style={css("font-family:'Playfair Display',serif;font-weight:700;font-size:22px;margin-top:14px;")}>This page hit an error</div>
        <div style={css('color:var(--ag-muted);font-size:13.5px;margin-top:6px;line-height:1.5;')}>
          Everything else still works — the navigation below will take you anywhere else. Try again, or
          reload; if it keeps happening, send this message across:
        </div>
        <pre style={css('margin-top:12px;background:var(--ag-bg);border:1px solid var(--ag-border);border-radius:12px;padding:12px 14px;font-size:12px;color:var(--ag-crimson);white-space:pre-wrap;word-break:break-word;overflow:auto;max-height:180px;')}>
          {error.message || String(error)}
        </pre>
        <div style={css('display:flex;gap:10px;margin-top:18px;')}>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={css('height:44px;border-radius:12px;border:1.5px solid var(--ag-border);background:var(--ag-surface);color:var(--ag-label);font-weight:700;font-size:13.5px;padding:0 16px;cursor:pointer;font-family:inherit;')}
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={css('height:44px;border-radius:12px;border:none;background:linear-gradient(135deg,#D6336C,#B02454);color:#fff;font-weight:800;font-size:13.5px;padding:0 16px;cursor:pointer;font-family:inherit;')}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
