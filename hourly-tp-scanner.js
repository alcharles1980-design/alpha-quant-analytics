// Alpha Quant Analytics - Hourly TP% Scanner (Cloudflare Worker)
// Stage 2: Scans 100 TP% x 16 hours, saves to optimal_tp_hourly
// Handles heavy stocks (NVDA 1-5M+ ticks/day) via subsampling
// Service Worker format (addEventListener)
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
function R(d,s){return new Response(JSON.stringify(d),{status:s||200,headers:Object.assign({},CORS,{'Content-Type':'application/json'})});}

addEventListener('fetch', function(event){
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request){
  if(request.method==='OPTIONS')return new Response('ok',{headers:CORS});
  try{
    var b=await request.json();
    var ticker=b.ticker,date=b.date,polygon_key=b.polygon_key;
    var cap=b.cap_per_level||1,fee=b.fee_per_share||0.005;
    var supabase_url=b.supabase_url,supabase_key=b.supabase_key;
    var maxTicks=b.max_ticks||2000000; // subsample threshold
    if(!ticker||!date||!polygon_key)return R({error:'Missing ticker, date, or polygon_key'},400);

    // EST/EDT detection
    var testDate=new Date(date+'T12:00:00Z');
    var utcH=testDate.getUTCHours();
    var etStr=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false}).format(testDate);
    var etOff=utcH-parseInt(etStr);

    function pad(n){return String(n).padStart(2,'0');}
    var nextDay=new Date(testDate.getTime()+86400000).toISOString().slice(0,10);
    var hPre=4+etOff,hMid=10+etOff,hAft=15+etOff,hEnd=20+etOff;
    var wEnd=hEnd<24?date+'T'+pad(hEnd)+':30:00.000Z':nextDay+'T'+pad(hEnd-24)+':30:00.000Z';

    // Fetch ticks from Polygon in 3 windows (same pattern as daily-tp-scanner)
    async function fetchWin(gte,lt){
      var trades=[],url='https://api.polygon.io/v3/trades/'+ticker+'?timestamp.gte='+gte+'&timestamp.lt='+lt+'&limit=50000&sort=timestamp&order=asc&apiKey='+polygon_key;
      while(url){var r=await fetch(url);if(!r.ok)return trades;var d=await r.json();if(d.results)for(var i=0;i<d.results.length;i++)trades.push({p:d.results[i].price,t:d.results[i].sip_timestamp||d.results[i].participant_timestamp});url=d.next_url?d.next_url+'&apiKey='+polygon_key:null;}
      return trades;
    }

    var w1=await fetchWin(date+'T'+pad(hPre)+':00:00.000Z',date+'T'+pad(hMid+2)+':00:00.000Z');
    var w2=await fetchWin(date+'T'+pad(hMid-1)+':00:00.000Z',date+'T'+pad(hAft+2)+':00:00.000Z');
    var w3=await fetchWin(date+'T'+pad(hAft-1)+':00:00.000Z',wEnd);

    // Dedup + sort
    var allRaw=w1.concat(w2).concat(w3);
    allRaw.sort(function(a,b){return a.t-b.t;});
    var deduped=[];var lastTs=-1;
    for(var i=0;i<allRaw.length;i++){if(allRaw[i].t!==lastTs){deduped.push(allRaw[i]);lastTs=allRaw[i].t;}}

    var originalCount=deduped.length;

    // Subsample if above threshold (preserve first, last, and every Nth)
    if(deduped.length>maxTicks){
      var step=Math.ceil(deduped.length/maxTicks);
      var sampled=[deduped[0]];
      for(var i=step;i<deduped.length-1;i+=step)sampled.push(deduped[i]);
      sampled.push(deduped[deduped.length-1]);
      deduped=sampled;
    }

    var N=deduped.length;
    if(!N)return R({error:'No trades',ticker:ticker,date:date},404);

    // Build typed arrays for performance
    var prices=new Float64Array(N);
    var hours=new Int8Array(N);
    var etFmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false});
    for(var i=0;i<N;i++){
      prices[i]=deduped[i].p;
      hours[i]=parseInt(etFmt.format(new Date(deduped[i].t/1e6)))||0;
    }
    deduped=null; // free memory

    var sp=prices[0],fq=cap/sp,af=fee*fq;
    var mn=Infinity,mx=-Infinity;
    for(var i=0;i<N;i++){if(prices[i]<mn)mn=prices[i];if(prices[i]>mx)mx=prices[i];}
    var ol=Math.floor(sp*100)/100,ps2=Math.round(ol*1.01*100)/100;
    var mc=Math.round(Math.floor(mn*100)),xc=Math.round(Math.ceil(mx*100)),cnt=xc-mc+1;
    var oc=Math.round(ol*100),pc=Math.round(ps2*100);

    // Scan 100 TP% values, tracking hourly attribution
    var allRows=[];
    for(var ti=1;ti<=100;ti++){
      var tpPct=ti/100,tf=tpPct/100;
      var act=new Uint8Array(cnt),tgt=new Float64Array(cnt);
      for(var c=0;c<cnt;c++){tgt[c]=Math.ceil((mc+c)/100*(1+tf)*100)/100;act[c]=(mc+c>=oc&&mc+c<=pc)?1:0;}

      // Hourly tracking: cycles and net profit per hour
      var hCycles=new Int32Array(24);
      var hProfit=new Float64Array(24);
      var td=Math.round((Math.ceil(sp*(1+tpPct/100)*100)/100-sp)*100)/100;
      if(td<0.01)td=0.01;
      var gpc=fq*td,npc=gpc-af;

      for(var i=1;i<N;i++){
        var p=prices[i];
        var h=hours[i];
        // Check sells
        for(var j=0;j<cnt;j++){
          if(act[j]===1&&p>=tgt[j]){act[j]=0;hCycles[h]++;hProfit[h]+=npc;}
        }
        // Check buys
        var idx=Math.floor(p*100)-mc;
        if(idx>=0&&idx<cnt&&act[idx]===0)act[idx]=1;
      }

      // Build rows for hours 4-19
      for(var h=4;h<20;h++){
        if(hCycles[h]>0||true){ // always include even 0-cycle hours
          allRows.push({
            ticker:ticker,trade_date:date,hour:h,tp_pct:tpPct,
            cycles:hCycles[h],net_profit:Math.round(hProfit[h]*100)/100,
            tp_dollar:td,gross_per_cycle:Math.round(gpc*10000)/10000,
            fee_per_cycle:Math.round(af*10000)/10000,net_per_cycle:Math.round(npc*10000)/10000
          });
        }
      }
    }

    // Save to Supabase
    var saved=0;
    if(supabase_url&&supabase_key){
      var sh={'Content-Type':'application/json','apikey':supabase_key,'Authorization':'Bearer '+supabase_key,'Prefer':'return=minimal'};
      // Delete existing
      await fetch(supabase_url+'/rest/v1/optimal_tp_hourly?ticker=eq.'+ticker+'&trade_date=eq.'+date,{method:'DELETE',headers:sh});
      // Insert in batches
      for(var b2=0;b2<allRows.length;b2+=200){
        var batch=allRows.slice(b2,b2+200);
        var sr=await fetch(supabase_url+'/rest/v1/optimal_tp_hourly',{method:'POST',headers:sh,body:JSON.stringify(batch)});
        if(sr.ok)saved+=batch.length;
      }
    }

    return R({
      status:'processed',ticker:ticker,date:date,
      original_ticks:originalCount,processed_ticks:N,
      subsampled:originalCount>maxTicks,
      levels:cnt,tp_values_scanned:100,hours_scanned:16,
      total_rows:allRows.length,saved:saved,
      share_price:sp,best_tp:allRows.length>0?allRows.reduce(function(a,b){return a.net_profit>b.net_profit?a:b;}).tp_pct:null
    });
  }catch(e){return R({error:String(e),stack:e.stack?e.stack.substring(0,300):''},500);}
}
