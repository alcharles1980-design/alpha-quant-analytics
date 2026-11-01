"""Driver for the AQA page "Stocks By Cycles Returns % List" (1 Nov 2026). Runs the kit's own scripts and publishes the reports.

  python3 run_cycles.py nightly [--day YYYY-MM-DD]     previous-day ranking + rolling 5-session ranking (needs a finished 52-week run;
                                                       builds one first if none is on disk)
  python3 run_cycles.py weekly52 [--end-week MONDAY]   lists for the last completed session, analyst snapshot, 52-week report
  python3 run_cycles.py full                            weekly52 then nightly (the Friday-night run)

Environment: SUPABASE_URL + SUPABASE_KEY (the app's project; also used as the analyst source), POLYGON_API_KEY, ADV_KIT_DATA.
Alpaca keys are read from the app (rpc get_app_client_keys, AQA's Algo Trader Plus account) into this process's environment only;
they are never printed or written anywhere. Reports are rendered by consist_report.write_outputs (the segmented list format, every name
in every list) and upserted into public.cached_cycles_reports (kind = day | roll5 | w52), newest KEEP per kind kept."""
import os, sys, glob, json, shutil, argparse, subprocess, datetime as dt
import requests, pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
KEEP = 15            # reports kept per kind in the database (~0.3 MB of text each)
ROLL_N = 5           # rolling window, sessions


def sb_headers():
    k = os.environ['SUPABASE_KEY']
    return {'apikey': k, 'Authorization': f'Bearer {k}', 'Content-Type': 'application/json'}


def load_keys():
    """Alpaca keys from the app (same path as nrs-refresh.js); analyst source = the app's own project."""
    url = os.environ['SUPABASE_URL']
    if not os.environ.get('APCA_API_KEY_ID'):
        r = requests.post(f'{url}/rest/v1/rpc/get_app_client_keys', headers=sb_headers(), data='{}', timeout=30); r.raise_for_status()
        kv = {x['key']: x['value'] for x in r.json()}
        if not kv.get('alpaca_key') or not kv.get('alpaca_secret'): sys.exit('alpaca_key / alpaca_secret not returned by get_app_client_keys')
        os.environ['APCA_API_KEY_ID'] = kv['alpaca_key']; os.environ['APCA_API_SECRET_KEY'] = kv['alpaca_secret']
    os.environ.setdefault('SB_URL', url); os.environ.setdefault('SB_PUBLISHABLE_KEY', os.environ['SUPABASE_KEY'])
    print('keys loaded (alpaca from app_config, not printed)', flush=True)


STATUS_ID = None


def status(st, msg, pct=0):
    """pipeline_status row (mode 'cycles'), so a failed night is visible in the app like every other pipeline job."""
    global STATUS_ID
    try:
        url = os.environ['SUPABASE_URL']; h = dict(sb_headers(), Prefer='return=representation')
        body = dict(mode='cycles', ticker='ALL', status=st, message=msg[:500], progress_pct=pct, run_id=os.environ.get('GITHUB_RUN_ID'),
                    updated_at=pd.Timestamp.now(tz='UTC').isoformat())
        if STATUS_ID is None:
            r = requests.post(f'{url}/rest/v1/pipeline_status', headers=h, json=body, timeout=30)
            if r.ok and r.json(): STATUS_ID = r.json()[0]['id']
        else:
            requests.patch(f'{url}/rest/v1/pipeline_status?id=eq.{STATUS_ID}', headers=h, json=body, timeout=30)
    except Exception as e:
        print('status write failed:', e, flush=True)
    print(f'[{st}] {msg}', flush=True)


def run(args):
    print('$', ' '.join(args), flush=True)
    subprocess.run([sys.executable] + args, cwd=HERE, check=True)


def last_done(day=None):
    """The latest completed session (20:00 ET passed) on or before `day`, and the one before it."""
    import scan_orig as S
    now = pd.Timestamp.now(tz='America/New_York')
    end = pd.Timestamp(day).date() if day else now.date()
    cal = [str(d) for d in S.cal(end - dt.timedelta(days=20), end)]
    done = [d for d in cal if pd.Timestamp(d).tz_localize('America/New_York') + pd.Timedelta(hours=20) <= now]
    return done[-1], done[-2], done


def refresh_overnight(sessions, syms):
    """Re-pull the overnight (BOATS) files for these sessions from scratch. ensure_overnight() only pulls names it has never seen, so a
    night first pulled while it was still trading stays cut short for good: the reference outputs of 1 Nov 2026 had the night before
    Fri 30 Oct ending at 21:28 ET for 275 names and missing for 24 (found 1 Nov 2026 by matching them to full re-pulls)."""
    import config as C
    for d in sessions:
        p = f'{C.BOATS}/{d}.parquet'
        if os.path.exists(p): os.remove(p)
    f = f'{C.REPORTS}/_boats_refresh.txt'; open(f, 'w').write('\n'.join(sorted(syms)) + '\n')
    run(['pull_boats.py', sessions[0], sessions[-1], f])


def prefill(days, syms, workers=6):
    """First run on an empty store: pull the session files the kit would pull one by one, in parallel by day (minutes) and in
    20-session chunks (overnight). consist_report's own ensure_* then finds them and only tops up. Pulling a year of overnight bars in
    one request set (what ensure_overnight does when any night is missing) holds every row in memory at once."""
    import config as C, consist_report as CR
    from concurrent.futures import ThreadPoolExecutor
    if C.OFFLINE: return
    todo = [d for d in days if not os.path.exists(f'{C.M1}/{d}.parquet')]
    if todo:
        print(f'prefill minutes: {len(todo)} sessions x {len(syms)} names', flush=True)
        with ThreadPoolExecutor(workers) as ex: list(ex.map(lambda d: CR.ensure_minutes(syms, [d]), todo))
    miss = [d for d in days if not os.path.exists(f'{C.BOATS}/{d}.parquet')]
    if miss:
        f = f'{C.REPORTS}/_boats_prefill.txt'; open(f, 'w').write('\n'.join(sorted(syms)) + '\n')
        for i in range(0, len(miss), 20): run(['pull_boats.py', miss[i], miss[min(i + 19, len(miss) - 1)], f])


def newest_run():
    import config as C
    runs = sorted(glob.glob(f'{C.REPORTS}/out_*_official'), key=lambda p: json.load(open(f'{p}/meta.json'))['tag'] if os.path.exists(f'{p}/meta.json') else '')
    runs = [r for r in runs if os.path.exists(f'{r}/stats.parquet') and os.path.exists(f'{r}/meta.json')]
    return runs[-1] if runs else None


def load_run(RUN):
    import consist_report as CR
    R = pd.read_parquet(f'{RUN}/weekly_results.parquet'); ST = pd.read_parquet(f'{RUN}/stats.parquet')
    members = {k: set(v) for k, v in json.load(open(f'{RUN}/members.json')).items()}
    weeks = sorted(R.week.unique()); W = len(weeks)
    syms = sorted(set().union(*members.values()))
    cnt = pd.read_parquet(f'{RUN}/weeks_on_list.parquet'); cnt = cnt.reindex(sorted(set(cnt.index) | set(syms))).fillna(0).astype(int)
    m = json.load(open(f'{RUN}/meta.json'))
    return R, ST.reindex(syms), members, weeks, W, cnt, m


def render(RUN, kind, day=None):
    """Segmented-list report with every name (top_all) into <reports>/page/<kind>/; returns (chat md path, workbook path)."""
    import config as C, consist_report as CR
    R, ST, members, weeks, W, cnt, m = load_run(RUN)
    dest = f'{C.REPORTS}/page/{kind}'; os.makedirs(dest, exist_ok=True)
    if kind == 'w52':
        for f in ('meta.json', 'momentum.parquet'):           # write_outputs reads these from OUT; render into dest, keep RUN's chat file intact
            if os.path.exists(f'{RUN}/{f}'): shutil.copy(f'{RUN}/{f}', dest)
        out, chat = CR.write_outputs(dest, m['tag'], weeks, W, cnt, R, ST, m['last_date'], m['cont'], members, m['mode'], m['snap'], top_all=True)
    else:
        day = dict(day, dest=dest)
        out, chat = CR.write_outputs(RUN, m['tag'], weeks, W, cnt, R, ST, m['last_date'], m['cont'], members, m['mode'], m['snap'], day=day, top_all=True)
    return chat, out, m, weeks


def publish(kind, chat, m, weeks, period_start, period_end, extra=None):
    """Upsert one report (the full markdown) into cached_cycles_reports, then keep the newest KEEP of that kind."""
    url = os.environ['SUPABASE_URL']; md = open(chat).read()
    title = md.split('\n', 1)[0].lstrip('# ').strip()
    end_fri = (pd.Timestamp(weeks[-1]) + pd.Timedelta(days=4)).strftime('%Y-%m-%d')
    row = dict(kind=kind, period_start=period_start, period_end=period_end, snap=m['snap'], look_start=weeks[0], look_end=end_fri,
               price_date=str(m['last_date']), title=title, md=md, generated_at=pd.Timestamp.now(tz='UTC').isoformat(),
               meta=dict(extra or {}, md_bytes=len(md.encode()), run_tag=m['tag'], github_run=os.environ.get('GITHUB_RUN_ID')))
    h = dict(sb_headers(), Prefer='resolution=merge-duplicates,return=minimal')
    r = requests.post(f'{url}/rest/v1/cached_cycles_reports?on_conflict=kind,period_end', headers=h, json=row, timeout=120)
    if not r.ok: raise RuntimeError(f'publish {kind} {period_end}: HTTP {r.status_code} {r.text[:200]}')
    # read back: the stored text must be the text rendered
    g = requests.get(f'{url}/rest/v1/cached_cycles_reports', headers=sb_headers(), timeout=60,
                     params={'kind': f'eq.{kind}', 'period_end': f'eq.{period_end}', 'select': 'md'}).json()
    if not g or g[0]['md'] != md: raise RuntimeError(f'publish {kind} {period_end}: read-back mismatch')
    old = requests.get(f'{url}/rest/v1/cached_cycles_reports', headers=sb_headers(), timeout=60,
                       params={'kind': f'eq.{kind}', 'select': 'id', 'order': 'period_end.desc', 'offset': str(KEEP), 'limit': '100'}).json()
    if old:
        requests.delete(f'{url}/rest/v1/cached_cycles_reports', headers=sb_headers(), timeout=60,
                        params={'id': f'in.({",".join(str(x["id"]) for x in old)})'})
    print(f'published {kind} {period_start}..{period_end}: {len(md):,} chars, verified; pruned {len(old)}', flush=True)


def list_returns(df, members):
    out = {}
    for k, v in members.items():
        x = df.reindex(sorted(v))
        out[k] = dict(r5=float(x.profit5.sum() / x.cap5.sum()) if x.cap5.sum() > 0 else None,
                      rbest=float(x.profit_best.sum() / x.cap_best.sum()) if x.cap_best.sum() > 0 else None)
    return out


def weekly52(end_week=None):
    import config as C
    day, prev, done = last_done()
    status('running', f'52-week run: lists for {day}', 5)
    run(['build_lists.py', day])
    run(['analyst_snapshot.py', '--snap', day])
    syms = sorted(set(pd.read_csv(f'{C.UNIVERSE}/adv_over_500m_{day}.csv').ticker))
    import scan_orig as S
    look = [str(d) for d in S.cal(pd.Timestamp(day).date() - dt.timedelta(days=7 * 53), pd.Timestamp(day).date())]
    status('running', f'52-week run: bars for {len(look)} sessions', 10)
    prefill(look, syms)
    refresh_overnight(done[-7:], syms)                         # the last week's nights complete, whatever an earlier run cached
    status('running', f'52-week run: simulating (lists {day})', 20)
    run(['consist_report.py', '--weeks', '52'] + (['--end-week', end_week] if end_week else []))
    open(f'{C.REPORTS}/.built_weekly52', 'w').write(day)        # tells the workflow to save the refreshed bar store
    RUN = newest_run()
    chat, out, m, weeks = render(RUN, 'w52')
    publish('w52', chat, m, weeks, weeks[0], m['last_date'])
    # keep the bar store to the look-back (+ the days before the first Monday that the rankings read)
    keep_from = (pd.Timestamp(weeks[0]) - pd.Timedelta(days=10)).strftime('%Y-%m-%d')
    n = 0
    for d in (C.M1, C.BOATS):
        for p in glob.glob(f'{d}/*.parquet'):
            if os.path.basename(p)[:10] < keep_from: os.remove(p); n += 1
    for p in sorted(glob.glob(f'{C.REPORTS}/out_*_official'))[:-2]: shutil.rmtree(p, ignore_errors=True)
    print('pruned bar files before', keep_from, ':', n, flush=True)


def nightly(day_arg=None):
    import config as C
    RUN = newest_run()
    if RUN is None:
        print('no finished 52-week run on disk: building one first', flush=True)
        weekly52(); RUN = newest_run()
    m = json.load(open(f'{RUN}/meta.json')); snap = m['snap']
    day, prev, done = last_done(day_arg)
    syms = sorted(set(pd.read_csv(f'{C.UNIVERSE}/adv_over_500m_{snap}.csv').ticker))
    sess = done[-(ROLL_N + 1):]                                # prior session + the rolling window
    status('running', f'nightly {day}: bars', 10)
    refresh_overnight(sess[1:], syms)
    run(['day_rank.py', day, prev, snap])
    status('running', f'nightly {day}: rolling {ROLL_N} sessions', 50)
    run(['roll_rank.py', day, snap, str(ROLL_N)])
    import consist_report as CR
    D = pd.read_parquet(f'{C.REPORTS}/day_rank/day_rank_{day}.parquet')
    chat, out, m, weeks = render(RUN, 'day', dict(df=D, date=day, prev=prev))
    publish('day', chat, m, weeks, day, day, dict(lists=list_returns(D, json.load(open(f'{RUN}/members.json')))))
    Rr = pd.read_parquet(f'{C.REPORTS}/day_rank/roll_rank_{day}.parquet')
    a = Rr.attrs or {}
    start = (a.get('days') or sess[1:])[0]; rprev = a.get('prev') or sess[0]
    chat, out, m, weeks = render(RUN, 'roll5', dict(df=Rr, kind='roll', start=start, date=day, prev=rprev, n=ROLL_N))
    publish('roll5', chat, m, weeks, start, day, dict(lists=list_returns(Rr, json.load(open(f'{RUN}/members.json')))))
    status('complete', f'nightly {day}: day + rolling {ROLL_N} sessions published (lists {snap}, 52-week run {m["tag"]})', 100)


if __name__ == '__main__':
    ap = argparse.ArgumentParser(); ap.add_argument('mode', choices=['nightly', 'weekly52', 'full'])
    ap.add_argument('--day'); ap.add_argument('--end-week'); a = ap.parse_args()
    load_keys()
    import config as C
    if os.path.exists(f'{C.REPORTS}/.built_weekly52'): os.remove(f'{C.REPORTS}/.built_weekly52')
    try:
        if a.mode in ('weekly52', 'full'): weekly52(a.end_week)
        if a.mode in ('nightly', 'full'): nightly(a.day)
        if a.mode == 'weekly52': status('complete', '52-week run published', 100)
    except Exception as e:
        status('error', f'{a.mode} failed: {e}', 0)
        raise
