"""Find the BIGGEST single bursts: many prints at one exact price, continuously.
U was 71 prints over 17s at 31.95 with ~235ms median gaps — one sustained burst, not
many small ones. That is the shape we want."""
import json,urllib.request,time,os,sys,bisect,datetime as dt
H={"APCA-API-KEY-ID":os.environ['AK'],"APCA-API-SECRET-KEY":os.environ['AS']}
D="https://data.alpaca.markets"; S=os.environ['SESS_S']; E=os.environ['SESS_E']
GAP=float(os.environ.get('GAP','1.5'))   # generous: U averaged 235ms but had pauses
MINN=int(os.environ.get('MINN','35'))
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
    if len(tr)<40: continue
    tr.sort(key=lambda x:x["t"])
    # bursts at ONE exact price, allowing other prints to interleave without breaking the run
    bylvl={}
    for t in tr:
        if t["s"]<=10: bylvl.setdefault(t["p"],[]).append(t)
    q=None;qt=None
    best=[]
    for px,rows in bylvl.items():
        if len(rows)<MINN: continue
        cur=[rows[0]]
        for i in range(1,len(rows)):
            if (ts(rows[i]["t"])-ts(rows[i-1]["t"])).total_seconds()<=GAP: cur.append(rows[i])
            else:
                if len(cur)>=MINN: best.append((px,cur))
                cur=[rows[i]]
        if len(cur)>=MINN: best.append((px,cur))
    if not best: continue
    if q is None:
        q,_=series(sym,"quotes"); q.sort(key=lambda x:x["t"]); qt=[x["t"] for x in q]
    for px,b in best:
        i=bisect.bisect_right(qt,b[-1]["t"])-1
        if i<0: continue
        bk=q[i]
        if not(bk["bp"]>0 and bk["ap"]>bk["bp"]): continue
        if (ts(b[-1]["t"])-ts(bk["t"])).total_seconds()>30: continue
        if not(bk["bp"]<=px<=bk["ap"]): continue
        dur=(ts(b[-1]["t"])-ts(b[0]["t"])).total_seconds()
        gaps=sorted((ts(b[k]["t"])-ts(b[k-1]["t"])).total_seconds()*1000 for k in range(1,len(b)))
        j0=bisect.bisect_left(qt,b[0]["t"]); j1=bisect.bisect_right(qt,b[-1]["t"])
        states=len({(x["bp"],x["ap"]) for x in q[j0:j1+1]}) or 1
        pos=(px-bk["bp"])/(bk["ap"]-bk["bp"])
        print(json.dumps({"sym":sym,"px":px,"n":len(b),"shares":sum(x["s"] for x in b),
            "start":b[0]["t"][11:23],"end":b[-1]["t"][11:23],"dur":round(dur,2),
            "med_gap_ms":round(gaps[len(gaps)//2],1),"states":states,
            "bid":bk["bp"],"ask":bk["ap"],"dsp":round(bk["ap"]-bk["bp"],3),
            "bps":round((bk["ap"]-bk["bp"])/((bk["ap"]+bk["bp"])/2)*1e4,1),
            "pos":round(pos,3),
            "side":"SELL" if 0.60<=pos<=0.97 else ("BUY" if 0.03<=pos<=0.40 else "-"),
            "edge":round((px-bk["bp"]) if pos>=0.5 else (bk["ap"]-px),3),
            "trunc":trunc}),flush=True)
