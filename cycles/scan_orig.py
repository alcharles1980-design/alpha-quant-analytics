"""Alpaca helpers used by the report scripts (the name is historical: the original module also held an unrelated scanner).
  cal(a, b)                     -> trading sessions between two dates (datetime.date list), Alpaca /v2/calendar
  bars(syms, tf, start, end)    -> SIP bars (any timeframe) for many symbols, columns sym, t (UTC), o, h, l, c, v, n, vw
  utc(day, h, m)                -> ISO UTC timestamp for an Eastern-time clock time on that day"""
import datetime as dt
import pandas as pd
import data as D

ET = D.ET


def cal(a, b):
    r = D.get('https://paper-api.alpaca.markets/v2/calendar', {'start': a.isoformat(), 'end': b.isoformat()}, D.AH())
    return [dt.date.fromisoformat(x['date']) for x in r.json()]


def bars(syms, tf, start, end, adj='split'):
    rows = []
    for i in range(0, len(syms), 200):
        tok = None
        while True:
            p = dict(symbols=','.join(syms[i:i + 200]), timeframe=tf, start=start, end=end, feed='sip', adjustment=adj, limit=10000)
            if tok: p['page_token'] = tok
            r = D.get('https://data.alpaca.markets/v2/stocks/bars', p, D.AH())
            if r.status_code != 200: raise RuntimeError(f'bars HTTP {r.status_code}: {r.text[:150]}')
            j = r.json()
            for s, bs in (j.get('bars') or {}).items():
                for b in bs: b['sym'] = s; rows.append(b)
            tok = j.get('next_page_token')
            if not tok: break
    x = pd.DataFrame(rows)
    if len(x): x['t'] = pd.to_datetime(x.t, utc=True)
    return x


def utc(day, h, m):
    return dt.datetime.combine(day, dt.time(h, m), ET).astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')
