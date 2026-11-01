"""Analyst snapshot for the ADV-segmented lists (periodic, not live).

  python3 analyst_snapshot.py [--snap YYYY-MM-DD]      (Alpaca keys; SB_URL + SB_PUBLISHABLE_KEY for the analyst source)

Reads what the owner's AQA app has already captured in its Supabase project (REST, publishable key from the environment):
  - yahoo_ratings   : the app's Yahoo Finance pipeline (consensus key + mean, recommendation counts, # price targets, mean/low/high target)
  - tipranks_cache  : the app's TipRanks getData cache (3-month consensus, buy/hold/sell counts, average target) - only names the app has cached
Nothing is fetched from Yahoo or TipRanks directly; refresh those in the app first, then re-run this.

Writes:
  universe/analyst/analyst_snapshot_<asof>.csv  (+ analyst_snapshot_latest.csv) - every list name, both sources
  universe/adv_over_<list>_<snap>.csv            - the four list CSVs with the analyst columns appended (old analyst columns replaced)
Upside = average target / latest official close - 1 (close from Alpaca SIP daily bars, split-adjusted).
Funds (ETF/ETV) have no analyst ratings: marked 'fund'."""
import os, sys, glob, json, argparse, subprocess, datetime as dt
import requests, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C
from sss.alpaca import daily_bars, calendar

U = C.UNIVERSE; OUTD = f'{U}/analyst'
LISTS = ['500m', '1bn', '5bn', '10bn']
ACOLS = ['analyst_asof', 'close_date', 'close', 'y_rating', 'y_score', 'y_n_ratings', 'y_buys', 'y_holds', 'y_sells', 'y_n_targets',
         'y_target_avg', 'y_target_low', 'y_target_high', 'y_upside', 'y_price_at_fetch', 'y_fetched', 'tr_rating', 'tr_n_ratings', 'tr_buys', 'tr_holds',
         'tr_sells', 'tr_target_avg', 'tr_target_low', 'tr_target_high', 'tr_upside', 'tr_fetched']
YKEY = {'strong_buy': 'Strong Buy', 'buy': 'Buy', 'hold': 'Hold', 'underperform': 'Underperform', 'sell': 'Sell', 'strong_sell': 'Strong Sell'}
TR_MAX_AGE_DAYS = 14   # TipRanks cache rows older than this are left out (the app caches on demand; some rows are months old)
TRKEY = {5: 'Strong Buy', 4: 'Moderate Buy', 3: 'Hold', 2: 'Moderate Sell', 1: 'Strong Sell'}


def rest(table, params):
    url, key = os.environ['SB_URL'], os.environ['SB_PUBLISHABLE_KEY']
    out, off = [], 0
    while True:
        r = requests.get(f'{url}/rest/v1/{table}', params=params, timeout=60,
                         headers={'apikey': key, 'Authorization': f'Bearer {key}', 'Range-Unit': 'items', 'Range': f'{off}-{off + 999}'})
        r.raise_for_status(); j = r.json(); out += j
        if len(j) < 1000: return out
        off += 1000


def yahoo(tickers):
    q = [t.replace('.', '-') for t in tickers] + list(tickers)
    qs = sorted(set(q)); rows = []
    for i in range(0, len(qs), 200):
        rows += rest('yahoo_ratings', {'select': '*', 'ticker': f'in.({",".join(qs[i:i + 200])})'})
    Y = pd.DataFrame(rows)
    if Y.empty: return pd.DataFrame(index=pd.Index([], name='ticker'))
    Y['ticker'] = Y.ticker.str.replace('-', '.', regex=False)
    n = Y[['strong_buy', 'buy', 'hold', 'sell', 'strong_sell']].fillna(0)
    return pd.DataFrame({'ticker': Y.ticker, 'y_rating': Y.reco_key.map(YKEY), 'y_score': pd.to_numeric(Y.reco_mean).round(2),
                         'y_n_ratings': n.sum(axis=1).astype(int).replace(0, np.nan), 'y_buys': n.strong_buy + n.buy, 'y_holds': n.hold,
                         'y_sells': n.sell + n.strong_sell, 'y_n_targets': Y.num_analysts,
                         'y_target_avg': pd.to_numeric(Y.target_mean).round(2), 'y_target_low': pd.to_numeric(Y.target_low),
                         'y_target_high': pd.to_numeric(Y.target_high), 'y_price_at_fetch': pd.to_numeric(Y.current_price),
                         'y_fetched': Y.fetched_at}).set_index('ticker')


def tipranks(tickers):
    q = [t.replace('.', '-') for t in tickers] + list(tickers)
    qs = sorted(set(q)); rows = []
    for i in range(0, len(qs), 60):          # the JSON extraction times out server-side on very long ticker lists
        rows += rest('tipranks_cache', {'select': 'ticker,fetched_at,cons:data->consensuses,pt:data->ptConsensus', 'ticker': f'in.({",".join(qs[i:i + 60])})'})
    out = []
    for r in rows:
        c = [x for x in (r.get('cons') or []) if x.get('bench') == 1 and x.get('period') == 3]
        c = sorted(c, key=lambda x: -(x.get('isLatest') or 0))[0] if c else {}
        p = [x for x in (r.get('pt') or []) if x.get('bench') == 1 and x.get('period') == 3]
        p = p[0] if p else {}
        nb, nh, ns = c.get('nB'), c.get('nH'), c.get('nS')
        tot = sum(v or 0 for v in (nb, nh, ns))
        out.append(dict(ticker=r['ticker'].replace('-', '.'), tr_rating=TRKEY.get(c.get('rating')), tr_n_ratings=tot or np.nan, tr_buys=nb,
                        tr_holds=nh, tr_sells=ns, tr_target_avg=p.get('priceTarget'), tr_target_low=p.get('low'), tr_target_high=p.get('high'),
                        tr_fetched=r['fetched_at']))
    T = pd.DataFrame(out).set_index('ticker') if out else pd.DataFrame(index=pd.Index([], name='ticker'))
    if len(T):
        age = (pd.Timestamp.now(tz='UTC') - pd.to_datetime(T.tr_fetched, utc=True)).dt.days
        print('TipRanks rows dropped as stale (>', TR_MAX_AGE_DAYS, 'days):', ', '.join(f'{t} ({a}d)' for t, a in age[age > TR_MAX_AGE_DAYS].items()) or 'none')
        T = T[age <= TR_MAX_AGE_DAYS]
    return T


def latest_close(tickers):
    today = pd.Timestamp.now(tz='America/New_York')
    sess = calendar(today.date() - dt.timedelta(days=10), today.date())
    last = sess[-1] if (sess[-1] < today.date().isoformat() or today.hour >= 17) else sess[-2]   # exchange date, completed session
    B = daily_bars(tickers, sess[0], last)
    B = B[B.date <= last].sort_values('date').groupby('sym').tail(1).set_index('sym')
    return B.c.rename('close'), B.date.rename('close_date'), last


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--snap'); a = ap.parse_args()
    snap = a.snap or sorted(glob.glob(f'{U}/adv_over_500m_*.csv'))[-1].split('_')[-1][:-4]
    L = {k: pd.read_csv(f'{U}/adv_over_{k}_{snap}.csv') for k in LISTS}
    base = pd.concat(L.values()).drop_duplicates('ticker').set_index('ticker')
    tick = sorted(base.index)
    if os.environ.get('SB_URL') and os.environ.get('SB_PUBLISHABLE_KEY'): Y, T = yahoo(tick), tipranks(tick)
    else:
        print('SB_URL / SB_PUBLISHABLE_KEY not set: analyst columns left empty (the report shows n/a)')
        Y = T = pd.DataFrame(index=pd.Index([], name='ticker'))
    c, cd, last = latest_close(tick)
    S = pd.DataFrame(index=pd.Index(tick, name='ticker'))
    S['name'] = base.name; S['asset_type'] = base.asset_type
    S['analyst_asof'] = pd.Timestamp.now(tz='America/New_York').date().isoformat()
    S['close_date'] = cd; S['close'] = c
    S = S.join(Y).join(T)
    for c_ in ACOLS:                      # no analyst source: keep the columns, empty
        if c_ not in S.columns: S[c_] = pd.Series(np.nan, index=S.index, dtype=object)
    S['y_upside'] = S.y_target_avg / S.close - 1
    S['tr_upside'] = S.tr_target_avg / S.close - 1
    fund = S.asset_type.isin(['ETF', 'ETV', 'ETN', 'ETS'])
    S.loc[fund & S.y_rating.isna(), 'y_rating'] = 'fund'
    S.loc[fund & S.tr_rating.isna(), 'tr_rating'] = 'fund'
    S = S[['name', 'asset_type'] + ACOLS]
    for c_ in ('y_n_ratings', 'y_buys', 'y_holds', 'y_sells', 'y_n_targets', 'tr_n_ratings', 'tr_buys', 'tr_holds', 'tr_sells'):
        S[c_] = pd.to_numeric(S[c_]).round().astype('Int64')
    S['y_upside'] = S.y_upside.round(4); S['tr_upside'] = S.tr_upside.round(4)
    os.makedirs(OUTD, exist_ok=True)
    asof = S.analyst_asof.iloc[0]
    f1 = f'{OUTD}/analyst_snapshot_{asof}.csv'; S.to_csv(f1); S.to_csv(f'{OUTD}/analyst_snapshot_latest.csv')
    files = [f1, f'{OUTD}/analyst_snapshot_latest.csv']
    for k, d in L.items():
        d = d[[x for x in d.columns if x not in ACOLS]]
        d = d.merge(S[ACOLS], left_on='ticker', right_index=True, how='left')
        p = f'{U}/adv_over_{k}_{snap}.csv'; d.to_csv(p, index=False); files.append(p)
    stocks = S[~fund]
    meta = dict(asof=asof, lists_snapshot=snap, close_date=last, names=len(S), stocks=int((~fund).sum()), funds=int(fund.sum()),
                yahoo_stocks=int(stocks.y_target_avg.notna().sum()), tipranks_stocks=int(stocks.tr_target_avg.notna().sum()),
                yahoo_fetched=[str(S.y_fetched.min()), str(S.y_fetched.max())], tipranks_fetched=[str(S.tr_fetched.min()), str(S.tr_fetched.max())],
                missing_stocks=sorted(stocks.index[stocks.y_target_avg.isna() & stocks.tr_target_avg.isna()]))
    json.dump(meta, open(f'{OUTD}/analyst_snapshot_{asof}.json', 'w'), indent=1); files.append(f'{OUTD}/analyst_snapshot_{asof}.json')
    print(json.dumps(meta, indent=1))


if __name__ == '__main__':
    main()
