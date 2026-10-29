-- ============================================================================================
-- 2026-10-29 — move heavy GitHub jobs onto fixed pg_cron dispatch times + chop check DST fix.
-- Context and reasoning: docs/IN-FLIGHT.md. Run the PARTS IN ORDER, verifying between them.
-- Nothing here contains a credential: dispatch_workflow() reads github_pat from app_config, exactly
-- as the existing trigger_chop_scan() already does.
-- ============================================================================================

-- ---------- PART 1: dispatch function + status checker (table already exists) ---------------
create table if not exists public.workflow_dispatch_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  workflow text not null,
  inputs jsonb,
  req_id bigint,
  status_code int,          -- 204 accepted; -1 no status (timeout); -2 response pruned unread
  checked_at timestamptz
);
create index if not exists workflow_dispatch_log_at_idx on public.workflow_dispatch_log (at);
alter table public.workflow_dispatch_log enable row level security;

create or replace function public.dispatch_workflow(p_workflow text, p_inputs jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path to 'public' as $$
-- Generic GitHub workflow_dispatch from pg_cron (Oct 29 2026). Replaces GitHub's own `schedule:`
-- triggers, which ran 3-6.5 HOURS late and piled heavy writes into pre-market. The dispatch API
-- answers 204 on acceptance; workflow_dispatch_check() reads the async status and alerts otherwise.
declare pat text := (select value from app_config where key = 'github_pat'); rid bigint;
begin
  if pat is null then
    insert into integrity_log (check_name, severity, detail)
    values ('workflow dispatch', 'critical', 'github_pat missing from app_config; could not dispatch ' || p_workflow);
    return null;
  end if;
  rid := net.http_post(
    url := 'https://api.github.com/repos/alcharles1980-design/alpha-quant-analytics/actions/workflows/'
           || p_workflow || '/dispatches',
    headers := jsonb_build_object('Authorization', 'Bearer ' || pat, 'Accept', 'application/vnd.github+json',
                                  'User-Agent', 'aqa-pgcron-dispatch', 'Content-Type', 'application/json'),
    body := jsonb_build_object('ref', 'main', 'inputs', coalesce(p_inputs, '{}'::jsonb)),
    timeout_milliseconds := 15000);
  insert into workflow_dispatch_log (workflow, inputs, req_id) values (p_workflow, p_inputs, rid);
  delete from workflow_dispatch_log where at < now() - interval '30 days';
  return rid;
end $$;
revoke all on function public.dispatch_workflow(text, jsonb) from public, anon, authenticated;

create or replace function public.workflow_dispatch_check() returns int
language plpgsql security definer set search_path to 'public', net as $$
-- Reads each pending dispatch's HTTP status (pg_net is async). Non-204 -> integrity_log + phone push.
declare r record; n int := 0;
begin
  for r in select l.id, l.workflow, l.inputs, x.status_code sc, left(coalesce(x.content, x.error_msg, ''), 160) body
           from workflow_dispatch_log l join net._http_response x on x.id = l.req_id
           where l.status_code is null loop
    update workflow_dispatch_log set status_code = coalesce(r.sc, -1), checked_at = now() where id = r.id;
    n := n + 1;
    if r.sc is distinct from 204 then
      insert into integrity_log (check_name, severity, detail)
      values ('workflow dispatch', 'critical',
              format('%s %s -> HTTP %s %s', r.workflow, r.inputs, coalesce(r.sc::text, 'none'), r.body));
      perform ops_push('AQA pipeline dispatch failed',
                       format('%s (%s) returned HTTP %s: %s', r.workflow, coalesce(r.inputs->>'mode', 'default'),
                              coalesce(r.sc::text, 'none'), r.body), 'high');
    end if;
  end loop;
  update workflow_dispatch_log set status_code = -2, checked_at = now()
  where status_code is null and at < now() - interval '2 hours';
  return n;
end $$;
revoke all on function public.workflow_dispatch_check() from public, anon, authenticated;

-- VERIFY PART 1 (positive control, <1 minute of work on GitHub's side):
--   select public.dispatch_workflow('nightly-pipeline.yml');          -- then, in a SEPARATE call:
--   select public.workflow_dispatch_check();
--   select * from workflow_dispatch_log order by id desc limit 1;     -- expect status_code 204
--   gh api repos/alcharles1980-design/alpha-quant-analytics/actions/workflows/nightly-pipeline.yml/runs?per_page=1
--     -> a workflow_dispatch run created within the minute.
-- NEGATIVE control (no phone push: do it inside a transaction that you roll back):
--   select public.dispatch_workflow('does-not-exist.yml');  -- separate call, let it land (404)
--   begin; select public.workflow_dispatch_check();
--          select severity, detail from integrity_log order by id desc limit 1;  -- expect critical, HTTP 404
--   rollback;   -- ops_push's net.http_post is rolled back with it, so nothing is sent

-- ---------- PART 2: the schedule (UTC). Times hold under BOTH EDT and EST -------------------
-- Session-dependent jobs, one at a time, after the US close:
--   screener + sector-refresh fetch "YESTERDAY's" grouped bars (Polygon plan cannot serve today),
--   so they MUST run after 00:00 UTC; moving them into the evening would silently lag a day.
--   chop must follow the screener (it reads its universe). NRS works either side of midnight.
select cron.schedule('nrs-refresh-dispatch',      '20 21 * * 1-5', $c$select public.dispatch_workflow('nrs-refresh.yml');$c$);
select cron.schedule('pipeline-screener',         '30 0 * * 2-6',  $c$select public.dispatch_workflow('pipeline.yml', '{"mode":"screener","tickers":"SP500"}'::jsonb);$c$);
select cron.alter_job((select jobid from cron.job where jobname = 'chop-scan-daily'),
                      command := $c$select public.dispatch_workflow('pipeline.yml', '{"mode":"chop-screener","tickers":"ALL"}'::jsonb);$c$);  -- stays 01:30 Tue-Sat
select cron.schedule('pipeline-sector-refresh',   '45 2 * * 2-6',  $c$select public.dispatch_workflow('pipeline.yml', '{"mode":"sector-refresh","tickers":"ALL"}'::jsonb);$c$);
-- Session-independent jobs go into regular trading hours, when no extended-hours scanner runs.
-- (Kept clear of the 14:35/14:45 UTC premarket settle + median jobs as they will sit after Nov 1.)
select cron.schedule('pipeline-nightly-onon',     '25 15 * * 1-5', $c$select public.dispatch_workflow('nightly-pipeline.yml');$c$);
select cron.schedule('pipeline-yahoo-ratings',    '40 15 * * *',   $c$select public.dispatch_workflow('pipeline.yml', '{"mode":"yahoo-ratings","tickers":"ALL"}'::jsonb);$c$);
select cron.schedule('pipeline-tipranks',         '10 16 * * 1-5', $c$select public.dispatch_workflow('tipranks-pipeline.yml');$c$);
select cron.schedule('workflow-dispatch-check',   '*/10 * * * *',  $c$select public.workflow_dispatch_check();$c$);
-- THEN remove the `schedule:` blocks from pipeline.yml, nrs-refresh.yml, nightly-pipeline.yml and
-- tipranks-pipeline.yml in the same session, or every job runs twice (the late GitHub copy as well).

-- ---------- PART 3: chop freshness check, DST-proof ------------------------------------------
-- Chop dispatches at 01:30 UTC = 21:30 EDT but 20:30 EST, finishing ~21:15 EST — BEFORE the current
-- 21:30 ET due time, so from Nov 2 the check would raise a false "critical" every weekday night.
-- New rule: a run must complete after 20:15 ET, judged from 22:45 ET (20:15 + 150 min).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.chop_scan_integrity_check(boolean,timestamptz)'::regprocedure);
  if position($a$interval '21 hours 30 minutes'$a$ in d) = 0 or position($a$interval '90 minutes'$a$ in d) = 0 then
    raise exception 'anchors not found';
  end if;
  d := replace(d, $a$interval '21 hours 30 minutes'$a$, $a$interval '20 hours 15 minutes'$a$);
  d := replace(d, $a$interval '90 minutes'$a$, $a$interval '150 minutes'$a$);
  execute d;
end $$;
-- VERIFY PART 3 with p_now (no logging):
--   select * from chop_scan_integrity_check(false);                                  -- expect no freshness row
--   select * from chop_scan_integrity_check(false, '2026-09-22 14:00+00');           -- expect freshness critical (real outage)
