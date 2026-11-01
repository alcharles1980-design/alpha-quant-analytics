"""Rolling N-session cycles ranking for the four ADV lists (AQA page "Stocks By Cycles Returns % List", 1 Nov 2026).
  python3 roll_rank.py END_SESSION SNAPSHOT [N=5]        e.g. 2026-10-30 2026-10-30 22   (the page runs N=5 and N=22)

The same run as week_rank.py, over any N consecutive sessions instead of a Mon-Fri week: the bot period starts at 8:00 pm ET the evening
before the first session (the overnight bars filed under that session) and ends at 8:00 pm ET on END_SESSION, fresh start at the first
bar, lots carried day to day, list base settings (PT 0.5%) plus the profit-taker sweep 0.1%-2% (best = highest return after fees).
Return = period profit / average daily capital exposed, needs >= $0.50 exposed. Split handling as the weekly runs (the period is put on
its last session's share basis). When the N sessions are exactly one Mon-Fri week this IS week_rank.py's result (checked 1 Nov 2026:
identical parquet for 26-30 Oct).
Writes day_rank/roll<N>_rank_<END>.parquet (same columns as day_rank_<DAY>.parquet; ATR14 from day_rank_<END>.parquet when present) + the sweep."""
import os, sys, datetime as dt, multiprocessing as mp, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C, botsim as BS, consist_report as CR, scan_orig as S
END, SNAP = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 5
LOT = 1.0; MINCAP = LOT / 2
PTS = [0.001, 0.0015, 0.002, 0.0025, 0.003, 0.0035, 0.004, 0.005, 0.006, 0.0075, 0.01, 0.0125, 0.015, 0.02]
U = C.UNIVERSE; OUT = f'{C.REPORTS}/day_rank'
SYMS = sorted(set(pd.read_csv(f'{U}/adv_over_500m_{SNAP}.csv').ticker))
_cal = [str(d) for d in S.cal(pd.Timestamp(END).date() - dt.timedelta(days=N * 2 + 14), pd.Timestamp(END).date())]
assert _cal and _cal[-1] == END, f'{END} is not a trading session'
DAYS = _cal[-N:]
PREV = _cal[-N - 1]


def work(chunk):
    B = CR.adjust_splits(CR.load_bars(DAYS, syms=set(chunk), chunk=chunk), 'week')
    rows, prc = [], []
    for s, g in B.groupby('sym'):
        gs = set(g.session.unique()); sdays = [d for d in DAYS if d in gs]
        g = g[['t', 'o', 'h', 'l', 'c']].reset_index(drop=True)
        if len(g) < 10: continue
        for pt in PTS:
            cyc, opn, info = BS.run_stock(g, dict(pt=pt * 100, amount=LOT), maxn=2000000)
            D = BS.daily(cyc, opn, sdays)
            rows.append(dict(sym=s, pt=pt, exposure=D.exposure.mean(), profit=D.profit.sum(), cycles=int(D.cycles.sum()), fees=D.fees.sum(),
                             open_lots=len(opn), step=info['step']))
        hm = g.t.dt.hour * 60 + g.t.dt.minute; r = g[(hm >= 570) & (hm < 960)]
        prc.append(dict(sym=s, low=g.l.min(), high=g.h.max(), close=g.c.iloc[-1], r_low=r.l.min() if len(r) else np.nan, r_high=r.h.max() if len(r) else np.nan))
    return rows, prc


if __name__ == '__main__':
    CR.ensure_minutes(SYMS, [PREV] + DAYS); CR.ensure_overnight(SYMS, DAYS)      # pull any missing bars (no-op when ADV_OFFLINE=1)
    CR.FACT = CR.split_factors(SYMS, PREV, pd.Timestamp.now(tz='America/New_York').date().isoformat())
    chunks = [SYMS[i:i + 8] for i in range(0, len(SYMS), 8)]
    rows, prc = [], []
    with mp.get_context('fork').Pool(2) as P:
        for i, (r, p) in enumerate(P.imap_unordered(work, chunks)):
            rows += r; prc += p
            if i % 5 == 0: print('chunk', i + 1, 'of', len(chunks), flush=True)
    X = pd.DataFrame(rows); Pr = pd.DataFrame(prc).set_index('sym')
    X['ret'] = X.profit / X.exposure.where(X.exposure >= MINCAP); X['net'] = (X.profit - X.fees) / X.exposure.where(X.exposure >= MINCAP)
    # the prior session's closes (8 pm and regular 4 pm) for the period's true range and change
    P0 = pd.read_parquet(f'{CR.M1}/{PREV}.parquet'); P0 = P0[P0.sym.isin(SYMS)].sort_values(['sym', 't'])
    P0 = P0[(P0.t.dt.hour >= 4) & (P0.t.dt.hour < 20)]
    pc = P0.groupby('sym').c.last()
    m = P0.t.dt.hour * 60 + P0.t.dt.minute; pc_reg = P0[(m >= 570) & (m < 960)].groupby('sym').c.last()
    Pr = Pr.join(pc.rename('pc')).join(pc_reg.rename('pc_reg'))
    Pr['range'] = Pr.high / Pr.low - 1
    Pr['tr'] = (np.maximum(Pr.high, Pr.pc) - np.minimum(Pr.low, Pr.pc)) / Pr.pc
    Pr['tr_reg'] = (np.maximum(Pr.r_high, Pr.pc_reg) - np.minimum(Pr.r_low, Pr.pc_reg)) / Pr.pc_reg
    Pr['chg'] = Pr.close / Pr.pc - 1
    at5 = X[X.pt == 0.005].set_index('sym')
    best = X.dropna(subset=['net']).sort_values(['net', 'pt'], ascending=[False, True], kind='mergesort').groupby('sym').head(1).set_index('sym')   # ties: smallest PT
    R = pd.DataFrame({'best_pt': best.pt, 'ret_best': best.ret, 'net_best': best.net, 'profit_best': best.profit, 'cap_best': best.exposure,
                      'ret5': at5.ret, 'net5': at5.net, 'profit5': at5.profit, 'cap5': at5.exposure, 'cyc5': at5.cycles, 'fees5': at5.fees,
                      'step': at5.step}).join(Pr[['low', 'high', 'range', 'tr', 'tr_reg', 'close', 'chg']])
    R['small'] = R.ret5.isna()
    endday = f'{OUT}/day_rank_{END}.parquet'
    if os.path.exists(endday): R = R.join(pd.read_parquet(endday)[['atr14p']])
    R.attrs = dict(kind='roll', end=END, days=DAYS, prev=PREV, n=N)
    os.makedirs(OUT, exist_ok=True); R.to_parquet(f'{OUT}/roll{N}_rank_{END}.parquet'); X.to_parquet(f'{OUT}/roll{N}_rank_sweep_{END}.parquet')
    print('ROLL_DONE', len(R), 'names | small', int(R.small.sum()), '| days', DAYS, '| prior close', PREV, flush=True)
