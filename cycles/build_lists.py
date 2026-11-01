"""Build the four Average Daily Volume (ADV) segmented lists from every US-listed stock and ETF.
  python3 build_lists.py SNAPSHOT_DATE          e.g. 2026-10-30   (needs POLYGON_API_KEY; the date must be a completed session, after 20:00 ET)

1. Universe = every active US-listed ticker in Polygon's reference data of type CS (common stock), OS (ordinary shares), ADRC (ADR),
   GDR, NYRS (NY registry shares), ETF, ETN, ETV, ETS. Not included: preferreds, warrants, rights, units, closed-end funds, OTC.
2. Window = the 20 trading sessions ending on the snapshot date (Alpaca calendar).
3. Daily notional per ticker and session = VWAP x volume from Polygon "grouped daily" (all consolidated US trades incl. extended
   hours; close x volume when VWAP is missing). ADV20 = MEAN over the sessions the ticker traded inside the window.
4. Eligible = traded on the snapshot date AND on at least 5 of the 20 sessions (drops delisted names and one-day prints).
5. Lists (strictly greater than): over $500m, over $1bn, over $5bn, over $10bn of ADV20. A name over $10bn is on all four lists.
Writes to the universe folder: adv_snapshot_<snap>.parquet/.csv (all eligible names >= $10m/day) and adv_over_<500m|1bn|5bn|10bn>_<snap>.csv
(analyst_snapshot.py later appends the analyst columns to the four list CSVs)."""
import os, re, sys, datetime as dt, concurrent.futures as cf
import requests, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C, scan_orig as S

HERE = C.UNIVERSE
TYPES = {'CS', 'OS', 'ADRC', 'GDR', 'NYRS', 'ETF', 'ETN', 'ETV', 'ETS'}
FUNDS = {'ETF', 'ETN', 'ETV', 'ETS'}
FLOOR = 10e6
LISTS = [('500m', 'ADV_OVER_500M', 5e8), ('1bn', 'ADV_OVER_1BN', 1e9), ('5bn', 'ADV_OVER_5BN', 5e9), ('10bn', 'ADV_OVER_10BN', 1e10)]


def window(snap):
    """The 20 completed sessions ending on snap (a session counts once 20:00 ET has passed)."""
    cal = S.cal(snap - dt.timedelta(days=45), snap + dt.timedelta(days=1))
    now = pd.Timestamp.now(tz='America/New_York')
    done = [d for d in cal if d <= snap and pd.Timestamp(d).tz_localize('America/New_York') + pd.Timedelta(hours=20) <= now]
    return done[-20:]


def grouped(days):
    """Polygon grouped daily bars (adjusted) for each session, cached in universe/grouped/<date>.parquet."""
    k = os.environ['POLYGON_API_KEY']
    def one(d):
        p = f'{HERE}/grouped/{d}.parquet'
        if os.path.exists(p): return pd.read_parquet(p)
        j = requests.get(f'https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/{d}', params={'adjusted': 'true', 'apiKey': k}, timeout=120).json()
        # AQA, 1 Nov 2026: never cache an empty or failed day. A session's grouped bars can be missing when pulled too early, and a
        # cached empty file would silently drop that session from every ADV mean for good.
        if j.get('status') not in ('OK', 'DELAYED') or len(j.get('results') or []) < 1000:
            raise RuntimeError(f'Polygon grouped daily {d}: status {j.get("status")}, {len(j.get("results") or [])} rows; not cached')
        x = pd.DataFrame(j.get('results') or []).assign(date=d); os.makedirs(f'{HERE}/grouped', exist_ok=True); x.to_parquet(p); return x
    with cf.ThreadPoolExecutor(5) as ex: G = pd.concat(list(ex.map(one, days)), ignore_index=True)
    G['notional'] = np.where(G.vw.notna(), G.vw * G.v, G.c * G.v)
    return G


def reference():
    """Every active US-listed ticker (Polygon /v3/reference/tickers), cached for 3 days."""
    p = f'{HERE}/polygon_reference_tickers.parquet'
    if os.path.exists(p) and (pd.Timestamp.now() - pd.Timestamp(os.path.getmtime(p), unit='s')).days < 3: return pd.read_parquet(p)
    k = os.environ['POLYGON_API_KEY']; rows = []
    url = 'https://api.polygon.io/v3/reference/tickers'; params = dict(market='stocks', active='true', limit=1000, apiKey=k)
    while url:
        j = requests.get(url, params=params, timeout=60).json()
        rows += j.get('results') or []
        url = j.get('next_url'); params = dict(apiKey=k)
    R = pd.DataFrame(rows)[['ticker', 'name', 'type', 'primary_exchange', 'locale', 'currency_name', 'cik', 'composite_figi']]
    R.to_parquet(p); return R


def clean_name(n):
    if not isinstance(n, str): return n
    n = re.sub(r',?\s+par value.*$', '', n, flags=re.I)
    return re.sub(r'\s+(Class [A-Z]\s+)?(Common Stock|Ordinary Shares|Common Shares)\s*$', '', n, flags=re.I).strip()


def mcap(tickers):
    """Market cap (Polygon ticker details) - informational column only."""
    k = os.environ['POLYGON_API_KEY']; out = {}
    for t in tickers:
        try:
            j = requests.get(f'https://api.polygon.io/v3/reference/tickers/{t}', params=dict(apiKey=k), timeout=30).json().get('results') or {}
            out[t] = j.get('market_cap')
        except Exception: out[t] = None
    return pd.Series(out, dtype=float)


if __name__ == '__main__':
    snap = dt.date.fromisoformat(sys.argv[1]); days = window(snap)
    assert days and str(days[-1]) == sys.argv[1], f'the 20-session window ends {days[-1] if days else None}: use a completed session (after 20:00 ET)'
    R = reference(); R = R[R.type.isin(TYPES)].drop_duplicates('ticker').set_index('ticker')
    G = grouped(days); G = G[G['T'].isin(set(R.index))]
    A = G.groupby('T').agg(adv20_notional=('notional', 'mean'), median20_notional=('notional', 'median'), sessions_traded=('notional', 'size'),
                           avg20_trades=('n', 'mean'), median20_trades=('n', 'median'), _sn=('notional', 'sum'), _st=('n', 'sum'))
    A['avg20_trade_size_usd'] = A._sn / A._st.replace(0, np.nan); A = A.drop(columns=['_sn', '_st'])
    A = A.join(G[G.date == days[-1]].set_index('T').c.rename('last_close'))
    A['eligible'] = A.last_close.notna() & (A.sessions_traded >= 5)
    X = A[A.eligible & (A.adv20_notional >= FLOOR)].copy()
    X['name'] = R.name.reindex(X.index).map(clean_name); X['asset_type'] = R.type.reindex(X.index); X['exchange'] = R.primary_exchange.reindex(X.index)
    X['universes'] = 'US_ALL'
    big = X[(X.adv20_notional > 5e8) & ~X.asset_type.isin(FUNDS)].index.tolist()
    X['market_cap'] = mcap(big).reindex(X.index)
    X['rank_overall'] = X.adv20_notional.rank(ascending=False, method='first').astype('Int64')
    X['window_start'] = str(days[0]); X['window_end'] = str(days[-1])
    X['source'] = ('Polygon grouped daily (adjusted), notional = VWAP x volume per session, mean over sessions traded in the 20-session window; '
                   'universe = all US-listed CS/OS/ADRC/GDR/NYRS/ETF/ETN/ETV/ETS (Polygon reference), traded on the snapshot date and >= 5 sessions')
    X = X.reset_index().rename(columns={'T': 'ticker', 'index': 'ticker'})
    X.to_parquet(f'{HERE}/adv_snapshot_{snap}.parquet'); X.to_csv(f'{HERE}/adv_snapshot_{snap}.csv', index=False)
    for k, ln, th in LISTS:
        L = X[X.adv20_notional > th].sort_values('adv20_notional', ascending=False).copy()
        L.insert(0, 'snapshot_date', str(snap)); L.insert(1, 'list_name', ln); L.insert(2, 'threshold_usd', th); L.insert(3, 'rank_in_list', np.arange(1, len(L) + 1))
        L[['snapshot_date', 'list_name', 'threshold_usd', 'rank_in_list', 'ticker', 'name', 'asset_type', 'universes', 'adv20_notional', 'median20_notional',
           'avg20_trades', 'median20_trades', 'avg20_trade_size_usd', 'last_close', 'market_cap', 'window_start', 'window_end']].to_csv(f'{HERE}/adv_over_{k}_{snap}.csv', index=False)
        print(k, len(L))
    print('snapshot names >= $10m/day:', len(X), '| window', days[0], '-', days[-1])
