-- 2026-10-30: ops.chop_scan_integrity_check — do not judge a chop scan that is still being written
-- (migration chop_check_skip_scan_in_progress). The freshness rule is unchanged.
--
-- WHY. The screener upserts its scan_date in batches, so for ~20-40 minutes the newest scan holds a
-- partial row count. The hourly :40 check ran chop_scan_health() on it regardless and logged a
-- "critical" row_count (e.g. "1200 rows vs trailing median 2410"). It did this ~10 times in the three
-- weeks before Oct 29, whenever a late GitHub run happened to straddle :40 (03:40, 05:40, 21:40 ET).
-- Once chop moved to a fixed 01:30 UTC dispatch (Oct 29), the 01:40 UTC check would catch it mid-run
-- EVERY weeknight in both seasons, so an occasional false critical would have become a nightly one.
--
-- RULE. A chop-screener run counts as in progress at p_now if it started by then and either finished
-- after p_now, or is still 'running' with a heartbeat within the last 15 minutes. While one is in
-- progress, the newest scan is reported as not judged instead of being checked. A run that dies stops
-- heartbeating, so 15 minutes later its partial scan is judged and still raises the critical.

create or replace function ops.chop_scan_integrity_check(p_log boolean default true, p_now timestamptz default now())
 returns table(check_name text, severity text, detail text)
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '60s'
as $function$
-- DST-proof replacement for public.chop_scan_integrity_check (Oct 29 2026). Same two checks.
-- Freshness: a chop-screener run must COMPLETE after 20:15 ET, judged from 22:45 ET (dispatch is
-- 01:30 UTC = 21:30 EDT / 20:30 EST). Health: chop_scan_health() on the newest scan, skipped while a
-- run is still writing it (Oct 30 2026). p_now exists so the check can be replayed at a past moment.
declare
  r record; v_sev text;
  et timestamp := p_now at time zone 'America/New_York';
  due timestamp; last_ok timestamptz; latest_scan date; running_since timestamptz;
  a_nm text[] := '{}'; a_sv text[] := '{}'; a_det text[] := '{}';
begin
  due := date_trunc('day', et) + interval '20 hours 15 minutes';
  if et < due + interval '150 minutes' then due := due - interval '1 day'; end if;
  while extract(isodow from due) in (6, 7) loop due := due - interval '1 day'; end loop;

  select max(p.updated_at) into last_ok from pipeline_status p
   where p.mode = 'chop-screener' and p.status = 'complete' and p.updated_at <= p_now;
  if last_ok is null or last_ok < (due at time zone 'America/New_York') then
    a_nm := a_nm || 'chop_scan: freshness'::text;
    a_sv := a_sv || 'critical'::text;
    a_det := a_det || ('no completed chop-screener run since the ' || to_char(due, 'Dy Mon DD HH24:MI')
             || ' ET due time; last completed '
             || coalesce(to_char(last_ok at time zone 'America/New_York', 'Dy Mon DD HH24:MI') || ' ET', 'never'));
  end if;

  select min(p.started_at) into running_since from pipeline_status p
   where p.mode = 'chop-screener' and p.started_at <= p_now
     and (p.updated_at > p_now
          or (p.status = 'running' and p.updated_at > p_now - interval '15 minutes'));

  select max(c.scan_date)::date into latest_scan from cached_chop_screener c;
  if latest_scan is not null and running_since is null then
    for r in select * from chop_scan_health(latest_scan) loop
      if r.out_status <> 'PASS' then
        v_sev := case when r.out_status = 'FAIL' then 'critical'
                      when r.out_status = 'WARN' then 'warning' else 'ok' end;
        a_nm := a_nm || ('chop_scan: ' || r.out_check);
        a_sv := a_sv || v_sev;
        a_det := a_det || (r.out_detail || ' [scan ' || latest_scan || ']');
      end if;
    end loop;
  end if;

  if p_log and cardinality(a_nm) > 0 then
    insert into integrity_log (check_name, severity, detail)
    select u.n, u.s, u.d from unnest(a_nm, a_sv, a_det) as u(n, s, d);
  end if;

  return query select u.n, u.s, u.d from unnest(a_nm, a_sv, a_det) as u(n, s, d);
end $function$;

-- The Oct 30 ops grant tightening (migration ops_functions_revoke_public_execute) set default
-- privileges for the schema, and CREATE OR REPLACE keeps the existing ACL, so no re-grant is needed.
-- Verify: select has_function_privilege('anon','ops.chop_scan_integrity_check(boolean,timestamptz)','execute');  -- false
