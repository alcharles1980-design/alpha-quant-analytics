-- Oct 31 2026. Applied as migration predictor_outcomes_fill_recent_only.
--
-- Why: cron job predictor-outcomes calls predictor_outcomes_fill() with no date at 17:30 ET, and the old
-- body then recomputed EVERY predictor_snapshots row from signal_rth_bars, using a 40-day window of prior
-- bars per row. signal_rth_bars is to keep only its newest 60 sessions. Under the old body, every snapshot
-- whose 40-day window crossed the purge cutoff would have been rewritten each day against a truncated
-- baseline: 1,038 rows at a cutoff of 2026-08-06, silently.
--
-- Before the change, the stored outcomes matched a full recompute exactly (0 of 2,789 rows differed), so
-- making outcomes final after 14 days loses nothing. A specific p_date still recomputes that day.
-- Grants are unchanged by CREATE OR REPLACE (postgres, service_role; anon cannot execute).

create or replace function public.predictor_outcomes_fill(p_date date default null::date)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '60s'
as $function$
declare n_out int;
begin
  with rel as (
    select b.ticker, b.trade_date, b.trades, b.high, b.low,
           (select avg(p.trades) from signal_rth_bars p
             where p.ticker=b.ticker and p.trade_date < b.trade_date
               and p.trade_date >= b.trade_date - 40) avg20
    from signal_rth_bars b
    where (p_date is null and b.trade_date >= current_date - 14) or b.trade_date = p_date
  )
  update predictor_snapshots s
     set rth_trades   = r.trades,
         rth_rel      = case when r.avg20>0 then r.trades/r.avg20*100 end,
         rth_range_pct= case when r.low>0 then (r.high-r.low)/r.low*100 end,
         hit_120      = case when r.avg20>0 then (r.trades/r.avg20*100) >= 120 end,
         outcome_at   = now()
    from rel r
   where r.ticker = s.ticker and r.trade_date = s.session_date
     and (p_date is null or s.session_date = p_date);

  get diagnostics n_out = row_count;
  return n_out;
end;
$function$;

-- Also Oct 31 2026: hidden-level retention, cron job 88 (applied).
-- select cron.schedule('purge_hidden_levels', '47 3 * * *', $cmd$
--   delete from hidden_levels where session_date < (
--     select session_date from (select distinct session_date from hidden_levels order by 1 desc offset 29 limit 1) s);
-- $cmd$);

-- PENDING user approval (the one-time delete was blocked in-session). Once the delete is done:
--   delete from signal_rth_bars where trade_date < '2026-08-06';   -- 46,880 rows, 53 dates
--   vacuum (full, analyze) public.signal_rth_bars;
--   select cron.schedule('purge_signal_rth_bars', '49 3 * * *', $cmd$
--     delete from signal_rth_bars where trade_date < (
--       select trade_date from (select distinct trade_date from signal_rth_bars order by 1 desc offset 59 limit 1) s);
--   $cmd$);
