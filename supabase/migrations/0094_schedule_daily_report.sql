-- 0094_schedule_daily_report.sql — put the daily report on pg_cron.
--
-- WHY THIS IS A MIGRATION AND NOT A NOTE IN A README
-- The report has now missed three consecutive mornings, and every one of them
-- was the same root cause: the only scheduler was a Windows Scheduled Task on a
-- laptop. 20 Aug it sent late, 21 Aug it claimed the day and hung on a
-- half-open socket, 22 Aug the console was closed mid-run (STATUS_CONTROL_C_EXIT)
-- before it wrote so much as a log line. None of those are bugs in the report.
-- They are all "the machine was not reliably awake and undisturbed at 07:00".
--
-- pg_cron runs inside the database. It does not care whose laptop is open, and
-- it is already the scheduler for the WhatsApp outbox drain (0090), so this adds
-- no new infrastructure and no new failure mode.
--
-- ─────────────────────────────────────────────────────────────────────────────
--  BEFORE RUNNING: replace <REPORT_TOKEN> below with the value of REPORT_TOKEN
--  from the repo .env. It is a secret, so it is NOT committed here.
--
--  The Edge Function accepts either the service-role key or REPORT_TOKEN as its
--  bearer. Use REPORT_TOKEN — it grants exactly one thing (read these
--  aggregates and send the report), whereas the service-role key bypasses RLS
--  on every table in the project. There is no reason to leave the larger
--  credential sitting in a cron job definition.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 01:30 UTC is 07:00 IST. pg_cron schedules in UTC and India has no daylight
-- saving, so this never needs revisiting.
--
-- Idempotent: re-running replaces the job rather than creating a second one.
-- Two jobs would not double-send — claim_report_run() in 0093 makes that
-- impossible — but the second would fail noisily every morning for no reason.

do $do$
begin
  if to_regclass('cron.job') is null then
    raise exception
      'pg_cron is not installed. Enable it in Dashboard → Database → Extensions, then re-run this migration.';
  end if;
end;
$do$;

-- Remove any previous registration of this job before adding it back.
select cron.unschedule('daily-report')
where exists (select 1 from cron.job where jobname = 'daily-report');

-- timeout_milliseconds is NOT decoration. pg_net defaults to FIVE SECONDS, and a
-- real run of this function takes about nine: two live site probes, three RPCs
-- and the Resend batch. That default cut off the very first scheduled run
-- (23 Aug 2026, 01:30 UTC) at five seconds. It failed silently: pg_net logs the
-- timeout, `report_runs` only ever showed the laptop fallback succeeding at
-- 08:02, and nothing anywhere said "the cloud sender is dead". The function now answers in about a second and finishes the
-- work in the background, so this is the second line of defence rather than the
-- first; keep both.
select cron.schedule('daily-report', '30 1 * * *', $job$
  select net.http_post(
    url                  := 'https://mtxmuaskmyhnqczctwlp.supabase.co/functions/v1/daily-report',
    headers              := '{"Authorization":"Bearer <REPORT_TOKEN>","Content-Type":"application/json"}'::jsonb,
    body                 := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);

-- Confirm it registered. Expect one row, schedule '30 1 * * *', active = true.
select jobid, jobname, schedule, active from cron.job where jobname = 'daily-report';
