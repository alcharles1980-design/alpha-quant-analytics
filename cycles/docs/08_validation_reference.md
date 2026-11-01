# 08. Validation: reference numbers

A rebuild is correct when it reproduces these figures from the same dates. The full reference files are in `reference_outputs/`. The kit's own code reproduced every check below exactly on 1 Nov 2026, except the analyst columns, which depend on when the source was captured.

## Lists (snapshot 2026-10-30, window 2026-10-05 → 2026-10-30)

| List | Names | First three by ADV20 |
|---|---|---|
| $10bn | 15 | SPY $30,169m, QQQ $28,393m, MU $24,755m |
| $5bn | 21 | (adds GOOG, AVGO, TSM, IWM, MRVL, SMH) |
| $1bn | 157 | |
| $500m | 319 | asset types: CS 235, ETF 72, ADRC 9, ETV 3 |

The files are `reference_outputs/lists_2026-10-30/adv_over_*.csv`. Compare names, order and `adv20_notional`.

## Simulator spot checks (base settings, $1 per level, week of Mon 26 Oct 2026, bot week Sun 25 Oct 20:00 → Fri 30 Oct 20:00)

| Stock | Avg capital (cap) | Profit | Fees | Cycles | Return (cycles) |
|---|---|---|---|---|---|
| TQQQ | $51.016 | $4.908 | $0.070 | 949 | 9.62% |
| AAPL | $10.710 | $0.799 | $0.002 | 157 | 7.46% |
| AAL | $18.466 | $2.589 | $0.247 | 616 | 14.02% |
| SOXL | $115.63 | $24.83 | | 5,724 | 21.5% |

Week list returns, capital-weighted (`List totals by week`, week 2026-10-26): $10bn 10.80%, $5bn 9.71%, $1bn 9.87%, $500m 10.05%.

## 52-week report (3 Nov 2025 – 30 Oct 2026; 16,430 stock-weeks)

Summary rows:
```
| $10bn | 15 | 11.4% | 5.4% | 52 of 52 | -20.9% | 57% | -2.5% (6 of 15) | $5,506.71 | -$1,430.84 (-26.0%) | $3,146.67 | 57% | 119% | 11 of 12 stocks | +41.7% | 12 of 12 |
| $5bn | 21 | 10.7% | 5.0% | 52 of 52 | -21.9% | 60% | -6.5% (6 of 21) | $7,395.66 | -$1,746.11 (-23.6%) | $3,959.41 | 54% | 115% | 15 of 16 stocks | +45.2% | 16 of 16 |
| $1bn | 157 | 9.0% | 4.6% | 50 of 52 | -21.3% | 48% | -3.1% (64 of 156) | $53,589.95 | -$13,655.17 (-25.5%) | $24,755.80 | 46% | 81% | 107 of 115 stocks | +31.2% | 106 of 115 |
| $500m | 319 | 8.9% | 4.9% | 50 of 52 | -16.6% | 50% | -1.8% (144 of 318) | $100,419.29 | -$24,945.37 (-24.8%) | $47,511.01 | 47% | 79% | 219 of 241 stocks | +20.1% | 125 of 241 |
```
First row of the $10bn table:
`| SOXL | 11 | 24.1% | 8.3% | $300.77 (22 Jun 26) | $77.05 | -74.4% | -47.7% | -38.0% | -57.5% | $28.12-$302.00 (974%) | $1,368.80 | -$619.58 (-45.3%) | $913.21 | 67% | 230% | fund | n/a | n/a | fund | n/a |`

## One-day ranking, Friday 30 Oct 2026

- List returns at 0.5%: 3.73% / 3.27% / 3.27% / 3.52%.
- At each stock's best PT: 4.32% / 3.81% / 3.70% / 4.06%.
- #1 $10bn: SOXL, best PT 2%, 6.8% at best, 5.7% at 0.5% (rank 2), $5.37 profit on $93.62, 955 cycles, day's range 26.7%, true range 21.24%.
- #1 $1bn / $500m: TWLO, best 0.6%, 28.1%, 27.7% (1), $3.75 on $13.54, 637 cycles.

## Weekly ranking, 26–30 Oct 2026

- List returns at 0.5%: 10.80% / 9.71% / 9.87% / 10.05%.
- At each stock's best PT: 12.96% / 11.48% / 10.87% / 10.99%.
- #1 $10bn: SOXL, best 2%, 27.4%, 21.5% (1), $24.83 on $115.63, 5,724 cycles, week's range 55.2%, true range 46.61%.
- #1 $1bn / $500m: MRNA, best 0.75%, 38.4%, 36.7% (1), $11.04 on $30.11, 2,132 cycles.

## Checks to run on any rebuild

1. Linearity: $10 per level gives exactly 10× the dollars, the same returns, and the same cycles.
2. The weekly ranking's 0.5% return equals that week's `ret` in `weekly_results`.
3. The list return equals Σ profit / Σ cap, not the average of the stocks' returns.
4. No fractional-cent levels or targets: every level and target is a whole cent.
5. Overnight bars are present: a week with zero overnight cycles on a liquid name (e.g. TQQQ) means the BOATS data is missing.
6. Dates are Eastern exchange dates, and a session counts only after 20:00 ET.
