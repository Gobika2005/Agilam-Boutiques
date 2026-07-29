/**
 * A small fixed corner ribbon that shouts which environment this build is —
 * so a "TEST" deploy (pointed at the throwaway Supabase project) can never be
 * mistaken for production while you're clicking around verifying a change.
 *
 * It renders on every environment EXCEPT production. The environment is read
 * from VITE_APP_ENV (set explicitly per Vercel environment — see
 * ENVIRONMENTS.md); it falls back to Vite's build MODE, so `vite --mode
 * staging` also lights it up. Production builds (VITE_APP_ENV=production, or the
 * default MODE of `production`) render nothing.
 */
const env = ((import.meta.env.VITE_APP_ENV as string) || import.meta.env.MODE || 'production').toLowerCase();

const isProduction = env === 'production' || env === 'prod';

const label =
  env === 'staging' || env === 'test'
    ? 'TEST'
    : env === 'development' || env === 'dev'
      ? 'DEV'
      : env.toUpperCase();

export function EnvBadge() {
  if (isProduction) return null;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        zIndex: 2147483647,
        padding: '3px 10px',
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: '0.12em',
        lineHeight: 1.4,
        color: '#fff',
        background: '#b45309',
        borderTopRightRadius: 6,
        boxShadow: '0 -1px 6px rgba(0,0,0,0.25)',
        pointerEvents: 'none',
        userSelect: 'none',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      {label} · not production
    </div>
  );
}
