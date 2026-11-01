# 07. Exact output format

**Rule:** every list report, including day, week and anything else Albert asks for, uses this format. The code that produces it is `consist_report.write_outputs()`, which is the source of truth for every string. Compare your output with `reference_outputs/`.

Each report has two deliverables:
1. **Chat tables** (markdown, posted in the conversation). File `chat_<tag>.md`, `chat_day_<DAY>.md` or `chat_week_<MONDAY>.md`.
2. **Excel workbook**, sent as a file.

## 1. File names

| Report | Workbook name |
|---|---|
| 52-week | `Average Daily Volume Segmented Stocks List <first Monday> to <last Friday>.xlsx`, e.g. `Average Daily Volume Segmented Stocks List 2025-11-03 to 2026-10-30.xlsx` |
| One day | `Average Daily Volume Segmented Stocks List - One-Day Ranking <DAY> (look-back <first Monday> to <last Friday>).xlsx` |
| Week | `Average Daily Volume Segmented Stocks List - Weekly Ranking <MONDAY> to <FRIDAY> (look-back <first Monday> to <last Friday>).xlsx` |

## 2. Chat tables, top to bottom

### 2.1 Title (one `##` line)

- 52-week: `## Average Daily Volume Segmented Stocks List (the four ADV lists as of the 2026-10-30 snapshot (all members)): 52 weeks Mon 03 Nov 2025 - Fri 30 Oct 2026, price check at the 2026-10-30 close`
- Day: `## Average Daily Volume Segmented Stocks List: one-day ranking, Friday 30 Oct 2026 (bot day 8:00 pm Thu - 8:00 pm Fri); the four ADV lists as of the 2026-10-30 snapshot (all members); look-back 52 weeks Mon 03 Nov 2025 - Fri 30 Oct 2026, price check at the 2026-10-30 close`
- Week: `## Average Daily Volume Segmented Stocks List: weekly ranking, Mon 26 Oct - Fri 30 Oct 2026 (bot week 8:00 pm Sun - 8:00 pm Fri); ...same tail...`

### 2.2 Italic notes

- Day and week reports first get one italic paragraph explaining the period columns (fresh start, base settings, PT sweep, return definition, $0.50 minimum, range / true range, ranking rule).
- Then every report has the standard paragraph:

> _Weekly figures: 52 weeks, fresh each week, base settings, $1 per level (range). Capital figures: one continuous run per stock, 2025-11-03 to 2026-10-30, lots carried, $1 per level, 0.1% step / 0.5% profit taker at every price, rounded to whole cents (a step fixed a year ago would be far too small for stocks that multiplied). Dollar figures scale linearly: multiply by your $ per level (e.g. x10 for $10 per level); returns stay the same. "Weeks on list" = in how many of the 52 weeks the stock was big enough for that list at the time (checked every Monday: 20-day average daily $ volume over the cutoff); new listings and recent risers show fewer. "Avg weekly return (cycles)" and "Worst weekly return (cycles)" = the cycles bot's simulated weekly return on capital, fresh each week, over every week the stock traded, on the list or not. Analysts: Yahoo Finance consensus as captured by the app on 2026-11-01 (number of ratings in brackets), average 12-month price target, upside = target / latest close - 1; TipRanks = 3-month consensus from the app's TipRanks cache (number of ratings in brackets); funds have no analyst ratings._

### 2.3 Summary table: one row per list, in the order $10bn, $5bn, $1bn, $500m

Header:
```
| List | Names | Avg weekly return (cycles) | Worst weekly return (cycles) | Number of weeks with list returns of 5% or more (cycles) | Median from peak | Share of names above their 200-day moving average | 4-mo return: median (positive) | Capital now | Open P&L | Realized $ | On capital now | On avg capital | Rated Buy or better | Median upside | TipRanks coverage |
```
Day and week reports insert after `Names`:
```
<DN>: list return at 0.5% (cycles) | <DN>: list return at each stock's best profit taker | <DN>: profit at 0.5% | <DN>: median true range |
```
Example row (52-week):
`| $10bn | 15 | 11.4% | 5.4% | 52 of 52 | -20.9% | 57% | -2.5% (6 of 15) | $5,506.71 | -$1,430.84 (-26.0%) | $3,146.67 | 57% | 119% | 11 of 12 stocks | +41.7% | 12 of 12 |`

The day/week cells look like `3.73% | 4.32% | $16.97 on $455.01 | 4.51% |`.

### 2.4 One section per list, $10bn → $500m

Section title:
- `### $10bn list (15 names)`
- When cut: `### $1bn list (157 names, top 25 by average weekly return (cycles); all in the workbook)`
- Day/week: `... top 25 by Fri 30 Oct's return at the best profit taker; all in the workbook)`

What's shown: **all names** for $10bn and $5bn; **top 25** for $1bn and $500m.

Stock table header (52-week):
```
| Stock | Weeks on list (of 52) | Avg weekly return (cycles) | Worst weekly return (cycles) | Peak (date) | Now | From peak | Price difference vs 100-day moving average | Price difference vs 200-day moving average | 4-mo return | Price range | Capital now | Open P&L | Realized $ | On capital now | On avg capital | Analyst rating (#) | Avg target | Upside | TipRanks (#) | TipRanks target |
```
Day/week: a leading `| # ` column, and after `Weeks on list (of 52)`:
```
<DN> best profit taker | <DN> return at best (cycles) | <DN> return at 0.5% (cycles) (rank) | <DN> profit at 0.5% | <DN> capital at 0.5% | <DN> cycles at 0.5% | <DN> day's range | <DN> true range |
```
(`week's range` in the weekly report.) `<DN>` = `Fri 30 Oct` or `Week 26-30 Oct`.

### 2.5 Cell formats (exact)

| Kind | Format | Example |
|---|---|---|
| Return (unsigned) | 1 decimal % | `24.1%` |
| Signed % (from peak, vs MA, 4-mo, upside, open P&L %) | sign + 1 decimal | `-74.4%`, `+18.5%` |
| Whole % (on capital now / avg capital, share above 200d) | 0 decimals | `67%` |
| Money | `$` + thousands separators + **cents**; negative `-$` | `$1,368.80`, `-$619.58` |
| Open P&L | money + (signed %) | `-$619.58 (-45.3%)` |
| Peak (date) | `$peak (dd Mon yy)`; uses `%d %b` when the look-back is all one year | `$300.77 (22 Jun 26)` |
| Now / Avg target / TipRanks target | `$x,xxx.xx` | `$77.05` |
| Price range | `$lo-$hi (range% 0 decimals)` | `$28.12-$302.00 (974%)` |
| Analyst rating (#) | `<rating> (<n ratings>)`; `fund` for funds; `n/a` if missing | `Strong Buy (60)` |
| TipRanks (#) | same, TipRanks wording | `Moderate Buy (28)` |
| Missing value | `n/a` | |
| Day/week best PT | `{PT×100:g}%` | `2%`, `0.35%` |
| Day/week return at 0.5% | `x.x% (rank)` | `5.7% (2)` |
| Day/week cycles | thousands separator | `5,724` |
| Day/week range | 1 decimal %; true range 2 decimals | `26.7%`, `21.24%` |
| Summary list returns (day/week) | 2 decimals | `3.73%` |

### 2.6 Ordering

- 52-week report: by Avg weekly return (cycles), highest first.
- Day/week: by period return at the best PT, then at 0.5%, then avg weekly return.

## 3. Workbook layout (openpyxl)

Sheets, in order: **Notes**, **Over $10bn**, **Over $5bn**, **Over $1bn**, **Over $500m**, **Weekly returns**, **List totals by week**.

- Font Arial everywhere. Header row bold, fill `DDEBF7`, wrapped text, centered, top-aligned. Header row height **64** points (up to 4 lines).
- Column width = `max(10, min(26, max(ceil(len(header)/3)+4, min_width)))`. min_width: dates 11, rating text 13, `$` columns 11, best PT 9, others 8.
- Freeze panes at `C2`; autofilter over the whole table.
- **Notes**: column A width 160, one line per row, first line bold. It holds the title plus the method notes (see `write_outputs`; day/week reports prepend their own 7–8 lines).
- **Over $X**: every member, sorted as in the chat. Columns in this order (header text → field → number format):

| # | Header | Field | Format |
|---|---|---|---|
| 1 | # | rank | |
| 2 | Stock | sym | |
| 3 | Weeks on this list (of 52, checked each Monday) | wks | 0 |
| *(day/week reports insert the 20 period columns here, see below)* | | | |
| 4 | Avg weekly return (cycles) | avg | 0.0% |
| 5 | Median weekly return (cycles) | median | 0.0% |
| 6 | Worst weekly return (cycles) | worst | 0.0% |
| 7 | Best weekly return (cycles) | best | 0.0% |
| 8 | Std dev | std | 0.0% |
| 9 | Number of weeks with returns of 10% or more (cycles) | wk10 | 0 |
| 10 | Avg capital exposed ($) | cap | $#,##0.00 |
| 11 | Avg net $ per week | net_wk | $#,##0.00 |
| 12 | Avg week range | range | 0.0% |
| 13 | Peak close in look-back | peak | $#,##0.00 |
| 14 | Peak date | peak_date | text YYYY-MM-DD |
| 15 | Price (latest close) | price | $#,##0.00 |
| 16 | From peak | from_peak | 0.0% |
| 17 | 100-day moving average price | sma100 | $#,##0.00 |
| 18 | Price difference vs 100-day moving average | vs_sma100 | 0.0% |
| 19 | 200-day moving average price | sma200 | $#,##0.00 |
| 20 | Price difference vs 200-day moving average | vs_sma200 | 0.0% |
| 21 | 4-mo return (Strategy A score) | mom_4 | 0.0% |
| 22 | Range low | lo | $#,##0.00 |
| 23 | Range high | hi | $#,##0.00 |
| 24 | Range % | range_pct | 0.0% |
| 25 | Capital now: open lots at cost ($) | cap_now | $#,##0.00 |
| 26 | Open lots at market ($) | value_now | $#,##0.00 |
| 27 | Open P&L on capital now ($) | open_pl | $#,##0.00 |
| 28 | Open P&L % | open_pl_pct | 0.0% |
| 29 | Open lots now | open_lots_now | #,##0 |
| 30 | Realized $ (continuous) | realized | $#,##0.00 |
| 31 | Fees ($) | fees | $#,##0.00 |
| 32 | Avg capital exposed (continuous, $) | avg_cap | $#,##0.00 |
| 33 | Return on capital now | ret_cap_now | 0.0% |
| 34 | Return on avg capital | ret_avg_cap | 0.0% |
| 35 | Total P&L incl. open lots ($) | total_pl | $#,##0.00 |
| 36 | Analyst rating (Yahoo) | y_rating | |
| 37 | Rating score (1 = Strong Buy, 5 = Strong Sell) | y_score | 0.00 |
| 38 | # analyst ratings | y_n_ratings | 0 |
| 39–41 | Buys / Holds / Sells | y_buys, y_holds, y_sells | 0 |
| 42 | # price targets | y_n_targets | 0 |
| 43 | Avg price target | y_target_avg | $#,##0.00 |
| 44 | Lowest target | y_target_low | $#,##0.00 |
| 45 | Highest target | y_target_high | $#,##0.00 |
| 46 | Upside to avg target | y_upside_now | 0.0% |
| 47 | TipRanks rating | tr_rating | |
| 48 | TipRanks # ratings (3 months) | tr_n_ratings | 0 |
| 49 | TipRanks avg target | tr_target_avg | $#,##0.00 |
| 50 | TipRanks upside | tr_upside_now | 0.0% |
| 51 | Analyst data as of | analyst_asof | |
| 52–55 | Weeks on $10bn / $5bn / $1bn / $500m | w10bn … w500m | 0 |

Period columns (day/week reports only; prefix `<DN>`, e.g. `Fri 30 Oct`):

1. best profit taker (0.00%)
2. return at best profit taker (cycles)
3. return after fees at best profit taker
4. profit at best profit taker ($)
5. return at 0.5% profit taker (cycles)
6. rank at 0.5% in this list (0)
7. return after fees at 0.5%
8. profit at 0.5% ($)
9. capital exposed at 0.5% ($)
10. cycles at 0.5% (#,##0)
11. fees at 0.5% ($)
12. grid step ($)
13. low
14. high
15. day's range / week's range
16. true range (0.00%)
17. true range, regular hours
18. ATR14 % (no prefix)
19. close (8 pm) / close (Fri 8 pm)
20. change vs prior close / change vs prior Friday close

- **Weekly returns**: `Stock` plus one column per week headed `Wk YYYY-MM-DD`, holding each stock's weekly return (0.0%). All members, sorted by avg weekly return. Freeze panes `B2`.
- **List totals by week**: `Week | Over $10bn | Over $5bn | Over $1bn | Over $500m`, each the capital-weighted list return for that week.

## 4. Delivery

- Send the workbook as a file, then post the chat tables in the reply.
- Add only one or two plain sentences of context (e.g. "At list settings each list made about 10% for the week").
- No advice, and no recap of the method beyond the notes.
