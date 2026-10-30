-- 2026-10-30: mark_glance_tipranks_nocoverage(ticker) (migration glance_tipranks_nocoverage_marker).
--
-- WHY. Stocks at a Glance re-requests TipRanks for any row whose fetched_at is older than 24 h.
-- TipRanks answers 404 for tickers it does not cover (ETFs: SPY, QQQ, TLT, the XL sector funds, ...),
-- and nothing ever set fetched_at for them, so every time a list was opened each ETF was requested
-- again. The Tracking list (Oct 29) holds ~40 of them: ~40 wasted requests per open, enough on their
-- own to trip TipRanks' burst limit.
--
-- WHAT. Called only on a 404 from TipRanks. Sets fetched_at = now() so the ticker is not re-asked for
-- 24 h, and ONLY on a row that holds no TipRanks data (no score, no PT, no ratings). A covered stock
-- that 404s once (delisting, a TipRanks hiccup) keeps its data untouched. Refusals (403/429/5xx) must
-- never call this; they are retried instead. Returns true when it marked the row.
--
-- Grants follow the save_glance_* functions it sits beside: the app calls it with the anon key. The
-- worst an anon caller can do is postpone the next TipRanks request for a no-data row by 24 h.

create or replace function public.mark_glance_tipranks_nocoverage(p_ticker text)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  insert into stocks_glance_cache (ticker, fetched_at) values (p_ticker, now())
  on conflict (ticker) do update set fetched_at = now()
  where stocks_glance_cache.smart_score is null
    and stocks_glance_cache.pt_avg is null
    and coalesce(stocks_glance_cache.buy, 0) + coalesce(stocks_glance_cache.hold, 0)
        + coalesce(stocks_glance_cache.sell, 0) = 0;
  get diagnostics n = row_count;
  return n > 0;
end $function$;

revoke all on function public.mark_glance_tipranks_nocoverage(text) from public;
grant execute on function public.mark_glance_tipranks_nocoverage(text) to anon, authenticated, service_role;
