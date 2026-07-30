"""CRITERIA (deliberately simple):
   > 50 prints   |   same exact price   |   same stock   |   same side   |   under 2 minutes

SIDE is measured at EVERY print, not just the last. The AAOI 76.90 burst looked like a
hidden-liquidity signal only because the book was sampled at the end, by which time the bid
had walked away. Position must be consistent throughout or it is not one-sided.
"""
import json,urllib.request,time,os,sys,bisect,datetime as dt
H={"APCA-API-KEY-ID":os.environ['AK'],"APCA-API-SECRET-KEY":os.environ['AS']}
D="https://data.alpaca.markets"; S=os.environ['SESS_S']; E=os.environ['SESS_E']
MIN_PRINTS=51; MAX_SPAN=120.0
def get(u):
    for a in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(u,headers=H),timeout=50) as r: return json.load(r)
        except Exception: time.sleep(2*(a+1))
    return None
def ts(x):
    s=x.replace("Z","+00:00"); return dt.datetime.fromisoformat(s[:26]+"+00:00" if len(s)>32 else s)
def series(sym,kind,cap=40):
    out=[];u=f"{D}/v2/stocks/{sym}/{kind}?feed=boats&limit=10000&start={S}&end={E}";p=0
    while u and p<cap:
        j=get(u)
        if not j: return out,True
        out+=j.get(kind) or []; p+=1
        tok=j.get("next_page_token"); u=(u.split("&page_token")[0]+"&page_token="+tok) if tok else None
    return out,(u is not None)
for sym in sys.argv[1].split(","):
    tr,trunc=series(sym,"trades")
    if len(tr)<MIN_PRINTS: continue
    tr.sort(key=lambda x:x["t"])
    q,_=series(sym,"quotes"); q.sort(key=lambda x:x["t"]); qt=[x["t"] for x in q]
    bylvl={}
    for t in tr: bylvl.setdefault(t["p"],[]).append(t)
    for px,rows in bylvl.items():
        if len(rows)<MIN_PRINTS: continue
        # sliding window: any run of >50 prints at this price spanning <2 minutes
        i=0
        while i<len(rows):
            j=i
            while j+1<len(rows) and (ts(rows[j+1]["t"])-ts(rows[i]["t"])).total_seconds()<=MAX_SPAN: j+=1
            win=rows[i:j+1]
            if len(win)>=MIN_PRINTS:
                # side at EVERY print
                lo=hi=0; poss=[]; spreads=[]
                for t in win:
                    k=bisect.bisect_right(qt,t["t"])-1
                    if k<0: continue
                    b=q[k]
                    if not(b["bp"]>0 and b["ap"]>b["bp"]): continue
                    if (ts(t["t"])-ts(b["t"])).total_seconds()>30: continue
                    p=(t["p"]-b["bp"])/(b["ap"]-b["bp"])
                    poss.append(p); spreads.append(b["ap"]-b["bp"])
                    if p<0.5: lo+=1
                    else: hi+=1
                tot=lo+hi
                if tot>=MIN_PRINTS*0.8 and poss:
                    frac=max(lo,hi)/tot
                    if frac>=0.90:                       # genuinely one-sided
                        poss.sort(); spreads.sort()
                        mp=poss[len(poss)//2]; msp=spreads[len(spreads)//2]
                        span=(ts(win[-1]["t"])-ts(win[0]["t"])).total_seconds()
                        atTouch=sum(1 for p in poss if p<=0.02 or p>=0.98)/len(poss)
                        print(json.dumps({"sym":sym,"px":px,"n":len(win),
                          "shares":sum(x["s"] for x in win),
                          "start":win[0]["t"][11:23],"end":win[-1]["t"][11:23],"span_s":round(span,2),
                          "side":"hitting BID (seller)" if hi<lo else "lifting ASK (buyer)",
                          "one_sided_pct":round(frac*100),
                          "med_pos":round(mp,3),"med_dsp":round(msp,3),
                          "at_touch_pct":round(atTouch*100),
                          "trunc":trunc}),flush=True)
                i=j+1
            else: i+=1
