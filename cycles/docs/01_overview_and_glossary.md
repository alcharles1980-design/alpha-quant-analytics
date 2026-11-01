# 01. Overview and glossary

## Who and why

Albert runs a live trading bot, always called **"the cycles bot"** (never "grid bot"). It trades US stocks and ETFs around the clock, overnight session included, using a ladder of buy levels:

- The bot sets **levels** (price rungs) a fixed **step** apart, for example every $0.10.
- When the price falls to a free level, that level **buys one lot**, for example $1 worth of shares.
- Each lot has a **target** = its buy level + the **profit taker** (PT), for example 5 steps higher. When the price reaches the target, the lot sells, and the level becomes free to buy again.
- One buy followed by its sell is a **cycle**. The bot earns from many small cycles while a stock moves up and down.
- **A lot is never sold below its cost.** If the price falls and stays down, lots stay open, so capital is tied up (open lots below cost are "open P&L", not realized losses).

So the question behind all these reports is: **which liquid stocks give the most cycle profit per dollar of capital actually tied up, consistently, without sinking so far that capital locks up?** The reports answer it by simulating the cycles bot on real 1-minute prices.

## The reports

| Report | What it is | When |
|---|---|---|
| **The four ADV segmented lists** | All US stocks and ETFs ranked by 20-day average daily dollar volume, cut at over $500m / $1bn / $5bn / $10bn. On 30 Oct 2026: 319 / 157 / 21 / 15 names. A $10bn name is also on the other three lists. | On request (snapshot) |
| **Average Daily Volume Segmented Stocks List \<start\> to \<end\>** (the "52-week report") | For every list member: 52 weekly fresh-start simulations, price checks, momentum, a continuous year-long capital run, analyst data. Chat tables plus an Excel workbook. | On request, usually weekly |
| **One-day ranking** | The same report, plus that day's simulated results (with a profit-taker sweep) as extra columns, ranked by the day's return. | On request ("give me Friday's ranking") |
| **Weekly ranking** | The same report, plus one week's results (with a profit-taker sweep), ranked by the week's return. | On request ("rankings for last week") |

**Standing rule (1 Nov 2026):** every day report, week report, or any other list report must use **exactly** the segmented list format. That means all its columns, notes, analyst ratings and targets, price from peak, and so on. The extra period columns go right after "Weeks on list". See `07_output_format.md`.

## Glossary

| Term | Meaning |
|---|---|
| ADV / ADV20 | Average daily **dollar** volume (notional = VWAP × shares) over the last 20 trading sessions |
| Segmented lists / tiers | The four ADV cut-offs: over $500m, over $1bn, over $5bn, over $10bn |
| Snapshot | The date the lists were built (the last session in the 20-session window), e.g. 2026-10-30 |
| Level / range | One rung of the ladder. "$1 per level" = each rung buys $1 of stock |
| Step | Distance between levels. Base: max(1 cent, 0.1% of the first price), in whole cents |
| Profit taker (PT) | How far above its buy level a lot sells. Base: 5 steps (about 0.5%) |
| Cycle | One completed buy → sell of a lot |
| Lot | The shares bought at one level (fractional shares: $1 / level price) |
| Fresh start | A simulation that begins with no lots held |
| Capital exposed | Time-weighted cost of all lots held. A lot held half a day at $1 cost adds $0.50 to that day |
| Return (cycles) | Realized cycle profit ÷ average capital exposed over the period. This is the main measure |
| Bot day | 8:00 pm ET the previous evening → 8:00 pm ET (includes the overnight session) |
| Bot week | 8:00 pm ET Sunday → 8:00 pm ET Friday |
| Overnight / BOATS | Blue Ocean ATS overnight trading 8:00 pm – 4:00 am ET (Alpaca `feed=boats`) |
| SIP | Consolidated US market data feed (Alpaca `feed=sip`), 4:00 am – 8:00 pm ET |
| Gap fill | When trading resumes after a pause of more than 1 minute and the first price is already past a level or target, the fill is at that better price |
| Weeks on list | In how many of the 52 Mondays the stock was over that list's cut-off at the time (point-in-time) |
| From peak | Latest close ÷ highest close in the look-back − 1 |
| 4-mo return | Latest close ÷ close 84 sessions earlier − 1. This is "Strategy A's" momentum score, used elsewhere to pick stocks |
| Capital now / Open P&L | From one continuous year-long run: cost of lots still held at the end / their market value minus cost |
| Best profit taker | The PT (0.1%–2% sweep) with the highest return after fees for that stock in that period |
| Fund | ETF / ETN / ETV / ETS. Funds have no analyst ratings and show "fund" |

## The pipeline at a glance

```
Polygon reference + grouped daily ──► build_lists.py ──► adv_over_{500m,1bn,5bn,10bn}_<snap>.csv
analyst source (owner's app DB) ──► analyst_snapshot.py ──► analyst/analyst_snapshot_latest.csv (+ columns on the list CSVs)
Alpaca 1-min SIP + overnight BOATS + daily bars ──► consist_report.py --weeks 52 ──► out_<start>_to_<end>_official/
        (weekly fresh-start sims, continuous run, price checks, momentum)          workbook + chat tables + parquet
day_rank.py DAY PREV SNAP ──► day_rank_<DAY>.parquet ─┐
week_rank.py MONDAY SNAP ──► week_rank_<MON>.parquet ─┴► day_segmented.py [--week] ──► same workbook/chat format + period columns
```
