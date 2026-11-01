# 10. Runbook

All commands run from `code/`. Folders come from `config.py` (default `../data`). Keys come from the environment.

## First-time setup

```bash
pip install -r requirements.txt            # numpy, pandas, numba, pyarrow, requests, openpyxl (tested: numpy 2.5, pandas 3.0, numba 0.68)
export APCA_API_KEY_ID=...  APCA_API_SECRET_KEY=...  POLYGON_API_KEY=...
export SB_URL=... SB_PUBLISHABLE_KEY=...    # optional: analyst source (owner's app)
export ADV_KIT_DATA=/path/to/data          # optional: where bars, lists and reports go
python3 example_run.py ../samples/sample_TQQQ_2026-10-26_to_30.csv   # checks the simulator (no keys needed)
```

## 1. Build the four lists (when Albert asks to update the lists, or weekly)

Run after 20:00 ET on the snapshot day, or any later day for a past session:
```bash
python3 build_lists.py 2026-10-30      # -> universe/adv_over_{500m,1bn,5bn,10bn}_2026-10-30.csv
```

## 2. Analyst snapshot (every so often; not live)

```bash
python3 analyst_snapshot.py            # latest snapshot lists -> universe/analyst/analyst_snapshot_latest.csv + columns on the list CSVs
```

## 3. The 52-week report

```bash
python3 consist_report.py --weeks 52 --end-week 2026-10-26
#   pulls missing minute + overnight bars, runs everything, writes reports/out_2025-11-03_to_10-30_official/
python3 consist_report.py --render-only ../data/reports/out_2025-11-03_to_10-30_official   # re-render after an analyst refresh
```

Each new week, run it again with the new `--end-week`. Minute bars are cached, so only the new week is pulled. The weekly simulations are recomputed.

## 4. One-day ranking ("give me Friday's ranking")

```bash
python3 day_rank.py 2026-10-30 2026-10-29 2026-10-30      # DAY, previous session, list snapshot
python3 day_segmented.py 2026-10-30 2026-10-29            # -> reports/day_reports/2026-10-30/ (workbook + chat_day_2026-10-30.md)
```

## 5. Weekly ranking ("rankings for last week")

```bash
python3 week_rank.py 2026-10-26 2026-10-30                # MONDAY, list snapshot
python3 day_segmented.py --week 2026-10-26 2026-10-23     # MONDAY, previous Friday -> reports/week_reports/2026-10-26/
```

`day_segmented.py` uses the newest `out_*_official` folder unless you pass one as the last argument. Make sure that 52-week run covers the period (its price check date shows in the title).

## 6. Deliver

1. Send the workbook.
2. Post the chat tables from the `chat_*.md` file: the title, notes, summary table and all four list sections, exactly as written.
3. Add one or two sentences, e.g. "At list settings each list made about 10% for the week."

## Pulling bars on their own

```bash
python3 pull_boats.py 2026-10-26 2026-10-30 tickers.txt   # overnight bars, one file per session (night before it)
python3 -c "import consist_report as CR; CR.ensure_minutes(open('tickers.txt').read().split(), ['2026-10-30'])"
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `the 20-session window ends ...` | The snapshot date isn't a completed session yet; wait until after 20:00 ET |
| Analyst columns all `n/a` | `SB_URL` / `SB_PUBLISHABLE_KEY` not set, or the app hasn't captured those names; refresh in the app, then re-run step 2 and `--render-only` |
| A stock shows n/a returns | Under $0.50 average capital (barely traded) or no bars that period |
| Returns far too low on liquid names | Overnight (BOATS) bars missing for those sessions |
| A stock's prices jump by a ratio | Split not handled: check `split_factors.parquet` (raw ÷ split-adjusted close) |
| HTTP 429 | Rate limit; the helpers retry. Lower concurrency if it persists |
