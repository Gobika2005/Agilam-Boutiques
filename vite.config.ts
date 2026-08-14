import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error — plain .mjs build script, shared with the CLI entry point.
import { collectIconNames, iconFontHref } from './scripts/icon-inventory.mjs';

// The app prints its build version on the buyer profile screen; read it from
// package.json so the two can never drift.
const { version: appVersion } = createRequire(import.meta.url)('./package.json') as { version: string };

/**
 * Serves the Vercel-style serverless functions in /api during `vite dev`, so
 * the Razorpay flow works with `npm run dev` (not just `vercel dev`). In a
 * production build this plugin is inert — Vercel runs the functions itself.
 */
type Handler = (req: unknown, res: unknown) => unknown;

function devApi(env: Record<string, string>): Plugin {
  const routes: Record<string, string> = {
    '/api/create-order': './api/create-order.js',
    '/api/verify-payment': './api/verify-payment.js',
    '/api/place-order': './api/place-order.js',
    '/api/admin-create-user': './api/admin-create-user.js',
    '/api/admin-delete-user': './api/admin-delete-user.js',
    '/api/admin-list-users': './api/admin-list-users.js',
    '/api/razorpay-webhook': './api/razorpay-webhook.js',
    // Seller ads (migration 0032): a single function dispatches create-order /
    // activate / refund / lifecycle on `action` (consolidated to stay under the
    // Vercel Hobby 12-function limit) — so the Promote flow works under `npm run
    // dev`, not only on Vercel.
    '/api/ads': './api/ads.js',
    // Read-only diagnostics. Without these two the dev server has no route for
    // them, so Vite serves the handler's SOURCE as a module: /api/health — the
    // endpoint ENVIRONMENTS.md tells you to check first — could not be used
    // locally at all, and the presence tracker's /api/geo call parsed JS as JSON
    // on every navigation. Neither has side effects, so both are safe in dev.
    '/api/health': './api/health.js',
    '/api/geo': './api/geo.js',
  };
  // Variable specifier + @vite-ignore: resolved by Node at request time, not
  // bundled or statically type-checked (the handlers are plain .js).
  const load = (spec: string) =>
    import(/* @vite-ignore */ spec) as Promise<{ default: Handler }>;

  return {
    name: 'dev-api',
    apply: 'serve',
    configureServer(server) {
      // The handlers read secrets from process.env; loadEnv doesn't set it.
      //
      // Assigned through a helper because `process.env.X = undefined` stores the
      // *string* "undefined" — truthy, so a missing key sails past the handlers'
      // `if (!key)` config guards and fails much later as an opaque auth error.
      // Skipping the assignment leaves the var genuinely absent instead.
      const pass = (name: string, value: string | undefined) => {
        if (process.env[name] === undefined && value) process.env[name] = value;
      };
      pass('RAZORPAY_KEY_ID', env.RAZORPAY_KEY_ID);
      pass('RAZORPAY_KEY_SECRET', env.RAZORPAY_KEY_SECRET);
      pass('RAZORPAY_WEBHOOK_SECRET', env.RAZORPAY_WEBHOOK_SECRET);
      // place-order writes with the Supabase service role (bypasses RLS).
      pass('SUPABASE_URL', env.SUPABASE_URL || env.VITE_SUPABASE_URL);
      pass('SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY);
      // admin-create-user verifies the caller's admin session with the anon key
      // and (optionally) emails the welcome/credentials via Resend. Without these
      // forwarded, admin user creation fails in `npm run dev` with a 500.
      pass('SUPABASE_ANON_KEY', env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY);
      pass('RESEND_API_KEY', env.RESEND_API_KEY || env.VITE_RESEND_API_KEY);
      pass('EMAIL_FROM', env.EMAIL_FROM || env.VITE_EMAIL_FROM);
      pass('APP_URL', env.APP_URL || env.VITE_APP_URL);
      // api/_accessEmail.js builds the console sign-in link for welcome mails
      // from this; without it a locally sent invite points at /admin/login.
      pass('VITE_ADMIN_PATH', env.VITE_ADMIN_PATH);
      // Lets /api/run-ad-lifecycle be exercised locally (otherwise it is an inert
      // no-op with no secret configured).
      pass('AD_CRON_SECRET', env.AD_CRON_SECRET);

      // Fail loudly at startup rather than at the worst possible moment —
      // mid-checkout, after the buyer's card has already been charged.
      for (const name of ['SUPABASE_SERVICE_ROLE_KEY', 'RAZORPAY_KEY_SECRET']) {
        if (!process.env[name]) {
          console.warn(`\n  ⚠  ${name} is not set — /api checkout routes will fail. Add it to .env and restart.\n`);
        }
      }

      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0];
        const spec = routes[path];
        if (!spec) return next();

        let raw = '';
        for await (const chunk of req) raw += chunk;

        // The webhook verifies an HMAC over the UNPARSED body, so it must get
        // the raw string; every other route expects Vercel's parsed JSON.
        const wantsRawBody = path === '/api/razorpay-webhook';
        let body: unknown;
        if (wantsRawBody) {
          body = raw;
        } else {
          try {
            body = raw ? JSON.parse(raw) : undefined;
          } catch {
            body = undefined;
          }
        }

        // Adapt Node's res to the Vercel-style `res.status().json()` API.
        const shim = res as unknown as {
          status: (code: number) => typeof shim;
          json: (data: unknown) => void;
        };
        shim.status = (code: number) => {
          res.statusCode = code;
          return shim;
        };
        shim.json = (data: unknown) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data));
        };

        try {
          const mod = await load(spec);
          // Forward `headers`/`socket` too: the handlers read the buyer's bearer
          // token (place-order) and the client IP (rate limiter) off them. Passing
          // only { method, body } made `req.headers.authorization` throw a
          // TypeError *after* the buyer had already paid, so the payment was
          // captured but the order never got written.
          await mod.default(
            { method: req.method, url: req.url, headers: req.headers, socket: req.socket, body },
            res,
          );
        } catch (err) {
          console.error('[dev-api]', path, err);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Dev API error' }));
          }
        }
      });
    },
  };
}

/**
 * Rewrites the Material Symbols stylesheet URL in `index.html` to ask for only
 * the icons this app actually draws.
 *
 * The unsubsetted font is a 457 kB woff2 — the single heaviest thing the page
 * loads, on every cold visit, for about 265 glyphs. Naming them takes it to
 * 32 kB. Both numbers are measured, not estimated: fetch the two URLs.
 *
 * The list is derived from the source on every build by
 * `scripts/icon-inventory.mjs`, never maintained by hand, because the failure
 * mode of an incomplete list is an icon that renders as its own name. Read that
 * file before changing anything here.
 */
function iconSubset(): Plugin {
  return {
    name: 'icon-subset',
    // `pre`, so the URL is rewritten before any other plugin reads the HTML.
    enforce: 'pre',
    transformIndexHtml(html) {
      const names = collectIconNames();
      const href = iconFontHref(names);
      // Matches the async `<link>` and the `<noscript>` fallback alike.
      const full = /https:\/\/fonts\.googleapis\.com\/css2\?family=Material\+Symbols\+Outlined[^"']*/g;
      const hits = html.match(full)?.length ?? 0;
      if (!hits) {
        // Silence here would ship the full 457 kB font and look like a success.
        throw new Error(
          'icon-subset: no Material Symbols stylesheet link found in index.html — ' +
            'the URL changed shape and the subset is no longer being applied.',
        );
      }
      console.log(`  ✓ icon subset — ${names.length} icons, ${hits} link(s) rewritten`);
      return html.replace(full, href);
    },
  };
}

/**
 * The admin console's URL segment is a deploy-time secret (`src/lib/adminPath.ts`).
 *
 * A missing var would fall back to `admin` and quietly publish the console at
 * the one address everybody tries — a silent regression of the whole point. So
 * a production build refuses to start without it. `vite dev` is exempt: local
 * work should not need the secret.
 */
function requireAdminPath(env: Record<string, string>) {
  const value = (env.VITE_ADMIN_PATH ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!value) {
    throw new Error(
      'VITE_ADMIN_PATH is not set — the admin console would be published at /admin.\n' +
        '  Set it in the Vercel project settings (and in .env for a local build).',
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) {
    throw new Error(`VITE_ADMIN_PATH must be one lowercase URL segment (letters, digits, hyphens) — got "${value}".`);
  }
  return value;
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  if (command === 'build') {
    console.log(`  ✓ admin console at /${requireAdminPath(env)}`);
  }
  return {
    plugins: [react(), devApi(env), iconSubset()],
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      // Peel the always-loaded framework/runtime libraries out of the main app
      // chunk so the buyer bundle isn't one 800 kB blob: they change rarely and
      // cache across deploys, and the remaining app code lands under the warning
      // threshold. jspdf/html2canvas already split out via their lazy imports.
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
          },
        },
      },
      chunkSizeWarningLimit: 700,
    },
    server: { port: 5173 },
  };
});
