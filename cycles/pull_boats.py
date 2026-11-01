"""Overnight 1-minute bars (Alpaca feed='boats', Blue Ocean ATS, 20:00-04:00 ET) for a ticker list, one parquet per session in
<boats folder>/<session>.parquet, holding the night BEFORE that session (prev day 20:00 -> session 04:00), so it slots
straight into the bot's 20:00 -> 20:00 day.   python3 pull_boats.py START END ticker_file   (needs Alpaca keys in env)"""
import os, sys, datetime as dt, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C, data as D, scan_orig as S
OUT = C.BOATS
a, b = dt.date.fromisoformat(sys.argv[1]), dt.date.fromisoformat(sys.argv[2])
syms = open(sys.argv[3]).read().split()
sess = [pd.Timestamp(d) for d in S.cal(a, b)]
start = (sess[0] - pd.Timedelta(days=4)).tz_localize('America/New_York').tz_convert('UTC').strftime('%Y-%m-%dT%H:%M:%SZ')
end = (sess[-1] + pd.Timedelta(hours=4)).tz_localize('America/New_York').tz_convert('UTC').strftime('%Y-%m-%dT%H:%M:%SZ')
rows = []
for i in range(0, len(syms), 100):
    tok = None
    while True:
        p = dict(symbols=','.join(syms[i:i + 100]), timeframe='1Min', start=start, end=end, feed='boats', limit=10000)
        if tok: p['page_token'] = tok
        r = D.get('https://data.alpaca.markets/v2/stocks/bars', p, D.AH())
        if r.status_code != 200: raise RuntimeError(r.text[:200])
        j = r.json()
        for s, bs in (j.get('bars') or {}).items():
            for x in bs: x['sym'] = s; rows.append(x)
        tok = j.get('next_page_token')
        if not tok: break
if not rows:                                                     # AQA, 1 Nov 2026: names with no overnight trades in the range
    print('BOATS sessions 0 bars 0 symbols 0 of', len(syms)); sys.exit(0)
X = pd.DataFrame(rows)
X['t'] = pd.to_datetime(X.t, utc=True).dt.tz_convert('America/New_York').dt.tz_localize(None)
h = X.t.dt.hour; X = X[(h >= 20) | (h < 4)].copy()
# session the night belongs to: the first session date whose 04:00 is after the bar
import numpy as np
sd = pd.Series(sess); edge = (sd + pd.Timedelta(hours=4)).values
ix = np.searchsorted(edge, X.t.values, side='right')            # first session whose 04:00 is after the bar (vectorised)
X['session'] = pd.Series(np.where(ix < len(sd), sd.values[np.minimum(ix, len(sd) - 1)], np.datetime64('NaT', 'ns')), index=X.index)
X = X.dropna(subset=['session'])
X = X[X.t >= X.session - pd.Timedelta(hours=4)]          # only the night right before the session (prev day 20:00 on)
n = 0
for s, g in X.groupby('session'):
    p = f'{OUT}/{s:%Y-%m-%d}.parquet'; g = g[['sym', 't', 'o', 'h', 'l', 'c', 'v']]
    if os.path.exists(p): g = pd.concat([pd.read_parquet(p), g]).drop_duplicates(['sym', 't'], keep='last')   # merge with symbols already saved
    g.sort_values(['sym', 't']).to_parquet(p); n += 1
print('BOATS sessions', n, 'bars', len(X), 'symbols', X.sym.nunique(), 'of', len(syms))
