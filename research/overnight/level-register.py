"""Live hidden-liquidity level register.

Discovery, not reaction. A burst tells us a resting order exists at a price; the register
keeps that level alive so the REVISITS can be traded. Speed is not the constraint —
knowing the level is.

Validation baked in: position is checked at EVERY print and must stay off the touch.
"""
import json,urllib.request,time,os,sys,bisect,collections,datetime as dt
AK=os.environ['AK']; AS=os.environ['AS']; SBK=os.environ['SBK']
H={"APCA-API-KEY-ID":AK,"APCA-API-SECRET-KEY":AS}
SB="https://haeqzegdlwryvaecanrn.supabase.co"
SH={"apikey":SBK,"Authorization":"Bearer "+SBK,"Content-Type":"application/json"}
D="https://data.alpaca.markets"
MIN_PRINTS=int(os.environ.get('MIN_PRINTS','25'))
MAX_SPAN=float(os.environ.get('MAX_SPAN','120'))

def get(u,hdr=None,tries=4):
    for a in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u,headers=hdr or H),timeout=45) as r:
                return json.load(r)
        except Exception: time.sleep(2*(a+1))
    return None
def ts(x):
    s=x.replace("Z","+00:00"); return dt.datetime.fromisoformat(s[:26]+"+00:00" if len(s)>32 else s)
def session_date(now):
    """Overnight session beginning 20:00 ET is stamped the FOLLOWING date (§5.1c)."""
    et=now.astimezone(dt.timezone(dt.timedelta(hours=-4)))
    return (et.date()+dt.timedelta(days=1)) if et.hour>=20 else et.date()

def sweep(universe,lookback_s):
    now=dt.datetime.now(dt.timezone.utc)
    start=(now-dt.timedelta(seconds=lookback_s)).strftime("%Y-%m-%dT%H:%M:%SZ")
    tape={}
    for i in range(0,len(universe),400):
        ch=universe[i:i+400]
        u=f"{D}/v2/stocks/trades?feed=boats&limit=10000&start={start}&symbols={','.join(ch)}"
        while u:
            j=get(u)
            if not j: break
            for k,v in (j.get("trades") or {}).items(): tape.setdefault(k,[]).extend(v)
            tok=j.get("next_page_token")
            u=(u.split("&page_token")[0]+"&page_token="+tok) if tok else None
    # candidate levels first, so quotes are only fetched for symbols that matter
    cands=collections.defaultdict(list)
    for sym,rows in tape.items():
        rows.sort(key=lambda x:x["t"])
        bylvl=collections.defaultdict(list)
        for t in rows:
            if t["s"]<=10: bylvl[t["p"]].append(t)
        for px,pr in bylvl.items():
            if len(pr)<MIN_PRINTS: continue
            i=0
            while i<len(pr):
                j=i
                while j+1<len(pr) and (ts(pr[j+1]["t"])-ts(pr[i]["t"])).total_seconds()<=MAX_SPAN: j+=1
                if j-i+1>=MIN_PRINTS: cands[sym].append((px,pr[i:j+1]))
                i=j+1 if j>i else i+1
    if not cands: return [],len(tape),sum(len(v) for v in tape.values())
    out=[]
    for sym,lst in cands.items():
        q=[]
        u=f"{D}/v2/stocks/{sym}/quotes?feed=boats&limit=10000&start={start}"
        p=0
        while u and p<10:
            j=get(u)
            if not j: break
            q+=j.get("quotes") or []; p+=1
            tok=j.get("next_page_token"); u=(u.split("&page_token")[0]+"&page_token="+tok) if tok else None
        if not q: continue
        q.sort(key=lambda x:x["t"]); qt=[x["t"] for x in q]
        for px,win in lst:
            poss=[];sprs=[];bids=[];asks=[]
            for t in win:
                k=bisect.bisect_right(qt,t["t"])-1
                if k<0: continue
                b=q[k]
                if not(b["bp"]>0 and b["ap"]>b["bp"]): continue
                if (ts(t["t"])-ts(b["t"])).total_seconds()>30: continue
                poss.append((px-b["bp"])/(b["ap"]-b["bp"])); sprs.append(b["ap"]-b["bp"])
                bids.append(b["bp"]); asks.append(b["ap"])
            if len(poss)<MIN_PRINTS*0.8: continue
            lo=sum(1 for p2 in poss if p2<0.5); hi=len(poss)-lo
            if max(lo,hi)/len(poss)<0.90: continue            # must be one-sided
            touch=sum(1 for p2 in poss if p2<=0.02 or p2>=0.98)/len(poss)*100
            ps=sorted(poss); mp=ps[len(ps)//2]
            ss=sorted(sprs); msp=ss[len(ss)//2]
            j0=bisect.bisect_left(qt,win[0]["t"]); j1=bisect.bisect_right(qt,win[-1]["t"])
            states=len({(x["bp"],x["ap"]) for x in q[j0:j1+1]}) or 1
            mb=sorted(bids)[len(bids)//2]; ma=sorted(asks)[len(asks)//2]
            out.append({"sym":sym,"px":px,"side":"ASK" if mp>=0.5 else "BID",
                "seen":win[-1]["t"],"prints":len(win),"shares":sum(x["s"] for x in win),
                "span":round((ts(win[-1]["t"])-ts(win[0]["t"])).total_seconds(),3),
                "bid":mb,"ask":ma,"pos":round(mp,4),"spread":round(msp,4),
                "edge":round((px-mb) if mp>=0.5 else (ma-px),4),
                "states":states,"touch":round(touch,1)})
    return out,len(tape),sum(len(v) for v in tape.values())

def push(hits):
    sd=str(session_date(dt.datetime.now(dt.timezone.utc)))
    ok=0
    for h in hits:
        body=json.dumps({"p_date":sd,"p_ticker":h["sym"],"p_price":h["px"],"p_side":h["side"],
            "p_seen":h["seen"],"p_prints":h["prints"],"p_shares":h["shares"],"p_span":h["span"],
            "p_bid":h["bid"],"p_ask":h["ask"],"p_pos":h["pos"],"p_spread":h["spread"],
            "p_edge":h["edge"],"p_states":h["states"],"p_at_touch":h["touch"]}).encode()
        try:
            req=urllib.request.Request(SB+"/rest/v1/rpc/register_level",data=body,headers=SH,method="POST")
            with urllib.request.urlopen(req,timeout=25) as r:
                if json.load(r) is not None: ok+=1
        except Exception as e: pass
    return ok

if __name__=="__main__":
    uni=open(sys.argv[1]).read().split(",")
    look=int(sys.argv[2]) if len(sys.argv)>2 else 300
    hits,nsym,npr=sweep(uni,look)
    kept=push(hits)
    print(f"swept {len(uni)} symbols | {nsym} traded | {npr:,} prints in {look}s")
    print(f"bursts detected {len(hits)} | registered {kept} (rest rejected at-touch or not one-sided)\n")
    hits.sort(key=lambda h:-(h['edge']*h['prints']))
    print(f"  {'sym':<7}{'price':>10}{'side':>5}{'n':>6}{'shrs':>7}{'span':>8}{'$sprd':>8}{'pos':>7}{'edge':>7}{'st':>4}{'tch':>6}")
    for h in hits[:20]:
        print(f"  {h['sym']:<7}{h['px']:>10}{h['side']:>5}{h['prints']:>6}{h['shares']:>7}{h['span']:>8.2f}"
              f"{h['spread']:>8.3f}{h['pos']:>7.3f}{h['edge']:>7.3f}{h['states']:>4}{h['touch']:>5.0f}%")
