# Daily admin report — setup

*Written 2026-08-20, when the report was rebuilt: new recipients, new template,
new sender.*

The report lands at **07:00 IST** and answers, in that order: is anything broken,
what needs you today, how did yesterday trade, and how big is the marketplace
now. It goes to **every active admin account** — there is no address list to
maintain.

---

## What changed

| | Before | Now |
|---|---|---|
| Recipient | one address in `REPORT_TO` | every `profiles` row with `role='admin'`, resolved at send time |
| Sender | Windows Scheduled Task only — no report if the PC slept | Supabase Edge Function on pg_cron; the PC is the fallback |
| Content | yesterday's trading | + live health verdict, marketplace state, longer action queue |
| Template | plain system-font list | dashboard layout on the MangaiMart palette, phone-first |

`REPORT_TO` is now **optional**. Anything in it is added to the admin list — use
it for an address that is not an admin account (an accountant, an alias). Leave
it unset and the report goes to admins only.

---

## 1. Apply the migration  ⟵ *your hand*

Run `supabase/migrations/0093_daily_report_v2.sql` in the Supabase SQL editor.
It is idempotent. **Do not `supabase db push`** — see CLAUDE.md rule 1.

It adds `report_recipients()`, `report_runs` + `claim_report_run()` +
`finish_report_run()`, and replaces `daily_digest()` with a version that also
returns `status` and `catalogue`. Every key the old sender read is still there,
so nothing breaks in the window between applying this and deploying the rest.

Check it answers:

```sql
select daily_digest('<your REPORT_TOKEN>') -> 'status';
select report_recipients('<your REPORT_TOKEN>');
```

If the second returns `[]`, no admin has an email address on file — fix that in
the console before going further, or the report has nowhere to go.

If you have never set a token (it was set once in 0060):

```sql
select public.set_report_token('<24+ character random string>');
```

Run that as an admin, not with the service key — it checks `is_admin()`.

---

## 2. Deploy the Edge Function  ⟵ *deployable from a Claude session*

```bash
supabase functions deploy daily-report --no-verify-jwt
supabase secrets set REPORT_TOKEN=... RESEND_API_KEY=... REPORT_FROM="MangaiMart <reports@mangaimart.com>" APP_URL=https://mangaimart.com
# optional, for deep links straight into the console from the action queue:
supabase secrets set ADMIN_PATH=<the VITE_ADMIN_PATH segment>
```

`--no-verify-jwt` for the same reason as `wa-drain`: the caller is a database
job, not a signed-in user. The function does its own check — the bearer must be
the service-role key or `REPORT_TOKEN`, everything else is 401.

**`REPORT_FROM` must be an address on the verified `mangaimart.com` domain** —
the same domain the rest of the platform's mail already sends from. Resend's
shared sandbox domain delivers only to the Resend account owner's own address,
so it would silently drop the report for every other admin; both senders refuse
it rather than half-send.

Look at it before scheduling anything:

```bash
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/daily-report?dry=1" \
  -H "Authorization: Bearer <service-role-key>" > preview.html
```

`dry=1` renders with live data and sends nothing. It does not claim the day
either, so you can run it as often as you like.

---

## 3. Schedule it  ⟵ *your hand, once, in the SQL editor*

```sql
select cron.schedule('daily-report', '30 1 * * *', $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/daily-report',
    headers := '{"Authorization":"Bearer <service-role-key>"}'::jsonb
  );
$$);
```

01:30 UTC = 07:00 IST. pg_cron runs in UTC and does not follow IST — India has
no daylight saving, so this never needs revisiting.

Check it registered: `select * from cron.job where jobname = 'daily-report';`

---

## 4. Repoint the Windows task  ⟵ *your hand*

`scripts/daily-report.cmd` now runs `--ensure` instead of `--send`. Change the
existing **Agilam Daily Report** task to start at **07:45** local (Task
Scheduler → the task → Triggers → Edit). Leave everything else alone.

`--ensure` asks the database whether the report already went out and exits 0
doing nothing if it did — so on a normal morning this task writes one line to
`daily-report.log` and stops. It only sends when the cloud run did not report
success. Running it by hand at any hour is harmless.

The 45-minute gap is deliberate: a cloud run that claimed the day and then died
mid-send releases its claim after 25 minutes, and the fallback has to start
after that window, not inside it.

---

## 5. Verify

```bash
npm run report:daily            # the raw digest as JSON — no email
npm run report:preview          # writes daily-report-preview.html, opens in a browser
node scripts/daily-report.mjs --send --to you@example.com   # real send, one test address
```

Then, the morning after:

```sql
select * from report_runs order by day desc limit 7;
```

`source` tells you who sent it (`cloud` / `local` / `manual`), `ok` whether it
landed, `recipients` how many admins got it. A row with `ok = false` and a
`detail` is the fastest answer to "why was there no report today".

---

## Environment reference

| Variable | Where | Purpose |
|---|---|---|
| `REPORT_TOKEN` | Supabase secrets + local `.env` | authorises the three report RPCs. **Not** the service-role key |
| `RESEND_API_KEY` | Supabase secrets + local `.env` | sending |
| `REPORT_FROM` | Supabase secrets + local `.env` | verified sender domain |
| `APP_URL` | Supabase secrets + local `.env` | which site to health-probe and link to |
| `ADMIN_PATH` | optional | the secret console segment, for deep links in the action queue |
| `REPORT_TO` | optional | extra non-admin recipients, comma-separated |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | local `.env` (auto-injected in the function) | reaching the RPCs |

The service-role key is deliberately **never** used to read report data. The
RPCs are `SECURITY DEFINER` and token-gated, so a leaked `REPORT_TOKEN` exposes
daily aggregates and admin email addresses — not a key that bypasses RLS on
every table in the project.

---

## Where the code is

| File | Role |
|---|---|
| `supabase/migrations/0093_daily_report_v2.sql` | digest, recipients, one-send-per-day claim |
| `supabase/functions/_shared/reportTemplate.js` | **the only copy of the template**, imported by both senders |
| `supabase/functions/daily-report/index.ts` | primary sender (pg_cron) |
| `scripts/daily-report.mjs` | fallback sender + local preview tool |
| `scripts/daily-report.cmd` | Windows Task Scheduler wrapper |

Editing the template changes both senders at once. That is the point — there is
no second copy to keep in step, the same rule that binds `src/lib/pricing.ts` to
`api/_pricing.js`.
