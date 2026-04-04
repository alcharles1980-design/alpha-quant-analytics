// Alpha Quant Analytics - Daily TP% Scanner v4
// Service Worker format (no export default)
const C={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
function R(d,s){return new Response(JSON.stringify(d),{status:s||200,headers:Object.assign({},C,{'Content-Type':'application/json'})});}

addEventListener('fetch', function(event){
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request){
  if(request.method==='OPTIONS')return new Response('ok',{headers:C});
  try{
    var b=await request.json();
    var ticker=b.ticker,date=b.date,polygon_key=b.polygon_key;
    var cap=b.cap_per_level||1,fee=b.fee_per_share||0.005;
    var supabase_url=b.supabase_url,supabase_key=b.supabase_key;
    if(!ticker||!date||!polygon_key)return R({error:'Missing params'},400);

    // EST/EDT detection
    var testDate=new Date(date+'T12:00:00Z');
    var utcH=testDate.getUTCHours();
    var etStr=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false}).format(testDate);
    var etOff=utcH-parseInt(etStr);

    // 3-window fetch with overlap + dedup
    function pad(n){return String(n).padStart(2,'0');}
    var nextDay=new Date(testDate.getTime()+86400000).toISOString().slice(0,10);
    var hPre=4+etOff,hMid=10+etOff,hAft=15+etOff,hEnd=20+etOff;
    var wEnd=hEnd<24?date+'T'+pad(hEnd)+':30:00.000Z':nextDay+'T'+pad(hEnd-24)+':30:00.000Z';

    async function fetchWin(gte,lt){
      var trades=[],url='https://api.polygon.io/v3/trades/'+ticker+'?timestamp.gte='+gte+'&timestamp.lt='+lt+'&limit=50000&sort=timestamp&order=asc&apiKey='+polygon_key;
      while(url){var r=await fetch(url);if(!r.ok)return trades;var d=await r.json();if(d.results)for(var i=0;i<d.results.length;i++)trades.push({p:d.results[i].price,s:d.results[i].size||0,t:d.results[i].sip_timestamp||d.results[i].participant_timestamp});url=d.next_url?d.next_url+'&apiKey='+polygon_key:null;}
      return trades;
    }

    var w1=await fetchWin(date+'T'+pad(hPre)+':00:00.000Z',date+'T'+pad(hMid+2)+':00:00.000Z');
    var w2=await fetchWin(date+'T'+pad(hMid-1)+':00:00.000Z',date+'T'+pad(hAft+2)+':00:00.000Z');
    var w3=await fetchWin(date+'T'+pad(hAft-1)+':00:00.000Z',wEnd);

    // Dedup by timestamp - keep both price and timestamp
    var allRaw=w1.concat(w2).concat(w3);
    allRaw.sort(function(a,b){return a.t-b.t;});
    var dedupedP=[];var dedupedT=[];var dedupedS=[];var lastTs=-1;
    for(var i=0;i<allRaw.length;i++){if(allRaw[i].t!==lastTs){dedupedP.push(allRaw[i].p);dedupedT.push(allRaw[i].t);dedupedS.push(allRaw[i].s||0);lastTs=allRaw[i].t;}}

    // Compute hourly stats for integrity checking + seasonality save
    var etFmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',hour12:false});
    var hourlyStats={};for(var h=4;h<20;h++)hourlyStats[h]={trades:0,volume:0,high:-Infinity,low:Infinity};
    for(var i=0;i<dedupedT.length;i++){
      var ts=dedupedT[i];var ms=ts>1e15?ts/1e6:ts>1e12?ts/1e3:ts;
      var eh=parseInt(etFmt.format(new Date(ms)));if(eh===24)eh=0;
      if(hourlyStats[eh]){hourlyStats[eh].trades++;hourlyStats[eh].volume+=dedupedS[i];if(dedupedP[i]>hourlyStats[eh].high)hourlyStats[eh].high=dedupedP[i];if(dedupedP[i]<hourlyStats[eh].low)hourlyStats[eh].low=dedupedP[i];}
    }
    var hoursWithData=0;for(var h=4;h<20;h++){if(hourlyStats[h].trades>0)hoursWithData++;}
    // Compute ATR per hour
    for(var h=4;h<20;h++){var hs=hourlyStats[h];if(hs.trades>0&&hs.high>-Infinity&&hs.low<Infinity){hs.atr=Math.round((hs.high-hs.low)*10000)/10000;hs.atr_pct=hs.low>0?Math.round((hs.atr/hs.low)*10000)/100:0;}else{hs.atr=0;hs.atr_pct=0;hs.high=null;hs.low=null;}}
    var intWarnings=[];
    var rthHours=[9,10,11,12,13,14,15];var rthMissing=[];
    for(var r=0;r<rthHours.length;r++){if(hourlyStats[rthHours[r]].trades===0)rthMissing.push(rthHours[r]);}
    if(rthMissing.length>0)intWarnings.push('MISSING RTH: hours '+rthMissing.join(','));
    if(hoursWithData<8)intWarnings.push('LOW COVERAGE: '+hoursWithData+'/16 hours');
    var rthTotal=0;for(var r=0;r<rthHours.length;r++)rthTotal+=hourlyStats[rthHours[r]].trades;
    if(rthTotal<500)intWarnings.push('LOW RTH: '+rthTotal+' trades');
    if(hourlyStats[9]&&hourlyStats[9].trades===0)intWarnings.push('MARKET OPEN (9AM) HAS 0 TRADES');

    // Save hourly seasonality to cached_seasonality
    if(supabase_url&&supabase_key){
      var sh2={'Content-Type':'application/json','apikey':supabase_key,'Authorization':'Bearer '+supabase_key,'Prefer':'return=minimal'};
      await fetch(supabase_url+'/rest/v1/cached_seasonality?ticker=eq.'+ticker+'&trade_date=eq.'+date,{method:'DELETE',headers:sh2});
      var seasRows=[];for(var h=4;h<20;h++){var hs=hourlyStats[h];seasRows.push({ticker:ticker,trade_date:date,hour:h,high:hs.high,low:hs.low,atr:hs.atr||0,atr_pct:hs.atr_pct||0,volume:Math.round(hs.volume),trades:hs.trades});}
      await fetch(supabase_url+'/rest/v1/cached_seasonality',{method:'POST',headers:sh2,body:JSON.stringify(seasRows)});
    }

    var prices=new Float64Array(dedupedP);
    var N=prices.length;
    if(!N)return R({error:'No trades',ticker:ticker,date:date},404);

    var sp=prices[0],fq=cap/sp,af=fee*fq;
    var mn=Infinity,mx=-Infinity;
    for(var i=0;i<N;i++){if(prices[i]<mn)mn=prices[i];if(prices[i]>mx)mx=prices[i];}
    var ol=Math.floor(sp*100)/100,ps2=Math.round(ol*1.01*100)/100;
    var mc=Math.round(Math.floor(mn*100)),xc=Math.round(Math.ceil(mx*100)),cnt=xc-mc+1;
    var oc=Math.round(ol*100),pc=Math.round(ps2*100);

    var rawResults=[];
    for(var ti=1;ti<=100;ti++){
      var tpPct=ti/100,tf=tpPct/100;
      var act=new Uint8Array(cnt),tgt=new Float64Array(cnt);
      for(var c=0;c<cnt;c++){tgt[c]=Math.ceil((mc+c)/100*(1+tf)*100)/100;act[c]=(mc+c>=oc&&mc+c<=pc)?1:0;}
      var totalCycles=0,activeLevels=0;
      for(var i=1;i<N;i++){
        var p=prices[i];
        for(var j=0;j<cnt;j++){if(act[j]===1&&p>=tgt[j]){act[j]=0;totalCycles++;}}
        var idx=Math.floor(p*100)-mc;
        if(idx>=0&&idx<cnt&&act[idx]===0)act[idx]=1;
      }
      for(var c=0;c<cnt;c++)if(act[c]===1)activeLevels++;
      var td=Math.round((Math.ceil(sp*(1+tpPct/100)*100)/100-sp)*100)/100;
      if(td<0.01)td=0.01;
      var gpc=fq*td,npc=gpc-af;
      rawResults.push({tpPct:tpPct,tpDollar:td,cycles:totalCycles,grossPC:gpc,adjFee:af,netPC:npc,
        grossTotal:totalCycles*gpc,netTotal:totalCycles*npc,
        capDeployed:activeLevels*cap,
        roi:activeLevels>0?((totalCycles*npc)/(activeLevels*cap)*100):0,
        activeLevels:activeLevels});
    }

    // Dedup by tpDollar: keep best net profit per unique cent spread
    var bySpread={};
    for(var i=0;i<rawResults.length;i++){
      var key=rawResults[i].tpDollar.toFixed(2);
      if(!bySpread[key]||rawResults[i].netTotal>bySpread[key].netTotal)bySpread[key]=rawResults[i];
    }
    var results=[];for(var k in bySpread)results.push(bySpread[k]);
    results.sort(function(a,b){return(isNaN(b.netTotal)?-Infinity:b.netTotal)-(isNaN(a.netTotal)?-Infinity:a.netTotal);});

    // Save to Supabase if credentials provided
    if(supabase_url&&supabase_key){
      var sh={'Content-Type':'application/json','apikey':supabase_key,'Authorization':'Bearer '+supabase_key,'Prefer':'return=minimal'};
      await fetch(supabase_url+'/rest/v1/cached_daily_optimal_tp?ticker=eq.'+ticker+'&trade_date=eq.'+date+'&cap_per_level=eq.'+cap+'&fee_per_share=eq.'+fee,{method:'DELETE',headers:sh});
      var saveRows=results.map(function(r){return{ticker:ticker,trade_date:date,tp_pct:r.tpPct,tp_dollar:r.tpDollar,cycles:r.cycles,gross_per_cycle:r.grossPC,adj_fee:r.adjFee,net_per_cycle:r.netPC,gross_total:r.grossTotal,net_total:r.netTotal,cap_deployed:r.capDeployed,roi:r.roi,total_trades:N,share_price:sp,cap_per_level:cap,fee_per_share:fee};});
      for(var b2=0;b2<saveRows.length;b2+=200)await fetch(supabase_url+'/rest/v1/cached_daily_optimal_tp',{method:'POST',headers:sh,body:JSON.stringify(saveRows.slice(b2,b2+200))});
    }

    var minTp=0.01;for(var i=0;i<results.length;i++){if(results[i].netPC>0){minTp=results[i].tpPct;break;}}
    return R({status:'processed',ticker:ticker,date:date,total_trades:N,levels:cnt,
      tp_values_scanned:results.length,share_price:sp,results:results,
      fee_per_cycle:af,minTpPct:minTp,
      hourly_stats:hourlyStats,hours_with_data:hoursWithData,integrity_warnings:intWarnings});
  }catch(e){return R({error:String(e),stack:e.stack?e.stack.substring(0,200):''},500);}
}
