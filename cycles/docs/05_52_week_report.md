# 05. The 52-week report ("Average Daily Volume Segmented Stocks List \<start\> to \<end\>")

Code: `code/consist_report.py` (`main()` computes, `write_outputs()` formats). Command: `python3 consist_report.py --weeks 52 [--end-week YYYY-MM-DD]`.

## 1. Look-back

- N complete Monday–Friday weeks (Albert uses **52**), ending with `--end-week` (a Monday) or, by default, the latest **completed** week. A week is complete when its last session is done after 20:00 ET; normally that's Friday.
- Example: `--weeks 52 --end-week 2026-10-26` → Mon 3 Nov 2025 … Fri 30 Oct 2026. Tag `2025-11-03_to_10-30`, folder `out_2025-11-03_to_10-30_official`.
- The sessions of each week come from the Alpaca calendar (holidays are skipped).

## 2. Data preparation

1. Point-in-time weekly lists → `weekly_lists.parquet` and `weeks_on_list.parquet` (see `03_universe_and_lists.md` B).
2. Members = the latest snapshot's four lists (`members.json`).
3. Minute bars for every member and session (pulled if missing), plus the overnight bars before each session.
4. **Split factors.** For every session and symbol: raw daily close ÷ split-adjusted daily close, snapped to a simple ratio (fraction with denominator ≤ 10; 1 when within 0.1%).
   - Weekly runs: a week that contains a split is put on its **last session's** share basis (bars divided by factor ÷ that day's factor). All other weeks use raw prices, as the bot saw them.
   - The continuous run puts everything on **today's** share basis.
5. **New listings.** Minute bars before a symbol's first official daily bar are dropped. Older prints can belong to a different security that used the ticker (e.g. SPCX before the SpaceX listing).

## 3. Weekly simulations (fresh each week) → `weekly_results.parquet`

For every member and week:
- Bars = all overnight + SIP bars of the bot week (Sunday 20:00 → Friday 20:00), run with `botsim.run_stock(bars, dict(amount=1.0))` (base settings).
- `daily()` is computed over the sessions the stock traded that week.

| Field | Formula |
|---|---|
| `cap` | mean daily exposure over the sessions traded |
| `profit`, `fees`, `cycles` | sums over the week |
| `net` | profit − fees |
| `ret` | profit / cap, only when cap ≥ $0.50 (else NaN) |
| `open_lots`, `open_cost`, `open_value` | lots still held at the end, their cost, their value at the last price |
| `wk_range` | highest high ÷ lowest low − 1 over the 04:00–20:00 bars |
| `wk_chg` | last close ÷ first open − 1 |

Reference: 52 weeks × 319 names = 16,430 rows (names that didn't trade in a week have no row).

## 4. Per-stock weekly statistics

Each statistic is taken over all weeks with a return, **on the list or not**:

| Column | Formula |
|---|---|
| Avg weekly return (cycles) `avg` | mean of `ret` |
| Median / Worst / Best weekly return (cycles) | median / min / max of `ret` |
| Std dev `std` | standard deviation of `ret` |
| Number of weeks with returns of 10% or more (cycles) `wk10` | count of `ret ≥ 0.10` |
| Avg capital exposed ($) `cap` | mean of weekly `cap` |
| Avg net $ per week `net_wk` | mean of `net` |
| Avg week range `range` | mean of `wk_range` |

## 5. Continuous capital run (one run per stock over the whole look-back) → `continuous.parquet`

- One simulation from the first bar of the look-back to the latest completed session, **lots carried throughout**, as the bot does, at $1 per level.
- Grid: when the look-back is over 13 weeks (the 52-week case), **percent shape** (`dict(amount=1, shape=None)`): geometric 0.1% levels, 0.5% targets, rounded to cents. Otherwise the base cents grid. Prices are on today's share basis.

| Column | Formula |
|---|---|
| Range low / Range high (`lo`, `hi`) | lowest low / highest high of the 04:00–20:00 bars over the run; Range % = hi / lo − 1 |
| Realized $ (`realized`) | Σ cycle profit; `fees` = Σ fees |
| Avg capital exposed (continuous) `avg_cap` | mean daily exposure |
| Capital now `cap_now` | cost of lots still held at the end |
| Open lots at market `value_now` | Σ qty × last price; `open_lots_now` = their count |
| Open P&L `open_pl` | value_now − cap_now. Open P&L % = open_pl / cap_now |
| Return on capital now `ret_cap_now` | realized / cap_now (only if cap_now ≥ $0.50) |
| Return on avg capital `ret_avg_cap` | realized / avg_cap (only if ≥ $0.50) |
| Total P&L incl. open lots `total_pl` | realized − fees + open_pl |

## 6. Price check (split-adjusted daily closes, Alpaca, from 330 days before the look-back to the latest close)

| Column | Formula |
|---|---|
| Peak close in look-back `peak`, Peak date | max close from the look-back's first Monday to the latest close, and its date |
| Price (latest close) / "Now" `price` | latest completed regular close |
| From peak | price / peak − 1 |
| 100-day / 200-day moving average price | simple mean of the last 100 / 200 closes (needs full history, else n/a) |
| Price difference vs 100-/200-day moving average | price / average − 1 (negative = below) |
| 4-mo return (Strategy A score) `mom_4` | close[-1] / close[-85] − 1, i.e. 84 sessions back (needs > 84 closes) |

## 7. Analyst columns

These are joined from `analyst/analyst_snapshot_latest.csv` (see `02_data_sources_and_apis.md`): y_rating, y_score, y_n_ratings, y_buys, y_holds, y_sells, y_n_targets, y_target_avg/low/high, tr_rating, tr_n_ratings, tr_target_avg, analyst_asof.

Upside = y_target_avg / price − 1 and TipRanks upside = tr_target_avg / price − 1, using the report's own latest close.

## 8. List-level figures (the summary table)

For each list, over its members:

| Column | Formula |
|---|---|
| Names | member count |
| Avg weekly return (cycles) | mean over the 52 weeks of the **list's weekly return** = Σ members' profit ÷ Σ members' cap that week (capital-weighted) |
| Worst weekly return (cycles) | min of those weekly list returns |
| Number of weeks with list returns of 5% or more (cycles) | count of weekly list returns ≥ 5%, shown "N of 52" |
| Median from peak | median of members' from_peak |
| Share of names above their 200-day moving average | count(vs_sma200 > 0) / count(vs_sma200 known) |
| 4-mo return: median (positive) | median mom_4 (count > 0 of count known) |
| Capital now, Open P&L, Realized $ | sums; Open P&L also as % of Σ capital now |
| On capital now / On avg capital | Σ realized / Σ cap_now, Σ realized / Σ avg_cap |
| Rated Buy or better | among non-fund names with a rating: count of Strong Buy or Buy, "k of n stocks" |
| Median upside | median Yahoo upside of those rated stocks |
| TipRanks coverage | count with a TipRanks target, "k of n" |

## 9. Ordering

- Stocks within each list are sorted by **Avg weekly return (cycles)**, highest first; blanks last.
- The chat shows all of the $10bn and $5bn lists and the **top 25** of the $1bn and $500m lists. The workbook has everything.

## 10. Saved files (allow re-rendering without re-simulating)

The output folder holds `weekly_lists.parquet`, `weeks_on_list.parquet`, `members.json`, `split_factors.parquet`, `weekly_results.parquet`, `price_dimension.parquet`, `continuous.parquet`, `stats.parquet`, `momentum.parquet` and `meta.json` (tag, mode, snap, last_date, cont, cont_grid, lot), plus the workbook and `chat_<tag>.md`.

`python3 consist_report.py --render-only OUT_DIR` rebuilds the workbook and chat from these files. Use it after an analyst refresh.

## Runtime

The first 52-week run pulls about 1.2 GB of minute bars and simulates 16k stock-weeks plus 319 year-long runs. That's tens of minutes on 2 cores (the weekly runs use a 2-process pool).
