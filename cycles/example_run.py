"""Run the cycles-bot simulator (botsim.py) on 1-minute bars.

  pip install numpy pandas numba
  python3 example_run.py sample_TQQQ_2026-10-26_to_30.csv

Input CSV: columns t (Eastern time, no time zone, e.g. 2026-10-26 09:30:00), o, h, l, c (v optional), one stock, sorted or not.
Include the overnight bars (20:00-04:00 ET, Alpaca feed='boats') when you have them: the live bot trades overnight.
A bot "day" runs 20:00 ET the previous day -> 20:00 ET; the sample covers the 5 sessions Mon 26 - Fri 30 Oct 2026 (Sunday 20:00 on)."""
import sys, pandas as pd
import botsim as BS

path = sys.argv[1] if len(sys.argv) > 1 else 'sample_TQQQ_2026-10-26_to_30.csv'
bars = pd.read_csv(path, parse_dates=['t']).sort_values('t').reset_index(drop=True)[['t', 'o', 'h', 'l', 'c']]
# sessions = the weekdays that have regular-hours bars
days = sorted({str(t.date()) for t in bars.t if 4 <= t.hour < 20 and t.weekday() < 5})


def show(name, cfg):
    cyc, opn, info = BS.run_stock(bars, cfg)
    D = BS.daily(cyc, opn, days)
    net = D.profit.sum() - D.fees.sum(); cap = D.exposure.mean()
    step = info['step'] if info['step'] is not None else cfg['inc']; pt = info['pt_abs'] if info['pt_abs'] is not None else cfg['pt']
    print(f'{name:38s} step ${step:.2f}  PT ${pt:.2f}  cycles {int(D.cycles.sum()):6,d}  '
          f'net ${net:9,.2f}  avg capital ${cap:9,.2f}  return {net / cap:7.2%}  open lots {len(opn):4d}  open at cost ${opn.cost.sum():,.2f}')
    return D


print(f'{path}: {len(bars):,} bars, sessions {days[0]} .. {days[-1]}\n')
# 1) the lists' base test: whole-cent step max(1c, 0.1% of the first price), profit taker 5 steps, $1 per level, grid follows the price
show('Base settings ($1/level)', dict(amount=1.0))
# 2) a live-style config: fixed $0.04 step, fixed $0.50 profit taker, 1 share per level (TQQQ's current settings)
show('TQQQ live-style: $0.04 step, $0.50 PT, 1 sh', dict(inc=0.04, inc_type='fixed', pt=0.50, pt_type='fixed', quantity=1, amount=None))
# 3) profit-taker sweep on the same $0.04 grid
print('\nProfit-taker sweep, $0.04 step, 1 share:')
for pt in (0.06, 0.12, 0.20, 0.32, 0.40, 0.48, 0.56, 0.80):
    show(f'  PT ${pt:.2f}', dict(inc=0.04, inc_type='fixed', pt=pt, pt_type='fixed', quantity=1, amount=None))
# 4) daily breakdown for the base run
print('\nDaily (base settings):'); print(show('Base settings ($1/level)', dict(amount=1.0)).round(2).to_string(index=False))
