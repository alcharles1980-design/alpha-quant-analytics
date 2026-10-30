-- 2026-10-30: data_integrity_check() — replace the "baseline drift" check (migration
-- integrity_check_baseline_gap_replaces_drift) and measure storage against the real 500 MB quota
-- (migration integrity_check_storage_matches_quota_alert). Every other check is unchanged.
--
-- WHY. "baseline drift" compared each row's stored avg_sessions with a count of the prior rows that
-- STILL EXIST. The daily 30-day cleanup deletes the oldest sessions after the baselines were
-- correctly built with them, so every session aged into a mismatch: FAIL every hour since at least
-- Sep 28 (41,611 + 52,242 "bad" rows), all false. Measured Oct 29: the three newest sessions matched on
-- every row, older ones mismatched ~90%, always stored > expected, which is the retention signature.
-- It was also the most expensive thing on the hourly schedule: its self-join dragged whole rows
-- (count(p.*)) through a hash aggregate that spilled to disk, 5.3 s and ~370 MB of temp writes every
-- hour (EXPLAIN ANALYZE: temp written=44,919 blocks), on an instance whose freezes are disk-IO stalls.
--
-- REPLACEMENT: "baseline gap", the §5.1d invariant. On the latest settled session of each table,
-- every row that has a mean baseline from at least two prior sessions must also have a median. That
-- is the failure that shipped in July (medians computed but never INSERTed, so every row blank). Rows
-- with exactly one prior session are excluded: they get a mean but no median by design (4 such rows
-- across 72 sessions, all avg_sessions = 1). Single-session aggregates only, so it costs milliseconds.

create or replace function public.data_integrity_check(write_log boolean default true)
 returns table(check_name text, severity text, detail text)
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare r record;
begin
  create temp table _res (nm text, sev text, det text) on commit drop;

  for r in
    select 'freshness: '||t as nm, mins, live from (
      select 'overnight' t, round(extract(epoch from (now()-max(updated_at)))/60)::int mins,
             ((extract(hour from (now() at time zone 'America/New_York')) >= 20
               and extract(dow from (now() at time zone 'America/New_York')) between 0 and 4)
              or (extract(hour from (now() at time zone 'America/New_York')) < 4
               and extract(dow from (now() at time zone 'America/New_York')) between 1 and 5)) live
      from overnight_actives where session_date=(select max(session_date) from overnight_actives)
      union all
      select 'premarket', round(extract(epoch from (now()-max(updated_at)))/60)::int,
             (extract(hour from (now() at time zone 'America/New_York')) between 4 and 9
             and extract(dow from (now() at time zone 'America/New_York')) between 1 and 5)
      from premarket_actives where session_date=(select max(session_date) from premarket_actives)
      union all
      select 'aftermarket', round(extract(epoch from (now()-max(updated_at)))/60)::int,
             (extract(hour from (now() at time zone 'America/New_York')) between 16 and 19
             and extract(dow from (now() at time zone 'America/New_York')) between 1 and 5)
      from aftermarket_actives where session_date=(select max(session_date) from aftermarket_actives)
    ) z
  loop
    insert into _res values (r.nm,
      case when not r.live then 'OK' when r.mins > 20 then 'FAIL' when r.mins > 12 then 'WARN' else 'OK' end,
      r.mins||' min since last write'||case when r.live then ' (session LIVE)' else ' (closed — expected)' end);
  end loop;

  -- COVERAGE — settled sessions only.
  for r in
    select 'coverage: '||t nm, cur, med, partial from (
      select 'overnight' t,
        (select count(*) from overnight_actives o where o.session_date=(select max(session_date) from overnight_actives)) cur,
        (select percentile_cont(0.5) within group (order by c) from (select count(*) c from overnight_actives where not is_partial group by session_date) x) med,
        (select bool_or(is_partial) from overnight_actives where session_date=(select max(session_date) from overnight_actives)) partial
      union all
      select 'premarket',
        (select count(*) from premarket_actives p where p.session_date=(select max(session_date) from premarket_actives)),
        (select percentile_cont(0.5) within group (order by c) from (select count(*) c from premarket_actives where not is_partial group by session_date) x),
        (select bool_or(is_partial) from premarket_actives where session_date=(select max(session_date) from premarket_actives))
      union all
      select 'aftermarket',
        (select count(*) from aftermarket_actives a where a.session_date=(select max(session_date) from aftermarket_actives)),
        (select percentile_cont(0.5) within group (order by c) from (select count(*) c from aftermarket_actives where not is_partial group by session_date) x),
        (select bool_or(is_partial) from aftermarket_actives where session_date=(select max(session_date) from aftermarket_actives))
    ) z
  loop
    insert into _res values (r.nm,
      case when r.partial then 'OK'                        -- live session: row count still building
           when r.med is null or r.med=0 then 'OK'
           when r.cur < r.med*0.5 then 'FAIL'
           when r.cur < r.med*0.7 then 'WARN' else 'OK' end,
      r.cur||' rows vs settled median '||round(coalesce(r.med,0))
      ||case when r.partial then ' (session LIVE — still building, not judged)'
             else ' ('||round(100.0*r.cur/nullif(r.med,0))||'%)' end);
  end loop;

  for r in
    select 'arithmetic: '||t nm, bad from (
      select 'overnight' t, count(*) bad from overnight_actives
        where (open>0 and abs(pct_move-(close-open)/open*100)>0.01)
           or (avg_trades>0 and abs(rel_trades-trades/avg_trades*100)>0.01)
           or high<low or close>high or close<low
      union all
      select 'premarket', count(*) from premarket_actives
        where (open>0 and abs(pct_move-(close-open)/open*100)>0.01)
           or (avg_trades>0 and abs(rel_trades-trades/avg_trades*100)>0.01)
           or high<low or close>high or close<low
      union all
      select 'aftermarket', count(*) from aftermarket_actives
        where (open>0 and abs(pct_move-(close-open)/open*100)>0.01)
           or (avg_trades>0 and abs(rel_trades-trades/avg_trades*100)>0.01)
           or high<low or close>high or close<low
    ) z
  loop
    insert into _res values (r.nm, case when r.bad>0 then 'FAIL' else 'OK' end,
      r.bad||' rows where a derived column does not match its inputs');
  end loop;

  -- BASELINE GAP (Oct 30 2026; replaces "baseline drift", see the migration header). Latest settled
  -- session only: rows with a mean baseline from >= 2 prior sessions must also have a median (§5.1d).
  for r in
    select 'baseline gap: '||t nm, sd, gap, n from (
      select 'overnight' t, session_date sd,
             count(*) filter (where avg_trades is not null and avg_sessions >= 2 and med_trades is null) gap, count(*) n
        from overnight_actives where session_date = (select max(session_date) from overnight_actives where not is_partial) group by 2
      union all
      select 'premarket', session_date,
             count(*) filter (where avg_trades is not null and avg_sessions >= 2 and med_trades is null), count(*)
        from premarket_actives where session_date = (select max(session_date) from premarket_actives where not is_partial) group by 2
      union all
      select 'aftermarket', session_date,
             count(*) filter (where avg_trades is not null and avg_sessions >= 2 and med_trades is null), count(*)
        from aftermarket_actives where session_date = (select max(session_date) from aftermarket_actives where not is_partial) group by 2
    ) w
  loop
    insert into _res values (r.nm, case when r.gap > 0 then 'FAIL' else 'OK' end,
      r.gap||' of '||r.n||' rows have a mean baseline but no median (session '||r.sd||')');
  end loop;

  for r in select h.session_type st, h.verdict v from pace_curve_health() h loop
    insert into _res values ('pace curve: '||r.st,
      case when r.v like 'FAIL%' then 'FAIL' when r.v like 'WARN%' then 'WARN' else 'OK' end, r.v);
  end loop;

  -- STORAGE (Oct 30 2026): measured against the real free-plan quota, 500,000,000 bytes, at which
  -- Supabase stops serving requests. Thresholds match db_quota_alert() (WARN 430 MB, CRITICAL 460 MB,
  -- which pushes to the phone) so the two never disagree. It used 512 MiB with WARN at 70%, which
  -- understated usage by ~7% and warned on every hourly run.
  insert into _res
  select 'storage', case when b >= 460000000 then 'FAIL' when b >= 430000000 then 'WARN' else 'OK' end,
         round(b/1e6)||' MB of the 500 MB free quota ('||round(b/5e6,1)||'%; WARN at 430, FAIL at 460)'
  from (select pg_database_size(current_database()) b) z;

  if write_log then
    insert into integrity_log (check_name,severity,detail)
    select nm, sev, det from _res where sev<>'OK';
  end if;

  return query select _res.nm, _res.sev, _res.det from _res
    order by case _res.sev when 'FAIL' then 1 when 'WARN' then 2 else 3 end, _res.nm;
end;
$function$;
