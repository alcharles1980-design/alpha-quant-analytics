"""Minimal Alpaca market-data client (daily bars, trading calendar).
Keys come from the environment: APCA_API_KEY_ID and APCA_API_SECRET_KEY. They are never printed or stored."""
import os, time, datetime as dt
import requests, pandas as pd

DATA = 'https://data.alpaca.markets/v2'
PAPER = 'https://paper-api.alpaca.markets/v2'


def _headers():
    return {'APCA-API-KEY-ID': os.environ['APCA_API_KEY_ID'], 'APCA-API-SECRET-KEY': os.environ['APCA_API_SECRET_KEY']}


def _get(url, params=None, tries=6):
    for k in range(tries):
        r = requests.get(url, params=params, headers=_headers(), timeout=60)
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(2 * (k + 1)); continue
        r.raise_for_status(); return r.json()
    r.raise_for_status()


def daily_bars(symbols, start, end, adjustment='split', feed='sip'):
    """Daily bars for many symbols -> DataFrame [sym, date, o, h, l, c, v, vw, n] (n = number of trades) (dates are exchange dates)."""
    rows = []
    syms = sorted(set(symbols))
    for i in range(0, len(syms), 100):
        tok = None
        while True:
            p = dict(symbols=','.join(syms[i:i + 100]), timeframe='1Day', start=f'{start}T00:00:00Z', end=f'{end}T23:59:59Z',
                     adjustment=adjustment, feed=feed, limit=10000)
            if tok: p['page_token'] = tok
            j = _get(f'{DATA}/stocks/bars', p)
            for s, bs in (j.get('bars') or {}).items():
                for b in bs:
                    rows.append(dict(sym=s, t=b['t'], o=b['o'], h=b['h'], l=b['l'], c=b['c'], v=b['v'], vw=b.get('vw'), n=b.get('n')))
            tok = j.get('next_page_token')
            if not tok: break
    df = pd.DataFrame(rows)
    if df.empty: return df
    df['date'] = pd.to_datetime(df.t, utc=True).dt.tz_convert('America/New_York').dt.strftime('%Y-%m-%d')
    return df.drop(columns='t')


def calendar(start, end):
    """Trading sessions between start and end (inclusive) as 'YYYY-MM-DD' strings."""
    return [d['date'] for d in _get(f'{PAPER}/calendar', dict(start=str(start), end=str(end)))]
