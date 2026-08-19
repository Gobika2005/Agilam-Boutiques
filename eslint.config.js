// ESLint configuration for the MangaiMart marketplace (React + TypeScript + Vite).
//
// Flat config (ESLint 9). Replaces the classic `.eslintrc.cjs` — which pulled in
// the unmaintained ESLint 8 dependency tree (rimraf@3, glob@7, inflight,
// @humanwhocodes/*). Same rules as before, expressed in the new format:
//   • app code (src, *.ts/tsx) — JS + TypeScript recommended, React hooks/refresh;
//   • API functions (api/**/*.js) — plain Node ESM handlers, JS recommended only.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  // `supabase/functions` is Deno, not Node or the browser: `jsr:`/`npm:` import
  // specifiers and a `Deno` global that this config has no business resolving.
  // It is covered by neither tsconfig project either — deliberately, so `tsc -b`
  // does not try to type-check a different runtime. Lint it with `deno lint`.
  { ignores: ['dist', 'node_modules', 'playwright-browsers', '**/*.tsbuildinfo', 'supabase/functions'] },

  // Application source (and the Vite/Tailwind/PostCSS config files).
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021 },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: { react: { version: '18.3' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Underscore-prefixed args/vars are intentional throwaways.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // The codebase uses `cond ? a() : b()` / `cond && a()` for their side
      // effects (e.g. Set add/delete toggles); the classic config never checked
      // this rule, so permit those forms rather than flag working code.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },

  // Root ESM config files — Node globals, no TypeScript rules.
  {
    files: ['*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
  },

  // Vercel serverless functions: plain Node ESM handlers, not typed with the app
  // tsconfig, so they get the JS ruleset with Node globals.
  {
    files: ['api/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
