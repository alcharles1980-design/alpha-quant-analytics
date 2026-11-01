# 06. One-day ranking and weekly ranking

Both reports are **the 52-week report with extra period columns** inserted right after "Weeks on list", ranked by the period's return.

Code:
- `day_rank.py` / `week_rank.py` compute the period data.
- `day_segmented.py` renders it through `consist_report.write_outputs(..., day=...)`.

All the 52-week columns come from the latest finished 52-week run folder and the latest analyst snapshot.

## A. One-day ranking (`python3 day_rank.py DAY PREV SNAP`, e.g. `2026-10-30 2026-10-29 2026-10-30`)

1. Names = the $500m list of snapshot SNAP (it contains every name on all four lists).
2. **Bot day** = 20:00 ET on PREV → 20:00 ET on DAY: the overnight bars filed under DAY plus DAY's SIP bars 04:00–20:00. **Fresh start** at the first bar. Names with fewer than 10 bars are skipped.
3. **Profit-taker sweep.** Run `botsim.run_stock(bars, dict(pt=PT×100, amount=1.0))` for PT ∈ {0.10, 0.15, 0.20, 0.25, 0.30, 0.35, 0.40, **0.50**, 0.60, 0.75, 1.00, 1.25, 1.50, 2.00}%.
   - The step stays the base whole-cent step max(1¢, 0.1%), so each PT is (PT / 0.1) steps, rounded to the cent.
   - **0.5% is the list's base setting.**
   - For each run, compute `daily()` for DAY: exposure, profit, cycles, fees.
4. Return = profit / exposure when exposure ≥ $0.50; after fees = (profit − fees) / exposure.
5. **Best profit taker** = the PT with the highest return **after fees**. Ties go to the smallest PT.
6. Price columns:

| Column | Formula |
|---|---|
| Low / High | lowest low / highest high over the bot day (overnight included) |
| Day's range | (High − Low) / Low |
| Prior close `pc` | close of PREV's last bar before 20:00 (the "8 pm close") |
| True range | (max(High, pc) − min(Low, pc)) / pc |
| True range, regular hours | same with only 9:30–16:00 bars and PREV's last regular-hours close |
| Close (8 pm) | DAY's last bar close; Change vs prior close = Close / pc − 1 |
| ATR14 % | 14-day mean of daily true range (raw daily bars: max(h, prev c) − min(l, prev c)) ÷ close, as of DAY |

7. Saved as `reports/day_rank/day_rank_<DAY>.parquet`, indexed by sym, with columns:
   - best PT: `best_pt, ret_best, net_best, profit_best, cap_best`;
   - at 0.5%: `ret5, net5, profit5, cap5, cyc5, fees5, step`;
   - price: `low, high, range, tr, tr_reg, close, chg, small, atr14p`.

   The full sweep goes to `day_rank_sweep_<DAY>.parquet`. (The script also writes an older standalone workbook and md; **those are retired**. Only the segmented render below is sent.)

8. Render: `python3 day_segmented.py DAY PREV [RUN_DIR]` → `reports/day_reports/<DAY>/`.

## B. Weekly ranking (`python3 week_rank.py MONDAY SNAP`, e.g. `2026-10-26 2026-10-30`)

1. Exactly the 52-week report's weekly run: bot week Sunday 20:00 → Friday 20:00, fresh start, same split handling, return = week profit / mean daily exposure. Plus the same PT sweep.
   - **Check:** the 0.5% return equals that week's `ret` in `weekly_results.parquet`. It matched exactly for 26–30 Oct 2026.
2. Best PT, the $0.50 minimum, and ties work as above.
3. Price columns:
   - Low / High = over all the week's bars (overnight included).
   - Week's range = (High − Low) / Low.
   - Prior close = the previous Friday's last bar before 20:00. True range and change use it.
   - Regular-hours true range uses 9:30–16:00 bars against the previous Friday's regular close.
   - ATR14 % is taken as of Friday, from the Friday day-ranking file when it exists.
4. Saved as `reports/day_rank/week_rank_<MONDAY>.parquet` (same columns as the day file).
5. Render: `python3 day_segmented.py --week MONDAY PREV_FRIDAY [RUN_DIR]` → `reports/week_reports/<MONDAY>/`.

## C. How the period columns appear (both reports)

- Period label `DN`:
  - day: `Fri 30 Oct` (format `%a %d %b`);
  - week: `Week 26-30 Oct` (`Week 26 Oct-02 Nov` when the week crosses a month end).
- **Ranking within each list:** period return at the best PT, high to low; then return at 0.5%; then the 52-week Avg weekly return. Blanks go last.
- **Rank at 0.5%** = rank of the 0.5% return within that list (method "min"), shown in brackets: `5.7% (2)`.
- A `#` column (1, 2, 3 …) leads each stock table.
- Names under $0.50 exposed show `–`, `under $0.50 exposed`, `–` in the three return cells.
- Summary table: four extra columns after "Names":
  - list return at 0.5% = Σ profit at 0.5% ÷ Σ capital at 0.5% (capital-weighted, 2 decimals);
  - list return at each stock's best profit taker = Σ profit_best ÷ Σ cap_best;
  - profit at 0.5% shown as "$X on $Y";
  - median true range.
- The exact header texts, notes and workbook columns are in `07_output_format.md`.

## Reference results

| | $10bn | $5bn | $1bn | $500m |
|---|---|---|---|---|
| Fri 30 Oct 2026, list return at 0.5% | 3.73% | 3.27% | 3.27% | 3.52% |
| Fri 30 Oct 2026, at each stock's best PT | 4.32% | 3.81% | 3.70% | 4.06% |
| Week 26–30 Oct 2026, list return at 0.5% | 10.80% | 9.71% | 9.87% | 10.05% |
| Week 26–30 Oct 2026, at each stock's best PT | 12.96% | 11.48% | 10.87% | 10.99% |

Top names:
- Friday: SOXL ($10bn, 6.8% at best PT 2%), TWLO ($1bn and $500m, 28.1% at 0.6%).
- Week: SOXL ($10bn, 27.4% at 2%), MRNA ($1bn and $500m, 38.4% at 0.75%).
