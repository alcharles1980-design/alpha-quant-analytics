const{useState,useEffect,useRef}=React;
var RC=typeof Recharts!=="undefined"?Recharts:{};
var C={bg:"#060a10",bgCard:"#0c1219",bgInput:"#0a0f16",border:"#1a2538",accent:"#00e5a0",accentDim:"#00e5a020",warn:"#ff5c3a",warnDim:"#ff5c3a20",blue:"#3d9eff",blueDim:"#3d9eff20",purple:"#9d5cff",gold:"#ffb020",goldDim:"#ffb02020",txt:"#d0dce8",txtDim:"#7088a0",txtBright:"#f0f6fc",grid:"#141e2e"};
var F="'JetBrains Mono',monospace";
var hourLabels={'4':'4AM','5':'5AM','6':'6AM','7':'7AM','8':'8AM','9':'9AM','10':'10AM','11':'11AM','12':'12PM','13':'1PM','14':'2PM','15':'3PM','16':'4PM','17':'5PM','18':'6PM','19':'7PM'};

var SB_URL='https://haeqzegdlwryvaecanrn.supabase.co';
var SB_URL_DEFAULT=SB_URL;
var SB_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhZXF6ZWdkbHdyeXZhZWNhbnJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MTYxODAsImV4cCI6MjA5MDI5MjE4MH0.j3E_EZsiS4VmNjmXA90kKxL_DgPOV0Ku_DKwMDqGjgw';
var SB_KEY_DEFAULT=SB_KEY;
function getSbHeaders(){return{'Content-Type':'application/json','apikey':SB_KEY,'Authorization':'Bearer '+SB_KEY,'Prefer':'return=representation'};}

var SB={
  // Check if analysis is cached
  loadAnalysis:async function(ticker,date,tpPct,session){
    if(!SB_URL||!SB_KEY)return null;
    try{
      var r=await fetch(SB_URL+'/rest/v1/cached_analyses?ticker=eq.'+ticker+'&trade_date=eq.'+date+'&tp_pct=eq.'+tpPct+'&session_type=eq.'+session+'&select=*',{headers:getSbHeaders()});
      if(!r.ok)return null;var d=await r.json();if(!d.length)return null;
      var a=d[0];
      // Load levels
      var r2=await fetch(SB_URL+'/rest/v1/cached_levels?analysis_id=eq.'+a.id+'&select=level_price,target_price,cycles&order=cycles.desc',{headers:getSbHeaders()});
      var levels=r2.ok?await r2.json():[];
      return{analysis:a,levels:levels};
    }catch(e){console.error('SB load error:',e);return null;}
  },
  // Save analysis results
  saveAnalysis:async function(ticker,date,tpPct,session,summary,levels,ohlc,tickMin,tickMax,openPrice,preSeedMax){
    if(!SB_URL||!SB_KEY)return;
    try{
      var body={ticker:ticker,trade_date:date,tp_pct:tpPct,session_type:session,total_cycles:summary.totalCycles,active_levels:summary.activeLevels,total_levels:summary.totalLevels,total_trades:summary.totalTrades||0,tick_min:tickMin,tick_max:tickMax,open_price:openPrice,pre_seed_max:preSeedMax,ohlc_open:ohlc?ohlc.open:null,ohlc_high:ohlc?ohlc.high:null,ohlc_low:ohlc?ohlc.low:null,ohlc_close:ohlc?ohlc.close:null,ohlc_volume:ohlc?Math.round(ohlc.volume):null};
      // Check if exists
      var chk=await fetch(SB_URL+'/rest/v1/cached_analyses?ticker=eq.'+ticker+'&trade_date=eq.'+date+'&tp_pct=eq.'+tpPct+'&session_type=eq.'+session+'&select=id',{headers:getSbHeaders()});
      var existing=chk.ok?await chk.json():[];
      var savedId;
      if(existing.length>0){
        // Update
        savedId=existing[0].id;
        await fetch(SB_URL+'/rest/v1/cached_analyses?id=eq.'+savedId,{method:'PATCH',headers:getSbHeaders(),body:JSON.stringify(body)});
      }else{
        // Insert
        var r=await fetch(SB_URL+'/rest/v1/cached_analyses',{method:'POST',headers:Object.assign({},getSbHeaders(),{'Prefer':'return=representation'}),body:JSON.stringify(body)});
        if(!r.ok){console.error('SB save error:',r.status,await r.text());return;}
        var saved=await r.json();savedId=saved[0].id;
      }
      // Delete old levels then insert new
      await fetch(SB_URL+'/rest/v1/cached_levels?analysis_id=eq.'+savedId,{method:'DELETE',headers:getSbHeaders()});
      var lvlRows=levels.filter(function(l){return l.cycles>0;}).map(function(l){return{analysis_id:savedId,level_price:l.price,target_price:l.target,cycles:l.cycles};});
      if(lvlRows.length>0){
        for(var i=0;i<lvlRows.length;i+=100){
          await fetch(SB_URL+'/rest/v1/cached_levels',{method:'POST',headers:getSbHeaders(),body:JSON.stringify(lvlRows.slice(i,i+100))});
        }
      }
    }catch(e){console.error('SB save error:',e);}
  },
  // Check if seasonality is cached
  loadHourlyCycles:async function(ticker,date,tpPct,session){
    if(!SB_URL||!SB_KEY)return null;
    try{
      var r=await fetch(SB_URL+'/rest/v1/cached_hourly_cycles?ticker=eq.'+ticker+'&trade_date=eq.'+date+'&tp_pct=eq.'+tpPct+'&session_type=eq.'+session+'&select=hour,cycles&order=hour.asc',{headers:getSbHeaders()});
      if(!r.ok)return null;var d=await r.json();if(!d.length)return null;
      var labels={'4':'4AM','5':'5AM','6':'6AM','7':'7AM','8':'8AM','9':'9AM','10':'10AM','11':'11AM','12':'12PM','13':'1PM','14':'2PM','15':'3PM','16':'4PM','17':'5PM','18':'6PM','19':'7PM'};
      return d.map(function(row){return{hour:labels[String(row.hour)]||String(row.hour),cycles:row.cycles,isRTH:(row.hour>=9&&row.hour<16)?1:0};});
    }catch(e){return null;}
  },
  loadSeasonality:async function(ticker,date){
    if(!SB_URL||!SB_KEY)return null;
    try{
      var r=await fetch(SB_URL+'/rest/v1/cached_seasonality?ticker=eq.'+ticker+'&trade_date=eq.'+date+'&select=*&order=hour.asc',{headers:getSbHeaders()});
      if(!r.ok)return null;var d=await r.json();if(!d.length)return null;
      var r2=await fetch(SB_URL+'/rest/v1/cached_sessions?ticker=eq.'+ticker+'&trade_date=eq.'+date+'&select=*',{headers:getSbHeaders()});
      var sessions=r2.ok?await r2.json():[];
      return{hourly:d,sessions:sessions};
    }catch(e){console.error('SB load seasonality error:',e);return null;}
  },
  // Save seasonality data
  saveHourlyCycles:async function(ticker,date,tpPct,session,hourlyCyclesData){
    if(!SB_URL||!SB_KEY)return;
    try{
      await fetch(SB_URL+'/rest/v1/cached_hourly_cycles?ticker=eq.'+ticker+'&trade_date=eq.'+date+'&tp_pct=eq.'+tpPct+'&session_type=eq.'+session,{method:'DELETE',headers:getSbHeaders()});
      var rows=hourlyCyclesData.map(function(d,i){return{ticker:ticker,trade_date:date,hour:i+4,tp_pct:tpPct,session_type:session,cycles:d.cycles};});
      await fetch(SB_URL+'/rest/v1/cached_hourly_cycles',{method:'POST',headers:getSbHeaders(),body:JSON.stringify(rows)});
    }catch(e){console.error('SB save hourly cycles error:',e);}
  },
  loadOptimalTP:async function(ticker,date){
    if(!SB_URL||!SB_KEY)return null;
    try{
      var baseUrl=SB_URL+'/rest/v1/optimal_tp_hourly?ticker=eq.'+ticker+'&trade_date=eq.'+date+'&select=hour,tp_pct,cycles,tp_dollar,net_profit&order=hour.asc,tp_pct.asc&limit=1000';
      var r1=await fetch(baseUrl+'&offset=0',{headers:getSbHeaders()});
      if(!r1.ok)return null;var d1=await r1.json();if(!d1.length)return null;
      if(d1.length>=1000){var r2=await fetch(baseUrl+'&offset=1000',{headers:getSbHeaders()});if(r2.ok){var d2=await r2.json();for(var i=0;i<d2.length;i++)d1.push(d2[i]);}}
      return d1;
    }catch(e){return null;}
  },
  loadOptimalTPRange:async function(ticker,startDate,endDate){
    if(!SB_URL||!SB_KEY)return null;
    try{
      // Load day by day, paginated (Supabase caps at 1000 rows, each day has 1600)
      var allRows=[];
      var d=new Date(startDate+'T12:00:00Z');var e=new Date(endDate+'T12:00:00Z');
      while(d<=e){
        var dow=d.getUTCDay();
        if(dow!==0&&dow!==6){
          var dt=d.toISOString().slice(0,10);
          var baseUrl=SB_URL+'/rest/v1/optimal_tp_hourly?ticker=eq.'+ticker+'&trade_date=eq.'+dt+'&select=hour,tp_pct,cycles,tp_dollar,net_profit&order=hour.asc,tp_pct.asc&limit=1000';
          var r1=await fetch(baseUrl+'&offset=0',{headers:getSbHeaders()});
          if(r1.ok){var rows1=await r1.json();for(var i=0;i<rows1.length;i++)allRows.push(rows1[i]);
            if(rows1.length>=1000){var r2=await fetch(baseUrl+'&offset=1000',{headers:getSbHeaders()});if(r2.ok){var rows2=await r2.json();for(var j=0;j<rows2.length;j++)allRows.push(rows2[j]);}}}
        }
        d.setUTCDate(d.getUTCDate()+1);
      }
      return allRows.length?allRows:null;
    }catch(e){return null;}
  },
  saveOptimalTP:async function(ticker,date,session,matrix,sharePrice){
    if(!SB_URL||!SB_KEY)return;
    try{
      await fetch(SB_URL+'/rest/v1/optimal_tp_hourly?ticker=eq.'+ticker+'&trade_date=eq.'+date+'&session_type=eq.'+session,{method:'DELETE',headers:getSbHeaders()});
      var rows=[];
      for(var h=4;h<20;h++){
        var arr=matrix[h];
        for(var i=0;i<arr.length;i++){
          rows.push({ticker:ticker,trade_date:date,hour:h,tp_pct:arr[i].tpPct,session_type:session,cycles:arr[i].cycles,tp_dollar:arr[i].tpDollar,net_profit:Math.round(arr[i].netProfit*10000)/10000});
        }
      }
      // Insert in batches
      for(var b=0;b<rows.length;b+=500){
        await fetch(SB_URL+'/rest/v1/optimal_tp_hourly',{method:'POST',headers:getSbHeaders(),body:JSON.stringify(rows.slice(b,b+500))});
      }
    }catch(e){console.error('SB save optimal error:',e);}
  },
  saveHourlyFeatures:async function(ticker,date,rows){
    if(!SB_URL||!SB_KEY)return;
    try{
      await fetch(SB_URL+'/rest/v1/hourly_features?ticker=eq.'+ticker+'&trade_date=eq.'+date,{method:'DELETE',headers:getSbHeaders()});
      await fetch(SB_URL+'/rest/v1/hourly_features',{method:'POST',headers:getSbHeaders(),body:JSON.stringify(rows)});
    }catch(e){console.error('SB save hourly features error:',e);}
  },
  saveSeasonality:async function(ticker,date,chartData,sessions){
    if(!SB_URL||!SB_KEY)return;
    try{
      // Delete existing then insert fresh
      await fetch(SB_URL+'/rest/v1/cached_seasonality?ticker=eq.'+ticker+'&trade_date=eq.'+date,{method:'DELETE',headers:getSbHeaders()});
      var hourlyRows=chartData.map(function(d,i){return{ticker:ticker,trade_date:date,hour:i+4,high:d.high||null,low:d.low||null,atr:d.atr,atr_pct:d.atrPct,volume:Math.round(d.volume),trades:d.trades};});
      await fetch(SB_URL+'/rest/v1/cached_seasonality',{method:'POST',headers:getSbHeaders(),body:JSON.stringify(hourlyRows)});
      // Delete existing sessions then insert
      await fetch(SB_URL+'/rest/v1/cached_sessions?ticker=eq.'+ticker+'&trade_date=eq.'+date,{method:'DELETE',headers:getSbHeaders()});
      var sessTypes=[{key:'pre',data:sessions.pre},{key:'reg',data:sessions.reg},{key:'post',data:sessions.post}];
      var sessRows=sessTypes.map(function(s){var rng=(s.data.max>-Infinity&&s.data.min<Infinity)?(s.data.max-s.data.min):0;var pct=(s.data.min<Infinity&&s.data.min>0&&rng>0)?((rng/s.data.min)*100):0;return{ticker:ticker,trade_date:date,session_type:s.key,high:s.data.max>-Infinity?s.data.max:null,low:s.data.min<Infinity?s.data.min:null,range_dollars:rng>0?rng:null,range_pct:pct>0?pct:null,volume:Math.round(s.data.vol),trades:s.data.trades};});
      await fetch(SB_URL+'/rest/v1/cached_sessions',{method:'POST',headers:getSbHeaders(),body:JSON.stringify(sessRows)});
    }catch(e){console.error('SB save seasonality error:',e);}
  }
};

function analyzePriceLevels(trades,tpPct){
  if(!trades.length)return{levels:[],summary:{}};
  var tf=tpPct/100;
  var minP=Infinity,maxP=-Infinity;
  for(var z=0;z<trades.length;z++){if(trades[z].price<minP)minP=trades[z].price;if(trades[z].price>maxP)maxP=trades[z].price;}
  var minLvl=Math.floor(minP*100)/100,maxLvl=Math.ceil(maxP*100)/100;
  var openLvl=Math.floor(trades[0].price*100)/100;
  var preSeedMax=Math.round(openLvl*1.01*100)/100;
  // Typed arrays for performance with large datasets
  var minCents=Math.round(minLvl*100),maxCents=Math.round(maxLvl*100);
  var count=maxCents-minCents+1;
  var lvlActive=new Uint8Array(count);
  var lvlCycles=new Int32Array(count);
  var lvlTarget=new Float64Array(count);
  var lvlPrice=new Float64Array(count);
  var openCents=Math.round(openLvl*100);
  var preSeedMaxCents=Math.round(preSeedMax*100);
  for(var c=0;c<count;c++){
    var cents=minCents+c;
    lvlPrice[c]=cents/100;
    lvlTarget[c]=Math.ceil(lvlPrice[c]*(1+tf)*100)/100;
    lvlActive[c]=(cents>=openCents&&cents<=preSeedMaxCents)?1:0;
  }
  for(var i=1;i<trades.length;i++){
    var p=trades[i].price;
    // SELL first: check active levels where tick >= target
    for(var j=0;j<count;j++){
      if(lvlActive[j]===1&&p>=lvlTarget[j]){
        lvlCycles[j]++;
        lvlActive[j]=0;
      }
    }
    // BUY second: activate inactive level where tick is at that level
    var idx=Math.floor(p*100)-minCents;
    if(idx>=0&&idx<count&&lvlActive[idx]===0){
      lvlActive[idx]=1;
    }
  }
  // Build output
  var arr=[];
  for(var c=0;c<count;c++){
    arr.push({price:lvlPrice[c],target:lvlTarget[c],active:lvlActive[c]===1,cycles:lvlCycles[c]});
  }
  arr.sort(function(a,b){return b.cycles-a.cycles;});
  var active=arr.filter(function(l){return l.cycles>0;});
  return{levels:arr,summary:{totalLevels:arr.length,activeLevels:active.length,totalCycles:active.reduce(function(a,b){return a+b.cycles;},0),tpPct:tpPct}};
}

function computeHourlyCycles(trades,tpPct){
  if(!trades||trades.length<2)return[];
  var tf=tpPct/100;
  var minP=Infinity,maxP=-Infinity;
  for(var i=0;i<trades.length;i++){if(trades[i].price<minP)minP=trades[i].price;if(trades[i].price>maxP)maxP=trades[i].price;}
  var minLvl=Math.floor(minP*100)/100,maxLvl=Math.ceil(maxP*100)/100;
  var openLvl=Math.floor(trades[0].price*100)/100;
  var preSeedMax=Math.round(openLvl*1.01*100)/100;
  var minC=Math.round(minLvl*100),maxC=Math.round(maxLvl*100),cnt=maxC-minC+1;
  var openC=Math.round(openLvl*100),psC=Math.round(preSeedMax*100);
  var active=new Uint8Array(cnt),target=new Float64Array(cnt);
  for(var c=0;c<cnt;c++){target[c]=Math.ceil((minC+c)/100*(1+tf)*100)/100;active[c]=(minC+c>=openC&&minC+c<=psC)?1:0;}
  var hourCycles={};for(var h=4;h<20;h++)hourCycles[h]=0;
  var toHour=function(ts){var ms;if(ts>1e15)ms=ts/1e6;else if(ts>1e12)ms=ts/1e3;else ms=ts;var d=new Date(ms);var h2=d.getUTCHours()-4;if(h2<0)h2+=24;return h2;};
  for(var i=1;i<trades.length;i++){
    var p=trades[i].price;var hr=toHour(trades[i].ts);
    for(var j=0;j<cnt;j++){if(active[j]===1&&p>=target[j]){active[j]=0;if(hourCycles[hr]!==undefined)hourCycles[hr]++;}}
    var idx=Math.floor(p*100)-minC;if(idx>=0&&idx<cnt&&active[idx]===0)active[idx]=1;
  }
  var labels={'4':'4AM','5':'5AM','6':'6AM','7':'7AM','8':'8AM','9':'9AM','10':'10AM','11':'11AM','12':'12PM','13':'1PM','14':'2PM','15':'3PM','16':'4PM','17':'5PM','18':'6PM','19':'7PM'};
  var result=[];for(var h=4;h<20;h++){result.push({hour:labels[String(h)],cycles:hourCycles[h],isRTH:(h>=9&&h<16)?1:0});}
  return result;
}

function scanOptimalTP(trades,capPerLevel,feePerShare){
  if(!trades||trades.length<2)return{results:[],minTpPct:0,maxTpPct:0,sharePrice:0};
  var sharePrice=trades[0].price;
  var fracQty=sharePrice>0?(capPerLevel/sharePrice):0;
  var adjFee=feePerShare*fracQty;
  // Minimum viable TP%: target must be at least $0.01 above level
  // For a price P: P*(1+tp/100) must round to at least P+0.01
  // Minimum tp% = (0.01/P)*100, rounded up to next 0.01%
  // Minimum viable TP%: need target to be at least $0.02 above level
  // to ensure meaningful profit above fees
  var minTpRaw=(0.02/sharePrice)*100;
  var minTpInt=Math.ceil(minTpRaw*100);
  if(minTpInt<5)minTpInt=5;// floor at 0.05%
  var results=[];
  for(var tpInt=minTpInt;tpInt<=100;tpInt++){
    var tpPct=tpInt/100;
    var res=analyzePriceLevels(trades,tpPct);
    var tpDollar=Math.round((Math.ceil(sharePrice*(1+tpPct/100)*100)/100-sharePrice)*100)/100;
    if(tpDollar<0.01)tpDollar=0.01;
    var grossPC=fracQty*tpDollar;
    var netPC=grossPC-adjFee;
    var totalCy=res.summary.totalCycles||0;
    var grossTotal=totalCy*grossPC;
    var netTotal=totalCy*netPC;
    if(isNaN(netTotal))netTotal=0;if(isNaN(grossTotal))grossTotal=0;
    var activeLvls=res.summary.activeLevels||0;
    var capDeployed=activeLvls*capPerLevel;
    var roi=capDeployed>0?((netTotal/capDeployed)*100):0;
    if(isNaN(roi))roi=0;
    results.push({tpPct:tpPct,tpDollar:tpDollar,cycles:totalCy,activeLevels:activeLvls,grossPC:grossPC,adjFee:adjFee,netPC:netPC,grossTotal:grossTotal,netTotal:netTotal,capDeployed:capDeployed,roi:roi});
  }
  results.sort(function(a,b){var an=isNaN(a.netTotal)?-Infinity:a.netTotal;var bn=isNaN(b.netTotal)?-Infinity:b.netTotal;return bn-an;});
  return{results:results,minTpPct:minTpInt/100,maxTpPct:1.00,sharePrice:sharePrice,scanned:results.length};
}

function scanHourlyOptimalTP(trades,capPerLevel,feePerShare){
  if(!trades||trades.length<2)return null;
  var sharePrice=trades[0].price;
  var fracQty=sharePrice>0?(capPerLevel/sharePrice):0;
  var adjFee=feePerShare*fracQty;
  // Matrix: hourly[hour][tpIdx] = {cycles, tpPct, tpDollar, netProfit}
  var hourlyMatrix={};
  for(var h=4;h<20;h++)hourlyMatrix[h]=[];
  var bestPerHour={};
  for(var tpInt=1;tpInt<=100;tpInt++){
    var tpPct=tpInt/100;
    var hc=computeHourlyCycles(trades,tpPct);
    var tpDollar=Math.round((Math.ceil(sharePrice*(1+tpPct/100)*100)/100-sharePrice)*100)/100;
    if(tpDollar<0.01)tpDollar=0.01;
    var grossPC=fracQty*tpDollar;
    var netPC=grossPC-adjFee;
    for(var hi=0;hi<hc.length;hi++){
      var hourNum=hi+4;
      var cy=hc[hi].cycles;
      var netProfit=cy*netPC;
      if(isNaN(netProfit))netProfit=0;
      hourlyMatrix[hourNum].push({tpPct:tpPct,tpDollar:tpDollar,cycles:cy,netPC:netPC,netProfit:netProfit});
      if(!bestPerHour[hourNum]||netProfit>bestPerHour[hourNum].netProfit){
        bestPerHour[hourNum]={tpPct:tpPct,tpDollar:tpDollar,cycles:cy,netPC:netPC,netProfit:netProfit};
      }
    }
  }
  // Sort each hour's results by net profit
  for(var h2=4;h2<20;h2++){
    hourlyMatrix[h2].sort(function(a,b){return b.netProfit-a.netProfit;});
  }
  // Compute total net if using best TP% per hour
  var adaptiveTotal=0;
  for(var h3=4;h3<20;h3++){if(bestPerHour[h3])adaptiveTotal+=bestPerHour[h3].netProfit;}
  return{matrix:hourlyMatrix,bestPerHour:bestPerHour,adaptiveTotal:adaptiveTotal,sharePrice:sharePrice,fracQty:fracQty,adjFee:adjFee};
}

function buildPriceData(trades){
  if(!trades.length)return[];var s=trades[0].ts;
  var rt=Math.max(1,Math.floor(trades.length/1500)),pd=[];
  for(var k=0;k<trades.length;k+=rt){var tt=trades[k],sc=(tt.ts-s)/1e9,hh=Math.floor(sc/3600),mm=Math.floor((sc%3600)/60);pd.push({time:String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0'),price:tt.price});}
  return pd;
}

async function fetchOHLC(ticker,date,apiKey){
  var r=await fetch('https://api.polygon.io/v1/open-close/'+ticker.toUpperCase()+'/'+date+'?adjusted=true&apiKey='+apiKey);
  if(!r.ok)return null;var d=await r.json();return(d.status==='OK'||d.status==='Early Trading')?d:null;
}

function formatTS(tsRaw){
  var tsMs;if(tsRaw>1e15)tsMs=tsRaw/1e6;else if(tsRaw>1e12)tsMs=tsRaw/1e3;else tsMs=tsRaw;
  var dt=new Date(tsMs);var hh=dt.getUTCHours()-4;if(hh<0)hh+=24;
  return String(hh).padStart(2,'0')+':'+String(dt.getUTCMinutes()).padStart(2,'0')+':'+String(dt.getUTCSeconds()).padStart(2,'0')+'.'+String(dt.getUTCMilliseconds()).padStart(3,'0');
}


var PYCODE='import requests, math\n\nTICKER = "SOXL"\nDATE = "2026-03-27"\nTP_PCT = 1.0\nAPI_KEY = "YOUR_POLYGON_API_KEY"\n\n# 1. Fetch all trades\ntrades = []\nurl = (f"https://api.polygon.io/v3/trades/{TICKER}"\n       f"?timestamp.gte={DATE}T04:00:00.000Z"\n       f"&timestamp.lt={DATE}T23:59:59.000Z"\n       f"&limit=50000&sort=timestamp"\n       f"&order=asc&apiKey={API_KEY}")\n\nwhile url:\n    r = requests.get(url).json()\n    for t in r.get("results", []):\n        trades.append(t["price"])\n    nxt = r.get("next_url")\n    url = f"{nxt}&apiKey={API_KEY}" if nxt else None\n\nprint(f"Fetched {len(trades)} trades")\nprint(f"Opening tick: ${trades[0]:.4f}")\n\n# 2. Build price levels\nmin_p = math.floor(min(trades) * 100) / 100\nmax_p = math.ceil(max(trades) * 100) / 100\nopen_lvl = math.floor(trades[0] * 100) / 100\npre_seed_max = round(open_lvl * 1.01, 2)\n\nlevels = {}\np = min_p\nwhile p <= max_p + 0.001:\n    key = round(p, 2)\n    import math\n    target = math.ceil(key * (1 + TP_PCT / 100) * 100) / 100\n    active = (key >= open_lvl and key <= pre_seed_max)\n    levels[key] = {\n        "target": target,\n        "active": active,\n        "cycles": 0\n    }\n    p = round(p + 0.01, 2)\n\nprint(f"Pre-seeded: ${open_lvl:.2f} to "\n      f"${pre_seed_max:.2f}")\n\n# 3. Walk ticks (skip first)\nfor i, price in enumerate(trades):\n    if i == 0:\n        continue\n    # SELL first: active level where tick >= target\n    for lvl, data in levels.items():\n        if data["active"] and price >= data["target"]:\n            data["cycles"] += 1\n            data["active"] = False\n    # BUY second: tick within level range\n    for lvl, data in levels.items():\n        if (not data["active"]\n            and price >= lvl\n            and price < lvl + 0.01):\n            data["active"] = True\n\n# 4. Results\nactive = {k: v for k, v in levels.items()\n          if v["cycles"] > 0}\ntotal = sum(v["cycles"] for v in active.values())\nprint(f"Total cycles: {total}")\nprint(f"Active levels: {len(active)}")\nfor k, v in sorted(active.items(),\n    key=lambda x: -x[1]["cycles"])[:20]:\n    print(f"  ${k:.2f} -> ${v[\'target\']:.2f}"\n          f"  cycles: {v[\'cycles\']}")';
var iS={background:C.bgInput,border:'1px solid '+C.border,borderRadius:6,color:C.txtBright,fontFamily:F,fontSize:13,padding:'10px 12px',outline:'none',width:'100%',boxSizing:'border-box'};
var lS={color:C.txtDim,fontSize:9,textTransform:'uppercase',letterSpacing:1.2,marginBottom:4,display:'block',fontFamily:F};
var bB={fontFamily:F,fontSize:12,fontWeight:700,border:'none',borderRadius:6,cursor:'pointer',letterSpacing:0.8,textTransform:'uppercase',padding:'10px 16px',width:'100%'};

function Cd(p){return <div style={Object.assign({},{background:C.bgCard,border:'1px solid '+(p.glow?C.accent:C.border),borderRadius:10,padding:'14px 16px',marginBottom:12,boxShadow:p.glow?'0 0 24px '+C.accentDim:'none'},p.style||{})}>{p.children}</div>;}
function Mt(p){var sz=p.size==='lg'?26:p.size==='md'?18:14;return <div style={{textAlign:'center'}}><div style={{color:p.color||C.accent,fontSize:sz,fontWeight:800,fontFamily:F,lineHeight:1.2}}>{p.value}<span style={{fontSize:sz*0.45,color:C.txtDim,marginLeft:2}}>{p.unit}</span></div><div style={{color:C.txt,fontSize:8,marginTop:3,textTransform:'uppercase',letterSpacing:0.6,fontFamily:F}}>{p.label}</div></div>;}

function Info(p){
  var s=useState(false),show=s[0],setShow=s[1];
  return <span style={{position:'relative',display:'inline-flex',alignItems:'center'}}>
    <span onClick={function(e){e.stopPropagation();setShow(!show);}} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',width:15,height:15,borderRadius:'50%',border:'1px solid '+(show?C.accent:C.border),color:show?C.accent:C.txtDim,fontSize:8,fontWeight:700,fontFamily:'Georgia,serif',fontStyle:'italic',cursor:'pointer',marginLeft:5,background:show?C.accentDim:'transparent',flexShrink:0}}>i</span>
    {show&&<div onClick={function(e){e.stopPropagation();}} style={{position:'fixed',top:0,left:0,right:0,bottom:0,zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.6)',padding:20}}>
      <div style={{background:C.bgCard,border:'1px solid '+C.accent,borderRadius:10,padding:'16px 18px',maxWidth:300,width:'100%',boxShadow:'0 12px 40px rgba(0,0,0,0.7)'}}>
        <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.7}}>{p.children}</div>
        <div onClick={function(){setShow(false);}} style={{color:C.bg,background:C.accent,fontSize:9,fontFamily:F,fontWeight:700,marginTop:12,padding:'6px 0',borderRadius:5,textAlign:'center',cursor:'pointer',letterSpacing:1,textTransform:'uppercase'}}>Got it</div>
      </div>
    </div>}
  </span>;
}

function SectionHead(p){
  return <div style={{display:'flex',alignItems:'center',marginBottom:p.sub?2:10}}>
    <div style={{flex:1}}>
      <div style={{color:C.txtBright,fontSize:12,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>{p.title}</div>
      {p.sub&&<div style={{color:C.txt,fontSize:10,marginTop:2,fontFamily:F}}>{p.sub}</div>}
    </div>
    {p.info&&<Info>{p.info}</Info>}
  </div>;
}

function LiveClock(){var s=useState(new Date()),now=s[0],setNow=s[1];useEffect(function(){var id=setInterval(function(){setNow(new Date());},1000);return function(){clearInterval(id);};},[]);var days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];var months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];var d=days[now.getDay()]+' '+months[now.getMonth()]+' '+now.getDate()+', '+now.getFullYear();var h=now.getHours(),m=now.getMinutes(),sec=now.getSeconds();var ampm=h>=12?'PM':'AM';h=h%12;if(h===0)h=12;var t=h+':'+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0')+' '+ampm;return <div style={{textAlign:'right'}}><div style={{color:C.txtBright,fontSize:11,fontWeight:700,fontFamily:F}}>{t}</div><div style={{color:C.txtDim,fontSize:8,fontFamily:F,color:'#c8d8e8'}}>{d}</div></div>;}
function MenuIcon(p){return <div onClick={p.onClick} style={{cursor:'pointer',padding:8}}><div style={{width:20,height:2,background:C.txtBright,marginBottom:4,borderRadius:1}}></div><div style={{width:14,height:2,background:C.txtBright,marginBottom:4,borderRadius:1}}></div><div style={{width:18,height:2,background:C.txtBright,borderRadius:1}}></div></div>;}
function MenuDropdown(p){var ref=useRef(null);useEffect(function(){function h(e){if(ref.current&&!ref.current.contains(e.target))p.onClose();}document.addEventListener('touchstart',h);document.addEventListener('mousedown',h);return function(){document.removeEventListener('touchstart',h);document.removeEventListener('mousedown',h);};},[]);if(!p.open)return null;return <div ref={ref} style={{position:'absolute',top:44,right:12,background:C.bgCard,border:'1px solid '+C.border,borderRadius:8,boxShadow:'0 8px 32px rgba(0,0,0,0.6)',zIndex:100,minWidth:180,overflow:'hidden',maxHeight:'80vh',overflowY:'auto'}}>{p.items.map(function(item){if(item.type==='divider')return <div key={item.key} style={{height:1,background:C.accent,opacity:0.2,margin:'0 12px'}}></div>;if(item.type==='header')return <div key={item.key} style={{padding:'10px 16px 4px',color:C.gold,fontSize:8,fontFamily:F,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',borderBottom:'1px solid '+C.border,background:'rgba(255,176,32,0.05)'}}>{item.label}</div>;return <div key={item.key} onClick={function(){p.onSelect(item.key);p.onClose();}} style={{padding:(item.indent?'10px 16px 10px 32px':'12px 16px'),color:C.txtBright,fontSize:item.indent?10:11,fontFamily:F,fontWeight:600,letterSpacing:0.8,textTransform:'uppercase',cursor:'pointer',borderBottom:'1px solid '+C.border,display:'flex',alignItems:'center',gap:10}}><span style={{color:item.indent?C.accent:C.accent,fontSize:item.indent?12:14}}>{item.icon}</span>{item.label}</div>;})}</div>;}
function BatchPage(p){
  var s1=useState('SOXL'),ticker=s1[0],setTicker=s1[1];
  var s2=useState(''),startDate=s2[0],setStartDate=s2[1];
  var s3=useState(''),endDate=s3[0],setEndDate=s3[1];
  var s4=useState('1'),tp=s4[0],setTp=s4[1];
  var s5=useState('all'),session=s5[0],setSession=s5[1];
  var s6=useState(false),running=s6[0],setRunning=s6[1];
  var s7=useState([]),log=s7[0],setLog=s7[1];
  var s8=useState(null),summary=s8[0],setSummary=s8[1];
  var s9=useState(false),cancelled=s9[0],setCancelled=s9[1];
  var cancelRef=useRef(false);

  var getTradingDays=function(start,end){
    var days=[];
    var d=new Date(start+'T12:00:00Z');
    var e=new Date(end+'T12:00:00Z');
    while(d<=e){
      var dow=d.getUTCDay();
      if(dow!==0&&dow!==6){
        days.push(d.toISOString().split('T')[0]);
      }
      d.setUTCDate(d.getUTCDate()+1);
    }
    return days;
  };

  var addLog=function(msg,type){
    setLog(function(prev){return prev.concat([{msg:msg,type:type||'info',time:new Date().toLocaleTimeString()}]);});
  };

  var processBrowserSide=async function(ticker,day,tpVal,session,apiKey){
    // Fetch ticks from Polygon (browser-direct)
    var allTrades=[],url='https://api.polygon.io/v3/trades/'+ticker+'?timestamp.gte='+day+'T04:00:00.000Z&timestamp.lt='+day+'T23:59:59.000Z&limit=50000&sort=timestamp&order=asc&apiKey='+apiKey;
    while(url){var r=await fetch(url);if(!r.ok)throw new Error('Polygon error '+r.status);var d=await r.json();if(d.results)for(var i=0;i<d.results.length;i++){var t=d.results[i];allTrades.push({price:t.price,size:t.size||0,ts:t.sip_timestamp||t.participant_timestamp});}url=d.next_url?(d.next_url+'&apiKey='+apiKey):null;}
    if(!allTrades.length)return{error:'No trades found'};
    // Filter by session
    var trades=allTrades;
    if(session==='rth'){trades=allTrades.filter(function(t){var ms=t.ts>1e15?t.ts/1e6:t.ts>1e12?t.ts/1e3:t.ts;var d2=new Date(ms);var etMin=(d2.getUTCHours()-4)*60+d2.getUTCMinutes();return etMin>=570&&etMin<960;});}
    if(!trades.length)return{error:'No trades in session'};
    // Run cycle analysis
    var res=analyzePriceLevels(trades,tpVal);
    var hc=computeHourlyCycles(trades,tpVal);
    // Compute seasonality
    var hourly={};for(var h=4;h<20;h++)hourly[h]={high:-Infinity,low:Infinity,vol:0,trades:0};
    var sessions2={pre:{min:Infinity,max:-Infinity,vol:0,trades:0},reg:{min:Infinity,max:-Infinity,vol:0,trades:0},post:{min:Infinity,max:-Infinity,vol:0,trades:0}};
    for(var i2=0;i2<allTrades.length;i2++){
      var tt=allTrades[i2];var ms2=tt.ts>1e15?tt.ts/1e6:tt.ts>1e12?tt.ts/1e3:tt.ts;var d3=new Date(ms2);var eh=d3.getUTCHours()-4;if(eh<0)eh+=24;var em=eh*60+d3.getUTCMinutes();
      if(hourly[eh]){hourly[eh].trades++;hourly[eh].vol+=tt.size;if(tt.price>hourly[eh].high)hourly[eh].high=tt.price;if(tt.price<hourly[eh].low)hourly[eh].low=tt.price;}
      if(em<570){sessions2.pre.trades++;sessions2.pre.vol+=tt.size;if(tt.price<sessions2.pre.min)sessions2.pre.min=tt.price;if(tt.price>sessions2.pre.max)sessions2.pre.max=tt.price;}
      else if(em<960){sessions2.reg.trades++;sessions2.reg.vol+=tt.size;if(tt.price<sessions2.reg.min)sessions2.reg.min=tt.price;if(tt.price>sessions2.reg.max)sessions2.reg.max=tt.price;}
      else{sessions2.post.trades++;sessions2.post.vol+=tt.size;if(tt.price<sessions2.post.min)sessions2.post.min=tt.price;if(tt.price>sessions2.post.max)sessions2.post.max=tt.price;}
    }
    var chartData=[];for(var h2=4;h2<20;h2++){var hd=hourly[h2];var atr=(hd.high>-Infinity&&hd.low<Infinity)?hd.high-hd.low:0;var atrPct=(hd.low>0&&atr>0)?(atr/hd.low)*100:0;chartData.push({atr:atr,atrPct:atrPct,volume:hd.vol,trades:hd.trades,high:hd.high>-Infinity?hd.high:null,low:hd.low<Infinity?hd.low:null});}
    // Fetch OHLC
    var ohlcData=await fetchOHLC(ticker,day,apiKey);
    // Save to database
    var svMin=Infinity,svMax=-Infinity;for(var i3=0;i3<trades.length;i3++){if(trades[i3].price<svMin)svMin=trades[i3].price;if(trades[i3].price>svMax)svMax=trades[i3].price;}
    var svOpen=Math.floor(trades[0].price*100)/100;var svPSM=Math.round(svOpen*1.01*100)/100;
    await SB.saveAnalysis(ticker,day,tpVal,session,res.summary,res.levels,ohlcData,svMin,svMax,svOpen,svPSM);
    await SB.saveHourlyCycles(ticker,day,tpVal,session,hc);
    await SB.saveSeasonality(ticker,day,chartData,sessions2);
    return{status:'processed',total_cycles:res.summary.totalCycles,active_levels:res.summary.activeLevels,total_trades:trades.length};
  };

  var run=async function(){
    if(!p.apiKey){addLog('No Polygon API key set','error');return;}
    if(!startDate||!endDate){addLog('Set start and end dates','error');return;}
    if(!SB_URL||!SB_KEY){addLog('No Supabase config. Set in Settings.','error');return;}
    var tpVal=parseFloat(tp);
    if(!tpVal||tpVal<=0){addLog('Invalid TP%','error');return;}

    var days=getTradingDays(startDate,endDate);
    if(!days.length){addLog('No trading days in range','error');return;}

    setRunning(true);setCancelled(false);cancelRef.current=false;setSummary(null);
    setLog([]);
    addLog('Starting batch: '+ticker.toUpperCase()+' | '+days.length+' trading days | '+tpVal+'% TP','info');

    var processed=0,cached=0,errors=0,noData=0,batchTotalCycles=0;
    var edgeUrl=SB_URL+'/functions/v1/batch-analyze';

    for(var i=0;i<days.length;i++){
      if(cancelRef.current){addLog('Cancelled by user','warn');break;}
      var day=days[i];
      addLog('Day '+(i+1)+'/'+days.length+': '+day+'...','info');

      try{
        var resp=await fetch(edgeUrl,{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':'Bearer '+SB_KEY},
          body:JSON.stringify({ticker:ticker.toUpperCase(),date:day,tp_pct:tpVal,polygon_key:p.apiKey,session_type:session})
        });
        if(!resp.ok){
          if(resp.status===546||resp.status===500||resp.status===502||resp.status===504){
            addLog(day+': Edge function failed ('+resp.status+'), retrying browser-side...','warn');
            try{
              var bResult=await processBrowserSide(ticker.toUpperCase(),day,tpVal,session,p.apiKey);
              if(bResult.error){
                if(bResult.error.indexOf('No trades')>=0){noData++;addLog(day+': '+bResult.error,'warn');}
                else{errors++;addLog(day+': Browser error: '+bResult.error,'error');}
              }else{
                processed++;batchTotalCycles+=bResult.total_cycles;
                addLog(day+': '+bResult.total_cycles+' cycles | '+bResult.active_levels+' levels | '+bResult.total_trades.toLocaleString()+' trades (browser)','success');
              }
            }catch(be){errors++;addLog(day+': Browser fallback error: '+be.message,'error');}
            continue;
          }
          errors++;
          addLog(day+': Edge function error (status '+resp.status+')','error');
          continue;
        }
        var result=await resp.json();

        if(result.status==='cached'){
          cached++;
          addLog(day+': Already cached','cached');
        }else if(result.status==='processed'){
          processed++;batchTotalCycles+=result.total_cycles;
          addLog(day+': '+result.total_cycles+' cycles | '+result.active_levels+' levels | '+(result.total_trades||0).toLocaleString()+' trades','success');
        }else if(result.error){
          if(result.error.indexOf('No trades')>=0){noData++;addLog(day+': No trades (holiday/weekend?)','warn');}
          else{errors++;addLog(day+': '+result.error,'error');}
        }else{
          errors++;
          addLog(day+': Unexpected response from edge function','error');
        }
      }catch(e){
        errors++;
        addLog(day+': Network error - '+e.message,'error');
      }
    }

    var s={total:days.length,processed:processed,cached:cached,errors:errors,noData:noData,totalCycles:batchTotalCycles};
    setSummary(s);
    addLog('Complete: '+processed+' processed, '+cached+' cached, '+noData+' no data, '+errors+' errors','info');
    setRunning(false);
  };

  var cancel=function(){cancelRef.current=true;setCancelled(true);};

  return <div>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Import Stock Data</div>
    </div>
    <Cd>
      <SectionHead title="Date Range Processing" sub="Import and analyze multiple days via server-side edge function" info="Processes each trading day in the date range using a Supabase Edge Function. The server fetches ticks from Polygon, runs the full cycle analysis and seasonality computation, saves results to the database, then discards the raw ticks. Already-cached days are skipped automatically."/>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:10}}>
        <div><label style={lS}>Ticker</label><input value={ticker} onChange={function(e){setTicker(e.target.value.toUpperCase());}} style={iS}/></div>
        <div><label style={lS}>TP %</label><input type="text" inputMode="decimal" value={tp} onChange={function(e){setTp(e.target.value);}} style={iS}/></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8}}>
        <div><label style={lS}>Start Date</label><input type="date" value={startDate} onChange={function(e){setStartDate(e.target.value);}} style={iS}/></div>
        <div><label style={lS}>End Date</label><input type="date" value={endDate} onChange={function(e){setEndDate(e.target.value);}} style={iS}/></div>
      </div>
      <div style={{marginTop:8,marginBottom:10}}>
        <label style={lS}>Session</label>
        <div style={{display:'flex',gap:4}}>
          <button onClick={function(){setSession('all');}} style={Object.assign({},bB,{flex:1,padding:'7px 4px',fontSize:9,background:session==='all'?C.accentDim:'transparent',border:'1px solid '+(session==='all'?C.accent:C.border),color:session==='all'?C.accent:C.txt})}>All Hours</button>
          <button onClick={function(){setSession('rth');}} style={Object.assign({},bB,{flex:1,padding:'7px 4px',fontSize:9,background:session==='rth'?C.accentDim:'transparent',border:'1px solid '+(session==='rth'?C.accent:C.border),color:session==='rth'?C.accent:C.txt})}>Regular Only</button>
        </div>
      </div>
      {!running&&<button onClick={run} style={Object.assign({},bB,{background:'linear-gradient(135deg,#00e5a0,#00c488)',color:C.bg})}>Start Import</button>}
      {running&&<button onClick={cancel} style={Object.assign({},bB,{background:C.warn,color:C.bg})}>Cancel</button>}
      {startDate&&endDate&&!running&&<div style={{color:C.txtDim,fontSize:9,fontFamily:F,marginTop:6}}>{getTradingDays(startDate,endDate).length+' trading days in range'}</div>}
    </Cd>
    {summary&&<Cd glow={true}>
      <SectionHead title="Import Summary" sub={ticker+' | '+startDate+' to '+endDate}/>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,marginTop:10}}>
        <Mt label="Processed" value={summary.processed} color={C.accent} size="md"/>
        <Mt label="Cached" value={summary.cached} color={C.blue} size="md"/>
        <Mt label="No Data" value={summary.noData} color={C.gold} size="md"/>
        <Mt label="Errors" value={summary.errors} color={C.warn} size="md"/>
      </div>
      {summary.totalCycles>0&&<div style={{marginTop:8}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <Mt label="Total Cycles" value={summary.totalCycles} color={C.accent} size="md"/>
          <Mt label="Avg Cycles/Day" value={Math.round(summary.totalCycles/(summary.processed+summary.cached))} color={C.blue} size="md"/>
        </div>
      </div>}
    </Cd>}
    {log.length>0&&<Cd>
      <SectionHead title="Processing Log" sub={log.length+' entries'}/>
      <div style={{maxHeight:400,overflowY:'auto',marginTop:8}}>
        {log.map(function(l,i){
          var col=l.type==='success'?C.accent:l.type==='cached'?C.blue:l.type==='error'?C.warn:l.type==='warn'?C.gold:C.txtDim;
          return <div key={i} style={{display:'flex',gap:6,padding:'3px 0',borderBottom:'1px solid '+C.grid,fontSize:8,fontFamily:F}}>
            <span style={{color:C.txtDim,flexShrink:0,width:52}}>{l.time}</span>
            <span style={{color:col,flex:1}}>{l.msg}</span>
          </div>;
        })}
      </div>
    </Cd>}
  </div>;
}
function TrendPage(p){
  var s1=useState('NIO'),ticker=s1[0],setTicker=s1[1];
  var s7t=useState('1'),trendTp=s7t[0],setTrendTp=s7t[1];
  var s8t=useState('1'),trendCap=s8t[0],setTrendCap=s8t[1];
  var s9t=useState('0.005'),trendFee=s9t[0],setTrendFee=s9t[1];
  var s2=useState(''),startDate=s2[0],setStartDate=s2[1];
  var s3=useState(''),endDate=s3[0],setEndDate=s3[1];
  var s4=useState(null),data=s4[0],setData=s4[1];
  var s5=useState(false),loading=s5[0],setLoading=s5[1];
  var s6=useState(null),err=s6[0],setErr=s6[1];


  var run=async function(){
    if(!SB_URL||!SB_KEY){setErr('No Supabase config. Set in Settings.');return;}
    if(!startDate||!endDate){setErr('Set start and end dates');return;}
    setLoading(true);setErr(null);setData(null);
    try{
      var h=getSbHeaders();
      var tpVal=parseFloat(trendTp)||1;
      // Check if analyses exist for this TP%
      var rChk=await fetch(SB_URL+'/rest/v1/cached_analyses?ticker=eq.'+ticker.toUpperCase()+'&trade_date=gte.'+startDate+'&trade_date=lte.'+endDate+'&tp_pct=eq.'+tpVal+'&select=trade_date,total_cycles&order=trade_date.asc',{headers:h});
      var analysisRows=rChk.ok?await rChk.json():[];
      if(!analysisRows.length){setErr('No cached data for '+ticker.toUpperCase()+' at '+tpVal+'% TP in this date range. Go to Import Stock Data and batch process with TP% = '+tpVal+'.');setLoading(false);return;}
      var r1=await fetch(SB_URL+'/rest/v1/cached_seasonality?ticker=eq.'+ticker.toUpperCase()+'&trade_date=gte.'+startDate+'&trade_date=lte.'+endDate+'&select=*&order=trade_date.asc,hour.asc',{headers:h});
      if(!r1.ok)throw new Error('API error '+r1.status);
      var rows=await r1.json();
      if(!rows.length){setErr('No cached seasonality data for '+ticker.toUpperCase()+' in this range. Go to Import Stock Data first.');setLoading(false);return;}

      // Group by date
      var dates={};var allDates=[];
      for(var i=0;i<rows.length;i++){
        var r=rows[i];
        if(!dates[r.trade_date]){dates[r.trade_date]={};allDates.push(r.trade_date);}
        dates[r.trade_date][r.hour]={atr:parseFloat(r.atr)||0,atrPct:parseFloat(r.atr_pct)||0,volume:parseInt(r.volume)||0,trades:parseInt(r.trades)||0,high:r.high?parseFloat(r.high):0,low:r.low?parseFloat(r.low):0};
      }

      // Build hourly averages
      var hourAvg={};
      for(var h2=4;h2<20;h2++){
        var vals={atr:[],atrPct:[],volume:[],trades:[]};
        for(var d=0;d<allDates.length;d++){
          var hd=dates[allDates[d]][h2];
          if(hd){vals.atr.push(hd.atr);vals.atrPct.push(hd.atrPct);vals.volume.push(hd.volume);vals.trades.push(hd.trades);}
        }
        var avg=function(a){return a.length?a.reduce(function(x,y){return x+y;},0)/a.length:0;};
        hourAvg[h2]={atr:avg(vals.atr),atrPct:avg(vals.atrPct),volume:avg(vals.volume),trades:avg(vals.trades)};
      }

      // Find maxes for heatmap scaling
      var maxAtrPct=0,maxVol=0,maxTrades=0;
      for(var i=0;i<rows.length;i++){
        var ap=parseFloat(rows[i].atr_pct)||0;var v=parseInt(rows[i].volume)||0;var t=parseInt(rows[i].trades)||0;
        if(ap>maxAtrPct)maxAtrPct=ap;if(v>maxVol)maxVol=v;if(t>maxTrades)maxTrades=t;
      }

      // Compute maxAtr$ and maxSwing
      var maxAtr=0;
      for(var i=0;i<rows.length;i++){var at=parseFloat(rows[i].atr)||0;if(at>maxAtr)maxAtr=at;}
      var maxSwing=0;
      for(var d2=0;d2<allDates.length;d2++){
        for(var h3=4;h3<19;h3++){
          var c2=dates[allDates[d2]][h3];var n2=dates[allDates[d2]][h3+1];
          if(c2&&n2&&c2.low>0&&n2.high>0){var sw=Math.abs(((n2.high-c2.low)/c2.low)*100);if(sw>maxSwing)maxSwing=sw;}
        }
      }
      // Fetch hourly cycles
      var r3=await fetch(SB_URL+'/rest/v1/cached_hourly_cycles?ticker=eq.'+ticker.toUpperCase()+'&trade_date=gte.'+startDate+'&trade_date=lte.'+endDate+'&tp_pct=eq.'+tpVal+'&select=*&order=trade_date.asc,hour.asc',{headers:h});
      var cycleRows=r3.ok?await r3.json():[];
      var cyclesByDate={};var maxHourlyCycles=0;
      for(var ci=0;ci<cycleRows.length;ci++){
        var cr=cycleRows[ci];
        if(!cyclesByDate[cr.trade_date])cyclesByDate[cr.trade_date]={};
        cyclesByDate[cr.trade_date][cr.hour]=cr.cycles;
        if(cr.cycles>maxHourlyCycles)maxHourlyCycles=cr.cycles;
      }
      // Compute avg cycles per hour
      var avgHourlyCycles={};
      for(var hc=4;hc<20;hc++){
        var cSum=0,cCnt=0;
        for(var di2=0;di2<allDates.length;di2++){
          if(cyclesByDate[allDates[di2]]&&cyclesByDate[allDates[di2]][hc]!==undefined){cSum+=cyclesByDate[allDates[di2]][hc];cCnt++;}
        }
        avgHourlyCycles[hc]=cCnt>0?cSum/cCnt:0;
      }

      setData({dates:dates,allDates:allDates,hourAvg:hourAvg,maxAtrPct:maxAtrPct,maxVol:maxVol,maxTrades:maxTrades,maxAtr:maxAtr,maxSwing:maxSwing,totalDays:allDates.length,cyclesByDate:cyclesByDate,maxHourlyCycles:maxHourlyCycles,avgHourlyCycles:avgHourlyCycles,hasCycles:cycleRows.length>0,analysisRows:analysisRows});
    }catch(e){setErr(e.message);}
    setLoading(false);
  };

  var fmtVol=function(v){if(v>=1e6)return(v/1e6).toFixed(1)+'M';if(v>=1e3)return(v/1e3).toFixed(0)+'K';return Math.round(v).toString();};

  var heatColor=function(value,max,baseColor){
    if(!max||!value)return 'transparent';
    var intensity=Math.min(value/max,1);
    var alpha=Math.round(intensity*200+20);
    if(baseColor==='green')return 'rgba(0,229,160,'+alpha/255+')';
    if(baseColor==='blue')return 'rgba(61,158,255,'+alpha/255+')';
    if(baseColor==='gold')return 'rgba(255,176,32,'+alpha/255+')';
    return 'rgba(255,255,255,'+alpha/255+')';
  };

  var HeatMap=function(props){
    return <div style={{overflowX:'auto'}}>
      <div style={{display:'grid',gridTemplateColumns:'70px repeat(16,1fr)',gap:1,minWidth:500}}>
        <div style={{fontSize:6,color:C.txtDim,fontFamily:F,padding:2}}></div>
        {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h2){return <div key={h2} style={{fontSize:6,color:(h2>=9&&h2<16)?'#e0eaf4':'#8a9aaa',fontFamily:F,textAlign:'center',padding:2}}>{hourLabels[String(h2)]}</div>;})}
        {data.allDates.map(function(dt){
          var dow=new Date(dt+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short'});
          return React.createElement(React.Fragment,{key:dt},[
            React.createElement('div',{key:dt+'l',style:{fontSize:7,color:'#d0dce8',fontFamily:F,padding:'3px 4px',whiteSpace:'nowrap'}},dow+' '+dt.substring(5)),
            [4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h2){
              var hd=data.dates[dt][h2];
              var val=hd?props.getValue(hd):0;
              var bg=heatColor(val,props.max,props.color);
              return React.createElement('div',{key:dt+'-'+h2,style:{background:bg,borderRadius:2,padding:'2px 0',textAlign:'center',fontSize:6,color:val>0?'#ffffff':'#3a4a5a',fontFamily:F,minHeight:18,display:'flex',alignItems:'center',justifyContent:'center'}},val>0?props.format(val):'');
            })
          ]);
        })}
        {React.createElement('div',{key:'avg-label',style:{fontSize:7,color:C.accent,fontFamily:F,padding:'4px 4px',whiteSpace:'nowrap',fontWeight:700,borderTop:'1px solid '+C.accent}},'AVG')}
        {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h2){
          var sum=0,cnt=0;
          for(var di=0;di<data.allDates.length;di++){
            var hd=data.dates[data.allDates[di]][h2];
            if(hd){var v=props.getValue(hd);if(v>0){sum+=v;cnt++;}}
          }
          var avgVal=cnt>0?sum/cnt:0;
          return React.createElement('div',{key:'avg-'+h2,style:{borderTop:'1px solid '+C.accent,borderRadius:2,padding:'2px 0',textAlign:'center',fontSize:6,color:C.accent,fontFamily:F,fontWeight:700,minHeight:18,display:'flex',alignItems:'center',justifyContent:'center'}},avgVal>0?props.format(avgVal):'');
        })}
      </div>
    </div>;
  };

  return <div>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Trend Analysis</div>
    </div>
    <Cd>
      <SectionHead title="Parameters" sub="Analyze cached data across a date range" info="Queries pre-computed hourly data from the database. Data must be loaded first via the main analysis, seasonality page, or batch processing. Shows trends and patterns across multiple days."/>
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginTop:10}}>
        <div><label style={lS}>Ticker</label><input value={ticker} onChange={function(e){setTicker(e.target.value.toUpperCase());}} style={iS}/></div>
        <div><label style={lS}>TP %</label><input type="text" inputMode="decimal" value={trendTp} onChange={function(e){setTrendTp(e.target.value);}} style={iS}/></div>
        <div><label style={lS}>$/Level</label><input type="text" inputMode="decimal" value={trendCap} onChange={function(e){setTrendCap(e.target.value);}} style={iS}/></div>
        <div><label style={lS}>Fee/Cycle</label><input type="text" inputMode="decimal" value={trendFee} onChange={function(e){setTrendFee(e.target.value);}} style={iS}/></div>
        <div><label style={lS}>Start Date</label><input type="date" value={startDate} onChange={function(e){setStartDate(e.target.value);}} style={iS}/></div>
        <div><label style={lS}>End Date</label><input type="date" value={endDate} onChange={function(e){setEndDate(e.target.value);}} style={iS}/></div>
      </div>
      <button onClick={run} disabled={loading} style={Object.assign({},bB,{marginTop:10,background:loading?C.border:'linear-gradient(135deg,#00e5a0,#00c488)',color:loading?C.txtDim:C.bg})}>{loading?'Loading...':'Analyze Trends'}</button>
      {err&&<div style={{marginTop:8,padding:'8px 10px',background:C.warnDim,border:'1px solid #ff5c3a30',borderRadius:6,color:C.warn,fontSize:10}}>{err}</div>}
    </Cd>
    {data&&<div>
      <Cd glow={true}>
        <SectionHead title="Data Coverage" sub={ticker+' | '+startDate+' to '+endDate}/>
        {(function(){
          // Calculate expected trading days in range
          var d1=new Date(startDate+'T12:00:00Z');var d2=new Date(endDate+'T12:00:00Z');
          var expected=0;var expectedDates=[];
          var dt=new Date(d1);
          while(dt<=d2){
            var dow=dt.getUTCDay();
            if(dow!==0&&dow!==6){expected++;expectedDates.push(dt.toISOString().split('T')[0]);}
            dt.setUTCDate(dt.getUTCDate()+1);
          }
          var missingDates=expectedDates.filter(function(ed){return data.allDates.indexOf(ed)===-1;});
          var hasMissing=missingDates.length>0;
          return <div>
            <div style={{display:'grid',gridTemplateColumns:hasMissing?'1fr 1fr':'1fr',gap:8,marginTop:10}}>
              <Mt label="Days Cached" value={data.totalDays+' / '+expected} color={hasMissing?C.gold:C.accent} size="lg"/>
              {hasMissing&&<Mt label="Days Missing" value={missingDates.length} color={C.warn} size="lg"/>}
            </div>
            {hasMissing&&<div style={{marginTop:8,padding:'8px 10px',background:C.warnDim,border:'1px solid #ff5c3a30',borderRadius:6}}>
              <div style={{color:C.warn,fontSize:9,fontFamily:F,fontWeight:700,marginBottom:4}}>Missing dates ({missingDates.length}):</div>
              <div style={{color:'#e0a090',fontSize:8,fontFamily:F,lineHeight:1.6}}>{missingDates.join(', ')}</div>
              <div style={{color:C.txtDim,fontSize:8,fontFamily:F,marginTop:6}}>Go to Import Stock Data and batch process these dates to complete the dataset.</div>
            </div>}
          </div>;
        })()}
        {data.hasCycles&&(function(){
          var tCap=parseFloat(trendCap)||0;var tTp=parseFloat(trendTp)||0;var tFee=parseFloat(trendFee)||0;
          var totalCy=0;for(var di=0;di<data.allDates.length;di++){var dd=data.cyclesByDate[data.allDates[di]];if(dd){for(var hh=4;hh<20;hh++){totalCy+=(dd[hh]||0);}}}
          var grossPC=tCap*(tTp/100);
          var grossTotal=totalCy*grossPC;
          var avgDailyGross=data.totalDays>0?grossTotal/data.totalDays:0;
          return <div style={{marginTop:8}}>
            <div style={{display:'inline-block',background:C.goldDim,border:'1px solid '+C.gold,borderRadius:4,padding:'2px 8px',fontSize:7,color:C.gold,fontFamily:F,fontWeight:700,marginBottom:8,letterSpacing:0.5}}>PROFIT ESTIMATE @ {trendTp}% TP | ${trendCap}/LEVEL | ${trendFee} FEE</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
              <Mt label="Total Cycles" value={totalCy} color={C.accent} size="md"/>
              <Mt label="Gross Profit" value={'$'+grossTotal.toFixed(2)} color={C.gold} size="md"/>
              <Mt label="Avg/Day Gross" value={'$'+avgDailyGross.toFixed(2)} color={C.gold} size="md"/>
            </div>
          </div>;
        })()}
      </Cd>
      <Cd>
        <SectionHead title="Average Hourly Profile" sub={"Mean values across "+data.totalDays+" days"} info="The average ATR%, volume, and trades for each hour across all days in the range. Shows the typical intraday pattern for this stock."/>
        <div style={{marginTop:8}}>
          <div style={{color:'#e8f0f8',fontSize:9,fontWeight:700,fontFamily:F,marginBottom:6}}>Avg Hourly ATR $</div>
          {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h2){
            var maxA=0;for(var k=4;k<20;k++){if(data.hourAvg[k].atr>maxA)maxA=data.hourAvg[k].atr;}
            var pct=maxA>0?(data.hourAvg[h2].atr/maxA*100):0;
            return <div key={h2} style={{display:'flex',alignItems:'center',marginBottom:1}}>
              <div style={{width:36,fontSize:7,color:'#c0d4e8',fontFamily:F,textAlign:'right',paddingRight:4}}>{hourLabels[String(h2)]}</div>
              <div style={{flex:1,position:'relative',height:14}}>
                <div style={{position:'absolute',left:0,top:2,bottom:2,width:pct+'%',background:(h2>=9&&h2<16)?C.gold:'#506878',borderRadius:'0 2px 2px 0',minWidth:data.hourAvg[h2].atr>0?2:0}}></div>
              </div>
              <div style={{width:44,fontSize:7,color:'#e8f0f8',fontFamily:F,textAlign:'right',paddingLeft:4}}>{'$'+data.hourAvg[h2].atr.toFixed(3)}</div>
            </div>;
          })}
        </div>
        <div style={{marginTop:14}}>
          <div style={{color:'#e8f0f8',fontSize:9,fontWeight:700,fontFamily:F,marginBottom:6}}>Avg Hourly ATR %</div>
          {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h2){
            var maxA=0;for(var k=4;k<20;k++){if(data.hourAvg[k].atrPct>maxA)maxA=data.hourAvg[k].atrPct;}
            var pct=maxA>0?(data.hourAvg[h2].atrPct/maxA*100):0;
            return <div key={h2} style={{display:'flex',alignItems:'center',marginBottom:1}}>
              <div style={{width:36,fontSize:7,color:'#c0d4e8',fontFamily:F,textAlign:'right',paddingRight:4}}>{hourLabels[String(h2)]}</div>
              <div style={{flex:1,position:'relative',height:14}}>
                <div style={{position:'absolute',left:0,top:2,bottom:2,width:pct+'%',background:(h2>=9&&h2<16)?C.accent:'#506878',borderRadius:'0 2px 2px 0',minWidth:data.hourAvg[h2].atrPct>0?2:0}}></div>
              </div>
              <div style={{width:40,fontSize:7,color:'#e8f0f8',fontFamily:F,textAlign:'right',paddingLeft:4}}>{data.hourAvg[h2].atrPct.toFixed(2)+'%'}</div>
            </div>;
          })}
        </div>
        <div style={{marginTop:14}}>
          <div style={{color:'#e8f0f8',fontSize:9,fontWeight:700,fontFamily:F,marginBottom:6}}>Avg Hourly Volume</div>
          {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h2){
            var maxV=0;for(var k=4;k<20;k++){if(data.hourAvg[k].volume>maxV)maxV=data.hourAvg[k].volume;}
            var pct=maxV>0?(data.hourAvg[h2].volume/maxV*100):0;
            return <div key={h2} style={{display:'flex',alignItems:'center',marginBottom:1}}>
              <div style={{width:36,fontSize:7,color:'#c0d4e8',fontFamily:F,textAlign:'right',paddingRight:4}}>{hourLabels[String(h2)]}</div>
              <div style={{flex:1,position:'relative',height:14}}>
                <div style={{position:'absolute',left:0,top:2,bottom:2,width:pct+'%',background:(h2>=9&&h2<16)?C.blue:'#506878',borderRadius:'0 2px 2px 0',minWidth:data.hourAvg[h2].volume>0?2:0}}></div>
              </div>
              <div style={{width:40,fontSize:7,color:'#e8f0f8',fontFamily:F,textAlign:'right',paddingLeft:4}}>{fmtVol(data.hourAvg[h2].volume)}</div>
            </div>;
          })}
        </div>
        <div style={{marginTop:14}}>
          <div style={{color:'#e8f0f8',fontSize:9,fontWeight:700,fontFamily:F,marginBottom:6}}>Avg Hourly Trades</div>
          {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h2){
            var maxT=0;for(var k=4;k<20;k++){if(data.hourAvg[k].trades>maxT)maxT=data.hourAvg[k].trades;}
            var pct=maxT>0?(data.hourAvg[h2].trades/maxT*100):0;
            return <div key={h2} style={{display:'flex',alignItems:'center',marginBottom:1}}>
              <div style={{width:36,fontSize:7,color:'#c0d4e8',fontFamily:F,textAlign:'right',paddingRight:4}}>{hourLabels[String(h2)]}</div>
              <div style={{flex:1,position:'relative',height:14}}>
                <div style={{position:'absolute',left:0,top:2,bottom:2,width:pct+'%',background:(h2>=9&&h2<16)?C.gold:'#506878',borderRadius:'0 2px 2px 0',minWidth:data.hourAvg[h2].trades>0?2:0}}></div>
              </div>
              <div style={{width:40,fontSize:7,color:'#e8f0f8',fontFamily:F,textAlign:'right',paddingLeft:4}}>{fmtVol(data.hourAvg[h2].trades)}</div>
            </div>;
          })}
        </div>
        <div style={{marginTop:14}}>
          <div style={{display:'inline-block',background:C.accentDim,border:'1px solid '+C.accent,borderRadius:4,padding:'2px 8px',fontSize:7,color:C.accent,fontFamily:F,fontWeight:700,marginBottom:8,letterSpacing:0.5}}>CYCLE DATA @ {trendTp}% TAKE PROFIT</div>
          <div style={{color:'#e8f0f8',fontSize:9,fontWeight:700,fontFamily:F,marginBottom:6}}>Avg Hourly Cycles</div>
          {data.hasCycles&&[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h2){
            var maxC2=0;for(var k=4;k<20;k++){if(data.avgHourlyCycles[k]>maxC2)maxC2=data.avgHourlyCycles[k];}
            var pct=maxC2>0?(data.avgHourlyCycles[h2]/maxC2*100):0;
            return <div key={h2} style={{display:'flex',alignItems:'center',marginBottom:1}}>
              <div style={{width:36,fontSize:7,color:'#c0d4e8',fontFamily:F,textAlign:'right',paddingRight:4}}>{hourLabels[String(h2)]}</div>
              <div style={{flex:1,position:'relative',height:14}}>
                <div style={{position:'absolute',left:0,top:2,bottom:2,width:pct+'%',background:(h2>=9&&h2<16)?C.accent:'#506878',borderRadius:'0 2px 2px 0',minWidth:data.avgHourlyCycles[h2]>0?2:0}}></div>
              </div>
              <div style={{width:40,fontSize:7,color:C.accent,fontFamily:F,textAlign:'right',paddingLeft:4,fontWeight:700}}>{data.avgHourlyCycles[h2]>0?data.avgHourlyCycles[h2].toFixed(1):''}</div>
            </div>;
          })}
          {!data.hasCycles&&<div style={{color:C.txtDim,fontSize:9,fontFamily:F,padding:'8px 0'}}>No hourly cycle data cached. Re-run batch process to generate.</div>}
        </div>
        <div style={{marginTop:14}}>
          <div style={{color:'#e8f0f8',fontSize:9,fontWeight:700,fontFamily:F,marginBottom:6}}>Avg Low-to-Next-High Swing %</div>
          {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18].map(function(h2){
            var swings=[];
            for(var d3=0;d3<data.allDates.length;d3++){
              var c3=data.dates[data.allDates[d3]][h2];var n3=data.dates[data.allDates[d3]][h2+1];
              if(c3&&n3&&c3.low>0&&n3.high>0)swings.push(((n3.high-c3.low)/c3.low)*100);
            }
            var avgSw=swings.length?swings.reduce(function(a,b){return a+b;},0)/swings.length:0;
            var maxSw=0;for(var k=4;k<19;k++){
              var ss=[];for(var d4=0;d4<data.allDates.length;d4++){var c4=data.dates[data.allDates[d4]][k];var n4=data.dates[data.allDates[d4]][k+1];if(c4&&n4&&c4.low>0&&n4.high>0)ss.push(((n4.high-c4.low)/c4.low)*100);}
              var av=ss.length?ss.reduce(function(a,b){return a+b;},0)/ss.length:0;if(Math.abs(av)>maxSw)maxSw=Math.abs(av);
            }
            var pct2=maxSw>0?(Math.abs(avgSw)/maxSw*100):0;
            var isPos=avgSw>=0;
            return <div key={h2} style={{display:'flex',alignItems:'center',marginBottom:1}}>
              <div style={{width:54,fontSize:6,color:'#c0d4e8',fontFamily:F,textAlign:'right',paddingRight:4}}>{hourLabels[String(h2)]+' > '+hourLabels[String(h2+1)]}</div>
              <div style={{flex:1,position:'relative',height:14}}>
                <div style={{position:'absolute',left:0,top:2,bottom:2,width:pct2+'%',background:isPos?C.accent:C.warn,borderRadius:'0 2px 2px 0',minWidth:Math.abs(avgSw)>0?2:0}}></div>
              </div>
              <div style={{width:40,fontSize:7,color:isPos?C.accent:C.warn,fontFamily:F,textAlign:'right',paddingLeft:4,fontWeight:700}}>{(isPos?'+':'')+avgSw.toFixed(2)+'%'}</div>
            </div>;
          })}
        </div>
      </Cd>
      <Cd>
        <SectionHead title="ATR % Heatmap" sub="Volatility by hour and date" info="Each cell shows the ATR% for one hour of one day. Brighter green = higher volatility. Look for patterns: which hours are consistently volatile? Which days were outliers?"/>
        <div style={{marginTop:8}}><HeatMap getValue={function(hd){return hd.atrPct;}} max={data.maxAtrPct} color="green" format={function(v){return v.toFixed(1);}}/></div>
      </Cd>
      <Cd>
        <SectionHead title="ATR $ Heatmap" sub="Dollar range by hour and date" info="Each cell shows the dollar price range (high minus low) for one hour of one day. Brighter green = wider range. Compare against ATR% to see if dollar moves are proportional to price level."/>
        <div style={{marginTop:8}}><HeatMap getValue={function(hd){return hd.atr;}} max={data.maxAtr} color="green" format={function(v){return '$'+v.toFixed(2);}}/></div>
      </Cd>
            {data.hasCycles&&<Cd glow={true}>
        <div style={{display:'inline-block',background:C.accentDim,border:'1px solid '+C.accent,borderRadius:4,padding:'2px 8px',fontSize:7,color:C.accent,fontFamily:F,fontWeight:700,marginBottom:8,letterSpacing:0.5}}>CYCLE DATA @ {trendTp}% TAKE PROFIT</div>
        <SectionHead title="Cycles Heatmap" sub="Completed cycles by hour and date" info="Each cell shows how many buy-to-sell cycles completed in that hour at the specified take-profit %. Brighter green = more cycles. This is algorithm-specific data -- unlike ATR and volume which are universal market data. Different TP% values will show different cycle distributions."/>
        <div style={{overflowX:'auto',marginTop:8}}>
          <div style={{display:'grid',gridTemplateColumns:'70px repeat(16,1fr)',gap:1,minWidth:500}}>
            <div style={{fontSize:6,color:C.txtDim,fontFamily:F,padding:2}}></div>
            {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h2){return <div key={h2} style={{fontSize:6,color:(h2>=9&&h2<16)?'#e0eaf4':'#8a9aaa',fontFamily:F,textAlign:'center',padding:2}}>{hourLabels[String(h2)]}</div>;})}
            {data.allDates.map(function(dt){
              var dow=new Date(dt+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short'});
              return React.createElement(React.Fragment,{key:dt},[
                React.createElement('div',{key:dt+'l',style:{fontSize:7,color:'#d0dce8',fontFamily:F,padding:'3px 4px',whiteSpace:'nowrap'}},dow+' '+dt.substring(5)),
                [4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h2){
                  var val=(data.cyclesByDate[dt]&&data.cyclesByDate[dt][h2])||0;
                  var intensity=data.maxHourlyCycles>0?Math.min(val/data.maxHourlyCycles,1):0;
                  var bg=val>0?'rgba(0,229,160,'+(intensity*0.8+0.1)+')':'transparent';
                  return React.createElement('div',{key:dt+'-'+h2,style:{background:bg,borderRadius:2,padding:'2px 0',textAlign:'center',fontSize:6,color:val>0?'#ffffff':'#3a4a5a',fontFamily:F,minHeight:18,display:'flex',alignItems:'center',justifyContent:'center'}},val>0?val:'');
                })
              ]);
            })}
            {React.createElement('div',{key:'avg-label',style:{fontSize:7,color:C.accent,fontFamily:F,padding:'4px 4px',whiteSpace:'nowrap',fontWeight:700,borderTop:'1px solid '+C.accent}},'AVG')}
            {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h2){
              var avgVal=data.avgHourlyCycles[h2]||0;
              return React.createElement('div',{key:'avg-'+h2,style:{borderTop:'1px solid '+C.accent,borderRadius:2,padding:'2px 0',textAlign:'center',fontSize:6,color:C.accent,fontFamily:F,fontWeight:700,minHeight:18,display:'flex',alignItems:'center',justifyContent:'center'}},avgVal>0?avgVal.toFixed(1):'');
            })}
          </div>
        </div>
      </Cd>}
      <Cd>
        <SectionHead title="Volume Heatmap" sub="Shares traded by hour and date" info="Brighter blue = higher volume. Volume typically concentrates in the first and last hours of regular trading. Extended hours are usually much lighter."/>
        <div style={{marginTop:8}}><HeatMap getValue={function(hd){return hd.volume;}} max={data.maxVol} color="blue" format={function(v){return fmtVol(v);}}/></div>
      </Cd>
      <Cd>
        <SectionHead title="Trade Count Heatmap" sub="Executions by hour and date" info="Brighter gold = more individual trades. More trades means more data points for the cycle analysis and more opportunities for the algorithm to complete cycles."/>
        <div style={{marginTop:8}}><HeatMap getValue={function(hd){return hd.trades;}} max={data.maxTrades} color="gold" format={function(v){return fmtVol(v);}}/></div>
      </Cd>
      <Cd>
        <SectionHead title="Low to Next High Swing % Heatmap" sub="Previous hour low to next hour high" info="Each cell shows the percentage change from one hour's low to the following hour's high. Green = positive swing (price moved up). Red/dark = negative or flat. Reveals hour transition momentum patterns."/>
        <div style={{overflowX:'auto',marginTop:8}}>
          <div style={{display:'grid',gridTemplateColumns:'70px repeat(15,1fr)',gap:1,minWidth:480}}>
            <div style={{fontSize:6,color:C.txtDim,fontFamily:F,padding:2}}></div>
            {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18].map(function(h2){return <div key={h2} style={{fontSize:5,color:(h2>=9&&h2<16)?'#e0eaf4':'#8a9aaa',fontFamily:F,textAlign:'center',padding:2}}>{hourLabels[String(h2)]+'->'+hourLabels[String(h2+1)]}</div>;})}
            {data.allDates.map(function(dt){
              var dow=new Date(dt+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short'});
              return React.createElement(React.Fragment,{key:dt},[
                React.createElement('div',{key:dt+'l',style:{fontSize:7,color:'#d0dce8',fontFamily:F,padding:'3px 4px',whiteSpace:'nowrap'}},dow+' '+dt.substring(5)),
                [4,5,6,7,8,9,10,11,12,13,14,15,16,17,18].map(function(h2){
                  var curr=data.dates[dt][h2];var nxt=data.dates[dt][h2+1];
                  var swingPct=0;
                  if(curr&&nxt&&curr.low>0&&nxt.high>0){swingPct=((nxt.high-curr.low)/curr.low)*100;}
                  var isPos=swingPct>=0;
                  var intensity=Math.min(Math.abs(swingPct)/data.maxSwing,1);
                  var bg=swingPct===0?'transparent':isPos?'rgba(0,229,160,'+(intensity*0.8+0.1)+')':'rgba(255,92,58,'+(intensity*0.8+0.1)+')';
                  return React.createElement('div',{key:dt+'-'+h2,style:{background:bg,borderRadius:2,padding:'2px 0',textAlign:'center',fontSize:5,color:Math.abs(swingPct)>0?'#ffffff':'#3a4a5a',fontFamily:F,minHeight:18,display:'flex',alignItems:'center',justifyContent:'center'}},Math.abs(swingPct)>0?((isPos?'+':'')+swingPct.toFixed(1)):'');
                })
              ]);
            })}
            {React.createElement('div',{key:'avg-label',style:{fontSize:7,color:C.accent,fontFamily:F,padding:'4px 4px',whiteSpace:'nowrap',fontWeight:700,borderTop:'1px solid '+C.accent}},'AVG')}
            {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18].map(function(h2){
              var sum=0,cnt=0;
              for(var di=0;di<data.allDates.length;di++){
                var curr=data.dates[data.allDates[di]][h2];var nxt=data.dates[data.allDates[di]][h2+1];
                if(curr&&nxt&&curr.low>0&&nxt.high>0){sum+=((nxt.high-curr.low)/curr.low)*100;cnt++;}
              }
              var avgVal=cnt>0?sum/cnt:0;
              return React.createElement('div',{key:'avg-'+h2,style:{borderTop:'1px solid '+C.accent,borderRadius:2,padding:'2px 0',textAlign:'center',fontSize:5,color:C.accent,fontFamily:F,fontWeight:700,minHeight:18,display:'flex',alignItems:'center',justifyContent:'center'}},Math.abs(avgVal)>0?((avgVal>=0?'+':'')+avgVal.toFixed(1)):'');
            })}
          </div>
        </div>
      </Cd>
            <Cd>
        <SectionHead title="Day-over-Day Summary" sub="Daily totals across the range"/>
        <div style={{overflowX:'auto',marginTop:8}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:8,fontFamily:F}}>
            <thead><tr style={{borderBottom:'1px solid '+C.border}}>
              <th style={{padding:'4px 3px',color:'#a0b4c8',textAlign:'left'}}>Date</th>
              <th style={{padding:'4px 3px',color:'#a0b4c8',textAlign:'right'}}>ATR %</th>
              <th style={{padding:'4px 3px',color:'#a0b4c8',textAlign:'right'}}>Volume</th>
              <th style={{padding:'4px 3px',color:'#a0b4c8',textAlign:'right'}}>Trades</th>
              <th style={{padding:'4px 3px',color:'#a0b4c8',textAlign:'right'}}>Range $</th>
            </tr></thead>
            <tbody>{data.allDates.map(function(dt){
              var dayData=data.dates[dt];var totVol=0,totTrades=0,dayHigh=-Infinity,dayLow=Infinity,maxAP=0;
              for(var h2=4;h2<20;h2++){var hd=dayData[h2];if(hd){totVol+=hd.volume;totTrades+=hd.trades;if(hd.high>dayHigh)dayHigh=hd.high;if(hd.low>0&&hd.low<dayLow)dayLow=hd.low;if(hd.atrPct>maxAP)maxAP=hd.atrPct;}}
              var dayRange=(dayHigh>-Infinity&&dayLow<Infinity)?dayHigh-dayLow:0;
              var dayRangePct=(dayLow>0&&dayRange>0)?((dayRange/dayLow)*100):0;
              var dow=new Date(dt+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'short'});
              return <tr key={dt} style={{borderBottom:'1px solid '+C.grid}}>
                <td style={{padding:'4px 3px',color:'#e0eaf4'}}>{dow+' '+dt.substring(5)}</td>
                <td style={{padding:'4px 3px',color:C.accent,textAlign:'right'}}>{dayRangePct.toFixed(2)+'%'}</td>
                <td style={{padding:'4px 3px',color:C.blue,textAlign:'right'}}>{fmtVol(totVol)}</td>
                <td style={{padding:'4px 3px',color:C.gold,textAlign:'right'}}>{totTrades.toLocaleString()}</td>

              </tr>;
            })}</tbody>
          </table>
        </div>
      </Cd>
    </div>}
  </div>;
}
function SeasonalityPage(p){
  var s1=useState('SOXL'),ticker=s1[0],setTicker=s1[1];
  var s9s=useState('1'),seasTp=s9s[0],setSeasTp=s9s[1];
  var s2=useState(new Date().toISOString().split('T')[0]),date=s2[0],setDate=s2[1];
  var s3=useState(false),loading=s3[0],setLoading=s3[1];
  var s4=useState(''),prog=s4[0],setProg=s4[1];
  var s5=useState(null),err=s5[0],setErr=s5[1];
  var s6=useState(null),data=s6[0],setData=s6[1];
  var s7s=useState(''),sSource=s7s[0],setSSource=s7s[1];
  var s8s=useState([]),seasCycles=s8s[0],setSeasCycles=s8s[1];

  var run=async function(){
    if(!p.apiKey){setErr('Set your Polygon API key in Settings first');return;}
    setLoading(true);setErr(null);setData(null);setSSource('');setProg('Checking cache...');
    try{
      var sCached=await SB.loadSeasonality(ticker.toUpperCase(),date);
      if(sCached&&sCached.hourly.length>0){
        var labels={'4':'4AM','5':'5AM','6':'6AM','7':'7AM','8':'8AM','9':'9AM','10':'10AM','11':'11AM','12':'12PM','13':'1PM','14':'2PM','15':'3PM','16':'4PM','17':'5PM','18':'6PM','19':'7PM'};
        var cCD=sCached.hourly.map(function(h){return{hour:labels[String(h.hour)]||String(h.hour),atr:parseFloat(h.atr)||0,atrPct:parseFloat(h.atr_pct)||0,volume:parseInt(h.volume)||0,trades:parseInt(h.trades)||0,isRTH:(h.hour>=9&&h.hour<16)?1:0,low:h.low?parseFloat(h.low):0,high:h.high?parseFloat(h.high):0};});
        var cSess={pre:{min:Infinity,max:-Infinity,vol:0,trades:0},reg:{min:Infinity,max:-Infinity,vol:0,trades:0},post:{min:Infinity,max:-Infinity,vol:0,trades:0}};
        sCached.sessions.forEach(function(s){var t=s.session_type==='pre'?cSess.pre:s.session_type==='reg'?cSess.reg:cSess.post;if(s.low)t.min=parseFloat(s.low);if(s.high)t.max=parseFloat(s.high);t.vol=parseInt(s.volume)||0;t.trades=parseInt(s.trades)||0;});
        var cMin=Infinity,cMax=-Infinity;cCD.forEach(function(d){if(d.low>0&&d.low<cMin)cMin=d.low;if(d.high>0&&d.high>cMax)cMax=d.high;});
        setData({sessions:cSess,chartData:cCD,totalTrades:0,allMin:cMin,allMax:cMax});
        var scHC=await SB.loadHourlyCycles(ticker.toUpperCase(),date,parseFloat(seasTp)||1,'all');
        if(scHC)setSeasCycles(scHC);
        setSSource('cache');setProg('');setLoading(false);return;
      }
      setProg('Fetching trades...');
      var allTrades=[],url='https://api.polygon.io/v3/trades/'+ticker.toUpperCase()+'?timestamp.gte='+date+'T04:00:00.000Z&timestamp.lt='+date+'T23:59:59.000Z&limit=50000&sort=timestamp&order=asc&apiKey='+p.apiKey;
      var pages=0;
      while(url){var r=await fetch(url);if(!r.ok)throw new Error('API error '+r.status);var d=await r.json();if(d.results)for(var i=0;i<d.results.length;i++){var t=d.results[i];allTrades.push({price:t.price,size:t.size||0,ts:t.sip_timestamp||t.participant_timestamp});}url=d.next_url?(d.next_url+'&apiKey='+p.apiKey):null;pages++;setProg('Fetching... '+allTrades.length.toLocaleString()+' trades (page '+pages+')');}
      if(!allTrades.length)throw new Error('No trades found.');
      setProg('Processing...');
      await new Promise(function(r){setTimeout(r,50);});

      // Convert timestamps and bucket
      var toET=function(ts){var ms;if(ts>1e15)ms=ts/1e6;else if(ts>1e12)ms=ts/1e3;else ms=ts;var d2=new Date(ms);var h=d2.getUTCHours()-4;if(h<0)h+=24;var m=d2.getUTCMinutes();return{h:h,m:m,totalMin:h*60+m};};

      // Session ranges
      var sessions={pre:{min:Infinity,max:-Infinity,vol:0,trades:0},reg:{min:Infinity,max:-Infinity,vol:0,trades:0},post:{min:Infinity,max:-Infinity,vol:0,trades:0}};
      // Hourly buckets: key = hour start (e.g. "04","05"..."19")
      var hourly={};
      for(var h=4;h<20;h++){var hk=String(h).padStart(2,'0');hourly[hk]={high:-Infinity,low:Infinity,vol:0,trades:0};}

      for(var i=0;i<allTrades.length;i++){
        var t=allTrades[i];var et=toET(t.ts);var pr=t.price;var sz=t.size;
        // Session
        if(et.totalMin<570){sessions.pre.trades++;sessions.pre.vol+=sz;if(pr<sessions.pre.min)sessions.pre.min=pr;if(pr>sessions.pre.max)sessions.pre.max=pr;}
        else if(et.totalMin<960){sessions.reg.trades++;sessions.reg.vol+=sz;if(pr<sessions.reg.min)sessions.reg.min=pr;if(pr>sessions.reg.max)sessions.reg.max=pr;}
        else{sessions.post.trades++;sessions.post.vol+=sz;if(pr<sessions.post.min)sessions.post.min=pr;if(pr>sessions.post.max)sessions.post.max=pr;}
        // Hourly
        var hk=String(et.h).padStart(2,'0');
        if(hourly[hk]){hourly[hk].trades++;hourly[hk].vol+=sz;if(pr>hourly[hk].high)hourly[hk].high=pr;if(pr<hourly[hk].low)hourly[hk].low=pr;}
      }

      // Build chart data
      var chartData=[];
      var labels={'04':'4AM','05':'5AM','06':'6AM','07':'7AM','08':'8AM','09':'9AM','10':'10AM','11':'11AM','12':'12PM','13':'1PM','14':'2PM','15':'3PM','16':'4PM','17':'5PM','18':'6PM','19':'7PM'};
      for(var h=4;h<20;h++){
        var hk=String(h).padStart(2,'0');
        var hd=hourly[hk];
        var atr=(hd.high>-Infinity&&hd.low<Infinity)?(hd.high-hd.low):0;
        var atrPct=(hd.low>0&&atr>0)?((atr/hd.low)*100):0;
        chartData.push({hour:labels[hk]||hk,atr:Math.round(atr*10000)/10000,atrPct:Math.round(atrPct*100)/100,volume:hd.vol,trades:hd.trades,isRTH:(h>=9&&h<16)?1:0,low:hd.low<Infinity?hd.low:0,high:hd.high>-Infinity?hd.high:0});
      }

      // Overall
      var allMin=Infinity,allMax=-Infinity;
      for(var i=0;i<allTrades.length;i++){if(allTrades[i].price<allMin)allMin=allTrades[i].price;if(allTrades[i].price>allMax)allMax=allTrades[i].price;}

      setData({sessions:sessions,chartData:chartData,totalTrades:allTrades.length,allMin:allMin,allMax:allMax});
      setSSource('polygon');
      SB.saveSeasonality(ticker.toUpperCase(),date,chartData,sessions);
      // Load hourly cycles if cached (from a previous analysis run)
      var scHC2=await SB.loadHourlyCycles(ticker.toUpperCase(),date,parseFloat(seasTp)||1,'all');
      if(scHC2)setSeasCycles(scHC2);
      setProg('');
    }catch(e){setErr(e.message);setProg('');}finally{setLoading(false);}
  };



  var fmtVol=function(v){if(v>=1e6)return (v/1e6).toFixed(1)+'M';if(v>=1e3)return (v/1e3).toFixed(0)+'K';return v.toString();};
  var fmtRange=function(s){if(s.min===Infinity)return{range:'-',pct:'-',low:'-',high:'-'};var r2=s.max-s.min;return{range:'$'+r2.toFixed(2),pct:((r2/s.min)*100).toFixed(2)+'%',low:'$'+s.min.toFixed(2),high:'$'+s.max.toFixed(2)};};

  var SessionRow=function(props){var f=fmtRange(props.s);return <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',gap:4,padding:'6px 0',borderBottom:'1px solid '+C.grid,fontSize:8,fontFamily:F}}>
    <div style={{color:props.color,fontWeight:700}}>{props.label}</div>
    <div style={{color:'#f0f6fc',textAlign:'right'}}>{f.range}</div>
    <div style={{color:'#c0d0e0',textAlign:'right'}}>{f.pct}</div>
    <div style={{color:'#c0d0e0',textAlign:'right'}}>{fmtVol(props.s.vol)}</div>
    <div style={{color:'#c0d0e0',textAlign:'right'}}>{props.s.trades.toLocaleString()}</div>
  </div>;};

  return <div>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Intraday Seasonality</div>
    </div>
    <Cd>
      <SectionHead title="Parameters" sub="Select stock and date" info="Fetches all trade ticks and breaks them down by hour to reveal intraday patterns in volatility, volume, and trading activity across pre-market, regular, and post-market sessions."/>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:10,marginBottom:10}}>
        <div><label style={lS}>Ticker</label><input value={ticker} onChange={function(e){setTicker(e.target.value.toUpperCase());}} style={iS}/></div>
        <div><label style={lS}>Date</label><input type="date" value={date} onChange={function(e){setDate(e.target.value);}} style={iS}/></div>
        <div><label style={lS}>TP %</label><input type="text" inputMode="decimal" value={seasTp} onChange={function(e){setSeasTp(e.target.value);}} style={iS}/></div>
      </div>
      <button onClick={run} disabled={loading} style={Object.assign({},bB,{background:loading?C.border:'linear-gradient(135deg,#00e5a0,#00c488)',color:loading?C.txtDim:C.bg})}>{loading?'Running...':'Analyze'}</button>
      {prog&&<div style={{marginTop:8,color:C.accent,fontSize:10}}>{prog}</div>}
      {err&&<div style={{marginTop:8,padding:'8px 10px',background:C.warnDim,border:'1px solid #ff5c3a30',borderRadius:6,color:C.warn,fontSize:10}}>{err}</div>}
    </Cd>
    {data&&<div>
      <Cd glow={true}>
        <SectionHead title="Session Ranges" sub={ticker+' · '+date+(sSource==='cache'?' · From Cache':sSource==='polygon'?' · Live Data':'')}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:10,marginBottom:12}}>
          <Mt label="Day Low" value={'$'+data.allMin.toFixed(2)} color={C.warn} size="md"/>
          <Mt label="Day High" value={'$'+data.allMax.toFixed(2)} color={C.accent} size="md"/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:14}}>
          <Mt label="Day Range" value={'$'+(data.allMax-data.allMin).toFixed(2)} color={C.gold} size="lg"/>
          <Mt label="Range %" value={((data.allMax-data.allMin)/data.allMin*100).toFixed(2)+'%'} color={C.gold} size="lg"/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr',gap:4,padding:'6px 0',borderBottom:'1px solid '+C.border,fontSize:7,fontFamily:F,color:'#8899aa'}}>
          <div>Session</div><div style={{textAlign:'right'}}>Range</div><div style={{textAlign:'right'}}>%</div><div style={{textAlign:'right'}}>Volume</div><div style={{textAlign:'right'}}>Trades</div>
        </div>
        <SessionRow label="Pre-Market" s={data.sessions.pre} color={C.purple}/>
        <SessionRow label="Regular" s={data.sessions.reg} color={C.accent}/>
        <SessionRow label="Post-Market" s={data.sessions.post} color={C.blue}/>
      </Cd>
      <div>
        <Cd>
          <SectionHead title="Hourly ATR" sub="Price range per hour ($)" info="ATR shows how much the price moved within each hour. Taller bars = more volatile hours."/>
          <div style={{marginTop:8}}>{data.chartData.map(function(d){
            var maxATR=0;for(var q=0;q<data.chartData.length;q++){if(data.chartData[q].atr>maxATR)maxATR=data.chartData[q].atr;}
            var pct=maxATR>0?(d.atr/maxATR*100):0;
            return <div key={d.hour} style={{display:'flex',alignItems:'flex-end',gap:0,marginBottom:1}}>
              <div style={{width:36,fontSize:7,color:'#a0b4c8',fontFamily:F,textAlign:'right',paddingRight:4,flexShrink:0}}>{d.hour}</div>
              <div style={{flex:1,position:'relative',height:16}}>
                <div style={{position:'absolute',left:0,bottom:0,height:'100%',width:pct+'%',background:d.isRTH?C.accent:'#3a4a5c',borderRadius:'0 2px 2px 0',minWidth:d.atr>0?2:0}}></div>
              </div>
              <div style={{width:44,fontSize:7,color:'#e8f0f8',fontFamily:F,textAlign:'right',paddingLeft:4,flexShrink:0}}>{'$'+d.atr.toFixed(3)}</div>
            </div>;})}
          </div>
        </Cd>
        <Cd>
          <SectionHead title="Hourly Price Range ($)" sub="High and low price each hour" info="Shows the exact high and low price within each hour. The bar width represents the dollar range. Wider bars = more price movement that hour."/>
          <div style={{marginTop:8}}>{data.chartData.map(function(d){
            if(d.atr===0)return <div key={d.hour} style={{display:'flex',alignItems:'center',marginBottom:2}}>
              <div style={{width:36,fontSize:7,color:'#a0b4c8',fontFamily:F,textAlign:'right',paddingRight:4,flexShrink:0}}>{d.hour}</div>
              <div style={{flex:1,fontSize:7,color:'#4a5568',fontFamily:F,paddingLeft:4}}>No trades</div>
            </div>;
            var allLows=data.chartData.filter(function(x){return x.atr>0;}).map(function(x){return x.low;});
            var allHighs=data.chartData.filter(function(x){return x.atr>0;}).map(function(x){return x.high;});
            var gMin=Math.min.apply(null,allLows);var gMax=Math.max.apply(null,allHighs);
            var span=gMax-gMin;if(span===0)span=1;
            var leftPct=((d.low-gMin)/span)*100;
            var widthPct=((d.high-d.low)/span)*100;
            if(widthPct<1)widthPct=1;
            return <div key={d.hour} style={{display:'flex',alignItems:'center',marginBottom:2}}>
              <div style={{width:36,fontSize:7,color:'#a0b4c8',fontFamily:F,textAlign:'right',paddingRight:4,flexShrink:0}}>{d.hour}</div>
              <div style={{flex:1,position:'relative',height:18}}>
                <div style={{position:'absolute',left:leftPct+'%',width:widthPct+'%',top:2,bottom:2,background:d.isRTH?C.accent:'#3a4a5c',borderRadius:2,minWidth:3}}></div>
              </div>
              <div style={{width:90,display:'flex',gap:4,flexShrink:0,paddingLeft:4}}>
                <span style={{fontSize:7,color:C.warn,fontFamily:F}}>{'$'+d.low.toFixed(2)}</span>
                <span style={{fontSize:7,color:'#4a5568',fontFamily:F}}>-</span>
                <span style={{fontSize:7,color:C.accent,fontFamily:F}}>{'$'+d.high.toFixed(2)}</span>
              </div>
            </div>;})}
          </div>
        </Cd>
        <Cd>
          <SectionHead title="Hourly Price Range (%)" sub="Range as percentage of hour low" info="Same range data expressed as a percentage of each hour's low price. This normalizes the volatility so you can compare hours fairly regardless of absolute price level."/>
          <div style={{marginTop:8}}>{data.chartData.map(function(d){
            if(d.atrPct===0)return <div key={d.hour} style={{display:'flex',alignItems:'center',marginBottom:2}}>
              <div style={{width:36,fontSize:7,color:'#a0b4c8',fontFamily:F,textAlign:'right',paddingRight:4,flexShrink:0}}>{d.hour}</div>
              <div style={{flex:1,fontSize:7,color:'#4a5568',fontFamily:F,paddingLeft:4}}>No trades</div>
            </div>;
            var maxAP2=0;for(var q=0;q<data.chartData.length;q++){if(data.chartData[q].atrPct>maxAP2)maxAP2=data.chartData[q].atrPct;}
            var pct=maxAP2>0?(d.atrPct/maxAP2*100):0;
            return <div key={d.hour} style={{display:'flex',alignItems:'center',marginBottom:2}}>
              <div style={{width:36,fontSize:7,color:'#a0b4c8',fontFamily:F,textAlign:'right',paddingRight:4,flexShrink:0}}>{d.hour}</div>
              <div style={{flex:1,position:'relative',height:18}}>
                <div style={{position:'absolute',left:0,top:2,bottom:2,width:pct+'%',background:d.isRTH?C.purple:'#3a4a5c',borderRadius:'0 2px 2px 0',minWidth:d.atrPct>0?3:0}}></div>
              </div>
              <div style={{width:90,display:'flex',gap:4,flexShrink:0,paddingLeft:4}}>
                <span style={{fontSize:7,color:'#e8f0f8',fontFamily:F,fontWeight:700}}>{d.atrPct.toFixed(2)+'%'}</span>
                <span style={{fontSize:7,color:'#6a7a8a',fontFamily:F}}>{'($'+d.atr.toFixed(2)+')'}</span>
              </div>
            </div>;})}
          </div>
        </Cd>
                <Cd>
          <SectionHead title="Low to Next High Swing %" sub="Previous hour low to next hour high" info="Measures the percentage change from one hour's lowest price to the following hour's highest price. Positive values mean price swung upward. Negative values mean the next hour's high was still below the previous hour's low. This captures the maximum potential swing opportunity between consecutive hours."/>
          <div style={{marginTop:8}}>{(function(){
            var swings=[];
            for(var si=0;si<data.chartData.length-1;si++){
              var curr=data.chartData[si];var nxt=data.chartData[si+1];
              if(curr.low>0&&nxt.high>0){
                var swingPct=((nxt.high-curr.low)/curr.low)*100;
                swings.push({fromHour:curr.hour,toHour:nxt.hour,pct:Math.round(swingPct*100)/100,low:curr.low,high:nxt.high});
              }
            }
            var maxAbs=0;for(var si2=0;si2<swings.length;si2++){var ab=Math.abs(swings[si2].pct);if(ab>maxAbs)maxAbs=ab;}
            if(maxAbs===0)maxAbs=1;
            return swings.map(function(sw){
              var barPct=(Math.abs(sw.pct)/maxAbs)*50;
              var isPos=sw.pct>=0;
              return React.createElement('div',{key:sw.fromHour,style:{display:'flex',alignItems:'center',marginBottom:2}},
                React.createElement('div',{style:{width:62,fontSize:7,color:'#a0b4c8',fontFamily:F,textAlign:'right',paddingRight:4,flexShrink:0}},sw.fromHour+' → '+sw.toHour),
                React.createElement('div',{style:{flex:1,position:'relative',height:18}},
                  React.createElement('div',{style:{position:'absolute',left:'50%',top:0,bottom:0,width:1,background:'#2a3a4a'}}),
                  isPos?React.createElement('div',{style:{position:'absolute',left:'50%',top:3,bottom:3,width:barPct+'%',background:C.accent,borderRadius:'0 2px 2px 0'}}):
                  React.createElement('div',{style:{position:'absolute',right:'50%',top:3,bottom:3,width:barPct+'%',background:C.warn,borderRadius:'2px 0 0 2px'}})
                ),
                React.createElement('div',{style:{width:100,display:'flex',gap:3,flexShrink:0,paddingLeft:4}},
                  React.createElement('span',{style:{fontSize:7,color:isPos?C.accent:C.warn,fontFamily:F,fontWeight:700}},(isPos?'+':'')+sw.pct.toFixed(2)+'%'),
                  React.createElement('span',{style:{fontSize:6,color:'#6a7a8a',fontFamily:F}},'$'+sw.low.toFixed(2)+'→$'+sw.high.toFixed(2))
                )
              );
            });
          })()}</div>
        </Cd>
                {seasCycles.length>0&&<Cd glow={true}>
          <div style={{display:'inline-block',background:C.accentDim,border:'1px solid '+C.accent,borderRadius:4,padding:'2px 8px',fontSize:7,color:C.accent,fontFamily:F,fontWeight:700,marginBottom:8,letterSpacing:0.5}}>CYCLE DATA @ {seasTp}% TAKE PROFIT</div>
          <SectionHead title="Cycles by Hour" sub={ticker+' · '+date} info="Shows completed buy-to-sell cycles per hour at the specified take-profit percentage. This is algorithm-specific data tied to the TP% -- unlike ATR, volume, and trades which are universal market data. Requires running a cycle analysis (main page or batch process) for this ticker/date/TP% first."/>
          <div style={{marginTop:8}}>{seasCycles.map(function(d){
            var maxCy=0;for(var q=0;q<seasCycles.length;q++){if(seasCycles[q].cycles>maxCy)maxCy=seasCycles[q].cycles;}
            var pct=maxCy>0?(d.cycles/maxCy*100):0;
            return <div key={d.hour} style={{display:'flex',alignItems:'center',marginBottom:1}}>
              <div style={{width:36,fontSize:7,color:'#c0d4e8',fontFamily:F,textAlign:'right',paddingRight:4,flexShrink:0}}>{d.hour}</div>
              <div style={{flex:1,position:'relative',height:16}}>
                <div style={{position:'absolute',left:0,top:2,bottom:2,width:pct+'%',background:d.isRTH?C.accent:'#506878',borderRadius:'0 2px 2px 0',minWidth:d.cycles>0?2:0}}></div>
              </div>
              <div style={{width:32,fontSize:8,color:d.cycles>0?C.accent:'#3a4a5a',fontFamily:F,textAlign:'right',paddingLeft:4,fontWeight:700,flexShrink:0}}>{d.cycles>0?d.cycles:''}</div>
            </div>;})}
          </div>
        </Cd>}
        <Cd>
          <SectionHead title="Hourly Volume" sub="Total shares traded per hour" info="Shows total shares traded each hour. High volume = better liquidity for cycle execution."/>
          <div style={{marginTop:8}}>{data.chartData.map(function(d){
            var maxV=0;for(var q=0;q<data.chartData.length;q++){if(data.chartData[q].volume>maxV)maxV=data.chartData[q].volume;}
            var pct=maxV>0?(d.volume/maxV*100):0;
            return <div key={d.hour} style={{display:'flex',alignItems:'flex-end',gap:0,marginBottom:1}}>
              <div style={{width:36,fontSize:7,color:'#a0b4c8',fontFamily:F,textAlign:'right',paddingRight:4,flexShrink:0}}>{d.hour}</div>
              <div style={{flex:1,position:'relative',height:16}}>
                <div style={{position:'absolute',left:0,bottom:0,height:'100%',width:pct+'%',background:d.isRTH?C.blue:'#3a4a5c',borderRadius:'0 2px 2px 0',minWidth:d.volume>0?2:0}}></div>
              </div>
              <div style={{width:44,fontSize:7,color:'#e8f0f8',fontFamily:F,textAlign:'right',paddingLeft:4,flexShrink:0}}>{fmtVol(d.volume)}</div>
            </div>;})}
          </div>
        </Cd>
        <Cd>
          <SectionHead title="Hourly Trades" sub="Number of trade executions per hour" info="Each trade is a single exchange transaction. More trades = more cycle opportunities."/>
          <div style={{marginTop:8}}>{data.chartData.map(function(d){
            var maxT=0;for(var q=0;q<data.chartData.length;q++){if(data.chartData[q].trades>maxT)maxT=data.chartData[q].trades;}
            var pct=maxT>0?(d.trades/maxT*100):0;
            return <div key={d.hour} style={{display:'flex',alignItems:'flex-end',gap:0,marginBottom:1}}>
              <div style={{width:36,fontSize:7,color:'#a0b4c8',fontFamily:F,textAlign:'right',paddingRight:4,flexShrink:0}}>{d.hour}</div>
              <div style={{flex:1,position:'relative',height:16}}>
                <div style={{position:'absolute',left:0,bottom:0,height:'100%',width:pct+'%',background:d.isRTH?C.gold:'#3a4a5c',borderRadius:'0 2px 2px 0',minWidth:d.trades>0?2:0}}></div>
              </div>
              <div style={{width:44,fontSize:7,color:'#e8f0f8',fontFamily:F,textAlign:'right',paddingLeft:4,flexShrink:0}}>{d.trades.toLocaleString()}</div>
            </div>;})}
          </div>
        </Cd>
      </div>
    </div>}
  </div>;
}
function UploadPage(p){
  var fs=useState(null),fileData=fs[0],setFileData=fs[1];
  var ts=useState(p.tpPct.toString()),tp=ts[0],setTp=ts[1];
  var rs=useState(null),result=rs[0],setResult=rs[1];
  var es=useState(null),err=es[0],setErr=es[1];
  var as=useState([]),audit=as[0],setAudit=as[1];
  var ps=useState(false),processing=ps[0],setProcessing=ps[1];

  var parseCSV=function(text){
    var lines=text.trim().split('\n');
    var trades=[];
    // Detect header
    var start=0;
    var first=lines[0].toLowerCase();
    if(first.indexOf('price')>=0||first.indexOf('tick')>=0||first.indexOf('#')>=0)start=1;
    for(var i=start;i<lines.length;i++){
      var cols=lines[i].split(',');
      var price=null;
      // Try to find a price value in each column
      for(var c=0;c<cols.length;c++){
        var val=cols[c].trim().replace('$','');
        var num=parseFloat(val);
        if(!isNaN(num)&&num>0&&num<100000){
          // If we haven't found price yet, or this looks like a price column
          if(price===null||(num>0.01&&num<100000)){
            price=num;
            break; // take first valid number as price
          }
        }
      }
      if(price!==null)trades.push({price:price,ts:i});
    }
    return trades;
  };

  var handleFile=function(e){
    var file=e.target.files[0];
    if(!file)return;
    setErr(null);setResult(null);setAudit([]);
    var reader=new FileReader();
    reader.onload=function(ev){
      try{
        var trades=parseCSV(ev.target.result);
        if(trades.length<2){setErr('Need at least 2 rows of price data');return;}
        setFileData({name:file.name,trades:trades,raw:ev.target.result});
      }catch(ex){setErr('Failed to parse CSV: '+ex.message);}
    };
    reader.readAsText(file);
  };

  var runAnalysis=function(){
    if(!fileData||!fileData.trades.length){setErr('Upload a CSV file first');return;}
    var tpVal=parseFloat(tp);
    if(!tpVal||tpVal<=0){setErr('Enter a valid take-profit %');return;}
    setProcessing(true);setErr(null);
    try{
      var trades=fileData.trades;
      var res=analyzePriceLevels(trades,tpVal);
      setResult(res);
      // Build audit
      var tf=tpVal/100;
      var minP=Infinity,maxP=-Infinity;
      for(var z=0;z<trades.length;z++){if(trades[z].price<minP)minP=trades[z].price;if(trades[z].price>maxP)maxP=trades[z].price;}
      var minCents=Math.round(Math.floor(minP*100)),maxCents=Math.round(Math.ceil(maxP*100));
      var openLvl=Math.floor(trades[0].price*100)/100;
      var preSeedMax=Math.round(openLvl*1.01*100)/100;
      var count2=maxCents-minCents+1;
      var la=new Uint8Array(count2);var lt=new Float64Array(count2);var lp2=new Float64Array(count2);var lc=new Int32Array(count2);
      var openC=Math.round(openLvl*100),psmc=Math.round(preSeedMax*100);
      for(var c=0;c<count2;c++){var cn=minCents+c;lp2[c]=cn/100;lt[c]=Math.ceil(lp2[c]*(1+tf)*100)/100;la[c]=(cn>=openC&&cn<=psmc)?1:0;}
      var evts=[];var rc=0;
      for(var i=0;i<trades.length;i++){
        var pr=trades[i].price;
        var ev={idx:i+1,price:pr,events:[]};
        if(i===0){ev.events.push({type:'open',text:'OPENING TICK $'+pr.toFixed(4)+' | Pre-seed $'+openLvl.toFixed(2)+' to $'+preSeedMax.toFixed(2)});}
        else{
          for(var j=0;j<count2;j++){if(la[j]===1&&pr>=lt[j]){lc[j]++;la[j]=0;rc++;ev.events.push({type:'sell',text:'SELL $'+lp2[j].toFixed(2)+' hit $'+lt[j].toFixed(2)+' (cycle #'+lc[j]+', total:'+rc+')'});}}
          var bidx=Math.floor(pr*100)-minCents;
          if(bidx>=0&&bidx<count2&&la[bidx]===0){la[bidx]=1;ev.events.push({type:'buy',text:'BUY $'+lp2[bidx].toFixed(2)+' (target $'+lt[bidx].toFixed(2)+')'});}
        }
        if(ev.events.length===0)ev.events.push({type:'tick',text:'-'});
        evts.push(ev);
      }
      setAudit(evts);
    }catch(ex){setErr('Analysis error: '+ex.message);}
    setProcessing(false);
  };

  return <div>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Verify Logic Data Upload</div>
    </div>
    <Cd>
      <SectionHead title="Logic Verification" sub="Upload your own data to cross-check cycle counts" info="Upload a CSV file with price data (even 10-20 rows). The app runs the exact same cycle analysis logic against your data. Compare the results against your own manual count to verify the algorithm is correct."/>
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.7,marginTop:8,marginBottom:12}}>
        Upload a CSV file containing trade prices. The file should have at least a column with price values. The app will parse the prices, run the same analysis engine used for live Polygon data, and show you step-by-step how every cycle was counted so you can cross-check against your own manual calculation.
      </div>
      <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:12}}>
        <p style={{color:C.txtBright,fontWeight:700,fontSize:9,marginBottom:6}}>Accepted CSV formats:</p>
        <p style={{color:C.txt,fontSize:9,marginBottom:2}}>Single column: <span style={{color:C.accent}}>price</span></p>
        <p style={{color:C.txt,fontSize:9,marginBottom:2}}>Multi column: <span style={{color:C.accent}}>trade#, price</span></p>
        <p style={{color:C.txt,fontSize:9}}>With header or without — auto-detected</p>
      </div>
    </Cd>
    <Cd>
      <SectionHead title="Upload File" sub="Select your CSV file"/>
      <input type="file" accept=".csv,.txt" onChange={handleFile} style={{color:C.txt,fontSize:10,fontFamily:F,marginBottom:10,width:'100%'}}/>
      {fileData&&<div style={{color:C.accent,fontSize:10,fontFamily:F,marginBottom:10}}>Loaded: {fileData.name} ({fileData.trades.length} price rows)</div>}
      <div style={{marginBottom:10}}>
        <label style={lS}>Take Profit %</label>
        <input type="text" inputMode="decimal" value={tp} onChange={function(e){setTp(e.target.value);}} style={iS}/>
      </div>
      <button onClick={runAnalysis} disabled={processing||!fileData} style={Object.assign({},bB,{background:(!fileData||processing)?C.border:'linear-gradient(135deg,#00e5a0,#00c488)',color:(!fileData||processing)?C.txtDim:C.bg})}>{processing?'Processing...':'Analyze Uploaded Data'}</button>
      {err&&<div style={{marginTop:8,padding:'8px 10px',background:C.warnDim,border:'1px solid #ff5c3a30',borderRadius:6,color:C.warn,fontSize:10}}>{err}</div>}
    </Cd>
    {result&&<div>
      <Cd glow={true}>
        <SectionHead title="Upload Results" sub={fileData.name+' | '+tp+'% TP'}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:10}}>
          <Mt label="Total Cycles" value={result.summary.totalCycles} color={C.accent} size="lg"/>
          <Mt label="Active Levels" value={result.summary.activeLevels} color={C.blue} size="md"/>
          <Mt label="All Levels" value={result.summary.totalLevels} color={C.purple} size="md"/>
        </div>
      </Cd>
      <Cd>
        <SectionHead title="Level Detail" sub="Cycle count per level"/>
        <div style={{overflowX:'auto',maxHeight:300}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:9,fontFamily:F}}>
            <thead><tr style={{borderBottom:'1px solid '+C.border}}>
              {['Level','Target','Cycles'].map(function(h){return <th key={h} style={{padding:'5px 4px',color:C.txtDim,textAlign:'right',fontWeight:600}}>{h}</th>;})}
            </tr></thead>
            <tbody>{result.levels.filter(function(l){return l.cycles>0;}).map(function(l){return <tr key={l.price} style={{borderBottom:'1px solid '+C.grid}}>
              <td style={{padding:'5px 4px',textAlign:'right',color:C.txtBright,fontWeight:700}}>{'$'+l.price.toFixed(2)}</td>
              <td style={{padding:'5px 4px',textAlign:'right',color:C.txt}}>{'$'+l.target.toFixed(2)}</td>
              <td style={{padding:'5px 4px',textAlign:'right',color:C.accent,fontWeight:700}}>{l.cycles}</td>
            </tr>;})}</tbody>
          </table>
        </div>
      </Cd>
      <Cd>
        <SectionHead title="Step-by-Step Audit" sub="Every row from your uploaded data"/>
        <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.6,marginBottom:8,padding:'8px 10px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          Compare each row below against your own manual count. Every BUY and SELL event shows exactly which level triggered and why.
        </div>
        <div style={{overflowX:'auto',maxHeight:500}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:8,fontFamily:F}}>
            <thead><tr style={{borderBottom:'1px solid '+C.border}}>
              <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'left',fontWeight:600}}>#</th>
              <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'right',fontWeight:600}}>Price</th>
              <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'left',fontWeight:600}}>Event</th>
            </tr></thead>
            <tbody>{audit.map(function(ev){
              return ev.events.map(function(e,ei){
                var rowColor=e.type==='sell'?C.gold:e.type==='buy'?C.blue:e.type==='open'?C.accent:C.txtDim;
                return <tr key={ev.idx+'-'+ei} style={{borderBottom:ei===0?'1px solid '+C.grid:'none',background:e.type==='sell'?'#ffb02008':'transparent'}}>
                  <td style={{padding:'3px',color:C.txtDim,fontSize:7}}>{ei===0?ev.idx:''}</td>
                  <td style={{padding:'3px',color:C.txtBright,fontWeight:700,textAlign:'right'}}>{ei===0?'$'+ev.price.toFixed(4):''}</td>
                  <td style={{padding:'3px',color:rowColor,fontSize:7,lineHeight:1.4}}>{e.text}</td>
                </tr>;
              });
            })}</tbody>
          </table>
        </div>
      </Cd>
    </div>}
  </div>;
}
function CollapseStage(p){
  var s=useState(false),open=s[0],setOpen=s[1];
  return <Cd glow={p.glow} style={p.style}>
    <div onClick={function(){setOpen(!open);}} style={{display:'flex',alignItems:'center',cursor:'pointer'}}>
      <div style={{flex:1}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
          <div style={{color:C.txtBright,fontSize:12,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>{p.title}</div>
          {p.badge&&<div style={{display:'inline-block',padding:'2px 8px',background:p.badgeBg||C.accentDim,border:'1px solid '+(p.badgeColor||C.accent),borderRadius:4,color:p.badgeColor||C.accent,fontSize:7,fontWeight:700,fontFamily:F,letterSpacing:0.8,textTransform:'uppercase'}}>{p.badge}</div>}
        </div>
        <div style={{color:C.txt,fontSize:10,fontFamily:F}}>{p.sub}</div>
      </div>
      <div style={{color:C.accent,fontSize:22,fontWeight:300,lineHeight:1,transition:'transform 0.2s',transform:open?'rotate(45deg)':'none',flexShrink:0,marginLeft:8}}>+</div>
    </div>
    {open&&<div style={{marginTop:12}}>{p.children}</div>}
  </Cd>;
}
function ObjectivesPage(p){
  return <div>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Quant App Objectives</div>
    </div>
    <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.7,marginBottom:14}}>
      This application is being developed in structured stages, each building on the previous to create a comprehensive quantitative analysis and trading intelligence platform for the Beta Proprietary Algorithm.
    </div>
    <CollapseStage glow={true} title="Stage 1" sub="Quantitative Measurements and Analysis" badge="Current Stage" badgeColor={C.accent} badgeBg={C.accentDim}>
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:6}}>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Objective</p>
        <p style={{marginBottom:10}}>Perform quantitative time series analysis of the Beta Proprietary Algorithm against historical trade tick data from US stock exchanges. The goal is to measure and assess the total number of buy-sell oscillation cycles that occurred at each $0.01 price level for any given stock, on any given trading day, at any adjustable take-profit percentage.</p>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>What This Stage Measures</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6}}><span style={{color:C.accent,fontWeight:700}}>Total Market Oscillations:</span> The complete count of price oscillation cycles across all exchanges, representing the theoretical maximum number of cycles the market produced at each price level. This is derived from the consolidated tape of every trade tick executed across NYSE, NASDAQ, IEX, ARCA, BATS, and all other US venues.</p>
          <p><span style={{color:C.blue,fontWeight:700}}>Captured Oscillations:</span> The subset of those market oscillations that our Alpha Trader System would have captured, accounting for the algorithm entry logic (pre-seeded ladder from open +1%), limit order fill rules (sub-penny precision), and sequential time series execution order.</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Key Capabilities</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>1.</span> Fetch and process every trade tick for any US-listed stock on any historical trading day</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>2.</span> Adjustable take-profit parameter to test different cycle capture rates</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>3.</span> Session filtering (all hours vs regular hours only)</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>4.</span> Per-level cycle counting with independent P&L tracking</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>5.</span> Trade-by-trade audit trail with full data export for independent cross-verification</p>
          <p><span style={{color:C.accent}}>6.</span> Market data overlay (OHLC, volume, ATR%) for contextual analysis</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Why This Matters</p>
        <p style={{marginBottom:10}}>By comparing total market oscillations against the cycles our Alpha Trader System captures, we can quantify the algorithm efficiency ratio: what percentage of available market oscillations are we capturing? This metric is critical for evaluating algorithm performance, optimizing the take-profit parameter, and identifying which stocks and market conditions produce the highest capture rates.</p>
        <p style={{marginBottom:10}}>This stage provides the empirical foundation for all subsequent development. Every optimization, parameter tuning, and strategy decision in later stages will be grounded in the data measured here.</p>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Deliverables</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Cycle count per price level with adjustable TP%</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Pre-seeded ladder simulation (open +1%)</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Full trade-by-trade audit with timestamp and sub-penny precision</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> CSV export of complete audit trail</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Market data context (OHLC, volume, ATR%)</p>
          <p><span style={{color:C.gold}}>&#9679;</span> Cross-verification Python script for independent validation</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700,marginTop:14}}>Data Integrity and Verifiable Analysis</p>
        <p style={{marginBottom:10}}>The accuracy and trustworthiness of the quantitative analysis performed in Stage 1 is not just important for this stage alone. It is the foundation upon which the entire Edge Detection System is being built. Every subsequent stage of development will depend on the cycle measurements, level mapping, and execution logic validated here.</p>
        <p style={{marginBottom:10}}>For this reason, data integrity is treated as a first-class requirement, not an afterthought. The system is designed from the ground up to be fully verifiable at every layer:</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:8}}><span style={{color:C.accent,fontWeight:700}}>Raw Data Transparency</span></p>
          <p style={{marginBottom:10,fontSize:9}}>Every trade tick used in the analysis comes directly from the Polygon.io consolidated tape with no transformation, filtering, or modification. The raw price, timestamp, and size are preserved and displayed exactly as received from the exchange feed. Nothing is interpolated, estimated, or rounded.</p>
          <p style={{marginBottom:8}}><span style={{color:C.accent,fontWeight:700}}>Deterministic Logic</span></p>
          <p style={{marginBottom:10,fontSize:9}}>The cycle counting algorithm is entirely deterministic. Given the same trade tick data and the same take-profit parameter, it will produce the exact same results every time. There are no random elements, no machine learning estimates, and no probabilistic components. The logic is pure sequential evaluation of limit order fill conditions.</p>
          <p style={{marginBottom:8}}><span style={{color:C.accent,fontWeight:700}}>Trade-by-Trade Audit Trail</span></p>
          <p style={{marginBottom:10,fontSize:9}}>Every single BUY entry and SELL exit can be traced back to the specific trade tick that triggered it, with exact timestamp and sub-penny price. The full audit trail is exportable as a CSV file, allowing independent line-by-line verification using any external tool.</p>
          <p style={{marginBottom:8}}><span style={{color:C.accent,fontWeight:700}}>Cross-Verification</span></p>
          <p style={{marginBottom:10,fontSize:9}}>A standalone Python script is provided that implements the identical algorithm independently. Anyone can run this script against the same Polygon.io data and confirm that the cycle counts match exactly. This eliminates any reliance on trusting the application code alone.</p>
          <p style={{marginBottom:8}}><span style={{color:C.accent,fontWeight:700}}>Why This Is Critical for Edge Detection</span></p>
          <p style={{fontSize:9}}>The Edge Detection System being built in later stages will use the cycle data from Stage 1 to identify optimal entry conditions, calibrate take-profit parameters, detect high-oscillation regimes, and model expected capture rates. If the underlying cycle measurements are inaccurate or unverifiable, every model, optimization, and strategy built on top of them would be unreliable. By ensuring Stage 1 is fully transparent and independently verifiable, we establish a trustworthy quantitative foundation that the entire system can be built upon with confidence.</p>
        </div>
      </div>
    </CollapseStage><CollapseStage title="Stage 2" sub="Adaptive Profit Taker Optimization" badge="Next Stage" badgeColor={C.blue} badgeBg={C.blueDim}>
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:6}}>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Objective</p>
        <p style={{marginBottom:14}}>Compare a flat (fixed) profit taker against an adaptive profit taker that adjusts based on real market conditions. The goal is to look back at historical data and determine: what would have been the optimal profit taker at each hour of the trading day, and how much additional edge does adapting produce versus staying fixed?</p>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>The Core Question</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:14}}>
          <p style={{marginBottom:6}}>In Stage 1, we measure cycles using a single, fixed take-profit percentage for the entire day. But markets are not static. A stock might oscillate rapidly in the first hour with small moves, then trend steadily in the afternoon with larger moves.</p>
          <p>A fixed 1% profit taker might capture 50 cycles in the morning but only 5 in the afternoon. What if we used 0.5% in the morning (more cycles, smaller gains) and 1.5% in the afternoon (fewer cycles, larger gains)? Stage 2 answers this question with data.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>How It Works: Step by Step</p>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 1: Segment the Trading Day into Hours</p>
          <p style={{fontSize:9}}>The trading day is divided into hourly blocks (e.g. 9:30-10:30, 10:30-11:30, etc.). Each hour is analyzed independently. This matters because market behavior changes throughout the day. The opening hour is typically volatile and choppy, midday often quieter, and the final hour can see large directional moves.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 2: Test Every Profit Taker for Each Hour</p>
          <p style={{fontSize:9}}>For each hourly block, the system runs the cycle analysis at many different take-profit percentages (e.g. 0.25%, 0.5%, 0.75%, 1.0%, 1.25%, 1.5%, 2.0%, etc.). This produces a grid: for every hour, we know exactly how many cycles completed at each TP% and the total profit each would have generated.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 3: Find the Optimal TP% per Hour</p>
          <p style={{marginBottom:6,fontSize:9}}>The key metric is not just cycle count or TP% alone. It is the product of both:</p>
          <p style={{marginBottom:6,fontSize:9,color:C.txtBright,textAlign:'center'}}>Total Edge = Cycles x Profit Per Cycle</p>
          <p style={{fontSize:9}}>A high cycle count at a tiny TP% might generate less total profit than fewer cycles at a larger TP%. The optimal profit taker for each hour is the one that maximizes this combined metric. This is the sweet spot between frequency and size.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 4: Factor in Market Context</p>
          <p style={{marginBottom:6,fontSize:9}}>The optimal TP% does not exist in a vacuum. It is influenced by measurable market conditions. Stage 2 incorporates these contextual factors:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Intraday Seasonality</span> - Certain hours of the day consistently show different volatility patterns. The opening 30 minutes tend to be volatile (smaller TP% works), while the lunch hour is quieter (fewer opportunities regardless of TP%).</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Volatility Regime</span> - Is the stock in a high-volatility or low-volatility period? High volatility means wider price swings, which supports a larger TP%. Low volatility means tighter oscillations, favoring a smaller TP%.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>VIX Level</span> - The CBOE Volatility Index measures market-wide fear and expected volatility. When the VIX is elevated (above 20), stocks tend to oscillate more aggressively, changing the optimal TP% for all stocks.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Previous Day Price Action</span> - Did the stock trend strongly yesterday or chop sideways? A strong trend day often leads to mean-reversion the following day (more oscillations), while a choppy day may continue chopping.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Previous Hour</span> - What happened in the last 60 minutes directly informs the next. If the previous hour saw 30 cycles at 0.5% TP, that tells us the current oscillation frequency and helps predict the optimal TP% for the next hour.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 5: Compare Flat vs Adaptive</p>
          <p style={{marginBottom:6,fontSize:9}}>The final output is a direct comparison:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.txtBright}}>Flat Approach:</span> Using a single fixed TP% all day (e.g. 1%), what was the total profit across all hours?</p>
          <p style={{marginBottom:6,paddingLeft:8,fontSize:9}}><span style={{color:C.txtBright}}>Adaptive Approach:</span> Using the optimal TP% for each individual hour, what was the total profit?</p>
          <p style={{fontSize:9}}>The difference between these two numbers is the edge that adaptation produces. This edge represents the additional profit captured by intelligently adjusting the profit taker based on real-time market conditions instead of using a one-size-fits-all setting.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>What This Means in Simple Terms</p>
        <p style={{marginBottom:10}}>Think of it like adjusting the net height in tennis based on the wind. On a calm day, you keep the net standard. On a windy day, you adjust because the ball behaves differently. The profit taker is the net. Market conditions are the wind. Stage 2 measures exactly how much better you play when you adjust the net versus leaving it fixed.</p>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Deliverables</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Hourly optimal TP% heatmap for any stock and date</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Cycle frequency vs profit per cycle optimization curves</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Flat vs adaptive profit comparison with edge quantification</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Contextual factor correlation (VIX, volatility, seasonality)</p>
          <p><span style={{color:C.gold}}>&#9679;</span> Historical lookback across multiple days for pattern validation</p>
        </div>
      </div>
    </CollapseStage><CollapseStage title="Stage 3" sub="Correlation and Coefficient Detection" badge="Future Stage" badgeColor={C.purple} badgeBg={'#9d5cff20'}>
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:6}}>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Objective</p>
        <p style={{marginBottom:14}}>Use machine learning to discover which market factors are the strongest predictors of the optimal profit taker for each hour of the trading day. Stage 2 tells us what the best TP% was looking back. Stage 3 answers: what measurable inputs could have predicted it in advance?</p>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>The Concept: What is Correlation and Coefficient Detection?</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:14}}>
          <p style={{marginBottom:6}}>In simple terms, correlation means two things tend to move together. If high VIX days consistently produce a higher optimal TP%, that is a positive correlation. If low volume hours consistently produce a lower optimal TP%, that is also a correlation.</p>
          <p style={{marginBottom:6}}>A coefficient is the strength of that relationship expressed as a number. A coefficient of 0.9 means the factor is a very strong predictor. A coefficient of 0.1 means it barely matters. Stage 3 calculates these numbers for every factor so we know exactly which inputs matter most and which can be ignored.</p>
          <p>Machine learning automates this discovery process. Instead of manually testing each factor one by one, the ML model examines all factors simultaneously and finds patterns that would be impossible to spot by hand.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>How It Works</p>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 1: Build the Training Dataset</p>
          <p style={{fontSize:9}}>Using data from Stage 2, the system compiles a dataset where each row represents one hour of one trading day. For each row, we know the optimal TP% that was identified (our target variable) and dozens of measurable inputs (our features) that were observable before that hour began.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 2: Define the Feature Set</p>
          <p style={{marginBottom:6,fontSize:9}}>Features are the measurable inputs the model examines. Examples relevant to our system:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>VIX level at market open</span> - Does overall market fear predict wider or tighter optimal TP%?</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Previous day ATR %</span> - Does yesterday's volatility predict today's optimal settings?</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Previous hour cycle count</span> - Does recent oscillation frequency predict the next hour?</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Time of day</span> - Is 10:00 AM consistently different from 2:00 PM?</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Day of week</span> - Do Mondays behave differently from Fridays?</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Pre-market price change %</span> - Does the gap up or down predict intraday oscillation behavior?</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Volume ratio vs 20-day average</span> - Is unusual volume a predictor of optimal TP%?</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Previous hour's optimal TP%</span> - Does the best setting tend to persist or revert?</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 3: Train the Model</p>
          <p style={{marginBottom:6,fontSize:9}}>The machine learning model (such as gradient boosted trees or a neural network) is trained on the historical dataset. It learns the relationships between the input features and the optimal TP% output. For example, it might discover:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9,color:C.txtBright}}>"When VIX is above 25 AND the previous hour had more than 40 cycles AND it is between 10:00-11:00 AM, the optimal TP% is typically 0.6-0.8%."</p>
          <p style={{fontSize:9}}>These are the kinds of multi-factor patterns that are impossible for a human to detect manually across thousands of data points but are straightforward for machine learning.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 4: Rank Feature Importance</p>
          <p style={{marginBottom:6,fontSize:9}}>After training, the model outputs a ranked list of which features matter most. This is the core deliverable of Stage 3. For example, the ranking might reveal:</p>
          <div style={{background:'#0a0e14',borderRadius:4,padding:'8px',marginBottom:6}}>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"1. Previous hour cycle count    coefficient: 0.34"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"2. VIX level                    coefficient: 0.22"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"3. Time of day                  coefficient: 0.18"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"4. Previous day ATR %           coefficient: 0.12"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"5. Pre-market gap %             coefficient: 0.08"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c'}}>{"6. Day of week                  coefficient: 0.03"}</p>
          </div>
          <p style={{fontSize:9}}>This tells us that the previous hour's cycle count is the single best predictor (coefficient 0.34), while day of week barely matters (0.03). This ranking directly informs which data inputs the live trading system should prioritize.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 5: Validate with Out-of-Sample Testing</p>
          <p style={{fontSize:9}}>The model is trained on historical data but tested on separate data it has never seen. This prevents overfitting, which is when a model memorizes past patterns but fails on new data. If the model predicts optimal TP% accurately on unseen days, we can trust its feature rankings and use them for live decision-making.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>What This Means in Simple Terms</p>
        <p style={{marginBottom:14}}>Imagine you are a weather forecaster trying to predict rain. You have hundreds of possible inputs: temperature, humidity, wind speed, cloud type, season, air pressure, and more. Correlation detection tells you which of these inputs actually matter for predicting rain and how much each one contributes. You might discover that humidity and air pressure together predict 80% of rain events, while wind speed and season add very little. Stage 3 does the same thing but for predicting the optimal profit taker setting.</p>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Why This Is Critical for Edge Detection</p>
        <p style={{marginBottom:14}}>Stage 1 measures cycles. Stage 2 finds the optimal TP% looking backward. Stage 3 is the bridge to forward-looking prediction. Once we know which factors predict the optimal TP%, the live Alpha Trader System can observe those factors in real-time and adjust the profit taker before each hour begins, rather than reacting after the fact. This transforms the system from a backward-looking analysis tool into a forward-looking edge detection engine.</p>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Deliverables</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Feature importance rankings with coefficient values</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Correlation matrix across all measured factors</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> ML model accuracy metrics on out-of-sample data</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Per-stock and per-hour factor sensitivity analysis</p>
          <p><span style={{color:C.gold}}>&#9679;</span> Predictive model for real-time TP% recommendation</p>
        </div>
      </div>
    </CollapseStage><CollapseStage title="Stage 4" sub="Live Adaptive Profit Taker Engine" badge="Future Stage" badgeColor={C.gold} badgeBg={'#ffb02020'}>
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:6}}>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Objective</p>
        <p style={{marginBottom:14}}>Take the predictive model and feature rankings from Stage 3 and deploy them into the live Alpha Trader System. The system will automatically adjust the profit taker percentage at the start of each hour based on real-time market conditions, achieving a measurable edge over a fixed profit taker approach.</p>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>From Analysis to Action</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:14}}>
          <p style={{marginBottom:6}}>Stages 1 through 3 are research stages. They measure, compare, and discover. Stage 4 is where the research becomes operational. The predictive model built in Stage 3 is embedded directly into the trading system, running in real-time, reading live market data, and making hourly decisions about what the profit taker should be.</p>
          <p>This is the transition from "what would have been optimal" to "what should we set right now."</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>How It Works: Step by Step</p>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 1: Real-Time Data Collection</p>
          <p style={{fontSize:9}}>At the start of each hour, the system gathers the current values of all the key predictive features identified in Stage 3. For example: current VIX level, the previous hour's cycle count, today's opening gap percentage, current volume compared to the 20-day average, and the previous day's ATR%. These are the same inputs the ML model was trained on, but now observed live rather than historically.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 2: Model Prediction</p>
          <p style={{marginBottom:6,fontSize:9}}>The live feature values are fed into the trained ML model from Stage 3. The model outputs a recommended profit taker percentage for the upcoming hour. For example:</p>
          <div style={{background:'#0a0e14',borderRadius:4,padding:'8px',marginBottom:6}}>
            <p style={{fontSize:8,fontFamily:F,color:C.txtDim,marginBottom:4}}>{"Hour: 10:30 - 11:30 AM"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"VIX: 22.4 | Prev hour cycles: 47"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"Gap: +1.2% | Vol ratio: 1.8x"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"Prev day ATR: 4.1%"}</p>
            <p style={{fontSize:8,fontFamily:F,color:C.accent,marginBottom:0}}>{">> Recommended TP%: 0.72%"}</p>
          </div>
          <p style={{fontSize:9}}>The system does not guess or use a fixed rule. It applies the learned relationships from thousands of historical hourly periods to the current conditions.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 3: Automatic Adjustment</p>
          <p style={{fontSize:9}}>The Alpha Trader System receives the recommended TP% and automatically updates the sell targets for all active levels. This happens seamlessly at the hour boundary. No manual intervention is required. If the model recommends 0.72%, every active level's sell target is recalculated: level price x 1.0072. Levels that already have pending sells at the old target are updated to the new target.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 4: Continuous Monitoring</p>
          <p style={{marginBottom:6,fontSize:9}}>Throughout each hour, the system tracks actual performance against the model's prediction. Key metrics monitored in real-time:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Actual cycles completed</span> vs predicted cycle frequency</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Actual profit per cycle</span> vs expected profit per cycle</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Total edge captured</span> vs what a flat TP% would have produced</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Model confidence score</span> for the current hour's prediction</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Step 5: Feedback Loop</p>
          <p style={{fontSize:9}}>At the end of each hour, the system compares what the model predicted against what actually happened. This data feeds back into the model for periodic retraining. Over time, the model becomes more accurate as it learns from its own live predictions, creating a self-improving cycle. If market conditions change structurally (new volatility regime, regulatory changes, etc.), the model adapts through this continuous feedback mechanism.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>What This Means in Simple Terms</p>
        <p style={{marginBottom:14}}>Imagine a thermostat that does not just react to the current temperature, but predicts what the temperature will be in the next hour based on the weather forecast, time of day, and how many people are in the building. It pre-adjusts the heating or cooling before the temperature changes, keeping the room at the perfect level all day long. Stage 4 does this for the profit taker: it reads the market conditions and pre-adjusts the setting before each hour, keeping the system at the optimal level throughout the trading day.</p>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>The Edge Equation</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:14}}>
          <p style={{marginBottom:6,fontSize:9}}>The total edge produced by Stage 4 is measured as:</p>
          <p style={{marginBottom:6,fontSize:9,color:C.accent,textAlign:'center',fontWeight:700}}>Edge = Adaptive Total Profit - Flat Total Profit</p>
          <p style={{marginBottom:6,fontSize:9}}>If a flat 1% TP produces $500 in a day across all levels, and the adaptive system produces $680, the edge is $180 or 36% improvement. This edge compounds daily. Over weeks and months, the cumulative advantage of hourly adaptation becomes substantial.</p>
          <p style={{fontSize:9}}>Critically, the edge is only counted when measured against real execution constraints identified in Stage 1: limit order fill rules, sub-penny precision, and the understanding that not all market oscillations are capturable.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Safety and Risk Controls</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:14}}>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.warn}}>Floor and ceiling bounds</span> - The model's TP% recommendation is clamped within a safe range (e.g. 0.25% to 3%). Extreme predictions are rejected.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.warn}}>Confidence threshold</span> - If the model's confidence is below a minimum threshold, the system falls back to a safe default TP% rather than acting on a low-confidence prediction.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.warn}}>Override capability</span> - Manual override is always available. The system can be switched to flat mode at any time if market conditions are unusual or if the operator prefers manual control.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Deliverables</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Live prediction engine integrated into Alpha Trader System</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Hourly auto-adjustment of TP% across all active levels</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Real-time performance dashboard: adaptive vs flat comparison</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Model accuracy tracking with confidence scores</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Continuous feedback loop for model retraining</p>
          <p><span style={{color:C.gold}}>&#9679;</span> Safety controls: bounds, confidence thresholds, manual override</p>
        </div>
      </div>
    </CollapseStage><CollapseStage title="Stage 5" sub="Reinforcement Learning and Regime Adaptation" badge="Future Stage" badgeColor={C.warn} badgeBg={'#ff5c3a20'}>
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:6}}>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Objective</p>
        <p style={{marginBottom:14}}>Integrate reinforcement learning into the Alpha Trader System so the model does not just predict the optimal profit taker from historical patterns, but continuously learns and improves from its own live decisions. Additionally, build a regime change detection system that recognizes when market conditions have fundamentally shifted and automatically recalibrates all parameters.</p>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Why Stage 4 Is Not Enough</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:14}}>
          <p style={{marginBottom:6}}>Stage 4 deploys a trained model that was built on historical data. This works well when market conditions resemble the past. But markets evolve. New regulations, macroeconomic shifts, changes in market microstructure, or entirely new volatility environments can cause a model trained on last year's data to underperform today.</p>
          <p>Stage 5 solves this by making the system self-adapting. Instead of waiting for a human to notice the model is stale and retrain it, the system detects changes automatically and adjusts in real-time.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Part 1: Reinforcement Learning</p>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>What Is Reinforcement Learning?</p>
          <p style={{fontSize:9}}>In simple terms, reinforcement learning (RL) is learning by doing. Instead of being trained on a fixed dataset and then deployed (as in Stage 4), an RL agent makes decisions, observes the outcomes, and adjusts its behavior to maximize a reward. Think of it like a chess player who improves not by studying textbooks but by playing thousands of games and learning from wins and losses.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>How RL Applies to Our System</p>
          <p style={{marginBottom:6,fontSize:9}}>The RL agent's job is straightforward:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>State:</span> The current market conditions (feature vector from Stage 3: VIX, previous hour cycles, volatility, volume, time of day, etc.)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Action:</span> Choose a profit taker percentage for the next hour (e.g. 0.4%, 0.7%, 1.2%)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Reward:</span> The total edge captured in that hour (cycles completed x profit per cycle, minus what a flat TP% would have produced)</p>
          <p style={{fontSize:9}}>After each hour, the agent receives its reward and updates its policy. Over thousands of hourly decisions, it learns which actions produce the highest rewards in which states. Crucially, it discovers strategies the Stage 4 model might miss because it explores new TP% values the static model would never try.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Exploration vs Exploitation</p>
          <p style={{fontSize:9}}>A key concept in RL is balancing exploration (trying new TP% values to discover if they work better) with exploitation (using the TP% the agent already believes is best). Early on, the agent explores more aggressively. As it accumulates experience, it increasingly exploits its best-known strategies while still occasionally exploring to avoid missing improvements. This is managed through a controlled exploration rate that decreases over time but never reaches zero.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Safety During Learning</p>
          <p style={{marginBottom:6,fontSize:9}}>RL exploration is managed within strict safety bounds:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.warn}}>Bounded exploration</span> - The agent can only explore TP% values within a predefined safe range. It cannot set extreme values.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.warn}}>Paper trading first</span> - New strategies are tested in simulation alongside live execution of the proven strategy. Only after paper trading validates improvement does the new strategy go live.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.warn}}>Rollback triggers</span> - If the RL agent's decisions underperform the Stage 4 baseline for a configurable number of consecutive hours, the system automatically rolls back to the Stage 4 model until the agent is retrained.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Part 2: Regime Change Detection</p>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>What Is a Regime Change?</p>
          <p style={{marginBottom:6,fontSize:9}}>A regime is a period where market behavior follows a consistent pattern. Examples of distinct regimes:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Low volatility, range-bound:</span> Stock oscillates within a narrow range. Many small cycles possible. Optimal TP% tends to be small (0.3-0.6%).</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>High volatility, mean-reverting:</span> Large swings but price keeps returning to a central level. Fewer but larger cycles. Optimal TP% tends to be larger (1-2%).</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Trending:</span> Price moves strongly in one direction. Very few completed cycles regardless of TP%. Best strategy may be to widen TP% significantly or reduce position sizes.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Crisis/event-driven:</span> Earnings releases, Fed announcements, or market shocks create abnormal behavior. Historical patterns break down. The system needs to recognize this and adapt immediately.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>How Regime Detection Works</p>
          <p style={{marginBottom:6,fontSize:9}}>The system continuously monitors statistical properties of the market and flags when they deviate significantly from recent norms:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Volatility tracking</span> - Rolling ATR%, standard deviation, and high-low range compared against 20-day and 60-day moving averages. A sustained breakout above 2x the average signals a regime shift.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Cycle frequency monitoring</span> - If the number of completed cycles per hour drops below 50% of the recent average for 3+ consecutive hours, the oscillation regime has changed.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Model prediction drift</span> - If the Stage 4 model's predictions consistently miss by a growing margin, the underlying data distribution has shifted and the model needs recalibration.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Feature distribution shift</span> - Statistical tests (Kolmogorov-Smirnov, Population Stability Index) on the input features detect when the data the model sees today no longer resembles the data it was trained on.</p>
        </div>

        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Automatic Response to Regime Changes</p>
          <p style={{marginBottom:6,fontSize:9}}>When a regime change is detected, the system responds in a staged, controlled manner:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Level 1 - Alert:</span> Flag the regime change to the monitoring dashboard. Increase the RL exploration rate to gather data about optimal behavior in the new regime.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Level 2 - Widen safety bounds:</span> If the new regime persists for 2+ hours, temporarily widen the TP% exploration range so the RL agent can test strategies appropriate to the new conditions.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Level 3 - Rapid retraining:</span> If the regime persists for a full day, trigger an accelerated model retraining using recent data weighted more heavily than historical data. The new model is deployed after validation.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Level 4 - Full recalibration:</span> If the regime fundamentally differs from anything in the training history (e.g. first market crash the system has experienced), engage a conservative fallback mode with wider TP%, reduced position sizes, and intensive data collection for building a new baseline.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>What This Means in Simple Terms</p>
        <p style={{marginBottom:14}}>Stages 1-4 build a system that learns from the past and applies those lessons. Stage 5 makes the system learn from the present. Imagine a GPS navigation system: Stages 1-4 give it a detailed map built from historical traffic data. Stage 5 adds live traffic updates and the ability to discover new shortcuts on its own. When a road closes (regime change), the system does not keep trying to drive down it. It detects the change, finds alternative routes, and updates its map for the future.</p>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>The Continuous Improvement Loop</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:14}}>
          <div style={{background:'#0a0e14',borderRadius:4,padding:'10px',marginBottom:6,overflowX:'auto'}}>
            <pre style={{color:'#8ec07c',fontSize:7,fontFamily:F,margin:0,lineHeight:1.8}}>{"Observe market state\n      |\n      v\nRL agent selects TP%\n      |\n      v\nExecute for 1 hour\n      |\n      v\nMeasure actual reward\n      |\n      v\nUpdate RL policy\n      |\n      v\nCheck for regime change\n      |\n      v\n[No change] --> loop back\n[Change detected] --> recalibrate\n      |\n      v\nLoop continues forever"}</pre>
          </div>
          <p style={{fontSize:9}}>This loop runs every hour during market hours, indefinitely. The system never stops learning. Each hour of live data makes it marginally better at predicting the next hour's optimal TP%. Over weeks and months, this compounding improvement creates a meaningful and growing edge.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Deliverables</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> RL agent integrated into live prediction pipeline</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Exploration/exploitation policy with safety bounds</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Regime classification engine (low-vol, high-vol, trending, crisis)</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Automated 4-level regime change response system</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Model drift detection with statistical tests</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>&#9679;</span> Continuous improvement tracking dashboard</p>
          <p><span style={{color:C.gold}}>&#9679;</span> Rollback and fallback safety mechanisms</p>
        </div>
      </div>
    </CollapseStage><CollapseStage title="Data Pipeline Architecture" sub="Infrastructure for live processing and prediction" badge="Infrastructure" badgeColor={C.txtDim} badgeBg={C.grid}>
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:6}}>
        <p style={{marginBottom:10}}>Stages 2 through 4 require a continuous flow of market data being collected, processed, stored, and fed into predictive models in real-time. Below is the complete data pipeline architecture that makes this possible.</p>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Pipeline Overview</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:14}}>
          <div style={{background:'#0a0e14',borderRadius:4,padding:'10px',marginBottom:6,overflowX:'auto'}}>
            <pre style={{color:'#8ec07c',fontSize:7,fontFamily:F,margin:0,lineHeight:1.8}}>{"Market Data Sources\n      |\n      v\n[1] Data Ingestion Layer\n      |\n      v\n[2] Processing & Feature Engineering\n      |\n      v\n[3] Storage Layer\n      |\n      v\n[4] ML Model Layer\n      |\n      v\n[5] Prediction & Execution\n      |\n      v\nAlpha Trader System"}</pre>
          </div>
          <p style={{fontSize:9}}>Each layer runs independently and communicates through defined interfaces, so any component can be upgraded or scaled without disrupting the others.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Layer 1: Data Ingestion</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,fontSize:9}}>This layer continuously collects raw market data from multiple sources:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Polygon.io WebSocket</span> - Real-time trade ticks streamed as they occur on all US exchanges. Sub-millisecond latency. Each tick includes price, size, exchange, and nanosecond timestamp.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Polygon.io REST API</span> - Daily OHLC data, previous day aggregates, and historical data for backtesting. Used for features like previous day ATR% and opening gap calculations.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>CBOE VIX Feed</span> - Current VIX and VIX futures levels, updated throughout the trading day. Critical input for volatility regime classification.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Alpaca Markets API</span> - Live portfolio state, active positions, pending orders, and fill notifications from the Alpha Trader System itself.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Layer 2: Processing and Feature Engineering</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,fontSize:9}}>Raw data is transformed into the features the ML model needs. This runs continuously during market hours:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Hourly Cycle Counter</span> - Runs the same analyzePriceLevels engine from Stage 1 on each rolling hour of tick data. Produces the previous hour's cycle count, which Stage 3 identified as the strongest predictor.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Volatility Calculator</span> - Computes real-time ATR%, standard deviation of returns, and high-low range for the current and previous hour. Feeds into volatility regime classification.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Volume Analyzer</span> - Calculates current hour volume vs 20-day average, volume acceleration (is volume increasing or decreasing), and relative volume by time of day.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Context Builder</span> - Assembles the complete feature vector: VIX, ATR%, cycle count, volume ratio, gap%, time of day, day of week, and any other features ranked important by Stage 3.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Optimal TP% Calculator</span> - For the previous hour (now complete), runs the Stage 2 grid search across all TP% values to determine what the optimal setting actually was. This becomes training data for the model.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Layer 3: Storage</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,fontSize:9}}>Three tiers of storage serve different speed and persistence requirements:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>In-Memory Cache (Redis)</span> - Current hour's tick buffer, latest feature vector, active model predictions. Sub-millisecond read access. This is where the live trading system reads from.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Time Series Database (TimescaleDB/PostgreSQL)</span> - Hourly feature vectors, cycle counts, optimal TP% values, and model predictions stored with timestamps. This is the training dataset that grows daily.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Object Storage (S3/GCS)</span> - Raw tick data archives, trained model artifacts, and historical backtest results. Used for model retraining and long-term analysis.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Layer 4: ML Model Layer</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,fontSize:9}}>The machine learning infrastructure runs in two modes:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Inference (Real-Time)</span> - The trained model receives the current feature vector and returns a TP% prediction within milliseconds. This runs at every hour boundary during market hours. The model is lightweight enough to run on a single server without GPU requirements.</p>
          <p style={{marginBottom:6,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Training (Periodic)</span> - The model is retrained on the accumulated historical dataset. This can run nightly or weekly, using the growing dataset of hourly observations. Each retraining cycle produces an updated model that replaces the current one. Feature importance rankings are recalculated to detect if market dynamics are shifting.</p>
          <p style={{fontSize:9}}>Model versioning ensures the system can roll back to a previous model if a new version underperforms. A/B testing between model versions can run in parallel on paper trading accounts before deploying to live capital.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Layer 5: Prediction and Execution</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,fontSize:9}}>The final layer connects the prediction to the live trading system:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Prediction Service</span> - At T-5 seconds before each hour boundary, the service assembles the final feature vector, runs the model, applies safety bounds (floor/ceiling TP%), checks confidence threshold, and publishes the recommended TP% to the execution channel.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Execution Bridge</span> - Receives the TP% recommendation and sends instructions to the Alpha Trader System via the Alpaca API. All active levels have their sell targets recalculated and limit orders updated on the exchange.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Monitoring Dashboard</span> - Real-time display of current prediction, confidence, active TP%, cycle count progress, and comparison against flat baseline. Alerts if the model confidence drops below threshold or if actual performance diverges significantly from prediction.</p>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Timing and Schedule</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <div style={{background:'#0a0e14',borderRadius:4,padding:'8px',marginBottom:6}}>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"04:00 AM  Data ingestion starts (pre-market)"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"09:25 AM  Feature vector built from pre-market"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"09:30 AM  First prediction: opening hour TP%"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"10:30 AM  Hour 1 reviewed, Hour 2 predicted"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"11:30 AM  Hour 2 reviewed, Hour 3 predicted"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"  ...      (continues hourly)"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c',marginBottom:2}}>{"04:00 PM  Final hour reviewed, day summary"}</p>
            <p style={{fontSize:8,fontFamily:F,color:'#8ec07c'}}>{"08:00 PM  Nightly: archive data, retrain model"}</p>
          </div>
        </div>

        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Infrastructure Requirements</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Compute:</span> GCP/AWS cloud instance in us-east (co-located near exchanges). C3/C4 instance class for low-latency processing. No GPU required for inference.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Network:</span> Premium tier networking for sub-millisecond RTT to Polygon.io and Alpaca APIs. Persistent WebSocket connections with automatic reconnection.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Database:</span> PostgreSQL with TimescaleDB extension for time series data. Redis for real-time cache. Estimated storage: ~2GB per stock per month of tick data.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Monitoring:</span> Uptime monitoring, latency alerts, model drift detection, and automated failover to flat TP% mode if any pipeline component fails.</p>
        </div>
      </div>
    </CollapseStage>
  </div>;
}
function DbManagePage(p){
  var s1=useState(null),data=s1[0],setData=s1[1];
  var s2=useState(true),loading=s2[0],setLoading=s2[1];
  var s3=useState(null),err=s3[0],setErr=s3[1];
  var s4=useState(null),detail=s4[0],setDetail=s4[1];
  var s5=useState(null),confirmDel=s5[0],setConfirmDel=s5[1];
  var s6=useState(null),dbSize=s6[0],setDbSize=s6[1];
  var s7=useState(null),featData=s7[0],setFeatData=s7[1];
  var s8=useState(null),featDetail=s8[0],setFeatDetail=s8[1];
  var s9=useState(null),confirmFeatDel=s9[0],setConfirmFeatDel=s9[1];
  var s10=useState(null),expandedFeatDay=s10[0],setExpandedFeatDay=s10[1];

  var loadData=async function(){
    setLoading(true);setErr(null);
    try{
      if(!SB_URL||!SB_KEY){setErr('No Supabase config. Set in Settings.');setLoading(false);return;}
      var h=getSbHeaders();
      // Get stock summary
      var r1=await fetch(SB_URL+'/rest/v1/cached_analyses?select=ticker,trade_date,tp_pct,session_type,total_cycles,active_levels,total_levels,total_trades&order=ticker.asc,trade_date.asc',{headers:h});
      if(!r1.ok)throw new Error('API error '+r1.status);
      var rows=await r1.json();

      // Group by ticker
      var stocks={};
      for(var i=0;i<rows.length;i++){
        var r=rows[i];
        if(!stocks[r.ticker])stocks[r.ticker]={ticker:r.ticker,days:[],totalCycles:0,totalTrades:0};
        stocks[r.ticker].days.push(r);
        stocks[r.ticker].totalCycles+=r.total_cycles;
        stocks[r.ticker].totalTrades+=r.total_trades;
      }
      // Convert to array and compute ranges
      var arr=Object.values(stocks).map(function(s){
        s.dayCount=s.days.length;
        s.earliest=s.days[0].trade_date;
        s.latest=s.days[s.days.length-1].trade_date;
        s.avgCycles=Math.round(s.totalCycles/s.dayCount);
        return s;
      });

      // Get seasonality count
      var r2=await fetch(SB_URL+'/rest/v1/cached_seasonality?select=ticker,trade_date&order=ticker.asc',{headers:h});
      var seasRows=r2.ok?await r2.json():[];
      var seasByTicker={};
      var seasDates={};
      for(var i=0;i<seasRows.length;i++){
        var key=seasRows[i].ticker;
        if(!seasByTicker[key])seasByTicker[key]=new Set();
        seasByTicker[key].add(seasRows[i].trade_date);
      }
      for(var i=0;i<arr.length;i++){
        arr[i].seasonalityDays=seasByTicker[arr[i].ticker]?seasByTicker[arr[i].ticker].size:0;
      }

      // Total row counts for storage info
      var r3=await fetch(SB_URL+'/rest/v1/cached_levels?select=id&limit=1&head=true',{method:'HEAD',headers:h});
      var r4=await fetch(SB_URL+'/rest/v1/cached_analyses?select=id&limit=1&head=true',{method:'HEAD',headers:h});

      setData({stocks:arr,totalAnalyses:rows.length,totalSeasonality:seasRows.length});

      // Load Stage 3 feature data
      var rf=await fetch(SB_URL+'/rest/v1/hourly_features?select=ticker,trade_date,hour,hour_open,hour_close,hour_high,hour_low,hour_atr_dollar,hour_atr_pct,hour_volume,hour_trades,hour_vwap,vix_close,day_of_week,prev_day_close,overnight_gap_pct,price_vs_day_open_pct,intraday_range_pct,cumulative_volume_pct&order=ticker.asc,trade_date.asc,hour.asc',{headers:h});
      var featRows=rf.ok?await rf.json():[];
      var featStocks={};
      for(var fi=0;fi<featRows.length;fi++){
        var fr=featRows[fi];var fk=fr.ticker;
        if(!featStocks[fk])featStocks[fk]={ticker:fk,dates:{},totalRows:0};
        if(!featStocks[fk].dates[fr.trade_date])featStocks[fk].dates[fr.trade_date]=[];
        featStocks[fk].dates[fr.trade_date].push(fr);
        featStocks[fk].totalRows++;
      }
      var featArr=Object.values(featStocks).map(function(fs){
        var dateKeys=Object.keys(fs.dates).sort();
        fs.dayCount=dateKeys.length;
        fs.earliest=dateKeys[0];
        fs.latest=dateKeys[dateKeys.length-1];
        fs.dateList=dateKeys;
        return fs;
      });
      setFeatData({stocks:featArr,totalRows:featRows.length});
    }catch(e){setErr(e.message);}
    setLoading(false);
  };

  useEffect(function(){loadData();},[]);

  var deleteStock=async function(ticker){
    try{
      var h=getSbHeaders();
      // Delete in order: levels (FK), analyses, seasonality, sessions
      // First get analysis IDs for this ticker
      var r1=await fetch(SB_URL+'/rest/v1/cached_analyses?ticker=eq.'+ticker+'&select=id',{headers:h});
      var analyses=r1.ok?await r1.json():[];
      for(var i=0;i<analyses.length;i++){
        await fetch(SB_URL+'/rest/v1/cached_levels?analysis_id=eq.'+analyses[i].id,{method:'DELETE',headers:h});
      }
      await fetch(SB_URL+'/rest/v1/cached_analyses?ticker=eq.'+ticker,{method:'DELETE',headers:h});
      await fetch(SB_URL+'/rest/v1/cached_seasonality?ticker=eq.'+ticker,{method:'DELETE',headers:h});
      await fetch(SB_URL+'/rest/v1/cached_sessions?ticker=eq.'+ticker,{method:'DELETE',headers:h});
      await fetch(SB_URL+'/rest/v1/hourly_features?ticker=eq.'+ticker,{method:'DELETE',headers:h});
      setConfirmDel(null);setDetail(null);
      loadData();
    }catch(e){setErr('Delete failed: '+e.message);}
  };

  var deleteFeatStock=async function(ticker){
    try{
      var h=getSbHeaders();
      await fetch(SB_URL+'/rest/v1/hourly_features?ticker=eq.'+ticker,{method:'DELETE',headers:h});
      setConfirmFeatDel(null);setFeatDetail(null);loadData();
    }catch(e){setErr('Delete features failed: '+e.message);}
  };
  var deleteAllFeatures=async function(){
    try{
      var h=getSbHeaders();
      await fetch(SB_URL+'/rest/v1/hourly_features?id=gt.0',{method:'DELETE',headers:h});
      setConfirmFeatDel(null);setFeatDetail(null);loadData();
    }catch(e){setErr('Delete all features failed: '+e.message);}
  };
  var deleteAll=async function(){
    try{
      var h=getSbHeaders();
      await fetch(SB_URL+'/rest/v1/cached_levels?id=gt.0',{method:'DELETE',headers:h});
      await fetch(SB_URL+'/rest/v1/cached_analyses?id=gt.0',{method:'DELETE',headers:h});
      await fetch(SB_URL+'/rest/v1/cached_seasonality?id=gt.0',{method:'DELETE',headers:h});
      await fetch(SB_URL+'/rest/v1/cached_sessions?id=gt.0',{method:'DELETE',headers:h});
      setConfirmDel(null);setDetail(null);
      loadData();
    }catch(e){setErr('Delete all failed: '+e.message);}
  };

  return <div>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Database Management</div>
    </div>
    {loading&&<Cd><div style={{color:C.accent,fontSize:10,fontFamily:F,textAlign:'center',padding:20}}>Loading database summary...</div></Cd>}
    {err&&<Cd style={{borderColor:C.warn}}><div style={{color:C.warn,fontSize:10,fontFamily:F}}>{err}</div></Cd>}
    {data&&<div>
      <Cd glow={true}>
        <SectionHead title="Storage Overview" sub="Cached analysis and seasonality data"/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:10}}>
          <Mt label="Stocks" value={data.stocks.length} color={C.accent} size="lg"/>
          <Mt label="Analysis Days" value={data.totalAnalyses} color={C.blue} size="md"/>
          <Mt label="Seasonality Rows" value={data.totalSeasonality} color={C.gold} size="md"/>
        </div>
      </Cd>
      {data.stocks.length===0&&<Cd><div style={{color:C.txtDim,fontSize:10,fontFamily:F,textAlign:'center',padding:16}}>No cached data. Run an analysis or batch process to populate.</div></Cd>}
      {data.stocks.map(function(s){
        var isOpen=detail===s.ticker;
        return <Cd key={s.ticker}>
          <div onClick={function(){setDetail(isOpen?null:s.ticker);}} style={{display:'flex',alignItems:'center',cursor:'pointer'}}>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <span style={{color:C.accent,fontSize:14,fontWeight:800,fontFamily:F}}>{s.ticker}</span>
                <span style={{color:C.txtDim,fontSize:8,fontFamily:F}}>{s.dayCount+' day'+(s.dayCount>1?'s':'')}</span>
              </div>
              <div style={{color:C.txt,fontSize:9,fontFamily:F}}>{s.earliest+' to '+s.latest}</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <div style={{textAlign:'right'}}>
                <div style={{color:C.accent,fontSize:13,fontWeight:700,fontFamily:F}}>{s.totalCycles.toLocaleString()}</div>
                <div style={{color:C.txtDim,fontSize:7,fontFamily:F}}>TOTAL CYCLES</div>
              </div>
              <div style={{color:C.accent,fontSize:18,fontWeight:300,transform:isOpen?'rotate(45deg)':'none',transition:'transform 0.2s'}}>+</div>
            </div>
          </div>
          {isOpen&&<div style={{marginTop:12}}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
              <Mt label="Avg Cycles/Day" value={s.avgCycles} color={C.blue} size="md"/>
              <Mt label="Total Trades" value={s.totalTrades.toLocaleString()} color={C.purple} size="md"/>
              <Mt label="Seasonality Days" value={s.seasonalityDays} color={C.gold} size="md"/>
            </div>
            <div style={{overflowX:'auto',maxHeight:300,marginBottom:10}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:8,fontFamily:F}}>
                <thead><tr style={{borderBottom:'1px solid '+C.border}}>
                  <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'left'}}>Date</th>
                  <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'right'}}>TP%</th>
                  <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'right'}}>Cycles</th>
                  <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'right'}}>Levels</th>
                  <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'right'}}>Trades</th>
                  <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'left'}}>Session</th>
                </tr></thead>
                <tbody>{s.days.map(function(d){
                  return <tr key={d.trade_date+d.tp_pct+d.session_type} style={{borderBottom:'1px solid '+C.grid}}>
                    <td style={{padding:'4px 3px',color:C.txtBright}}>{d.trade_date}</td>
                    <td style={{padding:'4px 3px',color:C.txt,textAlign:'right'}}>{d.tp_pct+'%'}</td>
                    <td style={{padding:'4px 3px',color:C.accent,textAlign:'right',fontWeight:700}}>{d.total_cycles}</td>
                    <td style={{padding:'4px 3px',color:C.txt,textAlign:'right'}}>{d.active_levels+'/'+d.total_levels}</td>
                    <td style={{padding:'4px 3px',color:C.txt,textAlign:'right'}}>{d.total_trades.toLocaleString()}</td>
                    <td style={{padding:'4px 3px',color:C.txtDim}}>{d.session_type}</td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
            {confirmDel===s.ticker?<div style={{display:'flex',gap:8}}>
              <button onClick={function(){deleteStock(s.ticker);}} style={Object.assign({},bB,{flex:1,background:C.warn,color:C.bg,fontSize:9})}>Yes, Delete All {s.ticker} Data</button>
              <button onClick={function(){setConfirmDel(null);}} style={Object.assign({},bB,{flex:1,background:'transparent',border:'1px solid '+C.border,color:C.txt,fontSize:9})}>Cancel</button>
            </div>:
            <button onClick={function(){setConfirmDel(s.ticker);}} style={Object.assign({},bB,{background:'transparent',border:'1px solid '+C.warn,color:C.warn,fontSize:9})}>Delete {s.ticker} Data</button>}
          </div>}
        </Cd>;
      })}
      {data.stocks.length>0&&<Cd>
        {confirmDel==='ALL'?<div style={{display:'flex',gap:8}}>
          <button onClick={deleteAll} style={Object.assign({},bB,{flex:1,background:C.warn,color:C.bg,fontSize:9})}>Yes, Delete Everything</button>
          <button onClick={function(){setConfirmDel(null);}} style={Object.assign({},bB,{flex:1,background:'transparent',border:'1px solid '+C.border,color:C.txt,fontSize:9})}>Cancel</button>
        </div>:
        <button onClick={function(){setConfirmDel('ALL');}} style={Object.assign({},bB,{background:'transparent',border:'1px solid '+C.warn,color:C.warn,fontSize:9})}>Clear All Cached Data</button>}
      </Cd>}
      {featData&&<div style={{marginTop:16}}>
        <Cd glow={true}>
          <SectionHead title="Stage 3: Feature Data" sub="Hourly features from Build Data Set pipeline" info="Features extracted from Polygon trade ticks for ML correlation analysis. Each row contains 22 market microstructure features for one hour of one trading day."/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:10}}>
            <Mt label="Stocks" value={featData.stocks.length} color={C.purple} size="lg"/>
            <Mt label="Total Rows" value={featData.totalRows} color={C.blue} size="md"/>
            <Mt label="Fields/Row" value="22" color={C.gold} size="md"/>
          </div>
        </Cd>
        {featData.stocks.length===0&&<Cd><div style={{color:C.txtDim,fontSize:10,fontFamily:F,textAlign:'center',padding:16}}>No feature data. Use Build Data Set (Stage 3) to generate.</div></Cd>}
        {featData.stocks.map(function(fs){
          var isOpen=featDetail===fs.ticker;
          return <Cd key={'feat-'+fs.ticker}>
            <div onClick={function(){setFeatDetail(isOpen?null:fs.ticker);}} style={{display:'flex',alignItems:'center',cursor:'pointer'}}>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                  <span style={{color:C.purple,fontSize:14,fontWeight:800,fontFamily:F}}>{fs.ticker}</span>
                  <span style={{color:C.txtDim,fontSize:8,fontFamily:F}}>{fs.dayCount+' day'+(fs.dayCount>1?'s':'')}</span>
                  <span style={{color:C.txtDim,fontSize:8,fontFamily:F}}>{fs.totalRows+' rows'}</span>
                </div>
                <div style={{color:C.txt,fontSize:9,fontFamily:F}}>{fs.earliest+' to '+fs.latest}</div>
              </div>
              <div style={{color:C.purple,fontSize:18,fontWeight:300,transform:isOpen?'rotate(45deg)':'none',transition:'transform 0.2s'}}>+</div>
            </div>
            {isOpen&&<div style={{marginTop:12}}>
              <div style={{marginBottom:10}}>
                <div style={{display:'flex',borderBottom:'1px solid '+C.border,paddingBottom:4,marginBottom:4}}>
                  <div style={{flex:2,fontSize:8,color:C.txtDim,fontFamily:F}}>Date</div>
                  <div style={{flex:1,fontSize:8,color:C.txtDim,fontFamily:F,textAlign:'right'}}>Hours</div>
                  <div style={{flex:1.5,fontSize:8,color:C.txtDim,fontFamily:F,textAlign:'right'}}>Trades</div>
                  <div style={{flex:1,fontSize:8,color:C.txtDim,fontFamily:F,textAlign:'right'}}>Volume</div>
                  <div style={{flex:1.2,fontSize:8,color:C.txtDim,fontFamily:F,textAlign:'right'}}>Avg ATR%</div>
                  <div style={{width:16}}></div>
                </div>
                {fs.dateList.map(function(dt){
                  var dayRows=fs.dates[dt];
                  var tTrades=0;var tVol=0;var tATR=0;var atrCnt=0;
                  for(var di=0;di<dayRows.length;di++){
                    tTrades+=dayRows[di].hour_trades||0;
                    tVol+=parseInt(dayRows[di].hour_volume)||0;
                    if(dayRows[di].hour_atr_pct){tATR+=parseFloat(dayRows[di].hour_atr_pct);atrCnt++;}
                  }
                  var avgATR=atrCnt>0?(tATR/atrCnt):0;
                  var dayKey=fs.ticker+':'+dt;
                  var isDayOpen=expandedFeatDay===dayKey;
                  var hoursPresent=dayRows.map(function(r){return r.hour;}).sort(function(a,b){return a-b;});
                  var allHours=[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19];
                  var missingHours=allHours.filter(function(h){return hoursPresent.indexOf(h)===-1;});
                  return <div key={dt}>
                    <div onClick={function(){setExpandedFeatDay(isDayOpen?null:dayKey);}} style={{display:'flex',alignItems:'center',cursor:'pointer',padding:'3px 0',borderBottom:'1px solid '+C.grid}}>
                      <div style={{flex:2,fontSize:8,color:C.txtBright,fontFamily:F}}>{dt}</div>
                      <div style={{flex:1,fontSize:8,color:dayRows.length===16?C.accent:C.warn,fontFamily:F,textAlign:'right',fontWeight:700}}>{dayRows.length}{dayRows.length<16?'/16':''}</div>
                      <div style={{flex:1.5,fontSize:8,color:C.txt,fontFamily:F,textAlign:'right'}}>{tTrades.toLocaleString()}</div>
                      <div style={{flex:1,fontSize:8,color:C.txt,fontFamily:F,textAlign:'right'}}>{(tVol/1e6).toFixed(1)+'M'}</div>
                      <div style={{flex:1.2,fontSize:8,color:C.gold,fontFamily:F,textAlign:'right'}}>{avgATR.toFixed(3)+'%'}</div>
                      <div style={{width:16,textAlign:'center',color:C.purple,fontSize:12,fontWeight:300,transform:isDayOpen?'rotate(45deg)':'none',transition:'transform 0.2s'}}>+</div>
                    </div>
                    {isDayOpen&&<div style={{background:'#080e16',border:'1px solid '+C.border,borderRadius:6,margin:'4px 0 8px 0',padding:8}}>
                      {missingHours.length>0&&<div style={{color:C.warn,fontSize:8,fontFamily:F,marginBottom:6,padding:'4px 6px',background:C.warnDim,borderRadius:4}}>Missing hours: {missingHours.map(function(mh){return hourLabels[String(mh)]||mh;}).join(', ')}</div>}
                      <div style={{display:'flex',borderBottom:'1px solid '+C.border,paddingBottom:3,marginBottom:3}}>
                        <div style={{width:36,fontSize:7,color:C.txt,fontFamily:F,fontWeight:600}}>Hour</div>
                        <div style={{flex:1,fontSize:7,color:C.txt,fontFamily:F,fontWeight:600,textAlign:'right'}}>Open</div>
                        <div style={{flex:1,fontSize:7,color:C.txt,fontFamily:F,fontWeight:600,textAlign:'right'}}>High</div>
                        <div style={{flex:1,fontSize:7,color:C.txt,fontFamily:F,fontWeight:600,textAlign:'right'}}>Low</div>
                        <div style={{flex:1,fontSize:7,color:C.txt,fontFamily:F,fontWeight:600,textAlign:'right'}}>Close</div>
                        <div style={{flex:1,fontSize:7,color:C.txt,fontFamily:F,fontWeight:600,textAlign:'right'}}>ATR%</div>
                        <div style={{flex:1.2,fontSize:7,color:C.txt,fontFamily:F,fontWeight:600,textAlign:'right'}}>Trades</div>
                        <div style={{flex:1.2,fontSize:7,color:C.txt,fontFamily:F,fontWeight:600,textAlign:'right'}}>Volume</div>
                      </div>
                      {allHours.map(function(hr){
                        var hRow=null;
                        for(var hi=0;hi<dayRows.length;hi++){if(dayRows[hi].hour===hr){hRow=dayRows[hi];break;}}
                        var isRTH=hr>=9&&hr<16;
                        if(!hRow)return <div key={hr} style={{display:'flex',padding:'2px 0',borderBottom:'1px solid '+C.grid}}>
                          <div style={{width:36,fontSize:7,color:'#5a6a7a',fontFamily:F}}>{hourLabels[String(hr)]||hr}</div>
                          <div style={{flex:1,fontSize:7,color:C.warn,fontFamily:F,fontStyle:'italic'}}>No data</div>
                        </div>;
                        return <div key={hr} style={{display:'flex',alignItems:'center',padding:'2px 0',borderBottom:'1px solid '+C.grid}}>
                          <div style={{width:36,fontSize:7,color:isRTH?'#c0d4e8':'#5a6a7a',fontFamily:F,fontWeight:isRTH?600:400}}>{hourLabels[String(hr)]||hr}</div>
                          <div style={{flex:1,fontSize:7,color:C.txt,fontFamily:F,textAlign:'right'}}>{parseFloat(hRow.hour_open).toFixed(2)}</div>
                          <div style={{flex:1,fontSize:7,color:C.accent,fontFamily:F,textAlign:'right'}}>{parseFloat(hRow.hour_high).toFixed(2)}</div>
                          <div style={{flex:1,fontSize:7,color:C.warn,fontFamily:F,textAlign:'right'}}>{parseFloat(hRow.hour_low).toFixed(2)}</div>
                          <div style={{flex:1,fontSize:7,color:C.txt,fontFamily:F,textAlign:'right'}}>{parseFloat(hRow.hour_close).toFixed(2)}</div>
                          <div style={{flex:1,fontSize:7,color:C.gold,fontFamily:F,textAlign:'right'}}>{parseFloat(hRow.hour_atr_pct).toFixed(3)+'%'}</div>
                          <div style={{flex:1.2,fontSize:7,color:C.txt,fontFamily:F,textAlign:'right'}}>{(hRow.hour_trades||0).toLocaleString()}</div>
                          <div style={{flex:1.2,fontSize:7,color:C.txt,fontFamily:F,textAlign:'right'}}>{((parseInt(hRow.hour_volume)||0)/1000).toFixed(0)+'K'}</div>
                        </div>;
                      })}
                      {dayRows[0]&&<div style={{display:'flex',gap:8,marginTop:6,flexWrap:'wrap'}}>
                        {dayRows[0].vix_close&&<div style={{fontSize:7,color:C.blue,fontFamily:F}}>VIX: {dayRows[0].vix_close}</div>}
                        {dayRows[0].overnight_gap_pct&&<div style={{fontSize:7,color:C.gold,fontFamily:F}}>Gap: {parseFloat(dayRows[0].overnight_gap_pct).toFixed(2)}%</div>}
                        {dayRows[0].prev_day_close&&<div style={{fontSize:7,color:C.txtDim,fontFamily:F}}>Prev Close: ${parseFloat(dayRows[0].prev_day_close).toFixed(2)}</div>}
                        <div style={{fontSize:7,color:C.txtDim,fontFamily:F}}>DOW: {['','Mon','Tue','Wed','Thu','Fri','Sat','Sun'][dayRows[0].day_of_week]||dayRows[0].day_of_week}</div>
                      </div>}
                    </div>}
                  </div>;
                })}
              </div>
              {confirmFeatDel===fs.ticker?<div style={{display:'flex',gap:8}}>
                <button onClick={function(){deleteFeatStock(fs.ticker);}} style={Object.assign({},bB,{flex:1,background:C.warn,color:C.bg,fontSize:9})}>Yes, Delete {fs.ticker} Features</button>
                <button onClick={function(){setConfirmFeatDel(null);}} style={Object.assign({},bB,{flex:1,background:'transparent',border:'1px solid '+C.border,color:C.txt,fontSize:9})}>Cancel</button>
              </div>:
              <button onClick={function(){setConfirmFeatDel(fs.ticker);}} style={Object.assign({},bB,{background:'transparent',border:'1px solid '+C.warn,color:C.warn,fontSize:9})}>Delete {fs.ticker} Feature Data</button>}
            </div>}
          </Cd>;
        })}
        {featData.stocks.length>0&&<Cd>
          {confirmFeatDel==='ALL_FEAT'?<div style={{display:'flex',gap:8}}>
            <button onClick={deleteAllFeatures} style={Object.assign({},bB,{flex:1,background:C.warn,color:C.bg,fontSize:9})}>Yes, Delete All Feature Data</button>
            <button onClick={function(){setConfirmFeatDel(null);}} style={Object.assign({},bB,{flex:1,background:'transparent',border:'1px solid '+C.border,color:C.txt,fontSize:9})}>Cancel</button>
          </div>:
          <button onClick={function(){setConfirmFeatDel('ALL_FEAT');}} style={Object.assign({},bB,{background:'transparent',border:'1px solid '+C.warn,color:C.warn,fontSize:9})}>Clear All Feature Data</button>}
        </Cd>}
      </div>}
      <div style={{color:C.txtDim,fontSize:8,fontFamily:F,textAlign:'center',padding:'8px 0',marginTop:4}}>
        <button onClick={loadData} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:4,color:C.txtDim,fontFamily:F,fontSize:8,padding:'4px 12px',cursor:'pointer'}}>Refresh</button>
      </div>
    </div>}
  </div>;
}
function SourcePage(p){
  var downloadSource=function(){
    var el=document.documentElement.outerHTML;
    var blob=new Blob([el],{type:'text/html'});
    var u=URL.createObjectURL(blob);
    var a=document.createElement('a');a.href=u;a.download='alpha_quant_analytics_source.html';a.click();URL.revokeObjectURL(u);
  };
  return <div>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Source Code</div>
    </div>
    <Cd>
      <SectionHead title="How This App Works" sub="Architecture and technical overview"/>
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <p style={{marginBottom:10}}>Alpha Quant Analytics is a single-file web application with a Supabase backend. The entire frontend, including all logic, UI, styles, and data processing, is contained in one HTML file (~400KB). Server-side batch processing runs on a Supabase Edge Function. There is no build system and no framework to install. You open the file in a browser and it works.</p>
      </div>
    </Cd>
    <CollapseStage title="Application Structure" sub="Single-file React architecture">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6}}><span style={{color:C.accent,fontWeight:700}}>Language:</span> JavaScript (React 18) with JSX syntax</p>
          <p style={{marginBottom:6}}><span style={{color:C.accent,fontWeight:700}}>Build Process:</span> JSX is pre-compiled to plain JavaScript using Babel before deployment. No runtime compiler runs in the browser, which keeps the app fast and compatible with all devices.</p>
          <p style={{marginBottom:6}}><span style={{color:C.accent,fontWeight:700}}>Styling:</span> All styles are inline JavaScript objects. No CSS files, no CSS framework. This keeps everything in one file and avoids external dependencies.</p>
          <p><span style={{color:C.accent,fontWeight:700}}>File Size:</span> The complete application is approximately 375KB, including all pages, logic, and content.</p>
        </div>
      </div>
    </CollapseStage>
    <CollapseStage title="Service Providers" sub="External services the app connects to">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:8,color:C.txtBright,fontWeight:700}}>1. Netlify (Hosting)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Purpose:</span> Serves the HTML file to users</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>URL:</span> starlit-hamster-2c27fa.netlify.app</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Plan:</span> Free tier</p>
          <p style={{marginBottom:10,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>What it does:</span> Global CDN distribution, free SSL certificate, serves static files. No server-side processing. The app is a single index.html file uploaded manually.</p>

          <p style={{marginBottom:8,color:C.txtBright,fontWeight:700}}>2. Polygon.io (Market Data)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Purpose:</span> Provides real-time and historical trade tick data from US stock exchanges</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Endpoints used:</span> /v3/trades (every individual trade tick), /v1/open-close (daily OHLC)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Connection:</span> Direct from browser to Polygon REST API. No proxy or middleware.</p>
          <p style={{marginBottom:10,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Authentication:</span> API key stored in app settings, sent as URL parameter</p>

          <p style={{marginBottom:8,color:C.txtBright,fontWeight:700}}>3. Supabase (Database + Edge Functions)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Purpose:</span> Stores computed analysis results and runs server-side batch processing</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Plan:</span> Free tier (500MB storage, 500K edge function invocations/month)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Database Tables:</span> cached_analyses, cached_levels, cached_seasonality, cached_sessions</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Edge Function:</span> batch-analyze (server-side tick fetching, cycle analysis, and seasonality computation)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Connection:</span> Browser to Supabase REST API (reads/writes) and Edge Function endpoint (batch processing)</p>
          <p style={{marginBottom:10,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>What is stored:</span> Computed results only. Raw ticks are fetched, processed, results saved, ticks discarded. This applies both when processing in-browser and via the edge function.</p>

          <p style={{marginBottom:8,color:C.txtBright,fontWeight:700}}>4. CDN Libraries (loaded at startup)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>React 18.2.0</span> - UI framework (from jsdelivr.net CDN)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>ReactDOM 18.2.0</span> - DOM rendering (from jsdelivr.net CDN)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Recharts 2.12.7</span> - Chart library for price action graph (from jsdelivr.net with unpkg fallback)</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>JetBrains Mono</span> - Monospace font (from Google Fonts CDN)</p>
        </div>
      </div>
    </CollapseStage>
    <CollapseStage title="Data Flow" sub="How data moves through the application">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Single-Day Analysis (Browser):</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>1. User enters ticker, date, TP% and taps Analyze</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>2. App checks Supabase cache for existing results</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>3. If cached: load results instantly, display "From Cache". Profit analysis updates in real-time from TP%/$/Level/Fee inputs. Price chart and trade audit available via "Load Full Tick Data" button.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>4. If not cached: fetch all trade ticks from Polygon API (paginated, 50K per page)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>5. Run analyzePriceLevels engine in browser (typed arrays for performance)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>6. Display results with price chart and trade audit, save computed output to Supabase in background</p>
          <p style={{marginBottom:10,paddingLeft:8,fontSize:9}}>7. Raw tick data held in memory for audit/chart, discarded on page change</p>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Import Stock Data (Server-Side Edge Function):</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>1. User enters ticker, date range, TP% on the Import Stock Data page</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>2. App generates list of trading days (weekends excluded)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>3. For each day, POST to Supabase Edge Function (batch-analyze)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>4. Edge function checks cache first. If cached, returns instantly.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>5. If not cached: edge function fetches ticks from Polygon server-side, runs full cycle analysis + seasonality computation</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>6. Edge function saves results to all 5 database tables (analyses, levels, seasonality, sessions, hourly cycles), discards raw ticks, returns summary</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>7. App displays live progress log. All processed days are immediately available for instant cached loading.</p>
          <p style={{paddingLeft:8,fontSize:9,marginBottom:10}}><span style={{color:C.gold}}>Fallback:</span> If edge function fails (status 546/500/502/504), the app automatically retries that day in the browser using the same engine. Log shows "(browser)" tag for fallback-processed days.</p>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Intraday Seasonality Flow:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>1. Same cache-first pattern. Check Supabase, load if exists.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>2. If not cached: fetch ticks, bucket by hour and session (pre/reg/post market)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>3. Compute ATR, volume, trades, high/low per hour</p>
          <p style={{marginBottom:10,paddingLeft:8,fontSize:9}}>4. Save hourly and session data to Supabase, discard ticks</p>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Trend Analysis Flow (no tick fetching):</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>1. User enters ticker, date range, TP%, $/Level, and Fee/Cycle</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>2. Validate cached_analyses exist for the specified TP%. If none, error with direction to import data.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>3. Query cached_seasonality and cached_hourly_cycles from Supabase</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>4. Group by date, compute hourly averages, detect missing dates in range</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>5. Render avg profiles (6 bar charts incl cycles), heatmaps (6 grids incl cycles with AVG), day-over-day summary with cycles and gross profit</p>
          <p style={{paddingLeft:8,fontSize:9}}>6. No Polygon calls. Instant loading. Profit computed client-side from cached cycles x user inputs.</p>
        </div>
      </div>
    </CollapseStage>
    <CollapseStage title="Core Analysis Engine" sub="How cycles are counted">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6}}>The analyzePriceLevels function is the core engine. It implements the full Cycle Counting and Tracking Process Flow (documented in detail on the Core Logic page, 11 collapsible sections). The process has 3 phases: Setup (build level grid from price range, calculate Math.ceil targets, pre-seed 1% above open), Tick-by-Tick Execution (SELL first then BUY for every tick sequentially), and Output (per-level cycle counts). Uses typed arrays (Uint8Array, Float64Array, Int32Array) for O(1) index access across all price levels.</p>
          <p style={{marginBottom:6}}><span style={{color:C.accent,fontWeight:700}}>Performance:</span> For a stock with 200 price levels and 2 million trades, the engine performs approximately 400 million comparisons. Typed arrays make this feasible in a browser in seconds rather than minutes.</p>
          <p style={{marginBottom:6}}><span style={{color:C.accent,fontWeight:700}}>BUY check:</span> O(1) lookup. The tick price is floored to find which level it belongs to, then that single level is checked.</p>
          <p><span style={{color:C.accent,fontWeight:700}}>SELL check:</span> O(n) loop across all levels. Each active level is checked against the tick price. Typed arrays make this fast despite being a full scan.</p>
          <p style={{marginTop:6}}><span style={{color:C.accent,fontWeight:700}}>scanOptimalTP(trades, cap, fee):</span> Per-day TP% optimizer. Loops TP% from 0.01% to 1.00% in 0.01% steps (up to 100 iterations). For each TP%, runs the full analyzePriceLevels() engine against all ticks. Key design: profit uses actual dollar spread (tpDollar = ceil(price x (1+TP%/100) x 100)/100 - price), not theoretical percentage. This means TP% values that ceil to the same penny target show identical per-cycle profit. NaN-safe sort by net profit, tpDollar clamped to min $0.01, tpDollar outer-rounded to clean floating point noise. Returns object with results array (tpPct, tpDollar, cycles, grossPC, adjFee, netPC, grossTotal, netTotal, capDeployed, roi), plus metadata (minTpPct, sharePrice, scanned count). Scope: full trading day only -- not hourly segmentation. Hourly TP% optimization is Stage 2 future work. Browser-side only, results not cached.</p>
        </div>
      </div>
    </CollapseStage>
    <CollapseStage title="Security Model" sub="How the app handles access and data">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6}}><span style={{color:C.gold,fontWeight:700}}>App Access:</span> Password-protected with hardcoded access code. No user accounts, no authentication server.</p>
          <p style={{marginBottom:6}}><span style={{color:C.gold,fontWeight:700}}>Polygon API Key:</span> Stored in browser memory only. Pre-seeded in settings. Sent directly to Polygon from the browser. Never transmitted to any other server.</p>
        <p style={{marginBottom:6}}><span style={{color:C.gold,fontWeight:700}}>Profit Calculations:</span> Computed entirely client-side from cached cycle counts and user inputs ($/Level, Fee/Cycle). No profit data is stored in the database. Changing inputs instantly recalculates all estimates.</p>
          <p style={{marginBottom:6}}><span style={{color:C.gold,fontWeight:700}}>Supabase Access:</span> Uses anon (public) key with Row Level Security disabled on cache tables. This is a single-user app behind a password screen, so full RLS is not required at this stage.</p>
          <p><span style={{color:C.gold,fontWeight:700}}>Data Privacy:</span> All trade data processing happens in the browser. Raw ticks are never sent to any server other than being fetched from Polygon. Only computed results (cycle counts, hourly aggregates) are stored in Supabase.</p>
        </div>
      </div>
    </CollapseStage>
    <CollapseStage title="Supabase Database" sub="Schema, tables, relationships, and cache flow">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <p style={{marginBottom:10}}>The Supabase project (oscillation-analytics, us-east-1) runs PostgreSQL 17 accessed via PostgREST API directly from the browser. The database stores computed results only. Raw trade ticks are never written to the database.</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Table: cached_analyses</p>
          <p style={{marginBottom:4,fontSize:9}}>One row per ticker/date/TP%/session combo. Primary results table.</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:8,color:'#8ec07c'}}>ticker, trade_date, tp_pct, session_type (unique key)</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:8,color:'#8ec07c'}}>total_cycles, active_levels, total_levels, total_trades</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:8,color:'#8ec07c'}}>tick_min, tick_max, open_price, pre_seed_max</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:8,color:'#8ec07c'}}>ohlc_open, ohlc_high, ohlc_low, ohlc_close, ohlc_volume</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Table: cached_levels</p>
          <p style={{marginBottom:4,fontSize:9}}>Per-level cycle counts. Linked to parent analysis via FK. Only levels with cycles &gt; 0 stored. CASCADE delete when parent removed.</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:8,color:'#8ec07c'}}>analysis_id (FK to cached_analyses.id)</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:8,color:'#8ec07c'}}>level_price, target_price, cycles</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Table: cached_seasonality</p>
          <p style={{marginBottom:4,fontSize:9}}>One row per ticker/date/hour. Hourly intraday metrics (16 rows per stock-day).</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:8,color:'#8ec07c'}}>ticker, trade_date, hour (unique key, hour 4-19 ET)</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:8,color:'#8ec07c'}}>high, low, atr, atr_pct, volume, trades</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Table: cached_sessions</p>
          <p style={{marginBottom:4,fontSize:9}}>One row per ticker/date/session. Pre-market, regular, and post-market breakdowns (3 rows per stock-day).</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:8,color:'#8ec07c'}}>ticker, trade_date, session_type (unique key)</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:8,color:'#8ec07c'}}>high, low, range_dollars, range_pct, volume, trades</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Relationships</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <div style={{background:'#0a0e14',borderRadius:4,padding:'8px',marginBottom:6}}>
            <pre style={{color:'#8ec07c',fontSize:7,fontFamily:F,margin:0,lineHeight:1.8}}>{"cached_analyses (1) --< cached_levels (many)\n  FK: cached_levels.analysis_id\n  CASCADE: delete analysis = delete levels\n\ncached_seasonality    (standalone, keyed by ticker+date+hour)\ncached_sessions       (standalone, keyed by ticker+date+session)\ncached_hourly_cycles  (standalone, keyed by ticker+date+hour+tp_pct+session)"}</pre>
          </div>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Cache Write Flow</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>1.</span> User runs analysis. Browser fetches ticks from Polygon, processes them.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>2.</span> Check if cached_analyses row exists for this ticker/date/TP%/session.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>3.</span> If exists: PATCH update the row. If not: POST insert new row.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>4.</span> DELETE all old cached_levels for this analysis_id, then INSERT fresh level rows.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>5.</span> Seasonality data: DELETE existing rows for ticker/date, INSERT 16 hourly + 3 session rows.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>6.</span> Hourly cycles: DELETE existing rows for ticker/date/TP%/session, INSERT 16 rows with per-hour cycle counts.</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Cache Read Flow</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.blue}}>1.</span> User taps Analyze. Before fetching from Polygon, query cached_analyses.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.blue}}>2.</span> If row found: load cached_levels for that analysis_id. Display results instantly.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.blue}}>3.</span> If not found: proceed to Polygon fetch, process, display, then cache results.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.blue}}>4.</span> Seasonality follows same pattern: check cached_seasonality first.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.blue}}>5.</span> Hourly cycles loaded from cached_hourly_cycles for the specific TP%. Displayed on main page, seasonality, and trend analysis.</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Storage Efficiency</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Per analysis:</span> ~1 row in cached_analyses (~500 bytes) + ~20-50 rows in cached_levels (~2KB) + 16 rows in cached_hourly_cycles (~1KB) = ~3.5KB per stock-day-TP%</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Per seasonality:</span> 16 rows in cached_seasonality + 3 rows in cached_sessions = ~3KB per stock-day</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Free tier capacity:</span> 500MB holds approximately 75,000+ stock-day analyses</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Compared to raw ticks:</span> NIO has 58K trades/day (~2.3MB). Storing computed results uses ~6.5KB. That is a 350x compression ratio.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Table: cached_hourly_cycles</p>
          <p style={{marginBottom:4,fontSize:9}}>One row per ticker/date/hour/TP%/session. Stores cycle counts per hour, tied to a specific take-profit percentage. 16 rows per stock-day-TP%.</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:8,color:'#8ec07c'}}>ticker, trade_date, hour, tp_pct, session_type (unique key)</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:8,color:'#8ec07c'}}>cycles</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Edge Function: batch-analyze</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,fontSize:9}}>A Deno-based serverless function deployed on Supabase that performs complete single-day analysis server-side. The function:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>1.</span> Receives: ticker, date, tp_pct, polygon_key, session_type</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>2.</span> Checks if results already exist in cached_analyses. If yes, returns "cached" instantly.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>3.</span> Fetches all trade ticks from Polygon (server-side, no browser involved)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>4.</span> Runs identical cycle analysis logic: typed arrays, SELL-first-then-BUY, pre-seed from open +1%, skip first tick</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>5.</span> Computes hourly seasonality (ATR, volume, trades, high/low) and session ranges</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>6.</span> Fetches OHLC from Polygon daily endpoint</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>7.</span> Saves everything to all five cache tables (analyses, levels, seasonality, sessions, hourly cycles) using service role key</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>8.</span> Discards all raw tick data. Returns summary JSON.</p>
          <p style={{marginBottom:6,fontSize:9,marginTop:8}}><span style={{color:C.gold,fontWeight:700}}>Timeout:</span> 150 seconds on free tier. Sufficient for stocks up to ~1M trades per day. For heavier stocks (2M+), the browser-based analysis is used instead.</p>
          <p style={{fontSize:9}}><span style={{color:C.gold,fontWeight:700}}>Authentication:</span> JWT verification disabled. Authenticated via Supabase anon key in Authorization header. The function uses the service role key internally for database writes.</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Access Control</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:4,fontSize:9}}>Row Level Security is disabled on all four cache tables. Access is controlled by the anon API key configured in Settings. The edge function uses the service role key for writes. This is appropriate for a single-user application behind a password-protected interface.</p>
        </div>
      </div>
    </CollapseStage>
        <CollapseStage title="Pages and Features" sub="Complete feature inventory">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Cycles Analysis:</span> Main page. Cycle counting with results, profit analysis (gross/net/fees with fractional fee scaling), OHLC, price levels table, sqrt-scaled cycles-by-hour chart (TP%-labeled), price action chart, trade-by-trade audit, CSV export. Parameters: ticker, date, TP%, $/Level, Fee/Cycle, session. Cache-first loading.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Import Stock Data:</span> Server-side date range processing with automatic browser-side fallback for high-volume stocks with browser-side fallback for high-volume stocks via edge function. Ticker, date range, TP%, session toggle. Live progress log with cancel. Skips cached days. Saves cycle counts, seasonality, and hourly cycles to database.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Intraday Seasonality:</span> Single-day intraday analysis with TP% input. ATR $, price ranges ($ with high/low), range %, swing %, cycles-by-hour (TP%-labeled), volume, trades. Session ranges table (pre/reg/post). Cache-first loading.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Optimal TP% Finder:</span> Scans up to 100 TP% values (0.01%-1.00%) against full tick data for a single trading day. Each TP% runs the complete analyzePriceLevels() engine. Profit uses actual dollar spread from Math.ceil rounding (not theoretical %). Fractional fee scaling applied. Ranked by net profit. Available in two places: (1) standalone page under Stage 1 that fetches its own ticks, and (2) "Find Optimal TP%" button on Cycles Analysis page that reuses already-loaded ticks for zero extra API calls. Scope: per-day analysis only -- the scanner evaluates one full day at a time. Does NOT perform hourly TP% segmentation. To compare optimal TP% across multiple days, run the scanner on each day individually. Hourly TP% optimization is planned as Stage 2 development. Browser-side computation only, results not stored in database.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Trend Analysis:</span> Multi-day pattern detection with TP% input. Average hourly profiles (ATR $, ATR %, cycles, volume, trades, swing %). Heatmaps (ATR %, ATR $, cycles with TP% label, volume, trades, swing %) all with AVG rows. Day-over-day summary table. Queries cached data only -- instant loading.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Database Management:</span> Per-stock cached data visibility with date ranges, cycle counts, day-by-day detail. Delete per-stock or clear all. Cleans all 5 cache tables including hourly cycles.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Objectives:</span> 5-stage Edge Detection System roadmap with data pipeline architecture</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Core Logic:</span> 11 collapsible sections: Beta Algorithm, Cycle Measurement, Execution Logic, Profit Calculation (fractional fees + actual dollar spread), Optimal TP% Finder (per-day scanner logic + Math.ceil explanation + worked example), Trade Audit, Cross-Verification Python, Polygon Data Source, Market Data Disclaimers, CSV Upload Verification</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Verify Logic Data Upload:</span> CSV upload for manual logic verification against hand-counted test data</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Source Code:</span> 7 collapsible sections: architecture, providers, data flow, engine, security, database schema, pages. Download source + developer handoff with CLAUDE.md.</p>
          <p><span style={{color:C.accent}}>Settings:</span> Polygon API key + Supabase URL/anon key (editable, clearable). Caching disabled warning when empty.</p>
        </div>
      </div>
    </CollapseStage>
    <Cd>
      <SectionHead title="Download Source" sub="Get the complete application source code"/>
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:8,marginBottom:12}}>
        <p>The button below downloads the complete application as a single HTML file. This file contains all source code, styles, and logic. You can open it directly in any browser to run the app locally, or deploy it to any static hosting service.</p>
      </div>
      <button onClick={downloadSource} style={Object.assign({},bB,{background:'linear-gradient(135deg,#00e5a0,#00c488)',color:C.bg})}>Download Source Code</button>
    </Cd>
    <CollapseStage title="Developer Handoff" sub="Everything needed to continue development">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <p style={{marginBottom:10}}>These files give any developer (or AI assistant) full context to continue building this app. The CLAUDE.md file works as a project knowledge document for both Claude Code (place in project root) and Claude.ai (upload at conversation start).</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>What the handoff package includes:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.txtBright}}>CLAUDE.md</span> -- Complete project knowledge: architecture, algorithm rules (SELL-first, pre-seed, skip first tick), database schema with all 4 tables, edge function docs, build process, UI components, color constants, known gotchas (Recharts BarChart crash, PostgREST upsert 400s, Babel Unicode issues), session boundaries, the 5-stage roadmap, and setup instructions for both Claude Code and Claude.ai.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.txtBright}}>app.jsx</span> -- The complete JSX source code (current version).</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.txtBright}}>index.html</span> -- The compiled, deployable HTML file (download via button above).</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>For Claude Code users:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>1. Place CLAUDE.md in your project root alongside app.jsx</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>2. Claude Code reads it automatically on every session</p>
          <p style={{paddingLeft:8,fontSize:9}}>3. Start coding -- the AI knows all algorithm rules, database schemas, and build quirks</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:14}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>For Claude.ai users:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>1. Upload CLAUDE.md and app.jsx at the start of your conversation</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>2. Connect Supabase MCP integration (project ID: haeqzegdlwryvaecanrn)</p>
          <p style={{paddingLeft:8,fontSize:9}}>3. The AI has full context to make changes, deploy edge functions, and query the database</p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={function(){
            var el=document.documentElement.outerHTML;
            var jsxStart=el.indexOf('var C={');
            var jsxEnd=el.lastIndexOf('}catch(e){')+10;
            var jsx=el.substring(jsxStart,jsxEnd);
            var blob=new Blob([jsx],{type:'text/plain'});
            var u=URL.createObjectURL(blob);
            var a=document.createElement('a');a.href=u;a.download='app.jsx';a.click();URL.revokeObjectURL(u);
          }} style={Object.assign({},bB,{flex:1,background:'linear-gradient(135deg,#3d9eff,#2080dd)',color:'#fff'})}>Download app.jsx</button>
          <button onClick={function(){
            var md='# Alpha Quant Analytics -- Project Knowledge Document\n## CLAUDE.md / Developer Handoff\n\n**Last Updated:** April 1, 2026 | **Current Version:** v86\n\n---\n\n## What This App Is\n\nAlpha Quant Analytics is a quantitative analysis web app for the Beta Proprietary Algorithm -- a continuous level-based position cycling system deployed on Alpaca Markets. The app measures how many buy-to-sell cycles each $0.01 price level completes for a given stock on a given day.\n\n**Live URL:** https://starlit-hamster-2c27fa.netlify.app/\n**Password:** BT\n\n---\n\n## Architecture\n\nSingle-file React 18 app (~600KB compiled HTML). Pre-compiled JSX with Babel. All styles inline JS objects. Font: JetBrains Mono. Core engine uses typed arrays (Uint8Array, Float64Array, Int32Array) for high-performance tick processing. Heavy stocks use browser Web Worker (background thread) for non-blocking computation.\n\n### Service Providers\n- Netlify: Static hosting (free tier)\n- Polygon.io: Trade tick data + OHLC (paid developer account)\n- Supabase: Database cache + edge functions (free tier, project: oscillation-analytics, ID: haeqzegdlwryvaecanrn, region: us-east-1)\n- Cloudflare: Workers Paid ($5/mo) for server-side hourly TP% scanning\n- CDN: React 18.2.0, ReactDOM, Recharts 2.12.7, JetBrains Mono\n\n---\n\n## Build Process\n\nnpm install @babel/core @babel/preset-react\nThen compile JSX to JS with Babel, wrap in HTML shell with CDN script loaders.\n\n### Critical Build Notes\n- No runtime Babel -- must pre-compile\n- Em dashes and Unicode -- replace with ASCII before Babel\n- Recharts BarChart CRASHES from CDN -- use pure CSS bar charts. AreaChart works fine.\n- PostgREST upsert returns 400 -- use check-exists then PATCH or INSERT\n- Python f-strings in JSX -- store as escaped JS variable\n\n---\n\n## Database Schema (RLS disabled, anon key access, 7 tables)\n\n### cached_analyses\nUNIQUE(ticker, trade_date, tp_pct, session_type)\nColumns: id, ticker, trade_date, tp_pct, session_type, total_cycles, active_levels, total_levels, total_trades, tick_min, tick_max, open_price, pre_seed_max, ohlc_open/high/low/close/volume, created_at\n\n### cached_levels\nFK to cached_analyses.id (CASCADE delete). Only levels with cycles > 0 stored.\nColumns: id, analysis_id, level_price, target_price, cycles\n\n### cached_seasonality\nUNIQUE(ticker, trade_date, hour). 16 rows per stock-day (hours 4-19 ET).\nColumns: id, ticker, trade_date, hour, high, low, atr, atr_pct, volume, trades, created_at\n\n### cached_sessions\nUNIQUE(ticker, trade_date, session_type). 3 rows per stock-day (pre/reg/post).\nColumns: id, ticker, trade_date, session_type, high, low, range_dollars, range_pct, volume, trades, created_at\n\n### cached_hourly_cycles\nUNIQUE(ticker, trade_date, hour, tp_pct, session_type). 16 rows per stock-day-TP%.\nColumns: id, ticker, trade_date, hour, tp_pct, session_type, cycles, created_at\n\n### optimal_tp_hourly\nUNIQUE(ticker, trade_date, hour, tp_pct, session_type). 1,600 rows per stock-day (100 TP% x 16 hours).\nColumns: id, ticker, trade_date, hour, tp_pct, session_type, cycles, tp_dollar, net_profit, created_at\n\n### hourly_features\nUNIQUE(ticker, trade_date, hour). 16 rows per stock-day. Stage 3 feature extraction data.\nColumns: id, ticker, trade_date, hour, hour_open/close/high/low, hour_atr_dollar, hour_atr_pct, hour_volume, hour_trades, hour_vwap, hour_first_ts, hour_last_ts, day_open/high/low/close, day_volume, day_trades, price_vs_day_open_pct, intraday_range_pct, cumulative_volume_pct, prev_day_close, overnight_gap_pct, vix_close, day_of_week, created_at\n\n### hourly_features\nUNIQUE(ticker, trade_date, hour). 16 rows per stock-day.\nColumns: id, ticker, trade_date, hour, hour_open/close/high/low, hour_atr_dollar/atr_pct, hour_volume/trades/vwap, hour_first_ts/last_ts, day_open/high/low/close/volume/trades, price_vs_day_open_pct, intraday_range_pct, cumulative_volume_pct, prev_day_close, overnight_gap_pct, vix_close, day_of_week, created_at\n\n---\n\n## Edge Function: batch-analyze\n\nServer-side batch processing. Receives ticker/date/tp_pct/polygon_key/session_type. Fetches ticks from Polygon, runs full cycle analysis + seasonality + hourly cycles, saves to all 5 cache tables, discards ticks. JWT disabled. 150s timeout.\n\n### Cloudflare Worker: hourly-tp-scanner\nURL: https://hourly-tp-scanner.alcharles1980.workers.dev/\nAccount: bdb27846cbf6226edde4fa0f6d530ffa (Workers Paid plan, $5/mo)\nCPU limit: 300,000ms (5 minutes). Runs 100 TP% x 16 hours cycle engine server-side.\nFetches ticks from Polygon, computes, saves 1,600 rows to optimal_tp_hourly in Supabase.\nWorks for lighter stocks (NIO, CCL). Exceeds 128MB memory limit on heavy stocks (SOXL 254K+ trades).\nFor heavy stocks, app falls back to browser Web Worker (background thread) to keep UI responsive.\nserverFailed flag skips server attempts after first failure on same ticker.\n\n### Browser-Side Fallback\nWhen edge function fails (status 546/500/502/504 -- typically high-volume stocks like SOXL with 254K+ trades/day exceeding free tier limits), the Import Stock Data page automatically retries in the browser. Uses analyzePriceLevels + computeHourlyCycles + seasonality computation, fetches ticks via Polygon directly, saves to all 5 tables via PostgREST. Log shows (browser) tag on fallback-processed days.\n\n---\n\n## Core Algorithm -- CRITICAL RULES\n\nNOT a grid bot. Independent level-based position cycling.\n\n### Cycle Counting Process Flow\n\nPhase 1 -- Setup:\n1. Fetch all tick data from Polygon (every trade execution, all exchanges)\n2. Find min/max price, floor/ceil to whole pennies to define the level grid\n3. Build one level per penny using typed arrays (Uint8Array, Float64Array, Int32Array) for O(1) access\n4. Calculate sell targets: Math.ceil(level * (1+TP%/100) * 100) / 100 -- always rounds up to next tradeable penny\n5. Pre-seed: first tick = opening price (observe only). Levels from floor(open) to round(open*1.01) start ACTIVE (~1% above open). All others INACTIVE.\n\nPhase 2 -- Tick-by-tick execution (from tick #2):\nFor each tick, two operations in strict order:\nA. SELL first (loop ALL levels): if level is ACTIVE and tick >= target, cycle completes, level goes INACTIVE, cycle counter increments. Multiple levels can sell on same tick.\nB. BUY second (ONE level): floor(tick*100) finds which level. If INACTIVE, activate it. Only one level per tick.\nSELL-before-BUY order is critical -- prevents counting a cycle and re-buying on same tick.\n\nPhase 3 -- Output:\nPer-level cycle counts, total cycles, active levels. Deterministic: same ticks + same TP% = same results always.\n\n### Pre-seed\n- First tick = opening price (observe only)\n- Levels from open to open+1% pre-seeded as ACTIVE\n- All other levels start INACTIVE\n\n### Execution Per Tick (SELL first, then BUY)\n1. SELL: For each active level, if tick >= target (level * (1+TP%)): cycle completes, level goes INACTIVE\n2. BUY: For the ONE level this tick belongs to (floor to $0.01): if INACTIVE, activate it\n\n### Rules\n- BUY: tick within level $0.01 range (level <= tick < level + 0.01). Sub-penny ticks compared directly -- $5.6799 does NOT buy $5.68\n- SELL: tick >= target (at-or-better)\n- First tick: observe only\n- Target rounding: always ceil to next penny (Math.ceil). Stocks trade at sub-penny prices but limit orders are placed at whole penny increments. Ceil ensures target is always a tradeable penny at least $0.01 above entry.\n\n### Profit Calculation\n- gross_per_cycle = shares_per_level x actual_dollar_spread (where spread = ceil(price*(1+TP%/100)*100)/100 - price)\n- shares_per_level = $/Level / share_price\n- adjusted_fee = base_fee_per_share x shares_per_level\n- net_per_cycle = gross_per_cycle - adjusted_fee\n- net_roi = (total_cycles x net_per_cycle) / (active_levels x $/Level)\n\n### Optimal TP% Finder (scanOptimalTP)\n- Scans TP% from 0.01% to 1.00% in 0.01% increments (up to 100 iterations)\n- For each TP%, runs full analyzePriceLevels() engine against all ticks for the day\n- Calculates actual dollar spread: tpDollar = ceil(price * (1+TP%/100) * 100) / 100 - price (ceil because limit orders are at whole pennies)\n- Profit uses actual dollar spread (not theoretical %): gross = fractional_shares x tpDollar\n- NaN-safe sort, tpDollar clamped to min $0.01\n- Scope: per-day (full trading day), NOT per-hour. Hourly segmentation is future Stage 2 work.\n- Available as: (1) standalone page (fetches own ticks) and (2) button on Cycles Analysis (reuses loaded ticks)\n- Browser-side only, not on edge function. Results not cached -- computed on demand from raw ticks.\n\n### Hourly Optimal TP% Finder (scanHourlyOptimalTP)\n- Runs computeHourlyCycles 100 times (TP% 0.01-1.00) against full day tick data\n- Attributes each cycle to the hour its SELL fired in (full-day engine, not hourly slices)\n- Builds 100 x 16 matrix: each cell = cycles, tpDollar, netProfit for that TP%/hour combination\n- Finds best TP% per hour, computes adaptive total vs flat comparison\n- Saves to optimal_tp_hourly table. Browser-side only.\n\n### [CRITICAL] Logic must match across ALL 8 locations:\n1. analyzePriceLevels() in app\n2. computeHourlyCycles() in app\n3. TradeAudit component\n4. CSV Export handler\n5. UploadPage audit\n6. Edge function batch-analyze\n7. Cloudflare Worker hourly-tp-scanner\n8. Browser Web Worker (bgWorkerCode in HourlyOptimalPage)\n\n---\n\n## Pages (17 menu items + section headers)\n1. Cycles Analysis -- cycle counting, profit analysis (gross/net/fees with fractional fee scaling), OHLC, levels, cycles-by-hour, chart, audit, CSV export, cache-first\n2. Import Stock Data -- server-side date range processing via edge function, live progress log\n3. Intraday Seasonality -- single-day hourly analysis with TP% input (ATR, ranges, swing, cycles-by-hour TP%-labeled, volume, trades, sessions)\n4. Optimal TP% Finder -- per-day scanner (not hourly), tests up to 100 TP% values (0.01%-1.00%), ranks by net profit after fractional fees, uses actual dollar spread via Math.ceil. Available as standalone page (fetches own ticks) and button on Cycles Analysis (reuses loaded ticks). Browser-side only, results not cached.\n5. Trend Analysis -- multi-day with TP% input, 6 avg profiles incl cycles, 6 heatmaps incl cycles (TP%-labeled) with AVG rows\n6. Objectives -- 5-stage Edge Detection roadmap\n7. Core Logic -- 11 collapsible sections (Beta Algorithm, Cycle Measurement, Execution Logic, Profit Calculation, Optimal TP% Finder, Trade Audit, Cross-Verification Python, Polygon Data Source, Disclaimers, CSV Upload)\n8. Verify Logic Data Upload -- CSV verification\n9. Database Management -- cached stock management with delete\n10. Source Code -- architecture docs + this handoff\n11. Settings -- Polygon + Supabase config\n12. Adaptive Optimization Logic -- Stage 2 documentation page explaining full-day engine hourly attribution, multi-day aggregation, infrastructure requirements, measurement-to-prediction pipeline\n13. Hourly Optimal TP% Finder -- Stage 2 scanner. Date range input. Runs scanHourlyOptimalTP (100 TP% x 16 hours) per day. Aggregates across days. Shows Adaptive vs Flat comparison, best TP% by hour bar chart, TP% heatmap. Saves to optimal_tp_hourly table.\n14. Download Raw Data -- Fetches raw trade tick data from Polygon /v3/trades for a date range, downloads as CSV with all fields (sip_timestamp, price, size, exchange, conditions, etc). For cross-verification of all computed values.\n15. Correlation Analysis Logic -- Stage 3 documentation page. Two approaches: (1) Market microstructure features from Polygon tick data correlated with optimal TP%, (2) Live trading system analysis from Beta system executed trades via API.\n16. Features List -- Catalog of 20 ML features across 7 categories (Temporal, Volatility, Volume, Price Position, Momentum, Cross-Asset, Live System). Each with what/why/calculation/code.\n17. Build Data Set -- Feature extraction pipeline. Fetches Polygon ticks and extracts 22 hourly features (price OHLC, ATR, volume, VWAP, derived position, day context, VIX, overnight gap). Saves to hourly_features table.\n15. Correlation Analysis Logic -- Stage 3 documentation. Two approaches: (1) Market microstructure feature correlation from Polygon tick data, (2) Live trading system analysis from Beta system executed trades.\n16. Features List -- Catalog of 20 features across 7 categories (Temporal, Volatility, Volume, Price Position, Momentum, Cross-Asset, Live System). Each with What/Why/Calculation/Code.\n17. Build Data Set -- Feature extraction pipeline. Fetches Polygon ticks and extracts 22 hourly features (OHLC, ATR, volume, VWAP, position, VIX, overnight gap) into hourly_features table.\n\n### Menu Structure\n- Objectives\n- Core Logic\n  - Verify Logic Data Upload (indented)\n- STAGE 1: MEASUREMENT (section header)\n  - Cycles Analysis (indented)\n  - Intraday Seasonality (indented)\n  - Trend Analysis (indented)\n  - Optimal TP% Finder (indented)\n- STAGE 2: OPTIMIZATION (section header)\n  - Adaptive Optimization Logic (indented)\n  - Hourly Optimal TP% Finder (indented)\n- STAGE 3: CORRELATION (section header)\n  - Correlation Analysis Logic (indented)\n  - Features List (indented)\n  - Build Data Set (indented)\n- Import Stock Data\n  - Database Management (indented)\n  - Download Raw Data (indented)\n- STAGE 3: CORRELATION (section header)\n  - Correlation Analysis Logic (indented)\n  - Features List (indented)\n  - Build Data Set (indented)\n- Source Code\n- Settings\n\n---\n\n### SB Methods (10)\nloadAnalysis, saveAnalysis, loadHourlyCycles, loadSeasonality, saveHourlyCycles, loadOptimalTP, loadOptimalTPRange, saveOptimalTP, saveHourlyFeatures, saveSeasonality\n\n## UI Components: Splash, Cd (card), Mt (metric), SectionHead, Info (modal), CollapseStage, MenuDropdown, TradeAudit, SessionRow\n\n## Colors: bg #060a10, accent #00e5a0, blue #3d9eff, gold #ffb020, purple #a855f7, warn #ff5c3a\n\n## Session Boundaries (ET): Pre 4:00-9:30 (min 240-570), Regular 9:30-4:00 (min 570-960), Post 4:00-8:00 (min 960-1200)\n\n---\n\n## 5-Stage Roadmap\n1. Cycle Measurement (BUILT)\n2. Adaptive TP% Optimization\n3. ML Correlation Detection\n4. Live Adaptive Engine\n5. Reinforcement Learning\n';
            var blob=new Blob([md],{type:'text/markdown'});
            var u=URL.createObjectURL(blob);
            var a=document.createElement('a');a.href=u;a.download='CLAUDE.md';a.click();URL.revokeObjectURL(u);
          }} style={Object.assign({},bB,{flex:1,background:'linear-gradient(135deg,#a855f7,#8040d0)',color:'#fff'})}>Download CLAUDE.md</button>
        </div>
      </div>
    </CollapseStage>
  </div>;
}
function SettingsPage(p){
  var ks=useState(p.apiKey),key=ks[0],setKey=ks[1];
  var ss=useState(false),saved=ss[0],setSaved=ss[1];
  var us=useState(p.sbUrl),sUrl=us[0],setSUrl=us[1];
  var usk=useState(p.sbKey),sKey=usk[0],setSKey=usk[1];
  var ss2=useState(false),savedSb=ss2[0],setSavedSb=ss2[1];
  var savePg=function(){p.onSave(key);setSaved(true);setTimeout(function(){setSaved(false);},2000);};
  var saveSb=function(){p.onSaveSb(sUrl,sKey);setSavedSb(true);setTimeout(function(){setSavedSb(false);},2000);};
  var clearSb=function(){setSUrl('');setSKey('');p.onSaveSb('','');};
  return <div>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Settings</div>
    </div>
    <Cd>
      <SectionHead title="Polygon.io API" sub="Market data source for trade ticks and OHLC" info="Your Polygon.io API key is used to fetch historical trade data directly from US stock exchanges. The key is stored in this app only and sent directly to Polygon from your browser."/>
      <div style={{marginBottom:12,marginTop:10}}>
        <label style={lS}>API Key</label>
        <input type="password" value={key} onChange={function(e){setKey(e.target.value);}} placeholder="Enter your Polygon.io key" style={iS}/>
      </div>
      <button onClick={savePg} style={Object.assign({},bB,{background:saved?C.accent:'linear-gradient(135deg,#00e5a0,#00c488)',color:C.bg})}>{saved?'Saved!':'Save Polygon Key'}</button>
    </Cd>
    <Cd>
      <SectionHead title="Supabase Database" sub="Cache layer for computed analysis results" info="Supabase stores your computed analysis results so repeat queries load instantly. The URL and anon key connect directly to your Supabase project. No raw trade data is stored — only cycle counts and hourly aggregates."/>
      <div style={{marginBottom:8,marginTop:10}}>
        <label style={lS}>Project URL</label>
        <input type="text" value={sUrl} onChange={function(e){setSUrl(e.target.value);}} placeholder="https://your-project.supabase.co" style={iS}/>
      </div>
      <div style={{marginBottom:12}}>
        <label style={lS}>Anon Key</label>
        <input type="password" value={sKey} onChange={function(e){setSKey(e.target.value);}} placeholder="Enter your Supabase anon key" style={iS}/>
      </div>
      <div style={{display:'flex',gap:8}}>
        <button onClick={saveSb} style={Object.assign({},bB,{flex:1,background:savedSb?C.accent:'linear-gradient(135deg,#00e5a0,#00c488)',color:C.bg})}>{savedSb?'Saved!':'Save Supabase Config'}</button>
        <button onClick={clearSb} style={Object.assign({},bB,{width:'auto',padding:'10px 14px',background:'transparent',border:'1px solid '+C.border,color:C.warn})}>Clear</button>
      </div>
      {(!sUrl||!sKey)&&<div style={{marginTop:8,color:C.gold,fontSize:9,fontFamily:F}}>Caching disabled. Analysis will fetch from Polygon every time.</div>}
    </Cd>
  </div>;
}
function LogicPage(p){
  return <div>
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Core Logic</div>
    </div>
    <CollapseStage title="The Beta Proprietary Algorithm" sub="Continuous level-based position cycling">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <p style={{marginBottom:10}}>The Beta algorithm operates on a principle of continuous position cycling across every $0.01 price level. Each level is its own independent trading unit with its own entry, exit, and accounting. There is no cross-mixing of capital between levels.</p>
        <p style={{marginBottom:10}}>At market open, the algorithm pre-seeds a staggered ladder of buy positions from the opening price up to 1% above. As price rises and levels hit their sell targets, they close out and go inactive. When price later returns down to an inactive level, it re-enters with a new buy, creating an infinite loop of buying on pullbacks and selling on rises.</p>
        <p>For levels below the open, the algorithm enters them naturally when price first visits that range. From that point, they follow the same cycle: sell at target, wait for return, re-buy.</p>
      </div>
    </CollapseStage>
    <CollapseStage title="Stage 1: Cycle Measurement" sub="Time series analysis of historical trade data">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <p style={{marginBottom:10}}>This app is the Stage 1 measurement tool. It takes real trade-by-trade tick data from exchanges and measures how many complete buy-to-sell cycles occurred at each $0.01 level for a given take-profit percentage.</p>
        <p>Every tick for the selected day is fetched from Polygon.io and walked in exact chronological order. The first tick establishes the opening price and determines the pre-seeded ladder range (+1% above open). From the second tick onwards, the engine evaluates all levels on every tick.</p>
      </div>
    </CollapseStage>
    <CollapseStage title="The Cycle Counting and Tracking Process Flow" sub="Step-by-step walkthrough of the complete engine">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Phase 1: Setup</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>1. Fetch tick data:</span> Every individual trade execution for the selected ticker and date is fetched from Polygon.io. These are real trades from all US exchanges (NYSE, NASDAQ, IEX, ARCA, BATS, etc.) sorted in exact chronological order. A typical stock has 50,000-250,000 ticks per day.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>2. Determine price range:</span> Scan all ticks to find the absolute minimum and maximum price for the day. Floor the min and ceil the max to whole pennies. This defines the range of $0.01 price levels.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>3. Build the level grid:</span> Create one level for every penny from floor(min) to ceil(max). For a stock trading between $5.54 and $5.90, that is 36 levels. Each level is stored in typed arrays (Uint8Array for active/inactive state, Float64Array for target price, Int32Array for cycle count) for O(1) index access and fast iteration.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>4. Calculate sell targets:</span> For each level, the sell target = Math.ceil(level x (1 + TP%/100) x 100) / 100. The ceil (round up) ensures the target is always a whole tradeable penny. Stocks trade at sub-penny prices on exchanges, but limit orders can only be placed at whole penny increments. For example, level $5.68 at 0.20% TP: theoretical target = $5.68 x 1.002 = $5.69136, ceil to $5.70. The actual dollar spread is $0.02.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>5. Pre-seed the opening ladder:</span> The first tick is the opening price. It is observed but no orders are placed. All levels from floor(openPrice) to round(openPrice x 1.01) are marked ACTIVE -- this simulates having limit buy orders pre-placed within 1% above the opening price. All other levels start INACTIVE. For a $5.68 open, levels $5.68 through $5.74 (6 levels) are pre-seeded.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Phase 2: Tick-by-Tick Execution (starting from tick #2)</p>
          <p style={{marginBottom:6,paddingLeft:8,fontSize:9}}>For every subsequent tick after the first, two operations run in strict order:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Step A -- SELL first (loop ALL levels):</span> Iterate through every level in the grid. For each level that is currently ACTIVE: check if the current tick price is greater than or equal to that level's sell target. If yes: the cycle is complete. Increment that level's cycle counter by 1. Set the level to INACTIVE. This represents the limit sell order being filled. Multiple levels can complete cycles on the same tick.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Step B -- BUY second (ONE level only):</span> Determine which single level this tick belongs to by flooring the tick price to the nearest penny: index = floor(price x 100) - minCents. If that level is currently INACTIVE, set it to ACTIVE. This represents a limit buy order being filled. Only one level can activate per tick because each tick has one price that falls within exactly one $0.01 range.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.warn}}>Critical -- SELL before BUY:</span> This order matters. If a tick hits both a sell target and a buy level on the same tick, the sell executes first. Without this rule, a level could complete a cycle and immediately re-activate on the same tick, producing incorrect counts.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Phase 3: Output</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Per-level results:</span> Each level has a final cycle count (how many times it completed a full buy-to-sell round trip). Levels with zero cycles had no completed trades. Results are sorted by cycle count descending.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Summary:</span> Total cycles across all levels, number of active levels (those with cycles > 0), total levels in the grid.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Deterministic:</span> Given the same tick data and the same TP%, the engine will always produce the exact same cycle counts. There is no randomness, no sampling, and no approximation. Every tick is evaluated against every active level.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Worked Example: NIO $5.68, TP% = 1%</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.blue}}>Setup:</span> Open at $5.6823. floor = $5.68. Pre-seed range = $5.68 to round($5.68 x 1.01) = $5.74. Levels $5.68, $5.69, $5.70, $5.71, $5.72, $5.73, $5.74 are ACTIVE (7 levels).</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.blue}}>Level $5.70 target:</span> ceil($5.70 x 1.01 x 100) / 100 = ceil(575.7) / 100 = $5.76.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.blue}}>Tick $5.7612:</span> SELL check: $5.7612 at-or-above $5.76 target for level $5.70? Yes. Cycle #1 complete on $5.70. Level $5.70 goes INACTIVE. BUY check: floor($5.7612 x 100) = 576 = level $5.76. If $5.76 is INACTIVE, activate it.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.blue}}>Tick $5.6988:</span> SELL check: no active level has a target at or below $5.6988. BUY check: floor = 569 = level $5.69. Already active (pre-seeded). No change.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.blue}}>Tick $5.7004:</span> SELL check: no match. BUY check: floor = 570 = level $5.70. Currently INACTIVE (sold earlier). Re-activate. Level $5.70 is now ACTIVE again with a fresh position.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.blue}}>Tick $5.7622:</span> SELL check: $5.7622 at-or-above $5.76 target for $5.70? Yes. Cycle #2 complete on $5.70. This is the power of oscillation -- the same level can cycle many times as price bounces back and forth.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Performance</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>For a stock with N levels and T ticks, the engine performs approximately N x T comparisons for the SELL check (every level checked against every tick). The BUY check is O(1) per tick (direct index lookup). For NIO with ~46 levels and ~59,000 ticks, that is ~2.7 million comparisons -- completed in under 1 second with typed arrays.</p>
          <p style={{paddingLeft:8,fontSize:9}}>For the Optimal TP% scanner, this runs 100 times (one per TP% value). For the Hourly scanner, computeHourlyCycles runs 100 times with identical logic but tracking which hour each sell fires in. The typed arrays make this feasible in a browser without any server-side compute.</p>
        </div>
      </div>
    </CollapseStage>
    <CollapseStage title="Execution Logic" sub="Limit order fill rules at each tick">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6}}><span style={{color:C.accent,fontWeight:700}}>Step 1:</span> First tick = opening price. Pre-seed levels from open to +1% as ACTIVE. All others start INACTIVE.</p>
          <p style={{marginBottom:6}}><span style={{color:C.accent,fontWeight:700}}>Target Rounding:</span> Sell targets always use Math.ceil (round up to next penny). This ensures the target is always at least $0.01 above the entry level. Multiple TP% values may produce the same penny target.</p>
          <p style={{marginBottom:6}}><span style={{color:C.accent,fontWeight:700}}>Step 2:</span> Each subsequent tick runs two checks:</p>
          <p style={{marginBottom:4,paddingLeft:12}}><span style={{color:C.blue,fontWeight:700}}>BUY:</span> Inactive level where tick is within its $0.01 range (level {"<="} tick {"<"} level + $0.01) activates.</p>
          <p style={{marginBottom:6,paddingLeft:12}}><span style={{color:C.gold,fontWeight:700}}>SELL:</span> Active level where tick {">="} target (level x (1+TP%)) completes a cycle. Level goes inactive.</p>
          <p><span style={{color:C.accent,fontWeight:700}}>Step 3:</span> Repeat for every tick. Count total cycles per level.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.txtBright,fontWeight:700}}>Sub-penny market reality:</p>
          <p style={{marginBottom:6,fontSize:9}}>Stocks trade at sub-penny prices on exchanges (e.g. $5.6753, $25.5901). However, limit orders can only be placed at whole penny increments ($5.68, $25.60). This is why sell targets use Math.ceil -- to always round UP to the next tradeable penny. A theoretical target of $5.6753 becomes a limit sell at $5.68.</p>
          <p style={{marginBottom:4,color:C.txtBright,fontWeight:700}}>Sub-penny tick comparison rules:</p>
          <p style={{marginBottom:4}}><span style={{color:C.warn}}>X</span> $5.67 does NOT buy $5.68 (5.67 {"<"} 5.68)</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>OK</span> $5.67 DOES buy $5.67 (5.67 {"<="} 5.67 {"<"} 5.68)</p>
          <p style={{marginBottom:4}}><span style={{color:C.warn}}>X</span> $5.7299 does NOT sell target $5.73 (5.7299 {"<"} 5.73)</p>
          <p><span style={{color:C.accent}}>OK</span> $5.7300 DOES sell target $5.73 (5.73 {">="} 5.73)</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:4,color:C.txtBright,fontWeight:700}}>Pre-seed example (open $5.68, 1% TP):</p>
          <p style={{marginBottom:4}}>Pre-seeded: $5.68 to $5.74</p>
          <p style={{marginBottom:4}}>Level $5.70, target $5.76</p>
          <p style={{marginBottom:4}}>Price hits $5.76 = <span style={{color:C.gold}}>SELL, Cycle #1</span></p>
          <p style={{marginBottom:4}}>Price drops to $5.70 = <span style={{color:C.blue}}>RE-BUY</span></p>
          <p>Price hits $5.76 again = <span style={{color:C.gold}}>SELL, Cycle #2</span></p>
        </div>
      </div>
    </CollapseStage>
    <CollapseStage title="Profit Calculation" sub="How profit is estimated from cycle counts">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <p style={{marginBottom:10}}>The profit analysis takes the cycle counts from the algorithm and estimates theoretical profit based on three user-configurable inputs: Take Profit %, Capital Per Level, and Fee Per Cycle.</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Gross Profit Per Cycle</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>gross_per_cycle = shares_per_level x actual_dollar_spread</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>where actual_dollar_spread = ceil(price x (1+TP%/100) x 100) / 100 - price</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>Example: $1/level at 1% TP = $0.01 gross per cycle</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Fractional Fee Adjustment</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>The fee input is a per-share fee (e.g. $0.005/share commission). Since capital per level is typically less than the share price, you are buying fractional shares. The fee is scaled proportionally:</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>shares_per_level = $/Level / Share Price</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>adjusted_fee = base_fee x shares_per_level</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>Example: $1/level on a $5.53 stock = 0.1808 shares. Fee = $0.005 x 0.1808 = $0.0009/cycle</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Net Profit</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>net_per_cycle = gross_per_cycle - adjusted_fee</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>total_net_profit = total_cycles x net_per_cycle</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>capital_deployed = active_levels x $/Level</p>
          <p style={{paddingLeft:8,fontSize:9}}>net_roi = total_net_profit / capital_deployed x 100</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:6,color:C.gold,fontWeight:700}}>Important Assumptions</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>This is a theoretical maximum. It assumes all active levels are fully funded at the specified $/Level amount, all cycles execute at exactly the target price (no slippage), and fees are uniform across all trades. Real-world execution may differ due to partial fills, slippage, and variable fee structures.</p>
        </div>
      </div>
    </CollapseStage>
    <CollapseStage title="Optimal TP% Finder" sub="How the scanner finds the best take-profit percentage">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <p style={{marginBottom:10}}>The Optimal TP% Finder runs the full cycle analysis engine multiple times against the same tick data, each time with a different take-profit percentage. It then ranks the results by net profit to find the most profitable TP% for that specific day.</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>How It Works</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>1. Fetch all tick data for the selected ticker and date from Polygon</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>2. Loop through TP% values from 0.01% to 1.00% in 0.01% increments (up to 100 iterations)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>3. For each TP%, run the full analyzePriceLevels() engine against ALL ticks</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>4. Calculate actual dollar spread: tpDollar = ceil(price x (1 + TP%/100) x 100) / 100 - price</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>5. Compute profit: gross = fractional_shares x tpDollar, net = gross - adjusted_fee</p>
          <p style={{paddingLeft:8,fontSize:9}}>6. Sort all results by net profit descending. Winner = highest net profit after fees.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Scope and Limitations</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Per-day analysis:</span> The scanner evaluates one full trading day at a time. It finds the single TP% that would have been most profitable across the entire day.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Not hourly:</span> The current implementation does not scan TP% on a per-hour basis. The optimal TP% may vary by hour (e.g. smaller TP% during volatile open, larger during quiet lunch), but this requires Stage 2 hourly segmentation (future development).</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Hindsight analysis:</span> This is a backward-looking measurement tool. It tells you what the best TP% WAS for a given day, not what it WILL BE. Predictive TP% selection requires ML (Stage 3+).</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Available in two places:</span> (1) Standalone Optimal TP% Finder page under Stage 1 (fetches its own ticks). (2) "Find Optimal TP%" button on Cycles Analysis page (reuses already-loaded tick data, no extra API calls).</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Why Math.ceil Matters for the Scanner</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>Stocks trade at sub-penny prices on exchanges, but limit orders can only be placed at whole penny increments. Target prices are therefore rounded UP (Math.ceil) to the next tradeable penny. This means multiple TP% values can produce the same dollar target. For example, at $5.68: TP% 0.18%-0.35% all ceil to a $0.02 spread. The scanner uses the actual dollar spread (the real penny difference) for profit calculation, not the theoretical percentage.</p>
          <p style={{paddingLeft:8,fontSize:9}}>The scanner uses the actual dollar spread (not the theoretical percentage) for profit calculation. TP% values producing the same penny target will show identical per-cycle profit. The difference in net profit comes from cycle count differences -- the engine produces slightly different cycle counts even for the same target because individual price levels across the range have different target prices.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Example: NIO 2026-03-27</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>Share price: $5.68 | $/Level: $1 | Fee: $0.005/share</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>Shares per level: $1 / $5.68 = 0.1761</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>Adjusted fee: $0.005 x 0.1761 = $0.0009/cycle</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>Scanner tests 100 TP% values, finds 0.18% produces highest net profit</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>At 0.18%: target = ceil($5.68 x 1.0018 x 100)/100 = $5.70 | spread = $0.02 | gross = 0.1761 x $0.02 = $0.0035/cycle | net = $0.0035 - $0.0009 = $0.0026/cycle</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Fractional shares:</span> At $1/level on a $5.68 stock, you buy 0.1761 shares (fractional). The $0.005/share fee is proportionally scaled: $0.005 x 0.1761 = $0.0009. Profit is calculated on the actual penny spread multiplied by the fractional quantity, not on a theoretical percentage.</p>
        </div>
      </div>
    </CollapseStage>
    <CollapseStage title="Trade-by-Trade Audit" sub="Data integrity verification">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <p style={{marginBottom:10}}>The audit section allows anyone to trace every single trade tick with its exact timestamp and sub-penny price, and see step-by-step how each BUY and SELL was triggered. SELL events show the level, target, and a running cumulative total.</p>
        <p>The full dataset can be exported as CSV for offline verification using any tool. Every cycle count can be traced back to the specific ticks that triggered it.</p>
      </div>
    </CollapseStage>
    <CollapseStage title="Cross-Verification Code" sub="Python script to replicate the analysis">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <p style={{marginBottom:10}}>This Python script replicates the exact logic including the pre-seeded ladder and limit order fill rules. Run it independently to verify cycle counts match.</p>
        <div style={{background:'#0a0e14',border:'1px solid '+C.border,borderRadius:6,padding:'12px',overflowX:'auto',marginBottom:10}}>
          <pre style={{color:'#8ec07c',fontSize:8,fontFamily:F,lineHeight:1.6,margin:0,whiteSpace:'pre-wrap'}}>{PYCODE}</pre>
        </div>
        <p style={{color:C.txtDim,fontSize:9}}>Replace YOUR_POLYGON_API_KEY. Requires: <span style={{color:C.txtBright}}>pip install requests</span></p>
      </div>
    </CollapseStage>
    <CollapseStage title="Data Source: Polygon.io" sub="Trade tick data pipeline">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>What is Polygon.io?</p>
        <p style={{marginBottom:10}}>Polygon.io is a financial data platform that provides real-time and historical market data directly from US stock exchanges. It aggregates trade data from all major exchanges (NYSE, NASDAQ, IEX, ARCA, BATS, etc.) into a single API, giving access to every individual trade execution that occurs throughout the trading day.</p>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Endpoints Used</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:8}}><span style={{color:C.accent,fontWeight:700}}>1. Trades Endpoint</span></p>
          <div style={{background:'#0a0e14',borderRadius:4,padding:'6px 8px',marginBottom:6,overflowX:'auto'}}><pre style={{color:'#8ec07c',fontSize:8,fontFamily:F,margin:0}}>GET /v3/trades/{"{"} TICKER {"}"}</pre></div>
          <p style={{marginBottom:4,fontSize:9}}>Returns every individual trade tick for a given stock on a given day. Each record includes:</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>price</span> - Exact execution price (sub-penny precision)</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>size</span> - Number of shares traded</p>
          <p style={{marginBottom:2,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>sip_timestamp</span> - Nanosecond-precision timestamp from the SIP feed</p>
          <p style={{marginBottom:6,fontSize:9}}>Results are paginated at 50,000 trades per page. The app follows the next_url cursor automatically to fetch the complete dataset (often 50,000 - 500,000+ trades per day depending on the stock).</p>
          <p style={{marginBottom:8}}><span style={{color:C.accent,fontWeight:700}}>2. Daily OHLC Endpoint</span></p>
          <div style={{background:'#0a0e14',borderRadius:4,padding:'6px 8px',marginBottom:6,overflowX:'auto'}}><pre style={{color:'#8ec07c',fontSize:8,fontFamily:F,margin:0}}>GET /v1/open-close/{"{"} TICKER {"}"}/{"{"} DATE {"}"}</pre></div>
          <p style={{fontSize:9}}>Returns the official daily Open, High, Low, Close prices and total volume for the regular trading session. Used for the Market Data summary card.</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>How Data is Fetched</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>1.</span> User selects ticker, date, and session (All Hours or Regular Only).</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>2.</span> App sends request to Polygon trades endpoint with timestamp filters (4:00 AM - 8:00 PM ET for All Hours).</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>3.</span> Polygon returns up to 50,000 trades per page, sorted by timestamp ascending.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>4.</span> App automatically follows pagination (next_url) until all trades are fetched. No limit on total trades.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>5.</span> If Regular Only is selected, pre/post market trades are filtered out (only 9:30 AM - 4:00 PM ET kept).</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>6.</span> OHLC data is fetched separately in a single request for the Market Data card.</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Data Storage</p>
        <p style={{marginBottom:10}}>All trade data is held in browser memory only for the duration of the analysis session. No trade data is stored on any server, database, or persistent storage. When you close or refresh the page, all data is cleared. Each analysis run fetches fresh data directly from Polygon.io.</p>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>API Key</p>
        <p>A Polygon.io API key is required to access trade data. The key is stored in the app settings and sent directly from your browser to Polygon.io. It is never transmitted to or stored on any third-party server. Free-tier Polygon keys provide access to historical trade data with rate limits; paid tiers offer higher throughput and real-time data.</p>
      </div>
    </CollapseStage>
    <CollapseStage title="Important: Market-Wide Data vs Execution Reality" sub="Understanding cycle count limitations">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>What the cycle counts represent</p>
        <p style={{marginBottom:10}}>The trade tick data used in this analysis represents the consolidated tape of all trades executed across all US stock exchanges combined. This includes NYSE, NASDAQ, IEX, ARCA, BATS, EDGX, and all other participating venues. Every cycle count in this application is derived from this complete, market-wide price action.</p>
        <p style={{marginBottom:10}}>This means the cycle counts reflect the theoretical maximum number of oscillation cycles that occurred across the entire market for a given stock on a given day at a given take-profit percentage.</p>
        <p style={{marginBottom:10,color:C.warn,fontWeight:700}}>What the cycle counts do NOT represent</p>
        <p style={{marginBottom:10}}>The cycle counts do not account for the practical realities of live order execution. In real trading, several factors affect whether a cycle can actually be captured:</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:8}}><span style={{color:C.gold,fontWeight:700}}>1. Order Queue Position</span></p>
          <p style={{marginBottom:10,fontSize:9}}>Limit orders on an exchange are filled in price-time priority (FIFO). Your order joins a queue behind all orders placed at the same price before you. If a level only trades a small number of shares at your price before reversing, your order may not get filled even though a trade occurred at that price. The cycle counts assume every trade at a level results in a fill, which would only be true if your orders were consistently at the front of the queue.</p>
          <p style={{marginBottom:8}}><span style={{color:C.gold,fontWeight:700}}>2. Exchange Selection</span></p>
          <p style={{marginBottom:10,fontSize:9}}>A trade tick at $5.67 may have occurred on NASDAQ while your limit order sits on NYSE. Your order would not fill from that trade. The consolidated tape shows all trades from all exchanges, but a single participant can only have orders on a limited number of venues at any given time. Smart order routing and multi-venue strategies mitigate this but do not eliminate it.</p>
          <p style={{marginBottom:8}}><span style={{color:C.gold,fontWeight:700}}>3. Latency and Speed</span></p>
          <p style={{marginBottom:10,fontSize:9}}>After a sell completes, the algorithm needs to place a new buy order (re-entry). In live trading, there is a delay between recognizing the fill and placing the next order. During this latency window, price may move away from the re-entry level. The analysis assumes instantaneous re-entry, which is not achievable in practice.</p>
          <p style={{marginBottom:8}}><span style={{color:C.gold,fontWeight:700}}>4. Market Impact</span></p>
          <p style={{fontSize:9}}>Placing and filling orders affects the market. Your own orders consume liquidity at a price level, potentially changing the very price action the analysis is based on. The cycle counts are derived from historical data where your orders were not present. Actual results with live capital would alter the order book dynamics.</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>How to interpret the results</p>
        <p style={{marginBottom:10}}>The cycle counts should be viewed as a theoretical upper bound representing the total oscillation activity at each price level across all market participants and exchanges. They are a measure of market behavior and price oscillation frequency, not a guarantee of achievable returns.</p>
        <p>In practice, the number of cycles a single participant could capture would be a fraction of the total, depending on execution infrastructure, order routing strategy, queue position management, and the capital deployed at each level. The analysis is most valuable as a comparative tool: identifying which price levels, take-profit percentages, and market conditions produce the highest oscillation activity.</p>
      </div>
    </CollapseStage>
    <CollapseStage title="Manual Verification: CSV Upload" sub="Independent logic verification tool">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Purpose</p>
        <p style={{marginBottom:10}}>The CSV Upload feature exists to provide a simple, hands-on way for anyone to independently verify that the cycle counting logic is mathematically correct. Rather than trusting the application on faith, you can create your own small dataset, count the cycles manually on paper, and then upload it to confirm the app produces the exact same result.</p>
        <p style={{marginBottom:10}}>This is particularly important because the entire Edge Detection System being built in later stages depends on the accuracy of the cycle counting engine. If there is even a single logical error in how cycles are counted, every analysis, optimization, and strategy derived from those counts would be flawed. The CSV upload tool gives you the power to prove the logic is correct before relying on it at scale.</p>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>How It Works</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6}}><span style={{color:C.accent,fontWeight:700}}>Step 1: Create your test data.</span> Open any spreadsheet or text editor and create a simple CSV file with a column of prices. This can be as few as 10-20 rows. For example:</p>
          <div style={{background:'#0a0e14',borderRadius:4,padding:'6px 8px',marginBottom:6,overflowX:'auto'}}><pre style={{color:'#8ec07c',fontSize:8,fontFamily:F,margin:0}}>{"price\n5.00\n5.03\n5.06\n5.02\n5.00\n5.04\n5.07\n5.01\n5.00\n5.05"}</pre></div>
          <p style={{marginBottom:6}}><span style={{color:C.accent,fontWeight:700}}>Step 2: Count cycles manually.</span> Walk through your prices row by row using the same rules: first row is the opening tick (no orders). Levels from open to +1% are pre-seeded. Track which levels are active, when sells trigger (tick {'>='} target), and when re-buys happen (tick within level range). Count the cycles by hand.</p>
          <p style={{marginBottom:6}}><span style={{color:C.accent,fontWeight:700}}>Step 3: Upload to the app.</span> Go to Verify Logic Data Upload in the menu, upload your CSV file, set the same take-profit %, and tap Analyze.</p>
          <p><span style={{color:C.accent,fontWeight:700}}>Step 4: Compare.</span> The app shows a complete step-by-step audit of every row from your file, showing exactly which BUY and SELL events triggered and why. Compare this line-by-line against your manual count. The total cycles should match exactly.</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>What It Accepts</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Format:</span> CSV (comma-separated values) or plain text</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Minimum rows:</span> 2 (but 10-20 recommended for meaningful testing)</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Header row:</span> Optional, auto-detected</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent}}>Price column:</span> First numeric column is used as the price</p>
          <p><span style={{color:C.accent}}>Dollar signs:</span> Automatically stripped ($5.00 and 5.00 both work)</p>
        </div>
        <p style={{marginBottom:10,color:C.txtBright,fontWeight:700}}>Why This Matters for Edge Detection</p>
        <p>The Edge Detection System will process millions of trade ticks across multiple stocks and time periods. Before scaling to that level, the core logic must be provably correct at the smallest scale. If the algorithm correctly counts cycles on a 15-row dataset that you can verify by hand, you can be confident it will correctly count cycles on a 2-million-row dataset from a live exchange. This bottom-up verification approach ensures the quantitative foundation of the entire system is sound.</p>
      </div>
    </CollapseStage>
  </div>;
}

function Splash(p){
  var s=useState(0),opacity=s[0],setOpacity=s[1];
  var ps=useState(''),pw=ps[0],setPw=ps[1];
  var es=useState(false),pwError=es[0],setPwError=es[1];
  var ls=useState(false),unlocked=ls[0],setUnlocked=ls[1];
  useEffect(function(){setTimeout(function(){setOpacity(1);},100);},[]);
  useEffect(function(){if(unlocked)setTimeout(function(){p.onDone();},1200);},[unlocked]);
  var submit=function(){if(pw==='BT'){setPwError(false);setUnlocked(true);}else{setPwError(true);}};
  return <div style={{background:C.bg,minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:F,transition:'opacity 0.8s',opacity:opacity,padding:20}}>
    <div style={{color:C.txtBright,fontSize:20,fontWeight:800,letterSpacing:3,textTransform:'uppercase',marginBottom:8}}>Alpha Quant Analytics</div>
    <div style={{color:C.accent,fontSize:13,fontWeight:600,letterSpacing:2,marginBottom:24}}>Beta Growth Holdings</div>
    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:28}}>
      <div style={{width:6,height:6,borderRadius:'50%',background:C.accent,boxShadow:'0 0 8px '+C.accent,animation:'pulse 1.2s infinite'}}></div>
      <div style={{color:C.txt,fontSize:11,letterSpacing:2,textTransform:'uppercase'}}>Edge Detection</div>
    </div>
    {!unlocked&&<div style={{width:'100%',maxWidth:260}}>
      <input type="password" value={pw} onChange={function(e){setPw(e.target.value);setPwError(false);}} onKeyDown={function(e){if(e.key==='Enter')submit();}} placeholder="Enter access code" style={Object.assign({},iS,{textAlign:'center',marginBottom:10,fontSize:12,letterSpacing:2})}/>
      <button onClick={submit} style={Object.assign({},bB,{background:'linear-gradient(135deg,#00e5a0,#00c488)',color:C.bg})}>Enter</button>
      {pwError&&<div style={{color:C.warn,fontSize:10,textAlign:'center',marginTop:8}}>Invalid access code</div>}
    </div>}
    {unlocked&&<div style={{color:C.accent,fontSize:10,marginTop:10,animation:'pulse 1s infinite'}}>Initializing...</div>}
    <div style={{marginTop:20,color:'#ffffff',fontSize:8,fontFamily:F,letterSpacing:0.5,textAlign:'center',opacity:0.9}}>{typeof BUILD_TS!=='undefined'?BUILD_TS:'dev'}</div>
  </div>;
}

function PriceLevelTable(p){
  var ls=useState(true),showActive=ls[0],setShowActive=ls[1];
  var s=p.summary;
  var data=showActive?p.levels.filter(function(l){return l.cycles>0;}):p.levels;
  return <Cd>
    <SectionHead title="Price Level Cycles" sub={"Each $0.01 level @ "+s.tpPct+"% take profit"} info="Every $0.01 price point the stock touched becomes an independent trading unit. It buys at that price and sells when price rises by your TP%. After selling, it waits for price to return to buy again. 'Active' = completed at least one cycle."/>
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:10,marginBottom:12}}>
      <Mt label="Total Cycles" value={s.totalCycles} color={C.accent} size="lg"/>
      <Mt label="Active Levels" value={s.activeLevels} color={C.blue} size="md"/>
      <Mt label="All Levels" value={s.totalLevels} color={C.txtDim} size="md"/>
    </div>
    <div style={{display:'flex',gap:4,marginBottom:8}}>
      <button onClick={function(){setShowActive(true);}} style={Object.assign({},bB,{flex:1,padding:'6px 4px',fontSize:8,background:showActive?C.accentDim:'transparent',border:'1px solid '+(showActive?C.accent:C.border),color:showActive?C.accent:C.txt})}>Active Only</button>
      <button onClick={function(){setShowActive(false);}} style={Object.assign({},bB,{flex:1,padding:'6px 4px',fontSize:8,background:!showActive?C.accentDim:'transparent',border:'1px solid '+(!showActive?C.accent:C.border),color:!showActive?C.accent:C.txt})}>All Levels</button>
    </div>
    <div style={{overflowX:'auto',maxHeight:400}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:9,fontFamily:F}}>
        <thead><tr style={{borderBottom:'1px solid '+C.border}}>
          {['Level','Target','Cycles'].map(function(h){return <th key={h} style={{padding:'5px 4px',color:C.txtDim,textAlign:'right',fontWeight:600}}>{h}</th>;})}
        </tr></thead>
        <tbody>{data.slice(0,500).map(function(l){return <tr key={l.price} style={{borderBottom:'1px solid '+C.grid}}>
          <td style={{padding:'5px 4px',textAlign:'right',color:C.txtBright,fontWeight:700}}>{'$'+l.price.toFixed(2)}</td>
          <td style={{padding:'5px 4px',textAlign:'right',color:C.txt}}>{'$'+l.target.toFixed(2)}</td>
          <td style={{padding:'5px 4px',textAlign:'right',color:l.cycles>0?C.accent:C.txtDim,fontWeight:l.cycles>0?700:400}}>{l.cycles}</td>
        </tr>;})}</tbody>
      </table>
    </div>
  </Cd>;
}

function TradeAudit(p){
  var cs=useState('1000'),countStr=cs[0],setCountStr=cs[1];
  var es=useState(false),expanded=es[0],setExpanded=es[1];
  var showCount=Math.min(parseInt(countStr)||1000,p.trades.length);
  var trades=p.trades.slice(0,showCount);
  var tf=p.tpPct/100;
  if(!trades.length)return null;
  // Compute min/max from full dataset
  var minP=Infinity,maxP=-Infinity;
  for(var z=0;z<p.trades.length;z++){if(p.trades[z].price<minP)minP=p.trades[z].price;if(p.trades[z].price>maxP)maxP=p.trades[z].price;}
  var minLvl=Math.floor(minP*100)/100,maxLvl=Math.ceil(maxP*100)/100;
  var openLvl=Math.floor(trades[0].price*100)/100;
  var preSeedMax=Math.round(openLvl*1.01*100)/100;
  var levels={};
  for(var lp=minLvl;lp<=maxLvl+0.001;lp=Math.round((lp+0.01)*100)/100){var key=lp.toFixed(2);var preS=(lp>=openLvl&&lp<=preSeedMax);levels[key]={price:lp,target:Math.ceil(lp*(1+tf)*100)/100,active:preS,cycles:0};}
  var events=[];var runningCycles=0;
  for(var i=0;i<trades.length;i++){
    var price=trades[i].price;var time=formatTS(trades[i].ts);var evList=[];
    if(i===0){evList.push({type:'tick',text:'OPENING TICK $'+price.toFixed(4)+' — Pre-seeded levels $'+openLvl.toFixed(2)+' to $'+preSeedMax.toFixed(2)});}else{
    var allKeys=Object.keys(levels);
    // SELL first
    for(var j=0;j<allKeys.length;j++){var lv=levels[allKeys[j]];if(lv.active&&price>=lv.target){lv.cycles++;lv.active=false;runningCycles++;evList.push({type:'sell',text:'SELL $'+allKeys[j]+' → $'+lv.target.toFixed(2)+' (cycle #'+lv.cycles+', total:'+runningCycles+')'});}}
    // BUY second
    for(var j=0;j<allKeys.length;j++){var lv=levels[allKeys[j]];if(!lv.active&&price>=lv.price&&price<lv.price+0.01){lv.active=true;evList.push({type:'rebuy',text:'BUY $'+allKeys[j]+' (target $'+lv.target.toFixed(2)+')'});}}}
    if(evList.length===0)evList.push({type:'tick',text:'-'});
    for(var e=0;e<evList.length;e++){events.push({idx:i+1,time:time,price:price,event:evList[e].text,type:evList[e].type,showIdx:e===0});}
  }
  return <Cd>
    <div onClick={function(){setExpanded(!expanded);}} style={{display:'flex',alignItems:'center',cursor:'pointer'}}>
      <div style={{flex:1}}><SectionHead title="Trade-by-Trade Audit" sub={"Limit order fill rules @ "+p.tpPct+"% TP"} info="Replays every trade tick from the exchange showing exactly when buys and sells trigger. SELL (gold) = target hit, cycle complete. RE-BUY (blue) = price returned, new cycle starts. Sub-penny prices compared directly — no rounding."/></div>
      <div style={{color:C.accent,fontSize:22,fontWeight:300,lineHeight:1,transition:'transform 0.2s',transform:expanded?'rotate(45deg)':'none',flexShrink:0,marginLeft:8}}>+</div>
    </div>
    {!expanded&&<div style={{color:C.txtDim,fontSize:9,fontFamily:F,marginTop:6}}>Tap to expand trade-level event log</div>}
    {expanded&&<div style={{marginTop:10}}>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.7,marginBottom:12,padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
        This audit replays every trade tick sequentially using limit order fill rules. The first tick establishes the opening price. Levels from the open up to +1% above are pre-seeded as bought (staggered ladder). From the second tick onwards, the engine checks: (1) any active level where tick price >= sell target triggers a SELL and completes a cycle, (2) any inactive level where tick is within its $0.01 range triggers a BUY entry and completes a cycle. Sub-penny prices are compared directly — $2.2399 does not fill a buy at $2.23 because $2.2399 &gt; $2.23.
      </div>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
        <label style={Object.assign({},lS,{marginBottom:0})}>Show Trades</label>
        <input type="text" inputMode="numeric" value={countStr} onChange={function(e){setCountStr(e.target.value);}} style={Object.assign({},iS,{width:80,padding:'6px 8px',fontSize:11})}/>
        <span style={{color:C.txtDim,fontSize:9,fontFamily:F}}>of {p.trades.length.toLocaleString()}</span>
        <button onClick={function(){
          var allT=p.trades;var tf2=p.tpPct/100;
          var mn2=Infinity,mx2=-Infinity;for(var q=0;q<allT.length;q++){if(allT[q].price<mn2)mn2=allT[q].price;if(allT[q].price>mx2)mx2=allT[q].price;}
          var ml=Math.floor(mn2*100)/100,xl=Math.ceil(mx2*100)/100;
          var elvls={};for(var lp2=ml;lp2<=xl+0.001;lp2=Math.round((lp2+0.01)*100)/100){var ek=lp2.toFixed(2);var eOpenLvl=Math.floor(allT[0].price*100)/100;var ePreMax=Math.round(eOpenLvl*1.01*100)/100;
          elvls[ek]={price:lp2,target:Math.ceil(lp2*(1+tf2)*100)/100,active:(lp2>=eOpenLvl&&lp2<=ePreMax),cycles:0};}
          var csv='Trade#,Time_ET,Tick_Price,Event\n';var eKeys=Object.keys(elvls);var rc=0;
          for(var x=0;x<allT.length;x++){
            var ep=allT[x].price;var et=formatTS(allT[x].ts);var evts=[];
            if(x===0){evts.push('OPENING TICK');}else{
            for(var ej=0;ej<eKeys.length;ej++){var elv=elvls[eKeys[ej]];if(elv.active&&ep>=elv.target){elv.cycles++;elv.active=false;rc++;evts.push('SELL $'+eKeys[ej]+' -> $'+elv.target.toFixed(2)+' (cycle #'+elv.cycles+'; total:'+rc+')');}}
            for(var ej=0;ej<eKeys.length;ej++){var elv=elvls[eKeys[ej]];if(!elv.active&&ep>=elv.price&&ep<elv.price+0.01){elv.active=true;evts.push('BUY $'+eKeys[ej]+' -> target $'+elv.target.toFixed(2));}}
            }
            var evStr=evts.length?evts.join(' | '):'-';
            csv+=(x+1)+','+et+',$'+ep.toFixed(4)+','+evStr.replace(/,/g,';')+'\n';
          }
          var blob=new Blob([csv],{type:'text/csv'});var u=URL.createObjectURL(blob);var a=document.createElement('a');a.href=u;a.download='trade_audit_full.csv';a.click();URL.revokeObjectURL(u);
        }} style={Object.assign({},bB,{width:'auto',padding:'5px 10px',fontSize:7,background:'transparent',border:'1px solid '+C.border,color:C.txtDim,flexShrink:0})}>Export CSV</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
        <Mt label="Tick Min" value={'$'+minP.toFixed(4)} color={C.warn} size="md"/>
        <Mt label="Tick Max" value={'$'+maxP.toFixed(4)} color={C.accent} size="md"/>
        <Mt label="Tick Range" value={'$'+(maxP-minP).toFixed(4)} color={C.gold} size="md"/>
      </div>
      <div style={{display:'flex',gap:12,marginBottom:10,fontSize:8,fontFamily:F}}>
        <span><span style={{color:C.gold}}>■</span> SELL = cycle complete</span>
        <span><span style={{color:C.blue}}>■</span> RE-BUY = new entry</span>
        <span><span style={{color:C.txtDim}}>■</span> No action</span>
      </div>
      <div style={{overflowX:'auto',maxHeight:600}}>
        <table style={{width:'100%',borderCollapse:'collapse',fontSize:8,fontFamily:F}}>
          <thead><tr style={{borderBottom:'1px solid '+C.border}}>
            <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'left',fontWeight:600}}>#</th>
            <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'left',fontWeight:600}}>Time (ET)</th>
            <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'right',fontWeight:600}}>Tick Price</th>
            <th style={{padding:'4px 3px',color:C.txtDim,textAlign:'left',fontWeight:600}}>Event</th>
          </tr></thead>
          <tbody>{events.map(function(ev,ri){
            var rowColor=ev.type==='sell'?C.gold:ev.type==='rebuy'?C.blue:C.txtDim;
            return <tr key={ri} style={{borderBottom:ev.showIdx?'1px solid '+C.grid:'none',background:ev.type==='sell'?'#ffb02008':'transparent'}}>
              <td style={{padding:'3px',color:C.txtDim,fontSize:7}}>{ev.showIdx?ev.idx:''}</td>
              <td style={{padding:'3px',color:C.txt,whiteSpace:'nowrap',fontSize:7}}>{ev.showIdx?ev.time:''}</td>
              <td style={{padding:'3px',color:C.txtBright,fontWeight:700,textAlign:'right',whiteSpace:'nowrap'}}>{ev.showIdx?'$'+ev.price.toFixed(4):''}</td>
              <td style={{padding:'3px',color:rowColor,fontSize:7,lineHeight:1.4}}>{ev.event}</td>
            </tr>;})}
          </tbody>
        </table>
      </div>
    </div>}
  </Cd>;
}

function OptimalTPPage(p){
  var s1=useState('SOXL'),ticker=s1[0],setTicker=s1[1];
  var s2=useState(''),date=s2[0],setDate=s2[1];
  var s3=useState('1'),cap=s3[0],setCap=s3[1];
  var s4=useState('0.005'),fee=s4[0],setFee=s4[1];
  var s5=useState(false),loading=s5[0],setLoading=s5[1];
  var s6=useState(null),results=s6[0],setResults=s6[1];
  var s7=useState(null),err=s7[0],setErr=s7[1];
  var s8=useState(''),prog=s8[0],setProg=s8[1];
  var lS={color:C.txtDim,fontSize:8,fontWeight:600,letterSpacing:1,textTransform:'uppercase',fontFamily:F,marginBottom:4,display:'block'};
  var iS={width:'100%',background:C.bgInput,border:'1px solid '+C.border,borderRadius:6,color:C.txtBright,fontFamily:F,fontSize:12,fontWeight:600,padding:'10px 12px',outline:'none'};

  var run=async function(){
    if(!p.apiKey){setErr('No Polygon API key set');return;}
    if(!date){setErr('Select a date');return;}
    setLoading(true);setErr(null);setResults(null);setProg('Fetching trades...');
    try{
      var allTrades=[],url='https://api.polygon.io/v3/trades/'+ticker.toUpperCase()+'?timestamp.gte='+date+'T04:00:00.000Z&timestamp.lt='+date+'T23:59:59.000Z&limit=50000&sort=timestamp&order=asc&apiKey='+p.apiKey;
      var pages=0;
      while(url){var r=await fetch(url);if(!r.ok)throw new Error('Polygon API error '+r.status);var d=await r.json();if(d.results)for(var i=0;i<d.results.length;i++){var t=d.results[i];allTrades.push({price:t.price,size:t.size,ts:t.sip_timestamp||t.participant_timestamp});}url=d.next_url?(d.next_url+'&apiKey='+p.apiKey):null;pages++;setProg('Fetching... '+allTrades.length.toLocaleString()+' trades (page '+pages+')');}
      if(!allTrades.length){setErr('No trades found for '+ticker+' on '+date);setLoading(false);return;}
      setProg('Scanning all viable TP% values across '+allTrades.length.toLocaleString()+' trades...');
      await new Promise(function(r){setTimeout(r,50);});
      var capVal=parseFloat(cap)||1;var feeVal=parseFloat(fee)||0.005;
      var res=scanOptimalTP(allTrades,capVal,feeVal);
      setResults({scan:res,ticker:ticker.toUpperCase(),date:date,trades:allTrades.length,sharePrice:allTrades[0].price,cap:capVal,fee:feeVal});
      setProg('');setLoading(false);
    }catch(e){setErr(e.message);setProg('');setLoading(false);}
  };

  var bB={width:'100%',padding:'12px',border:'none',borderRadius:8,fontFamily:F,fontSize:11,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',cursor:'pointer'};

  return <div>
    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Optimal TP% Finder</div>
    </div>
    <Cd>
      <SectionHead title="TP% Scanner" sub="Find the most profitable take-profit percentage" info="Scans up to 100 TP% values from 0.01% to 1.00%. Each value runs the full cycle engine against every tick for the selected day. Profit uses actual dollar spread with Math.ceil rounding. Ranked by net profit after fractional fees. This is a per-day analysis -- not hourly. Requires fetching raw tick data from Polygon."/>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:10}}>
        <div><label style={lS}>Ticker</label><input value={ticker} onChange={function(e){setTicker(e.target.value.toUpperCase());}} style={iS}/></div>
        <div><label style={lS}>Date</label><input type="date" value={date} onChange={function(e){setDate(e.target.value);}} style={iS}/></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8,marginBottom:12}}>
        <div><label style={lS}>$/Level</label><input type="text" inputMode="decimal" value={cap} onChange={function(e){setCap(e.target.value);}} style={iS}/></div>
        <div><label style={lS}>Fee/Share</label><input type="text" inputMode="decimal" value={fee} onChange={function(e){setFee(e.target.value);}} style={iS}/></div>
      </div>
      <button onClick={run} disabled={loading} style={Object.assign({},bB,{background:loading?C.border:'linear-gradient(135deg,#ffb020,#ff8800)',color:loading?C.txtDim:C.bg})}>{loading?'Scanning...':'Scan All TP% Values'}</button>
      {prog&&<div style={{marginTop:8,color:C.gold,fontSize:10}}>{prog}</div>}
      {err&&<div style={{marginTop:8,padding:'8px 10px',background:C.warnDim,border:'1px solid #ff5c3a30',borderRadius:6,color:C.warn,fontSize:10}}>{err}</div>}
    </Cd>
    {results&&<div>
      <Cd glow={true}>
        <div style={{display:'inline-block',background:C.goldDim,border:'1px solid '+C.gold,borderRadius:4,padding:'2px 8px',fontSize:7,color:C.gold,fontFamily:F,fontWeight:700,marginBottom:8,letterSpacing:0.5}}>OPTIMAL TP% | {results.ticker} | {results.date} | ${results.cap}/LEVEL</div>
        <SectionHead title={'Best: '+results.scan.results[0].tpPct.toFixed(2)+'% TP'} sub={results.trades.toLocaleString()+' trades | '+results.scan.scanned+' TP% values (min: '+results.scan.minTpPct.toFixed(2)+'%)'}/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:10}}>
          <Mt label="Best TP%" value={results.scan.results[0].tpPct.toFixed(2)+'%'} color={C.gold} size="lg"/>
          <Mt label="Net Profit" value={'$'+results.scan.results[0].netTotal.toFixed(2)} color={C.accent} size="lg"/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:6}}>
          <Mt label="Cycles" value={results.scan.results[0].cycles} color={C.accent} size="md"/>
          <Mt label="Net/Cycle" value={'$'+results.scan.results[0].netPC.toFixed(4)} color={C.accent} size="md"/>
          <Mt label="Net ROI" value={results.scan.results[0].roi.toFixed(2)+'%'} color={C.accent} size="md"/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:6}}>
          <Mt label="Share Price" value={'$'+results.sharePrice.toFixed(2)} color={C.txt} size="md"/>
          <Mt label="Shares/Level" value={(results.cap/results.sharePrice).toFixed(4)} color={C.txt} size="md"/>
          <Mt label="Adj Fee" value={'$'+results.scan.results[0].adjFee.toFixed(4)} color={C.warn} size="md"/>
        </div>
      </Cd>
      <Cd>
        <SectionHead title="All Results" sub={results.scan.scanned+' TP% values ranked by net profit'}
/>
        <div style={{maxHeight:400,overflowY:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:8,fontFamily:F}}>
            <thead><tr style={{position:'sticky',top:0,background:C.bgCard}}>
              <th style={{padding:'4px 2px',color:'#a0b4c8',textAlign:'left'}}>#</th>
              <th style={{padding:'4px 2px',color:'#a0b4c8',textAlign:'right'}}>TP%</th>
              <th style={{padding:'4px 2px',color:'#a0b4c8',textAlign:'right'}}>TP $</th>
              <th style={{padding:'4px 2px',color:'#a0b4c8',textAlign:'right'}}>Cycles</th>
              <th style={{padding:'4px 2px',color:'#a0b4c8',textAlign:'right'}}>Net $</th>
              <th style={{padding:'4px 2px',color:'#a0b4c8',textAlign:'right'}}>ROI</th>
            </tr></thead>
            <tbody>{results.scan.results.map(function(r,idx){
              var isBest=idx===0;var isTop5=idx<5;
              return <tr key={r.tpPct} style={{borderBottom:'1px solid '+C.grid,background:isBest?'rgba(255,176,32,0.1)':isTop5?'rgba(0,229,160,0.03)':'transparent'}}>
                <td style={{padding:'5px 2px',color:isBest?C.gold:C.txtDim}}>{idx+1}</td>
                <td style={{padding:'5px 2px',color:isBest?C.gold:isTop5?C.accent:C.txt,textAlign:'right',fontWeight:isBest?700:400}}>{r.tpPct.toFixed(2)}%</td>
                <td style={{padding:'5px 2px',color:C.gold,textAlign:'right'}}>{'$'+r.tpDollar.toFixed(2)}</td>
                <td style={{padding:'5px 2px',color:C.txt,textAlign:'right'}}>{r.cycles}</td>
                <td style={{padding:'5px 2px',color:r.netTotal>0?C.accent:C.warn,textAlign:'right',fontWeight:isTop5?700:400}}>{'$'+r.netTotal.toFixed(2)}</td>
                <td style={{padding:'5px 2px',color:r.roi>0?C.accent:C.warn,textAlign:'right'}}>{r.roi.toFixed(1)}%</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
      </Cd>
    </div>}
  </div>;
}

function AdaptiveOptPage(p){
  var lS={color:C.txtDim,fontSize:8,fontWeight:600,letterSpacing:1,textTransform:'uppercase',fontFamily:F,marginBottom:4,display:'block'};
  return <div>
    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Adaptive Optimization Logic</div>
    </div>

    <Cd glow={true}>
      <SectionHead title="Stage 2: Adaptive TP% Optimization" sub="Finding the optimal take-profit for every hour of every day" info="Stage 2 extends Stage 1's per-day TP% scanning into hourly segmentation. Instead of finding one best TP% for the whole day, we find the best TP% for each hour, then aggregate across multiple days to discover consistent intraday patterns."/>
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <p style={{marginBottom:10}}>Stage 1 built the measurement engine (cycle counting) and the per-day Optimal TP% Finder. Stage 2 takes this further by asking: does the optimal TP% change throughout the day? If 8AM consistently favors 0.18% but 12PM favors 0.35%, we can adapt the algorithm in real-time to use different TP% settings at different hours.</p>
        <p style={{marginBottom:10,color:C.gold,fontWeight:700}}>The core hypothesis: volatility changes throughout the trading day, and the optimal take-profit percentage should change with it.</p>
      </div>
    </Cd>

    <CollapseStage title="Full-Day Engine, Hourly Attribution" sub="How we measure optimal TP% per hour">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <p style={{marginBottom:10}}>We keep the cycle engine running against the full day of tick data (exactly as Stage 1 does), but when a cycle completes, we attribute it to both the TP% value AND the hour the SELL fired in. This preserves the algorithm's actual continuous behavior -- levels don't reset every hour.</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>How It Works</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>1. Fetch all tick data for ticker and date from Polygon (same as Stage 1)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>2. Loop through 100 TP% values (0.01% to 1.00% in 0.01% steps)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>3. For each TP%, run the full analyzePriceLevels() engine against ALL ticks for the entire day</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>4. Track which hour each SELL fires in (same as computeHourlyCycles but for all 100 TP% values)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>5. Build a matrix: 100 TP% values x 16 hours, each cell = cycle count and net profit</p>
          <p style={{paddingLeft:8,fontSize:9}}>6. For each hour, find which TP% produced the highest net profit</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Why Full-Day Engine (Not Hourly Slices)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Continuous levels:</span> The live bot maintains positions across hours. A level bought at 9:45 AM can sell at 10:15 AM. If we sliced ticks into independent hourly buckets, we'd miss cross-hour cycles entirely.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Pre-seed integrity:</span> The algorithm pre-seeds levels from open+1% at the start of the day. Resetting this each hour would create artificial starting conditions that don't match real execution.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Attribution accuracy:</span> By running the full day and attributing each completed cycle to the hour its SELL fired in, we get an accurate picture of which hours generate the most profit for each TP% -- exactly as the live bot would experience it.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Output: The Hourly TP% Matrix</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>For a single day, the scanner produces a 100 x 16 matrix. Each cell contains:</p>
          <p style={{marginBottom:4,paddingLeft:16,fontSize:9}}>- Cycle count for that TP% in that hour</p>
          <p style={{marginBottom:4,paddingLeft:16,fontSize:9}}>- Net profit (actual dollar spread x fractional shares - adjusted fee)</p>
          <p style={{marginBottom:4,paddingLeft:16,fontSize:9}}>- The dollar spread (TP$) for that TP% at the opening price</p>
          <p style={{paddingLeft:8,fontSize:9}}>The winning TP% for each hour is highlighted. This may differ significantly from hour to hour -- volatile opening hours may favor smaller TP% (more frequent small cycles), while quiet midday hours may favor larger TP% (fewer but more profitable cycles).</p>
        </div>
      </div>
    </CollapseStage>

    <CollapseStage title="Multi-Day Aggregation" sub="Finding consistent hourly patterns across many days">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <p style={{marginBottom:10}}>A single day's optimal TP% per hour is just one data point. Market conditions vary daily. Multi-day aggregation takes the hourly TP% matrix across 20+ trading days to find which TP% settings are consistently best for each hour.</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Aggregation Process</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>1. Run the full-day hourly TP% scan for each cached trading day (e.g. 20 days of NIO data)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>2. For each hour (4AM-7PM), collect the optimal TP% from each day</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>3. Compute: most frequent winner (mode), average net profit per TP%, consistency score</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>4. Build a profile: "8AM-9AM: 0.18% TP wins 14 out of 20 days, avg net $0.85"</p>
          <p style={{paddingLeft:8,fontSize:9}}>5. Identify hours with high consistency (strong signal) vs hours with high variance (unpredictable)</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Expected Patterns</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Market open (9:30-10:30 AM):</span> High volatility, rapid oscillations. Smaller TP% likely optimal -- many quick cycles before price moves away.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Midday (11AM-1PM):</span> Lower volatility, range-bound. Optimal TP% may be similar or slightly larger -- fewer opportunities but steadier.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Power hour (3-4PM):</span> Volatility picks up. Pattern may resemble morning but with different characteristics.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Pre/post market (4-9:30AM, 4-8PM):</span> Low volume, wide spreads. Optimal TP% may be very different or non-viable.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Visualization: The Optimal TP% Heatmap</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>Rows = trading days, Columns = hours (4AM-7PM)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>Each cell shows the optimal TP% for that hour on that day (color-coded by value)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>AVG row shows the average optimal TP% per hour across all days</p>
          <p style={{paddingLeft:8,fontSize:9}}>MODE row shows the most frequent winner per hour -- this becomes the recommended TP% schedule</p>
        </div>
      </div>
    </CollapseStage>

    <CollapseStage title="Infrastructure Requirements" sub="Compute, storage, and data pipeline">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Compute</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Per-day scan:</span> 100 TP% values x full engine run. For NIO (~58K ticks, ~46 levels): ~267M comparisons per day. Browser completes in 3-8 seconds.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>For SOXL (~254K ticks, ~192 levels):</span> ~4.9B comparisons per day. Browser completes in 15-30 seconds.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Multi-day batch (20 days):</span> 20 x per-day scan = 60-160 seconds for NIO, 5-10 minutes for SOXL. Browser tab must stay open.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Cloudflare Worker (ACTIVE)</span> hourly-tp-scanner processes lighter stocks server-side (100 TP% x 16 hours). CPU limit 300s. For heavy stocks (SOXL 254K+ trades), browser Web Worker runs computation in background thread. serverFailed flag skips server after first failure.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Database: New Table</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:'#8ec07c'}}>Table: optimal_tp_hourly</span></p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>One row per ticker/date/hour/tp_pct. Stores cycle count and net profit for that combination.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>UNIQUE(ticker, trade_date, hour, tp_pct, session_type)</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>Columns: ticker, trade_date, hour, tp_pct, session_type, cycles, net_profit, tp_dollar</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Data volume:</span> 100 TP% x 16 hours x 1 day = 1,600 rows per stock-day</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>For 20 days x 5 stocks:</span> 160,000 rows. Well within Supabase free tier (500MB).</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Data Pipeline</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>1. <span style={{color:C.accent}}>Import Stock Data</span> (Stage 1) -- fetch ticks, save basic cycle analysis + seasonality</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>2. <span style={{color:C.accent}}>Hourly TP% Scanner</span> (Stage 2) -- re-fetch ticks for each day, run 100 TP% scans, save hourly matrix to optimal_tp_hourly table</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}>3. <span style={{color:C.accent}}>Trend Aggregation</span> (Stage 2) -- query cached hourly TP% data across date range, compute averages and mode</p>
          <p style={{paddingLeft:8,fontSize:9}}>4. <span style={{color:C.accent}}>TP% Schedule</span> (Stage 2 output) -- recommended TP% for each hour based on historical consistency</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Relationship to Existing Pages</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Cycles Analysis:</span> Stays as-is. Single-day, single-TP% analysis with the "Find Optimal TP%" button (per-day, not hourly).</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Optimal TP% Finder:</span> Stays as-is. Per-day scanner. Stage 2 extends this concept to per-hour granularity.</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Trend Analysis:</span> Will gain new views for hourly TP% heatmaps and consistency scores once Stage 2 data is cached.</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>New Stage 2 pages:</span> Hourly TP% Scanner (single-day), Hourly TP% Trends (multi-day aggregation), TP% Schedule (recommended settings).</p>
        </div>
      </div>
    </CollapseStage>

    <CollapseStage title="From Measurement to Prediction" sub="How Stage 2 connects to Stages 3-5">
      <div style={{color:C.txt,fontSize:10,fontFamily:F,lineHeight:1.8}}>
        <p style={{marginBottom:10}}>Stage 2 produces the training data for Stage 3 (ML). The hourly optimal TP% values across many days become the target variable for a predictive model.</p>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Stage 2 Output = Stage 3 Input</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Features (X):</span> ATR%, volume, trades, hour of day, day of week, previous hour's cycles, VIX level, sector momentum</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Target (Y):</span> Optimal TP% for that hour (from Stage 2 scan)</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Model:</span> Given current market conditions, predict what TP% will be most profitable in the next hour</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>The Progression</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.accent}}>Stage 1 (BUILT):</span> "How many cycles did we get at X% TP?" -- pure measurement</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.gold}}>Stage 2 (NEXT):</span> "What TP% SHOULD we have used each hour?" -- hindsight optimization</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.blue}}>Stage 3:</span> "What TP% should we use RIGHT NOW?" -- prediction from patterns</p>
          <p style={{marginBottom:4,paddingLeft:8,fontSize:9}}><span style={{color:C.purple}}>Stage 4:</span> Live adaptive engine that auto-adjusts TP% hourly based on Stage 3 model</p>
          <p style={{paddingLeft:8,fontSize:9}}><span style={{color:C.warn}}>Stage 5:</span> Reinforcement learning that improves from its own live decisions</p>
        </div>
      </div>
    </CollapseStage>

  </div>;
}

function HourlyOptimalPage(p){
  var s1=useState('NIO'),ticker=s1[0],setTicker=s1[1];
  var s2=useState(''),startDate=s2[0],setStartDate=s2[1];
  var s3=useState(''),endDate=s3[0],setEndDate=s3[1];
  var s4=useState('1'),cap=s4[0],setCap=s4[1];
  var s5=useState('0.005'),fee=s5[0],setFee=s5[1];
  var s6=useState(false),loading=s6[0],setLoading=s6[1];
  var s7=useState(null),results=s7[0],setResults=s7[1];
  var s8=useState(null),err=s8[0],setErr=s8[1];
  var s9=useState(''),prog=s9[0],setProg=s9[1];
  var lS={color:C.txtDim,fontSize:8,fontWeight:600,letterSpacing:1,textTransform:'uppercase',fontFamily:F,marginBottom:4,display:'block'};
  var iS={width:'100%',background:C.bgInput,border:'1px solid '+C.border,borderRadius:6,color:C.txtBright,fontFamily:F,fontSize:12,fontWeight:600,padding:'10px 12px',outline:'none'};
  var bB={width:'100%',padding:'12px',border:'none',borderRadius:8,fontFamily:F,fontSize:11,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',cursor:'pointer'};

  var getTradingDays=function(start,end){
    var days=[];var d=new Date(start+'T12:00:00Z');var e=new Date(end+'T12:00:00Z');
    while(d<=e){var dow=d.getUTCDay();if(dow!==0&&dow!==6){days.push(d.toISOString().slice(0,10));}d.setUTCDate(d.getUTCDate()+1);}
    return days;
  };

  var WORKER_URL='https://hourly-tp-scanner.alcharles1980.workers.dev/';

  var run=async function(){
    if(!p.apiKey){setErr('No Polygon API key set');return;}
    if(!startDate||!endDate){setErr('Set start and end dates');return;}
    var days=getTradingDays(startDate,endDate);
    if(!days.length){setErr('No trading days in range');return;}
    setLoading(true);setErr(null);setResults(null);
    var capVal=parseFloat(cap)||1;var feeVal=parseFloat(fee)||0.005;
    var totalTrades=0;var adaptiveSum=0;var dayCount=0;var serverFailed=false;
    try{
      for(var di=0;di<days.length;di++){
        var day=days[di];
        var processed=false;
        if(!serverFailed){
        setProg('Day '+(di+1)+'/'+days.length+': '+day+' [1/4] Trying server...');
        await new Promise(function(r){setTimeout(r,50);});
        try{
          var wController=new AbortController();
          var wTimeout=setTimeout(function(){wController.abort();},30000);
          var wResp=await fetch(WORKER_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ticker:ticker.toUpperCase(),date:day,polygon_key:p.apiKey,cap_per_level:capVal,fee_per_share:feeVal,supabase_url:SB_URL,supabase_key:SB_KEY}),signal:wController.signal});
          clearTimeout(wTimeout);
          if(wResp.ok){
            var wData=await wResp.json();
            if(wData.status==='processed'){
              totalTrades+=wData.total_trades;adaptiveSum+=wData.adaptive_total;dayCount++;
              setProg('Day '+(di+1)+'/'+days.length+': '+day+' - Done (server) '+wData.total_trades.toLocaleString()+' trades');
              processed=true;
            }else{
              setProg('Day '+(di+1)+'/'+days.length+': '+day+' | Server error: '+(wData.error||'unknown'));
              serverFailed=true;
              await new Promise(function(r){setTimeout(r,1000);});
            }
          }else{
            setProg('Day '+(di+1)+'/'+days.length+': '+day+' - Server HTTP '+wResp.status);
            serverFailed=true;
            await new Promise(function(r){setTimeout(r,1000);});
          }
        }catch(we){
          setProg('Day '+(di+1)+'/'+days.length+': '+day+' - Server: '+(we.name==='AbortError'?'timeout 30s':we.message));
          serverFailed=true;
          await new Promise(function(r){setTimeout(r,800);});
        }
        }else{
          setProg('Day '+(di+1)+'/'+days.length+': '+day+' [1/4] Skipping server (failed on previous day)');
          await new Promise(function(r){setTimeout(r,200);});
        }
        if(processed)continue;
        setProg('Day '+(di+1)+'/'+days.length+': '+day+' [2/4] Fetching trades from Polygon...');
        await new Promise(function(r){setTimeout(r,50);});
        var allTrades=[];
        var url2='https://api.polygon.io/v3/trades/'+ticker.toUpperCase()+'?timestamp.gte='+day+'T04:00:00.000Z&timestamp.lt='+day+'T23:59:59.000Z&limit=50000&sort=timestamp&order=asc&apiKey='+p.apiKey;
        var pgCnt=0;
        while(url2){
          var r2=await fetch(url2);if(!r2.ok)throw new Error('Polygon error '+r2.status+' on '+day);
          var d3=await r2.json();
          if(d3.results)for(var i2=0;i2<d3.results.length;i2++){var t2=d3.results[i2];allTrades.push({price:t2.price,size:t2.size,ts:t2.sip_timestamp||t2.participant_timestamp});}
          url2=d3.next_url?(d3.next_url+'&apiKey='+p.apiKey):null;
          pgCnt++;
          setProg('Day '+(di+1)+'/'+days.length+': '+day+' [2/4] '+allTrades.length.toLocaleString()+' trades (page '+pgCnt+')');
        }
        if(!allTrades.length){setProg('Day '+(di+1)+'/'+days.length+': '+day+' - No trades');await new Promise(function(r){setTimeout(r,500);});continue;}
        if(allTrades.length>80000){
          setProg('Day '+(di+1)+'/'+days.length+': '+day+' [3/4] Background thread ('+allTrades.length.toLocaleString()+' trades)...');
          await new Promise(function(r){setTimeout(r,50);});
          var wPrices=new Float64Array(allTrades.length);var wTs=new Float64Array(allTrades.length);
          for(var wi=0;wi<allTrades.length;wi++){wPrices[wi]=allTrades[wi].price;wTs[wi]=allTrades[wi].ts;}
          allTrades=null;
          var bgCode='self.onmessage=function(e){var d=e.data;var prices=new Float64Array(d.prices);var N=d.tradeCount;var cap=d.capPerLevel;var fee=d.feePerShare;var ticker=d.ticker;var date=d.date;var hours=new Int8Array(N);var ts2=new Float64Array(d.timestamps);for(var i=0;i<N;i++){var ts=ts2[i];var ms;if(ts>1e15)ms=ts/1e6;else if(ts>1e12)ms=ts/1e3;else ms=ts;var h=new Date(ms).getUTCHours()-4;if(h<0)h+=24;hours[i]=h;}ts2=null;var sp=prices[0];var fq=cap/sp;var af=fee*fq;var mn=Infinity,mx=-Infinity;for(var i=0;i<N;i++){if(prices[i]<mn)mn=prices[i];if(prices[i]>mx)mx=prices[i];}var ol=Math.floor(sp*100)/100;var ps2=Math.round(ol*1.01*100)/100;var mc=Math.round(Math.floor(mn*100));var xc=Math.round(Math.ceil(mx*100));var cnt=xc-mc+1;var oc=Math.round(ol*100);var pc=Math.round(ps2*100);var rows=[];var bph={};var at=0;for(var ti=1;ti<=100;ti++){var tpPct=ti/100;var tf=tpPct/100;var act=new Uint8Array(cnt);var tgt=new Float64Array(cnt);for(var c=0;c<cnt;c++){tgt[c]=Math.ceil((mc+c)/100*(1+tf)*100)/100;act[c]=(mc+c>=oc&&mc+c<=pc)?1:0;}var hc=new Int32Array(20);for(var i=1;i<N;i++){var p=prices[i],hr=hours[i];for(var j=0;j<cnt;j++){if(act[j]===1&&p>=tgt[j]){act[j]=0;if(hr>=4&&hr<20)hc[hr]++;}}var idx=Math.floor(p*100)-mc;if(idx>=0&&idx<cnt&&act[idx]===0)act[idx]=1;}var td=Math.round((Math.ceil(sp*(1+tpPct/100)*100)/100-sp)*100)/100;if(td<0.01)td=0.01;var gpc=fq*td,npc=gpc-af;for(var h=4;h<20;h++){var cy=hc[h],np=Math.round(cy*npc*10000)/10000;rows.push({ticker:ticker,trade_date:date,hour:h,tp_pct:tpPct,session_type:"all",cycles:cy,tp_dollar:td,net_profit:np});if(!bph[h]||np>bph[h].netProfit)bph[h]={tpPct:tpPct,tpDollar:td,cycles:cy,netProfit:np};}if(ti%5===0)self.postMessage({type:"progress",tpInt:ti,levels:cnt});}for(var h=4;h<20;h++)if(bph[h])at+=bph[h].netProfit;self.postMessage({type:"result",rows:rows,adaptiveTotal:at,tradeCount:N,sharePrice:sp,levels:cnt});};';
          var bgBlob=new Blob([bgCode],{type:'application/javascript'});var bgUrl=URL.createObjectURL(bgBlob);
          var diRef=di,daysRef=days.length,dayRef=day;
          var bgResult=await new Promise(function(resolve,reject){
            var bgW=new Worker(bgUrl);
            bgW.onmessage=function(ev){
              if(ev.data.type==='progress'){setProg('Day '+(diRef+1)+'/'+daysRef+': '+dayRef+' [3/4] TP% '+ev.data.tpInt+'/100 ('+ev.data.levels+' levels)');}
              else if(ev.data.type==='result'){resolve(ev.data);bgW.terminate();URL.revokeObjectURL(bgUrl);}
            };
            bgW.onerror=function(ev){reject(new Error('Background: '+(ev.message||'unknown')));bgW.terminate();URL.revokeObjectURL(bgUrl);};
            bgW.postMessage({prices:wPrices.buffer,timestamps:wTs.buffer,tradeCount:wPrices.length,capPerLevel:capVal,feePerShare:feeVal,ticker:ticker.toUpperCase(),date:day},[wPrices.buffer,wTs.buffer]);
          });
          setProg('Day '+(di+1)+'/'+days.length+': '+day+' [4/4] Saving '+bgResult.rows.length+' rows...');
          if(bgResult.rows&&bgResult.rows.length>0){
            await fetch(SB_URL+'/rest/v1/optimal_tp_hourly?ticker=eq.'+ticker.toUpperCase()+'&trade_date=eq.'+day+'&session_type=eq.all',{method:'DELETE',headers:getSbHeaders()});
            for(var bi=0;bi<bgResult.rows.length;bi+=500){await fetch(SB_URL+'/rest/v1/optimal_tp_hourly',{method:'POST',headers:getSbHeaders(),body:JSON.stringify(bgResult.rows.slice(bi,bi+500))});}
            totalTrades+=bgResult.tradeCount;adaptiveSum+=bgResult.adaptiveTotal;dayCount++;
          }
          setProg('Day '+(di+1)+'/'+days.length+': '+day+' - Done (bg) '+bgResult.tradeCount.toLocaleString()+' trades, '+bgResult.levels+' lvls');
          await new Promise(function(r){setTimeout(r,300);});
        }else{
          totalTrades+=allTrades.length;
          setProg('Day '+(di+1)+'/'+days.length+': '+day+' [3/4] Scanning '+allTrades.length.toLocaleString()+' trades...');
          await new Promise(function(r){setTimeout(r,50);});
          var scan=scanHourlyOptimalTP(allTrades,capVal,feeVal);
          if(!scan)continue;
          setProg('Day '+(di+1)+'/'+days.length+': '+day+' [4/4] Saving...');
          await SB.saveOptimalTP(ticker.toUpperCase(),day,'all',scan.matrix,scan.sharePrice);
          adaptiveSum+=scan.adaptiveTotal;dayCount++;
          setProg('Day '+(di+1)+'/'+days.length+': '+day+' - Done '+allTrades.length.toLocaleString()+' trades');
          await new Promise(function(r){setTimeout(r,300);});
        }
      }
      setProg('Loading aggregated results...');
      var dbRows=await SB.loadOptimalTPRange(ticker.toUpperCase(),startDate,endDate);
      if(!dbRows||!dbRows.length){setErr('No results in database after '+dayCount+' days');setLoading(false);return;}
      setProg('Building from '+dbRows.length+' rows...');
      var aggMatrix={};for(var h=4;h<20;h++){aggMatrix[h]={};}
      for(var ri=0;ri<dbRows.length;ri++){
        var row=dbRows[ri];var hr=row.hour;var key=parseFloat(row.tp_pct).toFixed(2);
        if(!aggMatrix[hr])aggMatrix[hr]={};
        if(!aggMatrix[hr][key])aggMatrix[hr][key]={tpPct:parseFloat(row.tp_pct),tpDollar:parseFloat(row.tp_dollar)||0,totalCycles:0,totalNetProfit:0,dayCount:0};
        aggMatrix[hr][key].totalCycles+=row.cycles;
        aggMatrix[hr][key].totalNetProfit+=parseFloat(row.net_profit)||0;
        aggMatrix[hr][key].dayCount++;
      }
      var avgBestPerHour={};var avgMatrix={};var flatTotals={};
      for(var h3=4;h3<20;h3++){
        var sorted=Object.values(aggMatrix[h3]).sort(function(a,b){return b.totalNetProfit-a.totalNetProfit;});
        avgMatrix[h3]=Object.values(aggMatrix[h3]).sort(function(a,b){return a.tpPct-b.tpPct;});
        if(sorted.length>0&&sorted[0].totalNetProfit>0)avgBestPerHour[h3]={tpPct:sorted[0].tpPct,tpDollar:sorted[0].tpDollar,cycles:sorted[0].totalCycles,netProfit:sorted[0].totalNetProfit};
        for(var fi=0;fi<sorted.length;fi++){
          var fk=sorted[fi].tpPct.toFixed(2);
          if(!flatTotals[fk])flatTotals[fk]={tpPct:sorted[fi].tpPct,tpDollar:sorted[fi].tpDollar,netTotal:0,totalCycles:0};
          flatTotals[fk].netTotal+=sorted[fi].totalNetProfit;
          flatTotals[fk].totalCycles+=sorted[fi].totalCycles;
        }
      }
      var flatBest={tpPct:0,netTotal:0};
      for(var fkey in flatTotals){if(flatTotals[fkey].netTotal>flatBest.netTotal)flatBest=flatTotals[fkey];}
      setResults({avgBestPerHour:avgBestPerHour,avgMatrix:avgMatrix,adaptiveSum:adaptiveSum,flatSum:flatBest.netTotal,flatBest:flatBest,ticker:ticker.toUpperCase(),startDate:startDate,endDate:endDate,totalDays:dayCount,totalTrades:totalTrades,cap:capVal,fee:feeVal});
      setProg('');setLoading(false);
    }catch(e){setErr(e.message);setProg('');setLoading(false);}
  };


  return <div>
    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Hourly Optimal TP% Finder</div>
    </div>
    <Cd>
      <SectionHead title="Hourly TP% Scanner" sub="Find the best TP% for each hour across a date range" info="Runs the full cycle engine 100 times (TP% 0.01-1.00) against all tick data for each day in the range. Each cycle is attributed to the hour it occurred. Results aggregated across days show which TP% is consistently best for each hour."/>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:10}}>
        <div><label style={lS}>Ticker</label><input value={ticker} onChange={function(e){setTicker(e.target.value.toUpperCase());}} style={iS}/></div>
        <div><label style={lS}>$/Level</label><input type="text" inputMode="decimal" value={cap} onChange={function(e){setCap(e.target.value);}} style={iS}/></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8}}>
        <div><label style={lS}>Start Date</label><input type="date" value={startDate} onChange={function(e){setStartDate(e.target.value);}} style={iS}/></div>
        <div><label style={lS}>End Date</label><input type="date" value={endDate} onChange={function(e){setEndDate(e.target.value);}} style={iS}/></div>
      </div>
      <div style={{marginTop:8,marginBottom:12}}>
        <div style={{width:'50%'}}><label style={lS}>Fee/Share</label><input type="text" inputMode="decimal" value={fee} onChange={function(e){setFee(e.target.value);}} style={iS}/></div>
      </div>
      {startDate&&endDate&&!loading&&<div style={{color:C.txtDim,fontSize:9,fontFamily:F,marginBottom:8}}>{getTradingDays(startDate,endDate).length+' trading days in range'}</div>}
      <button onClick={run} disabled={loading} style={Object.assign({},bB,{background:loading?C.border:'linear-gradient(135deg,#ffb020,#ff8800)',color:loading?C.txtDim:C.bg})}>{loading?'Scanning...':'Scan Hourly Optimal TP%'}</button>
      {prog&&<div style={{marginTop:8,color:C.gold,fontSize:10,fontFamily:F}}>{prog}</div>}
      {err&&<div style={{marginTop:8,padding:'8px 10px',background:C.warnDim,border:'1px solid #ff5c3a30',borderRadius:6,color:C.warn,fontSize:10}}>{err}</div>}
    </Cd>
    {results&&<div>
      <Cd glow={true}>
        <div style={{display:'inline-block',background:C.goldDim,border:'1px solid '+C.gold,borderRadius:4,padding:'2px 8px',fontSize:7,color:C.gold,fontFamily:F,fontWeight:700,marginBottom:8,letterSpacing:0.5}}>HOURLY OPTIMAL TP% | {results.ticker} | {results.startDate} to {results.endDate} | ${results.cap}/LEVEL</div>
        <SectionHead title="Adaptive vs Flat" sub={results.totalDays+' days | '+results.totalTrades.toLocaleString()+' total trades'} info="Compares using the best single TP% all day (flat) vs using the optimal TP% for each hour (adaptive), aggregated across all days in the range. The difference shows the potential edge from hourly adaptation."/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:10}}>
          <div style={{padding:'10px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,textAlign:'center'}}>
            <div style={{color:C.gold,fontSize:14,fontWeight:800,fontFamily:F,marginBottom:2}}>{results.flatBest?results.flatBest.tpPct.toFixed(2)+'%':'--'}</div>
            <div style={{color:C.txtDim,fontSize:7,fontFamily:F,letterSpacing:1,textTransform:'uppercase',marginBottom:4}}>Flat Best (all hours)</div>
            <div style={{color:C.gold,fontSize:18,fontWeight:800,fontFamily:F}}>{'$'+results.flatSum.toFixed(2)}</div>
            <div style={{color:C.txt,fontSize:9,fontFamily:F,marginTop:3}}>{results.flatBest&&results.flatBest.tpDollar?'$'+results.flatBest.tpDollar.toFixed(2)+'/cycle':'--'}{results.flatBest&&results.flatBest.totalCycles?' | '+results.flatBest.totalCycles.toLocaleString()+' cycles':''}</div>
          </div>
          <div style={{padding:'10px',background:C.bg,borderRadius:6,border:'1px solid '+C.accent,textAlign:'center'}}>
            <div style={{color:C.accent,fontSize:14,fontWeight:800,fontFamily:F,marginBottom:2}}>Adaptive</div>
            <div style={{color:C.txtDim,fontSize:7,fontFamily:F,letterSpacing:1,textTransform:'uppercase',marginBottom:4}}>Per-Hour Optimal</div>
            <div style={{color:C.accent,fontSize:18,fontWeight:800,fontFamily:F}}>{'$'+results.adaptiveSum.toFixed(2)}</div>
            <div style={{color:C.txt,fontSize:9,fontFamily:F,marginTop:3}}>{(function(){var tps=[];for(var hh=4;hh<20;hh++){if(results.avgBestPerHour[hh])tps.push(results.avgBestPerHour[hh].tpPct);}if(!tps.length)return'--';var mn=Math.min.apply(null,tps),mx=Math.max.apply(null,tps);return mn===mx?mn.toFixed(2)+'%/cycle':mn.toFixed(2)+'%-'+mx.toFixed(2)+'% range';})()}</div>
          </div>
        </div>
        {results.adaptiveSum>results.flatSum&&<div style={{marginTop:8,padding:'6px 10px',background:'rgba(0,229,160,0.08)',border:'1px solid rgba(0,229,160,0.2)',borderRadius:6,textAlign:'center'}}>
          <span style={{color:C.accent,fontSize:10,fontFamily:F,fontWeight:700}}>Adaptive edge: +${(results.adaptiveSum-results.flatSum).toFixed(2)} ({((results.adaptiveSum/results.flatSum-1)*100).toFixed(1)}% improvement over {results.totalDays} days)</span>
        </div>}
      </Cd>
      <Cd>
        <SectionHead title="Best TP% by Hour" sub={'Aggregated across '+results.totalDays+' trading days'} info="Shows which TP% produced the highest total net profit in each hour across all days. This is the recommended TP% schedule for the live bot based on historical consistency."/>
        <div style={{marginTop:10}}>
          <div style={{display:'flex',alignItems:'center',marginBottom:6,paddingBottom:4,borderBottom:'1px solid '+C.border}}>
            <div style={{width:36,flexShrink:0}}></div>
            <div style={{width:'30%',flexShrink:0,fontSize:8,color:C.txt,fontFamily:F,fontWeight:600}}>Profit</div>
            <div style={{flex:1,display:'flex',justifyContent:'flex-end'}}>
              <div style={{fontSize:8,color:C.gold,fontFamily:F,fontWeight:600,width:42,textAlign:'right'}}>TP%</div>
              <div style={{fontSize:8,color:C.blue,fontFamily:F,fontWeight:600,width:48,textAlign:'right'}}>TP $ Amt</div>
              <div style={{fontSize:8,color:C.txt,fontFamily:F,fontWeight:600,width:42,textAlign:'right'}}>Cycles</div>
              <div style={{fontSize:8,color:C.accent,fontFamily:F,fontWeight:600,width:48,textAlign:'right'}}>Net $</div>
            </div>
          </div>
          {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h){
            var best=results.avgBestPerHour[h];
            if(!best||best.netProfit<=0)return <div key={h} style={{display:'flex',alignItems:'center',marginBottom:2}}>
              <div style={{width:40,fontSize:7,color:'#5a6a7a',fontFamily:F,textAlign:'right',paddingRight:6}}>{hourLabels[String(h)]}</div>
              <div style={{flex:1,color:'#3a4a5a',fontSize:8,fontFamily:F}}>No profitable TP%</div>
            </div>;
            var maxProfit=0;for(var hh=4;hh<20;hh++){if(results.avgBestPerHour[hh]&&results.avgBestPerHour[hh].netProfit>maxProfit)maxProfit=results.avgBestPerHour[hh].netProfit;}
            var pct=maxProfit>0?Math.sqrt(best.netProfit/maxProfit)*100:0;
            var isRTH=h>=9&&h<16;
            return <div key={h} style={{display:'flex',alignItems:'center',marginBottom:2}}>
              <div style={{width:36,fontSize:7,color:isRTH?'#c0d4e8':'#5a6a7a',fontFamily:F,textAlign:'right',paddingRight:4,flexShrink:0}}>{hourLabels[String(h)]}</div>
              <div style={{width:'30%',position:'relative',height:20,flexShrink:0}}>
                <div style={{position:'absolute',left:0,top:2,bottom:2,width:pct+'%',background:isRTH?C.accent:'#506878',borderRadius:'0 3px 3px 0',minWidth:best.cycles>0?4:0}}></div>
              </div>
              <div style={{flex:1,display:'flex',justifyContent:'flex-end'}}>
                <div style={{fontSize:8,color:C.gold,fontFamily:F,fontWeight:700,width:42,textAlign:'right'}}>{best.tpPct.toFixed(2)}%</div>
                <div style={{fontSize:8,color:C.blue,fontFamily:F,fontWeight:600,width:48,textAlign:'right'}}>{'$'+(best.tpDollar||0).toFixed(2)}</div>
                <div style={{fontSize:8,color:C.txt,fontFamily:F,width:42,textAlign:'right'}}>{best.cycles}</div>
                <div style={{fontSize:8,color:C.accent,fontFamily:F,fontWeight:700,width:48,textAlign:'right'}}>{'$'+best.netProfit.toFixed(2)}</div>
              </div>
            </div>;
          })}
        </div>
      </Cd>
      <Cd>
        <SectionHead title="TP% Heatmap by Hour" sub={'Aggregated profit across '+results.totalDays+' days'} info="Each row is an hour, brightness = relative net profit for that TP%. Gold border = best TP% for that hour. This reveals which TP% ranges are viable for each hour and where the sweet spots are."/>
        <div style={{overflowX:'auto',marginTop:8}}>
          <div style={{minWidth:600}}>
            <div style={{display:'flex',marginBottom:2}}>
              <div style={{width:44,flexShrink:0}}></div>
              {[0.05,0.10,0.15,0.20,0.25,0.30,0.40,0.50,0.60,0.70,0.80,0.90,1.00].map(function(tp){
                return <div key={tp} style={{flex:1,fontSize:5,color:C.txtDim,fontFamily:F,textAlign:'center'}}>{tp.toFixed(2)}</div>;
              })}
            </div>
            {[4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19].map(function(h){
              var hourData=results.avgMatrix[h]||[];
              var maxNet=0;for(var x=0;x<hourData.length;x++){if(hourData[x].totalNetProfit>maxNet)maxNet=hourData[x].totalNetProfit;}
              return <div key={h} style={{display:'flex',alignItems:'center',marginBottom:1}}>
                <div style={{width:44,fontSize:7,color:(h>=9&&h<16)?'#c0d4e8':'#5a6a7a',fontFamily:F,textAlign:'right',paddingRight:4,flexShrink:0}}>{hourLabels[String(h)]}</div>
                <div style={{flex:1,display:'flex',gap:0}}>
                  {hourData.map(function(d,idx){
                    var intensity=maxNet>0&&d.totalNetProfit>0?Math.min(d.totalNetProfit/maxNet,1):0;
                    var bg=intensity>0?'rgba(0,229,160,'+(intensity*0.8+0.1)+')':'transparent';
                    var isBest=results.avgBestPerHour[h]&&d.tpPct===results.avgBestPerHour[h].tpPct;
                    return <div key={idx} style={{flex:1,height:14,background:bg,borderRadius:1,border:isBest?'1px solid '+C.gold:'none'}} title={d.tpPct.toFixed(2)+'% | '+d.totalCycles+' cycles | $'+d.totalNetProfit.toFixed(2)}></div>;
                  })}
                </div>
              </div>;
            })}
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',marginTop:6}}>
          <div style={{fontSize:7,color:C.txtDim,fontFamily:F}}>Low TP% &#8592;</div>
          <div style={{fontSize:7,color:C.txtDim,fontFamily:F}}>&#8594; High TP%</div>
        </div>
        <div style={{fontSize:7,color:C.txtDim,fontFamily:F,textAlign:'center',marginTop:4}}>Gold border = best TP% for that hour | Brighter = higher profit</div>
      </Cd>
    </div>}
  </div>;
}

function BuildDataSetPage(p){
  var s1=useState('NIO'),ticker=s1[0],setTicker=s1[1];
  var s2=useState(''),startDate=s2[0],setStartDate=s2[1];
  var s3=useState(''),endDate=s3[0],setEndDate=s3[1];
  var s4=useState(false),loading=s4[0],setLoading=s4[1];
  var s5=useState(null),err=s5[0],setErr=s5[1];
  var s6=useState(''),prog=s6[0],setProg=s6[1];
  var s7=useState(null),stats=s7[0],setStats=s7[1];
  var lS={color:C.txtDim,fontSize:8,fontWeight:600,letterSpacing:1,textTransform:'uppercase',fontFamily:F,marginBottom:4,display:'block'};
  var iS={width:'100%',background:C.bgInput,border:'1px solid '+C.border,borderRadius:6,color:C.txtBright,fontFamily:F,fontSize:12,fontWeight:600,padding:'10px 12px',outline:'none'};
  var bB={width:'100%',padding:'12px',border:'none',borderRadius:8,fontFamily:F,fontSize:11,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',cursor:'pointer'};
  var fS={padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10};
  var cS={padding:'8px 10px',background:'#0a1018',borderRadius:4,border:'1px solid '+C.border,fontFamily:F,fontSize:8,color:C.txtDim,lineHeight:1.6,overflowX:'auto',whiteSpace:'pre-wrap',marginTop:6};

  var getTradingDays=function(start,end){
    var days=[];var d=new Date(start+'T12:00:00Z');var e=new Date(end+'T12:00:00Z');
    while(d<=e){var dow=d.getUTCDay();if(dow!==0&&dow!==6){days.push(d.toISOString().slice(0,10));}d.setUTCDate(d.getUTCDate()+1);}
    return days;
  };

  var toETHour=function(ts){var ms;if(ts>1e15)ms=ts/1e6;else if(ts>1e12)ms=ts/1e3;else ms=ts;var h=new Date(ms).getUTCHours()-4;if(h<0)h+=24;return h;};

  var run=async function(){
    if(!p.apiKey){setErr('No Polygon API key set');return;}
    if(!startDate||!endDate){setErr('Set start and end dates');return;}
    var days=getTradingDays(startDate,endDate);
    if(!days.length){setErr('No trading days in range');return;}
    setLoading(true);setErr(null);setStats(null);
    var totalDays=0;var totalRows=0;var prevDayClose=null;
    try{
      for(var di=0;di<days.length;di++){
        var day=days[di];

        // Step 1: Fetch all ticks from Polygon
        setProg('Day '+(di+1)+'/'+days.length+': '+day+' | Fetching ticks...');
        var allP=[];var allS=[];var allTs=[];
        var fetchWindow=async function(dayStr,tsFrom,tsTo,label){
          var arr={p:[],s:[],ts:[]};
          var fUrl='https://api.polygon.io/v3/trades/'+ticker.toUpperCase()+'?timestamp.gte='+dayStr+tsFrom+'&timestamp.lt='+dayStr+tsTo+'&limit=50000&sort=timestamp&order=asc&apiKey='+p.apiKey;
          var pg=0;
          while(fUrl){
            var fr=await fetch(fUrl);
            if(fr.status===429){setProg('Day '+(di+1)+'/'+days.length+': '+dayStr+' '+label+' | Rate limited, waiting 12s...');await new Promise(function(w){setTimeout(w,12000);});continue;}
            if(!fr.ok)throw new Error('Polygon error '+fr.status+' on '+dayStr);
            var fd=await fr.json();
            if(fd.results)for(var j=0;j<fd.results.length;j++){arr.p.push(fd.results[j].price);arr.s.push(fd.results[j].size||0);arr.ts.push(fd.results[j].sip_timestamp||fd.results[j].participant_timestamp);}
            fUrl=fd.next_url?(fd.next_url+'&apiKey='+p.apiKey):null;
            pg++;
            setProg('Day '+(di+1)+'/'+days.length+': '+dayStr+' '+label+' | '+arr.p.length.toLocaleString()+' ticks (page '+pg+(fUrl?' ...':' done')+')');
          }
          return arr;
        };
        setProg('Day '+(di+1)+'/'+days.length+': '+day+' | Fetching pre-market (4-9:30AM ET)...');
        var w1=await fetchWindow(day,'T08:00:00.000Z','T13:30:00.000Z','[1/3 pre]');
        await new Promise(function(w){setTimeout(w,1000);});
        setProg('Day '+(di+1)+'/'+days.length+': '+day+' | Fetching morning (9:30AM-1PM ET)...');
        var w2=await fetchWindow(day,'T13:30:00.000Z','T17:00:00.000Z','[2/3 morn]');
        await new Promise(function(w){setTimeout(w,1000);});
        setProg('Day '+(di+1)+'/'+days.length+': '+day+' | Fetching afternoon+post (1-8PM ET)...');
        var w3=await fetchWindow(day,'T17:00:00.000Z','T23:59:59.000Z','[3/3 aftn]');
        allP=w1.p.concat(w2.p).concat(w3.p);allS=w1.s.concat(w2.s).concat(w3.s);allTs=w1.ts.concat(w2.ts).concat(w3.ts);
        setProg('Day '+(di+1)+'/'+days.length+': '+day+' | Total: '+allP.length.toLocaleString()+' ticks');
        await new Promise(function(w){setTimeout(w,2000);});
        if(!allP.length){setProg('Day '+(di+1)+'/'+days.length+': '+day+' | No ticks, skipping');await new Promise(function(r){setTimeout(r,500);});continue;}

        setProg('Day '+(di+1)+'/'+days.length+': '+day+' | Extracting features from '+allP.length.toLocaleString()+' ticks...');
        await new Promise(function(r){setTimeout(r,30);});

        // Step 2: Single pass - extract hourly features
        var hOpen={},hClose={},hHigh={},hLow={},hVol={},hTrades={},hVwapNum={},hFirstTs={},hLastTs={};
        for(var h=4;h<20;h++){hHigh[h]=-Infinity;hLow[h]=Infinity;hVol[h]=0;hTrades[h]=0;hVwapNum[h]=0;hOpen[h]=null;hClose[h]=null;hFirstTs[h]=null;hLastTs[h]=null;}

        for(var i=0;i<allP.length;i++){
          var price=allP[i];var size=allS[i];var hr=toETHour(allTs[i]);
          if(hr>=4&&hr<20){
            if(hOpen[hr]===null){hOpen[hr]=price;hFirstTs[hr]=allTs[i];}
            hClose[hr]=price;hLastTs[hr]=allTs[i];
            if(price>hHigh[hr])hHigh[hr]=price;
            if(price<hLow[hr])hLow[hr]=price;
            hVol[hr]+=size;hTrades[hr]++;
            hVwapNum[hr]+=price*size;
          }
        }

        // Day-level aggregates
        var dayOpen=allP[0];var dayClose=allP[allP.length-1];
        var dayHigh=-Infinity;var dayLow=Infinity;var dayVol=0;var dayTrades=allP.length;
        for(var i=0;i<allP.length;i++){if(allP[i]>dayHigh)dayHigh=allP[i];if(allP[i]<dayLow)dayLow=allP[i];dayVol+=allS[i];}
        var dayDow=new Date(day+'T12:00:00Z').getUTCDay();

        // Step 3: Fetch previous day OHLC for overnight gap
        if(prevDayClose===null&&di===0){
          setProg('Day '+(di+1)+'/'+days.length+': '+day+' | Fetching previous day OHLC...');
          try{
            var prevDate=new Date(day+'T12:00:00Z');prevDate.setUTCDate(prevDate.getUTCDate()-1);
            while(prevDate.getUTCDay()===0||prevDate.getUTCDay()===6)prevDate.setUTCDate(prevDate.getUTCDate()-1);
            var prevDateStr=prevDate.toISOString().slice(0,10);
            var ohlcR=await fetch('https://api.polygon.io/v1/open-close/'+ticker.toUpperCase()+'/'+prevDateStr+'?adjusted=true&apiKey='+p.apiKey);
            if(ohlcR.ok){var ohlcD=await ohlcR.json();if(ohlcD.close)prevDayClose=ohlcD.close;}
          }catch(e){}
        }
        var gapPct=(prevDayClose&&prevDayClose>0)?((dayOpen-prevDayClose)/prevDayClose)*100:null;

        // Step 4: Fetch VIX close
        var vixClose=null;
        setProg('Day '+(di+1)+'/'+days.length+': '+day+' | Fetching VIX...');
        try{
          var vixR=await fetch('https://api.polygon.io/v2/aggs/ticker/I:VIX/range/1/day/'+day+'/'+day+'?adjusted=true&apiKey='+p.apiKey);
          if(vixR.ok){var vixD=await vixR.json();if(vixD.results&&vixD.results.length)vixClose=vixD.results[0].c;}
        }catch(e){}

        // Step 5: Build rows with derived features
        var rows=[];
        var cumVol=0;var cumHigh=-Infinity;var cumLow=Infinity;
        for(var h=4;h<20;h++){
          if(hTrades[h]===0)continue;
          cumVol+=hVol[h];
          if(hHigh[h]>cumHigh)cumHigh=hHigh[h];
          if(hLow[h]<cumLow)cumLow=hLow[h];
          var atrD=hHigh[h]-hLow[h];
          var atrP=(hLow[h]>0)?((atrD/hLow[h])*100):0;
          var vwap=(hVol[h]>0)?(hVwapNum[h]/hVol[h]):hClose[h];
          var priceVsOpen=(dayOpen>0)?((hClose[h]-dayOpen)/dayOpen)*100:0;
          var intradayRng=(cumLow>0&&cumLow<Infinity)?((cumHigh-cumLow)/cumLow)*100:0;
          var cumVolPct=(dayVol>0)?((cumVol/dayVol)*100):0;
          rows.push({
            ticker:ticker.toUpperCase(),trade_date:day,hour:h,
            hour_open:Math.round(hOpen[h]*10000)/10000,
            hour_close:Math.round(hClose[h]*10000)/10000,
            hour_high:Math.round(hHigh[h]*10000)/10000,
            hour_low:Math.round(hLow[h]*10000)/10000,
            hour_atr_dollar:Math.round(atrD*10000)/10000,
            hour_atr_pct:Math.round(atrP*10000)/10000,
            hour_volume:hVol[h],hour_trades:hTrades[h],
            hour_vwap:Math.round(vwap*10000)/10000,
            hour_first_ts:hFirstTs[h],hour_last_ts:hLastTs[h],
            day_open:Math.round(dayOpen*10000)/10000,
            day_high:Math.round(dayHigh*10000)/10000,
            day_low:Math.round(dayLow*10000)/10000,
            day_close:Math.round(dayClose*10000)/10000,
            day_volume:dayVol,day_trades:dayTrades,
            price_vs_day_open_pct:Math.round(priceVsOpen*10000)/10000,
            intraday_range_pct:Math.round(intradayRng*10000)/10000,
            cumulative_volume_pct:Math.round(cumVolPct*100)/100,
            prev_day_close:prevDayClose?Math.round(prevDayClose*10000)/10000:null,
            overnight_gap_pct:gapPct!==null?Math.round(gapPct*10000)/10000:null,
            vix_close:vixClose,
            day_of_week:dayDow
          });
        }

        // Step 6: Save to database
        setProg('Day '+(di+1)+'/'+days.length+': '+day+' | Saving '+rows.length+' feature rows...');
        await SB.saveHourlyFeatures(ticker.toUpperCase(),day,rows);
        totalDays++;totalRows+=rows.length;

        // Set prevDayClose for next day
        prevDayClose=dayClose;
        setProg('Day '+(di+1)+'/'+days.length+': '+day+' | Done: '+allP.length.toLocaleString()+' ticks, '+rows.length+' features');
      }
      setStats({totalDays:totalDays,totalRows:totalRows,ticker:ticker.toUpperCase(),startDate:startDate,endDate:endDate});
      setProg('');setLoading(false);
    }catch(e){setErr(e.message);setProg('');setLoading(false);}
  };

  return <div>
    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Build Data Set</div>
    </div>

    <Cd glow={true}>
      <SectionHead title="Feature Extraction Pipeline" sub="Build the training data set from Polygon trade ticks" info="Extracts hourly market microstructure features from raw tick data and stores them in the hourly_features table. This data becomes the X variables (features) for correlation analysis with the optimal TP% values (Y) from Stage 2."/>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.7,marginTop:8}}>
        <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>What gets collected per hour (16 rows per trading day):</p>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:8}}>
          <div style={{padding:6,background:C.bg,borderRadius:4,border:'1px solid '+C.border}}>
            <div style={{color:C.gold,fontSize:7,fontWeight:700,marginBottom:3}}>PRICE (4 fields)</div>
            <div style={{fontSize:8}}>Open, Close, High, Low per hour</div>
          </div>
          <div style={{padding:6,background:C.bg,borderRadius:4,border:'1px solid '+C.border}}>
            <div style={{color:C.warn,fontSize:7,fontWeight:700,marginBottom:3}}>VOLATILITY (2 fields)</div>
            <div style={{fontSize:8}}>ATR Dollar, ATR Percent</div>
          </div>
          <div style={{padding:6,background:C.bg,borderRadius:4,border:'1px solid '+C.border}}>
            <div style={{color:C.blue,fontSize:7,fontWeight:700,marginBottom:3}}>VOLUME (3 fields)</div>
            <div style={{fontSize:8}}>Volume, Trade Count, VWAP</div>
          </div>
          <div style={{padding:6,background:C.bg,borderRadius:4,border:'1px solid '+C.border}}>
            <div style={{color:C.accent,fontSize:7,fontWeight:700,marginBottom:3}}>POSITION (3 fields)</div>
            <div style={{fontSize:8}}>Price vs Open, Range, Cum Volume</div>
          </div>
          <div style={{padding:6,background:C.bg,borderRadius:4,border:'1px solid '+C.border}}>
            <div style={{color:C.purple,fontSize:7,fontWeight:700,marginBottom:3}}>DAY CONTEXT (7 fields)</div>
            <div style={{fontSize:8}}>Day OHLC, Volume, Trades, DOW</div>
          </div>
          <div style={{padding:6,background:C.bg,borderRadius:4,border:'1px solid '+C.border}}>
            <div style={{color:'#e090ff',fontSize:7,fontWeight:700,marginBottom:3}}>EXTERNAL (3 fields)</div>
            <div style={{fontSize:8}}>Prev Close, Overnight Gap, VIX</div>
          </div>
        </div>
        <p style={{marginBottom:4,color:C.gold,fontWeight:700}}>Process per day:</p>
        <p style={{marginBottom:2,paddingLeft:8,fontSize:8}}><span style={{color:C.accent}}>1.</span> Fetch all trade ticks from Polygon (price + size + timestamp)</p>
        <p style={{marginBottom:2,paddingLeft:8,fontSize:8}}><span style={{color:C.accent}}>2.</span> Single pass through ticks: track open/close/high/low/volume/trades/VWAP per hour</p>
        <p style={{marginBottom:2,paddingLeft:8,fontSize:8}}><span style={{color:C.accent}}>3.</span> Fetch previous day OHLC from Polygon (1 API call) for overnight gap</p>
        <p style={{marginBottom:2,paddingLeft:8,fontSize:8}}><span style={{color:C.accent}}>4.</span> Fetch VIX daily close from Polygon (1 API call)</p>
        <p style={{marginBottom:2,paddingLeft:8,fontSize:8}}><span style={{color:C.accent}}>5.</span> Compute derived features (price vs open, cumulative range, cumulative volume %)</p>
        <p style={{paddingLeft:8,fontSize:8}}><span style={{color:C.accent}}>6.</span> Save 16 rows to hourly_features table in Supabase</p>
      </div>
    </Cd>

    <Cd>
      <SectionHead title="Build Parameters" sub="Select ticker and date range"/>
      <div style={{display:'grid',gridTemplateColumns:'1fr',gap:8,marginTop:10}}>
        <div><label style={lS}>Ticker</label><input value={ticker} onChange={function(e){setTicker(e.target.value.toUpperCase());}} style={iS}/></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8,marginBottom:12}}>
        <div><label style={lS}>Start Date</label><input type="date" value={startDate} onChange={function(e){setStartDate(e.target.value);}} style={iS}/></div>
        <div><label style={lS}>End Date</label><input type="date" value={endDate} onChange={function(e){setEndDate(e.target.value);}} style={iS}/></div>
      </div>
      {startDate&&endDate&&!loading&&<div style={{color:C.txtDim,fontSize:9,fontFamily:F,marginBottom:8}}>{getTradingDays(startDate,endDate).length+' trading days | ~'+(getTradingDays(startDate,endDate).length*16)+' feature rows will be generated'}</div>}
      <button onClick={run} disabled={loading} style={Object.assign({},bB,{background:loading?C.border:'linear-gradient(135deg,#a855f7,#8040d0)',color:loading?C.txtDim:'#fff'})}>{loading?'Building...':'Build Feature Data Set'}</button>
      {prog&&<div style={{marginTop:8,color:C.purple,fontSize:10,fontFamily:F}}>{prog}</div>}
      {err&&<div style={{marginTop:8,padding:'8px 10px',background:C.warnDim,border:'1px solid #ff5c3a30',borderRadius:6,color:C.warn,fontSize:10}}>{err}</div>}
    </Cd>

    {stats&&<Cd glow={true}>
      <SectionHead title="Build Complete" sub={stats.ticker+' | '+stats.startDate+' to '+stats.endDate}/>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:10}}>
        <Mt label="Days Processed" value={stats.totalDays} color={C.accent} size="lg"/>
        <Mt label="Feature Rows" value={stats.totalRows} color={C.purple} size="lg"/>
        <Mt label="Fields per Row" value="22" color={C.blue} size="lg"/>
      </div>
      <div style={{marginTop:8,padding:'6px 10px',background:'rgba(168,85,247,0.08)',border:'1px solid rgba(168,85,247,0.2)',borderRadius:6,textAlign:'center'}}>
        <span style={{color:C.purple,fontSize:9,fontFamily:F,fontWeight:700}}>Data saved to hourly_features table. Run Stage 2 Hourly TP% Scanner on the same dates to generate the target variable (Y), then use correlation analysis to find predictive features.</span>
      </div>
    </Cd>}

    <Cd>
      <SectionHead title="Storage Schema" sub="hourly_features table (Supabase)"/>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <div style={fS}>
          <p style={{marginBottom:4,color:C.accent,fontWeight:700}}>Table: hourly_features</p>
          <p style={{marginBottom:4}}>UNIQUE constraint on (ticker, trade_date, hour). 16 rows per stock per day. Re-running overwrites existing data for the same ticker/date.</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold}}>Primary key:</span> ticker + trade_date + hour</p>
          <p><span style={{color:C.gold}}>Total columns:</span> 22 feature fields + id + created_at = 24 columns</p>
        </div>
      </div>
    </Cd>

    <CollapseStage title="Hourly Price Features" sub="hour_open, hour_close, hour_high, hour_low" badge="4 fields" badgeColor={C.gold} badgeBg={C.goldDim}>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8}}>
        <div style={fS}>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>What:</span> The first tick price, last tick price, highest price, and lowest price within each ET hour (4AM-7PM).</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold,fontWeight:700}}>Why:</span> These are the foundation for volatility measurement. The high-low range determines ATR. Open-close direction indicates hourly trend. Price levels define where cycles are possible.</p>
          <p><span style={{color:C.blue,fontWeight:700}}>Calculation:</span> Single pass through all ticks. First tick seen in each hour = open. Last tick = close. Running max = high. Running min = low. Hour determined by converting SIP timestamp from UTC to ET (UTC-4).</p>
        </div>
        <div style={cS}>{'// Initialize per hour\nfor (h = 4; h < 20; h++) {\n  hHigh[h] = -Infinity;\n  hLow[h] = Infinity;\n  hOpen[h] = null;\n  hClose[h] = null;\n}\n\n// Single pass through all ticks\nfor (i = 0; i < allTicks.length; i++) {\n  var price = ticks[i].price;\n  var hr = toETHour(ticks[i].timestamp);\n  \n  if (hOpen[hr] === null) hOpen[hr] = price;  // first tick\n  hClose[hr] = price;                          // last tick (overwrites)\n  if (price > hHigh[hr]) hHigh[hr] = price;    // running max\n  if (price < hLow[hr]) hLow[hr] = price;      // running min\n}'}</div>
      </div>
    </CollapseStage>

    <CollapseStage title="Hourly Volatility Features" sub="hour_atr_dollar, hour_atr_pct" badge="2 fields" badgeColor={C.warn} badgeBg={C.warnDim}>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8}}>
        <div style={fS}>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>What:</span> ATR Dollar = High - Low (absolute range in dollars). ATR Percent = (High - Low) / Low x 100 (range as percentage of price).</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold,fontWeight:700}}>Why:</span> ATR% is the primary volatility feature. Stage 2 data shows a strong correlation: hours with higher ATR% tend to favor wider TP% (more room for targets to be hit). Hours with low ATR% favor tight TP% (maximize cycles in a narrow range). ATR$ relates directly to whether a given TP dollar amount is achievable.</p>
          <p><span style={{color:C.blue,fontWeight:700}}>Calculation:</span> Derived from hourly high and low. ATR$ = high - low. ATR% = ATR$ / low x 100. Uses low as denominator (not mid or open) for consistency with standard ATR% conventions.</p>
        </div>
        <div style={cS}>{'var atrDollar = hHigh[h] - hLow[h];\nvar atrPct = hLow[h] > 0\n  ? (atrDollar / hLow[h]) * 100\n  : 0;\n\n// Example: High=$5.82, Low=$5.71\n// ATR$ = $0.11\n// ATR% = 0.11/5.71 * 100 = 1.926%'}</div>
      </div>
    </CollapseStage>

    <CollapseStage title="Hourly Volume Features" sub="hour_volume, hour_trades, hour_vwap" badge="3 fields" badgeColor={C.blue} badgeBg={C.blueDim}>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8}}>
        <div style={fS}>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>What:</span> Volume = total shares traded in the hour. Trades = number of individual executions. VWAP = volume-weighted average price (Sum of price x size / Sum of size).</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold,fontWeight:700}}>Why:</span> Volume and trade count measure liquidity and oscillation opportunity. High trade count with moderate volume suggests many small retail orders (ideal for grid oscillation). VWAP indicates the fair value -- price oscillating around VWAP is mean-reverting (favors tighter TP%), price diverging from VWAP is trending (favors wider TP%).</p>
          <p><span style={{color:C.blue,fontWeight:700}}>Calculation:</span> Volume = sum of all tick sizes in the hour. Trades = count of ticks. VWAP = running sum of (price x size) divided by running sum of size.</p>
        </div>
        <div style={cS}>{'// Accumulate during single pass\nhVol[hr] += size;       // sum shares\nhTrades[hr]++;          // count executions\nhVwapNum[hr] += price * size;  // numerator\n\n// After pass, compute VWAP\nvar vwap = hVol[h] > 0\n  ? hVwapNum[h] / hVol[h]\n  : hClose[h];\n\n// Example: 3 trades at $5.70x100, $5.72x200, $5.71x150\n// VWAP = (570+1144+856.5) / (100+200+150)\n//      = 2570.5 / 450 = $5.7122'}</div>
      </div>
    </CollapseStage>

    <CollapseStage title="Derived Position Features" sub="price_vs_day_open_pct, intraday_range_pct, cumulative_volume_pct" badge="3 fields" badgeColor={C.accent} badgeBg={'rgba(0,229,160,0.1)'}>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8}}>
        <div style={fS}>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>What:</span> Price vs Open = how far the hourly close is from the day open (%). Intraday Range = cumulative high-low range up to this hour (%). Cumulative Volume = what fraction of the day total volume has occurred by this hour (%).</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold,fontWeight:700}}>Why:</span> Price vs Open captures trend magnitude -- large deviation means trending (wider TP%). Intraday Range shows cumulative volatility -- expanding range signals active day. Cumulative Volume% indicates where in the day volume profile we are -- 80% of volume by 2PM means post-market will be thin (wider TP% needed).</p>
          <p><span style={{color:C.blue,fontWeight:700}}>Calculation:</span> Computed cumulatively. Each hour uses all data from hour 4 up to and including current hour. This means features are available at prediction time (you know the cumulative range at 10AM to predict the best TP% for 11AM).</p>
        </div>
        <div style={cS}>{'// Cumulative tracking (reset each day)\nvar cumVol = 0;\nvar cumHigh = -Infinity;\nvar cumLow = Infinity;\n\nfor (h = 4; h < 20; h++) {\n  cumVol += hVol[h];\n  if (hHigh[h] > cumHigh) cumHigh = hHigh[h];\n  if (hLow[h] < cumLow) cumLow = hLow[h];\n  \n  // Price vs day open\n  priceVsOpen = ((hClose[h] - dayOpen) / dayOpen) * 100;\n  \n  // Cumulative intraday range\n  intradayRange = ((cumHigh - cumLow) / cumLow) * 100;\n  \n  // Cumulative volume percentage\n  cumVolPct = (cumVol / dayVolume) * 100;\n}'}</div>
      </div>
    </CollapseStage>

    <CollapseStage title="Day Context Features" sub="day_open/high/low/close, day_volume, day_trades, day_of_week" badge="7 fields" badgeColor={C.purple} badgeBg={'rgba(168,85,247,0.1)'}>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8}}>
        <div style={fS}>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>What:</span> Full day OHLCV computed from all ticks. Day of week as integer (1=Mon through 5=Fri). These are the same for all 16 hourly rows within a day.</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold,fontWeight:700}}>Why:</span> Day-level context normalizes hourly features. An hour with 50,000 shares volume means different things on a 500K volume day vs a 2M volume day. Day of week captures weekly patterns (Monday gaps, Friday squaring). Day OHLC enables overnight gap calculation.</p>
          <p><span style={{color:C.blue,fontWeight:700}}>Calculation:</span> Day open = first tick of day. Day close = last tick. Day high/low = global max/min across all ticks. Volume/trades = sum/count across all ticks. DOW from JavaScript getUTCDay().</p>
        </div>
        <div style={cS}>{'var dayOpen = allPrices[0];\nvar dayClose = allPrices[allPrices.length - 1];\nvar dayHigh = Math.max(...allPrices);\nvar dayLow = Math.min(...allPrices);\nvar dayVolume = allSizes.reduce((a,b) => a+b, 0);\nvar dayTrades = allPrices.length;\nvar dayOfWeek = new Date(date + "T12:00:00Z").getUTCDay();\n// 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri'}</div>
      </div>
    </CollapseStage>

    <CollapseStage title="External Data Features" sub="prev_day_close, overnight_gap_pct, vix_close" badge="3 fields" badgeColor={'#e090ff'} badgeBg={'rgba(224,144,255,0.1)'}>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8}}>
        <div style={fS}>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>What:</span> Previous trading day closing price, overnight gap percentage, and CBOE VIX index daily close.</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold,fontWeight:700}}>Why:</span> Overnight gap signals catalyst events (earnings, news) that change volatility regime for the day. Large gaps typically mean wider TP% early, tighter TP% as catalyst is absorbed. VIX is the market-wide fear gauge -- VIX above 20 = elevated volatility regime across all stocks = wider TP% tends to be optimal.</p>
          <p><span style={{color:C.blue,fontWeight:700}}>Calculation:</span> Previous close fetched from Polygon /v1/open-close/ endpoint for the prior trading day (skipping weekends). Gap% = (Today Open - Prev Close) / Prev Close x 100. VIX fetched from Polygon /v2/aggs/ for the current date.</p>
        </div>
        <div style={cS}>{'// Previous day close (Polygon OHLC endpoint)\nvar prevResp = await fetch(\n  "https://api.polygon.io/v1/open-close/" + ticker\n  + "/" + prevDate + "?adjusted=true&apiKey=" + key\n);\nvar prevData = await prevResp.json();\nvar prevClose = prevData.close;\n\n// Overnight gap\nvar gapPct = ((todayOpen - prevClose) / prevClose) * 100;\n\n// VIX (Polygon aggregates)\nvar vixResp = await fetch(\n  "https://api.polygon.io/v2/aggs/ticker/I:VIX/range/1/day/"\n  + date + "/" + date + "?apiKey=" + key\n);\nvar vixData = await vixResp.json();\nvar vixClose = vixData.results[0].c;'}</div>
      </div>
    </CollapseStage>

    <CollapseStage title="Timestamp Features" sub="hour_first_ts, hour_last_ts" badge="2 fields" badgeColor={C.txtDim} badgeBg={'rgba(100,120,140,0.1)'}>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8}}>
        <div style={fS}>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>What:</span> Nanosecond-precision SIP timestamps of the first and last trade in each hour. Stored as raw numeric values from Polygon.</p>
          <p style={{marginBottom:4}}><span style={{color:C.gold,fontWeight:700}}>Why:</span> Enables precise timing analysis. The gap between last tick of hour N and first tick of hour N+1 measures inter-hour activity gaps. Hours with late first-ticks may indicate pre-market illiquidity. Also useful for joining with live trade system data for exact timestamp matching.</p>
          <p><span style={{color:C.blue,fontWeight:700}}>Calculation:</span> Captured during the single-pass feature extraction. First tick timestamp per hour is stored on first encounter. Last tick timestamp is overwritten on every tick (final value = last tick).</p>
        </div>
        <div style={cS}>{'if (hFirstTs[hr] === null) {\n  hFirstTs[hr] = tick.sip_timestamp;  // first tick in this hour\n}\nhLastTs[hr] = tick.sip_timestamp;  // always update (last wins)\n\n// Timestamps are nanoseconds from epoch\n// To convert: ms = ts > 1e15 ? ts/1e6 : ts > 1e12 ? ts/1e3 : ts'}</div>
      </div>
    </CollapseStage>
  </div>;
}

function FeaturesListPage(p){
  var fS={padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10};
  var cS={padding:'8px 10px',background:'#0a1018',borderRadius:4,border:'1px solid '+C.border,fontFamily:F,fontSize:8,color:C.txtDim,lineHeight:1.6,overflowX:'auto',whiteSpace:'pre-wrap',marginTop:6};

  var features=[
    {
      id:'F01',name:'Hour of Day',category:'Temporal',
      what:'The current ET hour (4-19) representing trading session position.',
      why:'Stage 2 data shows optimal TP% follows a strong session-based regime: pre-market favors wider TP% (0.30-0.80%), regular hours favor tight TP% (0.05-0.15%), post-market returns to medium. This is the single strongest predictor, explaining ~60% of TP% variance across all stocks.',
      calc:'Extract hour from tick timestamp. Convert UTC to ET (UTC-4 for EDT, UTC-5 for EST). Range: 4 (4AM) to 19 (7PM).',
      code:'var ms = ts > 1e15 ? ts/1e6 : ts > 1e12 ? ts/1e3 : ts;\nvar h = new Date(ms).getUTCHours() - 4;\nif (h < 0) h += 24;\n// h = ET hour (4-19 for trading hours)'
    },
    {
      id:'F02',name:'Day of Week',category:'Temporal',
      what:'Numeric day (1=Monday through 5=Friday). Markets closed Saturday/Sunday.',
      why:'Monday and Friday often show different volatility patterns than mid-week. Monday has overnight weekend gap effects. Friday has options expiration and position squaring. These affect oscillation frequency and optimal TP%.',
      calc:'Extract day of week from date. JavaScript getUTCDay() returns 0=Sunday, 1=Monday... 6=Saturday. Filter to 1-5.',
      code:'var dow = new Date(date + "T12:00:00Z").getUTCDay();\n// 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri'
    },
    {
      id:'F03',name:'Minutes Since Market Open',category:'Temporal',
      what:'Minutes elapsed since 9:30 AM ET market open. Negative for pre-market.',
      why:'The first 30 minutes after open (9:30-10:00) has dramatically different characteristics than mid-day. Volatility is highest at open, decays through the session, then spikes again at close. This granularity captures intra-hour effects that Hour alone misses.',
      calc:'Subtract 9:30 AM ET (570 minutes from midnight) from current time in minutes. Pre-market values are negative.',
      code:'var etMinutes = h * 60 + minutes;\nvar minsFromOpen = etMinutes - 570;\n// -330 at 4:00AM, 0 at 9:30AM, 390 at 4:00PM'
    },
    {
      id:'F04',name:'Previous Hour ATR%',category:'Volatility',
      what:'Average True Range as percentage of price for the prior completed hour.',
      why:'ATR% measures how much the stock oscillated in the previous hour. High ATR% means wide price swings, which typically correlates with wider optimal TP% (more room for targets). Low ATR% means tight range, favoring tighter TP% (more cycles at small targets). This is the primary volatility feature.',
      calc:'ATR% = (Hour High - Hour Low) / Hour Low * 100. Uses the completed previous hour, not current hour (lagged 1 hour to ensure availability at prediction time).',
      code:'// From cached_seasonality table or computed from ticks\nvar prevHourHigh = hourData[h-1].high;\nvar prevHourLow = hourData[h-1].low;\nvar atrPct = prevHourLow > 0\n  ? ((prevHourHigh - prevHourLow) / prevHourLow) * 100\n  : 0;'
    },
    {
      id:'F05',name:'Previous Hour ATR Dollar',category:'Volatility',
      what:'Absolute dollar range (High - Low) for the prior completed hour.',
      why:'While ATR% normalizes across price levels, ATR Dollar directly relates to the TP dollar amount. A $0.15 ATR on a $5 stock means different TP% math than $0.15 ATR on a $25 stock. Useful for computing whether a given TP% target is achievable within the hour range.',
      calc:'ATR$ = Hour High - Hour Low. From the completed previous hour.',
      code:'var atrDollar = prevHourHigh - prevHourLow;\n// Direct dollar range of prior hour'
    },
    {
      id:'F06',name:'Previous Hour Volume',category:'Volume',
      what:'Total share volume traded in the prior completed hour.',
      why:'Volume is a proxy for oscillation opportunity. High volume = more trades hitting price levels = more cycle completions possible. Stage 2 data shows an inverse correlation: hours with highest volume tend to have lowest optimal TP% (many small cycles beat fewer large ones when liquidity is deep).',
      calc:'Sum of all trade sizes in the previous hour. From cached_seasonality or computed from ticks.',
      code:'var prevVolume = hourData[h-1].volume;\n// Total shares traded in prior hour'
    },
    {
      id:'F07',name:'Previous Hour Trade Count',category:'Volume',
      what:'Number of individual trade executions in the prior completed hour.',
      why:'Trade count differs from volume because a single large block trade counts as one trade but high volume. High trade count with moderate volume suggests retail flow with many small orders -- ideal for grid bot oscillation. High volume with low trade count suggests institutional blocks -- less oscillation.',
      calc:'Count of trade ticks in the previous hour. From cached_seasonality or Polygon tick count.',
      code:'var prevTrades = hourData[h-1].trades;\n// Number of individual executions in prior hour'
    },
    {
      id:'F08',name:'Opening Price',category:'Price Position',
      what:'The first trade price of the day (4:00 AM ET pre-market or 9:30 AM regular).',
      why:'Opening price determines the pre-seed range and sets the baseline for all level calculations. The distance between current price and open indicates trend magnitude. Large gap from previous close signals overnight news flow which affects volatility regime.',
      calc:'Price of the first tick after 4:00 AM ET. From Polygon trades or cached_analyses.open_price.',
      code:'var openPrice = allTrades[0].price;\n// First trade of the day'
    },
    {
      id:'F09',name:'Overnight Gap %',category:'Price Position',
      what:'Percentage difference between today open and previous day close.',
      why:'Large gaps (>1%) indicate overnight news/earnings and typically lead to higher volatility in the first hours. Gap-up days may favor wider TP% early (trending) then tighter TP% as price stabilizes. Gap-down days often see mean-reversion which favors moderate TP%.',
      calc:'Gap% = (Today Open - Yesterday Close) / Yesterday Close * 100. Requires previous day OHLC data from Polygon.',
      code:'var gapPct = prevClose > 0\n  ? ((todayOpen - prevClose) / prevClose) * 100\n  : 0;\n// Positive = gap up, Negative = gap down'
    },
    {
      id:'F10',name:'Price vs Day Open',category:'Price Position',
      what:'Current price relative to day open, as percentage.',
      why:'Indicates whether the stock is trending (large deviation from open) or range-bound (close to open). Trending conditions favor wider TP% because price moves in one direction create longer cycle times. Range-bound conditions favor tighter TP% as price oscillates near open.',
      calc:'Deviation% = (Current Price - Open) / Open * 100. Positive = above open, negative = below.',
      code:'var priceVsOpen = openPrice > 0\n  ? ((currentPrice - openPrice) / openPrice) * 100\n  : 0;'
    },
    {
      id:'F11',name:'Intraday Range So Far',category:'Price Position',
      what:'Current day high minus low as percentage of low, computed up to the current moment.',
      why:'Cumulative intraday range indicates how active the day has been. Wide range-so-far suggests a volatile day where wider TP% may continue to be optimal. Narrow range suggests a quiet day where tight TP% maximizes cycle count.',
      calc:'Range% = (Day High So Far - Day Low So Far) / Day Low So Far * 100. Computed from all ticks up to current time.',
      code:'var dayHigh = -Infinity, dayLow = Infinity;\nfor (var i = 0; i < tradesUpToNow.length; i++) {\n  if (tradesUpToNow[i].price > dayHigh) dayHigh = tradesUpToNow[i].price;\n  if (tradesUpToNow[i].price < dayLow) dayLow = tradesUpToNow[i].price;\n}\nvar intradayRange = dayLow > 0\n  ? ((dayHigh - dayLow) / dayLow) * 100 : 0;'
    },
    {
      id:'F12',name:'Price Momentum (1-Hour)',category:'Momentum',
      what:'Price change over the last 60 minutes as percentage.',
      why:'Positive momentum suggests a trending market where price is moving directionally. Negative momentum suggests a pullback. The magnitude matters: strong momentum (>0.5%) often means wide TP% is optimal (ride the trend), while weak momentum (<0.1%) means tight TP% captures oscillation.',
      calc:'Momentum% = (Price Now - Price 1 Hour Ago) / Price 1 Hour Ago * 100. Sign indicates direction.',
      code:'var priceNow = latestTick.price;\nvar price1HrAgo = tickAtTime(now - 3600000).price;\nvar momentum1h = price1HrAgo > 0\n  ? ((priceNow - price1HrAgo) / price1HrAgo) * 100\n  : 0;'
    },
    {
      id:'F13',name:'Price Momentum (3-Hour)',category:'Momentum',
      what:'Price change over the last 3 hours as percentage.',
      why:'Captures medium-term trend that hour-level momentum might miss. A stock can oscillate hour-to-hour but still have a 3-hour directional trend. This longer window smooths out noise and identifies sustained trends vs mean-reversion setups.',
      calc:'Same as 1-hour momentum but over 3-hour window.',
      code:'var price3HrAgo = tickAtTime(now - 10800000).price;\nvar momentum3h = price3HrAgo > 0\n  ? ((priceNow - price3HrAgo) / price3HrAgo) * 100\n  : 0;'
    },
    {
      id:'F14',name:'VIX Level',category:'Cross-Asset',
      what:'CBOE Volatility Index current value. Measures market-wide implied volatility.',
      why:'VIX above 20 indicates elevated fear/uncertainty across all markets. High VIX = wider swings = wider TP% optimal. VIX below 15 = complacent market = tight TP%. This is a regime classifier: the same stock at the same hour behaves differently in high-VIX vs low-VIX environments.',
      calc:'Current VIX spot price. Fetched from Polygon or other data provider as a daily/hourly value.',
      code:'// Fetch VIX from Polygon\nvar vixUrl = "https://api.polygon.io/v2/aggs/ticker/"\n  + "VIX/prev?apiKey=" + apiKey;\nvar vixResp = await fetch(vixUrl);\nvar vixData = await vixResp.json();\nvar vixLevel = vixData.results[0].c; // close price'
    },
    {
      id:'F15',name:'Sector ETF Momentum',category:'Cross-Asset',
      what:'Intraday return of the relevant sector ETF (XLK for tech, XLE for energy, XLF for financials).',
      why:'Individual stocks correlate with their sector. If XLK is trending strongly, tech stocks like SOXL will likely trend too (favoring wider TP%). If the sector is flat, individual stock oscillation becomes more mean-reverting (favoring tighter TP%). Provides market context beyond the individual stock.',
      calc:'Sector Momentum% = (Current Sector ETF Price - Sector Open) / Sector Open * 100. Mapped per ticker: SOXL/NIO to XLK, CCL to consumer discretionary, etc.',
      code:'// Map ticker to sector ETF\nvar sectorMap = {\n  SOXL: "XLK", NIO: "XLK", TQQQ: "XLK",\n  CCL: "PEJ", LABU: "XLV"\n};\nvar sectorTicker = sectorMap[ticker] || "SPY";\n// Fetch sector OHLC from Polygon\nvar sectorMom = (sectorNow - sectorOpen) / sectorOpen * 100;'
    },
    {
      id:'F16',name:'Pre-Market Volume Ratio',category:'Volume',
      what:'Pre-market volume (4:00-9:30 AM) relative to the 5-day average pre-market volume.',
      why:'Unusually high pre-market volume signals catalyst (earnings, news, analyst upgrade). Catalyst days have different TP% profiles: typically wider TP% in early hours (big moves) transitioning to tighter TP% as the catalyst is absorbed. Normal pre-market = normal session profile.',
      calc:'Ratio = Today Pre-Market Volume / Avg(Last 5 Days Pre-Market Volume). Available after 9:30 AM.',
      code:'var todayPreVol = sessions.pre.vol;\nvar avgPreVol = historicalPreVols.reduce((a,b) => a+b, 0)\n  / historicalPreVols.length;\nvar preVolRatio = avgPreVol > 0\n  ? todayPreVol / avgPreVol : 1.0;'
    },
    {
      id:'F17',name:'Recent Volatility (5-Day ATR%)',category:'Volatility',
      what:'Average of daily ATR% over the last 5 trading days.',
      why:'Captures the stock volatility regime. A stock averaging 3% daily range is fundamentally different from one averaging 0.5%. This normalizes TP% expectations: high-volatility stocks can support wider TP% targets while still completing cycles. Low-volatility stocks need tight TP%.',
      calc:'Avg of (Daily High - Daily Low) / Daily Low * 100 over last 5 trading days. From cached_seasonality or Polygon daily OHLC.',
      code:'var dailyATRs = [];\nfor (var d = 0; d < 5; d++) {\n  var ohlc = await fetchOHLC(ticker, dates[d], apiKey);\n  if (ohlc && ohlc.low > 0)\n    dailyATRs.push(((ohlc.high - ohlc.low) / ohlc.low) * 100);\n}\nvar atr5d = dailyATRs.reduce((a,b) => a+b, 0)\n  / dailyATRs.length;'
    },
    {
      id:'F18',name:'Cycle Velocity (Previous Hour)',category:'Live System',
      what:'Number of completed buy-to-sell cycles per minute in the previous hour at the current TP%.',
      why:'Direct measure of how fast the grid bot is cycling. High velocity means the current TP% is producing rapid completions (good). Dropping velocity suggests conditions are changing and TP% should be adjusted. This is only available from the live trading system (Approach 2).',
      calc:'Cycles in Previous Hour / 60. Requires access to the live bot trade log in Redis.',
      code:'// From Beta system Redis trade log\nvar prevHourCycles = await redis.get(\n  "cycles:" + ticker + ":" + prevHour\n);\nvar cycleVelocity = prevHourCycles / 60;\n// cycles per minute'
    },
    {
      id:'F19',name:'Fill Rate (Previous Hour)',category:'Live System',
      what:'Percentage of limit orders that received fills in the previous hour.',
      why:'Simulation assumes 100% fill rate but reality differs. Unfilled buy orders at a level mean the price touched but did not trade through the level. Low fill rate indicates the simulation is overstating cycle potential. High fill rate validates the simulation accuracy for that hour.',
      calc:'Fill Rate% = Filled Orders / Total Placed Orders * 100. From Alpaca order history or Beta system logs.',
      code:'// From Alpaca API or Beta system\nvar filled = orders.filter(o => o.status === "filled").length;\nvar total = orders.length;\nvar fillRate = total > 0 ? (filled / total) * 100 : 0;'
    },
    {
      id:'F20',name:'Average Cycle Duration (Previous Hour)',category:'Live System',
      what:'Mean time in minutes between buy fill and sell fill for completed cycles in the previous hour.',
      why:'Short cycle duration (< 5 minutes) means the TP% target is being hit quickly, suggesting room to widen. Long cycle duration (> 30 minutes) means targets are barely being reached, suggesting TP% should be tightened. Duration is the missing dimension in pure cycle-count analysis.',
      calc:'Avg(Sell Timestamp - Buy Timestamp) for all completed cycles in the previous hour. From Beta system trade logs.',
      code:'// From Beta system trade records\nvar durations = completedCycles.map(c =>\n  (c.sellTime - c.buyTime) / 60000 // minutes\n);\nvar avgDuration = durations.reduce((a,b) => a+b, 0)\n  / durations.length;'
    }
  ];

  var categories=['Temporal','Volatility','Volume','Price Position','Momentum','Cross-Asset','Live System'];
  var catColors={'Temporal':C.gold,'Volatility':C.warn,'Volume':C.blue,'Price Position':C.accent,'Momentum':C.purple,'Cross-Asset':'#e090ff','Live System':'#ff9060'};

  return <div>
    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Features List</div>
    </div>
    <Cd glow={true}>
      <SectionHead title="Stage 3: Feature Catalog" sub={features.length+' features across '+categories.length+' categories'} info="Complete reference of all features (X variables) used in the correlation analysis. Each feature is a measurable market condition that may predict which TP% will be optimal. Features are grouped by category and ordered by data source availability."/>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.7,marginTop:8}}>
        <p style={{marginBottom:6}}>Each feature below includes: <span style={{color:C.accent}}>what it measures</span>, <span style={{color:C.gold}}>why it matters for TP% prediction</span>, <span style={{color:C.blue}}>how it is calculated</span>, and <span style={{color:C.purple}}>the code to generate it</span>.</p>
        <p style={{marginBottom:6}}>Features are designed to be <span style={{color:C.accent,fontWeight:700}}>lagged</span> -- they use data from the previous hour or earlier, never the current hour. This ensures they are available BEFORE the prediction is needed.</p>
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:8}}>
          {categories.map(function(cat){return <div key={cat} style={{fontSize:7,fontFamily:F,padding:'2px 8px',borderRadius:4,border:'1px solid '+(catColors[cat]||C.border),color:catColors[cat]||C.txt,fontWeight:600}}>{cat+' ('+features.filter(function(f){return f.category===cat;}).length+')'}</div>;})}
        </div>
      </div>
    </Cd>
    {features.map(function(f){
      return <Cd key={f.id}>
        <div style={{display:'flex',alignItems:'flex-start',gap:8,marginBottom:6}}>
          <div style={{fontSize:10,color:catColors[f.category]||C.accent,fontWeight:800,fontFamily:F,flexShrink:0,minWidth:30}}>{f.id}</div>
          <div>
            <div style={{color:C.txtBright,fontSize:11,fontWeight:700,fontFamily:F}}>{f.name}</div>
            <div style={{fontSize:7,color:catColors[f.category]||C.txtDim,fontFamily:F,fontWeight:600,letterSpacing:1,textTransform:'uppercase',marginTop:1}}>{f.category}</div>
          </div>
        </div>
        <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8}}>
          <div style={fS}>
            <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>What:</span> {f.what}</p>
            <p style={{marginBottom:4}}><span style={{color:C.gold,fontWeight:700}}>Why:</span> {f.why}</p>
            <p><span style={{color:C.blue,fontWeight:700}}>Calculation:</span> {f.calc}</p>
          </div>
          <div style={{fontSize:8,color:C.purple,fontWeight:700,fontFamily:F,marginBottom:2}}>Implementation Code:</div>
          <div style={cS}>{f.code}</div>
        </div>
      </Cd>;
    })}
  </div>;
}

function CorrAnalysisPage(p){
  return <div>
    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Correlation Analysis Logic</div>
    </div>
    <Cd glow={true}>
      <SectionHead title="Stage 3: Correlation and Coefficient Analysis" sub="Finding predictive signals for optimal TP% selection" info="Stage 3 uses two independent data sources to discover which observable market conditions predict the optimal take-profit percentage for each hour. The goal is to move from hindsight (Stage 2: what TP% SHOULD we have used?) to foresight (Stage 3: what TP% SHOULD we use next hour?)."/>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.7,marginTop:8,marginBottom:8}}>
        <p style={{marginBottom:6}}>Stage 2 produced the training data: for each ticker, each day, each hour, we know which TP% was optimal. Stage 3 asks: <span style={{color:C.accent,fontWeight:700}}>what market conditions at the time predicted that optimal TP%?</span></p>
        <p>Two independent approaches are used. Each provides a different lens on the same question, and their agreement or disagreement is itself a signal.</p>
      </div>
    </Cd>
    <Cd>
      <SectionHead title="Approach 1: Market Microstructure Features" sub="Correlating observable market data with optimal TP% from Polygon tick data"/>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Objective</p>
          <p style={{marginBottom:6}}>Find features from publicly observable market data (Polygon trade ticks, OHLC, volume) that correlate with which TP% produces the most cycles and profit in each hour. These features must be available BEFORE the hour starts, so they can be used for prediction.</p>
          <p style={{color:C.gold,fontWeight:700}}>Key question: what do we know at 9:59 AM that predicts the best TP% for the 10:00 AM hour?</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Candidate Features (X variables)</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.gold}}>Temporal:</span> Hour of day, day of week, minutes since market open. These capture the structural session-based TP% regime already observed in Stage 2 data (pre-market high TP%, RTH low TP%, post-market medium TP%).</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.gold}}>Lagged Volatility:</span> Previous hour ATR%, ATR dollar, high-low range. From cached_seasonality or computed from Polygon ticks. Measures how much the stock moved -- higher volatility typically correlates with wider optimal TP%.</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.gold}}>Lagged Volume:</span> Previous hour trade count and share volume. High volume = more oscillation = tighter TP% tends to be optimal (more cycles at smaller targets).</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.gold}}>Price Position:</span> Current price relative to day open, overnight gap size, distance from VWAP. Indicates whether the stock is trending or range-bound.</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.gold}}>Momentum Indicators:</span> Direction and magnitude of price change over prior 1-3 hours. Trending markets favor wider TP%, mean-reverting markets favor tighter TP%.</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.gold}}>Cross-Asset Signals:</span> VIX level, sector ETF momentum (XLK for tech, XLE for energy), broad market direction (SPY). Market-wide volatility regimes affect all stocks.</p>
          <p style={{paddingLeft:8}}><span style={{color:C.gold}}>Microstructure:</span> Bid-ask spread width, trade size distribution, proportion of odd-lot trades. These measure market quality and liquidity -- tighter spreads may enable tighter TP%.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Target Variable (Y)</p>
          <p style={{marginBottom:4}}>The optimal TP% for each hour, as determined by Stage 2 scanning. Specifically: the TP% value (0.01-1.00%) that produced the highest net profit for that ticker in that hour on that day.</p>
          <p>Source: optimal_tp_hourly table, filtered to the best TP% per hour (highest net_profit).</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Method</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.blue}}>Step 1:</span> Build a feature matrix. Each row = one ticker-day-hour. Columns = all candidate features + the optimal TP% (target). This requires joining optimal_tp_hourly with cached_seasonality and computing lagged features.</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.blue}}>Step 2:</span> Compute pairwise correlations (Pearson, Spearman) between each feature and the optimal TP%. Rank features by absolute correlation strength. Visualize as correlation heatmap.</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.blue}}>Step 3:</span> Train simple models (Decision Tree, LightGBM) to predict optimal TP% from the top features. Measure prediction accuracy vs naive baseline (just using hour-of-day alone).</p>
          <p style={{paddingLeft:8}}><span style={{color:C.blue}}>Step 4:</span> Feature importance analysis. Which features add predictive power beyond time-of-day? If none do, then the Stage 2 hourly schedule IS the model. If some do, those features become inputs to the Stage 4 live engine.</p>
        </div>
      </div>
    </Cd>
    <Cd>
      <SectionHead title="Approach 2: Live Trading System Analysis" sub="Mining the Beta Proprietary Trading System's executed trade data"/>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Objective</p>
          <p style={{marginBottom:6}}>Access the Beta Proprietary Trading System's actual executed trade database via API to analyze real trading performance. Unlike Approach 1 which uses simulated cycle counts from historical tick data, this approach uses actual fills, actual slippage, actual timing, and actual P&L from the live grid bot running on Alpaca Markets.</p>
          <p style={{color:C.gold,fontWeight:700}}>This is the ground truth -- what actually happened vs what the simulation predicted would happen.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Data Source</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.gold}}>System:</span> Live algorithmic grid trading bot on Alpaca Markets, written in Go with Redis trade log storage, running on GCP.</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.gold}}>Access:</span> API connection to the Beta system's Redis database or exported trade logs. Each trade record contains: ticker, entry price, exit price, entry time, exit time, shares, realized P&L, grid configuration ID, and range parameters.</p>
          <p style={{paddingLeft:8}}><span style={{color:C.gold}}>Coverage:</span> ~70 active grid configurations across leveraged ETFs (SOXL, TQQQ, LABU) and large-cap equities, using limit-only orders at $0.01 price increments.</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border,marginBottom:10}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>Analysis Dimensions</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.blue}}>Cycle Duration:</span> How long does each buy-to-sell cycle take? Distribution by hour, by ticker, by market conditions. Faster cycles = more compounding opportunity.</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.blue}}>Fill Rate:</span> What percentage of limit orders actually fill? Unfilled orders are invisible in tick simulation but critical in live execution. Fill rates by price level, time of day, and volatility regime.</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.blue}}>Slippage Analysis:</span> Difference between theoretical cycle profit (from simulation) and actual realized P&L. Identifies where the simulation over- or under-estimates reality.</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.blue}}>Range Migration:</span> When price moves away from an active range, positions become dormant. Frequency and duration of dormancy periods. Capital efficiency: what fraction of deployed capital is actively cycling vs sitting idle?</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.blue}}>Configuration Performance:</span> Across the ~70 configurations, which grid parameters (range width, TP%, capital per level) produce the best risk-adjusted returns? Identify the configurations that consistently outperform.</p>
          <p style={{paddingLeft:8}}><span style={{color:C.blue}}>Compounding Effectiveness:</span> The bot uses fractional compounding per completed cycle. Measure actual compound growth rate vs theoretical. Does compounding at $0.01 increments deliver meaningful capital growth over time?</p>
        </div>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>How This Connects to TP% Optimization</p>
          <p style={{marginBottom:4}}>The live system data provides calibration for the simulation. If the simulation says 0.17% TP is optimal but live execution shows 0.17% cycles take 45 minutes to complete while 0.25% cycles complete in 12 minutes, the effective profit rate (profit per unit time) may favor the wider TP%. This is invisible in pure cycle-count analysis.</p>
          <p>Approach 2 discovers characteristics like: which hours have the fastest cycle completion, where slippage is lowest, which configurations compound most effectively. These insights refine the TP% schedule from Approach 1 with real execution data.</p>
        </div>
      </div>
    </Cd>
    <Cd>
      <SectionHead title="Convergence: Where Both Approaches Meet" sub="Cross-validating simulation with reality"/>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:6,color:C.accent,fontWeight:700}}>The Two-Lens Framework</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.gold}}>Agreement:</span> When both approaches recommend the same TP% for an hour, confidence is high. The simulation and reality align.</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.warn}}>Disagreement:</span> When simulation says 0.17% but live data shows 0.30% performs better, the gap reveals execution effects (slippage, fill rates, timing) that the simulation misses.</p>
          <p style={{marginBottom:6,paddingLeft:8}}><span style={{color:C.blue}}>Calibration:</span> Use the disagreement to build a correction factor: adjusted_TP% = simulated_optimal_TP% x calibration_coefficient. This coefficient becomes a learned parameter that improves over time.</p>
          <p style={{color:C.accent,fontWeight:700}}>The final Stage 3 output is a feature-weighted TP% prediction model, calibrated against live execution data, ready for Stage 4 deployment.</p>
        </div>
      </div>
    </Cd>
  </div>;
}

function RawDataPage(p){
  var s1=useState('NIO'),ticker=s1[0],setTicker=s1[1];
  var s2=useState(''),startDate=s2[0],setStartDate=s2[1];
  var s2a=useState(''),endDate=s2a[0],setEndDate=s2a[1];
  var s3=useState(false),loading=s3[0],setLoading=s3[1];
  var s4=useState(null),err=s4[0],setErr=s4[1];
  var s5=useState(''),prog=s5[0],setProg=s5[1];
  var s6=useState(null),stats=s6[0],setStats=s6[1];
  var lS={color:C.txtDim,fontSize:8,fontWeight:600,letterSpacing:1,textTransform:'uppercase',fontFamily:F,marginBottom:4,display:'block'};
  var iS={width:'100%',background:C.bgInput,border:'1px solid '+C.border,borderRadius:6,color:C.txtBright,fontFamily:F,fontSize:12,fontWeight:600,padding:'10px 12px',outline:'none'};
  var bB={width:'100%',padding:'12px',border:'none',borderRadius:8,fontFamily:F,fontSize:11,fontWeight:700,letterSpacing:1.5,textTransform:'uppercase',cursor:'pointer'};

  var getTradingDays=function(start,end){
    var days=[];var d=new Date(start+'T12:00:00Z');var e=new Date(end+'T12:00:00Z');
    while(d<=e){var dow=d.getUTCDay();if(dow!==0&&dow!==6){days.push(d.toISOString().slice(0,10));}d.setUTCDate(d.getUTCDate()+1);}
    return days;
  };

  var run=async function(){
    if(!p.apiKey){setErr('No Polygon API key. Set in Settings.');return;}
    if(!startDate||!endDate){setErr('Set start and end dates');return;}
    var days=getTradingDays(startDate,endDate);
    if(!days.length){setErr('No trading days in range');return;}
    setLoading(true);setErr(null);setStats(null);
    try{
      var allTrades=[];var totalPages=0;
      for(var di=0;di<days.length;di++){
        var day=days[di];
        setProg('Day '+(di+1)+'/'+days.length+': '+day+' - Fetching...');
        var url='https://api.polygon.io/v3/trades/'+ticker.toUpperCase()+'?timestamp.gte='+day+'T04:00:00.000Z&timestamp.lt='+day+'T23:59:59.000Z&limit=50000&sort=timestamp&order=asc&apiKey='+p.apiKey;
        while(url){
          var r=await fetch(url);
          if(!r.ok)throw new Error('Polygon API error: '+r.status+' on '+day);
          var dj=await r.json();
          if(dj.results){
            for(var i=0;i<dj.results.length;i++){
              var trade=dj.results[i];
              trade._date=day;
              allTrades.push(trade);
            }
          }
          url=dj.next_url?(dj.next_url+'&apiKey='+p.apiKey):null;
          totalPages++;
          if(totalPages%3===0)setProg('Day '+(di+1)+'/'+days.length+': '+day+' - '+allTrades.length.toLocaleString()+' trades...');
        }
      }
      if(!allTrades.length){setErr('No trades found for '+ticker.toUpperCase()+' in date range');setLoading(false);return;}
      setProg('Building CSV with '+allTrades.length.toLocaleString()+' raw trades...');
      await new Promise(function(r){setTimeout(r,30);});
      // Build CSV with all raw fields
      var pages=totalPages;
      var headers=['date','sip_timestamp','participant_timestamp','trf_timestamp','price','size','exchange','conditions','id','correction','trf_id','sequence_number','tape'];
      var csvRows=[headers.join(',')];
      for(var j=0;j<allTrades.length;j++){
        var t=allTrades[j];
        var row=[
          t._date||'',
          t.sip_timestamp||'',
          t.participant_timestamp||'',
          t.trf_timestamp||'',
          t.price||'',
          t.size||'',
          t.exchange||'',
          t.conditions?('"'+t.conditions.join(';')+'"'):'',
          t.id||'',
          t.correction||'',
          t.trf_id||'',
          t.sequence_number||'',
          t.tape||''
        ];
        csvRows.push(row.join(','));
      }
      var csv=csvRows.join('\n');
      // Download
      var blob=new Blob([csv],{type:'text/csv'});
      var a=document.createElement('a');
      a.href=URL.createObjectURL(blob);
      a.download=ticker.toUpperCase()+'_raw_trades_'+startDate+'_to_'+endDate+'.csv';
      document.body.appendChild(a);a.click();document.body.removeChild(a);
      // Show stats
      var minP=Infinity,maxP=-Infinity,totalVol=0;
      for(var k=0;k<allTrades.length;k++){
        if(allTrades[k].price<minP)minP=allTrades[k].price;
        if(allTrades[k].price>maxP)maxP=allTrades[k].price;
        totalVol+=(allTrades[k].size||0);
      }
      var firstTs=allTrades[0].sip_timestamp||allTrades[0].participant_timestamp;
      var lastTs=allTrades[allTrades.length-1].sip_timestamp||allTrades[allTrades.length-1].participant_timestamp;
      var toTime=function(ts){var ms=ts>1e15?ts/1e6:ts>1e12?ts/1e3:ts;return new Date(ms).toISOString();};
      setStats({total:allTrades.length,pages:pages,minP:minP,maxP:maxP,totalVol:totalVol,firstTs:toTime(firstTs),lastTs:toTime(lastTs),fileSize:csv.length});
      setProg('');setLoading(false);
    }catch(e){setErr(e.message);setProg('');setLoading(false);}
  };

  return <div>
    <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
      <button onClick={p.onBack} style={{background:'transparent',border:'1px solid '+C.border,borderRadius:6,color:C.txt,fontFamily:F,fontSize:10,padding:'6px 12px',cursor:'pointer'}}>&#8592; Back</button>
      <div style={{color:C.txtBright,fontSize:13,fontWeight:700,letterSpacing:1.2,textTransform:'uppercase',fontFamily:F}}>Download Raw Data</div>
    </div>
    <Cd glow={true}>
      <SectionHead title="Raw Trade Tick Data" sub="Download unprocessed Polygon trade data as CSV" info="Downloads every individual trade execution reported by Polygon.io for the selected ticker and date. This is the raw, unfiltered source data exactly as it comes from the exchanges -- before any processing, filtering, or analysis by Alpha Quant. Use this for independent cross-verification of cycle counts, price levels, timestamps, and any other computed values in the app."/>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.7,marginTop:8,marginBottom:12}}>
        <p style={{marginBottom:6}}>This page pulls raw trade tick data directly from the <span style={{color:C.accent,fontWeight:700}}>Polygon.io /v3/trades</span> endpoint. Every single trade execution from all US stock exchanges (NYSE, NASDAQ, IEX, ARCA, BATS, etc.) is included -- no filtering, no aggregation, no modification.</p>
        <p style={{marginBottom:6}}>The downloaded CSV contains all fields returned by Polygon: SIP timestamp (nanosecond precision), participant timestamp, TRF timestamp, price (sub-penny), size (shares), exchange ID, trade conditions, sequence number, and tape. This is the same source data that powers every analysis in Alpha Quant.</p>
        <p style={{color:C.gold,fontWeight:700}}>Purpose: independent verification. Every cycle count, price level, and profit estimate in this app can be traced back to these raw ticks. Download the data, run your own analysis in Python, Excel, or any tool, and verify that the numbers match.</p>
      </div>
    </Cd>
    <Cd>
      <SectionHead title="Download Parameters" sub="Select ticker and date"/>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:10}}>
        <div><label style={lS}>Ticker</label><input value={ticker} onChange={function(e){setTicker(e.target.value.toUpperCase());}} style={iS}/></div>
        <div></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8,marginBottom:12}}>
        <div><label style={lS}>Start Date</label><input type="date" value={startDate} onChange={function(e){setStartDate(e.target.value);}} style={iS}/></div>
        <div><label style={lS}>End Date</label><input type="date" value={endDate} onChange={function(e){setEndDate(e.target.value);}} style={iS}/></div>
      </div>
      {startDate&&endDate&&!loading&&<div style={{color:C.txtDim,fontSize:9,fontFamily:F,marginBottom:8}}>{getTradingDays(startDate,endDate).length+' trading days in range'}</div>}
      <button onClick={run} disabled={loading} style={Object.assign({},bB,{background:loading?C.border:'linear-gradient(135deg,#3d9eff,#1a7aff)',color:loading?C.txtDim:'#fff'})}>{loading?'Downloading...':'Fetch & Download CSV'}</button>
      {prog&&<div style={{marginTop:8,color:C.blue,fontSize:10,fontFamily:F}}>{prog}</div>}
      {err&&<div style={{marginTop:8,padding:'8px 10px',background:C.warnDim,border:'1px solid #ff5c3a30',borderRadius:6,color:C.warn,fontSize:10}}>{err}</div>}
    </Cd>
    {stats&&<Cd>
      <SectionHead title="Download Complete" sub={ticker.toUpperCase()+' | '+startDate+' to '+endDate+' | '+stats.total.toLocaleString()+' trades'}/>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:10}}>
        <Mt label="Total Trades" value={stats.total.toLocaleString()} color={C.accent} size="lg"/>
        <Mt label="Pages Fetched" value={stats.pages} color={C.txt} size="lg"/>
        <Mt label="File Size" value={(stats.fileSize/1024).toFixed(0)+' KB'} color={C.blue} size="lg"/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:8}}>
        <Mt label="Low" value={'$'+stats.minP.toFixed(4)} color={C.warn} size="md"/>
        <Mt label="High" value={'$'+stats.maxP.toFixed(4)} color={C.accent} size="md"/>
        <Mt label="Volume" value={stats.totalVol.toLocaleString()} color={C.txt} size="md"/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:8}}>
        <Mt label="First Trade" value={stats.firstTs.slice(11,23)+' UTC'} color={C.txtDim} size="sm"/>
        <Mt label="Last Trade" value={stats.lastTs.slice(11,23)+' UTC'} color={C.txtDim} size="sm"/>
      </div>
    </Cd>}
    <Cd>
      <SectionHead title="CSV Column Reference" sub="All fields from Polygon /v3/trades endpoint"/>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>date</span> -- Trading date (YYYY-MM-DD) for multi-day downloads. Added by Alpha Quant for convenience.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>sip_timestamp</span> -- Nanosecond timestamp from the Securities Information Processor. This is the consolidated timestamp used by Alpha Quant for tick ordering.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>participant_timestamp</span> -- Nanosecond timestamp from the exchange that executed the trade. May differ slightly from SIP timestamp.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>trf_timestamp</span> -- Trade Reporting Facility timestamp. Present for OTC or TRF-reported trades.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>price</span> -- Execution price in USD. Sub-penny precision (e.g. $5.6753). This is the raw price used for BUY/SELL comparisons in the cycle engine.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>size</span> -- Number of shares in the trade execution.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>exchange</span> -- Numeric exchange ID (e.g. 4=NYSE, 11=NASDAQ, 12=IEX). Polygon maps all exchanges into a single stream.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>conditions</span> -- Trade condition codes (e.g. regular sale, odd lot, intermarket sweep). Semicolon-separated in CSV.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>id</span> -- Unique trade ID assigned by Polygon.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>correction</span> -- Correction indicator (0=normal, 1+ indicates corrected trade).</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>trf_id</span> -- Trade Reporting Facility ID for off-exchange trades.</p>
          <p style={{marginBottom:4}}><span style={{color:C.accent,fontWeight:700}}>sequence_number</span> -- Sequential trade number within the day from SIP.</p>
          <p><span style={{color:C.accent,fontWeight:700}}>tape</span> -- Consolidated tape (1=NYSE, 2=NYSE Arca/BATS, 3=NASDAQ).</p>
        </div>
      </div>
    </Cd>
    <Cd>
      <SectionHead title="Cross-Verification Guide" sub="How to independently verify Alpha Quant results"/>
      <div style={{color:C.txt,fontSize:9,fontFamily:F,lineHeight:1.8,marginTop:8}}>
        <div style={{padding:'10px 12px',background:C.bg,borderRadius:6,border:'1px solid '+C.border}}>
          <p style={{marginBottom:6,color:C.gold,fontWeight:700}}>The purpose of this app is total transparency and verifiability.</p>
          <p style={{marginBottom:4}}>Every number in Alpha Quant -- cycle counts, price levels, hourly distributions, profit estimates -- is derived from these raw trade ticks. Nothing is hidden, approximated, or rounded during analysis. The entire data pipeline is:</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.accent}}>1.</span> Raw ticks from Polygon (this download)</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.accent}}>2.</span> Cycle engine processes every tick sequentially (analyzePriceLevels)</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.accent}}>3.</span> Results displayed and cached in database</p>
          <p style={{marginBottom:6,paddingLeft:8}}><span style={{color:C.accent}}>4.</span> Profit estimates calculated client-side from cycle counts + user inputs</p>
          <p style={{marginBottom:4}}>To verify independently:</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.blue}}>Python:</span> Use the Cross-Verification script on the Core Logic page. Feed it the same raw ticks and compare cycle counts.</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.blue}}>Excel:</span> Sort by timestamp, walk through BUY/SELL rules manually for a single price level.</p>
          <p style={{marginBottom:4,paddingLeft:8}}><span style={{color:C.blue}}>CSV Upload:</span> Use the Verify Logic Data Upload page to replay the exact algorithm against your own CSV export.</p>
          <p style={{paddingLeft:8}}><span style={{color:C.blue}}>Trade Audit:</span> Use the trade-by-trade audit on the Cycles Analysis page to trace every individual BUY and SELL event with timestamps.</p>
        </div>
      </div>
    </Cd>
  </div>;
}

function App(){
  var AreaChart=RC.AreaChart||null,Area=RC.Area||null,XAxis=RC.XAxis||null,YAxis=RC.YAxis||null,CartesianGrid=RC.CartesianGrid||null,RTooltip=RC.Tooltip||null,ResponsiveContainer=RC.ResponsiveContainer||null;
  var hasCharts=!!RC.AreaChart;
  var rawTradesRef=useRef([]);
  var setPage=function(p){setPageRaw(p);window.location.hash=p;};
  useEffect(function(){
    var onPop=function(){var h=window.location.hash.slice(1);if(h)setPageRaw(h);else setPageRaw('main');};
    window.addEventListener('popstate',onPop);
    if(!window.location.hash)window.location.hash='main';
    return function(){window.removeEventListener('popstate',onPop);};
  },[]);
  var ss=useState(typeof sessionStorage!=='undefined'&&sessionStorage.getItem('aq_auth')==='1'?false:true),showSplash=ss[0],setShowSplash=ss[1];
  var ms=useState(false),menuOpen=ms[0],setMenuOpen=ms[1];
  var ps=useState(function(){var h=window.location.hash.slice(1);return h||'main';}),page=ps[0],setPageRaw=ps[1];
  var s2=useState('SOXL'),ticker=s2[0],setTicker=s2[1];
  var s3=useState(new Date().toISOString().split('T')[0]),date=s3[0],setDate=s3[1];
  var s4=useState('1'),tpStr=s4[0],setTpStr=s4[1];
  var s15=useState('all'),session=s15[0],setSession=s15[1];
  var s7=useState('Nhwwc_ZmcjbsOpCphwK2tPpsBLCUe02p'),pgKey=s7[0],setPgKey=s7[1];
  var s19=useState(SB_URL_DEFAULT),sbUrl=s19[0],setSbUrl=s19[1];
  var s20=useState(SB_KEY_DEFAULT),sbKey=s20[0],setSbKey=s20[1];
  var s8=useState(false),ld=s8[0],setLd=s8[1];
  var s9=useState(''),prog=s9[0],setProg=s9[1];
  var s10=useState(null),err=s10[0],setErr=s10[1];
  var s11=useState(null),result=s11[0],setResult=s11[1];
  var s12=useState([]),priceData=s12[0],setPriceData=s12[1];
  var s13=useState(0),tickCount=s13[0],setTickCount=s13[1];
  var s14=useState(null),ohlc=s14[0],setOhlc=s14[1];
  var s18=useState(''),dataSource=s18[0],setDataSource=s18[1];
  var s21=useState([]),hourlyCycles=s21[0],setHourlyCycles=s21[1];
  var s22=useState('1'),capPerLevel=s22[0],setCapPerLevel=s22[1];
  var s23=useState('0.005'),feePerCycle=s23[0],setFeePerCycle=s23[1];
  var s24=useState(null),optResults=s24[0],setOptResults=s24[1];
  var s25=useState(false),optScanning=s25[0],setOptScanning=s25[1];

  var loadFullData=async function(){
    if(!pgKey)return;
    setLd(true);setProg('Fetching full tick data...');
    try{
      var allTrades=[],url='https://api.polygon.io/v3/trades/'+ticker.toUpperCase()+'?timestamp.gte='+date+'T04:00:00.000Z&timestamp.lt='+date+'T23:59:59.000Z&limit=50000&sort=timestamp&order=asc&apiKey='+pgKey;
      var pages=0;
      while(url){var r2=await fetch(url);if(!r2.ok)throw new Error('API error');var d=await r2.json();if(d.results)for(var i=0;i<d.results.length;i++){var t=d.results[i];allTrades.push({price:t.price,size:t.size,ts:t.sip_timestamp||t.participant_timestamp});}url=d.next_url?(d.next_url+'&apiKey='+pgKey):null;pages++;setProg('Fetching... '+allTrades.length.toLocaleString()+' trades (page '+pages+')');}
      var filtered=allTrades;
      if(session==='rth'){filtered=allTrades.filter(function(t2){var tsR=t2.ts;var tsMs;if(tsR>1e15)tsMs=tsR/1e6;else if(tsR>1e12)tsMs=tsR/1e3;else tsMs=tsR;var d2=new Date(tsMs);var etMin=(d2.getUTCHours()-4)*60+d2.getUTCMinutes();if(etMin<0)etMin+=1440;return etMin>=570&&etMin<960;});}
      rawTradesRef.current=filtered;setTickCount(filtered.length);setPriceData(buildPriceData(filtered));setHourlyCycles(computeHourlyCycles(filtered,parseFloat(tpStr)||1));
      setDataSource('live');setProg('');
    }catch(e){setProg('Error: '+e.message);}finally{setLd(false);}
  };
  var run=async function(){
    if(!pgKey){setErr('Set your Polygon API key in Settings (tap menu)');return;}
    var tp=parseFloat(tpStr);if(!tp||tp<=0){setErr('Enter a valid take profit %');return;}
    setLd(true);setErr(null);setResult(null);setPriceData([]);setOhlc(null);setDataSource('');setHourlyCycles([]);setProg('Checking cache...');
    try{
      // Check Supabase cache first
      var cached=await SB.loadAnalysis(ticker.toUpperCase(),date,tp,session);
      if(cached){
        var ca=cached.analysis;
        var cachedLevels=cached.levels.map(function(l){return{price:parseFloat(l.level_price),target:parseFloat(l.target_price),cycles:l.cycles,active:false};});
        cachedLevels.sort(function(a,b){return b.cycles-a.cycles;});
        setResult({levels:cachedLevels,summary:{totalLevels:ca.total_levels,activeLevels:ca.active_levels,totalCycles:ca.total_cycles,tpPct:tp}});
        setTickCount(ca.total_trades);
        if(ca.ohlc_open)setOhlc({open:parseFloat(ca.ohlc_open),high:parseFloat(ca.ohlc_high),low:parseFloat(ca.ohlc_low),close:parseFloat(ca.ohlc_close),volume:parseInt(ca.ohlc_volume)});
        var cachedHC=await SB.loadHourlyCycles(ticker.toUpperCase(),date,tp,session);
        if(cachedHC)setHourlyCycles(cachedHC);
        setDataSource('cache');setProg('');setLd(false);return;
      }
      setProg('Fetching trades...');
      var allTrades=[],url='https://api.polygon.io/v3/trades/'+ticker.toUpperCase()+'?timestamp.gte='+date+'T04:00:00.000Z&timestamp.lt='+date+'T23:59:59.000Z&limit=50000&sort=timestamp&order=asc&apiKey='+pgKey;
      var pages=0;
      while(url){var r=await fetch(url);if(!r.ok)throw new Error('Polygon API error '+r.status);var d=await r.json();if(d.results)for(var i=0;i<d.results.length;i++){var t=d.results[i];allTrades.push({price:t.price,size:t.size,ts:t.sip_timestamp||t.participant_timestamp});}url=d.next_url?(d.next_url+'&apiKey='+pgKey):null;pages++;setProg('Fetching... '+allTrades.length.toLocaleString()+' trades (page '+pages+')');}
      if(!allTrades.length)throw new Error('No trades. Check ticker/date.');
      var filtered=allTrades;
      if(session==='rth'){
        filtered=allTrades.filter(function(t){var tsR=t.ts;var tsMs;if(tsR>1e15)tsMs=tsR/1e6;else if(tsR>1e12)tsMs=tsR/1e3;else tsMs=tsR;var d2=new Date(tsMs);var etMin=(d2.getUTCHours()-4)*60+d2.getUTCMinutes();if(etMin<0)etMin+=1440;return etMin>=570&&etMin<960;});
        if(!filtered.length)throw new Error('No trades in regular hours.');
      }
      rawTradesRef.current=filtered;setTickCount(filtered.length);
      var ohlcData=await fetchOHLC(ticker,date,pgKey);setOhlc(ohlcData);
      setProg('Analyzing '+filtered.length.toLocaleString()+' trades at '+tp+'% TP...');
      // Yield to UI before heavy computation
      await new Promise(function(r){setTimeout(r,50);});
      var res=analyzePriceLevels(filtered,tp);setResult(res);setPriceData(buildPriceData(filtered));setHourlyCycles(computeHourlyCycles(filtered,tp));
      setDataSource('polygon');
      // Compute min/max for saving
      var svMin=Infinity,svMax=-Infinity;for(var sv=0;sv<filtered.length;sv++){if(filtered[sv].price<svMin)svMin=filtered[sv].price;if(filtered[sv].price>svMax)svMax=filtered[sv].price;}
      var svOpen=Math.floor(filtered[0].price*100)/100;var svPSM=Math.round(svOpen*1.01*100)/100;
      res.summary.totalTrades=filtered.length;
      // Save to Supabase (async, don't block UI)
      SB.saveAnalysis(ticker.toUpperCase(),date,tp,session,res.summary,res.levels,ohlcData,svMin,svMax,svOpen,svPSM);
      SB.saveHourlyCycles(ticker.toUpperCase(),date,tp,session,computeHourlyCycles(filtered,tp));
      setProg('');
    }catch(e){setErr(e.message);setProg('');}finally{setLd(false);}
  };
  var menuItems=[{key:'objectives',label:'Objectives',icon:'\u25C9'},{key:'s1h',label:'Stage 1: Measurement',type:'header'},{key:'logic',label:'Core Logic',icon:'\u2261',indent:true},{key:'upload',label:'Verify Logic Data Upload',icon:'\u21E7',indent:true},{key:'main',label:'Cycles Analysis',icon:'\u2941',indent:true},{key:'seasonality',label:'Intraday Seasonality',icon:'\u2248',indent:true},{key:'trends',label:'Trend Analysis',icon:'\u2197',indent:true},{key:'optimal',label:'Optimal TP% Finder',icon:'\u2605',indent:true},{key:'s1div',type:'divider'},{key:'s2h',label:'Stage 2: Optimization',type:'header'},{key:'adaptive',label:'Adaptive Optimization Logic',icon:'\u2699',indent:true},{key:'hourlyopt',label:'Hourly Optimal TP% Finder',icon:'\u2606',indent:true},{key:'s2div',type:'divider'},{key:'s3h',label:'Stage 3: Correlation',type:'header'},{key:'corrlogic',label:'Correlation Analysis Logic',icon:'\u2263',indent:true},{key:'features',label:'Features List',icon:'\u2630',indent:true},{key:'builddata',label:'Build Data Set',icon:'\u25B7',indent:true},{key:'s3div',type:'divider'},{key:'batch',label:'Import Stock Data',icon:'\u25B6'},{key:'dbmanage',label:'Database Management',icon:'\u2630',indent:true},{key:'rawdata',label:'Download Raw Data',icon:'\u21E9',indent:true},{key:'source',label:'Source Code',icon:'\u2039\u203A'},{key:'settings',label:'Settings',icon:'\u2699'},{key:'logout',label:'Logout',icon:'\u2192'}];
  if(showSplash)return <Splash onDone={function(){setShowSplash(false);try{sessionStorage.setItem('aq_auth','1');}catch(e){}window.scrollTo(0,0);}}/>;
  return <div style={{background:C.bg,minHeight:'100vh',fontFamily:F,color:C.txt,padding:'12px 14px 80px',position:'relative',maxWidth:680,margin:'0 auto'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
      <div><div style={{color:C.txtBright,fontSize:14,fontWeight:800,letterSpacing:1.5}}>ALPHA QUANT</div><div style={{color:C.accent,fontSize:8,letterSpacing:1.5}}>BETA GROWTH HOLDINGS</div></div>
      <div style={{display:'flex',alignItems:'center',gap:6}}><LiveClock/><MenuIcon onClick={function(){setMenuOpen(!menuOpen);}}/></div>
    </div>
    <div style={{borderBottom:'1px solid '+C.border,marginBottom:12}}></div>
    <MenuDropdown open={menuOpen} items={menuItems} onSelect={function(k){if(k==='logout'){try{sessionStorage.removeItem('aq_auth');}catch(e){}setShowSplash(true);window.location.hash='';return;}setPage(k);}} onClose={function(){setMenuOpen(false);}}/>
    {page==='batch'&&<BatchPage apiKey={pgKey} onBack={function(){setPage('main');}}/>}
    {page==='corrlogic'&&<CorrAnalysisPage onBack={function(){setPage('objectives');}}/>}
    {page==='features'&&<FeaturesListPage onBack={function(){setPage('objectives');}}/>}
    {page==='builddata'&&<BuildDataSetPage apiKey={pgKey} onBack={function(){setPage('objectives');}}/>}
    {page==='rawdata'&&<RawDataPage apiKey={pgKey} onBack={function(){setPage('batch');}}/>}
    {page==='hourlyopt'&&<HourlyOptimalPage apiKey={pgKey} onBack={function(){setPage('main');}}/>}
    {page==='adaptive'&&<AdaptiveOptPage onBack={function(){setPage('main');}}/>}
    {page==='optimal'&&<OptimalTPPage apiKey={pgKey} onBack={function(){setPage('main');}}/>}
    {page==='trends'&&<TrendPage onBack={function(){setPage('main');}}/>}
    {page==='seasonality'&&<SeasonalityPage apiKey={pgKey} onBack={function(){setPage('main');}}/>}
    {page==='upload'&&<UploadPage tpPct={parseFloat(tpStr)||1} onBack={function(){setPage('main');}}/>}
    {page==='objectives'&&<ObjectivesPage onBack={function(){setPage('main');}}/> }
    {page==='dbmanage'&&<DbManagePage onBack={function(){setPage('main');}}/>}
    {page==='source'&&<SourcePage onBack={function(){setPage('main');}}/>}
    {page==='settings'&&<SettingsPage apiKey={pgKey} sbUrl={sbUrl} sbKey={sbKey} onSave={function(k){setPgKey(k);}} onSaveSb={function(u,k){setSbUrl(u);setSbKey(k);SB_URL=u;SB_KEY=k;}} onBack={function(){setPage('main');}}/>}
    {page==='logic'&&<LogicPage onBack={function(){setPage('main');}}/>}
    {page==='main'&&<div>
      {!pgKey&&<Cd style={{borderColor:C.warn}}><div style={{color:C.warn,fontSize:11,fontFamily:F,textAlign:'center'}}>No API key. Tap menu → Settings.</div></Cd>}
      <div style={{color:C.txt,fontSize:11,fontFamily:F,marginBottom:12,lineHeight:1.5}}>Enter ticker and parameters for the stock you'd like to analyze</div>
      <Cd>
        <SectionHead title="Parameters" sub="Ticker, date, take-profit %, capital, and fees" info="Enter the stock ticker, date, take-profit %, capital per level, and fee per cycle. The app fetches every trade that day, counts cycles at each $0.01 level, and estimates profit with proportional fractional share fees."/>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginTop:10,marginBottom:8}}>
          <div><label style={lS}>Ticker</label><input value={ticker} onChange={function(e){setTicker(e.target.value.toUpperCase());}} style={iS}/></div>
          <div><label style={lS}>Date</label><input type="date" value={date} onChange={function(e){setDate(e.target.value);}} style={iS}/></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:10}}>
          <div>
            <div style={{display:'flex',alignItems:'center',marginBottom:4}}><label style={Object.assign({},lS,{marginBottom:0})}>TP %</label><Info>The % gain needed to sell. 1% on $5.00 = sell at $5.06 (always rounds up to next penny). Smaller = more cycles, larger = fewer but bigger cycles.</Info></div>
            <input type="text" inputMode="decimal" value={tpStr} onChange={function(e){setTpStr(e.target.value);}} style={iS}/>
          </div>
          <div>
            <div style={{display:'flex',alignItems:'center',marginBottom:4}}><label style={Object.assign({},lS,{marginBottom:0})}>$/Level</label><Info>Capital allocated to each $0.01 price level. Each cycle earns $/Level x TP%. Change anytime to update profit estimates.</Info></div>
            <input type="text" inputMode="decimal" value={capPerLevel} onChange={function(e){setCapPerLevel(e.target.value);}} style={iS}/>
          </div>
          <div>
            <div style={{display:'flex',alignItems:'center',marginBottom:4}}><label style={Object.assign({},lS,{marginBottom:0})}>Fee/Cycle</label><Info>Per-share fee (e.g. $0.005/share commission). Automatically scaled by fractional quantity: if share is $5 and you buy $1 worth (0.2 shares), fee becomes $0.005 x 0.2 = $0.001 per cycle.</Info></div>
            <input type="text" inputMode="decimal" value={feePerCycle} onChange={function(e){setFeePerCycle(e.target.value);}} style={iS}/>
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <div style={{display:'flex',alignItems:'center',marginBottom:4}}><label style={Object.assign({},lS,{marginBottom:0})}>Session</label><Info>All Hours includes pre-market (4 AM), regular (9:30-4 PM), and after-hours. Regular Only limits to 9:30 AM - 4:00 PM ET when volume is highest.</Info></div>
          <div style={{display:'flex',gap:4}}>
            <button onClick={function(){setSession('all');}} style={Object.assign({},bB,{flex:1,padding:'7px 4px',fontSize:9,background:session==='all'?C.accentDim:'transparent',border:'1px solid '+(session==='all'?C.accent:C.border),color:session==='all'?C.accent:C.txt})}>All Hours</button>
            <button onClick={function(){setSession('rth');}} style={Object.assign({},bB,{flex:1,padding:'7px 4px',fontSize:9,background:session==='rth'?C.accentDim:'transparent',border:'1px solid '+(session==='rth'?C.accent:C.border),color:session==='rth'?C.accent:C.txt})}>Regular Only</button>
          </div>
          <div style={{color:C.txtDim,fontSize:8,fontFamily:F,marginTop:3}}>{session==='all'?'Pre-market + Regular + After hours':'9:30 AM - 4:00 PM ET'}</div>
        </div>
        <button onClick={run} disabled={ld} style={Object.assign({},bB,{background:ld?C.border:'linear-gradient(135deg,#00e5a0,#00c488)',color:ld?C.txtDim:C.bg})}>{ld?'Running...':'Analyze'}</button>
        {prog&&<div style={{marginTop:8,color:C.accent,fontSize:10}}>{prog}</div>}
        {err&&<div style={{marginTop:8,padding:'8px 10px',background:C.warnDim,border:'1px solid #ff5c3a30',borderRadius:6,color:C.warn,fontSize:10}}>{err}</div>}
      </Cd>
      {result&&<div>
        <Cd glow={true}>
          <SectionHead title="Results" sub={ticker+' · '+date+' · '+tpStr+'% TP'+(dataSource==='cache'?' · From Cache':dataSource==='polygon'?' · Live Data':'')} info="Total cycles across all levels, how many levels had at least one cycle, total levels in the price range, and how many individual trade ticks were analyzed."/>
          <div style={{display:'grid',gridTemplateColumns:'1fr',gap:4,marginTop:12,marginBottom:14}}>
            <Mt label="Total Cycles" value={result.summary.totalCycles} size="lg" color={C.accent}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
            <Mt label="Active Levels" value={result.summary.activeLevels} color={C.blue} size="md"/>
            <Mt label="All Levels" value={result.summary.totalLevels} color={C.purple} size="md"/>
            <Mt label="Trades" value={tickCount.toLocaleString()} color={C.txtDim} size="md"/>
          </div>
        </Cd>
        {result&&<Cd glow={true}>
          <div style={{display:'inline-block',background:C.goldDim,border:'1px solid '+C.gold,borderRadius:4,padding:'2px 8px',fontSize:7,color:C.gold,fontFamily:F,fontWeight:700,marginBottom:8,letterSpacing:0.5}}>PROFIT ESTIMATE @ {tpStr}% TP | ${capPerLevel}/LEVEL | ${feePerCycle} FEE</div>
          <SectionHead title="Profit Analysis" sub={ticker+' · '+date} info="Each cycle earns $/Level x TP% gross profit, minus a proportional per-share fee. The fee is scaled by fractional quantity: Fee x ($/Level / Share Price). This accounts for buying fractional shares when capital per level is less than the share price."/>
          {(function(){
            var cap=parseFloat(capPerLevel)||0;var tp2=parseFloat(tpStr)||0;var baseFee=parseFloat(feePerCycle)||0;
            var sharePrice=ohlc?ohlc.open:(result.summary.openPrice||0);
            var fracQty=sharePrice>0?(cap/sharePrice):0;
            var adjFee=baseFee*fracQty;
            var grossPerCycle=cap*(tp2/100);
            var netPerCycle=grossPerCycle-adjFee;
            var totalCy=result.summary.totalCycles;
            var grossTotal=totalCy*grossPerCycle;
            var totalFees=totalCy*adjFee;
            var netTotal=totalCy*netPerCycle;
            var activeLvls=result.summary.activeLevels;
            var capitalDeployed=activeLvls*cap;
            var roiPct=capitalDeployed>0?((netTotal/capitalDeployed)*100):0;
            return <div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:10}}>
                <Mt label="Share Price" value={sharePrice>0?'$'+sharePrice.toFixed(2):'-'} color={C.txt} size="md"/>
                <Mt label="Shares / Level" value={fracQty>0?fracQty.toFixed(4):'-'} color={C.txt} size="md"/>
                <Mt label="Adj Fee / Cycle" value={'$'+adjFee.toFixed(4)} color={C.warn} size="md"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:6}}>
                <Mt label="Gross / Cycle" value={'$'+grossPerCycle.toFixed(4)} color={C.gold} size="md"/>
                <Mt label="Fee / Cycle" value={'$'+adjFee.toFixed(4)} color={C.warn} size="md"/>
                <Mt label="Net / Cycle" value={'$'+netPerCycle.toFixed(4)} color={netPerCycle>0?C.accent:C.warn} size="md"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:6}}>
                <Mt label="Gross Profit" value={'$'+grossTotal.toFixed(2)} color={C.gold} size="md"/>
                <Mt label="Total Fees" value={'$'+totalFees.toFixed(2)} color={C.warn} size="md"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:6}}>
                <Mt label="Net Profit" value={'$'+netTotal.toFixed(2)} color={netTotal>0?C.accent:C.warn} size="lg"/>
                <Mt label="Net ROI" value={roiPct.toFixed(2)+'%'} color={roiPct>0?C.accent:C.warn} size="lg"/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:6}}>
                <Mt label="Total Cycles" value={totalCy} color={C.accent} size="md"/>
                <Mt label="Active Levels" value={activeLvls} color={C.blue} size="md"/>
                <Mt label="Capital Deployed" value={'$'+capitalDeployed.toLocaleString()} color={C.blue} size="md"/>
              </div>
            </div>;
          })()}
        </Cd>}
        {result&&rawTradesRef.current.length>0&&<Cd>
          <div style={{textAlign:'center'}}>
            <button onClick={function(){
              if(!rawTradesRef.current.length){setErr('Load full tick data first');return;}
              setOptScanning(true);setOptResults(null);
              setTimeout(function(){
                var cap=parseFloat(capPerLevel)||1;var fee=parseFloat(feePerCycle)||0.005;
                var scan=scanOptimalTP(rawTradesRef.current,cap,fee);
                setOptResults(scan);setOptScanning(false);
              },50);
            }} disabled={optScanning} style={Object.assign({},bB,{background:optScanning?C.border:'linear-gradient(135deg,#ffb020,#ff8800)',color:optScanning?C.txtDim:C.bg,width:'auto',padding:'10px 24px',display:'inline-block'})}>{optScanning?'Scanning TP% values...':'Find Optimal TP%'}</button>
            <div style={{color:C.txtDim,fontSize:8,fontFamily:F,marginTop:6}}>Scans viable TP% values from 0.05% to 1.00% based on share price</div>
          </div>
        </Cd>}
        {optResults&&optResults.results.length>0&&<Cd glow={true}>
          <div style={{display:'inline-block',background:C.goldDim,border:'1px solid '+C.gold,borderRadius:4,padding:'2px 8px',fontSize:7,color:C.gold,fontFamily:F,fontWeight:700,marginBottom:8,letterSpacing:0.5}}>OPTIMAL TP% SCAN | ${capPerLevel}/LEVEL | ${feePerCycle} FEE</div>
          <SectionHead title="Optimal Take Profit %" sub={ticker+' · '+date+' · Best: '+optResults.results[0].tpPct.toFixed(2)+'%'} info={"Scanned "+optResults.scanned+" TP% values from "+optResults.minTpPct.toFixed(2)+"% to 1.00%. Minimum viable TP% is "+optResults.minTpPct.toFixed(2)+"% because at $"+optResults.sharePrice.toFixed(2)+"/share, smaller values produce sell targets that round to the same penny as the entry (sub-penny trading is not possible)."}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:10}}>
            <Mt label="Best TP%" value={optResults.results[0].tpPct.toFixed(2)+'%'} color={C.gold} size="lg"/>
            <Mt label="Net Profit" value={'$'+optResults.results[0].netTotal.toFixed(2)} color={C.accent} size="lg"/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginTop:6}}>
            <Mt label="Cycles" value={optResults.results[0].cycles} color={C.accent} size="md"/>
            <Mt label="Net/Cycle" value={'$'+optResults.results[0].netPC.toFixed(4)} color={C.accent} size="md"/>
            <Mt label="Net ROI" value={optResults.results[0].roi.toFixed(2)+'%'} color={C.accent} size="md"/>
          </div>
          <div style={{marginTop:12,maxHeight:300,overflowY:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:8,fontFamily:F}}>
              <thead><tr style={{position:'sticky',top:0,background:C.bgCard}}>
                <th style={{padding:'4px 3px',color:'#a0b4c8',textAlign:'left'}}>Rank</th>
                <th style={{padding:'4px 3px',color:'#a0b4c8',textAlign:'right'}}>TP%</th>
                <th style={{padding:'4px 3px',color:'#a0b4c8',textAlign:'right'}}>TP $</th>
                <th style={{padding:'4px 3px',color:'#a0b4c8',textAlign:'right'}}>Cycles</th>
                <th style={{padding:'4px 3px',color:'#a0b4c8',textAlign:'right'}}>Net $</th>
                <th style={{padding:'4px 3px',color:'#a0b4c8',textAlign:'right'}}>ROI</th>
              </tr></thead>
              <tbody>{optResults.results.slice(0,20).map(function(r,idx){
                var isBest=idx===0;
                return <tr key={r.tpPct} style={{borderBottom:'1px solid '+C.grid,background:isBest?'rgba(255,176,32,0.08)':'transparent'}}>
                  <td style={{padding:'5px 3px',color:isBest?C.gold:C.txtDim}}>{idx+1}</td>
                  <td style={{padding:'5px 3px',color:isBest?C.gold:C.accent,textAlign:'right',fontWeight:isBest?700:400}}>{r.tpPct.toFixed(2)}%</td>
                  <td style={{padding:'5px 3px',color:C.gold,textAlign:'right'}}>{'$'+r.tpDollar.toFixed(2)}</td>
                  <td style={{padding:'5px 3px',color:C.txt,textAlign:'right'}}>{r.cycles}</td>
                  <td style={{padding:'5px 3px',color:r.netTotal>0?C.accent:C.warn,textAlign:'right',fontWeight:isBest?700:400}}>{'$'+r.netTotal.toFixed(2)}</td>
                  <td style={{padding:'5px 3px',color:r.roi>0?C.accent:C.warn,textAlign:'right'}}>{r.roi.toFixed(1)}%</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
          <div style={{color:C.txtDim,fontSize:7,fontFamily:F,marginTop:6,textAlign:'center'}}>{optResults.scanned} TP% values scanned (min viable: {optResults.minTpPct.toFixed(2)}% for ${optResults.sharePrice.toFixed(2)} stock)</div>
        </Cd>}
        {ohlc&&<Cd>
          <SectionHead title="Market Data" sub={ticker+' · '+date} info="Official exchange data. Open/High/Low/Close are regular session prices. Volume = total shares traded. Range = high minus low. ATR % = range as % of open price (volatility measure)."/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:6,marginTop:12,marginBottom:14}}>
            <Mt label="Open" value={'$'+ohlc.open.toFixed(2)} color={C.txtBright} size="md"/>
            <Mt label="High" value={'$'+ohlc.high.toFixed(2)} color={C.accent} size="md"/>
            <Mt label="Low" value={'$'+ohlc.low.toFixed(2)} color={C.warn} size="md"/>
            <Mt label="Close" value={'$'+ohlc.close.toFixed(2)} color={C.blue} size="md"/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
            <Mt label="Volume" value={Math.round(ohlc.volume).toLocaleString()} color={C.purple} size="md"/>
            <Mt label="Range" value={'$'+(ohlc.high-ohlc.low).toFixed(2)} color={C.gold} size="md"/>
            <Mt label="ATR %" value={((ohlc.high-ohlc.low)/ohlc.open*100).toFixed(2)+'%'} color={C.gold} size="md"/>
          </div>
        </Cd>}
        <PriceLevelTable levels={result.levels} summary={result.summary}/>
        {hasCharts&&priceData.length>0&&<Cd>
          <SectionHead title="Price Action" sub={ticker+' · '+date} info="Visual chart of the stock's price throughout the day. Each point is a trade tick (downsampled). Shows trend, volatility, and which price ranges saw the most activity."/>
          <div style={{marginTop:8}}><ResponsiveContainer width="100%" height={200}>
            <AreaChart data={priceData} margin={{top:5,right:5,bottom:5,left:-15}}>
              <CartesianGrid strokeDasharray="3 3" stroke={C.grid}/>
              <XAxis dataKey="time" tick={{fill:C.txtDim,fontSize:8,fontFamily:F}} interval={Math.max(0,Math.floor(priceData.length/6))}/>
              <YAxis domain={['auto','auto']} tick={{fill:C.txtDim,fontSize:8,fontFamily:F}} tickFormatter={function(v){return '$'+v.toFixed(2);}}/>
              <RTooltip contentStyle={{background:C.bgCard,border:'1px solid '+C.border,fontSize:10,fontFamily:F}}/>
              <Area type="monotone" dataKey="price" name="Price" stroke={C.blue} fill={C.blueDim} strokeWidth={1.5} dot={false}/>
            </AreaChart>
          </ResponsiveContainer></div>
        </Cd>}
                {rawTradesRef.current.length===0&&dataSource==='cache'&&<Cd>
          <div style={{textAlign:'center',padding:'12px 0'}}>
            <div style={{color:C.txtDim,fontSize:9,fontFamily:F,marginBottom:10}}>Cycles by hour, price chart, and trade-by-trade audit require full tick data. Cached results show cycle counts and levels only.</div>
            <button onClick={loadFullData} disabled={ld} style={Object.assign({},bB,{background:'transparent',border:'1px solid '+C.accent,color:C.accent,width:'auto',padding:'8px 20px',display:'inline-block'})}>{ld?'Loading...':'Load Full Tick Data'}</button>
          </div>
        </Cd>}
        {hourlyCycles.length>0&&<Cd glow={true}>
          <div style={{display:'inline-block',background:C.accentDim,border:'1px solid '+C.accent,borderRadius:4,padding:'2px 8px',fontSize:7,color:C.accent,fontFamily:F,fontWeight:700,marginBottom:8,letterSpacing:0.5}}>CYCLE DATA @ {tpStr}% TAKE PROFIT</div>
          <SectionHead title="Cycles by Hour" sub={ticker+' · '+date} info="Shows how many completed buy-to-sell cycles occurred in each hour at the specified take-profit percentage. This data is specific to the TP% used -- different TP% values produce different cycle distributions. Bar scale uses square root to keep small values visible when one hour dominates."/>
          <div style={{marginTop:8}}>{hourlyCycles.map(function(d){
            var maxCy=0;for(var q=0;q<hourlyCycles.length;q++){if(hourlyCycles[q].cycles>maxCy)maxCy=hourlyCycles[q].cycles;}
            var pct=maxCy>0?(Math.sqrt(d.cycles)/Math.sqrt(maxCy)*100):0;
            return <div key={d.hour} style={{display:'flex',alignItems:'center',marginBottom:2}}>
              <div style={{width:36,fontSize:7,color:'#c0d4e8',fontFamily:F,textAlign:'right',paddingRight:4,flexShrink:0}}>{d.hour}</div>
              <div style={{flex:1,position:'relative',height:18}}>
                <div style={{position:'absolute',left:0,top:2,bottom:2,width:pct+'%',background:d.isRTH?C.accent:'#506878',borderRadius:'0 3px 3px 0',minWidth:d.cycles>0?4:0}}></div>
              </div>
              <div style={{width:36,fontSize:9,color:d.cycles>0?'#ffffff':'#3a4a5a',fontFamily:F,textAlign:'right',paddingLeft:4,fontWeight:700,flexShrink:0}}>{d.cycles>0?d.cycles:''}</div>
            </div>;})}
          </div>
          <div style={{display:'flex',justifyContent:'space-between',marginTop:6,padding:'6px 0',borderTop:'1px solid '+C.border}}>
            <div style={{fontSize:8,color:'#8a9aaa',fontFamily:F}}>Total: <span style={{color:C.accent,fontWeight:700}}>{hourlyCycles.reduce(function(a,b){return a+b.cycles;},0)}</span></div>
            <div style={{fontSize:8,color:'#8a9aaa',fontFamily:F}}>Peak: <span style={{color:C.accent,fontWeight:700}}>{(function(){var mx=0,mh='';for(var q=0;q<hourlyCycles.length;q++){if(hourlyCycles[q].cycles>mx){mx=hourlyCycles[q].cycles;mh=hourlyCycles[q].hour;}}return mx+' ('+mh+')';})()}</span></div>
          </div>
        </Cd>}
        {rawTradesRef.current.length>0&&<TradeAudit trades={rawTradesRef.current} tpPct={parseFloat(tpStr)||1}/>}
      </div>}
    </div>}
    <div style={{textAlign:'center',padding:'16px 0',color:C.txtDim,fontSize:7,letterSpacing:1.5}}>ALPHA QUANT ANALYTICS · BETA GROWTH HOLDINGS · EDGE DETECTION</div>
  </div>;
}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
