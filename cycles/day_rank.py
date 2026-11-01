"""One-day cycles ranking for the four ADV lists (Albert 1 Nov 2026: "Friday's ranking for the four segmented lists").
  python3 day_rank.py DAY PREV_DAY SNAPSHOT     e.g. 2026-10-30 2026-10-29 2026-10-30
Bot day = 20:00 ET the evening before -> 20:00 ET on DAY (1-min SIP 04:00-20:00 + BOATS overnight), fresh start at its first bar.
Grid = list base settings: whole cents, step max(1c, 0.1% of the first price), PT 5 steps (0.5%), levels follow the price, $1 per level.
Profit-taker sweep 0.1%-2% (PT% / 0.1 steps) for the best PT per stock. Return = realized profit / time-weighted capital exposed that day;
needs >= $0.50 exposed (LOT / 2). Fees $0.005 per share sold, shown separately. Ranked within each list by return at the best PT."""
import os, sys, math, datetime as dt, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C, botsim as BS, scan_orig as S, consist_report as CR
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
DAY, PREV, SNAP = sys.argv[1], sys.argv[2], sys.argv[3]
LOT = 1.0; MINCAP = LOT / 2
PTS = [0.001, 0.0015, 0.002, 0.0025, 0.003, 0.0035, 0.004, 0.005, 0.006, 0.0075, 0.01, 0.0125, 0.015, 0.02]
U = C.UNIVERSE; M1 = C.M1; OUT = f'{C.REPORTS}/day_rank'
KEYS = ['10bn', '5bn', '1bn', '500m']; LAB = {'10bn': '$10bn', '5bn': '$5bn', '1bn': '$1bn', '500m': '$500m'}
lists = {k: pd.read_csv(f'{U}/adv_over_{k}_{SNAP}.csv').ticker.tolist() for k in KEYS}
SYMS = sorted(set(lists['500m']))
CR.ensure_minutes(SYMS, [PREV, DAY]); CR.ensure_overnight(SYMS, [DAY])      # pull any missing bars (no-op when ADV_OFFLINE=1)
B = pd.read_parquet(f'{M1}/{DAY}.parquet'); B = B[B.sym.isin(SYMS)]
B = BS.add_overnight(B[['sym', 't', 'o', 'h', 'l', 'c']], [DAY]).sort_values(['sym', 't'])
P = pd.read_parquet(f'{M1}/{PREV}.parquet'); P = P[P.sym.isin(SYMS)].sort_values(['sym', 't'])
P['hm'] = P.t.dt.hour * 60 + P.t.dt.minute
rows, prc = [], []
for s, g in B.groupby('sym'):
    g = g.reset_index(drop=True); hm = g.t.dt.hour * 60 + g.t.dt.minute
    p = P[P.sym == s]
    if not len(p) or len(g) < 10: continue
    pc = p.c.iloc[-1]; pr = p[(p.hm >= 570) & (p.hm < 960)]; pc_reg = pr.c.iloc[-1] if len(pr) else pc
    x = g[(hm >= 240) & (hm < 1200)]; r = x[(x.t.dt.hour * 60 + x.t.dt.minute >= 570) & (x.t.dt.hour * 60 + x.t.dt.minute < 960)]
    h, l = g.h.max(), g.l.min()
    prc.append(dict(sym=s, low=l, high=h, range=(h - l) / l, tr=(max(h, pc) - min(l, pc)) / pc,
                    tr_reg=(max(r.h.max(), pc_reg) - min(r.l.min(), pc_reg)) / pc_reg if len(r) else np.nan, close=g.c.iloc[-1], chg=g.c.iloc[-1] / pc - 1))
    for pt in PTS:
        cyc, opn, info = BS.run_stock(g[['t', 'o', 'h', 'l', 'c']], dict(pt=pt * 100, amount=LOT))
        D = BS.daily(cyc, opn, [DAY]).iloc[0]
        rows.append(dict(sym=s, pt=pt, exposure=D.exposure, profit=D.profit, cycles=D.cycles, fees=D.fees, open_lots=len(opn), step=info['step']))
X = pd.DataFrame(rows); Pr = pd.DataFrame(prc).set_index('sym')
X['ret'] = X.profit / X.exposure.where(X.exposure >= MINCAP); X['net'] = (X.profit - X.fees) / X.exposure.where(X.exposure >= MINCAP)
at5 = X[X.pt == 0.005].set_index('sym')
best = X.dropna(subset=['net']).sort_values(['net', 'pt'], ascending=[False, True], kind='mergesort').groupby('sym').head(1).set_index('sym')   # ties: smallest PT
R = pd.DataFrame({'best_pt': best.pt, 'ret_best': best.ret, 'net_best': best.net, 'profit_best': best.profit, 'cap_best': best.exposure,
                  'ret5': at5.ret, 'net5': at5.net, 'profit5': at5.profit, 'cap5': at5.exposure, 'cyc5': at5.cycles, 'fees5': at5.fees,
                  'step': at5.step}).join(Pr)
R['small'] = R.ret5.isna()
Dd = S.bars(SYMS, '1Day', S.utc(pd.Timestamp(DAY).date() - dt.timedelta(days=45), 4, 0), S.utc(pd.Timestamp(DAY).date() + dt.timedelta(days=1), 0, 0), adj='raw')
Dd['date'] = Dd.t.dt.tz_convert('America/New_York').dt.date.astype(str); Dd = Dd.sort_values(['sym', 'date'])
Dd['pc'] = Dd.groupby('sym').c.shift(); Dd['trd'] = np.maximum(Dd.h, Dd.pc) - np.minimum(Dd.l, Dd.pc)
Dd['atr14p'] = Dd.groupby('sym').trd.transform(lambda v: v.rolling(14).mean()) / Dd.c
R = R.join(Dd[Dd.date == DAY].set_index('sym')[['atr14p']])
os.makedirs(OUT, exist_ok=True); R.to_parquet(f'{OUT}/day_rank_{DAY}.parquet'); X.to_parquet(f'{OUT}/day_rank_sweep_{DAY}.parquet')

# ---- chat tables
dn = pd.Timestamp(DAY).strftime('%A %d %b %Y'); pf = lambda p: f'{p * 100:g}%'
TOPN = {'10bn': None, '5bn': None, '1bn': 20, '500m': 20}
md = [f'## One-day cycles ranking, {dn} (bot day 8:00 pm {pd.Timestamp(PREV):%a} - 8:00 pm {pd.Timestamp(DAY):%a})', '',
      f'_Each stock starts fresh at 8:00 pm the evening before; list base settings (whole-cent step max(1 cent, 0.1%), profit taker 5 steps = 0.5%, '
      f'levels follow the price, ${LOT:g} per level), plus a profit-taker sweep from 0.1% to 2% for the best one. Return (cycles) = profit from completed '
      f'cycles / average capital exposed during the day (needs at least ${MINCAP:.2f} exposed). Dollar figures are per ${LOT:g} per level: multiply by your amount. '
      f'Day\'s range = (high - low) / low; true range includes the gap from Thursday\'s close. Ranked by return at the best profit taker._', '']
for k in KEYS:
    x = R[R.index.isin(lists[k])].copy()
    x['rank5'] = x.ret5.rank(ascending=False, method='min')
    x = x.sort_values(['ret_best', 'ret5'], ascending=False, na_position='last')
    tb = x.profit_best.sum() / x.cap_best.sum(); t5 = x.profit5.sum() / x.cap5.sum()
    md.append(f'### {LAB[k]} list ({len(x)} names' + (f', top {TOPN[k]}' if TOPN[k] else '') + ')')
    md.append(f'Whole list: **{t5:.2%}** at the 0.5% profit taker (${x.profit5.sum():,.2f} on ${x.cap5.sum():,.2f}); {tb:.2%} if every stock used its best profit taker '
              f'(${x.profit_best.sum():,.2f} on ${x.cap_best.sum():,.2f}); median true range {x.tr.median():.2%}.\n')
    md.append('| # | Stock | Best profit taker | Return at best (cycles) | Return at 0.5% (cycles) (rank) | Profit at 0.5% | Capital at 0.5% | Cycles at 0.5% | Day\'s range | True range |')
    md.append('|---|---|---|---|---|---|---|---|---|---|')
    for i, (s, r) in enumerate(x.head(TOPN[k] or len(x)).iterrows(), 1):
        if r.small:
            md.append(f'| {i} | {s} | – | under ${MINCAP:.2f} exposed | – | ${r.profit5:,.2f} | ${r.cap5:,.2f} | {int(r.cyc5)} | {r.range:.1%} | {r.tr:.2%} |'); continue
        md.append(f'| {i} | {s} | {pf(r.best_pt)} | {r.ret_best:.1%} | {r.ret5:.1%} ({int(r.rank5)}) | ${r.profit5:,.2f} | ${r.cap5:,.2f} | {int(r.cyc5):,} | {r.range:.1%} | {r.tr:.2%} |')
    md.append('')
open(f'{OUT}/day_rank_{DAY}.md', 'w').write('\n'.join(md))

# ---- workbook
wb = Workbook(); Bf = Font(name='Arial', bold=True); Nf = Font(name='Arial'); HF = PatternFill('solid', fgColor='DDEBF7')
ws = wb.active; ws.title = 'Notes'
notes = [f'One-day cycles ranking, {dn}: Average Daily Volume Segmented Stocks Lists (snapshot {SNAP})',
         f'Bot day = 8:00 pm ET {PREV} to 8:00 pm ET {DAY} (1-minute SIP 04:00-20:00 + overnight BOATS bars), fresh start at the first bar.',
         f'Grid: botsim.py, whole cents, step = max(1 cent, 0.1% of the first price), profit taker 5 steps (0.5%), levels follow the price both ways, ${LOT:g} per level.',
         'Profit-taker sweep 0.1%-2%; best = highest return after fees for that stock. Return (cycles) = realized profit / time-weighted capital exposed that day.',
         f'Returns need >= ${MINCAP:.2f} exposed. Fees $0.005 per share sold. Dollar figures are per ${LOT:g} per level (multiply by your amount; returns stay the same).',
         "Day's range = (high - low) / low over the bot day. True range = (max(high, prior close) - min(low, prior close)) / prior close (prior close = Thursday 8 pm).",
         'True range, regular hours = same with 9:30-16:00 prices and the prior regular close. ATR14 % = 14-day average true range of daily bars / close.']
for i, t in enumerate(notes): ws.cell(i + 1, 1, t).font = Bf if i == 0 else Nf
ws.column_dimensions['A'].width = 150
cols = [('#', 'rank', '0'), ('Stock', 'sym', None), ('Best profit taker', 'best_pt', '0.00%'), ('Return at best profit taker (cycles)', 'ret_best', '0.0%'),
        ('Return after fees at best profit taker', 'net_best', '0.0%'), ('Profit at best profit taker ($)', 'profit_best', '$#,##0.00'),
        ('Return at 0.5% profit taker (cycles)', 'ret5', '0.0%'), ('Return after fees at 0.5%', 'net5', '0.0%'), ('Profit at 0.5% ($)', 'profit5', '$#,##0.00'),
        ('Capital exposed at 0.5% ($)', 'cap5', '$#,##0.00'), ('Cycles at 0.5%', 'cyc5', '#,##0'), ('Fees at 0.5% ($)', 'fees5', '$#,##0.00'),
        ('Grid step ($)', 'step', '$#,##0.00'), ('Low', 'low', '$#,##0.00'), ('High', 'high', '$#,##0.00'), ("Day's range", 'range', '0.0%'),
        ('True range', 'tr', '0.00%'), ('True range, regular hours', 'tr_reg', '0.00%'), ('ATR14 %', 'atr14p', '0.00%'),
        ('Close (8 pm)', 'close', '$#,##0.00'), ('Change vs prior close', 'chg', '0.0%')]
for k in KEYS:
    x = R[R.index.isin(lists[k])].sort_values(['ret_best', 'ret5'], ascending=False, na_position='last').copy()
    x['rank'] = np.arange(1, len(x) + 1); x['sym'] = x.index
    w = wb.create_sheet(f'Over {LAB[k]}')
    widths = [max(9, min(24, max(math.ceil(len(h) / 3) + 4, 11 if (f or '').startswith('$') else 8))) for h, _, f in cols]
    for j, (h, _, _) in enumerate(cols):
        c = w.cell(1, j + 1, h); c.font = Bf; c.fill = HF; c.alignment = Alignment(wrap_text=True, vertical='top', horizontal='center')
        w.column_dimensions[get_column_letter(j + 1)].width = widths[j]
    for i, (_, r) in enumerate(x.iterrows()):
        for j, (_, kk, f) in enumerate(cols):
            v = r[kk]
            if isinstance(v, (float, np.floating)): v = float(v) if np.isfinite(v) else None
            elif isinstance(v, np.integer): v = int(v)
            c = w.cell(i + 2, j + 1, v); c.font = Nf
            if f: c.number_format = f
    w.row_dimensions[1].height = 64; w.freeze_panes = 'C2'; w.auto_filter.ref = f'A1:{get_column_letter(len(cols))}{len(x) + 1}'
out = f'{OUT}/One-Day Cycles Ranking {DAY} (ADV Segmented Lists).xlsx'; wb.save(out)
print('WROTE', out, f'{OUT}/day_rank_{DAY}.md', '| names', len(R), '| small', int(R.small.sum()))
