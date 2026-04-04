// Alpha Quant Analytics - Daily TP% Scanner
// Server-side: runs 100 TP% iterations on Cloudflare Workers (300s CPU limit)
// Same typed-array engine as analyzePriceLevels
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
function R(d,s=200){return new Response(JSON.stringify(d),{status:s,headers:{...C,'Content-Type':'application/json'}});}

export default{async fetch(request){
  if(request.method==='OPTIONS')return new Response('ok',{headers:C});
  try{
    const b=await request.json();
    const{ticker,date,polygon_key,cap_per_level,fee_per_share}=b;
    if(!ticker||!date||!polygon_key)return R({error:'Missing params'},400);
    const cap=cap_per_level||1,fee=fee_per_share||0.005;

    // EST/EDT detection using Intl API
    const testDate=new Date(date+'T12:00:00Z');
    const utcH=testDate.getUTCHours();
    const etStr=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false}).format(testDate);
    const etOff=utcH-parseInt(etStr);

    // 3-window fetch with EST/EDT-aware boundaries
    const pad=n=>String(n).padStart(2,'0');
    const nextDay=new Date(testDate.getTime()+86400000).toISOString().slice(0,10);
    const hPre=4+etOff,hMid=10+etOff,hAft=15+etOff,hEnd=20+etOff;
    const wEnd=hEnd<24?`${date}T${pad(hEnd)}:30:00.000Z`:`${nextDay}T${pad(hEnd-24)}:30:00.000Z`;

    async function fetchWin(gte,lt){
      let trades=[],url=`https://api.polygon.io/v3/trades/${ticker}?timestamp.gte=${gte}&timestamp.lt=${lt}&limit=50000&sort=timestamp&order=asc&apiKey=${polygon_key}`;
      while(url){const r=await fetch(url);if(!r.ok)return trades;const d=await r.json();if(d.results)for(const t of d.results)trades.push(t.price);url=d.next_url?d.next_url+'&apiKey='+polygon_key:null;}
      return trades;
    }

    const w1=await fetchWin(`${date}T${pad(hPre)}:00:00.000Z`,`${date}T${pad(hMid+2)}:00:00.000Z`);
    const w2=await fetchWin(`${date}T${pad(hMid-1)}:00:00.000Z`,`${date}T${pad(hAft+2)}:00:00.000Z`);
    const w3=await fetchWin(`${date}T${pad(hAft-1)}:00:00.000Z`,wEnd);
    // Note: for daily scanner we only need prices, not timestamps, so dedup by value not needed
    // Just concat and sort isn't needed either since analyzePriceLevels processes sequentially
    // But we DO need proper ordering, so we keep the window order
    const prices=new Float64Array([...w1,...w2,...w3]);
    const N=prices.length;
    if(!N)return R({error:'No trades',ticker,date},404);

    const sp=prices[0],fq=cap/sp,af=fee*fq;
    let mn=Infinity,mx=-Infinity;
    for(let i=0;i<N;i++){if(prices[i]<mn)mn=prices[i];if(prices[i]>mx)mx=prices[i];}
    const ol=Math.floor(sp*100)/100,ps2=Math.round(ol*1.01*100)/100;
    const mc=Math.round(Math.floor(mn*100)),xc=Math.round(Math.ceil(mx*100)),cnt=xc-mc+1;
    const oc=Math.round(ol*100),pc=Math.round(ps2*100);

    const results=[];
    for(let ti=1;ti<=100;ti++){
      const tpPct=ti/100,tf=tpPct/100;
      const act=new Uint8Array(cnt),tgt=new Float64Array(cnt);
      for(let c=0;c<cnt;c++){tgt[c]=Math.ceil((mc+c)/100*(1+tf)*100)/100;act[c]=(mc+c>=oc&&mc+c<=pc)?1:0;}
      let totalCycles=0,activeLevels=0;
      for(let i=1;i<N;i++){
        const p=prices[i];
        for(let j=0;j<cnt;j++){if(act[j]===1&&p>=tgt[j]){act[j]=0;totalCycles++;}}
        const idx=Math.floor(p*100)-mc;
        if(idx>=0&&idx<cnt&&act[idx]===0)act[idx]=1;
      }
      for(let c=0;c<cnt;c++)if(act[c]===1)activeLevels++;
      let td=Math.round((Math.ceil(sp*(1+tpPct/100)*100)/100-sp)*100)/100;
      if(td<0.01)td=0.01;
      const gpc=fq*td,npc=gpc-af;
      results.push({tpPct,tpDollar:td,cycles:totalCycles,grossPC:gpc,adjFee:af,netPC:npc,
        grossTotal:totalCycles*gpc,netTotal:totalCycles*npc,
        capDeployed:activeLevels*cap,
        roi:activeLevels>0?((totalCycles*npc)/(activeLevels*cap)*100):0});
    }
    results.sort((a,b)=>(isNaN(b.netTotal)?-Infinity:b.netTotal)-(isNaN(a.netTotal)?-Infinity:a.netTotal));

    return R({status:'processed',ticker,date,total_trades:N,levels:cnt,
      tp_values_scanned:100,share_price:sp,results,
      minTpPct:results.find(r=>r.netPC>0)?.tpPct||0.01});
  }catch(e){return R({error:String(e),stack:e.stack?e.stack.slice(0,200):''},500);}
}};
