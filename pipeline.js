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
  // Active-set: compact buffer of active level indices (avoids scanning all 10K+ levels per tick)
  var actBuf = new Int32Array(count); var actN = 0;
  for (var c = 0; c < count; c++) {
    lvlPrice[c] = (minCents + c) / 100;
    lvlTarget[c] = Math.ceil(lvlPrice[c] * (1 + tf) * 100) / 100;
    if (minCents + c >= openCents && minCents + c <= preSeedMaxCents) { lvlActive[c] = 1; actBuf[actN++] = c; }
  }
  for (var i = 1; i < trades.length; i++) {
    var p = trades[i].price;
    // SELL: scan only active levels
    var newN = 0;
    for (var ai = 0; ai < actN; ai++) {
      var j = actBuf[ai];
      if (p >= lvlTarget[j]) { lvlCycles[j]++; lvlActive[j] = 0; }
      else { actBuf[newN++] = j; }
    }
    // BUY: activate level at current price
    var idx = Math.floor(p * 100) - minCents;
    if (idx >= 0 && idx < count && lvlActive[idx] === 0) { lvlActive[idx] = 1; actBuf[newN++] = idx; }
    actN = newN;
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
  var actBuf = new Int32Array(cnt); var actN = 0;
  for (var c = 0; c < cnt; c++) { target[c] = Math.ceil((minC + c) / 100 * (1 + tf) * 100) / 100; if (minC + c >= openC && minC + c <= psC) { active[c] = 1; actBuf[actN++] = c; } }
  var hourCycles = {}; for (var h = 4; h < 20; h++) hourCycles[h] = 0;
  for (var i2 = 1; i2 < trades.length; i2++) {
    var p = trades[i2].price; var hr = toETHour(trades[i2].ts);
    var newN = 0;
    for (var ai = 0; ai < actN; ai++) {
      var j = actBuf[ai];
      if (p >= target[j]) { active[j] = 0; if (hourCycles[hr] !== undefined) hourCycles[hr]++; }
      else { actBuf[newN++] = j; }
    }
    var idx = Math.floor(p * 100) - minC; if (idx >= 0 && idx < cnt && active[idx] === 0) { active[idx] = 1; actBuf[newN++] = idx; }
    actN = newN;
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
  var actBuf = new Int32Array(cnt); var actN = 0;
  for (var c = 0; c < cnt; c++) { target[c] = Math.ceil((minC + c) / 100 * (1 + tf) * 100) / 100; if (minC + c >= openC && minC + c <= psC) { active[c] = 1; buyMs[c] = t0ms; actBuf[actN++] = c; } }
  var hourDur = {}; for (var h = 4; h < 20; h++) hourDur[h] = [];
  for (var i2 = 1; i2 < trades.length; i2++) {
    var p = trades[i2].price; var ts = trades[i2].ts; var ms = ts > 1e15 ? ts / 1e6 : ts > 1e12 ? ts / 1e3 : ts;
    var hr = getETHourFromMs(ms);
    var newN = 0;
    for (var ai = 0; ai < actN; ai++) {
      var j = actBuf[ai];
      if (p >= target[j]) { active[j] = 0; if (hr >= 4 && hr < 20 && buyMs[j] > 0) { var dur = (ms - buyMs[j]) / 60000; if (dur > 0 && dur < 960) hourDur[hr].push(dur); } buyMs[j] = 0; }
      else { actBuf[newN++] = j; }
    }
    var idx = Math.floor(p * 100) - minC; if (idx >= 0 && idx < cnt && active[idx] === 0) { active[idx] = 1; buyMs[idx] = ms; actBuf[newN++] = idx; }
    actN = newN;
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
    var url = 'https://api.polygon.io/v3/trades/' + ticker + '?timestamp.gte=' + w.from + '&timestamp.lt=' + w.to + '&limit=500000&sort=timestamp&order=asc&apiKey=' + POLYGON_KEY;
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
  var url = 'https://api.polygon.io/v3/trades/' + ticker + '?timestamp.gte=' + fromTs + '&timestamp.lt=' + toTs + '&limit=500000&sort=timestamp&order=asc&apiKey=' + POLYGON_KEY;
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
  if (!rows.length) return;
  // Step 1: DELETE existing
  var delR = await fetch(SB_URL + '/rest/v1/' + table + '?' + deleteFilter, { method: 'DELETE', headers: sbHeaders() });
  if (!delR.ok) console.log('    ' + label + ' DELETE ' + delR.status);
  // Step 2: Wait for DELETE to commit
  await sleep(300);
  // Step 3: INSERT in batches with full error logging
  var totalInserted = 0;
  for (var i = 0; i < rows.length; i += 200) {
    var batch = rows.slice(i, i + 200);
    var postR = await fetch(SB_URL + '/rest/v1/' + table, { method: 'POST', headers: Object.assign({}, sbHeaders(), { 'Prefer': 'return=minimal' }), body: JSON.stringify(batch) });
    if (postR.ok) {
      totalInserted += batch.length;
    } else {
      var errTxt = await postR.text();
      console.log('    ' + label + ' INSERT FAILED batch ' + i + '-' + (i + batch.length) + ': ' + postR.status + ' ' + errTxt.slice(0, 300));
      // Retry with longer delay
      await sleep(1000);
      var retryR = await fetch(SB_URL + '/rest/v1/' + table, { method: 'POST', headers: Object.assign({}, sbHeaders(), { 'Prefer': 'return=minimal' }), body: JSON.stringify(batch) });
      if (retryR.ok) { totalInserted += batch.length; console.log('    ' + label + ' retry OK'); }
      else { var retryErr = await retryR.text(); console.log('    ' + label + ' retry FAILED: ' + retryR.status + ' ' + retryErr.slice(0, 300)); }
    }
  }
  if (totalInserted < rows.length) console.log('    ' + label + ': only ' + totalInserted + '/' + rows.length + ' rows inserted');
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

      // Safety: stop before GitHub Actions timeout (5hr of 5h50m limit)
      var MAX_RUNTIME_SEC = 5 * 3600;
      if (elapsed > MAX_RUNTIME_SEC) {
        console.log('\n⏱ MAX RUNTIME REACHED (' + Math.round(elapsed / 60) + 'm). Stopping to allow auto-retrigger.');
        var remaining = days.length - di;
        console.log('  Remaining: ' + remaining + ' days for ' + ticker);
        await reportProgress({ status: 'complete', progress_pct: pct, days_processed: stats.processed, days_skipped: stats.skipped, days_error: stats.errors, total_ticks: stats.totalTicks, current_stage: 'done', message: 'Paused: ' + stats.processed + ' processed, ' + remaining + ' remaining. Will auto-resume.' });
        // Write marker file for GitHub Actions to detect
        require('fs').writeFileSync('/tmp/BACKFILL_INCOMPLETE', JSON.stringify({ ticker: ticker, remaining: remaining, start_date: date, end_date: endDate, processed: stats.processed }));
        return;
      }

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

        // Save cached_analyses via PostgREST upsert (no DELETE — merge only)
        var analysisBody = { ticker, trade_date: date, tp_pct: tpPct, session_type: 'all', total_cycles: result.summary.totalCycles, active_levels: result.summary.activeLevels, total_levels: result.summary.totalLevels, total_trades: trades.length, tick_min: minP, tick_max: maxP, open_price: sharePrice, pre_seed_max: preSeedMax };
        if (ohlc && ohlc.open) { analysisBody.ohlc_open = ohlc.open; analysisBody.ohlc_high = ohlc.high; analysisBody.ohlc_low = ohlc.low; analysisBody.ohlc_close = ohlc.close; analysisBody.ohlc_volume = ohlc.volume; }
        var upsertH = Object.assign({}, sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=representation' });
        var aR = await fetch(SB_URL + '/rest/v1/cached_analyses', { method: 'POST', headers: upsertH, body: JSON.stringify(analysisBody) });
        var analysisId = null;
        if (aR.ok) {
          var aData = await aR.json();
          analysisId = Array.isArray(aData) ? (aData[0]||{}).id : (aData||{}).id;
        } else {
          var aErr = await aR.text();
          console.log('  WARN: analyses upsert ' + aR.status + ': ' + aErr.slice(0, 200));
          // Fallback: try fetching existing ID
          var existA = await sbFetch('cached_analyses?ticker=eq.' + ticker + '&trade_date=eq.' + date + '&select=id&limit=1');
          analysisId = existA.length > 0 ? existA[0].id : null;
        }

        // Save cached_levels
        if (analysisId) {
          // Delete old levels for this analysis
          await fetch(SB_URL + '/rest/v1/cached_levels?analysis_id=eq.' + analysisId, { method: 'DELETE', headers: sbHeaders() });
          await sleep(100);
          var levelRows = [];
          for (var lv of result.levels || []) { if (lv && lv.cycles > 0) levelRows.push({ analysis_id: analysisId, level_price: lv.price, target_price: lv.target, cycles: lv.cycles }); }
          if (levelRows.length) {
            for (var li = 0; li < levelRows.length; li += 200) {
              var lvBatch = levelRows.slice(li, li + 200);
              var lvR = await fetch(SB_URL + '/rest/v1/cached_levels', { method: 'POST', headers: Object.assign({}, sbHeaders(), { 'Prefer': 'return=minimal' }), body: JSON.stringify(lvBatch) });
              if (!lvR.ok) console.log('    WARN: levels POST failed batch ' + li + ': ' + lvR.status);
            }
          }
          console.log('  Stage 1: ' + result.summary.totalCycles + ' cycles, ' + levelRows.length + ' active levels (ID: ' + analysisId + ')');
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
        console.log('  Stage 2: Scanning 100 TP% x 16 hours (' + trades.length + ' ticks, active-set optimized)...');
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
        await reportProgress({ current_day: date, ticker, progress_pct: pct, current_stage: 'stage2', message: ticker + ' ' + date + ': Stage 2 done (' + trades.length + ' ticks, 100 TP% x 16 hrs)' });
        await sbDeleteInsert('optimal_tp_hourly', 'ticker=eq.' + ticker + '&trade_date=eq.' + date, optRows, 'optimal');
        var hcDefault = computeHourlyCycles(trades, 1.0);
        var hcRows = [];
        for (var hh = 4; hh < 20; hh++) hcRows.push({ ticker, trade_date: date, hour: hh, tp_pct: 1.0, session_type: 'all', cycles: hcDefault[hh] || 0 });
        await sbDeleteInsert('cached_hourly_cycles', 'ticker=eq.' + ticker + '&trade_date=eq.' + date + '&tp_pct=eq.1&session_type=eq.all', hcRows, 'hourly_cycles');

        // Save cached_hourly_hold_times (cycle holding durations)
        {
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
        // Deduplicate by tp_dollar (UNIQUE constraint includes tp_dollar not tp_pct)
        var bySpread = {};
        for (var ddi = 0; ddi < dailyOptRows.length; ddi++) {
          var dk = dailyOptRows[ddi].tp_dollar.toFixed(2);
          if (!bySpread[dk] || dailyOptRows[ddi].net_total > bySpread[dk].net_total) bySpread[dk] = dailyOptRows[ddi];
        }
        var dedupedRows = []; for (var dsk in bySpread) dedupedRows.push(bySpread[dsk]);
        await sbDeleteInsert('cached_daily_optimal_tp', 'ticker=eq.' + ticker + '&trade_date=eq.' + date, dedupedRows, 'daily_optimal');
        console.log('  Stage 2b: ' + dedupedRows.length + ' daily optimal rows (deduped from 100)');

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
// ── AUTO-TUNE: Run all model/param combinations ──────────
async function runAutotune(tickers) {
  var runDate = new Date().toISOString().slice(0, 10);
  await reportProgress({ mode: 'autotune', ticker: tickers.join(','), status: 'running', progress_pct: 0, message: 'Starting auto-tune...' });

  var pearson = function(x, y) {
    if (x.length < 3) return 0;
    var n = x.length, sx = 0, sy = 0, sxy = 0, sx2 = 0, sy2 = 0;
    for (var i = 0; i < n; i++) { sx += x[i]; sy += y[i]; sxy += x[i] * y[i]; sx2 += x[i] * x[i]; sy2 += y[i] * y[i]; }
    var num = n * sxy - sx * sy; var d1 = n * sx2 - sx * sx; var d2 = n * sy2 - sy * sy;
    return (d1 > 0 && d2 > 0) ? num / Math.sqrt(d1 * d2) : 0;
  };

  var leadableKeys = ['is_rth', 'prev_hour_atr_pct', 'prev_hour_volume', 'prev_hour_trades', 'prev_hour_realized_vol', 'prev_hour_reversal_rate', 'prev_hour_trade_intensity', 'prev_hour_avg_trade_size', 'prev_hour_oscillation_score', 'prev_hour_ece', 'prev_hour_best_tp', 'prev_hour_trend_r2', 'prev_hour_return_entropy', 'prev_hour_order_flow_imbalance', 'prev_hour_vwap_deviation', 'prev_hour_hurst', 'prev_hour_autocorr', 'prev_hour_avg_run_length', 'overnight_gap_pct', 'vix_close', 'day_of_week', 'hour', 'cumulative_volume_pct', 'price_vs_day_open_pct', 'intraday_range_pct', 'hour_vol_pct_of_day'];

  // ── Model functions ──
  function runQuintile(trainD, testD, selFeat, weighted) {
    for (var si = 0; si < selFeat.length; si++) {
      var sf = selFeat[si]; var vals = [];
      for (var ti = 0; ti < trainD.length; ti++) { var v = parseFloat(trainD[ti][sf.key]); if (!isNaN(v)) vals.push({ v: v, tp: trainD[ti].best_tp_pct }); }
      vals.sort(function(a, b) { return a.v - b.v; });
      var quintiles = [];
      for (var qi = 0; qi < 5; qi++) {
        var qS = Math.floor(vals.length * qi / 5); var qE = Math.floor(vals.length * (qi + 1) / 5);
        var qV = vals.slice(qS, qE); var tS = 0;
        for (var qj = 0; qj < qV.length; qj++) tS += qV[qj].tp;
        quintiles.push({ min: qV[0].v, max: qV[qV.length - 1].v, avgTp: tS / qV.length });
      }
      sf.quintiles = quintiles;
    }
    var preds = [];
    for (var ti2 = 0; ti2 < testD.length; ti2++) {
      var pt = testD[ti2]; var tpPreds = []; var weights = [];
      for (var si2 = 0; si2 < selFeat.length; si2++) {
        var sf2 = selFeat[si2]; var val = parseFloat(pt[sf2.key]);
        if (isNaN(val)) continue;
        for (var qi2 = 0; qi2 < sf2.quintiles.length; qi2++) {
          var q = sf2.quintiles[qi2];
          if (val <= q.max || qi2 === 4) { tpPreds.push(q.avgTp); weights.push(Math.abs(sf2.rProfit)); break; }
        }
      }
      if (tpPreds.length > 0) {
        if (weighted) { var wS = 0, wT = 0; for (var pi = 0; pi < tpPreds.length; pi++) { wS += tpPreds[pi] * weights[pi]; wT += weights[pi]; } preds.push(wT > 0 ? Math.round(wS / wT * 100) / 100 : null); }
        else { var s = 0; for (var pi = 0; pi < tpPreds.length; pi++) s += tpPreds[pi]; preds.push(Math.round(s / tpPreds.length * 100) / 100); }
      } else preds.push(null);
    }
    return preds;
  }

  function runKNN(trainD, testD, selFeat, k) {
    var fStats = {};
    for (var si = 0; si < selFeat.length; si++) {
      var fk = selFeat[si].key; var mn = Infinity, mx = -Infinity;
      for (var ti = 0; ti < trainD.length; ti++) { var v = parseFloat(trainD[ti][fk]); if (!isNaN(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } }
      fStats[fk] = { range: mx - mn > 0 ? mx - mn : 1 };
    }
    var preds = [];
    for (var ti2 = 0; ti2 < testD.length; ti2++) {
      var pt = testD[ti2]; var dists = [];
      for (var tri = 0; tri < trainD.length; tri++) {
        var dist = 0; var validF = 0;
        for (var si2 = 0; si2 < selFeat.length; si2++) {
          var fk2 = selFeat[si2].key;
          var v1 = parseFloat(pt[fk2]); var v2 = parseFloat(trainD[tri][fk2]);
          if (!isNaN(v1) && !isNaN(v2)) { var d = (v1 - v2) / fStats[fk2].range; dist += d * d; validF++; }
        }
        if (validF > 0) dists.push({ dist: dist / validF, tp: trainD[tri].best_tp_pct });
      }
      dists.sort(function(a, b) { return a.dist - b.dist; });
      var topK = dists.slice(0, k);
      if (topK.length > 0) { var tS = 0; for (var ki = 0; ki < topK.length; ki++) tS += topK[ki].tp; preds.push(Math.round(tS / topK.length * 100) / 100); }
      else preds.push(null);
    }
    return preds;
  }

  function runLinearReg(trainD, testD, selFeat) {
    var models = [];
    for (var si = 0; si < selFeat.length; si++) {
      var fk = selFeat[si].key; var xs = [], ys = [];
      for (var ti = 0; ti < trainD.length; ti++) { var v = parseFloat(trainD[ti][fk]); if (!isNaN(v)) { xs.push(v); ys.push(trainD[ti].best_tp_pct); } }
      if (xs.length < 3) { models.push(null); continue; }
      var n = xs.length, sx = 0, sy = 0, sxy = 0, sx2 = 0;
      for (var i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxy += xs[i] * ys[i]; sx2 += xs[i] * xs[i]; }
      var denom = n * sx2 - sx * sx;
      if (Math.abs(denom) < 1e-12) { models.push(null); continue; }
      models.push({ slope: (n * sxy - sx * sy) / denom, intercept: (sy - ((n * sxy - sx * sy) / denom) * sx) / n, weight: Math.abs(selFeat[si].rProfit) });
    }
    var preds = [];
    for (var ti2 = 0; ti2 < testD.length; ti2++) {
      var pt = testD[ti2]; var tpPreds = []; var wts = [];
      for (var si2 = 0; si2 < selFeat.length; si2++) {
        if (!models[si2]) continue;
        var v = parseFloat(pt[selFeat[si2].key]); if (isNaN(v)) continue;
        var pred = Math.max(0.01, Math.min(1.0, models[si2].slope * v + models[si2].intercept));
        tpPreds.push(pred); wts.push(models[si2].weight);
      }
      if (tpPreds.length > 0) { var wS = 0, wT = 0; for (var pi = 0; pi < tpPreds.length; pi++) { wS += tpPreds[pi] * wts[pi]; wT += wts[pi]; } preds.push(wT > 0 ? Math.round(wS / wT * 100) / 100 : null); }
      else preds.push(null);
    }
    return preds;
  }

  // Model 5: Ensemble Average
  function runEnsemble(trainD, testD, selFeat) {
    var p1 = runQuintile(trainD, testD, selFeat, false);
    var p2 = runQuintile(trainD, testD, selFeat, true);
    var p3 = runKNN(trainD, testD, selFeat, 7);
    var p4 = runLinearReg(trainD, testD, selFeat);
    var preds = [];
    for (var i = 0; i < testD.length; i++) {
      var vals = []; if (p1[i] !== null) vals.push(p1[i]); if (p2[i] !== null) vals.push(p2[i]); if (p3[i] !== null) vals.push(p3[i]); if (p4[i] !== null) vals.push(p4[i]);
      if (vals.length > 0) { var s = 0; for (var j = 0; j < vals.length; j++) s += vals[j]; preds.push(Math.round(s / vals.length * 100) / 100); }
      else preds.push(null);
    }
    return preds;
  }

  // Model 6: Weighted KNN (inverse distance)
  function runWeightedKNN(trainD, testD, selFeat, k) {
    var fStats = {};
    for (var si = 0; si < selFeat.length; si++) {
      var fk = selFeat[si].key; var mn = Infinity, mx = -Infinity;
      for (var ti = 0; ti < trainD.length; ti++) { var v = parseFloat(trainD[ti][fk]); if (!isNaN(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } }
      fStats[fk] = { range: mx - mn > 0 ? mx - mn : 1 };
    }
    var preds = [];
    for (var ti2 = 0; ti2 < testD.length; ti2++) {
      var pt = testD[ti2]; var dists = [];
      for (var tri = 0; tri < trainD.length; tri++) {
        var dist = 0; var validF = 0;
        for (var si2 = 0; si2 < selFeat.length; si2++) {
          var fk2 = selFeat[si2].key; var v1 = parseFloat(pt[fk2]); var v2 = parseFloat(trainD[tri][fk2]);
          if (!isNaN(v1) && !isNaN(v2)) { var d = (v1 - v2) / fStats[fk2].range; dist += d * d; validF++; }
        }
        if (validF > 0) dists.push({ dist: Math.sqrt(dist / validF), tp: trainD[tri].best_tp_pct });
      }
      dists.sort(function(a, b) { return a.dist - b.dist; });
      var topK = dists.slice(0, k);
      if (topK.length > 0) {
        var wSum = 0, wTot = 0;
        for (var ki = 0; ki < topK.length; ki++) { var w = 1 / (topK[ki].dist + 0.001); wSum += topK[ki].tp * w; wTot += w; }
        preds.push(Math.round(wSum / wTot * 100) / 100);
      } else preds.push(null);
    }
    return preds;
  }

  // Model 7: Recency-Weighted KNN
  function runRecencyKNN(trainD, testD, selFeat, k) {
    var fStats = {};
    for (var si = 0; si < selFeat.length; si++) {
      var fk = selFeat[si].key; var mn = Infinity, mx = -Infinity;
      for (var ti = 0; ti < trainD.length; ti++) { var v = parseFloat(trainD[ti][fk]); if (!isNaN(v)) { if (v < mn) mn = v; if (v > mx) mx = v; } }
      fStats[fk] = { range: mx - mn > 0 ? mx - mn : 1 };
    }
    // Get all training dates for recency scoring
    var allDates = {}; for (var ti = 0; ti < trainD.length; ti++) allDates[trainD[ti].trade_date] = true;
    var dateArr = Object.keys(allDates).sort(); var dateRank = {}; for (var di = 0; di < dateArr.length; di++) dateRank[dateArr[di]] = di;
    var maxRank = dateArr.length - 1;
    var preds = [];
    for (var ti2 = 0; ti2 < testD.length; ti2++) {
      var pt = testD[ti2]; var dists = [];
      for (var tri = 0; tri < trainD.length; tri++) {
        var dist = 0; var validF = 0;
        for (var si2 = 0; si2 < selFeat.length; si2++) {
          var fk2 = selFeat[si2].key; var v1 = parseFloat(pt[fk2]); var v2 = parseFloat(trainD[tri][fk2]);
          if (!isNaN(v1) && !isNaN(v2)) { var d = (v1 - v2) / fStats[fk2].range; dist += d * d; validF++; }
        }
        var recency = maxRank > 0 ? (dateRank[trainD[tri].trade_date] || 0) / maxRank : 0.5;
        if (validF > 0) dists.push({ dist: Math.sqrt(dist / validF), tp: trainD[tri].best_tp_pct, recency: recency });
      }
      dists.sort(function(a, b) { return a.dist - b.dist; });
      var topK = dists.slice(0, k);
      if (topK.length > 0) {
        var wSum = 0, wTot = 0;
        for (var ki = 0; ki < topK.length; ki++) { var w = (1 / (topK[ki].dist + 0.001)) * (0.5 + topK[ki].recency); wSum += topK[ki].tp * w; wTot += w; }
        preds.push(Math.round(wSum / wTot * 100) / 100);
      } else preds.push(null);
    }
    return preds;
  }

  // Model 8: Decile Lookup (10 buckets)
  function runDecile(trainD, testD, selFeat, weighted) {
    var nBuckets = 10;
    for (var si = 0; si < selFeat.length; si++) {
      var sf = selFeat[si]; var vals = [];
      for (var ti = 0; ti < trainD.length; ti++) { var v = parseFloat(trainD[ti][sf.key]); if (!isNaN(v)) vals.push({ v: v, tp: trainD[ti].best_tp_pct }); }
      vals.sort(function(a, b) { return a.v - b.v; });
      var buckets = [];
      for (var qi = 0; qi < nBuckets; qi++) {
        var qS = Math.floor(vals.length * qi / nBuckets); var qE = Math.floor(vals.length * (qi + 1) / nBuckets);
        var qV = vals.slice(qS, Math.max(qS + 1, qE)); var tS = 0;
        for (var qj = 0; qj < qV.length; qj++) tS += qV[qj].tp;
        buckets.push({ min: qV[0].v, max: qV[qV.length - 1].v, avgTp: tS / qV.length });
      }
      sf.deciles = buckets;
    }
    var preds = [];
    for (var ti2 = 0; ti2 < testD.length; ti2++) {
      var pt = testD[ti2]; var tpPreds = []; var weights = [];
      for (var si2 = 0; si2 < selFeat.length; si2++) {
        var sf2 = selFeat[si2]; var val = parseFloat(pt[sf2.key]); if (isNaN(val)) continue;
        for (var qi2 = 0; qi2 < sf2.deciles.length; qi2++) {
          if (val <= sf2.deciles[qi2].max || qi2 === sf2.deciles.length - 1) { tpPreds.push(sf2.deciles[qi2].avgTp); weights.push(Math.abs(sf2.rProfit)); break; }
        }
      }
      if (tpPreds.length > 0) {
        if (weighted) { var wS = 0, wT = 0; for (var pi = 0; pi < tpPreds.length; pi++) { wS += tpPreds[pi] * weights[pi]; wT += weights[pi]; } preds.push(wT > 0 ? Math.round(wS / wT * 100) / 100 : null); }
        else { var s = 0; for (var pi = 0; pi < tpPreds.length; pi++) s += tpPreds[pi]; preds.push(Math.round(s / tpPreds.length * 100) / 100); }
      } else preds.push(null);
    }
    return preds;
  }

  // Model 9: Feature Bagging (random subsets averaged)
  function runFeatureBagging(trainD, testD, selFeat) {
    var nIters = 20; var subSize = Math.min(3, selFeat.length);
    var allPreds = [];
    // Simple deterministic "random" using feature index permutations
    for (var iter = 0; iter < nIters; iter++) {
      var subset = [];
      for (var si = 0; si < selFeat.length; si++) { if (((iter * 7 + si * 13) % 5) < 3) subset.push(selFeat[si]); }
      if (subset.length === 0) subset = [selFeat[iter % selFeat.length]];
      if (subset.length > subSize) subset = subset.slice(0, subSize);
      var iterPreds = runKNN(trainD, testD, subset, 7);
      allPreds.push(iterPreds);
    }
    var preds = [];
    for (var i = 0; i < testD.length; i++) {
      var vals = [];
      for (var j = 0; j < allPreds.length; j++) { if (allPreds[j][i] !== null) vals.push(allPreds[j][i]); }
      if (vals.length > 0) { var s = 0; for (var k = 0; k < vals.length; k++) s += vals[k]; preds.push(Math.round(s / vals.length * 100) / 100); }
      else preds.push(null);
    }
    return preds;
  }

  // Model 10: Regime-Switching (high/low vol separate models)
  function runRegimeSwitching(trainD, testD, selFeat) {
    // Split training data by ATR regime (above/below median)
    var atrVals = [];
    for (var ti = 0; ti < trainD.length; ti++) { var a = parseFloat(trainD[ti].prev_hour_atr_pct || trainD[ti].hour_atr_pct); if (!isNaN(a)) atrVals.push(a); }
    atrVals.sort(function(a, b) { return a - b; });
    var medianATR = atrVals.length > 0 ? atrVals[Math.floor(atrVals.length / 2)] : 0;
    var trainHigh = []; var trainLow = [];
    for (var ti = 0; ti < trainD.length; ti++) {
      var a = parseFloat(trainD[ti].prev_hour_atr_pct || trainD[ti].hour_atr_pct);
      if (!isNaN(a) && a >= medianATR) trainHigh.push(trainD[ti]); else trainLow.push(trainD[ti]);
    }
    // Build separate KNN models for each regime
    var preds = [];
    for (var ti2 = 0; ti2 < testD.length; ti2++) {
      var pt = testD[ti2];
      var a2 = parseFloat(pt.prev_hour_atr_pct || pt.hour_atr_pct);
      var useHigh = !isNaN(a2) && a2 >= medianATR;
      var regime = useHigh ? trainHigh : trainLow;
      if (regime.length < 5) regime = trainD; // fallback
      var knnPred = runKNN(regime, [pt], selFeat, 7);
      preds.push(knnPred[0]);
    }
    return preds;
  }

  var modelDefs = [
    { id: 'quintile', name: 'Quintile Lookup', fn: function(tr, te, sf) { return runQuintile(tr, te, sf, false); } },
    { id: 'weighted', name: 'Weighted Quintile', fn: function(tr, te, sf) { return runQuintile(tr, te, sf, true); } },
    { id: 'knn', name: 'KNN (K=7)', fn: function(tr, te, sf) { return runKNN(tr, te, sf, 7); } },
    { id: 'linear', name: 'Linear Regression', fn: function(tr, te, sf) { return runLinearReg(tr, te, sf); } },
    { id: 'ensemble', name: 'Ensemble Average', fn: function(tr, te, sf) { return runEnsemble(tr, te, sf); } },
    { id: 'wknn', name: 'Weighted KNN', fn: function(tr, te, sf) { return runWeightedKNN(tr, te, sf, 7); } },
    { id: 'rknn', name: 'Recency KNN', fn: function(tr, te, sf) { return runRecencyKNN(tr, te, sf, 7); } },
    { id: 'decile', name: 'Decile Lookup', fn: function(tr, te, sf) { return runDecile(tr, te, sf, true); } },
    { id: 'bagging', name: 'Feature Bagging', fn: function(tr, te, sf) { return runFeatureBagging(tr, te, sf); } },
    { id: 'regime', name: 'Regime Switch', fn: function(tr, te, sf) { return runRegimeSwitching(tr, te, sf); } }
  ];
  var topNs = [3, 5, 7, 10];
  var trainPcts = [60, 70, 80, 90];
  var totalCombos = modelDefs.length * topNs.length * trainPcts.length;

  for (var tIdx = 0; tIdx < tickers.length; tIdx++) {
    var ticker = tickers[tIdx];
    console.log('\n── Auto-Tune: ' + ticker + ' ──');
    await reportProgress({ mode: 'autotune', ticker: ticker, status: 'running', progress_pct: 0, message: 'Loading data for ' + ticker + '...' });

    // Load features
    var features = [];
    var fOff = 0;
    while (true) {
      var fb = await sbFetch('hourly_features?ticker=eq.' + ticker + '&select=*&order=trade_date.asc,hour.asc&limit=1000&offset=' + fOff);
      for (var fi = 0; fi < fb.length; fi++) features.push(fb[fi]);
      if (fb.length < 1000) break;
      fOff += 1000;
    }
    if (!features.length) { console.log('  No features for ' + ticker); continue; }
    console.log('  Features: ' + features.length + ' rows');

    // Load optimal TP% — stream directly into lookups (don't store raw rows)
    var bestTP = {};
    var allTP = {};
    var optCount = 0;
    var oOff = 0;
    console.log('  Loading optimal TP% (paginated)...');
    while (true) {
      try {
        var oUrl = 'optimal_tp_hourly?ticker=eq.' + ticker + '&select=trade_date,hour,tp_pct,net_profit&order=trade_date.asc,hour.asc,net_profit.desc&limit=1000&offset=' + oOff;
        var ob = await sbFetch(oUrl);
        if (!ob || !ob.length) { if (oOff === 0) console.log('  WARN: First optimal fetch returned empty'); break; }
        for (var oi = 0; oi < ob.length; oi++) {
          var ok = ob[oi].trade_date + '|' + ob[oi].hour;
          if (!bestTP[ok]) bestTP[ok] = { tp: ob[oi].tp_pct, np: ob[oi].net_profit };
          allTP[ok + '|' + parseFloat(ob[oi].tp_pct).toFixed(2)] = ob[oi].net_profit;
          optCount++;
        }
        if (ob.length < 1000) break;
        oOff += 1000;
        if (oOff % 10000 === 0) console.log('  Optimal: ' + optCount + ' rows loaded...');
        if (oOff % 50000 === 0) await reportProgress({ mode: 'autotune', ticker: ticker, status: 'running', progress_pct: 0, message: 'Loading optimal TP%: ' + optCount + ' rows...' });
      } catch (loadErr) {
        console.log('  ERROR loading optimal at offset ' + oOff + ': ' + loadErr.message);
        break;
      }
    }
    if (optCount === 0) { console.log('  No optimal TP% for ' + ticker); continue; }
    console.log('  Optimal: ' + optCount + ' rows -> ' + Object.keys(bestTP).length + ' hours');

    // Join features with best TP% + derive prev_hour
    var joined = []; var dates = {};
    for (var i = 0; i < features.length; i++) {
      var fk = features[i].trade_date + '|' + features[i].hour;
      if (bestTP[fk]) {
        var row = Object.assign({}, features[i]);
        row.best_tp_pct = bestTP[fk].tp; row.best_net_profit = bestTP[fk].np;
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
          row.prev_hour_trend_r2 = parseFloat(ph.hour_trend_r2) || null;
          row.prev_hour_return_entropy = parseFloat(ph.hour_return_entropy) || null;
          row.prev_hour_order_flow_imbalance = parseFloat(ph.hour_order_flow_imbalance) || null;
          row.prev_hour_vwap_deviation = parseFloat(ph.hour_vwap_deviation) || null;
          row.prev_hour_hurst = parseFloat(ph.hour_hurst_exponent) || null;
          row.prev_hour_autocorr = parseFloat(ph.hour_return_autocorr) || null;
          row.prev_hour_avg_run_length = parseFloat(ph.hour_avg_run_length) || null;
        }
        row.is_rth = (parseInt(row.hour) >= 9 && parseInt(row.hour) < 16) ? 1 : 0;
        row.hour_vol_pct_of_day = (parseFloat(row.hour_volume) || 0) / (parseFloat(row.day_volume) || 1) * 100;
        joined.push(row); dates[row.trade_date] = true;
      }
    }
    var dayList = Object.keys(dates).sort();
    console.log('  Joined: ' + joined.length + ' points across ' + dayList.length + ' days');
    if (joined.length < 20) { console.log('  Too few data points, skipping'); continue; }

    // Delete old leaderboard for this ticker+date
    await fetch(SB_URL + '/rest/v1/prediction_leaderboard?ticker=eq.' + ticker + '&run_date=eq.' + runDate, { method: 'DELETE', headers: sbHeaders() });
    await sleep(200);

    var comboNum = 0;
    var leaderboardRows = [];

    for (var mi = 0; mi < modelDefs.length; mi++) {
      for (var ni = 0; ni < topNs.length; ni++) {
        for (var pi = 0; pi < trainPcts.length; pi++) {
          comboNum++;
          var model = modelDefs[mi];
          var topN = topNs[ni];
          var trainPct = trainPcts[pi];
          var pct = Math.round(comboNum / totalCombos * 100);

          // Train/test split
          var trainDays = Math.max(3, Math.floor(dayList.length * trainPct / 100));
          var trainDateSet = {}; for (var di = 0; di < trainDays; di++) trainDateSet[dayList[di]] = true;
          var train = []; var test = [];
          for (var ji = 0; ji < joined.length; ji++) {
            if (trainDateSet[joined[ji].trade_date]) train.push(joined[ji]); else test.push(joined[ji]);
          }
          if (train.length < 5 || test.length < 1) continue;

          // Feature selection
          var featureCorrs = [];
          for (var fci = 0; fci < leadableKeys.length; fci++) {
            var fKey = leadableKeys[fci]; var xv = []; var yp = [];
            for (var ti = 0; ti < train.length; ti++) { var v = parseFloat(train[ti][fKey]); if (!isNaN(v)) { xv.push(v); yp.push(train[ti].best_net_profit); } }
            if (xv.length >= 5) featureCorrs.push({ key: fKey, rProfit: pearson(xv, yp) });
          }
          featureCorrs.sort(function(a, b) { return Math.abs(b.rProfit) - Math.abs(a.rProfit); });
          var selFeat = featureCorrs.slice(0, topN);
          if (selFeat.length === 0) continue;

          // Run model
          var modelPreds = model.fn(train, test, selFeat);

          // Flat benchmark
          var flatScores = {};
          for (var tpInt = 1; tpInt <= 100; tpInt++) {
            var tpVal = (tpInt / 100).toFixed(2); var totalNp = 0;
            for (var ti2 = 0; ti2 < test.length; ti2++) { var lk = test[ti2].trade_date + '|' + test[ti2].hour + '|' + tpVal; if (allTP[lk] !== undefined) totalNp += allTP[lk]; }
            flatScores[tpVal] = totalNp;
          }
          var flatTp = 0.01; var flatBest = -Infinity;
          for (var tp in flatScores) { if (flatScores[tp] > flatBest) { flatBest = flatScores[tp]; flatTp = parseFloat(tp); } }

          // Evaluate
          var predProfit = 0; var flatProfit = 0; var actualProfit = 0; var wins = 0;
          for (var ti3 = 0; ti3 < test.length; ti3++) {
            var pt = test[ti3]; var predTp = modelPreds[ti3];
            var dk = pt.trade_date + '|' + pt.hour;
            var predNp = 0; var flatNp = 0;
            if (predTp !== null) {
              var predKey = dk + '|' + predTp.toFixed(2);
              if (allTP[predKey] !== undefined) predNp = allTP[predKey];
              else { var bDist = Infinity; for (var tpS = 1; tpS <= 100; tpS++) { var tpR = (tpS / 100).toFixed(2); var lk2 = dk + '|' + tpR; if (allTP[lk2] !== undefined && Math.abs(parseFloat(tpR) - predTp) < bDist) { bDist = Math.abs(parseFloat(tpR) - predTp); predNp = allTP[lk2]; } } }
            }
            var flatLk = dk + '|' + flatTp.toFixed(2);
            if (allTP[flatLk] !== undefined) flatNp = allTP[flatLk];
            if (predNp > flatNp) wins++;
            predProfit += predNp; flatProfit += flatNp; actualProfit += pt.best_net_profit;
          }

          var edge = predProfit - flatProfit;
          var edgePct = flatProfit !== 0 ? (edge / Math.abs(flatProfit)) * 100 : 0;
          var winRate = test.length > 0 ? (wins / test.length * 100) : 0;
          var captureRate = actualProfit !== 0 ? (predProfit / actualProfit * 100) : 0;
          var testDays = dayList.length - trainDays;

          leaderboardRows.push({
            ticker: ticker, model: model.id, top_n: topN, train_pct: trainPct,
            edge_dollars: Math.round(edge * 100) / 100, edge_pct: Math.round(edgePct * 10) / 10,
            win_rate: Math.round(winRate * 10) / 10, capture_rate: Math.round(captureRate * 10) / 10,
            predicted_profit: Math.round(predProfit * 100) / 100, flat_profit: Math.round(flatProfit * 100) / 100,
            actual_profit: Math.round(actualProfit * 100) / 100, flat_tp: flatTp,
            test_days: testDays, test_points: test.length, train_points: train.length,
            wins: wins, run_date: runDate
          });

          if (comboNum % 4 === 0 || comboNum === totalCombos) {
            await reportProgress({ mode: 'autotune', ticker: ticker, status: 'running', progress_pct: pct, message: model.name + ' | N=' + topN + ' | Train ' + trainPct + '% | ' + comboNum + '/' + totalCombos });
          }
        }
      }
    }

    // Save leaderboard
    console.log('  Saving ' + leaderboardRows.length + ' leaderboard rows...');
    await sbDeleteInsert('prediction_leaderboard', 'ticker=eq.' + ticker + '&run_date=eq.' + runDate, leaderboardRows, 'leaderboard');

    // Log top 5
    leaderboardRows.sort(function(a, b) { return b.edge_dollars - a.edge_dollars; });
    console.log('\n  TOP 5 BY EDGE $:');
    for (var ri = 0; ri < Math.min(5, leaderboardRows.length); ri++) {
      var r = leaderboardRows[ri];
      console.log('  ' + (ri + 1) + '. ' + r.model + ' N=' + r.top_n + ' T=' + r.train_pct + '% | Edge: $' + r.edge_dollars + ' (' + r.edge_pct + '%) | Win: ' + r.win_rate + '% | Capture: ' + r.capture_rate + '%');
    }
  }

  await reportProgress({ mode: 'autotune', ticker: tickers.join(','), status: 'complete', progress_pct: 100, message: 'Auto-tune complete: ' + totalCombos + ' combinations tested' });
}

// ── SCREENER: Stock Oscillation Scanner ──────────────────
async function runScreener() {
  var scanDate = new Date().toISOString().slice(0, 10);
  await reportProgress({ mode: 'screener', ticker: 'ALL', status: 'running', progress_pct: 0, message: 'Starting oscillation screener...' });

  // Step 1: Get last 25 trading days of grouped daily bars (all US stocks in one call per day)
  var LOOKBACK = 25;
  var days = [];
  var d = new Date(); d.setDate(d.getDate() - 1); // start yesterday
  while (days.length < LOOKBACK + 10) { // extra buffer for weekends/holidays
    var dow = d.getDay();
    if (dow !== 0 && dow !== 6) days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
  }
  days = days.slice(0, LOOKBACK + 5); // take enough to get 20 valid days
  days.reverse(); // oldest first

  console.log('Fetching ' + days.length + ' days of grouped daily bars...');
  var tickerData = {}; // ticker -> [{o,h,l,c,v,date}]

  for (var di = 0; di < days.length; di++) {
    var date = days[di];
    var pct = Math.round((di / days.length) * 30);
    await reportProgress({ mode: 'screener', ticker: 'ALL', status: 'running', progress_pct: pct, message: 'Fetching grouped daily: ' + date + ' (' + (di + 1) + '/' + days.length + ')' });
    try {
      var url = 'https://api.polygon.io/v2/aggs/grouped/locale/us/market/stocks/' + date + '?adjusted=true&apiKey=' + POLYGON_KEY;
      var r = await fetch(url);
      if (!r.ok) { console.log('  Grouped daily ' + date + ': HTTP ' + r.status); continue; }
      var body = await r.json();
      if (!body.results) { console.log('  Grouped daily ' + date + ': no results (holiday?)'); continue; }
      for (var i = 0; i < body.results.length; i++) {
        var bar = body.results[i];
        var tk = bar.T;
        if (!tk || tk.indexOf('.') >= 0 || tk.indexOf('/') >= 0 || tk.length > 5) continue; // skip warrants, classes, etc
        if (!tickerData[tk]) tickerData[tk] = [];
        tickerData[tk].push({ o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v || 0, date: date });
      }
    } catch (e) { console.log('  Grouped daily ' + date + ' error: ' + e.message); }
    await sleep(250); // rate limit
  }

  var allTickers = Object.keys(tickerData);
  console.log('Tickers with data: ' + allTickers.length);

  // Step 1b: Fetch market cap data from Polygon reference tickers
  console.log('Fetching market cap data...');
  await reportProgress({ mode: 'screener', ticker: 'ALL', status: 'running', progress_pct: 32, message: 'Fetching market cap data...' });
  var mcapMap = {};
  var typeMap = {};
  var mcUrl = 'https://api.polygon.io/v3/reference/tickers?market=stocks&active=true&limit=1000&apiKey=' + POLYGON_KEY;
  var mcPages = 0;
  while (mcUrl && mcPages < 50) {
    try {
      var mcR = await fetch(mcUrl);
      if (!mcR.ok) break;
      var mcD = await mcR.json();
      if (mcD.results) for (var mi = 0; mi < mcD.results.length; mi++) {
        var mTk = mcD.results[mi];
        if (mTk.ticker && mTk.market_cap) mcapMap[mTk.ticker] = mTk.market_cap;
        if (mTk.ticker && mTk.type) typeMap[mTk.ticker] = mTk.type;
      }
      mcUrl = mcD.next_url ? mcD.next_url + '&apiKey=' + POLYGON_KEY : null;
      mcPages++;
      if (mcPages % 10 === 0) await sleep(250);
    } catch (e) { console.log('  Market cap fetch error: ' + e.message); break; }
  }
  console.log('Market cap data for ' + Object.keys(mcapMap).length + ' tickers (' + mcPages + ' pages)');

  // Step 2: Filter to liquid stocks (ADV > $10M, price > $3, >= 15 days data)
  var MIN_ADV = 10000000;
  var MIN_PRICE = 3;
  var MIN_DAYS = 15;
  var candidates = [];

  for (var ti = 0; ti < allTickers.length; ti++) {
    var tk = allTickers[ti];
    var bars = tickerData[tk];
    if (bars.length < MIN_DAYS) continue;
    var lastPrice = bars[bars.length - 1].c;
    if (lastPrice < MIN_PRICE) continue;
    var totalDolVol = 0;
    for (var bi = 0; bi < bars.length; bi++) totalDolVol += bars[bi].v * ((bars[bi].h + bars[bi].l) / 2);
    var adv = totalDolVol / bars.length;
    if (adv < MIN_ADV) continue;
    candidates.push({ ticker: tk, bars: bars, price: lastPrice, adv: adv, market_cap: mcapMap[tk] || null, ticker_type: typeMap[tk] || null });
  }
  console.log('Candidates after filter: ' + candidates.length);
  
  // Limit to top ~2500 by ADV (S&P 500 + Russell 2000 equivalent)
  if (candidates.length > 2500) {
    candidates.sort(function(a, b) { return b.adv - a.adv; });
    candidates = candidates.slice(0, 2500);
    console.log('Trimmed to top 2500 by ADV');
  }
  
  // Fetch individual market cap for candidates missing from grouped fetch
  var missingMcap = candidates.filter(function(c) { return !c.market_cap; });
  if (missingMcap.length > 0) {
    console.log('Fetching individual market cap for ' + missingMcap.length + ' candidates...');
    var mcUpdated = 0;
    for (var mi2 = 0; mi2 < missingMcap.length; mi2++) {
      try {
        var tkR = await fetch('https://api.polygon.io/v3/reference/tickers/' + missingMcap[mi2].ticker + '?apiKey=' + POLYGON_KEY);
        if (tkR.ok) { var tkD = await tkR.json(); if (tkD.results && tkD.results.market_cap) { missingMcap[mi2].market_cap = tkD.results.market_cap; mcUpdated++; } if (tkD.results && tkD.results.type && !missingMcap[mi2].ticker_type) missingMcap[mi2].ticker_type = tkD.results.type; }
      } catch (e) {}
      if (mi2 % 5 === 0) await sleep(100);
      if (mi2 % 200 === 0) {
        console.log('  Market cap: ' + mi2 + '/' + missingMcap.length + ' (' + mcUpdated + ' found)');
        await reportProgress({ mode: 'screener', ticker: 'ALL', status: 'running', progress_pct: 33 + Math.round((mi2 / missingMcap.length) * 5), message: 'Fetching market cap: ' + mi2 + '/' + missingMcap.length });
      }
    }
    console.log('Market cap fetched: ' + mcUpdated + '/' + missingMcap.length);
  }

  await reportProgress({ mode: 'screener', ticker: 'ALL', status: 'running', progress_pct: 35, message: 'Computing metrics for ' + candidates.length + ' stocks...' });

  // Step 3: Compute metrics for each candidate
  var results = [];
  for (var ci = 0; ci < candidates.length; ci++) {
    var cand = candidates[ci];
    var bars = cand.bars;
    var n = bars.length;

    // ATR%
    var atrSum = 0;
    for (var i = 1; i < n; i++) {
      var tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
      atrSum += tr;
    }
    var atr = atrSum / (n - 1);
    var atrPct = (atr / cand.price) * 100;

    // Yang-Zhang Volatility
    var logOC = [], logCO = [], logHL = [];
    for (var i = 0; i < n; i++) {
      logOC.push(Math.log(bars[i].c / bars[i].o));
      if (i > 0) logCO.push(Math.log(bars[i].o / bars[i - 1].c));
      logHL.push(Math.log(bars[i].h / bars[i].l));
    }
    var meanOC = 0; for (var i = 0; i < logOC.length; i++) meanOC += logOC[i]; meanOC /= logOC.length;
    var varOC = 0; for (var i = 0; i < logOC.length; i++) varOC += (logOC[i] - meanOC) * (logOC[i] - meanOC); varOC /= (logOC.length - 1);
    var meanCO = 0; for (var i = 0; i < logCO.length; i++) meanCO += logCO[i]; meanCO /= logCO.length;
    var varCO = 0; for (var i = 0; i < logCO.length; i++) varCO += (logCO[i] - meanCO) * (logCO[i] - meanCO); varCO /= Math.max(1, logCO.length - 1);
    var k = 0.34 / (1.34 + (n + 1) / (n - 1));
    var varRS = 0; for (var i = 0; i < n; i++) { var u = Math.log(bars[i].h / bars[i].o); var d2 = Math.log(bars[i].l / bars[i].o); varRS += u * (u - Math.log(bars[i].c / bars[i].o)) + d2 * (d2 - Math.log(bars[i].c / bars[i].o)); } varRS /= n;
    var yzVar = varCO + k * varOC + (1 - k) * varRS;
    var yzVol = Math.sqrt(Math.max(0, yzVar) * 252) * 100; // annualized %

    // Parkinson Volatility
    var parkSum = 0;
    for (var i = 0; i < n; i++) { var lhl = Math.log(bars[i].h / bars[i].l); parkSum += lhl * lhl; }
    var parkVol = Math.sqrt(parkSum / (n * 4 * Math.log(2)) * 252) * 100;

    // Hurst Exponent (R/S analysis on daily returns)
    var returns = [];
    for (var i = 1; i < n; i++) returns.push(Math.log(bars[i].c / bars[i - 1].c));
    var hurst = 0.5; // default random walk
    if (returns.length >= 10) {
      var winSizes = [4, 6, 8, 10];
      var logN = [], logRS = [];
      for (var wi = 0; wi < winSizes.length; wi++) {
        var ws = winSizes[wi];
        if (ws > returns.length) continue;
        var rsVals = [];
        for (var start = 0; start + ws <= returns.length; start += ws) {
          var seg = returns.slice(start, start + ws);
          var mean = 0; for (var j = 0; j < seg.length; j++) mean += seg[j]; mean /= seg.length;
          var cumDev = 0, maxD = -Infinity, minD = Infinity, ss = 0;
          for (var j = 0; j < seg.length; j++) { cumDev += seg[j] - mean; if (cumDev > maxD) maxD = cumDev; if (cumDev < minD) minD = cumDev; ss += (seg[j] - mean) * (seg[j] - mean); }
          var stdDev = Math.sqrt(ss / seg.length);
          if (stdDev > 0) rsVals.push((maxD - minD) / stdDev);
        }
        if (rsVals.length > 0) { var avgRS = 0; for (var j = 0; j < rsVals.length; j++) avgRS += rsVals[j]; avgRS /= rsVals.length; logN.push(Math.log(ws)); logRS.push(Math.log(avgRS)); }
      }
      if (logN.length >= 2) {
        var sX = 0, sY = 0, sXY = 0, sX2 = 0, nP = logN.length;
        for (var j = 0; j < nP; j++) { sX += logN[j]; sY += logRS[j]; sXY += logN[j] * logRS[j]; sX2 += logN[j] * logN[j]; }
        var denom = nP * sX2 - sX * sX;
        if (Math.abs(denom) > 1e-12) hurst = (nP * sXY - sX * sY) / denom;
        hurst = Math.max(0, Math.min(1, hurst));
      }
    }

    // Oscillation/Drift Ratio
    var totalRange = 0, netDrift = 0;
    for (var i = 0; i < n; i++) totalRange += bars[i].h - bars[i].l;
    netDrift = Math.abs(bars[n - 1].c - bars[0].o);
    var oscDrift = netDrift > 0 ? totalRange / netDrift : totalRange > 0 ? 99 : 0;

    // Reversal %
    var reversals = 0;
    for (var i = 2; i < n; i++) {
      var prev = bars[i - 1].c - bars[i - 2].c;
      var curr = bars[i].c - bars[i - 1].c;
      if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) reversals++;
    }
    var reversalPct = n > 2 ? (reversals / (n - 2)) * 100 : 0;

    // Composite Grid Score (0-100)
    var hurstScore = Math.max(0, Math.min(100, (0.5 - hurst) * 200 + 50)); // H=0.3 -> 90, H=0.5 -> 50, H=0.7 -> 10
    var atrScore = Math.min(100, atrPct * 20); // 5% ATR -> 100
    var oscScore2 = Math.min(100, oscDrift * 10); // ratio 10 -> 100
    var revScore = Math.min(100, reversalPct * 2); // 50% -> 100
    var yzScore = Math.min(100, yzVol * 1.5); // 66% annualized -> 100
    var gridScore = hurstScore * 0.30 + atrScore * 0.25 + oscScore2 * 0.25 + revScore * 0.10 + yzScore * 0.10;
    gridScore = Math.round(gridScore * 10) / 10;

    results.push({
      ticker: cand.ticker, price: Math.round(cand.price * 100) / 100,
      adv_dollars: Math.round(cand.adv), market_cap: cand.market_cap ? Math.round(cand.market_cap) : null,
      ticker_type: cand.ticker_type || null,
      yz_vol: Math.round(yzVol * 10) / 10,
      parkinson_vol: Math.round(parkVol * 10) / 10, hurst: Math.round(hurst * 1000) / 1000,
      atr_pct: Math.round(atrPct * 100) / 100, osc_drift_ratio: Math.round(oscDrift * 10) / 10,
      reversal_pct: Math.round(reversalPct * 10) / 10, osc_score: gridScore,
      days_sampled: n, scan_date: scanDate
    });

    if (ci % 200 === 0) {
      var pct2 = 35 + Math.round((ci / candidates.length) * 25);
      await reportProgress({ mode: 'screener', ticker: 'ALL', status: 'running', progress_pct: pct2, message: 'Daily metrics: ' + ci + '/' + candidates.length + ' stocks' });
    }
  }

  // Step 3b: Fetch 1-min bars for intraday metrics
  console.log('\nFetching 1-min intraday bars for ' + results.length + ' stocks...');
  var intradayFrom = days[Math.max(0, days.length - 6)]; // last 5 trading days
  var intradayTo = days[days.length - 1];
  var processed5m = 0;

  for (var ri = 0; ri < results.length; ri++) {
    var res = results[ri];
    try {
      var url5 = 'https://api.polygon.io/v2/aggs/ticker/' + res.ticker + '/range/1/minute/' + intradayFrom + '/' + intradayTo + '?adjusted=true&sort=asc&limit=50000&apiKey=' + POLYGON_KEY;
      var r5 = await fetch(url5);
      if (!r5.ok) { res.intraday_hurst = null; res.intraday_osc_ratio = null; res.intraday_reversal_rate = null; res.avg_vwap_crossings = null; continue; }
      var d5 = await r5.json();
      var bars5 = d5.results || [];
      if (bars5.length < 20) { res.intraday_hurst = null; res.intraday_osc_ratio = null; res.intraday_reversal_rate = null; res.avg_vwap_crossings = null; continue; }

      // Compute 1-min returns
      var returns5 = [];
      for (var bi5 = 1; bi5 < bars5.length; bi5++) {
        if (bars5[bi5 - 1].c > 0) returns5.push(Math.log(bars5[bi5].c / bars5[bi5 - 1].c));
      }

      // Intraday Hurst (R/S on 1-min returns)
      var iHurst = 0.5;
      if (returns5.length >= 20) {
        var iWins = [10, 20, 40, 80, 120, 200];
        var iLogN = [], iLogRS = [];
        for (var wi = 0; wi < iWins.length; wi++) {
          var ws = iWins[wi]; if (ws > returns5.length) continue;
          var rsV = [];
          for (var st = 0; st + ws <= returns5.length; st += ws) {
            var seg = returns5.slice(st, st + ws);
            var mn2 = 0; for (var j = 0; j < seg.length; j++) mn2 += seg[j]; mn2 /= seg.length;
            var cum = 0, mxC = -Infinity, mnC = Infinity, ss = 0;
            for (var j = 0; j < seg.length; j++) { cum += seg[j] - mn2; if (cum > mxC) mxC = cum; if (cum < mnC) mnC = cum; ss += (seg[j] - mn2) * (seg[j] - mn2); }
            var sd = Math.sqrt(ss / seg.length);
            if (sd > 0) rsV.push((mxC - mnC) / sd);
          }
          if (rsV.length > 0) { var avg = 0; for (var j = 0; j < rsV.length; j++) avg += rsV[j]; avg /= rsV.length; iLogN.push(Math.log(ws)); iLogRS.push(Math.log(avg)); }
        }
        if (iLogN.length >= 2) {
          var sX2 = 0, sY2 = 0, sXY2 = 0, sX22 = 0, nP2 = iLogN.length;
          for (var j = 0; j < nP2; j++) { sX2 += iLogN[j]; sY2 += iLogRS[j]; sXY2 += iLogN[j] * iLogRS[j]; sX22 += iLogN[j] * iLogN[j]; }
          var den2 = nP2 * sX22 - sX2 * sX2;
          if (Math.abs(den2) > 1e-12) iHurst = (nP2 * sXY2 - sX2 * sY2) / den2;
          iHurst = Math.max(0, Math.min(1, iHurst));
        }
      }

      // Intraday Oscillation Ratio: sum of |1-min moves| / |net move| per day
      // Group bars by day (ET-aware to avoid cross-day contamination)
      var etDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });
      var dayBars = {};
      for (var bi5 = 0; bi5 < bars5.length; bi5++) {
        var bDate = etDateFmt.format(new Date(bars5[bi5].t));
        if (!dayBars[bDate]) dayBars[bDate] = [];
        dayBars[bDate].push(bars5[bi5]);
      }
      var oscRatios = []; var revRates = []; var vwapCross = [];
      var dayKeys = Object.keys(dayBars);
      for (var dk = 0; dk < dayKeys.length; dk++) {
        var db = dayBars[dayKeys[dk]];
        if (db.length < 5) continue;
        // Oscillation ratio for this day
        var sumAbsMoves = 0; var netMove = Math.abs(db[db.length - 1].c - db[0].o);
        for (var bi5 = 1; bi5 < db.length; bi5++) sumAbsMoves += Math.abs(db[bi5].c - db[bi5 - 1].c);
        oscRatios.push(netMove > 0 ? sumAbsMoves / netMove : sumAbsMoves > 0 ? 99 : 0);
        // Reversal rate for this day
        var revs = 0;
        for (var bi5 = 2; bi5 < db.length; bi5++) {
          var prev = db[bi5 - 1].c - db[bi5 - 2].c;
          var curr = db[bi5].c - db[bi5 - 1].c;
          if ((prev > 0 && curr < 0) || (prev < 0 && curr > 0)) revs++;
        }
        revRates.push(db.length > 2 ? (revs / (db.length - 2)) * 100 : 0);
        // VWAP crossings: compute VWAP then count crosses
        var cumVol = 0, cumPV = 0, crosses = 0, prevSide = 0;
        for (var bi5 = 0; bi5 < db.length; bi5++) {
          cumVol += db[bi5].v || 0; cumPV += ((db[bi5].h + db[bi5].l + db[bi5].c) / 3) * (db[bi5].v || 0);
          var vwap = cumVol > 0 ? cumPV / cumVol : db[bi5].c;
          var side = db[bi5].c >= vwap ? 1 : -1;
          if (prevSide !== 0 && side !== prevSide) crosses++;
          prevSide = side;
        }
        vwapCross.push(crosses);
      }

      var avgOscRatio = 0; if (oscRatios.length > 0) { for (var j = 0; j < oscRatios.length; j++) avgOscRatio += oscRatios[j]; avgOscRatio /= oscRatios.length; }
      var avgRevRate = 0; if (revRates.length > 0) { for (var j = 0; j < revRates.length; j++) avgRevRate += revRates[j]; avgRevRate /= revRates.length; }
      var avgCrossings = 0; if (vwapCross.length > 0) { for (var j = 0; j < vwapCross.length; j++) avgCrossings += vwapCross[j]; avgCrossings /= vwapCross.length; }

      // Expected Completed Excursion (ECE): avg size of each directional run
      // Track consecutive moves in same direction, measure size when direction reverses
      var allExcursions = [];
      for (var dk2 = 0; dk2 < dayKeys.length; dk2++) {
        var db2 = dayBars[dayKeys[dk2]];
        if (db2.length < 5) continue;
        var runStart = db2[0].c;
        var runDir = 0; // 0=none, 1=up, -1=down
        for (var bi6 = 1; bi6 < db2.length; bi6++) {
          var move = db2[bi6].c - db2[bi6 - 1].c;
          var dir = move > 0 ? 1 : move < 0 ? -1 : 0;
          if (dir === 0) continue;
          if (runDir === 0) { runDir = dir; runStart = db2[bi6 - 1].c; }
          else if (dir !== runDir) {
            // Direction reversed — completed excursion
            var excSize = Math.abs(db2[bi6 - 1].c - runStart);
            if (excSize > 0) allExcursions.push(excSize);
            runStart = db2[bi6 - 1].c;
            runDir = dir;
          }
        }
      }
      var avgExcDollar = 0;
      if (allExcursions.length > 0) { for (var j = 0; j < allExcursions.length; j++) avgExcDollar += allExcursions[j]; avgExcDollar /= allExcursions.length; }
      var avgExcPct = res.price > 0 ? (avgExcDollar / res.price) * 100 : 0;
      var oscPerDay = dayKeys.length > 0 ? Math.round(allExcursions.length / dayKeys.length * 10) / 10 : 0;

      res.intraday_hurst = Math.round(iHurst * 1000) / 1000;
      res.intraday_osc_ratio = Math.round(avgOscRatio * 10) / 10;
      res.intraday_reversal_rate = Math.round(avgRevRate * 10) / 10;
      res.avg_vwap_crossings = Math.round(avgCrossings * 10) / 10;
      res.avg_osc_pct = Math.round(avgExcPct * 1000) / 1000;
      res.avg_osc_dollar = Math.round(avgExcDollar * 100) / 100;
      res.osc_per_day = oscPerDay;

      // Per-session metrics
      var sessionDefs = {pre:[4,0,9,30],rth:[9,30,16,0],post:[16,0,20,0],night:[20,0,24,0],morning:[0,0,4,0]};
      var sesKeys = Object.keys(sessionDefs);
      var sesMetrics = {};
      var etFmt2 = new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'numeric',hour12:false});
      for (var si = 0; si < sesKeys.length; si++) {
        var sk = sesKeys[si]; var sd2 = sessionDefs[sk];
        var startMin = sd2[0] * 60 + sd2[1]; var endMin = sd2[2] * 60 + sd2[3];
        // Filter bars to this session
        var sesBars = [];
        for (var bi7 = 0; bi7 < bars5.length; bi7++) {
          var bTime = etFmt2.format(new Date(bars5[bi7].t));
          var bParts = bTime.split(':'); var bH = parseInt(bParts[0]) || 0; var bM = parseInt(bParts[1]) || 0;
          var bMin = bH * 60 + bM;
          if (bMin >= startMin && bMin < endMin) sesBars.push(bars5[bi7]);
        }
        if (sesBars.length < 5) { sesMetrics[sk] = {bars:sesBars.length}; continue; }
        // Hurst on session bars
        var sRet = []; for (var j = 1; j < sesBars.length; j++) if (sesBars[j-1].c > 0) sRet.push(Math.log(sesBars[j].c / sesBars[j-1].c));
        var sH = 0.5;
        if (sRet.length >= 16) {
          var sWins = [8, 12, 16, 20]; var sLN = [], sLR = [];
          for (var wi = 0; wi < sWins.length; wi++) {
            var ws = sWins[wi]; if (ws > sRet.length) continue;
            var rsV = [];
            for (var st = 0; st + ws <= sRet.length; st += ws) {
              var seg = sRet.slice(st, st + ws); var mn2 = 0; for (var j = 0; j < seg.length; j++) mn2 += seg[j]; mn2 /= seg.length;
              var cum = 0, mxC = -Infinity, mnC = Infinity, ss = 0;
              for (var j = 0; j < seg.length; j++) { cum += seg[j] - mn2; if (cum > mxC) mxC = cum; if (cum < mnC) mnC = cum; ss += (seg[j] - mn2) * (seg[j] - mn2); }
              var sd3 = Math.sqrt(ss / seg.length); if (sd3 > 0) rsV.push((mxC - mnC) / sd3);
            }
            if (rsV.length > 0) { var avg = 0; for (var j = 0; j < rsV.length; j++) avg += rsV[j]; avg /= rsV.length; sLN.push(Math.log(ws)); sLR.push(Math.log(avg)); }
          }
          if (sLN.length >= 2) { var sx = 0, sy = 0, sxy = 0, sx2 = 0, np = sLN.length; for (var j = 0; j < np; j++) { sx += sLN[j]; sy += sLR[j]; sxy += sLN[j] * sLR[j]; sx2 += sLN[j] * sLN[j]; } var dn = np * sx2 - sx * sx; if (Math.abs(dn) > 1e-12) sH = (np * sxy - sx * sy) / dn; sH = Math.max(0, Math.min(1, sH)); }
        }
        // Osc ratio, reversals, VWAP crossings, ECE per session-day
        var sOscR = [], sRevR = [], sVX = [], sExc = [];
        // Group session bars by day
        var sDayBars = {};
        for (var j = 0; j < sesBars.length; j++) { var dd = etDateFmt.format(new Date(sesBars[j].t)); if (!sDayBars[dd]) sDayBars[dd] = []; sDayBars[dd].push(sesBars[j]); }
        var sDayKeys = Object.keys(sDayBars);
        for (var dki = 0; dki < sDayKeys.length; dki++) {
          var sdb = sDayBars[sDayKeys[dki]]; if (sdb.length < 3) continue;
          var sam = 0, snm = Math.abs(sdb[sdb.length-1].c - sdb[0].o);
          for (var j = 1; j < sdb.length; j++) sam += Math.abs(sdb[j].c - sdb[j-1].c);
          sOscR.push(snm > 0 ? sam / snm : sam > 0 ? 99 : 0);
          var sr = 0; for (var j = 2; j < sdb.length; j++) { var p2 = sdb[j-1].c - sdb[j-2].c, c2 = sdb[j].c - sdb[j-1].c; if ((p2>0&&c2<0)||(p2<0&&c2>0)) sr++; }
          sRevR.push(sdb.length > 2 ? (sr/(sdb.length-2))*100 : 0);
          var cv = 0, cpv = 0, cx = 0, ps = 0;
          for (var j = 0; j < sdb.length; j++) { cv += sdb[j].v||0; cpv += ((sdb[j].h+sdb[j].l+sdb[j].c)/3)*(sdb[j].v||0); var vw = cv>0?cpv/cv:sdb[j].c; var ss2 = sdb[j].c>=vw?1:-1; if (ps!==0&&ss2!==ps) cx++; ps = ss2; }
          sVX.push(cx);
          var rs2 = sdb[0].c, rd2 = 0;
          for (var j = 1; j < sdb.length; j++) { var mv = sdb[j].c - sdb[j-1].c; var dr = mv>0?1:mv<0?-1:0; if (dr===0) continue; if (rd2===0) { rd2=dr; rs2=sdb[j-1].c; } else if (dr!==rd2) { var ex = Math.abs(sdb[j-1].c - rs2); if (ex>0) sExc.push(ex); rs2=sdb[j-1].c; rd2=dr; } }
        }
        var aOR = 0; if (sOscR.length) { for (var j = 0; j < sOscR.length; j++) aOR += sOscR[j]; aOR /= sOscR.length; }
        var aRR = 0; if (sRevR.length) { for (var j = 0; j < sRevR.length; j++) aRR += sRevR[j]; aRR /= sRevR.length; }
        var aVX = 0; if (sVX.length) { for (var j = 0; j < sVX.length; j++) aVX += sVX[j]; aVX /= sVX.length; }
        var aED = 0; if (sExc.length) { for (var j = 0; j < sExc.length; j++) aED += sExc[j]; aED /= sExc.length; }
        var aEP = res.price > 0 ? (aED / res.price) * 100 : 0;
        var sOscPerDay = sDayKeys.length > 0 ? Math.round(sExc.length / sDayKeys.length * 10) / 10 : 0;
        sesMetrics[sk] = { bars: sesBars.length, hurst: Math.round(sH*1000)/1000, osc_ratio: Math.round(aOR*10)/10, rev_rate: Math.round(aRR*10)/10, vx: Math.round(aVX*10)/10, osc_pct: Math.round(aEP*1000)/1000, osc_dollar: Math.round(aED*100)/100, osc_per_day: sOscPerDay };
      }
      res.session_metrics = JSON.stringify(sesMetrics);

      // Recalculate Grid Score with intraday metrics weighted heavily
      var iHurstScore = Math.max(0, Math.min(100, (0.5 - iHurst) * 200 + 50));
      var dHurstScore = Math.max(0, Math.min(100, (0.5 - res.hurst) * 200 + 50));
      var atrS = Math.min(100, res.atr_pct * 20);
      var iOscS = Math.min(100, avgOscRatio * 8);
      var dOscS = Math.min(100, res.osc_drift_ratio * 10);
      var iRevS = Math.min(100, avgRevRate * 2);
      var crossS = Math.min(100, avgCrossings * 5);
      res.osc_score = Math.round((iHurstScore * 0.25 + dHurstScore * 0.10 + atrS * 0.15 + iOscS * 0.20 + dOscS * 0.05 + iRevS * 0.10 + crossS * 0.10 + Math.min(100, res.yz_vol * 1.5) * 0.05) * 10) / 10;

      processed5m++;
    } catch (e) { res.intraday_hurst = null; res.intraday_osc_ratio = null; res.intraday_reversal_rate = null; res.avg_vwap_crossings = null; res.avg_osc_pct = null; res.avg_osc_dollar = null; res.osc_per_day = null; }

    if (ri % 50 === 0) {
      var pct3 = 60 + Math.round((ri / results.length) * 30);
      await reportProgress({ mode: 'screener', ticker: 'ALL', status: 'running', progress_pct: pct3, message: 'Intraday 1-min: ' + ri + '/' + results.length + ' (' + processed5m + ' with data)' });
    }
    if (ri % 5 === 0) await sleep(100); // rate limiting
  }
  console.log('Intraday data: ' + processed5m + '/' + results.length + ' stocks');

  // Sort by grid score
  results.sort(function(a, b) { return b.osc_score - a.osc_score; });
  console.log('\nTop 20 Grid Candidates:');
  for (var ri = 0; ri < Math.min(20, results.length); ri++) {
    var r = results[ri];
    console.log('  ' + (ri + 1) + '. ' + r.ticker + ' $' + r.price + ' | Score: ' + r.osc_score + ' | dH: ' + r.hurst + ' iH: ' + (r.intraday_hurst||'--') + ' | ATR: ' + r.atr_pct + '% | iOsc: ' + (r.intraday_osc_ratio||'--') + ' | VWAP-X: ' + (r.avg_vwap_crossings||'--'));
  }

  // Step 4: Save to Supabase
  await reportProgress({ mode: 'screener', ticker: 'ALL', status: 'running', progress_pct: 90, message: 'Saving ' + results.length + ' results...' });
  await fetch(SB_URL + '/rest/v1/cached_oscillation_screener?scan_date=eq.' + scanDate, { method: 'DELETE', headers: sbHeaders() });
  await sleep(300);
  for (var bi = 0; bi < results.length; bi += 200) {
    var batch = results.slice(bi, bi + 200);
    await fetch(SB_URL + '/rest/v1/cached_oscillation_screener', { method: 'POST', headers: Object.assign({}, sbHeaders(), { 'Prefer': 'return=minimal' }), body: JSON.stringify(batch) });
  }
  console.log('Saved ' + results.length + ' stocks to cached_oscillation_screener');
  await reportProgress({ mode: 'screener', ticker: 'ALL', status: 'complete', progress_pct: 100, message: 'Screener complete: ' + results.length + ' stocks scored. Top: ' + (results[0] ? results[0].ticker + ' (' + results[0].osc_score + ')' : 'none') });
}

// ── BACKFILL MARKET CAP for existing screener data ──────
async function backfillMcap() {
  console.log('Backfilling market cap for screener data...');
  // Get latest scan date
  var dateR = await fetch(SB_URL + '/rest/v1/cached_oscillation_screener?select=scan_date&order=scan_date.desc&limit=1', { headers: sbHeaders() });
  var dateRows = await dateR.json();
  if (!dateRows.length) { console.log('No screener data found'); return; }
  var sd = dateRows[0].scan_date;
  console.log('Scan date: ' + sd);

  // Get tickers missing market cap or ticker_type
  var h = sbHeaders(); h['Range'] = '0-4999';
  var r = await fetch(SB_URL + '/rest/v1/cached_oscillation_screener?scan_date=eq.' + sd + '&or=(market_cap.is.null,ticker_type.is.null)&select=ticker', { headers: h });
  var rows = await r.json();
  console.log('Tickers missing market cap or type: ' + rows.length);
  if (!rows.length) { console.log('All tickers already have market cap and type'); return; }

  var updated = 0;
  for (var i = 0; i < rows.length; i++) {
    var tk = rows[i].ticker;
    try {
      var pr = await fetch('https://api.polygon.io/v3/reference/tickers/' + tk + '?apiKey=' + POLYGON_KEY);
      if (pr.ok) {
        var pd = await pr.json();
        if (pd.results && (pd.results.market_cap || pd.results.type)) {
          var patch = {};
          if (pd.results.market_cap) patch.market_cap = Math.round(pd.results.market_cap);
          if (pd.results.type) patch.ticker_type = pd.results.type;
          await fetch(SB_URL + '/rest/v1/cached_oscillation_screener?ticker=eq.' + tk + '&scan_date=eq.' + sd, {
            method: 'PATCH', headers: Object.assign({}, sbHeaders(), { 'Prefer': 'return=minimal' }),
            body: JSON.stringify(patch)
          });
          updated++;
        }
      }
    } catch (e) {}
    if (i % 5 === 0) await sleep(100);
    if (i % 100 === 0) console.log('  ' + i + '/' + rows.length + ' checked, ' + updated + ' updated');
  }
  console.log('Done: ' + updated + '/' + rows.length + ' updated with market cap');
}

async function main() {
  if (!POLYGON_KEY) { console.error('Missing POLYGON_API_KEY'); process.exit(1); }
  if (!SB_URL) { console.error('Missing SUPABASE_URL'); process.exit(1); }
  if (!SB_KEY) { console.error('Missing SUPABASE_KEY'); process.exit(1); }

  var args = process.argv.slice(2);
  var mode = args.includes('--backfill-mcap') ? 'backfill-mcap' : args.includes('--screener') ? 'screener' : args.includes('--autotune') ? 'autotune' : args.includes('--backfill') ? 'backfill' : args.includes('--hourly') ? 'hourly' : 'nightly';
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
  } else if (mode === 'autotune') {
    await runAutotune(tickers);
  } else if (mode === 'screener') {
    await runScreener();
  } else if (mode === 'backfill-mcap') {
    await backfillMcap();
  } else {
    await runHourly(tickers);
  }

  console.log('\nPipeline complete.');
}

main().catch(e => { console.error('Pipeline error:', e); process.exit(1); });
