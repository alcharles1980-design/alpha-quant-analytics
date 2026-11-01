# 09. Albert's standing rules and conventions

Follow these in every report and message.

## Naming and wording

- The bot is **"the cycles bot"** (cycles bot capital, cycles bot settings, "(cycles)" in column names). Never "grid bot" in reports or chat.
- Report title and file name: **"Average Daily Volume Segmented Stocks List"** plus the look-back dates (see `07_output_format.md`).
- Column names are exactly as specified; they were chosen after several rounds of feedback. For example:
  - "Weeks on list (of 52)", not "Wks";
  - "Avg weekly return (cycles)", not "Avg week";
  - "Price difference vs 200-day moving average", not "vs 200-day";
  - "Number of weeks with returns of 10% or more (cycles)".
- Workbook headers wrap onto 2–4 lines instead of making columns very wide.

## Format rule (1 Nov 2026)

- **Every** day report, week report, or other list report uses exactly the segmented list format: all columns, notes, analyst ratings and targets, price from peak, moving averages, capital check.
- Period-specific columns are added after "Weeks on list".
- Don't invent a new layout.

## Simulation rules

- **Whole cents only.** Every level, target and step is a whole cent, also for stocks under $1.
- **Never close a lot at a loss.** Lots sell only at or above their target. Lots below cost are open P&L (capital tied up), never realized losses.
- **$1 per level** (since 1 Nov 2026, was $10). Dollar figures scale linearly with the amount, and returns don't change. Show money in cents ($0.36), because $1 lots make small amounts.
- **Base settings:** step max(1¢, 0.1% of the first price), profit taker 5 steps (≈0.5%), levels follow the price both ways, no cap on lots, touch fills, gap fills after >1-minute pauses, fees $0.005 per share sold.
- **Include overnight trading** (Blue Ocean, 8 pm – 4 am ET). The bot trades around the clock, and about 38% of profit comes outside regular hours.
- **Bot day** = 8:00 pm → 8:00 pm ET. **Bot week** = Sunday 8 pm → Friday 8 pm.
- **Main measure:** return on capital **exposed** (time-weighted cost of lots held), not on a fixed account size.
- Use the simulator in `code/botsim.py`. It's calibrated against the live bot (within about 5% on TQQQ; correlation 0.90 across 73 live configs). It's the best available profit estimator, with the caveat that fresh-start runs show what a stock offers, not what an existing config with old lots will earn.

## Data rules

- Dates are US exchange dates in Eastern time. A session is complete only after 20:00 ET.
- Analyst data is a **periodic snapshot**, not live. Say when it was captured.
- **Do not** call Yahoo Finance or TipRanks directly, and never get around bot checks. Use only the owner's app captures or a licensed provider.
- API keys live only in environment variables. Never print, store, commit or paste them.

## Communication style

- Albert mostly reads on his phone. Keep replies short:
  - send the workbook;
  - post the chat tables;
  - add one or two sentences of findings.
- State results neutrally. No investment advice.
- When something is ambiguous, ask one short question. When he says "go ahead", proceed.
- When he asks to rename or remove columns, apply it everywhere: chat, workbook, CSVs, and all future reports.

## Things that were tried and removed (don't bring back unless asked)

- Path metrics (efficiency ratio, path dispersion ratio, choppiness) were removed on 1 Nov 2026 because they didn't predict cycle profit better than the simulator.
- The CV (coefficient of variation) column was removed.
- The old standalone day-ranking workbook ("One-Day Cycles Ranking … .xlsx") is retired in favour of the segmented format.
