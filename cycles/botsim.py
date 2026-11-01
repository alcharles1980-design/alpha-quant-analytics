"""Bot-faithful grid simulator (28 Oct 2026). Follows the live mbot logic found in the stats DB:

- chase=True (DEFAULT since 28 Oct, Albert): levels exist both ways from the first price, so ranges and lots follow the price
  wherever it goes (no ceiling, no floor). chase=False or a starting_price given: levels hang DOWN from the starting price and
  nothing is bought above it — the live bot's rule (used to replay existing configs).
  percent increment -> geometric, fixed increment -> arithmetic $; prices rounded to the whole cent (also under $1), duplicate
  levels collapse, so steps are never below one cent.
- Profit taker: percent -> level x (1+pt); fixed -> level + pt.
- A level buys when the price falls to it and it is free; its lot sells at its target; the level then re-arms.
- Optional window cap (max active ranges = max lots held); the bot's live windows are 50-250. None = no cap.
- Lot: quantity (shares) or amount ($, fractional shares). auto_compound: each level's lot grows by that level's own banked profit.
- sell_only: no buys. Optional carried lots (entry, target, qty) to start from a live state.
- Fills at level / target (fill='touch'); fill='through' needs the price to trade 1 cent through. gapfill=1 (default since
  28 Oct): when a bar that follows a >1-minute pause in trading OPENS beyond a level/target, the fill is at the open (session
  opens, thin overnight market) — the bot gets those better prices (live TQQQ $0.0657 per $0.06 cycle, overnight $0.080).
  gapfill=True on every bar overstates small profit takers (TQQQ pre-market +49%); False misses the overnight gains.
- Calibration TQQQ 28 Sep-23 Oct ($0.04/$0.06, 1 sh), net vs live $1,216: no gap fills $1,071 (-12%); gap fills after >1-min
  pauses $1,157 (-5%; overnight $300 vs $323); gap fills on every bar $1,255 (+3%, but pre-market $383 vs $258). Pre-market runs
  high (+28%) and regular hours low (-16%, 1-min bars miss swings inside a minute) under every option; they largely offset.
- Data: 1-minute SIP bars 04:00-20:00 ET PLUS overnight 1-minute bars 20:00-04:00 from Alpaca feed='boats' (add_overnight();
  pull with pull_boats.py) — the bot trades overnight. In-bar path O-L-H-C (up bar) or O-H-L-C (down bar).
- Day = 20:00 ET previous day -> 20:00 ET; return = realized profit / time-weighted capital exposed; fees $0.005 per share sold.
Calibration vs live (19-27 Oct, 73 configs, own settings + live lots + window): cycles +14%, profit +6%, correlation 0.90.

BASE test settings (Albert, 28 Oct, final): whole cents only; shape='cents': step = max(1 cent, 0.1% of the first price) rounded
to the cent, profit taker = 5 steps (PT% / step% steps when sweeping), arithmetic levels chasing the price both ways (no ceiling),
$1 per level (was $10 until 1 Nov 2026; results scale linearly), no window cap, touch fills. On a $2 stock that is a 1c step and 5c PT; on $150, 15c step and 75c PT.
Correlation with live return on new capital (19-27 Oct): 0.92 Mon-Tue, 0.76 week, 0.78 average day (plain 0.1%/0.5% cents:
0.84 / 0.57 / 0.67)."""
import numpy as np, pandas as pd
from numba import njit

FEE = 0.005
BASE = dict(inc=0.1, inc_type='percent', pt=0.5, pt_type='percent', amount=1.0, quantity=None, auto_compound=False,
            chase=True, start_headroom=0.05, starting_price=None, max_ranges=None, sell_only=False, fill='touch', round_cents=True,
            shape='cents', gapfill=1)


def lattice_chase(anchor, inc, inc_type, pt, pt_type, lo, hi, round_cents=True):
    """Levels both ways from the first price: the grid follows the price wherever it goes (no ceiling, no floor)."""
    dec = 2 if round_cents else 8
    if inc_type == 'percent':
        r = 1 + inc / 100
        k0 = int(np.floor(np.log(max(lo, 1e-6) / anchor) / np.log(r))) - 2; k1 = int(np.ceil(np.log(hi / anchor) / np.log(r))) + 2
        Lv = anchor * r ** np.arange(k0, k1 + 1)
    else:
        k0 = int(np.floor((lo - anchor) / inc)) - 2; k1 = int(np.ceil((hi - anchor) / inc)) + 2
        Lv = anchor + inc * np.arange(k0, k1 + 1)
    Lv = np.unique(np.round(Lv[Lv > 0], dec))
    Tg = Lv * (1 + pt / 100) if pt_type == 'percent' else Lv + pt
    return Lv, np.round(Tg, dec)


def lattice(sp, inc, inc_type, pt, pt_type, lo):
    """Levels from the starting price down to lo (ascending), and their targets."""
    dec = 2
    if inc_type == 'percent':
        n = int(np.ceil(np.log(sp / max(lo, 1e-6)) / np.log(1 + inc / 100))) + 3
        Lv = sp / (1 + inc / 100) ** np.arange(n)
    else:
        n = int(np.ceil((sp - lo) / inc)) + 3
        Lv = sp - inc * np.arange(n)
    Lv = np.unique(np.round(Lv[Lv > 0], dec))
    Tg = Lv * (1 + pt / 100) if pt_type == 'percent' else Lv + pt
    return Lv, np.round(Tg, dec)


@njit(cache=True)
def _run(t, o, h, l, c, Lv, Tg, base_val, compound, held, bpx, tgt, qty, bt, acc, oflag, obpx, otgt, oqty, obt, can_buy, cap, tick, maxn, tmargin, gapok, ptb):
    n = len(Lv)
    cb = np.empty(maxn, np.int64); cs = np.empty(maxn, np.int64); cc = np.empty(maxn); cp = np.empty(maxn); cq = np.empty(maxn); m = 0
    nheld = 0
    for i in range(n):
        if held[i]: nheld += 1
    for j in range(len(oflag)):
        if oflag[j]: nheld += 1
    prev = o[0]
    for k in range(len(o)):
        pts = (o[k], l[k], h[k], c[k]) if c[k] >= o[k] else (o[k], h[k], l[k], c[k])
        a = prev
        for s in range(4):
            b = pts[s]
            if b < a and can_buy:
                i0 = np.searchsorted(Lv, b + tick, 'left'); i1 = np.searchsorted(Lv, a + tick, 'left')
                for i in range(i1 - 1, i0 - 1, -1):
                    if (not held[i]) and nheld < cap:
                        v = base_val[i] + (acc[i] if compound else 0.0)
                        fp = b if (gapok[k] and s == 0 and b < Lv[i]) else Lv[i]      # gap down through the level: filled at the open
                        tg_i = Tg[i] if ptb[k] <= 0 else np.round(Lv[i] + ptb[k], 2)   # per-bar $ profit taker (overnight PT / PT change at a time)
                        held[i] = True; bpx[i] = fp; tgt[i] = tg_i; qty[i] = v / Lv[i]; bt[i] = t[k]; nheld += 1
            elif b > a:
                j0 = np.searchsorted(Tg, a - tick - tmargin, 'left'); j1 = np.searchsorted(Tg, b - tick + tmargin, 'right')
                for i in range(j0, j1):
                    if held[i] and a - tick < tgt[i] <= b - tick:
                        sp = b if (gapok[k] and s == 0 and b > tgt[i]) else tgt[i]      # gap up through the target: filled at the open
                        if m < maxn:
                            cb[m] = bt[i]; cs[m] = t[k]; cc[m] = qty[i] * bpx[i]; cp[m] = qty[i] * (sp - bpx[i]); cq[m] = qty[i]; m += 1
                        acc[i] += qty[i] * (sp - bpx[i]); held[i] = False; nheld -= 1
                for j in range(len(oflag)):
                    if oflag[j] and a - tick < otgt[j] <= b - tick:
                        sp = b if (gapok[k] and s == 0 and b > otgt[j]) else otgt[j]
                        if m < maxn:
                            cb[m] = obt[j]; cs[m] = t[k]; cc[m] = oqty[j] * obpx[j]; cp[m] = oqty[j] * (sp - obpx[j]); cq[m] = oqty[j]; m += 1
                        oflag[j] = False; nheld -= 1
            a = b
        prev = c[k]
    return cb[:m], cs[:m], cc[:m], cp[:m], cq[:m]


def _gapflags(tmin, mode):
    """Which bars may fill at their open (gap fill): False/None = none; True/'all' = every bar; an int n = only bars that come
    more than n minutes after the previous bar (a real gap in trading, e.g. session opens, thin overnight markets)."""
    n = len(tmin)
    if not mode: return np.zeros(n, np.bool_)
    if mode is True or mode == 'all': return np.ones(n, np.bool_)
    d = np.r_[10 ** 6, np.diff(tmin)]
    return d > int(mode)


def run_stock(bars, cfg=None, carried=None, maxn=400000):
    """bars: one stock's 1-min bars (columns t, o, h, l, c), time-sorted. cfg: dict overriding BASE.
    carried: DataFrame (entry, target, qty, t0) of lots already held at the first bar.
    Returns cycles DataFrame (t0, t1, cost, profit, qty) and open lots DataFrame (t0, cost, entry, qty, target)."""
    cf = dict(BASE); cf.update(cfg or {})
    o, h, l, c = (bars[k].to_numpy(np.float64) for k in 'ohlc')
    tmin = ((bars.t - pd.Timestamp('2026-01-01')).dt.total_seconds() // 60).to_numpy(np.int64)
    lo = min(l.min(), carried.entry.min() if carried is not None and len(carried) else np.inf) * 0.97
    step_abs = pt_abs = None
    if cf.get('shape') == 'cents' and cf['inc_type'] == 'percent' and cf['pt_type'] == 'percent' and carried is None and not cf['starting_price']:
        # whole-cent grid with the same SHAPE for every stock: step = max(1 tick, inc% of the first price) in cents,
        # profit taker = (pt / inc) steps, e.g. 0.1% / 0.5% -> PT = 5 steps. Best correlation with live (28 Oct test).
        tick = 0.01; dec = 2          # whole cents only (Albert, 28 Oct), also under $1
        step_abs = max(tick, round(o[0] * cf['inc'] / 100, dec)); pt_abs = max(tick, round(step_abs * cf['pt'] / cf['inc'], dec))
        cf = dict(cf, inc=step_abs, inc_type='fixed', pt=pt_abs, pt_type='fixed')
    if cf['chase'] and not cf['starting_price']:
        sp = None
        Lv, Tg = lattice_chase(o[0], cf['inc'], cf['inc_type'], cf['pt'], cf['pt_type'], lo, h.max() * 1.03, cf['round_cents'])
    else:
        sp = cf['starting_price'] if cf['starting_price'] else round(o[0] * (1 + cf['start_headroom']), 2)
        Lv, Tg = lattice(sp, cf['inc'], cf['inc_type'], cf['pt'], cf['pt_type'], lo)
    n = len(Lv)
    base_val = np.full(n, float(cf['amount'])) if cf['amount'] else float(cf['quantity']) * Lv
    held = np.zeros(n, np.bool_); bpx = np.zeros(n); tgt = np.zeros(n); qty = np.zeros(n); bt = np.zeros(n, np.int64); acc = np.zeros(n)
    of, ob, ot, oq, obt = [], [], [], [], []; tmargin = 1e-9
    if carried is not None and len(carried):
        step = np.median(np.diff(Lv)) if n > 1 else 1.0
        for r in carried.itertuples():
            t0 = int((pd.Timestamp(r.t0) - pd.Timestamp('2026-01-01')).total_seconds() // 60)
            i = int(np.argmin(np.abs(Lv - r.entry))) if n else 0
            if n and abs(Lv[i] - r.entry) <= 0.5 * max(step, Lv[i] * 1e-4) and not held[i]:
                held[i] = True; bpx[i] = r.entry; tgt[i] = r.target; qty[i] = r.qty; bt[i] = t0
                tmargin = max(tmargin, abs(r.target - Tg[i]) + 1e-9)
            else:
                of.append(True); ob.append(r.entry); ot.append(r.target); oq.append(r.qty); obt.append(t0)
    cap = int(cf['max_ranges']) if cf['max_ranges'] else 10 ** 9
    tick = 0.01 if cf['fill'] == 'through' else 0.0
    # per-bar $ profit taker for lots bought at that bar (0 = the grid's own PT):
    #   pt_night: separate PT for lots BOUGHT 20:00-04:00 ET; pt_switch=(timestamp, new_pt): lots bought from that time on get new_pt
    ptb = np.zeros(len(o))
    ptn = float(cf.get('pt_night') or 0.0)
    if ptn > 0:
        mod = ((bars.t - bars.t.dt.normalize()).dt.total_seconds() // 60).to_numpy(np.int64)
        ptb[(mod >= 1200) | (mod < 240)] = ptn
    if cf.get('pt_switch'):
        ts, newpt = cf['pt_switch']; ptb[(bars.t >= pd.Timestamp(ts)).to_numpy()] = float(newpt)
    if (ptb > 0).any() and len(Lv): tmargin = max(tmargin, float(np.abs(ptb[ptb > 0] - np.median(Tg - Lv)).max()) + 0.011)
    cb, cs, cc, cp, cq = _run(tmin, o, h, l, c, Lv, Tg, base_val, bool(cf['auto_compound']), held, bpx, tgt, qty, bt, acc,
                              np.array(of, np.bool_), np.array(ob, np.float64), np.array(ot, np.float64), np.array(oq, np.float64),
                              np.array(obt, np.int64), not cf['sell_only'], cap, tick, maxn, tmargin, _gapflags(tmin, cf.get('gapfill', False)), ptb)
    tom = lambda a: pd.Timestamp('2026-01-01') + pd.to_timedelta(np.asarray(a), unit='min')
    cyc = pd.DataFrame({'t0': tom(cb), 't1': tom(cs), 'cost': cc, 'profit': cp, 'qty': cq})
    oi = np.nonzero(held)[0]; oj = [j for j in range(len(of)) if of[j]]
    opn = pd.DataFrame({'t0': tom(np.r_[bt[oi], np.array(obt, np.int64)[oj] if oj else []].astype(np.int64)),
                        'cost': np.r_[qty[oi] * bpx[oi], [oq[j] * ob[j] for j in oj]], 'entry': np.r_[bpx[oi], [ob[j] for j in oj]],
                        'qty': np.r_[qty[oi], [oq[j] for j in oj]], 'target': np.r_[tgt[oi], [ot[j] for j in oj]]})
    return cyc, opn, dict(starting_price=sp, levels=n, step=step_abs, pt_abs=pt_abs, first=o[0])


def win(d):
    return pd.Timestamp(d) - pd.Timedelta(hours=4), pd.Timestamp(d) + pd.Timedelta(hours=20)


def daily(cyc, opn, days, end=None):
    """Per-day (20:00 -> 20:00 ET) exposure, profit, cycles, fees for one stock's run."""
    end = end or win(days[-1])[1]
    t0 = np.r_[cyc.t0.values, opn.t0.values].astype('datetime64[ns]')
    t1 = np.r_[cyc.t1.values, np.full(len(opn), np.datetime64(end, 'ns'))].astype('datetime64[ns]')
    cost = np.r_[cyc.cost.values, opn.cost.values]; ts = cyc.t1.values.astype('datetime64[ns]')
    rows = []
    for d in days:
        s0, s1 = (np.datetime64(x, 'ns') for x in win(d))
        frac = ((np.minimum(t1, s1) - np.maximum(t0, s0)) / np.timedelta64(1, 'D')).clip(min=0)
        sel = (ts >= s0) & (ts < s1)
        rows.append(dict(date=str(d), exposure=float((frac * cost).sum()), profit=float(cyc.profit.values[sel].sum()),
                         cycles=int(sel.sum()), fees=float(cyc.qty.values[sel].sum() * FEE)))
    return pd.DataFrame(rows)


def simulate(bars_all, days, cfg=None, by='sym'):
    """Run every symbol in bars_all (fresh start at its first bar) with cfg; returns per (sym, day) metrics and per-sym summary."""
    out, summ = [], []
    for s, g in bars_all.sort_values([by, 't']).groupby(by):
        cyc, opn, info = run_stock(g, cfg)
        X = daily(cyc, opn, days); X.insert(0, 'sym', s); out.append(X)
        last = g.c.iloc[-1]
        summ.append(dict(sym=s, starting_price=info['starting_price'], open_lots=len(opn), open_cost=float(opn.cost.sum()),
                         unrealized=float((opn.qty * (last - opn.entry)).sum()), last=last, low=g.l.min(), high=g.h.max(), first=g.o.iloc[0]))
    return pd.concat(out, ignore_index=True), pd.DataFrame(summ).set_index('sym')


try:                                   # kit folders (config.py); standalone use: set botsim.BOATS_DIR yourself
    import config as _C; BOATS_DIR = _C.BOATS
except Exception:
    BOATS_DIR = 'boats'


def add_overnight(bars, days, by='sym'):
    """Append the Blue Ocean overnight 1-min bars (20:00-04:00 ET, Alpaca feed='boats', from pull_boats.py) for the nights
    before each session in `days`, for the symbols present in `bars`. The bot trades overnight (~11-20% of its cycles), so every
    simulation should include them (Albert, 28 Oct). Missing nights are skipped silently."""
    import os
    syms = set(bars[by].unique()); parts = [bars]
    for d in days:
        p = f'{BOATS_DIR}/{d}.parquet'
        if os.path.exists(p):
            x = pd.read_parquet(p); x = x[x.sym.isin(syms)]
            if by != 'sym': x = x.rename(columns={'sym': by})
            parts.append(x[[c for c in bars.columns if c in x.columns]])
    return pd.concat(parts, ignore_index=True).sort_values([by, 't']).reset_index(drop=True)
