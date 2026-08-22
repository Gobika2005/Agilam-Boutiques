## What changed

<!-- One or two sentences. What does this do for a buyer / seller / admin? -->

## How I tested it

<!-- Which console, which flow, on what data. "It builds" is not testing. -->

## Checklist

- [ ] `npm run build` and `npm run lint` pass locally
- [ ] Colours use `--ag-*` CSS variables — no hardcoded hex (breaks dark mode)
- [ ] No `select('*')` on `boutiques` (column-level grants — name the columns)
- [ ] No new secret, key or token committed; `.env` untouched
- [ ] UI matches the surrounding inline-style convention

## Anything needing the owner's hand

<!-- Tick anything that applies — these cannot be merged blind. -->

- [ ] Adds a migration → number: `00__` (owner must apply it in Supabase; it is NOT live on merge)
- [ ] Touches pricing → both `src/lib/pricing.ts` AND `api/_pricing.js` changed together
- [ ] Touches RLS → every policy using `is_staff()` says `to authenticated`
- [ ] Needs a new env var → named here, value sent to the owner privately
- [ ] None of the above
