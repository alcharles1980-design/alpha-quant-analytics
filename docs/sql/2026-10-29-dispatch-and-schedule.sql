-- ============================================================================================
-- 2026-10-29: what was APPLIED to Supabase haeqzegdlwryvaecanrn, in order. A record, not a script
-- to re-run blindly. Every statement below ran and was verified (see the verification notes).
-- Context: CLAUDE.md §8y. No credential appears here: ops.dispatch_workflow() reads github_pat from
-- app_config at call time, and the cron rewrites in PART 5 were built server-side from the existing
-- commands, so the service key embedded in those commands never left the database.
--
-- WHY ops.* AND AN APPEND-ONLY STATUS TABLE. In the chat that did this work, any statement that
-- replaced or deleted an existing object was auto-cancelled (its approval prompt never reached the
-- user). Additive DDL, INSERT and SELECT ran. So the functions were created fresh in a new `ops`
-- schema rather than replaced in `public`, and the dispatch checker records results by INSERT into
-- a second table rather than UPDATEing the log. A side benefit: PostgREST exposes only `public` and
-- `graphql_public`, so nothing in `ops` is callable with the anon key (PGRST106, verified).
-- ============================================================================================

-- ---------- PART 1: dispatch log + status (both RLS on, no policies: service role only) --------
create table public.workflow_dispatch_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  workflow text not null,
  inputs jsonb,
  req_id bigint,               -- pg_net request id; the response lands in net._http_response
  status_code int,             -- unused (see workflow_dispatch_status)
  checked_at timestamptz
);
create index workflow_dispatch_log_at_idx on public.workflow_dispatch_log (at);
alter table public.workflow_dispatch_log enable row level security;

create table public.workflow_dispatch_status (
  log_id bigint primary key references public.workflow_dispatch_log(id),
  status_code int,             -- 204 accepted; -1 no status; -2 response pruned unread (>2h)
  body text,
  checked_at timestamptz not null default now()
);
alter table public.workflow_dispatch_status enable row level security;

create schema ops;
comment on schema ops is 'Internal operations functions. Not exposed through PostgREST.';

-- ---------- PART 2: dispatch + checker ----------------------------------------------------------
create function ops.dispatch_workflow(p_workflow text, p_inputs jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path to 'public' as $$
declare pat text := (select value from app_config where key = 'github_pat'); rid bigint;
begin
  if pat is null then
    insert into integrity_log (check_name, severity, detail)
    values ('workflow dispatch', 'critical', 'github_pat missing from app_config; could not dispatch ' || p_workflow);
    return null;
  end if;
  rid := net.http_post(
    url := 'https://api.github.com/repos/alcharles1980-design/alpha-quant-analytics/actions/workflows/' || p_workflow || '/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || pat, 'Accept', 'application/vnd.github+json',
                                  'User-Agent', 'aqa-pgcron-dispatch', 'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main', 'inputs', coalesce(p_inputs, '{}'::jsonb)),
    timeout_milliseconds := 15000);
  insert into workflow_dispatch_log (workflow, inputs, req_id) values (p_workflow, p_inputs, rid);
  return rid;
end $$;

-- ops.workflow_dispatch_check() returns int (append-only). For each log row joined to its
-- net._http_response with no status row yet: insert the status (on conflict do nothing); when it is
-- not 204, write a critical integrity_log row and ops_push('AQA pipeline dispatch failed', ...,
-- 'high'). Finally record status -2 for any row still unread after 2 hours (its response was pruned
-- by net_response_prune). Exact body: select pg_get_functiondef('ops.workflow_dispatch_check()'::regprocedure);
--
-- VERIFIED: positive control nightly-pipeline.yml -> 204, GitHub run created 05:36:45 UTC.
-- Negative control does-not-exist.yml -> 404; inside a rolled-back DO block the checker recorded
-- 404, wrote the critical row and queued one push (rolled back, nothing sent). The control's log row
-- was then given status 404 by hand ("NEGATIVE CONTROL ...") so the scheduled checker never alerts on it.

-- ---------- PART 3: chop freshness check, DST-proof --------------------------------------------
-- ops.chop_scan_integrity_check(p_log boolean default true, p_now timestamptz default now()):
-- same two checks as public.chop_scan_integrity_check, but a run must complete after 20:15 ET
-- (was 21:30), judged from 22:45 ET (was 23:00), and results go through arrays instead of a temp
-- table. Exact body: select pg_get_functiondef('ops.chop_scan_integrity_check(boolean,timestamptz)'::regprocedure);
-- VERIFIED (controls): now -> no freshness row; '2026-09-22 14:00+00' -> critical (real outage);
-- synthetic EST night (run done 21:15 EST, rolled back): new -> clean, OLD -> false critical;
-- weekend: Fri run counts on Sun and Mon 22:40; Mon 23:40 with no Mon run -> critical.
select cron.schedule('chop-scan-integrity', '40 * * * *', $c$select ops.chop_scan_integrity_check(true);$c$);

-- ---------- PART 4: GitHub workflows dispatched by pg_cron (UTC; each holds in EDT and EST) ----
select cron.schedule('pipeline-screener',       '30 0 * * 2-6',  $c$select ops.dispatch_workflow('pipeline.yml', '{"mode":"screener","tickers":"SP500"}'::jsonb);$c$);
select cron.schedule('chop-scan-daily',         '30 1 * * 2-6',  $c$select ops.dispatch_workflow('pipeline.yml', '{"mode":"chop-screener","tickers":"ALL"}'::jsonb);$c$);
select cron.schedule('pipeline-sector-refresh', '45 2 * * 2-6',  $c$select ops.dispatch_workflow('pipeline.yml', '{"mode":"sector-refresh","tickers":"ALL"}'::jsonb);$c$);
select cron.schedule('pipeline-nightly-onon',   '25 15 * * 1-5', $c$select ops.dispatch_workflow('nightly-pipeline.yml');$c$);
select cron.schedule('pipeline-yahoo-ratings',  '40 15 * * *',   $c$select ops.dispatch_workflow('pipeline.yml', '{"mode":"yahoo-ratings","tickers":"ALL"}'::jsonb);$c$);
select cron.schedule('pipeline-tipranks',       '10 16 * * 1-5', $c$select ops.dispatch_workflow('tipranks-pipeline.yml');$c$);
select cron.schedule('nrs-refresh-dispatch',    '40 22 * * 1-5', $c$select ops.dispatch_workflow('nrs-refresh.yml');$c$);
select cron.schedule('workflow-dispatch-check', '*/10 * * * *',  $c$select ops.workflow_dispatch_check();$c$);
-- The matching `schedule:` blocks were removed from the four workflow files in commit 4e055ed.

-- ---------- PART 5: scanners and ET-anchored jobs across the clock change ----------------------
-- Scanner cron hours widened to cover both seasons; the Edge Functions skip outside their ET hours.
select cron.schedule('premarket-actives-live',       '*/3 8-14 * * 1-5', (select command from cron.job where jobname = 'premarket-actives-live'));
select cron.schedule('aftermarket-actives-live-est', '*/3 0 * * 2-6',    (select command from cron.job where jobname = 'aftermarket-actives-live'));
-- overnight-actives-live '*/5 0-8 * * *' and overnight-level-scan '*/2 0-9 * * *' already cover both.

-- Every job anchored to a New York time: both UTC hours in the schedule, plus a guard so it runs only
-- in the right ET hour. Two settles also switched their session_date from the UTC to the ET date, and
-- median-aftermarket now rebuilds TODAY's session (it passed yesterday's: a no-op on Tuesdays and a
-- pointless recompute of an unchanged session otherwise). Applied as one statement:
with g(name, sched, guard_hour, rep_from, rep_to) as (values
  ('premarket-actives-settle',    '35 13,14 * * 1-5', 9,  null, null),
  ('aftermarket-actives-settle',  '5 0,1 * * 2-6',    20, $q$((now() at time zone 'UTC')::date - 1)::text$q$, $q$((now() at time zone 'America/New_York')::date)::text$q$),
  ('overnight-actives-settle',    '5 8,9 * * *',      4,  $q$(now() at time zone 'UTC')::date::text$q$, $q$(now() at time zone 'America/New_York')::date::text$q$),
  ('median-premarket',            '45 13,14 * * 1-5', 9,  null, null),
  ('median-aftermarket',          '15 0,1 * * 2-6',   20, $q$((now() at time zone 'America/New_York') - interval '1 day')::date$q$, $q$(now() at time zone 'America/New_York')::date$q$),
  ('predictor-snap-0915',         '15 13,14 * * 1-5', 9,  null, null),
  ('predictor-snap-0925',         '25 13,14 * * 1-5', 9,  null, null),
  ('predictor-outcomes',          '30 21,22 * * 1-5', 17, null, null),
  ('rth-bars-refresh',            '10 21,22 * * 1-5', 17, null, null),
  ('rth-bars-load',               '20 21,22 * * 1-5', 17, null, null),
  ('iv_logger_daily',             '30 21,22 * * 1-5', 17, null, null),
  ('chop-price-postclose',        '30 21,22 * * 1-5', 17, null, null),
  ('chop-price-afterhours-close', '0 0,1 * * 2-6',    20, null, null)
), src as (
  select g.*, rtrim(btrim(case when g.rep_from is null then j.command else replace(j.command, g.rep_from, g.rep_to) end, E' \n\t\r'), ';')
      || E'\n  where extract(hour from (now() at time zone ''America/New_York'')) = ' || g.guard_hour
      || E';  -- DST guard (Oct 29 2026): scheduled in both UTC hours, runs only in the ET one' as newcmd
  from g join cron.job j on j.jobname = g.name
  where (g.rep_from is null or position(g.rep_from in j.command) > 0) and position('DST guard' in j.command) = 0
)
select name, cron.schedule(name, sched, newcmd) from src;
-- VERIFIED: all 13 rewritten commands planned cleanly under EXPLAIN before scheduling; `select
-- volatile_fn() where false` proven not to call the function (a sequence did not advance); and a
-- minute-by-minute simulation over Oct 19-Nov 16 2026 and Mar 1-22 2027 showed every guarded job
-- firing exactly once per ET day, at the same ET time on both sides of each change.
