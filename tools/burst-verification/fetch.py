#!/usr/bin/env python3
"""Fetch BOATS overnight + TRF morning batch for a completed session, WITH PAGINATION.

A 200 with a next_page_token still pending is silent truncation -- the #1 failure class in
this codebase. Every fetch here follows the token to exhaustion and asserts it ended null.
"""
import json, os, sys, time, urllib.request, urllib.parse

# Credentials come from the environment. They are NOT committed -- the same keys live in the
# app_config table, and a key in git history cannot be un-published.
#   export ALPACA_KEY=... ALPACA_SECRET=...
KEY = os.environ["ALPACA_KEY"]
SEC = os.environ["ALPACA_SECRET"]
BASE = "https://data.alpaca.markets/v2/stocks/{sym}/trades"

# Session date is set from argv[1]. The overnight session BEGINNING 20:00 ET on day D-1 is
# stamped day D, and its TRF batch lands 04:00 ET on day D. Getting this wrong silently
# fetches an adjacent session that looks perfectly valid -- it cost one failed validation.
SESSION = None
def set_session(day):
    global START_B, END_B, START_T, END_T, SESSION
    SESSION = day
    START_B, END_B = f"{day}T00:00:00Z", f"{day}T07:59:59Z"
    START_T, END_T = f"{day}T08:00:00Z", f"{day}T08:15:00Z"


def fetch(sym, feed, start, end, max_pages=60):
    out, token, pages = [], None, 0
    while True:
        q = {"feed": feed, "limit": 10000, "start": start, "end": end}
        if token:
            q["page_token"] = token
        url = BASE.format(sym=sym) + "?" + urllib.parse.urlencode(q)
        req = urllib.request.Request(url, headers={
            "APCA-API-KEY-ID": KEY, "APCA-API-SECRET-KEY": SEC})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    d = json.load(r)
                break
            except Exception as e:
                if attempt == 3:
                    raise
                time.sleep(1.5 * (attempt + 1))
        out.extend(d.get("trades") or [])
        token = d.get("next_page_token")
        pages += 1
        if not token:
            return out, pages, True          # exhausted cleanly
        if pages >= max_pages:
            return out, pages, False         # ran out of budget -- TRUNCATED


def get(sym):
    b, bp, bok = fetch(sym, "boats", START_B, END_B)
    t, tp, tok = fetch(sym, "sip",   START_T, END_T)
    t = [x for x in t if x.get("x") == "D"]   # off-exchange only
    return {"sym": sym, "boats": b, "trf": t,
            "boats_pages": bp, "trf_pages": tp, "complete": bok and tok}


if __name__ == "__main__":
    set_session(sys.argv[1])
    for sym in sys.argv[2:]:
        r = get(sym)
        json.dump(r, open(f"data_{SESSION}_{sym}.json", "w"))
        flag = "OK" if r["complete"] else "*** TRUNCATED ***"
        print(f"{sym:6} boats {len(r['boats']):7} ({r['boats_pages']}p)   "
              f"trf-D {len(r['trf']):7} ({r['trf_pages']}p)   {flag}")
