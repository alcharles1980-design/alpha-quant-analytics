"""Folder settings for the kit. Every folder can be overridden with an environment variable; by default everything lives
under ADV_KIT_DATA (default: ../data next to this code folder). API keys are NEVER stored here: they come from the environment
(APCA_API_KEY_ID, APCA_API_SECRET_KEY, POLYGON_API_KEY, and optionally SB_URL + SB_PUBLISHABLE_KEY for the analyst source).

ADV_OFFLINE=1 stops the scripts from pulling any missing minute / overnight bars (use the files already on disk)."""
import os

CODE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.environ.get('ADV_KIT_DATA', os.path.join(CODE, '..', 'data')))


def _d(env, sub):
    p = os.path.abspath(os.environ.get(env, os.path.join(ROOT, sub)))
    os.makedirs(p, exist_ok=True)
    return p


M1 = _d('ADV_M1_DIR', 'minutes')               # 1-min SIP bars 04:00-20:00 ET, one parquet per session: <YYYY-MM-DD>.parquet [sym, t, o, h, l, c, v]
BOATS = _d('ADV_BOATS_DIR', 'boats')           # overnight 1-min bars (Alpaca feed=boats): <session>.parquet = the night BEFORE that session
UNIVERSE = _d('ADV_UNIVERSE_DIR', 'universe')  # list CSVs adv_over_<list>_<snap>.csv, Polygon caches (grouped/, reference), analyst/
REPORTS = _d('ADV_REPORTS_DIR', 'reports')     # 52-week runs out_<tag>_<mode>/, day_rank/ (day + week ranking data), day_reports/, week_reports/
OFFLINE = bool(os.environ.get('ADV_OFFLINE'))
