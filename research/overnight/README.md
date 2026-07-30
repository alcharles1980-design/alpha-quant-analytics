# Overnight hidden-liquidity research

Scripts behind the Hidden Liquidity Levels subsystem. **The production scanner is the Supabase
Edge Function `overnight-level-scan`** — these are the exploratory tools that produced it, kept
because the measurements were expensive and the detector took three attempts to get right.

Run with `AK` / `AS` (Alpaca) and `SESS_S` / `SESS_E` in the environment:

```bash
export AK=... AS=... SESS_S=2026-07-30T00:00:00Z SESS_E=2026-07-30T08:00:00Z
python3 find-repeat-prints.py NVDA,AAOI,HOOD
```

| script | what it does |
|---|---|
| `level-register.py` | Standalone version of the production scanner. Sweeps the tape, detects levels, POSTs to `register_level`. Needs `SBK` too. |
| `find-repeat-prints.py` | The simple criteria: >50 prints, one price, one side, under 2 minutes. Splits inside-spread from at-touch. |
| `find-large-bursts.py` | Largest single bursts at one exact price, ranked. Finds U-class events. |
| `fetch-grouped-daily.py` | Resumable full-market daily panel via Polygon grouped-daily, state persisted between runs. |

## Three things that cost real time

**The detector was wrong twice before it was right.** Strict identical-price consecutive runs
**missed the real U event** (four stray prints interleaved among 71). The tolerant fix then merged
that 17-second burst with prints 3.5 minutes later, reporting a 211-second cluster at the wrong
price. What works: tolerant on price, **strict on time** — a 1.5s inter-print gap breaks the run.

**Position must be measured at EVERY print, not at the last.** Sampling only the final print made
AAOI 76.90 look like hidden liquidity when 76.90 *was* the bid for the first 50 prints and the book
had simply walked away by the end.

**Background processes do not survive between tool calls in the sandbox.** Three multi-year fetches
died around 300 sessions before this was diagnosed. Run long fetches in **foreground chunks** with
state persisted to disk — that is what `fetch-grouped-daily.py` does.
