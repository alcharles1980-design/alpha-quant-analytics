"""One-day ranking in the Average Daily Volume Segmented Stocks List format (Albert 1 Nov 2026: day reports and any other reports use
exactly the segmented list's format: all its columns, notes, analyst ratings/targets, price from peak, moving averages, capital check).
  python3 day_segmented.py DAY PREV_DAY [RUN_DIR]        e.g. 2026-10-30 2026-10-29
  python3 day_segmented.py --week MONDAY PREV_FRIDAY [RUN_DIR]   e.g. --week 2026-10-26 2026-10-23  (needs ndxsim/week_rank.py MONDAY SNAP first)
Needs <reports>/day_rank/day_rank_<DAY>.parquet (python3 day_rank.py DAY PREV SNAP builds it) and a finished 52-week run
(default: the newest out_*_official folder). Writes day_reports/<DAY>/ : the workbook + chat_day_<DAY>.md."""
import os, sys, glob, json
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config as C, consist_report as CR

WEEK = sys.argv[1] == '--week'
if WEEK: sys.argv.pop(1)
DAY, PREV = sys.argv[1], sys.argv[2]
RUN = sys.argv[3] if len(sys.argv) > 3 else sorted(glob.glob(f'{C.REPORTS}/out_*_official'), key=os.path.getmtime)[-1]
D = pd.read_parquet(f'{C.REPORTS}/day_rank/{"week_rank" if WEEK else "day_rank"}_{DAY}.parquet')
R = pd.read_parquet(f'{RUN}/weekly_results.parquet'); ST = pd.read_parquet(f'{RUN}/stats.parquet')
members = {k: set(v) for k, v in json.load(open(f'{RUN}/members.json')).items()}
weeks = sorted(R.week.unique()); W = len(weeks)
syms = sorted(set().union(*members.values()))
cnt = pd.read_parquet(f'{RUN}/weeks_on_list.parquet'); cnt = cnt.reindex(sorted(set(cnt.index) | set(syms))).fillna(0).astype(int)
m = json.load(open(f'{RUN}/meta.json'))
miss = sorted(set(syms) - set(D.index))
if miss: print('no one-day result for', miss)
CR.write_outputs(RUN, m['tag'], weeks, W, cnt, R, ST.reindex(syms), m['last_date'], m['cont'], members, m['mode'], m['snap'],
                 day=(dict(df=D, kind='week', start=DAY, date=str((pd.Timestamp(DAY) + pd.Timedelta(days=4)).date()), prev=PREV,
                           dest=f'{C.REPORTS}/week_reports/{DAY}') if WEEK else
                      dict(df=D, date=DAY, prev=PREV, dest=f'{C.REPORTS}/day_reports/{DAY}')))
