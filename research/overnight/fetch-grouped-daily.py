import json,urllib.request,datetime,pickle,time,sys,os
K=os.environ['PK']
ETF=set('SPY QQQ IWM IVV VOO TQQQ SOXL GLD SQQQ SOXS XLF XLE ARKK EEM HYG TLT SLV VTI DIA EFA LQD XLK SPXL TNA UVXY VXX SMH KWEB FXI TZA SDS QLD SSO IBIT FBTC USO UNG XBI XLV XLI XLU XLP XLY XLC XLB XLRE SCHD JEPI QQQM VUG IJR IJH MDY RSP DXJ EWJ EWZ INDA ITB XHB XRT KRE IYR VNQ AGG BND SHY IEF TIP MUB JNK EMB PFF DVY VYM NOBL MOAT FVD'.split())
TIERS=[10,25,50,100,200,500,1000]
STATE='state.pkl'; OUT='tiers.jsonl'
st={'prev':{},'trail':{}} if not os.path.exists(STATE) else pickle.load(open(STATE,'rb'))
prev=st['prev']; trail=st['trail']
a=datetime.date.fromisoformat(sys.argv[1]); b=datetime.date.fromisoformat(sys.argv[2])
f=open(OUT,'a'); d=a; nd=0
while d<=b:
    if d.weekday()<5:
        got=None
        for k in range(5):
            try:
                with urllib.request.urlopen(f"https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/{d}?adjusted=true&apiKey={K}",timeout=30) as r:
                    got=json.load(r).get("results") or []
                break
            except Exception: time.sleep(2*(k+1))
        if got:
            nd+=1; rows=[]
            for x in got:
                t=x.get("T"); o=x.get("o"); c=x.get("c"); v=x.get("v")
                if not t or not o or not c or not v or c<3.0: continue
                dv=c*v; tr=trail.get(t); rank=None
                if tr and len(tr)>=20:
                    s=sorted(tr); rank=s[len(s)//2]
                pc=prev.get(t)
                if pc and pc>0 and rank: rows.append((t,(o-pc)/pc*100,rank))
                if tr is None: trail[t]=[]
                trail[t].append(dv)
                if len(trail[t])>20: trail[t].pop(0)
                prev[t]=c
            if rows:
                rows.sort(key=lambda r:-r[2])
                rec={'date':d.isoformat()}
                stk=[r for r in rows if r[0] not in ETF]
                for N in TIERS:
                    if len(rows)>=max(3,N//2): rec['all%d'%N]=round(sum(r[1] for r in rows[:N])/len(rows[:N]),6)
                    if len(stk)>=max(3,N//2): rec['stk%d'%N]=round(sum(r[1] for r in stk[:N])/len(stk[:N]),6)
                etf=[r for r in rows if r[0] in ETF][:5]
                if len(etf)>=3: rec['etf5']=round(sum(r[1] for r in etf)/len(etf),6)
                f.write(json.dumps(rec)+'\n')
        time.sleep(0.25)
    d+=datetime.timedelta(days=1)
f.close()
pickle.dump({'prev':prev,'trail':trail},open(STATE,'wb'))
print(f"chunk {sys.argv[1]}..{sys.argv[2]}: {nd} sessions, total lines now {sum(1 for _ in open(OUT))}")
