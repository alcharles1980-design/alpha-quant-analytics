# 02. Data sources and APIs

All times are **US Eastern (America/New_York)**. All dates are **exchange session dates** in ET, never the server's UTC date. A session counts as finished at **20:00 ET**, when the extended session closes.

## Keys (environment variables only; never in code, files or chat)

| Variable | Used for |
|---|---|
| `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY` | Alpaca market data (bars, calendar). Needs a market-data plan that allows `feed=sip` (consolidated) and `feed=boats` (overnight) |
| `POLYGON_API_KEY` | Polygon (now Massive) reference tickers, grouped daily bars, ticker details |
| `SB_URL`, `SB_PUBLISHABLE_KEY` | Optional. The owner's analyst source: a Supabase REST endpoint of Albert's "AQA" app (see below) |

## Alpaca (https://data.alpaca.markets/v2)

Headers: `APCA-API-KEY-ID`, `APCA-API-SECRET-KEY`. Responses are paged with `next_page_token`. Retry on 429/5xx (`code/data.py`).

| Call | Parameters | Use |
|---|---|---|
| `GET https://paper-api.alpaca.markets/v2/calendar?start=&end=` | dates | Trading sessions (holidays, half days). `scan_orig.cal()`, `sss.alpaca.calendar()` |
| `GET /v2/stocks/bars` 1-minute | `symbols` (≤200 per call), `timeframe=1Min`, `start` = 04:00 ET as UTC, `end` = 19:59 ET as UTC, `feed=sip`, `adjustment=raw`, `limit=10000` | The 1-minute session bars, 04:00–20:00 ET. Stored per session: `<minutes>/<YYYY-MM-DD>.parquet`, columns `sym, t, o, h, l, c, v`, with `t` = naive Eastern time. `consist_report.ensure_minutes()` |
| `GET /v2/stocks/bars` overnight | `timeframe=1Min`, `feed=boats`, start = 4 days before the first session, end = last session 04:00 ET, ≤100 symbols per call | Blue Ocean overnight bars. Only bars with hour ≥ 20 or < 4 are kept. Each night is filed under the **session it precedes**: `<boats>/<session>.parquet` holds the previous day 20:00 → session 04:00. `pull_boats.py` |
| `GET /v2/stocks/bars` daily | `timeframe=1Day`, `adjustment=raw` or `split`, `feed=sip` | Raw: daily $ volume for the weekly point-in-time lists, split factors, ATR14. Split-adjusted: price checks (peak, moving averages), momentum, split factors, latest close for analyst upside. `sss/alpaca.daily_bars()` returns `sym, date, o, h, l, c, v, vw, n` |

Notes:
- Raw (unadjusted) minute prices are what the bot actually saw. Splits are handled separately (see `05_52_week_report.md`).
- Thin names may have minutes with no trade (no bar), or no overnight trading at all. That's normal.
- Data volume: about 4.5 MB of minute bars per session for 319 names, so roughly 1.2 GB for 52 weeks. Overnight files are about 0.15 MB per session.

## Polygon (https://api.polygon.io), key as `apiKey=` parameter

| Call | Use |
|---|---|
| `GET /v3/reference/tickers?market=stocks&active=true&limit=1000` (follow `next_url`) | The universe: every active US-listed ticker with `type`. Kept types: CS, OS, ADRC, GDR, NYRS, ETF, ETN, ETV, ETS. Cached 3 days in `polygon_reference_tickers.parquet` |
| `GET /v2/aggs/grouped/locale/us/market/stocks/{date}?adjusted=true` | One row per ticker per session: `T` (ticker), `v` (volume), `vw` (VWAP), `o, h, l, c`, `n` (trades). Covers all consolidated trades incl. extended hours. Cached per date in `universe/grouped/<date>.parquet` |
| `GET /v3/reference/tickers/{ticker}` | `market_cap` (informational column only) |

## Analyst data (owner's app; snapshot, not live)

Albert's AQA app already collects analyst data into its own Supabase project. `analyst_snapshot.py` reads it with the REST API (`{SB_URL}/rest/v1/<table>`, headers `apikey` and `Authorization: Bearer <publishable key>`, paged with `Range` headers):

| Table | Columns used | Mapping |
|---|---|---|
| `yahoo_ratings` | `ticker, reco_key, reco_mean, strong_buy, buy, hold, sell, strong_sell, num_analysts, target_mean, target_low, target_high, current_price, fetched_at` | `y_rating` = reco_key mapped (strong_buy→Strong Buy, buy→Buy, hold→Hold, underperform→Underperform, sell→Sell, strong_sell→Strong Sell). `y_score` = reco_mean (1 = Strong Buy … 5 = Strong Sell). `y_n_ratings` = sum of the five counts. Buys = strong_buy+buy, Sells = sell+strong_sell. `y_n_targets` = num_analysts. `y_target_avg/low/high` = target_mean/low/high |
| `tipranks_cache` | `ticker, fetched_at, data->consensuses, data->ptConsensus` | Use the entries with `bench == 1` and `period == 3` (3-month consensus; prefer `isLatest`). `tr_rating` = rating code 5 Strong Buy, 4 Moderate Buy, 3 Hold, 2 Moderate Sell, 1 Strong Sell. `tr_n_ratings` = nB+nH+nS. `tr_target_avg/low/high` = ptConsensus priceTarget/low/high. Rows older than **14 days** are dropped |

- Tickers with a dot (BRK.B) are also looked up with a dash (BRK-B).
- Funds (asset type ETF/ETN/ETV/ETS) are marked `fund` in both rating columns.
- **Never call Yahoo Finance or TipRanks directly**, and never get around bot checks or terms of use. Use only what the owner's app has captured. If you have no access to the app, use a properly licensed analyst-data provider with the same fields, or leave the columns empty ("n/a").
- Upside is always recomputed in the report as average target ÷ the report's own latest close − 1.

## Storage layout (folders set in `code/config.py`, overridable by environment variables)

```
$ADV_KIT_DATA (default ./data)
  minutes/<date>.parquet          1-min SIP 04:00-20:00 ET (ADV_M1_DIR)
  boats/<session>.parquet         overnight bars for the night before <session> (ADV_BOATS_DIR)
  universe/                       (ADV_UNIVERSE_DIR)
    polygon_reference_tickers.parquet, grouped/<date>.parquet
    adv_snapshot_<snap>.parquet/.csv, adv_over_{500m,1bn,5bn,10bn}_<snap>.csv
    analyst/analyst_snapshot_<asof>.csv, analyst_snapshot_latest.csv
  reports/                        (ADV_REPORTS_DIR)
    out_<start>_to_<MM-DD>_official/   52-week run (parquet + workbook + chat_<tag>.md)
    day_rank/day_rank_<DAY>.parquet, week_rank_<MON>.parquet (+ _sweep_)
    day_reports/<DAY>/, week_reports/<MON>/
```

`ADV_OFFLINE=1` makes every script use only the bars already on disk, with no pulls.
