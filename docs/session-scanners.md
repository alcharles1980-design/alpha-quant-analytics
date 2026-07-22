# Session Scanners — Overnight / Pre-Market

Backend notes for the Most Actives session tabs. All of this runs Supabase-side (pg_cron ->
Edge Function -> RPC) and consumes no GitHub Actions minutes.

## Why the scanners exist

Alpaca's most-actives screener has exactly one mode: cumulative regular-session activity, refreshed
after the close. It has no session parameter — `session=pre` and `feed=boats` both return
`400 unexpected query parameter`. So overnight and pre-market rankings have to be built by scanning.

## Overnight (8PM-4AM ET)

- Source: BOATS (Blue Ocean ATS) **daily** bars — one bar IS the whole session, so the scan is cheap.
- Universe: full ~11,000 tradeable names.
- Bar timestamps: stamped `00:00Z` for the session that BEGAN 8PM ET the previous evening.
- Cron: `*/10 0-8 * * *` live, settle at `30 8 * * *`.

## Pre-Market (4:00-9:30 ET)

- Source: SIP **minute** bars aggregated over the window. A 1Day SIP bar covers the whole trading
  day (measured: NVDA 109M shares), so it cannot isolate pre-market.
- Universe: (chop universe UNION traded-overnight) with a $0.5B cap floor for STOCKS, **ETFs exempt**
  — an ETF's "market cap" is AUM, and the floor was excluding SOXL/SOXS/DRAM/SNXX/KORU/TQQQ, which
  dominate pre-market trade counts. ~2,700 symbols, ~3.5MB/scan vs ~14MB for a full scan.
- Cron: `*/3 8-13 * * 1-5` live, settle at `35 13 * * 1-5`.

## Prior-close cache (`prev_rth_closes`)

Shared by both scanners. Yesterday's close is static, but both used to refetch it for every symbol
on every run — it was the dominant cost in each.

| Scanner | Before | After |
|---|---|---|
| Pre-market | ~20s | **2.2s** |
| Overnight | ~108s | **24s** |

Cache is ~1.1MB for ~11,000 rows, 14-day retention.

## Bugs found and fixed (worth not reintroducing)

1. **Settle run targeted the wrong session.** The overnight function infers its session from the
   clock (`if utcHour >= 8: target = tomorrow`). The settle cron runs at 08:30Z, so it rolled to
   TOMORROW, scanned a session that didn't exist, and left the real one partial and 10 minutes
   short — while reporting success. The settle cron now passes `session_date` explicitly, the live
   window was extended `0-7` -> `0-8`, and `is_partial` now also requires the target to be today's
   session so re-scanning a past session can't mark it partial.

2. **PostgREST 1000-row cap, twice.** `premarket_scan_universe()` returned `SETOF text` and was
   silently truncated to 1,000 of 2,712 symbols. Returning `text[]` (one row) fixes it. The same
   cap applies to the universe load in the overnight function, which pages with Range headers.

3. **Overnight-only logic that missed pre-market.** The Top N display cap, the in-memory sort
   buttons, `needsAlpaca` and the fetchData key guard all said `session==='overnight'` where they
   needed to include `'premarket'`.

## Data notes

- `is_partial` is true only while the session is live and being scanned.
- `avg_sessions` (SESSIONS / IN AVERAGE) is the number of prior sessions behind the ratio columns.
  Below ~5 the percentages are statistically thin — the column exists to make that visible.
- GAP % is overnight/pre-market only by design: RTH's MOVE % is already measured against the prior
  close, so a gap column there would duplicate it.
