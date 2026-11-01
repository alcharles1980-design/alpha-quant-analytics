"""Consistency report for the four ADV-segmented lists over a chosen look-back, with a price dimension.

  python3 consist_report.py --weeks 52 [--end-week YYYY-MM-DD]      (Alpaca keys in the environment; folders in config.py)

Look-back = N complete Mon-Fri weeks ending with --end-week (default: the latest completed week).
1. Lists rebuilt point-in-time every Monday (for "weeks on list"): 20-session average daily $ volume (Alpaca SIP daily volume x
   VWAP, incl. extended hours) to the prior session, over $500m / $1bn / $5bn / $10bn.
2. Names on a list in every week of the look-back are simulated week by week (fresh each week; base test settings: whole cents,
   step max(1c, 0.1%), PT 5 steps, $1/level (was $10 until 1 Nov 2026), 1-min SIP 04:00-20:00 raw + overnight BOATS; fees $0.005/share sold).
   Weekly return = week profit / average daily capital exposed.
3. Price dimension (split-adjusted daily closes): peak close inside the look-back (from its first Monday to the latest close) and its
   date; current price = latest completed close; drawdown from peak = current / peak - 1; 100- and 200-day simple moving averages of the
   closes and the current price's distance from each.
Outputs (in <reports>/out_<start>_to_<end>_<mode>/): workbook, chat markdown, parquet results."""
import os, sys, glob, argparse, subprocess, datetime as dt, multiprocessing as mp
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C
from sss.alpaca import daily_bars, calendar
import scan_orig as S, botsim as BS
HERE = C.REPORTS; M1 = C.M1; BOATS = C.BOATS
UNIV = os.environ.get('ADV_WEEKLY_UNIVERSE')   # optional ticker file for the point-in-time weekly lists; default = every name on the latest snapshot lists
LISTS = (('500m', 5e8), ('1bn', 1e9), ('5bn', 5e9), ('10bn', 1e10))
LAB = {'500m': '$500m', '1bn': '$1bn', '5bn': '$5bn', '10bn': '$10bn'}
LOT = 1.0          # $ per level (range); Albert 1 Nov 2026: $1 so results scale to any amount (was $10). Min capital for a return = LOT / 2


def args():
    ap = argparse.ArgumentParser(); ap.add_argument('--weeks', type=int, default=13); ap.add_argument('--end-week')
    ap.add_argument('--cont-grid', choices=['auto', 'cents', 'percent'], default='auto',
                    help='continuous capital run: cents = fixed whole-cent step from the first price (base settings); percent = 0.1%% step / 0.5%% PT at '
                         'every price (rounded to cents). auto = percent when the look-back is over 13 weeks (a fixed step set a year ago is unrealistic)')
    ap.add_argument('--reuse-weekly', action='store_true', help='reuse weekly_results.parquet in the output folder (skip the weekly simulations)')
    ap.add_argument('--render-only', metavar='OUT_DIR', help='rebuild the workbook + chat tables from a finished run (e.g. after an analyst refresh)')
    ap.add_argument('--lists', choices=['official', 'consistent'], default='official',
                    help='official = the current snapshot lists (all members); consistent = names on a list every week of the look-back')
    a = ap.parse_args()
    if a.render_only: render_only(a.render_only); sys.exit(0)
    today = pd.Timestamp.now(tz='America/New_York').date()   # exchange date, not the server's UTC date
    if a.end_week: end_mon = pd.Timestamp(a.end_week)
    else:
        sess = calendar(today - dt.timedelta(days=14), today)
        last_done = sess[-1] if (sess[-1] < today.isoformat() or pd.Timestamp.now(tz='America/New_York').hour >= 20) else sess[-2]
        ld = pd.Timestamp(last_done); mon = ld - pd.Timedelta(days=ld.weekday())
        # a week is complete when its last session (normally Friday) is done
        wk_sess = [d for d in sess if mon <= pd.Timestamp(d) <= mon + pd.Timedelta(days=4)]
        end_mon = mon if wk_sess and wk_sess[-1] == last_done and pd.Timestamp(last_done).weekday() == 4 else mon - pd.Timedelta(days=7)
    mondays = [end_mon - pd.Timedelta(days=7 * i) for i in range(a.weeks)][::-1]
    global CONT_GRID, REUSE
    CONT_GRID = a.cont_grid if a.cont_grid != 'auto' else ('percent' if a.weeks > 13 else 'cents'); REUSE = a.reuse_weekly
    return mondays, a.lists


def weekly_lists(mondays):
    syms = (open(UNIV).read().split() if UNIV else
            sorted(set().union(*[set(pd.read_csv(f).ticker) for f in sorted(glob.glob(f'{C.UNIVERSE}/adv_over_500m_*.csv'))[-1:]])))
    start = (mondays[0] - pd.Timedelta(days=45)).strftime('%Y-%m-%d'); end = (mondays[-1] + pd.Timedelta(days=4)).strftime('%Y-%m-%d')
    b = daily_bars(syms, start, end, adjustment='raw')
    b['dv'] = b.v * b.vw.fillna(b.c)
    DV = b.pivot_table(index='date', columns='sym', values='dv').sort_index(); DV.index = pd.to_datetime(DV.index)
    adv = DV.rolling(20, min_periods=15).mean()
    rows = []
    for m in mondays:
        prev = adv.index[adv.index < m]
        a = adv.loc[prev[-1]].dropna()
        for lab, th in LISTS:
            for s, v in a[a > th].items(): rows.append(dict(week=m.strftime('%Y-%m-%d'), list=lab, sym=s, adv20=v))
    return pd.DataFrame(rows)


def ensure_minutes(syms, days):
    os.makedirs(M1, exist_ok=True)
    for d in days:
        if C.OFFLINE: continue
        p = f'{M1}/{d}.parquet'; have = set(pd.read_parquet(p, columns=['sym']).sym) if os.path.exists(p) else set()
        need = sorted(set(syms) - have)
        if not need: continue
        dd = pd.Timestamp(d).date(); x = S.bars(need, '1Min', S.utc(dd, 4, 0), S.utc(dd, 19, 59), adj='raw')
        if len(x):
            x['t'] = x.t.dt.tz_convert('America/New_York').dt.tz_localize(None); x = x[['sym', 't', 'o', 'h', 'l', 'c', 'v']]
            if os.path.exists(p): x = pd.concat([pd.read_parquet(p), x]).drop_duplicates(['sym', 't'], keep='last')
            x.sort_values(['sym', 't']).to_parquet(p)
        print('minutes', d, len(need), 'pulled', flush=True)


BOATS_REQ = f'{BOATS}/_requested.json'       # session -> names already requested for that night (AQA, 1 Nov 2026)


def boats_requested():
    import json
    return {k: set(v) for k, v in json.load(open(BOATS_REQ)).items()} if os.path.exists(BOATS_REQ) else {}


def boats_mark(req, days, syms):
    import json
    for d in days: req[d] = req.get(d, set()) | set(syms)
    os.makedirs(BOATS, exist_ok=True); tmp = BOATS_REQ + '.tmp'
    json.dump({k: sorted(v) for k, v in sorted(req.items())}, open(tmp, 'w')); os.replace(tmp, BOATS_REQ)


def ensure_overnight(syms, days):
    """Pull the overnight bars of every (night, name) not requested before. A name with no overnight trades never appears in a night's
    file, so presence cannot tell "no trades" from "never asked": a manifest of what was requested per night does.
    AQA fix, 1 Nov 2026. The kit's rule pulled only names absent from EVERY night of the window, so a name present in one night was
    never pulled for the others. The kit's 52-week reference run had no overnight bars for most of the year for AAOI, APLD, CRDO, IREN,
    IONQ, WULF, SOFI, SHW, MRNA, SKHY, IEF, CCL and TWLO (removing overnight bars from complete data reproduced its figures exactly).
    Pulls go in runs of up to 20 sessions, so a year is never held in memory at once. pull_boats.py merges into existing files."""
    if C.OFFLINE: return
    days = list(days); req = boats_requested()
    need = {d: set(syms) - req.get(d, set()) for d in days}
    i = 0
    while i < len(days):
        if not need[days[i]]: i += 1; continue
        chunk = days[i:i + 20]; names = set().union(*(need[d] for d in chunk))
        f = f'{HERE}/_boats_need.txt'; open(f, 'w').write('\n'.join(sorted(names)) + '\n')
        r = subprocess.run([sys.executable, os.path.join(C.CODE, 'pull_boats.py'), chunk[0], chunk[-1], f])
        if r.returncode != 0: raise RuntimeError(f'pull_boats {chunk[0]}..{chunk[-1]} failed ({len(names)} names)')
        boats_mark(req, chunk, names); i += len(chunk)


CONT_GRID = 'cents'; REUSE = False
FIRST = {}    # symbol -> first session with an official daily bar (earlier minute prints belong to an older use of the ticker, e.g. SPCX)
FACT = None   # sessions x symbols: raw close / split-adjusted close, snapped to the split ratio (set in main before the worker pools fork)


def split_factors(syms, start, end):
    """Per-session split factor (1 = no split since that session). Raw minute bars / factor = prices on today's share basis."""
    from fractions import Fraction
    r = daily_bars(syms, start, end, adjustment='raw'); a = daily_bars(syms, start, end, adjustment='split')
    m = r[['sym', 'date', 'c']].merge(a[['sym', 'date', 'c']], on=['sym', 'date'], suffixes=('_r', '_a'))
    f = (m.c_r / m.c_a).values
    FIRST.update(m.groupby('sym').date.min().to_dict())
    m['f'] = [1.0 if abs(v - 1) < 1e-3 else (float(Fraction(v).limit_denominator(10)) if v >= 1 else 1 / float(Fraction(1 / v).limit_denominator(10))) for v in f]
    return m.pivot(index='date', columns='sym', values='f').sort_index().ffill().bfill()


def load_bars(days, syms=None, chunk=None):
    """1-min bars 04:00-20:00 (m1q3) + the overnight bars before each session (BOATS), each tagged with its session date."""
    parts = []
    for d in days:
        x = pd.read_parquet(f'{M1}/{d}.parquet', filters=[('sym', 'in', list(chunk))]) if chunk else pd.read_parquet(f'{M1}/{d}.parquet')
        if syms is not None: x = x[x.sym.isin(syms)]
        x = x[(x.t.dt.hour >= 4) & (x.t.dt.hour < 20)].copy(); x['session'] = d; parts.append(x)
    have = set(pd.concat(parts).sym.unique())
    for d in days:
        p = f'{BOATS}/{d}.parquet'
        if os.path.exists(p):
            y = pd.read_parquet(p); y = y[y.sym.isin(have)]
            if len(y): y = y[['sym', 't', 'o', 'h', 'l', 'c', 'v']].copy(); y['session'] = d; parts.append(y)
    return pd.concat(parts, ignore_index=True).sort_values(['sym', 't']).reset_index(drop=True)


def adjust_splits(B, basis):
    """basis='week': put a week on its last session's share basis (only weeks with a split change); 'current': today's basis."""
    if FIRST and not B.empty:
        fs = B.sym.map(FIRST); B = B[fs.isna() | (B.session >= fs)]
    if FACT is None or B.empty: return B
    F = FACT.reindex(columns=sorted(B.sym.unique())).ffill().bfill().fillna(1.0)
    ref = F.loc[F.index <= B.session.max()].iloc[-1] if basis == 'week' else F.iloc[-1]
    R = (F / ref).stack().rename('rel')
    B = B.join(R, on=['session', 'sym']); B['rel'] = B.rel.fillna(1.0)
    k = B.rel != 1.0
    if k.any():
        for c in ('o', 'h', 'l', 'c'): B.loc[k, c] = B.loc[k, c] / B.loc[k, 'rel']
        B['v'] = B.v.astype(float); B.loc[k, 'v'] = B.loc[k, 'v'] * B.loc[k, 'rel']
    return B.drop(columns='rel')


def sim_week(job):
    w, days, syms = job
    B = adjust_splits(load_bars(days, syms=set(syms)), 'week')
    rows = []
    for s, g in B.groupby('sym'):
        gs = set(g.session.unique()); sdays = [d for d in days if d in gs]          # sessions the stock traded (listing weeks: capital over its own days only)
        g = g[['t', 'o', 'h', 'l', 'c']].reset_index(drop=True)
        cyc, opn, info = BS.run_stock(g, dict(amount=LOT), maxn=2000000)
        D = BS.daily(cyc, opn, sdays)
        reg = g[(g.t.dt.hour >= 4) & (g.t.dt.hour < 20)]; last = g.c.iloc[-1]
        rows.append(dict(week=w, sym=s, sessions=len(sdays), cap=D.exposure.mean(), profit=D.profit.sum(), fees=D.fees.sum(), cycles=int(D.cycles.sum()),
                         open_lots=len(opn), open_cost=float(opn.cost.sum()), open_value=float((opn.qty * last).sum()),
                         wk_range=reg.h.max() / reg.l.min() - 1, wk_chg=last / g.o.iloc[0] - 1))
    return rows


def sim_continuous(job):
    """One continuous run per stock from the look-back's first bar to the latest session: lots carried throughout (as the bot does)."""
    chunk, days = job
    B = adjust_splits(load_bars(days, chunk=chunk), 'current')
    rows = []
    for s, g in B.groupby('sym'):
        gs = set(g.session.unique()); sdays = [d for d in days if d in gs]
        g = g.sort_values('t')[['t', 'o', 'h', 'l', 'c']].reset_index(drop=True)
        cyc, opn, info = BS.run_stock(g, dict(amount=LOT) if CONT_GRID == 'cents' else dict(amount=LOT, shape=None), maxn=5000000)
        D = BS.daily(cyc, opn, sdays)
        reg = g[(g.t.dt.hour >= 4) & (g.t.dt.hour < 20)]; last = g.c.iloc[-1]
        cap_now = float(opn.cost.sum()); val_now = float((opn.qty * last).sum())
        rows.append(dict(sym=s, lo=reg.l.min(), lo_t=reg.t.iloc[reg.l.values.argmin()], hi=reg.h.max(), hi_t=reg.t.iloc[reg.h.values.argmax()],
                         realized=D.profit.sum(), fees=D.fees.sum(), avg_cap=D.exposure.mean(), cycles_c=int(D.cycles.sum()),
                         open_lots_now=len(opn), cap_now=cap_now, value_now=val_now, last_px=last))
    return rows


MOM_LONG, MOM_SKIP = 84, 21     # 4 months / 1 month in sessions (Strategy A's 4-month score uses 84 sessions)


def momentum(syms, last_date, OUT=None):
    """4-month return excluding the last month = close 21 sessions ago / close 84 sessions ago - 1 (split-adjusted closes, as of last_date);
    also the plain 4-month return (Strategy A's score: latest close / close 84 sessions ago - 1) and the last month's return."""
    f = f'{OUT}/momentum.parquet' if OUT else None
    if f and os.path.exists(f):
        M = pd.read_parquet(f)
        if M.attrs.get('last_date') == str(last_date) and set(syms) <= set(M.index): return M
    b = daily_bars(syms, (pd.Timestamp(str(last_date)) - pd.Timedelta(days=200)).strftime('%Y-%m-%d'), str(last_date), adjustment='split')
    C = b[b.date <= str(last_date)].pivot_table(index='date', columns='sym', values='c').sort_index()
    rows = {}
    for s_ in syms:
        c = C[s_].dropna() if s_ in C else pd.Series(dtype=float)
        ok = len(c) > MOM_LONG
        rows[s_] = dict(mom_4x1=c.iloc[-1 - MOM_SKIP] / c.iloc[-1 - MOM_LONG] - 1 if ok else np.nan,
                        mom_4=c.iloc[-1] / c.iloc[-1 - MOM_LONG] - 1 if ok else np.nan,
                        mom_1=c.iloc[-1] / c.iloc[-1 - MOM_SKIP] - 1 if len(c) > MOM_SKIP else np.nan)
    M = pd.DataFrame(rows).T; M.attrs['last_date'] = str(last_date)
    if f: M.to_parquet(f)
    return M


def price_dimension(syms, look_start):
    today = pd.Timestamp.now(tz='America/New_York').date().isoformat()   # exchange date, not the server's UTC date
    b = daily_bars(syms, (pd.Timestamp(look_start) - pd.Timedelta(days=330)).strftime('%Y-%m-%d'), today, adjustment='split')
    C = b.pivot_table(index='date', columns='sym', values='c').sort_index()
    last_date = C.index[-1]
    win = C.loc[C.index >= look_start]
    out = pd.DataFrame({'peak': win.max(), 'peak_date': win.idxmax(), 'price': C.iloc[-1],
                        'sma100': C.rolling(100, min_periods=100).mean().iloc[-1], 'sma200': C.rolling(200, min_periods=200).mean().iloc[-1]})
    out['from_peak'] = out.price / out.peak - 1
    out['vs_sma100'] = out.price / out.sma100 - 1; out['vs_sma200'] = out.price / out.sma200 - 1
    return out, last_date


def main():
    mondays, mode = args()
    weeks = [m.strftime('%Y-%m-%d') for m in mondays]
    tag = f'{weeks[0]}_to_{(mondays[-1] + pd.Timedelta(days=4)).strftime("%m-%d")}'
    OUT = f'{HERE}/out_{tag}_{mode}'; os.makedirs(OUT, exist_ok=True)
    print('look-back weeks', weeks[0], '->', weeks[-1], len(weeks), flush=True)
    L = weekly_lists(mondays); L.to_parquet(f'{OUT}/weekly_lists.parquet')
    W = len(weeks)
    cnt = L.groupby(['list', 'sym']).size().unstack(0).reindex(columns=[k for k, _ in LISTS]).fillna(0).astype(int)
    cnt.to_parquet(f'{OUT}/weeks_on_list.parquet')
    snap = sorted(glob.glob(f'{C.UNIVERSE}/adv_over_500m_*.csv'))[-1].split('_')[-1][:-4]
    if mode == 'official':
        members = {k: set(pd.read_csv(f'{C.UNIVERSE}/adv_over_{k}_{snap}.csv').ticker) for k, _ in LISTS}
    else:
        members = {k: set(cnt.index[cnt[k] == W]) for k, _ in LISTS}
    syms = sorted(set().union(*members.values()))
    cnt = cnt.reindex(sorted(set(cnt.index) | set(syms))).fillna(0).astype(int)
    pd.Series({k: sorted(v) for k, v in members.items()}).to_json(f'{OUT}/members.json')
    days_by_week = {w: [str(d) for d in S.cal(pd.Timestamp(w).date(), (pd.Timestamp(w) + pd.Timedelta(days=4)).date())] for w in weeks}
    all_days = [d for w in weeks for d in days_by_week[w]]
    ensure_minutes(syms, all_days); ensure_overnight(syms, all_days)
    global FACT
    FACT = split_factors(syms, all_days[0], pd.Timestamp.now(tz='America/New_York').date().isoformat())
    FACT.to_parquet(f'{OUT}/split_factors.parquet')
    late = {k: v for k, v in FIRST.items() if v > all_days[0]}
    print('listed during the look-back (earlier prints dropped):', ', '.join(f'{k} {v}' for k, v in sorted(late.items(), key=lambda kv: kv[1])) or 'none', flush=True)
    sp = [s_ for s_ in FACT.columns if FACT[s_].nunique() > 1]
    print('splits in the look-back (prices put on today\'s share basis):', ', '.join(sp) or 'none', flush=True)
    if REUSE and os.path.exists(f'{OUT}/weekly_results.parquet'):
        R = pd.read_parquet(f'{OUT}/weekly_results.parquet'); print('weekly results reused', len(R), flush=True)
    else:
        with mp.get_context('fork').Pool(2) as P:
            R = pd.DataFrame([r for rs in P.imap_unordered(sim_week, [(w, days_by_week[w], syms) for w in weeks]) for r in rs])
    R['net'] = R.profit - R.fees; R['ret'] = R.profit / R.cap.where(R.cap >= LOT / 2)
    R.to_parquet(f'{OUT}/weekly_results.parquet')
    PX, last_date = price_dimension(syms, weeks[0]); PX.to_parquet(f'{OUT}/price_dimension.parquet')
    today = pd.Timestamp.now(tz='America/New_York').date(); sess = calendar(pd.Timestamp(all_days[-1]).date() - dt.timedelta(days=10), today)   # exchange date
    last_done = sess[-1] if (sess[-1] < today.isoformat() or pd.Timestamp.now(tz='America/New_York').hour >= 20) else sess[-2]
    extra = [d for d in sess if all_days[-1] < d <= last_done]
    if extra: ensure_minutes(syms, extra); ensure_overnight(syms, extra)
    cdays = all_days + extra
    chunks = [syms[i:i + 20] for i in range(0, len(syms), 20)]
    with mp.get_context('fork').Pool(2) as P:
        CR = pd.DataFrame([r for rs in P.imap_unordered(sim_continuous, [(c, cdays) for c in chunks]) for r in rs]).set_index('sym')
    CR['net_c'] = CR.realized - CR.fees
    CR['range_pct'] = CR.hi / CR.lo - 1
    CR['open_pl'] = CR.value_now - CR.cap_now; CR['open_pl_pct'] = CR.open_pl / CR.cap_now.where(CR.cap_now > 0)
    CR['ret_cap_now'] = CR.realized / CR.cap_now.where(CR.cap_now >= LOT / 2)
    CR['ret_avg_cap'] = CR.realized / CR.avg_cap.where(CR.avg_cap >= LOT / 2)
    CR['total_pl'] = CR.net_c + CR.open_pl
    CR.to_parquet(f'{OUT}/continuous.parquet')
    print('continuous', cdays[0], '->', cdays[-1], len(cdays), 'sessions', flush=True)
    g = R.groupby('sym')
    ST = pd.DataFrame({'avg': g.ret.mean(), 'median': g.ret.median(), 'worst': g.ret.min(), 'best': g.ret.max(), 'std': g.ret.std(),
                       'wk10': g.ret.apply(lambda r: int((r >= 0.10).sum())), 'cap': g.cap.mean(), 'net_wk': g.net.mean(), 'range': g.wk_range.mean()})
    ST['cv'] = ST['std'] / ST['avg']; ST = ST.join(PX).join(CR)
    ST.attrs['cont'] = f'{cdays[0]} to {cdays[-1]}'
    ST.to_parquet(f'{OUT}/stats.parquet')
    pd.Series(dict(tag=tag, mode=mode, snap=snap, last_date=str(last_date), cont=f'{cdays[0]} to {cdays[-1]}', cont_grid=CONT_GRID)).to_json(f'{OUT}/meta.json')
    write_outputs(OUT, tag, weeks, W, cnt, R, ST.reindex(syms), last_date, f'{cdays[0]} to {cdays[-1]}', members, mode, snap)


def render_only(OUT):
    """Rebuild the outputs of a finished run from its saved files (picks up the latest analyst snapshot)."""
    import json, re
    R = pd.read_parquet(f'{OUT}/weekly_results.parquet'); ST = pd.read_parquet(f'{OUT}/stats.parquet')
    members = {k: set(v) for k, v in json.load(open(f'{OUT}/members.json')).items()}
    weeks = sorted(R.week.unique()); W = len(weeks)
    syms = sorted(set().union(*members.values()))
    cnt = pd.read_parquet(f'{OUT}/weeks_on_list.parquet'); cnt = cnt.reindex(sorted(set(cnt.index) | set(syms))).fillna(0).astype(int)
    if os.path.exists(f'{OUT}/meta.json'): m = json.load(open(f'{OUT}/meta.json'))
    else:
        md = open(glob.glob(f'{OUT}/chat_*.md')[0]).read()
        m = dict(tag=glob.glob(f'{OUT}/chat_*.md')[0].split('chat_')[1][:-3], mode='official' if OUT.endswith('_official') else 'consistent',
                 snap=sorted(glob.glob(f'{C.UNIVERSE}/adv_over_500m_*.csv'))[-1].split('_')[-1][:-4],
                 last_date=re.search(r'price check at the (\S+) close', md).group(1), cont=ST.attrs.get('cont', ''))
        pd.Series(m).to_json(f'{OUT}/meta.json')
    write_outputs(OUT, m['tag'], weeks, W, cnt, R, ST.reindex(syms), m['last_date'], m['cont'], members, m['mode'], m['snap'])


ANALYST = f'{C.UNIVERSE}/analyst/analyst_snapshot_latest.csv'


def analyst_columns(ST):
    """Join the latest saved analyst snapshot (universe/analyst_snapshot.py). Upside is measured from the report's own latest close."""
    A = pd.read_csv(ANALYST, index_col='ticker') if os.path.exists(ANALYST) else pd.DataFrame(index=pd.Index([], name='ticker'))
    keep = ['analyst_asof', 'y_rating', 'y_score', 'y_n_ratings', 'y_buys', 'y_holds', 'y_sells', 'y_n_targets', 'y_target_avg', 'y_target_low',
            'y_target_high', 'tr_rating', 'tr_n_ratings', 'tr_target_avg']
    A = A.reindex(columns=keep)
    ST = ST.drop(columns=[c for c in keep + ['y_upside_now', 'tr_upside_now'] if c in ST.columns]).join(A)
    ST['y_upside_now'] = ST.y_target_avg / ST.price - 1
    ST['tr_upside_now'] = ST.tr_target_avg / ST.price - 1
    return ST, (str(A.analyst_asof.dropna().iloc[0]) if A.analyst_asof.notna().any() else None)


def write_outputs(OUT, tag, weeks, W, cnt, R, ST, last_date, cont, members, mode='official', snap='', day=None, top_all=False):
    """day = dict(df=one-day ranking indexed by sym (ndxsim/day_rank.py parquet), date, prev, dest) -> the same segmented report with the day's
    columns added after "Weeks on list", ranked by the day's return at the best profit taker (Albert 1 Nov 2026: every day / other report uses this format).
    day['kind'] = 'week' (Mon-Fri weekly ranking) or 'roll' (AQA page, 1 Nov 2026: any N consecutive sessions ending day['date'], starting
    day['start'], N = day['n']). top_all=True shows every name in every list (the AQA page); the default keeps the chat's top 25 for $1bn / $500m.
    Neither option changes any other output: the day, week and 52-week chat tables stay byte-identical to the reference."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter
    end_fri = (pd.Timestamp(weeks[-1]) + pd.Timedelta(days=4)).strftime('%d %b %Y')
    ST, a_asof = analyst_columns(ST)
    ST = ST.drop(columns=[c for c in ('mom_4x1', 'mom_4', 'mom_1') if c in ST.columns]).join(momentum(list(ST.index), last_date, OUT))
    if day is not None:
        ST = ST.join(day['df'].add_prefix('d_'))
        DN = f"{pd.Timestamp(day['date']):%a %d %b}"; DNL = f"{pd.Timestamp(day['date']):%A %d %b %Y}"; PN = f"{pd.Timestamp(day['prev']):%a}"
        WK = day.get('kind') == 'week'; UNIT = 'week' if WK else 'day'
        RL = day.get('kind') == 'roll'           # rolling N-session ranking (AQA page): any N consecutive sessions, not a calendar week
        if WK:                                   # weekly ranking: the same run as the list's weekly figures, with a profit-taker sweep
            s0, e0 = pd.Timestamp(day['start']), pd.Timestamp(day['date'])
            DN = f'Week {s0:%d}-{e0:%d %b}' if s0.month == e0.month else f'Week {s0:%d %b}-{e0:%d %b}'
        if RL:
            s0, e0 = pd.Timestamp(day['start']), pd.Timestamp(day['date']); NS = int(day.get('n', 5)); UNIT = 'period'
            DN = (f'{NS} sessions {s0:%d}-{e0:%d %b}' if s0.month == e0.month else f'{NS} sessions {s0:%d %b}-{e0:%d %b}')
        order = lambda x: x.sort_values(['d_ret_best', 'd_ret5', 'avg'], ascending=False, na_position='last')
    else:
        order = lambda x: x.sort_values('avg', ascending=False, na_position='last')
    import json as _j
    cg = (_j.load(open(f'{OUT}/meta.json')).get('cont_grid', 'cents') if os.path.exists(f'{OUT}/meta.json') else 'cents')
    cg_txt = ('whole-cent step fixed from the first price (base settings)' if cg == 'cents'
              else '0.1% step / 0.5% profit taker at every price, rounded to whole cents (a step fixed a year ago would be far too small for stocks that multiplied)')
    dfmt = '%d %b %y' if pd.Timestamp(weeks[0]).year != pd.Timestamp(str(last_date)).year else '%d %b'
    BUYISH = ('Strong Buy', 'Buy')
    def rating_cell(r):
        if pd.isna(r.y_rating): return 'n/a'
        if r.y_rating == 'fund': return 'fund'
        return f'{r.y_rating} ({int(r.y_n_ratings)})' if pd.notna(r.y_n_ratings) else r.y_rating
    def tr_cell(r):
        if r.get('y_rating') == 'fund': return 'fund'
        if pd.isna(r.tr_rating): return 'n/a'
        return f'{r.tr_rating} ({int(r.tr_n_ratings)})' if pd.notna(r.tr_n_ratings) else r.tr_rating
    pct = lambda v: 'n/a' if pd.isna(v) else f'{v:+.1%}'
    p1 = lambda v: 'n/a' if pd.isna(v) else f'{v:.1%}'
    pct0 = lambda v: 'n/a' if pd.isna(v) else f'{v:.0%}'
    money = lambda v: 'n/a' if pd.isna(v) else (f'-${-v:,.2f}' if v < 0 else f'${v:,.2f}')     # whole cents ($1 per level makes small amounts)
    who = (f'the four ADV lists as of the {snap} snapshot (all members)' if mode == 'official'
           else f'names on each list in all {W} weeks of the look-back')
    md = ([f'## Average Daily Volume Segmented Stocks List: rolling {NS}-session ranking, {s0:%a %d %b} - {e0:%a %d %b %Y} (bot period 8:00 pm the evening before {s0:%a %d %b} - 8:00 pm {e0:%a %d %b}); {who}; look-back {W} weeks Mon {pd.Timestamp(weeks[0]):%d %b %Y} - Fri {end_fri}, price check at the {last_date} close', '',
           f'_{DN} columns: each stock starts fresh at 8:00 pm the evening before the first session and runs all {NS} sessions with lots carried day to day (1-minute bars incl. overnight), list base settings (whole-cent step max(1 cent, 0.1%), '
           f'profit taker 5 steps = 0.5%, levels follow the price, ${LOT:g} per level), plus a profit-taker sweep from 0.1% to 2% for the best one (best = highest return after fees). '
           f'Return (cycles) = the period\'s profit from completed cycles / average daily capital exposed (needs at least ${LOT / 2:.2f} exposed; rank at 0.5% in brackets). '
           f'Period\'s range = (high - low) / low over the period; true range includes the gap from the prior session\'s 8:00 pm close. Ranked by the period\'s return at the best profit taker._', '']
          if day is not None and RL else
          [f'## Average Daily Volume Segmented Stocks List: weekly ranking, Mon {s0:%d %b} - Fri {e0:%d %b %Y} (bot week 8:00 pm Sun - 8:00 pm Fri); {who}; look-back {W} weeks Mon {pd.Timestamp(weeks[0]):%d %b %Y} - Fri {end_fri}, price check at the {last_date} close', '',
           f'_{DN} columns: each stock starts fresh at 8:00 pm Sunday and runs the whole week with lots carried day to day (1-minute bars incl. overnight), list base settings (whole-cent step max(1 cent, 0.1%), '
           f'profit taker 5 steps = 0.5%, levels follow the price, ${LOT:g} per level), plus a profit-taker sweep from 0.1% to 2% for the best one (best = highest return after fees). '
           f'Return (cycles) = the week\'s profit from completed cycles / average daily capital exposed (the same run as the weekly figures below; needs at least ${LOT / 2:.2f} exposed; rank at 0.5% in brackets). '
           f'Week\'s range = (high - low) / low over the week; true range includes the gap from the prior Friday 8:00 pm close. Ranked by the week\'s return at the best profit taker._', '']
          if day is not None and WK else
          [f'## Average Daily Volume Segmented Stocks List: one-day ranking, {DNL} (bot day 8:00 pm {PN} - 8:00 pm {DN[:3]}); {who}; look-back {W} weeks Mon {pd.Timestamp(weeks[0]):%d %b %Y} - Fri {end_fri}, price check at the {last_date} close', '',
           f'_{DN} columns: each stock starts fresh at 8:00 pm the evening before (1-minute bars incl. overnight), list base settings (whole-cent step max(1 cent, 0.1%), '
           f'profit taker 5 steps = 0.5%, levels follow the price, ${LOT:g} per level), plus a profit-taker sweep from 0.1% to 2% for the best one (best = highest return after fees). '
           f'Return (cycles) = profit from completed cycles / average capital exposed during the day (needs at least ${LOT / 2:.2f} exposed; rank at 0.5% in brackets). '
           f'Day\'s range = (high - low) / low; true range includes the gap from the prior 8:00 pm close. Ranked by the day\'s return at the best profit taker._', '']
          if day is not None else
          [f'## Average Daily Volume Segmented Stocks List ({who}): {W} weeks Mon {pd.Timestamp(weeks[0]):%d %b %Y} - Fri {end_fri}, price check at the {last_date} close', '']) + [
          f'_Weekly figures: {W} weeks, fresh each week, base settings, ${LOT:g} per level (range). Capital figures: one continuous run per stock, {cont}, lots carried, ${LOT:g} per level, {cg_txt}. Dollar figures scale linearly: multiply by your $ per level (e.g. x10 for $10 per level); returns stay the same. '
          f'"Weeks on list" = in how many of the {W} weeks the stock was big enough for that list at the time (checked every Monday: 20-day average daily $ volume over the cutoff); '
          f'new listings and recent risers show fewer. "Avg weekly return (cycles)" and "Worst weekly return (cycles)" = the cycles bot\'s simulated weekly return on capital, fresh each week, over every week the stock traded, on the list or not. '
          + (f'Analysts: Yahoo Finance consensus as captured by the app on {a_asof} (number of ratings in brackets), average 12-month price target, '
             f'upside = target / latest close - 1; TipRanks = 3-month consensus from the app\'s TipRanks cache (number of ratings in brackets); '
             f'funds have no analyst ratings._' if a_asof else '_'), '',
          '| List | Names | ' + (f'{DN}: list return at 0.5% (cycles) | {DN}: list return at each stock\'s best profit taker | {DN}: profit at 0.5% | {DN}: median true range | ' if day is not None else '') + 'Avg weekly return (cycles) | Worst weekly return (cycles) | Number of weeks with list returns of 5% or more (cycles) | Median from peak | Share of names above their 200-day moving average | 4-mo return: median (positive) | Capital now | Open P&L | Realized $ | On capital now | On avg capital | Rated Buy or better | Median upside | TipRanks coverage |',
          '|---|---|' + ('---|' * 4 if day is not None else '') + '---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
    for lab, _ in LISTS[::-1]:
        syms = sorted(members[lab]); x = ST.loc[syms]
        v = np.array([(lambda y: y.profit.sum() / y.cap.sum() if y.cap.sum() > 0 else np.nan)(R[(R.week == w) & R.sym.isin(syms)]) for w in weeks])
        dcell = ''
        if day is not None:
            dcell = (f'{x.d_profit5.sum() / x.d_cap5.sum():.2%} | {x.d_profit_best.sum() / x.d_cap_best.sum():.2%} | {money(x.d_profit5.sum())} on {money(x.d_cap5.sum())} | '
                     f'{x.d_tr.median():.2%} | ')
        md.append(f'| {LAB[lab]} | {len(syms)} | {dcell}{np.nanmean(v):.1%} | {np.nanmin(v):.1%} | {int((v >= 0.05).sum())} of {W} | {x.from_peak.median():+.1%} | '
                  f'{(x.vs_sma200 > 0).sum() / x.vs_sma200.notna().sum():.0%} | {pct(x.mom_4.median())} ({(x.mom_4 > 0).sum()} of {x.mom_4.notna().sum()}) | {money(x.cap_now.sum())} | {money(x.open_pl.sum())} ({x.open_pl.sum() / x.cap_now.sum():+.1%}) | '
                  f'{money(x.realized.sum())} | {x.realized.sum() / x.cap_now.sum():.0%} | {x.realized.sum() / x.avg_cap.sum():.0%} | '
                  + (lambda st: f'{st.y_rating.isin(BUYISH).sum()} of {len(st)} stocks | {pct(st.y_upside_now.median())} | {st.tr_target_avg.notna().sum()} of {len(st)} |'
                     if len(st) else 'n/a | n/a | n/a |')(
                      x[x.y_rating.notna() & (x.y_rating != 'fund')] if 'y_rating' in x else x.iloc[:0]))
    md.append('')
    TOP = {'10bn': None, '5bn': None, '1bn': 25, '500m': 25}
    if top_all: TOP = {k: None for k in TOP}     # AQA page: every name in every list
    for lab, _ in LISTS[::-1]:
        x = order(ST.loc[sorted(members[lab])])
        if day is not None: x = x.assign(d_rank5=x.d_ret5.rank(ascending=False, method='min'))
        top = TOP[lab]
        rk = f"{DN}'s return at the best profit taker" if day is not None else 'average weekly return (cycles)'
        dh = (f'{DN} best profit taker | {DN} return at best (cycles) | {DN} return at 0.5% (cycles) (rank) | {DN} profit at 0.5% | {DN} capital at 0.5% | '
              f'{DN} cycles at 0.5% | {DN} {UNIT}\'s range | {DN} true range | ') if day is not None else ''
        md += [f'### {LAB[lab]} list ({len(x)} names{", top " + str(top) + " by " + rk + "; all in the workbook" if top and len(x) > top else ""})', '',
               ('| # ' if day is not None else '') + f'| Stock | Weeks on list (of {W}) | {dh}Avg weekly return (cycles) | Worst weekly return (cycles) | Peak (date) | Now | From peak | Price difference vs 100-day moving average | Price difference vs 200-day moving average | 4-mo return | Price range | Capital now | Open P&L | Realized $ | On capital now | On avg capital | Analyst rating (#) | Avg target | Upside | TipRanks (#) | TipRanks target |',
               ('|---' * 9 if day is not None else '') + '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
        for i_, (s_, r) in enumerate(x.head(top or len(x)).iterrows(), 1):
            dc = ''
            if day is not None:
                tail = f'{money(r.d_profit5)} | {money(r.d_cap5)} | {int(r.d_cyc5):,} | {r.d_range:.1%} | {r.d_tr:.2%} | ' if pd.notna(r.d_cap5) else 'n/a | n/a | n/a | n/a | n/a | '
                dc = (f'{r.d_best_pt * 100:g}% | {r.d_ret_best:.1%} | {r.d_ret5:.1%} ({int(r.d_rank5)}) | ' if pd.notna(r.d_ret5) and pd.notna(r.d_ret_best)
                      else (f'– | under ${LOT / 2:.2f} exposed | – | ' if pd.notna(r.d_cap5) else 'n/a | n/a | n/a | ')) + tail
            pk = 'n/a' if pd.isna(r.peak) else f'${r.peak:,.2f} ({pd.Timestamp(r.peak_date).strftime(dfmt)})'
            rg = 'n/a' if pd.isna(r.lo) else f'${r.lo:,.2f}-${r.hi:,.2f} ({r.range_pct:.0%})'
            md.append(('| ' + str(i_) + ' ' if day is not None else '') + f'| {s_} | {int(cnt.loc[s_, lab])} | {dc}{p1(r.avg)} | {p1(r.worst)} | {pk} | {money(r.price) if pd.isna(r.price) else f"${r.price:,.2f}"} | {pct(r.from_peak)} | '
                      f'{pct(r.vs_sma100)} | {pct(r.vs_sma200)} | {pct(r.mom_4)} | {rg} | {money(r.cap_now)} | '
                      f'{money(r.open_pl)} ({pct(r.open_pl_pct)}) | {money(r.realized)} | {pct0(r.ret_cap_now)} | {pct0(r.ret_avg_cap)} | '
                      f'{rating_cell(r)} | {"n/a" if pd.isna(r.y_target_avg) else f"${r.y_target_avg:,.2f}"} | {pct(r.y_upside_now)} | '
                      f'{tr_cell(r)} | {"n/a" if pd.isna(r.tr_target_avg) else f"${r.tr_target_avg:,.2f}"} |')
        md.append('')
    DEST = day['dest'] if day is not None else OUT
    if day is not None: os.makedirs(DEST, exist_ok=True)
    chat = ((f"{DEST}/chat_roll_{day['date']}.md" if RL else f"{DEST}/chat_week_{day['start']}.md" if WK else f"{DEST}/chat_day_{day['date']}.md")
            if day is not None else f'{OUT}/chat_{tag}.md')
    open(chat, 'w').write('\n'.join(md))
    wb = Workbook(); B_ = Font(name='Arial', bold=True); N_ = Font(name='Arial'); HF = PatternFill('solid', fgColor='DDEBF7')
    ws = wb.active; ws.title = 'Notes'
    notes = [f'Average Daily Volume Segmented Stocks List ({who}): {W} weeks Mon {weeks[0]} - Fri {end_fri}, price check at the {last_date} close',
             'Point-in-time weekly lists (for "weeks on list"): rebuilt every Monday from 20-session average daily $ volume (Alpaca SIP daily volume x VWAP,',
             'incl. extended hours) to the prior session, over $500m / $1bn / $5bn / $10bn, from all US-listed stocks and ETFs.',
             f'Weekly simulation (fresh each week): whole-cent ladder, step max(1 cent, 0.1% of the week\'s first price), profit taker 5 steps (~0.5%), ${LOT:g}/level,',
             '1-minute SIP 04:00-20:00 ET (raw) + overnight (Alpaca BOATS); fees $0.005/share sold. Weekly return = profit / average daily capital exposed.',
             'Price check (split-adjusted daily closes): Peak = highest close from the look-back\'s first Monday to the latest close; From peak = price / peak - 1;',
             '100-day / 200-day moving average price = simple average of the last 100 / 200 closes; price difference vs the moving average = price / average - 1 (negative = below it).',
             '4-mo return (momentum, Strategy A\'s selection score) = latest close / close 84 sessions earlier - 1 (split-adjusted daily closes).',
             f'Capital check: ONE continuous run per stock over {cont} (lots carried, as the bot does; ${LOT:g}/level; grid: {cg_txt}). Range = lowest low to',
             'highest high (04:00-20:00 ET) over that period. Capital now = cost of the lots still held at the end; Open P&L = their market value at the last',
             'price minus that cost (a drawdown when negative); Realized $ = profit from completed cycles; Return on capital now = realized / capital now;',
             'Return on avg capital = realized / average daily capital exposed; Total P&L = realized - fees + open P&L. Scale linearly for other lot sizes.',
             'Stock splits: minute and overnight prices are put on today\'s share basis (raw / split factor from Alpaca raw vs split-adjusted closes) for the',
             'continuous run; a week that contains a split is put on that week\'s last-session basis. Other weeks use raw prices (as the bot saw them).',
             'New listings: bars before a stock\'s first official daily bar are dropped (e.g. SPCX before the SpaceX listing was a different, thinly traded fund).',
             f'Analysts (snapshot {a_asof or "not loaded"}, not live): Yahoo Finance consensus as captured by the AQA app (table yahoo_ratings): rating = Yahoo\'s',
             'recommendation key, score = recommendation mean (1 = Strong Buy ... 5 = Strong Sell), # ratings = analysts in the current month\'s recommendation',
             'count (Buys include Strong Buys, Sells include Strong Sells), # price targets = analysts behind the average 12-month target. Upside = average target /',
             'latest close - 1. TipRanks columns (3-month consensus, the app\'s tipranks_cache) only where the app has cached the name in the last 14 days.',
             'Funds (ETFs/ETVs) have no analyst ratings. Refresh: python3 analyst_snapshot.py, then --render-only OUT_DIR.',
             'Re-run: python3 consist_report.py --weeks N [--end-week YYYY-MM-DD] [--lists official|consistent] | --render-only OUT_DIR.']
    if day is not None:
        notes = [f'Average Daily Volume Segmented Stocks List: one-day ranking, {DNL}; {who}; look-back {W} weeks Mon {weeks[0]} - Fri {end_fri}, price check at the {last_date} close',
                 f'{DN} columns (one-day ranking): bot day = 8:00 pm ET {day["prev"]} to 8:00 pm ET {day["date"]} (1-minute SIP 04:00-20:00 + overnight BOATS bars), fresh start at the first bar.',
                 f'Grid: list base settings (whole cents, step max(1 cent, 0.1% of the first price), profit taker 5 steps = 0.5%, levels follow the price, ${LOT:g}/level), plus a profit-taker',
                 f'sweep 0.1%-2%; best = highest return after fees for that stock. Return (cycles) = realized profit / time-weighted capital exposed that day; needs >= ${LOT / 2:.2f} exposed.',
                 "Day's range = (high - low) / low over the bot day. True range = (max(high, prior close) - min(low, prior close)) / prior close (prior close = 8 pm the evening before);",
                 'regular-hours true range = same with 9:30-16:00 prices and the prior regular close. ATR14 % = 14-day average true range of daily bars / close.',
                 f'Sheets "Over $X" are ranked by the {DN} return at the best profit taker (then at 0.5%); every other column is the 52-week segmented list, as below.', ''] + notes[1:]
        if WK:
            notes = [f'Average Daily Volume Segmented Stocks List: weekly ranking, Mon {day["start"]} - Fri {day["date"]}; {who}; look-back {W} weeks Mon {weeks[0]} - Fri {end_fri}, price check at the {last_date} close',
                     f'{DN} columns (weekly ranking): bot week = 8:00 pm ET Sunday to 8:00 pm ET {day["date"]} (1-minute SIP 04:00-20:00 + overnight BOATS bars), fresh start at the first bar,',
                     'lots carried day to day: the same run as the list\'s weekly figures (its return at 0.5% equals that week\'s column in the "Weekly returns" sheet).',
                     f'Grid: list base settings (whole cents, step max(1 cent, 0.1% of the first price), profit taker 5 steps = 0.5%, levels follow the price, ${LOT:g}/level), plus a profit-taker',
                     f'sweep 0.1%-2%; best = highest return after fees for that stock. Return (cycles) = week profit / average daily capital exposed; needs >= ${LOT / 2:.2f} exposed.',
                     f"Week's range = (high - low) / low over the bot week. True range = (max(high, prior close) - min(low, prior close)) / prior close (prior close = {day['prev']} 8 pm);",
                     'regular-hours true range = same with 9:30-16:00 prices and the prior regular close. ATR14 % = 14-day average true range of daily bars / close, as of Friday.',
                     f'Sheets "Over $X" are ranked by the {DN} return at the best profit taker (then at 0.5%); every other column is the 52-week segmented list, as below.', ''] + notes[8:]
        if RL:
            notes = [f'Average Daily Volume Segmented Stocks List: rolling {NS}-session ranking, {day["start"]} - {day["date"]}; {who}; look-back {W} weeks Mon {weeks[0]} - Fri {end_fri}, price check at the {last_date} close',
                     f'{DN} columns (rolling {NS}-session ranking): bot period = 8:00 pm ET the evening before {day["start"]} to 8:00 pm ET {day["date"]} (1-minute SIP 04:00-20:00 + overnight BOATS bars),',
                     f'fresh start at the first bar, lots carried day to day across all {NS} sessions.',
                     f'Grid: list base settings (whole cents, step max(1 cent, 0.1% of the first price), profit taker 5 steps = 0.5%, levels follow the price, ${LOT:g}/level), plus a profit-taker',
                     f'sweep 0.1%-2%; best = highest return after fees for that stock. Return (cycles) = period profit / average daily capital exposed; needs >= ${LOT / 2:.2f} exposed.',
                     f"Period's range = (high - low) / low over the bot period. True range = (max(high, prior close) - min(low, prior close)) / prior close (prior close = {day['prev']} 8 pm);",
                     f'regular-hours true range = same with 9:30-16:00 prices and the prior regular close. ATR14 % = 14-day average true range of daily bars / close, as of {day["date"]}.',
                     f'Sheets "Over $X" are ranked by the {DN} return at the best profit taker (then at 0.5%); every other column is the 52-week segmented list, as below.', ''] + notes[8:]
    for i, t in enumerate(notes): ws.cell(i + 1, 1, t).font = B_ if i == 0 else N_
    ws.column_dimensions['A'].width = 160
    cols = [('#', 'rank', None), ('Stock', 'sym', None), (f'Weeks on this list (of {W}, checked each Monday)', 'wks', '0'), ('Avg weekly return (cycles)', 'avg', '0.0%'), ('Median weekly return (cycles)', 'median', '0.0%'),
            ('Worst weekly return (cycles)', 'worst', '0.0%'), ('Best weekly return (cycles)', 'best', '0.0%'), ('Std dev', 'std', '0.0%'), ('Number of weeks with returns of 10% or more (cycles)', 'wk10', '0'),
            ('Avg capital exposed ($)', 'cap', '$#,##0.00'), ('Avg net $ per week', 'net_wk', '$#,##0.00'), ('Avg week range', 'range', '0.0%'),
            ('Peak close in look-back', 'peak', '$#,##0.00'), ('Peak date', 'peak_date', None), ('Price (latest close)', 'price', '$#,##0.00'),
            ('From peak', 'from_peak', '0.0%'), ('100-day moving average price', 'sma100', '$#,##0.00'), ('Price difference vs 100-day moving average', 'vs_sma100', '0.0%'),
            ('200-day moving average price', 'sma200', '$#,##0.00'), ('Price difference vs 200-day moving average', 'vs_sma200', '0.0%'),
            ('4-mo return (Strategy A score)', 'mom_4', '0.0%'),
            ('Range low', 'lo', '$#,##0.00'), ('Range high', 'hi', '$#,##0.00'), ('Range %', 'range_pct', '0.0%'),
            ('Capital now: open lots at cost ($)', 'cap_now', '$#,##0.00'), ('Open lots at market ($)', 'value_now', '$#,##0.00'),
            ('Open P&L on capital now ($)', 'open_pl', '$#,##0.00'), ('Open P&L %', 'open_pl_pct', '0.0%'), ('Open lots now', 'open_lots_now', '#,##0'),
            ('Realized $ (continuous)', 'realized', '$#,##0.00'), ('Fees ($)', 'fees', '$#,##0.00'), ('Avg capital exposed (continuous, $)', 'avg_cap', '$#,##0.00'),
            ('Return on capital now', 'ret_cap_now', '0.0%'), ('Return on avg capital', 'ret_avg_cap', '0.0%'), ('Total P&L incl. open lots ($)', 'total_pl', '$#,##0.00'),
            ('Analyst rating (Yahoo)', 'y_rating', None), ('Rating score (1 = Strong Buy, 5 = Strong Sell)', 'y_score', '0.00'),
            ('# analyst ratings', 'y_n_ratings', '0'), ('Buys', 'y_buys', '0'), ('Holds', 'y_holds', '0'), ('Sells', 'y_sells', '0'),
            ('# price targets', 'y_n_targets', '0'), ('Avg price target', 'y_target_avg', '$#,##0.00'), ('Lowest target', 'y_target_low', '$#,##0.00'),
            ('Highest target', 'y_target_high', '$#,##0.00'), ('Upside to avg target', 'y_upside_now', '0.0%'),
            ('TipRanks rating', 'tr_rating', None), ('TipRanks # ratings (3 months)', 'tr_n_ratings', '0'), ('TipRanks avg target', 'tr_target_avg', '$#,##0.00'),
            ('TipRanks upside', 'tr_upside_now', '0.0%'), ('Analyst data as of', 'analyst_asof', None),
            ('Weeks on $10bn', 'w10bn', '0'), ('Weeks on $5bn', 'w5bn', '0'), ('Weeks on $1bn', 'w1bn', '0'), ('Weeks on $500m', 'w500m', '0')]
    if day is not None:
        dcols = [(f'{DN} best profit taker', 'd_best_pt', '0.00%'), (f'{DN} return at best profit taker (cycles)', 'd_ret_best', '0.0%'),
                 (f'{DN} return after fees at best profit taker', 'd_net_best', '0.0%'), (f'{DN} profit at best profit taker ($)', 'd_profit_best', '$#,##0.00'),
                 (f'{DN} return at 0.5% profit taker (cycles)', 'd_ret5', '0.0%'), (f'{DN} rank at 0.5% in this list', 'd_rank5', '0'),
                 (f'{DN} return after fees at 0.5%', 'd_net5', '0.0%'), (f'{DN} profit at 0.5% ($)', 'd_profit5', '$#,##0.00'),
                 (f'{DN} capital exposed at 0.5% ($)', 'd_cap5', '$#,##0.00'), (f'{DN} cycles at 0.5%', 'd_cyc5', '#,##0'), (f'{DN} fees at 0.5% ($)', 'd_fees5', '$#,##0.00'),
                 (f'{DN} grid step ($)', 'd_step', '$#,##0.00'), (f'{DN} low', 'd_low', '$#,##0.00'), (f'{DN} high', 'd_high', '$#,##0.00'),
                 (f"{DN} {UNIT}'s range", 'd_range', '0.0%'), (f'{DN} true range', 'd_tr', '0.00%'), (f'{DN} true range, regular hours', 'd_tr_reg', '0.00%'),
                 ('ATR14 %', 'd_atr14p', '0.00%'), (f'{DN} close (Fri 8 pm)' if WK else f'{DN} close (8 pm)', 'd_close', '$#,##0.00'),
                 (f'{DN} change vs prior Friday close' if WK else f'{DN} change vs prior close', 'd_chg', '0.0%')]
        cols = cols[:3] + dcols + cols[3:]
    for lab, _ in LISTS[::-1]:
        x = order(ST.loc[sorted(members[lab])]).copy()
        if day is not None: x['d_rank5'] = x.d_ret5.rank(ascending=False, method='min')
        x['rank'] = np.arange(1, len(x) + 1); x['sym'] = x.index; x['wks'] = cnt.loc[x.index, lab].values
        for k in ('10bn', '5bn', '1bn', '500m'): x[f'w{k}'] = cnt.loc[x.index, k].values
        w = wb.create_sheet(f'Over {LAB[lab]}')
        for j, (h, _, _) in enumerate(cols):
            c = w.cell(1, j + 1, h); c.font = B_; c.fill = HF; c.alignment = Alignment(wrap_text=True, vertical='top')
        for i, (_, r) in enumerate(x.iterrows()):
            for j, (_, k, f) in enumerate(cols):
                v = r[k]
                if k == 'peak_date': v = pd.Timestamp(v).strftime('%Y-%m-%d') if pd.notna(v) else None
                elif isinstance(v, (float, np.floating)): v = float(v) if np.isfinite(v) else None
                elif v is None or (not isinstance(v, str) and pd.isna(v)): v = None
                elif isinstance(v, np.integer): v = int(v)
                c = w.cell(i + 2, j + 1, v); c.font = N_
                if f: c.number_format = f
        import math
        def _minw(k, f):                     # room for the values themselves (prices up to $9,999.99, ISO dates, rating text)
            if k in ('peak_date', 'analyst_asof'): return 11
            if k in ('y_rating', 'tr_rating'): return 13
            if k == 'd_best_pt': return 9
            if f and f.startswith('$'): return 11
            return 8
        widths = [max(10, min(26, max(math.ceil(len(h) / 3) + 4, _minw(k, f)))) for h, k, f in cols]
        lines = max(math.ceil(len(h) / max(1, wd - 3)) for (h, _, _), wd in zip(cols, widths))
        w.freeze_panes = 'C2'; w.row_dimensions[1].height = 64       # up to 4 wrapped lines
        for j, wd in enumerate(widths): w.column_dimensions[get_column_letter(j + 1)].width = wd
        for j in range(len(cols)): w.cell(1, j + 1).alignment = Alignment(wrap_text=True, vertical='top', horizontal='center')
        w.auto_filter.ref = f'A1:{get_column_letter(len(cols))}{len(x) + 1}'
    M = R.pivot(index='sym', columns='week', values='ret').reindex(ST.sort_values('avg', ascending=False).index)
    w = wb.create_sheet('Weekly returns'); w.cell(1, 1, 'Stock').font = B_
    for j, wk in enumerate(M.columns): c = w.cell(1, j + 2, f'Wk {wk}'); c.font = B_; c.fill = HF
    for i, (s, r) in enumerate(M.iterrows()):
        w.cell(i + 2, 1, s).font = N_
        for j, v in enumerate(r):
            c = w.cell(i + 2, j + 2, float(v) if np.isfinite(v) else None); c.number_format = '0.0%'; c.font = N_
    w.freeze_panes = 'B2'
    w = wb.create_sheet('List totals by week'); hd = ['Week'] + [f'Over {LAB[k]}' for k, _ in LISTS[::-1]]
    for j, h in enumerate(hd): c = w.cell(1, j + 1, h); c.font = B_; c.fill = HF
    for i, wk in enumerate(weeks):
        w.cell(i + 2, 1, wk).font = N_
        for j, (lab, _) in enumerate(LISTS[::-1]):
            x = R[(R.week == wk) & R.sym.isin(members[lab])]; c = w.cell(i + 2, j + 2, float(x.profit.sum() / x.cap.sum()) if x.cap.sum() > 0 else None)
            c.number_format = '0.0%'; c.font = N_
    end_date = (pd.Timestamp(weeks[-1]) + pd.Timedelta(days=4)).strftime('%Y-%m-%d')
    out = ((f"{DEST}/Average Daily Volume Segmented Stocks List - Rolling {NS}-Session Ranking {day['start']} to {day['date']} (look-back {weeks[0]} to {end_date}).xlsx" if RL else
            f"{DEST}/Average Daily Volume Segmented Stocks List - Weekly Ranking {day['start']} to {day['date']} (look-back {weeks[0]} to {end_date}).xlsx" if WK else
            f"{DEST}/Average Daily Volume Segmented Stocks List - One-Day Ranking {day['date']} (look-back {weeks[0]} to {end_date}).xlsx") if day is not None else
           f'{OUT}/Average Daily Volume Segmented Stocks List {weeks[0]} to {end_date}' + ('' if mode == 'official' else ' (consistent names)') + '.xlsx')
    wb.save(out)
    print('WROTE', out, chat)
    return out, chat


if __name__ == '__main__':
    main()
