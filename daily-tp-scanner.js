// Alpha Quant Analytics - Daily TP% Scanner v3
// FIXES: dedup overlapping windows, dedup results by tpDollar, proper fee handling
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
function R(d,s=200){return new Response(JSON.stringify(d),{status:s,headers:{...C,'Content-Type':'application/json'}});}

export default{async fetch(request){
  if(request.method==='OPTIONS')return new Response('ok',{headers:C});
  try{
    const b=await request.json();
    const{ticker,date,polygon_key,cap_per_level,fee_per_share,supabase_url,supabase_key}=b;
    if(!ticker||!date||!polygon_key)return R({error:'Missing params'},400);
    const cap=cap_per_level||1,fee=fee_per_share||0.005;

    // EST/EDT detection
    const testDate=new Date(date+'T12:00:00Z');
    const utcH=testDate.getUTCHours();
    const etStr=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false}).format(testDate);
    const etOff=utcH-parseInt(etStr);

    // 3-window fetch with overlap + dedup by timestamp
    const pad=n=>String(n).padStart(2,'0');
    const nextDay=new Date(testDate.getTime()+86400000).toISOString().slice(0,10);
    const hPre=4+etOff,hMid=10+etOff,hAft=15+etOff,hEnd=20+etOff;
    const wEnd=hEnd<24?`${date}T${pad(hEnd)}:30:00.000Z`:`${nextDay}T${pad(hEnd-24)}:30:00.000Z`;

    async function fetchWin(gte,lt){
      let trades=[],url=`https://api.polygon.io/v3/trades/${ticker}?timestamp.gte=${gte}&timestamp.lt=${lt}&limit=50000&sort=timestamp&order=asc&apiKey=${polygon_key}`;
      while(url){const r=await fetch(url);if(!r.ok)return trades;const d=await r.json();if(d.results)for(const t of d.results)trades.push({p:t.price,t:t.sip_timestamp||t.participant_timestamp});url=d.next_url?d.next_url+'&apiKey='+polygon_key:null;}
      return trades;
    }

    const w1=await fetchWin(`${date}T${pad(hPre)}:00:00.000Z`,`${date}T${pad(hMid+2)}:00:00.000Z`);
    const w2=await fetchWin(`${date}T${pad(hMid-1)}:00:00.000Z`,`${date}T${pad(hAft+2)}:00:00.000Z`);
    const w3=await fetchWin(`${date}T${pad(hAft-1)}:00:00.000Z`,wEnd);

    // Dedup by timestamp
    const allRaw=[...w1,...w2,...w3];
    allRaw.sort((a,b)=>a.t-b.t);
    const deduped=[];
    let lastTs=-1;
    for(const tr of allRaw){if(tr.t!==lastTs){deduped.push(tr.p);lastTs=tr.t;}}

    const prices=new Float64Array(deduped);
    const N=prices.length;
    if(!N)return R({error:'No trades',ticker,date},404);

    const sp=prices[0],fq=cap/sp,af=fee*fq;
    let mn=Infinity,mx=-Infinity;
    for(let i=0;i<N;i++){if(prices[i]<mn)mn=prices[i];if(prices[i]>mx)mx=prices[i];}
    const ol=Math.floor(sp*100)/100,ps2=Math.round(ol*1.01*100)/100;
    const mc=Math.round(Math.floor(mn*100)),xc=Math.round(Math.ceil(mx*100)),cnt=xc-mc+1;
    const oc=Math.round(ol*100),pc=Math.round(ps2*100);

    // Scan all 100 TP% values
    const rawResults=[];
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
      // tpDollar = actual dollar spread (always whole cents due to Math.ceil)
      let td=Math.round((Math.ceil(sp*(1+tpPct/100)*100)/100-sp)*100)/100;
      if(td<0.01)td=0.01;
      const gpc=fq*td,npc=gpc-af;
      rawResults.push({tpPct,tpDollar:td,cycles:totalCycles,grossPC:gpc,adjFee:af,netPC:npc,
        grossTotal:totalCycles*gpc,netTotal:totalCycles*npc,
        capDeployed:activeLevels*cap,
        roi:activeLevels>0?((totalCycles*npc)/(activeLevels*cap)*100):0,
        activeLevels});
    }

    // Deduplicate by tpDollar: keep the best net profit for each unique cent spread
    const bySpread={};
    for(const r of rawResults){
      const key=r.tpDollar.toFixed(2);
      if(!bySpread[key]||r.netTotal>bySpread[key].netTotal)bySpread[key]=r;
    }
    const results=Object.values(bySpread);
    results.sort((a,b)=>(isNaN(b.netTotal)?-Infinity:b.netTotal)-(isNaN(a.netTotal)?-Infinity:a.netTotal));

    // Save to Supabase if credentials provided
    if(supabase_url&&supabase_key){
      const sh={'Content-Type':'application/json','apikey':supabase_key,'Authorization':'Bearer '+supabase_key,'Prefer':'return=minimal'};
      await fetch(\`\${supabase_url}/rest/v1/cached_daily_optimal_tp?ticker=eq.\${ticker}&trade_date=eq.\${date}&cap_per_level=eq.\${cap}&fee_per_share=eq.\${fee}\`,{method:'DELETE',headers:sh});
      const saveRows=results.map(r=>({ticker,trade_date:date,tp_pct:r.tpPct,tp_dollar:r.tpDollar,cycles:r.cycles,gross_per_cycle:r.grossPC,adj_fee:r.adjFee,net_per_cycle:r.netPC,gross_total:r.grossTotal,net_total:r.netTotal,cap_deployed:r.capDeployed,roi:r.roi,total_trades:N,share_price:sp,cap_per_level:cap,fee_per_share:fee}));
      for(let b2=0;b2<saveRows.length;b2+=200)await fetch(\`\${supabase_url}/rest/v1/cached_daily_optimal_tp\`,{method:'POST',headers:sh,body:JSON.stringify(saveRows.slice(b2,b2+200))});
    }

    return R({status:'processed',ticker,date,total_trades:N,levels:cnt,
      tp_values_scanned:results.length,share_price:sp,results,
      fee_per_cycle:af,
      minTpPct:results.find(r=>r.netPC>0)?.tpPct||0.01});
  }catch(e){return R({error:String(e),stack:e.stack?e.stack.slice(0,200):''},500);}
}};
