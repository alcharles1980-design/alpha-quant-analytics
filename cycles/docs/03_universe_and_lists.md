# 03. Universe and the four lists

Code: `code/build_lists.py` (snapshot lists) and `consist_report.weekly_lists()` (point-in-time weekly lists for "weeks on list").

## A. The snapshot lists (what "the four lists" means)

Input: a **snapshot date** = a completed session. Example: 2026-10-30, built after 20:00 ET that day.

1. **Universe.** Every active US-listed ticker in Polygon reference data with type in {CS, OS, ADRC, GDR, NYRS, ETF, ETN, ETV, ETS}. That's common stocks, ordinary shares, ADRs, GDRs, NY registry shares and exchange-traded products. Not included: preferreds, warrants, rights, units, closed-end funds, OTC. (Until 1 Nov 2026 the lists were limited to S&P 500 / Nasdaq-100 / Russell 2000 members plus top ADRs and ETFs. Albert switched to all US listings so names like CBRS are included.)
2. **Window.** The 20 trading sessions ending on the snapshot date (Alpaca calendar). A session only counts once 20:00 ET has passed. For 2026-10-30 the window is 2026-10-05 → 2026-10-30.
3. **Daily notional.** For each ticker and session: Polygon grouped-daily `vw × v` (VWAP × volume, all consolidated trades incl. extended hours); `c × v` if VWAP is missing.
4. **ADV20** = the **mean of daily notional over the sessions the ticker traded** in the window (not divided by 20 when it traded fewer days). Also kept: median20_notional, sessions_traded, avg20_trades / median20_trades (Polygon `n`), avg20_trade_size_usd = Σ notional / Σ trades, last_close.
5. **Eligibility.** Traded on the snapshot date **and** on at least 5 of the 20 sessions. This drops delisted names and one-day prints.
6. **Lists:** ADV20 **strictly greater** than $500,000,000 / $1,000,000,000 / $5,000,000,000 / $10,000,000,000. Each list is sorted by ADV20, high to low, and `rank_in_list` starts at 1. The lists are nested: a $10bn name is on all four.
7. Output CSV columns: `snapshot_date, list_name (ADV_OVER_500M|1BN|5BN|10BN), threshold_usd, rank_in_list, ticker, name, asset_type, universes, adv20_notional, median20_notional, avg20_trades, median20_trades, avg20_trade_size_usd, last_close, market_cap, window_start, window_end`. `analyst_snapshot.py` then appends the analyst columns.

Reference sizes on 2026-10-30: **$500m 319, $1bn 157, $5bn 21, $10bn 15.** The kit's `build_lists.py` reproduced all four lists exactly: same names, same order, ADV equal to the cent.

$10bn list on 2026-10-30, by ADV20 from highest: SPY ($30.17bn/day), QQQ ($28.39bn), MU ($24.76bn), NVDA, SPCX, META, AAPL, TSLA, SNDK, MSFT, AMD, INTC, GOOGL, AMZN, SOXL. See `reference_outputs/lists_2026-10-30/` for every list.

## B. Point-in-time weekly lists ("Weeks on list")

The 52-week report asks, for each member: in how many of the 52 weeks was it big enough for this list **at that time**?

- Data: Alpaca **daily** bars, `adjustment=raw`, `feed=sip`. Daily $ volume = `v × vw` (`c` if VWAP is missing).
- ADV = 20-session rolling mean with at least 15 sessions (`rolling(20, min_periods=15)`).
- For each Monday of the look-back, take the ADV as of the **last session before that Monday** and check it against each cut-off (strictly greater).
- `Weeks on list` = how many Mondays the name was over that list's cut-off. New listings and recent risers show fewer weeks.
- The ticker set only needs to include the current members; each member's count depends only on its own history. Env var `ADV_WEEKLY_UNIVERSE` can point to a wider ticker file.
- This check uses Alpaca daily data, while the snapshot uses Polygon. Small differences near a cut-off are expected and accepted.

## C. Which names go into a report

- `--lists official` (default): **all members of the latest snapshot lists**, i.e. the four CSVs.
- `--lists consistent`: only names that were on the list in every week of the look-back (rarely used).

The weekly simulations run for every member, for **every week the stock traded**, whether it was on the list that week or not. That's why "Avg weekly return (cycles)" can cover weeks before a stock qualified.
