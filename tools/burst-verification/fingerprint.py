#!/usr/bin/env python3
"""Classify TRF off-exchange prints as ATS ECHO or INTERNALISED by SIZE FINGERPRINT.

WHY THIS BEATS COUNT MATCHING. The TRF stamps prints with REPORT time, so execution time
appears unrecoverable. It is not: when a group of trades echoes from an ATS, the SIZE MULTISET
survives the reporting delay intact. A group of {550x1, 180x1, 93x1, 50x6, 100x3, 2x3, 1x58}
is a fingerprint -- match it against BOATS prints at the same price and the execution window
is recovered to the second.

Verified on HOOD 87.28 (2026-07-31): 73 TRF prints matched 73 BOATS prints at 07:25:20-40Z
with an IDENTICAL multiset. Reporting delay 38.7 minutes. The earlier count-only classifier
called this price internalised because it compared against the WHOLE NIGHT's BOATS prints at
87.28 (83, not 73) and the counts disagreed.

METHOD. For each price present in the TRF batch:
  1. T = multiset of TRF sizes at that price.
  2. B = BOATS prints at that price, sorted by execution time.
  3. Slide a window of len(T) contiguous prints over B. An exact multiset match is an ECHO,
     and the window's timestamps give the execution time.
  4. No window matches, but T is a sub-multiset of the whole night's B -> PARTIAL (ambiguous).
  5. Otherwise -> INTERNALISED, with the unmatched excess counted.

The contiguity requirement matters: echoes arrive as bursts, so an exact match spread across
the whole night would be coincidence rather than signal.
"""
import json, sys, os
from collections import Counter

SESSION = os.environ.get("SESSION", "2026-07-31")
ROUND = 4


def load(sym):
    return json.load(open(f"data_{SESSION}_{sym}.json"))


def by_price(trades):
    g = {}
    for t in trades:
        g.setdefault(round(float(t["p"]), ROUND), []).append(t)
    return g


def find_window(bl, T):
    """bl: BOATS prints at one price, time-sorted. T: Counter of TRF sizes.
    Return (start_ts, end_ts) of a contiguous window whose size multiset == T, else None."""
    k = sum(T.values())
    if k == 0 or len(bl) < k:
        return None
    sizes = [int(x.get("s") or 0) for x in bl]
    win = Counter(sizes[:k])
    if win == T:
        return bl[0]["t"], bl[k - 1]["t"]
    for i in range(k, len(bl)):
        win[sizes[i]] += 1
        win[sizes[i - k]] -= 1
        if win[sizes[i - k]] == 0:
            del win[sizes[i - k]]
        if win == T:
            return bl[i - k + 1]["t"], bl[i]["t"]
    return None


def size_excess(sym):
    """ROBUST internalised estimate. Per price, per size, the TRF count above the BOATS count
    is flow that cannot have come from the ATS. Unlike the contiguous-window fingerprint this
    makes no assumption that a price's TRF group is a single burst, so it survives prices that
    recur all night -- which is most prices on a busy symbol. It does NOT recover execution
    time; use classify() for that, on isolated bursts only."""
    d = load(sym)
    bg, tg = by_price(d["boats"]), by_price(d["trf"])
    ex_p = ex_s = tot_p = tot_s = 0
    for p, tl in tg.items():
        T = Counter(int(x.get("s") or 0) for x in tl)
        B = Counter(int(x.get("s") or 0) for x in bg.get(p, []))
        for s, n in T.items():
            unmatched = max(0, n - B.get(s, 0))
            ex_p += unmatched; ex_s += unmatched * s
            tot_p += n;        tot_s += n * s
    return {"sym": sym, "trf_prints": tot_p, "trf_shares": tot_s,
            "internal_prints": ex_p, "internal_shares": ex_s,
            "pct_prints": 100*ex_p/tot_p if tot_p else 0,
            "pct_shares": 100*ex_s/tot_s if tot_s else 0}


def classify(sym):
    d = load(sym)
    bg, tg = by_price(d["boats"]), by_price(d["trf"])
    for v in bg.values():
        v.sort(key=lambda x: x["t"])

    res = {"echo": [], "partial": [], "internal": []}
    for p, tl in tg.items():
        T = Counter(int(x.get("s") or 0) for x in tl)
        shares = sum(int(x.get("s") or 0) for x in tl)
        bl = bg.get(p, [])
        w = find_window(bl, T)
        if w:
            res["echo"].append({"price": p, "prints": len(tl), "shares": shares,
                                "exec_start": w[0], "exec_end": w[1],
                                "report_start": min(x["t"] for x in tl)})
            continue
        B = Counter(int(x.get("s") or 0) for x in bl)
        if all(B.get(s, 0) >= n for s, n in T.items()):
            res["partial"].append({"price": p, "prints": len(tl), "shares": shares})
        else:
            excess = sum(max(0, n - B.get(s, 0)) for s, n in T.items())
            res["internal"].append({"price": p, "prints": len(tl), "shares": shares,
                                    "unmatched_prints": excess})
    return res


def delay_minutes(a, b):
    from datetime import datetime
    return (datetime.fromisoformat(b[:26]) - datetime.fromisoformat(a[:26])).total_seconds() / 60


if __name__ == "__main__":
    print(f"session {SESSION}")
    print(f"{'SYM':6}{'TRF px':>8}{'echo':>6}{'partial':>8}{'intern':>7}"
          f"{'echo shr':>10}{'int shr':>9}{'% int shr':>10}{'med delay':>10}")
    for sym in sys.argv[1:]:
        try:
            r = classify(sym)
        except FileNotFoundError:
            print(f"{sym:6}  (no data file)")
            continue
        es = sum(x["shares"] for x in r["echo"])
        ps = sum(x["shares"] for x in r["partial"])
        isx = sum(x["shares"] for x in r["internal"])
        tot = es + ps + isx
        delays = sorted(delay_minutes(x["exec_end"], x["report_start"]) for x in r["echo"])
        med = delays[len(delays) // 2] if delays else float("nan")
        npx = len(r["echo"]) + len(r["partial"]) + len(r["internal"])
        print(f"{sym:6}{npx:8}{len(r['echo']):6}{len(r['partial']):8}{len(r['internal']):7}"
              f"{es:10}{isx:9}{100*isx/tot if tot else 0:9.1f}%{med:10.1f}")
