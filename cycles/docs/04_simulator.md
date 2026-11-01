# 04. The cycles-bot simulator (`code/botsim.py`)

Every return figure in every report comes from this simulator. It replays the live bot's rules on 1-minute bars. **Use it as-is.** If you reimplement it, match these rules exactly and check against `08_validation_reference.md`.

## Inputs

- `bars`: one stock's 1-minute bars, columns `t, o, h, l, c`. `t` is naive Eastern time, sorted, and includes overnight bars (20:00–04:00 from BOATS) plus SIP bars 04:00–20:00.
- `cfg`: dict overriding `BASE`. The base list settings are simply `dict(amount=1.0)`.

```python
BASE = dict(inc=0.1, inc_type='percent', pt=0.5, pt_type='percent', amount=1.0, quantity=None, auto_compound=False,
            chase=True, start_headroom=0.05, starting_price=None, max_ranges=None, sell_only=False, fill='touch',
            round_cents=True, shape='cents', gapfill=1)
FEE = 0.005   # $ per share sold
```

## Base list settings ("shape = cents"), step by step

1. **First price** `p0` = the open of the first bar of the run. For a bot day or week, that's the first overnight bar after 20:00, or the first available bar.
2. **Step** (whole cents): `step = max(0.01, round(p0 × 0.1 / 100, 2))`. Examples: $2 stock → 1¢; $69.39 → 7¢; $150 → 15¢; $345 → 35¢.
3. **Profit taker**: `pt_abs = max(0.01, round(step × pt / inc, 2))`. With pt = 0.5 and inc = 0.1 that's **5 steps**: TQQQ at $70 → step 7¢, PT 35¢.
   - In a profit-taker sweep, `pt` is the sweep value in percent and inc stays 0.1. So PT = (pt/0.1) steps, rounded to the cent: 0.15% → 1.5 steps; 2% → 20 steps.
4. **Levels ("chase")**: arithmetic, both directions from `p0`, so the grid follows the price wherever it goes. There's no ceiling and no floor.
   - Formula: `p0 + k × step` for every k covering [0.97 × lowest low − 2 steps, 1.03 × highest high + 2 steps].
   - Each level is rounded to the cent; duplicates are removed and only positive levels are kept.
   - Each level's **target** = `round(level + pt_abs, 2)`.
5. **Lot size**: `amount` dollars per level, so `qty = amount / level` (fractional shares). The base is **$1 per level**. Dollar results scale exactly linearly with the amount, and returns don't change.
6. **One lot per level** at a time; there's no cap on lots held (`max_ranges=None`).

## The price path inside each bar

The price walks from the previous bar's close through four points:
- **Up bar** (c ≥ o): open → low → high → close.
- **Down bar** (c < o): open → high → low → close.

The first leg (previous close → open) carries any gap.

## Fills (`fill='touch'`)

- **Buy.** On a downward leg from `a` to `b`, every **free** level L with `b ≤ L < a` buys, from the highest down. The buy price is L.
- **Sell.** On an upward leg from `a` to `b`, every held lot with `a < target ≤ b` sells at its target.
- **Cycle profit** = `qty × (sell price − buy price)`. Cost = `qty × buy price`. After a sale the level is free again.
- **Gap fill (`gapfill=1`).** A bar that comes **more than 1 minute after the previous bar** (session opens, thin overnight trading) and whose **open** is already past a level or target fills at the open: a lower buy or a higher sell, which the live bot also gets. This applies only to the open leg of such bars.
- Lots are **never sold below their target**, so a cycle can never lose money. Lots below cost simply stay open.

## Daily and period accounting (`daily(cyc, open_lots, days)`)

- **Bot day** `d` = [d − 1 day 20:00, d 20:00) ET.
- **Exposure(d)** = Σ over every lot (completed cycles and lots still open) of `cost × fraction of day d the lot was held`. Open lots count as held until the end of the last day. So exposure is the **time-weighted average capital tied up** that day.
- **Profit(d)** = Σ profit of cycles whose **sell** falls in day d. **Cycles(d)** = their count. **Fees(d)** = $0.005 × shares sold that day.
- **Period return (cycles)** = Σ profit ÷ mean daily exposure over the sessions the stock traded. It's computed only when that average capital is at least **$0.50** (half a lot); otherwise the return is blank / "n/a". **After fees** = (Σ profit − Σ fees) ÷ the same capital.

## Other options (used elsewhere, not in the lists)

| Option | Meaning |
|---|---|
| `shape=None` with percent inc/pt | Geometric levels `p0 × 1.001^k`, target `level × 1.005`, both rounded to cents. **Used by the continuous 52-week capital run** (a step fixed a year ago would be far too small for stocks that multiplied) |
| `inc_type='fixed'`, `pt_type='fixed'` | Fixed $ step / $ profit taker, e.g. a live config $0.04 step, $0.50 PT |
| `quantity` | Shares per level instead of $ |
| `chase=False` / `starting_price` | Levels only hang down from a starting price (replaying a live config) |
| `max_ranges` | Cap on lots held (the live bot uses 50–250) |
| `auto_compound` | Each level's lot grows by its own banked profit |
| `carried` | Start with lots already held |
| `pt_night`, `pt_switch` | Separate overnight PT; PT change from a timestamp |
| `fill='through'` | Needs a 1-cent trade-through |

## Calibration against the live bot (for context)

- TQQQ, 28 Sep – 23 Oct 2026: simulated net profit within −5% of live.
- 73 live configs, 19–27 Oct 2026, each with its own settings: cycles +14%, profit +6% vs live, correlation 0.90.
- Fresh-start runs show what a stock **offers**. A live config that carries old lots bought far above the price earns less on the same days.
- 1-minute bars miss swings inside a minute (regular hours run a little low); pre-market runs a little high. These largely offset.

## Minimal use

```python
import pandas as pd, botsim as BS
bars = pd.read_csv('sample_TQQQ_2026-10-26_to_30.csv', parse_dates=['t'])[['t','o','h','l','c']].sort_values('t')
cyc, opn, info = BS.run_stock(bars, dict(amount=1.0))               # base list settings
D = BS.daily(cyc, opn, ['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30'])
ret = D.profit.sum() / D.exposure.mean()                             # weekly return (cycles)
```

`example_run.py` on the sample prints these base settings: step $0.07, PT $0.35, 949 cycles, net $4.84 on $51.02 average capital, 9.48% **after fees**. This is exactly TQQQ's week of 26 Oct 2026 in the 52-week report: profit $4.908 on $51.016 = **9.62% return (cycles)**, which is before fees. Fees are $0.070, so net is $4.838.
