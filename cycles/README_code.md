# Code map

| File | Role |
|---|---|
| `config.py` | Folders (env-overridable) and the offline switch. No keys |
| `data.py`, `scan_orig.py`, `sss/alpaca.py` | Alpaca helpers: HTTP with retries, trading calendar, minute/daily bars (keys from the environment) |
| `botsim.py` | **The cycles-bot simulator.** Standalone (numpy, pandas, numba). `run_stock()`, `daily()`, `BASE` |
| `example_run.py` | Runs the simulator on `../samples/sample_TQQQ_2026-10-26_to_30.csv` |
| `build_lists.py` | The four ADV lists from Polygon (universe + grouped daily) |
| `analyst_snapshot.py` | Analyst snapshot from the owner's app (Supabase REST); appends analyst columns to the list CSVs |
| `pull_boats.py` | Overnight 1-minute bars (Alpaca `feed=boats`), one file per session |
| `consist_report.py` | The 52-week report: weekly lists, minute pulls, split factors, weekly sims, continuous run, price check, momentum, analyst join, and **`write_outputs()` = the exact output format** (also used by the day/week reports) |
| `day_rank.py` | One-day ranking data (bot day, PT sweep, true range, ATR14) |
| `week_rank.py` | Weekly ranking data (the report's weekly run + PT sweep) |
| `day_segmented.py` | Renders a day (`DAY PREV`) or week (`--week MONDAY PREV_FRIDAY`) ranking in the segmented format |

Tested on 1 Nov 2026:
- `build_lists.py 2026-10-30` gave the same 4 lists, order and ADV as the originals.
- `day_rank`/`week_rank` data was identical.
- `day_segmented` chat tables were byte-identical.
- `consist_report.py --weeks 1 --end-week 2026-10-26` weekly results were identical to that week of the 52-week run.

`day_rank.py` also writes an old standalone workbook and md. Those are retired; only the `day_segmented.py` output is delivered.
