#!/usr/bin/env node
// Alpha Quant Analytics - Automated Pipeline
// Usage:
//   node pipeline.js --nightly --tickers ONON,CCL
//   node pipeline.js --hourly --tickers ONON,CCL
//
// Environment variables required:
//   POLYGON_API_KEY  - Polygon.io developer plan API key
//   SUPABASE_URL     - Supabase project URL
//   SUPABASE_KEY     - Supabase anon key

const POLYGON_KEY = process.env.POLYGON_API_KEY;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
const CAP_PER_LEVEL = 200;
const FEE_PER_SHARE = 0.005;

// ── Timezone ─────────────────────────────────────────────
const _etFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
function getETHourFromMs(ms) { return parseInt(_etFmt.format(new Date(ms))); }
function getETOffset(dateStr) {
  var d = new Date(dateStr + 'T12:00:00Z');
  var fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, year: 'numeric', month: 'numeric', day: 'numeric' });
  var parts = fmt.formatToParts(d);
  var utcH = d.getUTCHours(), etH = 0;
  for (var p of parts) { if (p.type === 'hour') etH = parseInt(p.value); }
  var off = utcH - etH; if (off < 0) off += 24;
  return off;
}
function toETHour(ts) { var ms; if (ts > 1e15) ms = ts / 1e6; else if (ts > 1e12) ms = ts / 1e3; else ms = ts; return getETHourFromMs(ms); }

// ── Supabase helpers ─────────────────────────────────────
function sbHeaders() { return { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Prefer': 'return=representation' }; }

async function sbFetch(path, opts) {
  var r = await fetch(SB_URL + '/rest/v1/' + path, Object.assign({ headers: sbHeaders() }, opts || {}));
  if (!r.ok) { var t = await r.text(); throw new Error('Supabase error ' + r.status + ': ' + t); }
  return r.json();
}

async function sbFetchPaginated(path) {
  var all = [], offset = 0;
  while (true) {
    var sep = path.includes('?') ? '&' : '?';
    var rows = await sbFetch(path + sep + 'limit=1000&offset=' + offset);
    if (!rows.length) break;
    all = all.concat(rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return all;
}

async function sbUpsert(table, rows) {
  // Delete then insert (PATCH unreliable)
  var h = sbHeaders();
  h['Prefer'] = 'return=minimal';
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    await fetch(SB_URL + '/rest/v1/' + table, { method: 'POST', headers: Object.assign({}, h, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(batch) });
  }
}

// ── Core Engine (must match app exactly) ─────────────────
function analyzePriceLevels(trades, tpPct) {
  if (!trades.length) return { levels: [], summary: {} };
  var tf = tpPct / 100;
  var minP = Infinity, maxP = -Infinity;
  for (var z = 0; z < trades.length; z++) { if (trades[z].price < minP) minP = trades[z].price; if (trades[z].price > maxP) maxP = trades[z].price; }
  var minLvl = Math.floor(minP * 100) / 100, maxLvl = Math.ceil(maxP * 100) / 100;
  var openLvl = Math.floor(trades[0].price * 100) / 100;
  var preSeedMax = Math.round(openLvl * 1.01 * 100) / 100;
  var minCents = Math.round(minLvl * 100), maxCents = Math.round(maxLvl * 100);
  var count = maxCents - minCents + 1;
  var lvlActive = new Uint8Array(count);
  var lvlCycles = new Int32Array(count);
  var lvlTarget = new Float64Array(count);
  var lvlPrice = new Float64Array(count);
  var openCents = Math.round(openLvl * 100);
  var preSeedMaxCents = Math.round(preSeedMax * 100);
  for (var c = 0; c < count; c++) {
    lvlPrice[c] = (minCents + c) / 100;
    lvlTarget[c] = Math.ceil(lvlPrice[c] * (1 + tf) * 100) / 100;
    lvlActive[c] = (minCents + c >= openCents && minCents + c <= preSeedMaxCents) ? 1 : 0;
  }
  for (var i = 1; i < trades.length; i++) {
    var p = trades[i].price;
    for (var j = 0; j < count; j++) { if (lvlActive[j] === 1 && p >= lvlTarget[j]) { lvlCycles[j]++; lvlActive[j] = 0; } }
    var idx = Math.floor(p * 100) - minCents;
    if (idx >= 0 && idx < count && lvlActive[idx] === 0) lvlActive[idx] = 1;
  }
  var totalCycles = 0, activeLevels = 0;
  var levels = [];
  for (var c2 = 0; c2 < count; c2++) { totalCycles += lvlCycles[c2]; if (lvlCycles[c2] > 0) { activeLevels++; levels.push({ price: lvlPrice[c2], target: lvlTarget[c2], cycles: lvlCycles[c2] }); } }
  return { levels, summary: { totalLevels: count, activeLevels, totalCycles, tpPct } };
}

function computeHourlyCycles(trades, tpPct) {
  if (!trades || trades.length < 2) return {};
  var tf = tpPct / 100;
  var minP = Infinity, maxP = -Infinity;
  for (var i = 0; i < trades.length; i++) { if (trades[i].price < minP) minP = trades[i].price; if (trades[i].price > maxP) maxP = trades[i].price; }
  var minC = Math.round(Math.floor(minP * 100) / 100 * 100), maxC = Math.round(Math.ceil(maxP * 100) / 100 * 100), cnt = maxC - minC + 1;
  var openC = Math.round(Math.floor(trades[0].price * 100) / 100 * 100), psC = Math.round(Math.round(Math.floor(trades[0].price * 100) / 100 * 1.01 * 100) / 100 * 100);
  var active = new Uint8Array(cnt), target = new Float64Array(cnt);
  for (var c = 0; c < cnt; c++) { target[c] = Math.ceil((minC + c) / 100 * (1 + tf) * 100) / 100; active[c] = (minC + c >= openC && minC + c <= psC) ? 1 : 0; }
  var hourCycles = {}; for (var h = 4; h < 20; h++) hourCycles[h] = 0;
  for (var i2 = 1; i2 < trades.length; i2++) {
    var p = trades[i2].price; var hr = toETHour(trades[i2].ts);
    for (var j = 0; j < cnt; j++) { if (active[j] === 1 && p >= target[j]) { active[j] = 0; if (hourCycles[hr] !== undefined) hourCycles[hr]++; } }
    var idx = Math.floor(p * 100) - minC; if (idx >= 0 && idx < cnt && active[idx] === 0) active[idx] = 1;
  }
  return hourCycles;
}

function computeCycleHoldTimes(trades, tpPct) {
  if (!trades || trades.length < 2) return [];
  var tf = tpPct / 100;
  var minP = Infinity, maxP = -Infinity;
  for (var i = 0; i < trades.length; i++) { if (trades[i].price < minP) minP = trades[i].price; if (trades[i].price > maxP) maxP = trades[i].price; }
  var minC = Math.round(Math.floor(minP * 100) / 100 * 100), maxC = Math.round(Math.ceil(maxP * 100) / 100 * 100), cnt = maxC - minC + 1;
  var openC = Math.round(Math.floor(trades[0].price * 100) / 100 * 100), psC = Math.round(Math.round(Math.floor(trades[0].price * 100) / 100 * 1.01 * 100) / 100 * 100);
  var active = new Uint8Array(cnt), target = new Float64Array(cnt), buyMs = new Float64Array(cnt);
  var t0 = trades[0].ts; var t0ms = t0 > 1e15 ? t0 / 1e6 : t0 > 1e12 ? t0 / 1e3 : t0;
  for (var c = 0; c < cnt; c++) { target[c] = Math.ceil((minC + c) / 100 * (1 + tf) * 100) / 100; if (minC + c >= openC && minC + c <= psC) { active[c] = 1; buyMs[c] = t0ms; } }
  var hourDur = {}; for (var h = 4; h < 20; h++) hourDur[h] = [];
  for (var i2 = 1; i2 < trades.length; i2++) {
    var p = trades[i2].price; var ts = trades[i2].ts; var ms = ts > 1e15 ? ts / 1e6 : ts > 1e12 ? ts / 1e3 : ts;
    var hr = getETHourFromMs(ms);
    for (var j = 0; j < cnt; j++) { if (active[j] === 1 && p >= target[j]) { active[j] = 0; if (hr >= 4 && hr < 20 && buyMs[j] > 0) { var dur = (ms - buyMs[j]) / 60000; if (dur > 0 && dur < 960) hourDur[hr].push(dur); } buyMs[j] = 0; } }
    var idx = Math.floor(p * 100) - minC; if (idx >= 0 && idx < cnt && active[idx] === 0) { active[idx] = 1; buyMs[idx] = ms; }
  }
  var result = [];
  for (var h2 = 4; h2 < 20; h2++) {
    var durations = hourDur[h2]; var avg = 0, mn = 0, mx = 0, cnt2 = durations.length;
    if (cnt2 > 0) { var sum = 0; mn = Infinity; mx = -Infinity; for (var d = 0; d < cnt2; d++) { sum += durations[d]; if (durations[d] < mn) mn = durations[d]; if (durations[d] > mx) mx = durations[d]; } avg = sum / cnt2; }
    result.push({ hour: h2, avg: Math.round(avg * 10) / 10, min: Math.round(mn * 10) / 10, max: Math.round(mx * 10) / 10, count: cnt2 });
  }
  return result;
}

// ── Polygon fetch ────────────────────────────────────────
async function fetchTicks(ticker, date) {
  var etOff = getETOffset(date);
  var pad = function(n) { return String(n).padStart(2, '0'); };
  var nextDay = new Date(new Date(date + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  var hPre = 4 + etOff, hMid = 10 + etOff, hAft = 15 + etOff, hEnd = 20 + etOff;
  var wEndTs = hEnd < 24 ? date + 'T' + pad(hEnd) + ':30:00Z' : nextDay + 'T' + pad(hEnd - 24) + ':30:00Z';
  var windows = [
    { from: date + 'T' + pad(hPre) + ':00:00Z', to: date + 'T' + pad(hMid + 2) + ':00:00Z' },
    { from: date + 'T' + pad(hMid - 1) + ':00:00Z', to: date + 'T' + pad(hAft + 2) + ':00:00Z' },
    { from: date + 'T' + pad(hAft - 1) + ':00:00Z', to: wEndTs }
  ];
  var allRaw = [];
  for (var w of windows) {
    var url = 'https://api.polygon.io/v3/trades/' + ticker + '?timestamp.gte=' + w.from + '&timestamp.lt=' + w.to + '&limit=50000&sort=timestamp&order=asc&apiKey=' + POLYGON_KEY;
    while (url) {
      var r = await fetch(url);
      if (!r.ok) break;
      var d = await r.json();
      if (d.results) for (var t of d.results) allRaw.push({ price: t.price, size: t.size, ts: t.sip_timestamp });
      url = d.next_url ? d.next_url + '&apiKey=' + POLYGON_KEY : null;
    }
    await sleep(200);
  }
  // Dedup by timestamp
  allRaw.sort((a, b) => a.ts - b.ts);
  var trades = []; var lastTs = null;
  for (var t2 of allRaw) { if (t2.ts !== lastTs) { trades.push(t2); lastTs = t2.ts; } }
  return trades;
}

async function fetchHourlyTicks(ticker, date, hour) {
  // Fetch just 1 hour of ticks
  var etOff = getETOffset(date);
  var pad = function(n) { return String(n).padStart(2, '0'); };
  var nextDay = new Date(new Date(date + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
  var utcStart = hour + etOff;
  var utcEnd = utcStart + 1;
  var fromTs = utcStart < 24 ? date + 'T' + pad(utcStart) + ':00:00Z' : nextDay + 'T' + pad(utcStart - 24) + ':00:00Z';
  var toTs = utcEnd < 24 ? date + 'T' + pad(utcEnd) + ':00:00Z' : nextDay + 'T' + pad(utcEnd - 24) + ':00:00Z';
  var allRaw = [];
  var url = 'https://api.polygon.io/v3/trades/' + ticker + '?timestamp.gte=' + fromTs + '&timestamp.lt=' + toTs + '&limit=50000&sort=timestamp&order=asc&apiKey=' + POLYGON_KEY;
  while (url) {
    var r = await fetch(url);
    if (!r.ok) break;
    var d = await r.json();
    if (d.results) for (var t of d.results) allRaw.push({ price: t.price, size: t.size, ts: t.sip_timestamp });
    url = d.next_url ? d.next_url + '&apiKey=' + POLYGON_KEY : null;
  }
  allRaw.sort((a, b) => a.ts - b.ts);
  return allRaw;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Feature Extraction (single hour) ─────────────────────
function extractHourlyFeatures(trades, ticker, date, hour) {
  if (!trades.length) return null;
  var hOpen = trades[0].price, hClose = trades[trades.length - 1].price;
  var hHigh = -Infinity, hLow = Infinity, hVol = 0, hTrades = trades.length;
  var vwapNum = 0, prevPrice = null, prevRet = null;
  var sumAbsMove = 0, sumSqRet = 0, sumRet = 0, retCount = 0;
  var upTicks = 0, downTicks = 0, reversals = 0, lastDir = 0;
  var runHigh = -Infinity, maxDD = 0;
  var acSumXY = 0, acSumX = 0, acSumY = 0, acSumX2 = 0, acSumY2 = 0, acN = 0;
  var runDir = 0, runLen = 0, upRunSum = 0, upRunCnt = 0, downRunSum = 0, downRunCnt = 0, totalRuns = 0;
  var runStartPrice = null, runExcursions = [], upExcursions = [], downExcursions = [];
  var retArr = [];
  var entUp = 0, entDown = 0, entFlat = 0;
  var ofiSum = 0, ofiVol = 0;
  var priceLevels = {};
  var r2N = 0, r2SumX = 0, r2SumY = 0, r2SumXY = 0, r2SumX2 = 0, r2SumY2 = 0;
  var first15High = -Infinity, first15Low = Infinity, first15Set = false;

  for (var i = 0; i < trades.length; i++) {
    var price = trades[i].price, size = trades[i].size;
    if (price > hHigh) hHigh = price;
    if (price < hLow) hLow = price;
    hVol += size;
    vwapNum += price * size;

    if (prevPrice !== null) {
      var move = price - prevPrice;
      sumAbsMove += Math.abs(move);
      if (prevPrice > 0) {
        var ret = price / prevPrice - 1;
        sumSqRet += ret * ret; sumRet += ret; retCount++;
        if (retArr.length < 10000) retArr.push(ret);
        if (prevRet !== null) { acSumXY += prevRet * ret; acSumX += prevRet; acSumY += ret; acSumX2 += prevRet * prevRet; acSumY2 += ret * ret; acN++; }
        prevRet = ret;
      }
      if (move > 0) { upTicks++; entUp++; ofiSum += size; }
      else if (move < 0) { downTicks++; entDown++; ofiSum -= size; }
      else { entFlat++; }
      ofiVol += size;
      var dir = move > 0 ? 1 : (move < 0 ? -1 : 0);
      if (dir !== 0 && lastDir !== 0 && dir !== lastDir) reversals++;
      if (dir !== 0) lastDir = dir;
      // Run tracking
      if (dir !== 0) {
        if (dir === runDir) { runLen++; }
        else {
          if (runLen > 0) {
            totalRuns++;
            if (runDir === 1) { upRunSum += runLen; upRunCnt++; } else if (runDir === -1) { downRunSum += runLen; downRunCnt++; }
            if (runStartPrice !== null && runStartPrice > 0) {
              var exc = Math.abs(prevPrice - runStartPrice) / runStartPrice * 100;
              runExcursions.push(exc);
              if (runDir === 1) upExcursions.push(exc); else downExcursions.push(exc);
            }
          }
          runDir = dir; runLen = 1; runStartPrice = prevPrice;
        }
      }
    }
    prevPrice = price;
    // R2
    r2SumX += r2N; r2SumY += price; r2SumXY += r2N * price; r2SumX2 += r2N * r2N; r2SumY2 += price * price; r2N++;
    // Price levels
    var pKey = Math.round(price * 10000);
    if (!priceLevels[pKey]) priceLevels[pKey] = 1;
    // Running high + drawdown
    if (price > runHigh) runHigh = price;
    if (runHigh > 0) { var dd = (runHigh - price) / runHigh * 100; if (dd > maxDD) maxDD = dd; }
    // First 15min
    if (!first15Set && i > 0) {
      var ft = trades[0].ts, ct = trades[i].ts;
      var elMs = ft > 1e15 ? (ct - ft) / 1e6 : ft > 1e12 ? (ct - ft) / 1e3 : ct - ft;
      if (elMs <= 900000) { if (price > first15High) first15High = price; if (price < first15Low) first15Low = price; }
      else first15Set = true;
    }
  }

  // Flush last run
  if (runLen > 0) {
    totalRuns++;
    if (runDir === 1) { upRunSum += runLen; upRunCnt++; } else if (runDir === -1) { downRunSum += runLen; downRunCnt++; }
    if (runStartPrice && runStartPrice > 0) { runExcursions.push(Math.abs(hClose - runStartPrice) / runStartPrice * 100); }
  }

  var atrD = hHigh - hLow;
  var atrP = hLow > 0 ? (atrD / hLow) * 100 : 0;
  var vwap = hVol > 0 ? vwapNum / hVol : hClose;
  var realizedVol = null;
  if (retCount > 1) { var meanRet = sumRet / retCount; var variance = (sumSqRet - retCount * meanRet * meanRet) / (retCount - 1); realizedVol = Math.sqrt(Math.max(0, variance)) * 100; }
  var tickVol = hTrades > 1 ? (sumAbsMove / (hTrades - 1) * 100) : null;
  var returnPct = hOpen > 0 ? ((hClose - hOpen) / hOpen * 100) : null;
  var autoCorr = null;
  if (acN >= 10) { var acNum = acN * acSumXY - acSumX * acSumY; var acD1 = acN * acSumX2 - acSumX * acSumX; var acD2 = acN * acSumY2 - acSumY * acSumY; if (acD1 > 0 && acD2 > 0) autoCorr = acNum / Math.sqrt(acD1 * acD2); }
  // Hurst
  var hurstExp = null;
  if (retArr.length >= 50) {
    var windows = [8, 16, 32]; if (retArr.length >= 128) windows.push(64); if (retArr.length >= 256) windows.push(128);
    var logRS = [], logN = [];
    for (var wi = 0; wi < windows.length; wi++) {
      var wSz = windows[wi]; if (wSz > retArr.length) continue;
      var numW = Math.floor(retArr.length / wSz), rsSum = 0, rsCount = 0;
      for (var wj = 0; wj < numW; wj++) {
        var wStart = wj * wSz, wMean = 0;
        for (var wk = wStart; wk < wStart + wSz; wk++) wMean += retArr[wk]; wMean /= wSz;
        var cumDev = 0, cumMin = Infinity, cumMax = -Infinity, ssq = 0;
        for (var wk2 = wStart; wk2 < wStart + wSz; wk2++) { cumDev += retArr[wk2] - wMean; if (cumDev < cumMin) cumMin = cumDev; if (cumDev > cumMax) cumMax = cumDev; ssq += (retArr[wk2] - wMean) * (retArr[wk2] - wMean); }
        var wStd = Math.sqrt(ssq / wSz); if (wStd > 0) { rsSum += (cumMax - cumMin) / wStd; rsCount++; }
      }
      if (rsCount > 0) { logRS.push(Math.log(rsSum / rsCount)); logN.push(Math.log(wSz)); }
    }
    if (logRS.length >= 2) { var sX = 0, sY = 0, sXY = 0, sX2b = 0, nP = logRS.length; for (var li = 0; li < nP; li++) { sX += logN[li]; sY += logRS[li]; sXY += logN[li] * logRS[li]; sX2b += logN[li] * logN[li]; } hurstExp = (nP * sXY - sX * sY) / (nP * sX2b - sX * sX); if (hurstExp < 0) hurstExp = 0; if (hurstExp > 1) hurstExp = 1; }
  }
  var halfLife = null;
  if (autoCorr !== null && Math.abs(autoCorr) < 1 && Math.abs(autoCorr) > 0.001) { halfLife = -Math.log(2) / Math.log(Math.abs(autoCorr)); if (halfLife < 0 || halfLife > 10000) halfLife = null; }
  var avgRunLen = totalRuns > 0 ? (upRunSum + downRunSum) / totalRuns : null;
  var avgUpRun = upRunCnt > 0 ? upRunSum / upRunCnt : null;
  var avgDownRun = downRunCnt > 0 ? downRunSum / downRunCnt : null;
  var runAsym = (avgDownRun && avgDownRun > 0 && avgUpRun) ? avgUpRun / avgDownRun : null;
  var oscScore = null, oscParts = 0, oscSum = 0;
  if (autoCorr !== null) { oscSum += Math.max(0, Math.min(1, 0.5 - autoCorr)); oscParts++; }
  if (hurstExp !== null) { oscSum += Math.max(0, Math.min(1, 1 - hurstExp * 2)); oscParts++; }
  var reversalRate = hTrades > 1 ? (reversals / (hTrades - 1)) * 100 : null;
  if (reversalRate !== null) { oscSum += Math.min(1, reversalRate / 60); oscParts++; }
  if (avgRunLen !== null) { oscSum += Math.max(0, Math.min(1, (3 - avgRunLen) / 2)); oscParts++; }
  if (oscParts >= 2) oscScore = oscSum / oscParts;
  // ECE/CWE/CEP
  var ecePct = null, cwePct = null, cepMedian = null, cepP90 = null, cepTailRatio = null;
  if (runExcursions.length >= 5) {
    var eceS = 0; for (var ei = 0; ei < runExcursions.length; ei++) eceS += runExcursions[ei]; ecePct = eceS / runExcursions.length;
    var cweSq = 0; for (var ci = 0; ci < runExcursions.length; ci++) cweSq += runExcursions[ci] * runExcursions[ci]; cwePct = Math.sqrt(cweSq / runExcursions.length);
    var sorted = runExcursions.slice().sort((a, b) => a - b);
    cepMedian = sorted[Math.floor(sorted.length * 0.5)];
    cepP90 = sorted[Math.floor(sorted.length * 0.9)];
    cepTailRatio = cepMedian > 0 ? cepP90 / cepMedian : null;
  }
  var eceUpPct = null, eceDownPct = null;
  if (upExcursions.length >= 3) { var ueS = 0; for (var ui = 0; ui < upExcursions.length; ui++) ueS += upExcursions[ui]; eceUpPct = ueS / upExcursions.length; }
  if (downExcursions.length >= 3) { var deS = 0; for (var di = 0; di < downExcursions.length; di++) deS += downExcursions[di]; eceDownPct = deS / downExcursions.length; }
  // R2
  var trendR2 = null;
  if (r2N >= 10) { var r2Num = r2N * r2SumXY - r2SumX * r2SumY; var r2D1 = r2N * r2SumX2 - r2SumX * r2SumX; var r2D2 = r2N * r2SumY2 - r2SumY * r2SumY; if (r2D1 > 0 && r2D2 > 0) trendR2 = (r2Num * r2Num) / (r2D1 * r2D2); }
  // Entropy
  var retEntropy = null;
  var entTotal = entUp + entDown + entFlat;
  if (entTotal >= 10) { var entH = 0; var cats = [entUp, entDown, entFlat]; for (var ei2 = 0; ei2 < 3; ei2++) { if (cats[ei2] > 0) { var ep = cats[ei2] / entTotal; entH -= ep * Math.log(ep) / Math.log(2); } } retEntropy = entH / Math.log(3) * Math.log(2); }
  // OFI
  var ofi = ofiVol > 0 ? ofiSum / ofiVol : null;
  // VWAP deviation
  var vwapDev = vwap > 0 ? ((hClose - vwap) / vwap * 100) : null;
  // Price level concentration
  var uniqueLevels = Object.keys(priceLevels).length;
  var rangeCents = Math.round((hHigh - hLow) * 100);
  var priceLevelConc = (rangeCents > 0 && uniqueLevels > 0) ? uniqueLevels / (rangeCents + 1) : null;
  var f15Rng = (first15High > -Infinity && first15Low < Infinity && first15Low > 0) ? ((first15High - first15Low) / first15Low) * 100 : null;
  var upDownRatio = downTicks > 0 ? upTicks / downTicks : null;
  var tradeIntensity = null;
  if (trades.length >= 2) { var ft2 = trades[0].ts, lt2 = trades[trades.length - 1].ts; var durMs = ft2 > 1e15 ? (lt2 - ft2) / 1e6 : ft2 > 1e12 ? (lt2 - ft2) / 1e3 : lt2 - ft2; var durMin = durMs / 60000; if (durMin > 0) tradeIntensity = hTrades / durMin; }

  var rd = (v, d) => v !== null ? Math.round(v * Math.pow(10, d)) / Math.pow(10, d) : null;
  return {
    ticker, trade_date: date, hour,
    hour_open: rd(hOpen, 4), hour_close: rd(hClose, 4), hour_high: rd(hHigh, 4), hour_low: rd(hLow, 4),
    hour_atr_dollar: rd(atrD, 4), hour_atr_pct: rd(atrP, 4),
    hour_volume: hVol, hour_trades: hTrades,
    hour_vwap: rd(vwap, 4),
    hour_first_ts: trades[0].ts, hour_last_ts: trades[trades.length - 1].ts,
    hour_realized_vol: rd(realizedVol, 5), hour_tick_volatility: rd(tickVol, 4),
    hour_return_pct: rd(returnPct, 4), hour_max_drawdown_pct: rd(maxDD, 4),
    hour_upper_wick_pct: atrD > 0 ? rd(((hHigh - Math.max(hOpen, hClose)) / atrD) * 100, 2) : null,
    first_15min_range_pct: rd(f15Rng, 4),
    hour_avg_trade_size: rd(hTrades > 0 ? hVol / hTrades : null, 2),
    hour_trade_intensity: rd(tradeIntensity, 2),
    hour_up_down_ratio: rd(upDownRatio, 4),
    hour_reversal_count: reversals, hour_reversal_rate: rd(reversalRate, 2),
    hour_return_autocorr: rd(autoCorr, 5), hour_hurst_exponent: rd(hurstExp, 4),
    hour_mean_reversion_hl: rd(halfLife, 2),
    hour_avg_run_length: rd(avgRunLen, 3), hour_avg_up_run: rd(avgUpRun, 3), hour_avg_down_run: rd(avgDownRun, 3),
    hour_run_asymmetry: rd(runAsym, 4), hour_oscillation_score: rd(oscScore, 4),
    hour_ece_pct: rd(ecePct, 5), hour_cwe_pct: rd(cwePct, 5),
    hour_cep_median: rd(cepMedian, 5), hour_cep_p90: rd(cepP90, 5), hour_cep_tail_ratio: rd(cepTailRatio, 4),
    hour_ece_up_pct: rd(eceUpPct, 5), hour_ece_down_pct: rd(eceDownPct, 5),
    hour_trend_r2: rd(trendR2, 5), hour_return_entropy: rd(retEntropy, 4),
    hour_order_flow_imbalance: rd(ofi, 5), hour_vwap_deviation: rd(vwapDev, 4),
    hour_price_level_concentration: rd(priceLevelConc, 4)
  };
}

// ── Full day feature extraction ──────────────────────────
async function extractDayFeatures(ticker, date, allTrades, prevDayClose) {
  if (!allTrades.length) return [];
  var allP = allTrades.map(t => t.price);
  var allS = allTrades.map(t => t.size);
  var allTs = allTrades.map(t => t.ts);

  // Split ticks by hour
  var hourTrades = {};
  for (var h = 4; h < 20; h++) hourTrades[h] = [];
  for (var i = 0; i < allTrades.length; i++) {
    var hr = toETHour(allTs[i]);
    if (hr >= 4 && hr < 20) hourTrades[hr].push(allTrades[i]);
  }

  // Day-level aggregates
  var dayOpen = allP[0], dayClose = allP[allP.length - 1];
  var dayHigh = -Infinity, dayLow = Infinity, dayVol = 0;
  for (var i2 = 0; i2 < allP.length; i2++) { if (allP[i2] > dayHigh) dayHigh = allP[i2]; if (allP[i2] < dayLow) dayLow = allP[i2]; dayVol += allS[i2]; }
  var dayDow = new Date(date + 'T12:00:00Z').getUTCDay();
  var gapPct = (prevDayClose && prevDayClose > 0) ? ((dayOpen - prevDayClose) / prevDayClose) * 100 : null;

  // Fetch VIX (UVXY)
  var vixByHour = {}; var vixFallback = null;
  try {
    var vixR = await fetch('https://api.polygon.io/v2/aggs/ticker/UVXY/range/1/hour/' + date + '/' + date + '?adjusted=true&apiKey=' + POLYGON_KEY);
    if (vixR.ok) { var vixD = await vixR.json(); if (vixD.results) for (var vBar of vixD.results) { var vHour = getETHourFromMs(vBar.t); if (vHour >= 4 && vHour < 20) vixByHour[vHour] = vBar.c; vixFallback = vBar.c; } }
  } catch (e) {}
  if (vixFallback) { var lastVix = null; for (var vh = 4; vh < 20; vh++) { if (vixByHour[vh]) lastVix = vixByHour[vh]; else if (lastVix) vixByHour[vh] = lastVix; else vixByHour[vh] = vixFallback; } }

  // Extract features per hour
  var rows = [];
  var cumVol = 0, cumHigh = -Infinity, cumLow = Infinity, prevHourRange = null;
  for (var h2 = 4; h2 < 20; h2++) {
    if (!hourTrades[h2].length) continue;
    var hf = extractHourlyFeatures(hourTrades[h2], ticker, date, h2);
    if (!hf) continue;
    cumVol += hf.hour_volume;
    if (hf.hour_high > cumHigh) cumHigh = hf.hour_high;
    if (hf.hour_low < cumLow) cumLow = hf.hour_low;
    // Add day context
    hf.day_open = Math.round(dayOpen * 10000) / 10000;
    hf.day_high = Math.round(dayHigh * 10000) / 10000;
    hf.day_low = Math.round(dayLow * 10000) / 10000;
    hf.day_close = Math.round(dayClose * 10000) / 10000;
    hf.day_volume = dayVol;
    hf.day_trades = allP.length;
    hf.price_vs_day_open_pct = dayOpen > 0 ? Math.round(((hf.hour_close - dayOpen) / dayOpen) * 100 * 10000) / 10000 : 0;
    hf.intraday_range_pct = (cumLow > 0 && cumLow < Infinity) ? Math.round(((cumHigh - cumLow) / cumLow) * 100 * 10000) / 10000 : 0;
    hf.cumulative_volume_pct = dayVol > 0 ? Math.round((cumVol / dayVol) * 100 * 100) / 100 : 0;
    hf.prev_day_close = prevDayClose ? Math.round(prevDayClose * 10000) / 10000 : null;
    hf.overnight_gap_pct = gapPct !== null ? Math.round(gapPct * 10000) / 10000 : null;
    hf.vix_close = vixByHour[h2] || vixFallback || null;
    hf.day_of_week = dayDow;
    hf.hour_range_vs_prev = (prevHourRange !== null && prevHourRange > 0) ? Math.round((hf.hour_atr_dollar / prevHourRange) * 10000) / 10000 : null;
    prevHourRange = hf.hour_atr_dollar;
    rows.push(hf);
  }
  return rows;
}

// ── Prediction Model ─────────────────────────────────────
function buildQuintileModel(joined, topN) {
  var leadableKeys = ['is_rth', 'prev_hour_atr_pct', 'prev_hour_volume', 'prev_hour_trades', 'prev_hour_realized_vol', 'prev_hour_reversal_rate', 'prev_hour_trade_intensity', 'prev_hour_avg_trade_size', 'prev_hour_oscillation_score', 'prev_hour_ece', 'prev_hour_best_tp', 'overnight_gap_pct', 'vix_close', 'day_of_week', 'hour', 'cumulative_volume_pct', 'hour_vol_pct_of_day'];
  function pearson(x, y) {
    if (x.length < 3) return 0;
    var n = x.length, sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
    for (var i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxy += x[i] * y[i]; sx2 += x[i] * x[i]; sy2 += y[i] * y[i]; }
    var num = n * sxy - sx * sy; var d1 = n * sx2 - sx * sx; var d2 = n * sy2 - sy * sy;
    return (d1 > 0 && d2 > 0) ? num / Math.sqrt(d1 * d2) : 0;
  }
  var featureCorrs = [];
  for (var fk of leadableKeys) {
    var xv = [], yp = [];
    for (var t of joined) { var v = parseFloat(t[fk]); if (!isNaN(v)) { xv.push(v); yp.push(t.best_net_profit); } }
    if (xv.length >= 5) featureCorrs.push({ key: fk, rProfit: pearson(xv, yp), n: xv.length });
  }
  featureCorrs.sort((a, b) => Math.abs(b.rProfit) - Math.abs(a.rProfit));
  var selected = featureCorrs.slice(0, topN);

  for (var sf of selected) {
    var vals = [];
    for (var t2 of joined) { var v2 = parseFloat(t2[sf.key]); if (!isNaN(v2)) vals.push({ v: v2, tp: t2.best_tp_pct, np: t2.best_net_profit }); }
    vals.sort((a, b) => a.v - b.v);
    sf.quintiles = [];
    for (var qi = 0; qi < 5; qi++) {
      var qStart = Math.floor(vals.length * qi / 5), qEnd = Math.floor(vals.length * (qi + 1) / 5);
      var qVals = vals.slice(qStart, qEnd);
      var tpSum = 0, npSum = 0; for (var qv of qVals) { tpSum += qv.tp; npSum += qv.np; }
      sf.quintiles.push({ min: qVals[0].v, max: qVals[qVals.length - 1].v, avgTp: tpSum / qVals.length, avgProfit: npSum / qVals.length });
    }
  }
  return selected;
}

function predictTP(model, featureValues) {
  var tpPreds = [];
  for (var sf of model) {
    var val = featureValues[sf.key];
    if (val === null || val === undefined || isNaN(val)) continue;
    for (var qi = 0; qi < sf.quintiles.length; qi++) {
      if (val <= sf.quintiles[qi].max || qi === 4) { tpPreds.push(sf.quintiles[qi].avgTp); break; }
    }
  }
  if (!tpPreds.length) return null;
  var sum = 0; for (var tp of tpPreds) sum += tp;
  return Math.round(sum / tpPreds.length * 100) / 100;
}

// ── Nightly Pipeline ─────────────────────────────────────
async function runNightly(tickers) {
  // Get yesterday's date
  var now = new Date();
  var yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  while (yesterday.getUTCDay() === 0 || yesterday.getUTCDay() === 6) yesterday = new Date(yesterday.getTime() - 24 * 60 * 60 * 1000);
  var date = yesterday.toISOString().slice(0, 10);

  for (var ticker of tickers) {
    console.log(`\n[NIGHTLY] ${ticker} ${date}`);
    await reportProgress({ mode: 'nightly', ticker, status: 'running', current_day: date, current_stage: 'fetch', message: 'Nightly: ' + ticker + ' ' + date });

    // 1. Fetch ticks
    console.log('  Fetching ticks...');
    var trades = await fetchTicks(ticker, date);
    console.log(`  ${trades.length} ticks fetched`);
    if (trades.length < 100) { console.log('  Skipping (too few ticks)'); continue; }

    // 2. Get prev day close
    var prevDayClose = null;
    try {
      var prevDate = new Date(date + 'T12:00:00Z'); prevDate.setUTCDate(prevDate.getUTCDate() - 1);
      while (prevDate.getUTCDay() === 0 || prevDate.getUTCDay() === 6) prevDate.setUTCDate(prevDate.getUTCDate() - 1);
      var ohlcR = await fetch('https://api.polygon.io/v1/open-close/' + ticker + '/' + prevDate.toISOString().slice(0, 10) + '?adjusted=true&apiKey=' + POLYGON_KEY);
      if (ohlcR.ok) { var ohlcD = await ohlcR.json(); if (ohlcD.close) prevDayClose = ohlcD.close; }
    } catch (e) {}

    // 3. Extract features
    console.log('  Extracting features...');
    var rows = await extractDayFeatures(ticker, date, trades, prevDayClose);
    console.log(`  ${rows.length} feature rows`);

    // 4. Save features
    console.log('  Saving to hourly_features...');
    // Delete existing then insert
    await fetch(SB_URL + '/rest/v1/hourly_features?ticker=eq.' + ticker + '&trade_date=eq.' + date, { method: 'DELETE', headers: sbHeaders() });
    await sbUpsert('hourly_features', rows);

    // 5. Run TP% scan (100 TP% x 16 hours)
    console.log('  Running hourly TP% scan...');
    var sharePrice = trades[0].price;
    var fracQty = sharePrice > 0 ? CAP_PER_LEVEL / sharePrice : 0;
    var adjFee = FEE_PER_SHARE * fracQty;
    var optRows = [];
    for (var tpInt = 1; tpInt <= 100; tpInt++) {
      var tpPct = tpInt / 100;
      var hc = computeHourlyCycles(trades, tpPct);
      var tpDollar = Math.round((Math.ceil(sharePrice * (1 + tpPct / 100) * 100) / 100 - sharePrice) * 100) / 100;
      if (tpDollar < 0.01) tpDollar = 0.01;
      var grossPC = fracQty * tpDollar;
      var netPC = grossPC - adjFee;
      for (var h = 4; h < 20; h++) {
        var cy = hc[h] || 0;
        optRows.push({ ticker, trade_date: date, hour: h, tp_pct: tpPct, session_type: 'full', cycles: cy, tp_dollar: tpDollar, net_profit: Math.round(cy * netPC * 100) / 100 });
      }
    }
    console.log(`  ${optRows.length} optimal_tp_hourly rows`);
    await fetch(SB_URL + '/rest/v1/optimal_tp_hourly?ticker=eq.' + ticker + '&trade_date=eq.' + date, { method: 'DELETE', headers: sbHeaders() });
    await sbUpsert('optimal_tp_hourly', optRows);

    // 6. Build prediction model and predict today
    console.log('  Building prediction model...');
    var allFeatures = await sbFetchPaginated('hourly_features?ticker=eq.' + ticker + '&order=trade_date.asc,hour.asc&select=*');
    var allOpt = await sbFetchPaginated('optimal_tp_hourly?ticker=eq.' + ticker + '&order=trade_date.asc,hour.asc,net_profit.desc&select=trade_date,hour,tp_pct,net_profit');
    var bestTP = {};
    for (var o of allOpt) { var ok = o.trade_date + '|' + o.hour; if (!bestTP[ok]) bestTP[ok] = { tp: o.tp_pct, np: o.net_profit }; }
    var joined = [];
    for (var f of allFeatures) {
      var fk = f.trade_date + '|' + f.hour;
      if (bestTP[fk]) {
        var row = Object.assign({}, f);
        row.best_tp_pct = bestTP[fk].tp; row.best_net_profit = bestTP[fk].np;
        row.is_rth = (parseInt(f.hour) >= 9 && parseInt(f.hour) < 16) ? 1 : 0;
        row.hour_vol_pct_of_day = (parseFloat(f.hour_volume) || 0) / (parseFloat(f.day_volume) || 1) * 100;
        // Prev hour
        if (joined.length > 0 && joined[joined.length - 1].trade_date === row.trade_date) {
          var ph = joined[joined.length - 1];
          row.prev_hour_atr_pct = parseFloat(ph.hour_atr_pct) || null;
          row.prev_hour_volume = parseFloat(ph.hour_volume) || null;
          row.prev_hour_trades = parseFloat(ph.hour_trades) || null;
          row.prev_hour_realized_vol = parseFloat(ph.hour_realized_vol) || null;
          row.prev_hour_reversal_rate = parseFloat(ph.hour_reversal_rate) || null;
          row.prev_hour_trade_intensity = parseFloat(ph.hour_trade_intensity) || null;
          row.prev_hour_avg_trade_size = parseFloat(ph.hour_avg_trade_size) || null;
          row.prev_hour_oscillation_score = parseFloat(ph.hour_oscillation_score) || null;
          row.prev_hour_ece = parseFloat(ph.hour_ece_pct) || null;
          row.prev_hour_best_tp = ph.best_tp_pct;
        }
        joined.push(row);
      }
    }
    if (joined.length < 20) { console.log('  Only ' + joined.length + ' joined points, skipping prediction'); continue; }
    var model = buildQuintileModel(joined, 5);
    console.log('  Model features:', model.map(m => m.key + ' (r=' + m.rProfit.toFixed(3) + ')').join(', '));

    // Predict for today (each hour gets a baseline prediction)
    var today = new Date();
    var todayStr = today.toISOString().slice(0, 10);
    // Use median TP% from all training data as daily prediction
    var allTps = joined.map(j => j.best_tp_pct).sort((a, b) => a - b);
    var medianTp = allTps[Math.floor(allTps.length / 2)];
    await fetch(SB_URL + '/rest/v1/daily_predictions?ticker=eq.' + ticker + '&trade_date=eq.' + todayStr, { method: 'DELETE', headers: sbHeaders() });
    await sbUpsert('daily_predictions', [{ ticker, trade_date: todayStr, predicted_tp_pct: medianTp, flat_tp_pct: medianTp, model_version: 'quintile_v1', features_used: model.map(m => m.key), train_days: joined.length }]);
    console.log(`  Daily prediction saved: ${medianTp}% TP for ${todayStr}`);

    await sleep(500);
  }
}

// ── Hourly Pipeline ──────────────────────────────────────
async function runHourly(tickers) {
  // Determine current ET hour
  var now = new Date();
  var etHour = parseInt(_etFmt.format(now));
  var prevHour = etHour - 1;
  if (prevHour < 4 || prevHour >= 20) { console.log('Outside trading hours (' + etHour + ' ET)'); return; }

  var todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);

  for (var ticker of tickers) {
    console.log(`\n[HOURLY] ${ticker} ${todayStr} hour ${prevHour} -> predict hour ${etHour}`);
    await reportProgress({ mode: 'hourly', ticker, status: 'running', current_day: todayStr, current_stage: 'fetch', message: 'Hourly: ' + ticker + ' H' + prevHour + ' -> predict H' + etHour });

    // 1. Fetch just the previous hour ticks
    console.log('  Fetching hour ' + prevHour + ' ticks...');
    var hourTicks = await fetchHourlyTicks(ticker, todayStr, prevHour);
    console.log(`  ${hourTicks.length} ticks`);
    if (hourTicks.length < 10) { console.log('  Too few ticks, skipping'); continue; }

    // 2. Extract features for this hour
    var hf = extractHourlyFeatures(hourTicks, ticker, todayStr, prevHour);
    if (!hf) { console.log('  Feature extraction failed'); continue; }

    // Add day context from existing features or OHLC
    try {
      var existing = await sbFetch('hourly_features?ticker=eq.' + ticker + '&trade_date=eq.' + todayStr + '&limit=1&select=day_open,day_volume,day_trades,prev_day_close,overnight_gap_pct,vix_close,day_of_week');
      if (existing.length) { Object.assign(hf, { day_open: existing[0].day_open, day_volume: existing[0].day_volume, day_trades: existing[0].day_trades, prev_day_close: existing[0].prev_day_close, overnight_gap_pct: existing[0].overnight_gap_pct, vix_close: existing[0].vix_close, day_of_week: existing[0].day_of_week }); }
    } catch (e) {}

    // 3. Save feature row
    console.log('  Saving feature row...');
    await fetch(SB_URL + '/rest/v1/hourly_features?ticker=eq.' + ticker + '&trade_date=eq.' + todayStr + '&hour=eq.' + prevHour, { method: 'DELETE', headers: sbHeaders() });
    await sbUpsert('hourly_features', [hf]);

    // 4. Load trained model (from last nightly run)
    var allFeatures = await sbFetchPaginated('hourly_features?ticker=eq.' + ticker + '&order=trade_date.asc,hour.asc&select=*');
    var allOpt = await sbFetchPaginated('optimal_tp_hourly?ticker=eq.' + ticker + '&order=trade_date.asc,hour.asc,net_profit.desc&select=trade_date,hour,tp_pct,net_profit');
    var bestTP = {};
    for (var o of allOpt) { var ok = o.trade_date + '|' + o.hour; if (!bestTP[ok]) bestTP[ok] = { tp: o.tp_pct, np: o.net_profit }; }
    var joined = [];
    for (var f of allFeatures) {
      var fk = f.trade_date + '|' + f.hour;
      if (bestTP[fk]) {
        var row = Object.assign({}, f);
        row.best_tp_pct = bestTP[fk].tp; row.best_net_profit = bestTP[fk].np;
        row.is_rth = (parseInt(f.hour) >= 9 && parseInt(f.hour) < 16) ? 1 : 0;
        if (joined.length > 0 && joined[joined.length - 1].trade_date === row.trade_date) {
          var ph = joined[joined.length - 1];
          row.prev_hour_trades = parseFloat(ph.hour_trades) || null;
          row.prev_hour_trade_intensity = parseFloat(ph.hour_trade_intensity) || null;
          row.prev_hour_oscillation_score = parseFloat(ph.hour_oscillation_score) || null;
          row.prev_hour_ece = parseFloat(ph.hour_ece_pct) || null;
          row.prev_hour_best_tp = ph.best_tp_pct;
        }
        joined.push(row);
      }
    }
    if (joined.length < 20) { console.log('  Not enough training data (' + joined.length + ')'); continue; }
    var model = buildQuintileModel(joined, 5);

    // 5. Predict next hour
    var predTp = predictTP(model, hf);
    console.log(`  Predicted TP% for hour ${etHour}: ${predTp}%`);

    // 6. Save prediction
    await fetch(SB_URL + '/rest/v1/hourly_predictions?ticker=eq.' + ticker + '&trade_date=eq.' + todayStr + '&hour=eq.' + etHour, { method: 'DELETE', headers: sbHeaders() });
    await sbUpsert('hourly_predictions', [{
      ticker, trade_date: todayStr, hour: etHour,
      predicted_tp_pct: predTp,
      features_used: model.map(m => m.key),
      quintile_values: Object.fromEntries(model.map(m => [m.key, parseFloat(hf[m.key]) || null])),
      model_version: 'quintile_v1'
    }]);
    console.log(`  Saved to hourly_predictions`);

    await sleep(300);
  }
}

// ── Stage 1: Seasonality + Sessions ──────────────────────
function computeSeasonality(trades) {
  var hourData = {};
  for (var h = 4; h < 20; h++) hourData[h] = { high: -Infinity, low: Infinity, vol: 0, trades: 0, open: null, close: null };
  for (var i = 0; i < trades.length; i++) {
    var hr = toETHour(trades[i].ts);
    if (hr >= 4 && hr < 20) {
      var hd = hourData[hr];
      if (hd.open === null) hd.open = trades[i].price;
      hd.close = trades[i].price;
      if (trades[i].price > hd.high) hd.high = trades[i].price;
      if (trades[i].price < hd.low) hd.low = trades[i].price;
      hd.vol += trades[i].size;
      hd.trades++;
    }
  }
  var result = [];
  for (var h2 = 4; h2 < 20; h2++) {
    var d = hourData[h2];
    if (d.trades === 0) continue;
    var atr = d.high - d.low;
    result.push({ hour: h2, high: d.high, low: d.low, atr: Math.round(atr * 10000) / 10000, atr_pct: d.low > 0 ? Math.round((atr / d.low) * 100 * 10000) / 10000 : 0, volume: d.vol, trades: d.trades });
  }
  return result;
}

function computeSessions(trades) {
  var _etFmt2 = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false });
  var sessions = { pre: { high: -Infinity, low: Infinity, vol: 0, trades: 0 }, reg: { high: -Infinity, low: Infinity, vol: 0, trades: 0 }, post: { high: -Infinity, low: Infinity, vol: 0, trades: 0 } };
  for (var i = 0; i < trades.length; i++) {
    var ms = trades[i].ts > 1e15 ? trades[i].ts / 1e6 : trades[i].ts > 1e12 ? trades[i].ts / 1e3 : trades[i].ts;
    var parts = _etFmt2.format(new Date(ms)).split(':');
    var etMin = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    var s = etMin < 570 ? 'pre' : etMin < 960 ? 'reg' : 'post';
    var sd = sessions[s];
    if (trades[i].price > sd.high) sd.high = trades[i].price;
    if (trades[i].price < sd.low) sd.low = trades[i].price;
    sd.vol += trades[i].size; sd.trades++;
  }
  var result = [];
  for (var sk of ['pre', 'reg', 'post']) {
    var ss = sessions[sk];
    if (ss.trades === 0) continue;
    var range = ss.high - ss.low;
    result.push({ session_type: sk, high: ss.high, low: ss.low, range_dollars: Math.round(range * 10000) / 10000, range_pct: ss.low > 0 ? Math.round((range / ss.low) * 100 * 10000) / 10000 : 0, volume: ss.vol, trades: ss.trades });
  }
  return result;
}

// ── Resume Check ─────────────────────────────────────────
async function checkExisting(ticker, date) {
  try {
    var features = await sbFetch('hourly_features?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=hour&limit=1');
    var optimal = await sbFetch('optimal_tp_hourly?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=hour&limit=1');
    var analyses = await sbFetch('cached_analyses?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=id&limit=1');
    var dailyOpt = await sbFetch('cached_daily_optimal_tp?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=tp_pct&limit=1');
    var levels = analyses.length > 0 ? await sbFetch('cached_levels?analysis_id=eq.' + analyses[0].id + '&select=id&limit=1') : [];
    return { complete: features.length > 0 && optimal.length > 0 && analyses.length > 0 && dailyOpt.length > 0 && levels.length > 0 };
  } catch (e) { return { complete: false }; }
}

// ── Progress Reporting ───────────────────────────────────
var RUN_ID = 'run_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

async function reportProgress(data) {
  try {
    var row = Object.assign({ run_id: RUN_ID, updated_at: new Date().toISOString() }, data);
    // Try update first, then insert
    var r = await fetch(SB_URL + '/rest/v1/pipeline_status?run_id=eq.' + RUN_ID, { method: 'GET', headers: sbHeaders() });
    var existing = await r.json();
    if (existing.length > 0) {
      await fetch(SB_URL + '/rest/v1/pipeline_status?run_id=eq.' + RUN_ID, { method: 'PATCH', headers: Object.assign({}, sbHeaders(), { 'Prefer': 'return=minimal' }), body: JSON.stringify(row) });
    } else {
      row.started_at = new Date().toISOString();
      await fetch(SB_URL + '/rest/v1/pipeline_status', { method: 'POST', headers: sbHeaders(), body: JSON.stringify(row) });
    }
  } catch (e) { /* don't let progress reporting crash the pipeline */ }
}

// ── Robust Save Helper ───────────────────────────────────
async function sbDeleteInsert(table, deleteFilter, rows, label) {
  // Try upsert first (merge-duplicates handles UNIQUE constraints)
  var upsertHeaders = Object.assign({}, sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=minimal' });
  for (var i = 0; i < rows.length; i += 500) {
    var batch = rows.slice(i, i + 500);
    var postR = await fetch(SB_URL + '/rest/v1/' + table, { method: 'POST', headers: upsertHeaders, body: JSON.stringify(batch) });
    if (!postR.ok) {
      // Upsert failed — fall back to DELETE+INSERT
      var errTxt = await postR.text();
      console.log('    ' + label + ' upsert failed (' + postR.status + '), falling back to DELETE+INSERT: ' + errTxt.slice(0, 100));
      if (i === 0) { // Only delete once
        await fetch(SB_URL + '/rest/v1/' + table + '?' + deleteFilter, { method: 'DELETE', headers: sbHeaders() });
        await sleep(200);
      }
      var retryR = await fetch(SB_URL + '/rest/v1/' + table, { method: 'POST', headers: Object.assign({}, sbHeaders(), { 'Prefer': 'return=minimal' }), body: JSON.stringify(batch) });
      if (!retryR.ok) {
        var retryErr = await retryR.text();
        console.log('    ERROR: ' + label + ' fallback also failed: ' + retryR.status + ' ' + retryErr.slice(0, 100));
      }
    }
  }
}

// ── Trading Days ─────────────────────────────────────────
function getTradingDays(start, end) {
  var days = [];
  var d = new Date(start + 'T12:00:00Z');
  var e = new Date(end + 'T12:00:00Z');
  while (d <= e) {
    var dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

// ── Backfill Pipeline ────────────────────────────────────
async function runBackfill(tickers, startDate, endDate, skipExisting) {
  var days = getTradingDays(startDate, endDate);
  console.log(`\nDate range: ${startDate} to ${endDate} (${days.length} trading days)`);
  console.log(`Tickers: ${tickers.join(', ')}`);
  console.log(`Skip existing: ${skipExisting}`);
  console.log(`Total jobs: ${days.length * tickers.length}`);

  var stats = { processed: 0, skipped: 0, noData: 0, errors: 0, totalTicks: 0 };
  var startTime = Date.now();
  await reportProgress({ mode: 'backfill', ticker: tickers.join(','), status: 'running', days_total: days.length * tickers.length, message: 'Starting backfill: ' + tickers.join(',') + ' ' + startDate + ' to ' + endDate });

  for (var ti = 0; ti < tickers.length; ti++) {
    var ticker = tickers[ti];
    var prevDayClose = null;
    console.log(`\n${'─'.repeat(40)}`);
    console.log(`TICKER: ${ticker} (${ti + 1}/${tickers.length})`);
    console.log(`${'─'.repeat(40)}`);

    for (var di = 0; di < days.length; di++) {
      var date = days[di];
      var elapsed = Math.round((Date.now() - startTime) / 1000);
      var pct = Math.round(((ti * days.length + di) / (tickers.length * days.length)) * 100);
      console.log(`\n[${pct}%] ${ticker} ${date} (day ${di + 1}/${days.length}) [${elapsed}s elapsed]`);

      // Resume check
      if (skipExisting) {
        var existing = await checkExisting(ticker, date);
        if (existing.complete) {
          console.log('  SKIP: already complete in database (all 8 tables)');
          stats.skipped++;
          await reportProgress({ current_day: date, ticker, progress_pct: pct, days_processed: stats.processed, days_skipped: stats.skipped, current_stage: 'skip', message: ticker + ' ' + date + ': skipped (already in DB)' });
          // Still fetch prev day close for next day's gap calculation
          try {
            var prevR = await sbFetch('hourly_features?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=day_close&limit=1');
            if (prevR.length) prevDayClose = parseFloat(prevR[0].day_close);
          } catch (e) {}
          continue;
        }
      }

      // 1. Fetch ticks
      console.log('  Fetching ticks...');
      var trades;
      try {
        trades = await fetchTicks(ticker, date);
      } catch (e) {
        console.log('  ERROR fetching ticks: ' + e.message);
        stats.errors++;
        continue;
      }
      console.log('  ' + trades.length.toLocaleString() + ' ticks');
      if (trades.length < 100) {
        console.log('  SKIP: too few ticks (holiday/no data)');
        stats.noData++;
        await reportProgress({ current_day: date, ticker, progress_pct: pct, days_processed: stats.processed, current_stage: 'no_data', message: ticker + ' ' + date + ': no data (holiday?)' });
        continue;
      }
      stats.totalTicks += trades.length;
      await reportProgress({ current_day: date, ticker, progress_pct: pct, total_ticks: stats.totalTicks, current_stage: 'fetched', message: ticker + ' ' + date + ': ' + trades.length.toLocaleString() + ' ticks fetched' });

      // 2. Get prev day close (for first day only)
      if (prevDayClose === null && di === 0) {
        try {
          var prevDate = new Date(date + 'T12:00:00Z');
          prevDate.setUTCDate(prevDate.getUTCDate() - 1);
          while (prevDate.getUTCDay() === 0 || prevDate.getUTCDay() === 6) prevDate.setUTCDate(prevDate.getUTCDate() - 1);
          var ohlcR = await fetch('https://api.polygon.io/v1/open-close/' + ticker + '/' + prevDate.toISOString().slice(0, 10) + '?adjusted=true&apiKey=' + POLYGON_KEY);
          if (ohlcR.ok) { var ohlcD = await ohlcR.json(); if (ohlcD.close) prevDayClose = ohlcD.close; }
        } catch (e) {}
      }

      try {
        // ── STAGE 1: Analysis ──
        console.log('  Stage 1: Cycle analysis...');
        var sharePrice = trades[0].price;
        var tpPct = 1.0; // default TP% for Stage 1
        var result = analyzePriceLevels(trades, tpPct);
        var minP = Infinity, maxP = -Infinity;
        for (var z = 0; z < trades.length; z++) { if (trades[z].price < minP) minP = trades[z].price; if (trades[z].price > maxP) maxP = trades[z].price; }
        var openLvl = Math.floor(trades[0].price * 100) / 100;
        var preSeedMax = Math.round(openLvl * 1.01 * 100) / 100;

        // Fetch OHLC for the day
        var ohlc = null;
        try {
          var ohlcR2 = await fetch('https://api.polygon.io/v1/open-close/' + ticker + '/' + date + '?adjusted=true&apiKey=' + POLYGON_KEY);
          if (ohlcR2.ok) ohlc = await ohlcR2.json();
        } catch (e) {}

        // Save cached_analyses
        var analysisBody = { ticker, trade_date: date, tp_pct: tpPct, session_type: 'all', total_cycles: result.summary.totalCycles, active_levels: result.summary.activeLevels, total_levels: result.summary.totalLevels, total_trades: trades.length, tick_min: minP, tick_max: maxP, open_price: sharePrice, pre_seed_max: preSeedMax };
        if (ohlc && ohlc.open) { analysisBody.ohlc_open = ohlc.open; analysisBody.ohlc_high = ohlc.high; analysisBody.ohlc_low = ohlc.low; analysisBody.ohlc_close = ohlc.close; analysisBody.ohlc_volume = ohlc.volume; }
        await sbDeleteInsert('cached_analyses', 'ticker=eq.' + ticker + '&trade_date=eq.' + date, [analysisBody], 'analyses');
        await sleep(200);
        var savedA = await sbFetch('cached_analyses?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=id&limit=1');
        var analysisId = savedA.length > 0 ? savedA[0].id : null;

        // Save cached_levels (requires delete+insert since no UNIQUE on data columns)
        if (analysisId) {
          var levelRows = [];
          for (var lv of result.levels || []) { if (lv && lv.cycles > 0) levelRows.push({ analysis_id: analysisId, level_price: lv.price, target_price: lv.target, cycles: lv.cycles }); }
          if (levelRows.length) {
            await fetch(SB_URL + '/rest/v1/cached_levels?analysis_id=eq.' + analysisId, { method: 'DELETE', headers: sbHeaders() });
            await sleep(100);
            for (var li = 0; li < levelRows.length; li += 200) {
              var lvBatch = levelRows.slice(li, li + 200);
              var lvR = await fetch(SB_URL + '/rest/v1/cached_levels', { method: 'POST', headers: Object.assign({}, sbHeaders(), { 'Prefer': 'return=minimal' }), body: JSON.stringify(lvBatch) });
              if (!lvR.ok) console.log('    WARN: levels POST failed batch ' + li + ': ' + lvR.status);
            }
          }
          console.log('  Stage 1: ' + result.summary.totalCycles + ' cycles, ' + levelRows.length + ' active levels');
        } else {
          console.log('  Stage 1: ' + result.summary.totalCycles + ' cycles (WARNING: analyses ID not found)');
        }
        await reportProgress({ current_day: date, ticker, progress_pct: pct, current_stage: 'stage1', message: ticker + ' ' + date + ': Stage 1 done (' + result.summary.totalCycles + ' cycles)' });

        // Save cached_seasonality + sessions
        console.log('  Stage 1: Seasonality + Sessions...');
        var seasonality = computeSeasonality(trades);
        var seasonRows = seasonality.map(s => ({ ticker, trade_date: date, hour: s.hour, high: s.high, low: s.low, atr: s.atr, atr_pct: s.atr_pct, volume: s.volume, trades: s.trades }));
        await sbDeleteInsert('cached_seasonality', 'ticker=eq.' + ticker + '&trade_date=eq.' + date, seasonRows, 'seasonality');
        var sessionData = computeSessions(trades);
        var sessionRows = sessionData.map(s => ({ ticker, trade_date: date, session_type: s.session_type, high: s.high, low: s.low, range_dollars: s.range_dollars, range_pct: s.range_pct, volume: s.volume, trades: s.trades }));
        await sbDeleteInsert('cached_sessions', 'ticker=eq.' + ticker + '&trade_date=eq.' + date, sessionRows, 'sessions');

        // ── STAGE 2: Hourly Optimal TP% ──
        console.log('  Stage 2: Scanning 100 TP% x 16 hours...');
        var fracQty = sharePrice > 0 ? CAP_PER_LEVEL / sharePrice : 0;
        var adjFee = FEE_PER_SHARE * fracQty;
        var optRows = [];
        for (var tpInt = 1; tpInt <= 100; tpInt++) {
          var tp = tpInt / 100;
          var hc = computeHourlyCycles(trades, tp);
          var tpDollar = Math.round((Math.ceil(sharePrice * (1 + tp / 100) * 100) / 100 - sharePrice) * 100) / 100;
          if (tpDollar < 0.01) tpDollar = 0.01;
          var grossPC = fracQty * tpDollar;
          var netPC = grossPC - adjFee;
          for (var h = 4; h < 20; h++) {
            var cy = hc[h] || 0;
            optRows.push({ ticker, trade_date: date, hour: h, tp_pct: tp, session_type: 'full', cycles: cy, tp_dollar: tpDollar, net_profit: Math.round(cy * netPC * 100) / 100 });
          }
        }
        console.log('  Stage 2: ' + optRows.length + ' rows');
        await reportProgress({ current_day: date, ticker, progress_pct: pct, current_stage: 'stage2', message: ticker + ' ' + date + ': Stage 2 done (100 TP% x 16 hrs)' });
        await sbDeleteInsert('optimal_tp_hourly', 'ticker=eq.' + ticker + '&trade_date=eq.' + date, optRows, 'optimal');
        var hcDefault = computeHourlyCycles(trades, 1.0);
        var hcRows = [];
        for (var hh = 4; hh < 20; hh++) hcRows.push({ ticker, trade_date: date, hour: hh, tp_pct: 1.0, session_type: 'all', cycles: hcDefault[hh] || 0 });
        await sbDeleteInsert('cached_hourly_cycles', 'ticker=eq.' + ticker + '&trade_date=eq.' + date + '&tp_pct=eq.1&session_type=eq.all', hcRows, 'hourly_cycles');

        // Save cached_hourly_hold_times (cycle holding durations)
        if (trades.length < 500000) { // skip for very heavy stocks to avoid memory issues
          var holdTimes = computeCycleHoldTimes(trades, 1.0);
          var htRows = holdTimes.filter(ht => ht.count > 0).map(ht => ({
            ticker, trade_date: date, hour: ht.hour, tp_pct: 1.0, session_type: 'all',
            avg_duration: ht.avg, min_duration: ht.min, max_duration: ht.max, cycle_count: ht.count
          }));
          if (htRows.length) await sbDeleteInsert('cached_hourly_hold_times', 'ticker=eq.' + ticker + '&trade_date=eq.' + date + '&tp_pct=eq.1&session_type=eq.all', htRows, 'hold_times');
          console.log('  Stage 1: Hold times: ' + htRows.length + ' hours with cycles');
        }

        // ── Daily Optimal TP% (flat scan for the whole day) ──
        console.log('  Stage 2b: Daily flat TP% scan...');
        var dailyOptRows = [];
        for (var dtpInt = 1; dtpInt <= 100; dtpInt++) {
          var dtp = dtpInt / 100;
          var dRes = analyzePriceLevels(trades, dtp);
          var dtpDollar = Math.round((Math.ceil(sharePrice * (1 + dtp / 100) * 100) / 100 - sharePrice) * 100) / 100;
          if (dtpDollar < 0.01) dtpDollar = 0.01;
          var dGrossPC = fracQty * dtpDollar;
          var dNetPC = dGrossPC - adjFee;
          var dCycles = dRes.summary.totalCycles;
          dailyOptRows.push({
            ticker, trade_date: date, tp_pct: dtp, tp_dollar: dtpDollar,
            cycles: dCycles, gross_per_cycle: Math.round(dGrossPC * 10000) / 10000,
            adj_fee: Math.round(adjFee * 10000) / 10000, net_per_cycle: Math.round(dNetPC * 10000) / 10000,
            gross_total: Math.round(dCycles * dGrossPC * 100) / 100,
            net_total: Math.round(dCycles * dNetPC * 100) / 100,
            cap_deployed: Math.round(dRes.summary.activeLevels * CAP_PER_LEVEL * 100) / 100,
            roi: dRes.summary.activeLevels > 0 ? Math.round((dCycles * dNetPC) / (dRes.summary.activeLevels * CAP_PER_LEVEL) * 100 * 100) / 100 : 0,
            total_trades: trades.length, share_price: sharePrice,
            cap_per_level: CAP_PER_LEVEL, fee_per_share: FEE_PER_SHARE
          });
        }
        await sbDeleteInsert('cached_daily_optimal_tp', 'ticker=eq.' + ticker + '&trade_date=eq.' + date, dailyOptRows, 'daily_optimal');
        console.log('  Stage 2b: ' + dailyOptRows.length + ' daily optimal rows');

        // ── STAGE 3: Feature Extraction ──
        console.log('  Stage 3: Extracting features...');
        var featureRows = await extractDayFeatures(ticker, date, trades, prevDayClose);
        console.log('  Stage 3: ' + featureRows.length + ' feature rows');
        await sbDeleteInsert('hourly_features', 'ticker=eq.' + ticker + '&trade_date=eq.' + date, featureRows, 'features');

        // ── VERIFY ALL 9 TABLES ──
        var vA = await sbFetch('cached_analyses?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=id&limit=1');
        var vS = await sbFetch('cached_seasonality?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=hour&limit=1');
        var vO = await sbFetch('optimal_tp_hourly?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=hour&limit=1');
        var vF = await sbFetch('hourly_features?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=hour&limit=1');
        var vH = await sbFetch('cached_hourly_cycles?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=hour&limit=1');
        var vSe = await sbFetch('cached_sessions?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=session_type&limit=1');
        var vD = await sbFetch('cached_daily_optimal_tp?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=tp_pct&limit=1');
        var vL = analysisId ? await sbFetch('cached_levels?analysis_id=eq.' + analysisId + '&select=id&limit=1') : [];
        var vHT = await sbFetch('cached_hourly_hold_times?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=hour&limit=1');
        var missing = [];
        if(!vA.length)missing.push('A');if(!vS.length)missing.push('S');if(!vO.length)missing.push('O');
        if(!vF.length)missing.push('F');if(!vH.length)missing.push('HC');if(!vSe.length)missing.push('Se');
        if(!vD.length)missing.push('D');if(!vL.length)missing.push('L');if(!vHT.length)missing.push('HT');
        if(missing.length) console.log('  WARNING: Missing: ' + missing.join(', '));
        else console.log('  VERIFIED: All 9 tables populated');


        // Update prevDayClose for next day
        prevDayClose = trades[trades.length - 1].price;
        stats.processed++;
        console.log('  DONE: Stages 1+2+3 complete');
        await reportProgress({ current_day: date, ticker, progress_pct: pct, days_processed: stats.processed, total_ticks: stats.totalTicks, current_stage: 'complete', message: ticker + ' ' + date + ': all stages complete' });

      } catch (e) {
        console.log('  ERROR: ' + e.message);
        stats.errors++;
        await reportProgress({ current_day: date, ticker, progress_pct: pct, days_error: stats.errors, current_stage: 'error', message: ticker + ' ' + date + ': ERROR - ' + e.message });
      }

      // Rate limit pause between days
      await sleep(500);
    }
  }

  var totalElapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`BACKFILL COMPLETE`);
  console.log(`  Processed: ${stats.processed} days`);
  console.log(`  Skipped: ${stats.skipped} (already in DB)`);
  console.log(`  No data: ${stats.noData} (holidays/weekends)`);
  console.log(`  Errors: ${stats.errors}`);
  console.log(`  Total ticks: ${stats.totalTicks.toLocaleString()}`);
  console.log(`  Time: ${totalElapsed}s (${Math.round(totalElapsed / 60)}m)`);
  console.log(`${'='.repeat(50)}`);
  await reportProgress({ status: 'complete', progress_pct: 100, days_processed: stats.processed, days_skipped: stats.skipped, days_error: stats.errors, total_ticks: stats.totalTicks, current_stage: 'done', message: 'Complete: ' + stats.processed + ' processed, ' + stats.skipped + ' skipped, ' + stats.errors + ' errors. ' + Math.round(totalElapsed / 60) + 'm' });
}

// ── CLI Entry Point ──────────────────────────────────────
async function main() {
  if (!POLYGON_KEY) { console.error('Missing POLYGON_API_KEY'); process.exit(1); }
  if (!SB_URL) { console.error('Missing SUPABASE_URL'); process.exit(1); }
  if (!SB_KEY) { console.error('Missing SUPABASE_KEY'); process.exit(1); }

  var args = process.argv.slice(2);
  var mode = args.includes('--backfill') ? 'backfill' : args.includes('--hourly') ? 'hourly' : 'nightly';
  var tickerIdx = args.indexOf('--tickers');
  var tickers = tickerIdx >= 0 && args[tickerIdx + 1] ? args[tickerIdx + 1].split(',') : ['ONON'];
  var startIdx = args.indexOf('--start');
  var startDate = startIdx >= 0 && args[startIdx + 1] ? args[startIdx + 1] : null;
  var endIdx = args.indexOf('--end');
  var endDate = endIdx >= 0 && args[endIdx + 1] ? args[endIdx + 1] : null;
  var skipExisting = !args.includes('--force');

  console.log(`\n${'='.repeat(50)}`);
  console.log(`Alpha Quant Pipeline: ${mode.toUpperCase()}`);
  console.log(`Tickers: ${tickers.join(', ')}`);
  if (startDate) console.log(`Range: ${startDate} to ${endDate}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`${'='.repeat(50)}`);

  if (mode === 'backfill') {
    if (!startDate || !endDate) { console.error('Backfill requires --start and --end dates'); process.exit(1); }
    await runBackfill(tickers, startDate, endDate, skipExisting);
  } else if (mode === 'nightly') {
    await runNightly(tickers);
  } else {
    await runHourly(tickers);
  }

  console.log('\nPipeline complete.');
}

main().catch(e => { console.error('Pipeline error:', e); process.exit(1); });
