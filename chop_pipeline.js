// ============================================================================
// VIOLENT CHOP SCREENER PIPELINE  (mode: 'chop-screener')
// ----------------------------------------------------------------------------
// Ranks the full ~2,500 universe by WITHIN-DAY chop intensity, averaged over a
// 5-day lookback. Each day stands alone (grid re-anchored daily); daily drift
// is irrelevant. A "swing" = nextBar.high - thisBar.low for every consecutive
// pair of intraday bars, in $ and %, counted unconditionally (down-trending
// sequences still have captured up-swings between bars).
//
// Three resolutions computed per ticker via Polygon custom aggregates:
//   10-sec (default ranking), 30-sec, 1-min.
//
// Composite (10s, swings-of-swings weighted):
//   score = pathPct * (1 + sdPct/avgPct)
// rewards RVI-style ERRATIC violence over metronomic chop.
//
// Writes one row per ticker to cached_chop_screener with a chop_profile JSONB:
//   { "10s": {avg:{...}, days:[...]}, "30s": {...}, "60s": {...} }
//
// This module exports runChopScreener(deps) where deps provides the shared
// helpers from pipeline.js (POLYGON_KEY, SB_URL, sbHeaders, sbUpsert,
// reportProgress, etc.). It is designed to be require()'d and dispatched from
// the main() switch in pipeline.js under mode === 'chop-screener'.
// ============================================================================

// Resolutions: [multiplier, unit, json-key]
const CHOP_RES = [
  // [mult, unit, key, mode, lookbackDays]
  //   mode 'within' = swings between consecutive RTH bars inside each trading day
  //   mode 'across' = swings across the continuous series over the window (no RTH
  //                   filter, no per-day reset), normalized per trading day so the
  //                   columns stay dimensionally consistent with the within-day set.
  [10, 'second', '10s',  'within', 5],
  [30, 'second', '30s',  'within', 5],
  [1,  'minute', '60s',  'within', 5],
  [2,  'minute', '120s', 'within', 5],
  [3,  'minute', '180s', 'within', 5],
  [1,  'hour',   '1h',   'within', 5],
  [4,  'hour',   '4h',   'across', 10],
  [1,  'day',    '1d',   'across', 20],
];
const CHOP_LOOKBACK_DAYS = 5;     // max trading days to sample
const CHOP_CONCURRENCY = 8;       // parallel tickers; retries handle transient failures
const RTH_START_MIN = 9 * 60 + 30; // 09:30 ET in minutes from midnight
const RTH_END_MIN = 16 * 60;       // 16:00 ET

// ---- Convert an epoch-ms timestamp to ET {dateStr, minOfDay} -----------------
// Uses Intl to get the America/New_York wall-clock (handles EDT/EST correctly).
function etParts(ms) {
  var d = new Date(ms);
  var fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  var parts = {};
  fmt.formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
  // hour can come back as '24' at midnight in some environments — normalize
  var hh = parseInt(parts.hour, 10) % 24;
  var mm = parseInt(parts.minute, 10);
  return { date: parts.year + '-' + parts.month + '-' + parts.day, minOfDay: hh * 60 + mm };
}

// ---- Compute per-day swing stats for one resolution -------------------------
// bars: array of Polygon agg bars {o,h,l,c,v,vw,n,t} sorted ascending by t.
// Returns { days: [{date,cnt,avgPct,avgUsd,sdPct,sdUsd,maxPct,maxUsd,pathPct,pathUsd}],
//           avg: {cnt,avgPct,avgUsd,sdPct,sdUsd,maxPct,maxUsd,pathPct,pathUsd,coefVar},
//           composite }
function computeChop(bars, maxDays) {
  // 1. Group RTH bars by ET trading day, preserving ascending order.
  var byDay = {}; // date -> [bar,...]
  for (var i = 0; i < bars.length; i++) {
    var b = bars[i];
    var ep = etParts(b.t);
    if (ep.minOfDay < RTH_START_MIN || ep.minOfDay >= RTH_END_MIN) continue; // RTH only
    (byDay[ep.date] = byDay[ep.date] || []).push(b);
  }

  var dayStats = [];
  var dates = Object.keys(byDay).sort();
  for (var di = 0; di < dates.length; di++) {
    var dayBars = byDay[dates[di]];
    if (dayBars.length < 2) continue; // need at least one consecutive pair
    var swP = [], swU = [];
    for (var j = 0; j + 1 < dayBars.length; j++) {
      var lo = dayBars[j].l, hi = dayBars[j + 1].h;
      // swing = captured up-move from this bar's low to the next bar's high.
      // Floor at 0: if the next bar's high is below this low (a hard gap-down
      // between sparse bars), there was no up-swing to capture in that window —
      // it contributes zero, never negative "violence". Only matters for very
      // illiquid names with large inter-bar gaps; liquid names are unaffected.
      var u = Math.max(0, hi - lo);  // swing in $
      var p = lo > 0 ? (u / lo) * 100 : 0; // swing in %
      swU.push(u); swP.push(p);
    }
    if (swP.length === 0) continue;
    var st = summarize(swP, swU);
    st.date = dates[di];
    dayStats.push(st);
  }

  if (dayStats.length === 0) return null;
  // Keep only the most recent maxDays completed sessions (dayStats is date-asc).
  // The fetch window requests N+1 days so a dataless "today" doesn't shrink the
  // average; here we trim back to exactly N for consistency.
  if (typeof maxDays === 'number' && maxDays > 0 && dayStats.length > maxDays) {
    dayStats = dayStats.slice(dayStats.length - maxDays);
  }

  // 2. Average each stat across the sampled days (equal weight per day).
  var avg = avgStats(dayStats);
  // 3. Composite per the locked formula, computed per-day then averaged
  //    (matches the validation SQL: avg over days of pathPct*(1+sdPct/avgPct)).
  var compSum = 0, compN = 0;
  for (var k = 0; k < dayStats.length; k++) {
    var s = dayStats[k];
    if (s.avgPct > 0) { compSum += s.pathPct * (1 + s.sdPct / s.avgPct); compN++; }
  }
  var composite = compN ? compSum / compN : 0;

  return { days: dayStats, avg: avg, composite: round(composite, 2) };
}

// ---- across-window swing chop (for higher timeframes: 4h, 1D) ----------------
// At 4h/1D there are too few RTH bars per day for within-day swing counting, so
// instead measure swings across the continuous series of bars over the window
// (no RTH filter, no per-day reset). Count and path are normalized PER TRADING
// DAY so the resulting avg block is dimensionally consistent with the within-day
// resolutions (Swings/Day, Daily $ Pot, Chop Score all read on a per-day basis).
// Returns the same { days, avg, composite } shape, with an empty days array
// (the lookback toggle does not apply to these fixed-window resolutions).
function computeChopAcross(bars) {
  var b = bars.slice().sort(function (x, y) { return x.t - y.t; });
  if (b.length < 2) return null;
  // distinct trading days covered (for per-day normalization)
  var dset = {};
  for (var i = 0; i < b.length; i++) dset[etParts(b[i].t).date] = 1;
  var nDays = Object.keys(dset).length || 1;
  var swP = [], swU = [];
  for (var j = 0; j + 1 < b.length; j++) {
    var lo = b[j].l, hi = b[j + 1].h;
    var u = Math.max(0, hi - lo);            // swing in $ (floored at 0)
    var p = lo > 0 ? (u / lo) * 100 : 0;     // swing in %
    swU.push(u); swP.push(p);
  }
  if (swP.length === 0) return null;
  var st = summarize(swP, swU);
  // per-swing stats stay as-is (intensive); count & path normalized per day.
  var avg = {
    cnt: round(st.cnt / nDays, 2),
    avgPct: st.avgPct, avgUsd: st.avgUsd,
    sdPct: st.sdPct, sdUsd: st.sdUsd,
    maxPct: st.maxPct, maxUsd: st.maxUsd,
    pathPct: round(st.pathPct / nDays, 2),
    pathUsd: round(st.pathUsd / nDays, 2),
    coefVar: st.avgPct > 0 ? round(st.sdPct / st.avgPct, 3) : 0,
    nDays: nDays,
  };
  var composite = avg.avgPct > 0 ? avg.pathPct * (1 + avg.sdPct / avg.avgPct) : avg.pathPct;
  return { days: [], avg: avg, composite: round(composite, 2) };
}

// ---- summary stats for one day's swing list ---------------------------------
function summarize(swP, swU) {
  var n = swP.length;
  var sumP = 0, sumU = 0, maxP = 0, maxU = 0;
  for (var i = 0; i < n; i++) {
    sumP += swP[i]; sumU += swU[i];
    if (swP[i] > maxP) maxP = swP[i];
    if (swU[i] > maxU) maxU = swU[i];
  }
  var avgP = sumP / n, avgU = sumU / n;
  var varP = 0, varU = 0;
  for (var j = 0; j < n; j++) { varP += Math.pow(swP[j] - avgP, 2); varU += Math.pow(swU[j] - avgU, 2); }
  // sample stddev (n-1) to match stddev_samp in the validation SQL
  var sdP = n > 1 ? Math.sqrt(varP / (n - 1)) : 0;
  var sdU = n > 1 ? Math.sqrt(varU / (n - 1)) : 0;
  return {
    cnt: n,
    avgPct: round(avgP, 4), avgUsd: round(avgU, 4),
    sdPct: round(sdP, 4), sdUsd: round(sdU, 4),
    maxPct: round(maxP, 3), maxUsd: round(maxU, 3),
    pathPct: round(sumP, 2), pathUsd: round(sumU, 2),
  };
}

// ---- average a list of per-day stat objects ---------------------------------
function avgStats(days) {
  var keys = ['cnt', 'avgPct', 'avgUsd', 'sdPct', 'sdUsd', 'maxPct', 'maxUsd', 'pathPct', 'pathUsd'];
  var out = {};
  keys.forEach(function (key) {
    var s = 0; for (var i = 0; i < days.length; i++) s += days[i][key];
    out[key] = round(s / days.length, key === 'cnt' ? 0 : 4);
  });
  // coefficient of variation (swings-of-swings indicator), averaged per day
  var cv = 0, cvN = 0;
  for (var d = 0; d < days.length; d++) {
    if (days[d].avgPct > 0) { cv += days[d].sdPct / days[d].avgPct; cvN++; }
  }
  out.coefVar = cvN ? round(cv / cvN, 3) : 0;
  out.nDays = days.length;
  return out;
}

function round(x, dp) { var m = Math.pow(10, dp); return Math.round((x + Number.EPSILON) * m) / m; }

// ---- fetch one page with retry/backoff --------------------------------------
async function fetchPage(urlStr, attempts) {
  var lastErr = null;
  for (var a = 0; a < attempts; a++) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 20000);
    try {
      var r = await fetch(urlStr, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.status === 429) { // rate limited — wait and retry
        await new Promise(function (res) { setTimeout(res, 1500 * (a + 1)); });
        lastErr = new Error('HTTP 429'); continue;
      }
      if (!r.ok) { lastErr = new Error('HTTP ' + r.status); 
        // 4xx other than 429 won't fix on retry; bail early
        if (r.status >= 400 && r.status < 500) break;
        await new Promise(function (res) { setTimeout(res, 800 * (a + 1)); });
        continue;
      }
      var d = await r.json();
      return { ok: true, data: d };
    } catch (e) {
      clearTimeout(timer);
      lastErr = e; // timeout/abort/network — backoff and retry
      await new Promise(function (res) { setTimeout(res, 800 * (a + 1)); });
    }
  }
  return { ok: false, error: lastErr ? lastErr.message : 'unknown' };
}

// ---- fetch one resolution's 5-day bar range for a ticker --------------------
// Returns { bars: [...], status: 'ok'|'partial'|'failed' }.
//   ok      = every requested page fetched cleanly
//   partial = at least one page succeeded but a later page failed (data salvaged)
//   failed  = the very first page failed (no usable data)
async function fetchAggs(POLYGON_KEY, ticker, mult, unit, start, end) {
  var url = 'https://api.polygon.io/v2/aggs/ticker/' + encodeURIComponent(ticker) +
    '/range/' + mult + '/' + unit + '/' + start + '/' + end +
    '?adjusted=true&sort=asc&limit=50000&apiKey=' + POLYGON_KEY;
  var all = [];
  var next = url;
  var guard = 0;
  var pagesOk = 0;
  // Cap pages at 3. Page 1 already returns ~8k bars (~3 RTH days) for liquid
  // names — plenty, since the metric averages per-day. Paginating 12 deep on
  // ultra-liquid names was taking minutes/ticker and stalling the whole scan.
  while (next && guard < 3) {
    var res = await fetchPage(next, 2);
    if (!res.ok) {
      // first page failed entirely → no data; otherwise salvage what we have
      return { bars: all, status: guard === 0 ? 'failed' : 'partial' };
    }
    var d = res.data;
    if (Array.isArray(d.results)) all = all.concat(d.results);
    pagesOk++;
    next = d.next_url ? d.next_url + '&apiKey=' + POLYGON_KEY : null;
    guard++;
  }
  // hit the page cap with more data remaining = partial (still usable)
  var status = (next && guard >= 3) ? 'partial' : 'ok';
  return { bars: all, status: status };
}

// ---- date window helpers (last N trading days, ET) --------------------------
// Requests N+1 calendar trading days ending today. When the scan runs before
// the US session completes, "today" has no/sparse RTH bars and is naturally
// excluded by computeChop (needs >=2 RTH bars/day) — the extra day ensures we
// still average a full N completed sessions. Uses UTC throughout for
// consistency with the GitHub Actions runner.
function lastTradingDays(n) {
  var days = [];
  var d = new Date();
  var want = n + 1; // one extra so a dataless "today" doesn't cost a session
  while (days.length < want) {
    var dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() - 1);
  }
  days.reverse();
  return days; // oldest..newest
}

// ============================================================================
// MAIN ENTRY — runChopScreener(deps)
// deps: { POLYGON_KEY, SB_URL, sbHeaders, sbUpsert, sbFetchPaginated,
//         reportProgress }
// ============================================================================
async function runChopScreener(deps) {
  var POLYGON_KEY = deps.POLYGON_KEY, SB_URL = deps.SB_URL,
    sbHeaders = deps.sbHeaders, sbUpsert = deps.sbUpsert,
    reportProgress = deps.reportProgress;

  var scanDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

  // Concurrent-run guard. A live scan updates updated_at every ~25 tickers, so
  // we treat a run as "alive" only if it reported progress recently. This way a
  // crashed/stalled run (whose updated_at goes stale) stops blocking new scans
  // within minutes instead of holding the lock for a full hour off started_at.
  try {
    var lockR = await fetch(SB_URL + '/rest/v1/pipeline_status?mode=eq.chop-screener&status=eq.running&select=started_at,updated_at&order=updated_at.desc&limit=5', { headers: sbHeaders() });
    if (lockR.ok) {
      var lockRows = await lockR.json();
      for (var li = 0; li < lockRows.length; li++) {
        var stamp = lockRows[li].updated_at || lockRows[li].started_at;
        var staleSec = (Date.now() - new Date(stamp).getTime()) / 1000;
        if (staleSec < 300) { // progressed within the last 5 min → genuinely running
          var msg = 'Another chop scan is active (last progress ' + Math.round(staleSec) + 's ago). Aborting.';
          await reportProgress({ mode: 'chop-screener', ticker: 'ALL', status: 'error', progress_pct: 0, message: msg });
          return;
        }
      }
    }
  } catch (e) { /* continue */ }

  await reportProgress({ mode: 'chop-screener', ticker: 'ALL', status: 'running', progress_pct: 0, message: 'Loading universe...' });

  // ---- Universe: read latest scan from cached_oscillation_screener -----------
  // (already ~2,500 liquid tickers with price/mcap/type attached — no need to
  //  re-fetch a year of grouped bars.)
  var latestR = await fetch(SB_URL + '/rest/v1/cached_oscillation_screener?select=scan_date&order=scan_date.desc&limit=1', { headers: sbHeaders() });
  var latestRows = await latestR.json();
  if (!latestRows.length) { await reportProgress({ mode: 'chop-screener', ticker: 'ALL', status: 'error', progress_pct: 0, message: 'No universe found in cached_oscillation_screener.' }); return; }
  var uniScan = latestRows[0].scan_date;

  var universe = [];
  var off = 0;
  while (true) {
    var uh = sbHeaders(); uh['Range'] = off + '-' + (off + 999);
    var ur = await fetch(SB_URL + '/rest/v1/cached_oscillation_screener?scan_date=eq.' + uniScan + '&select=ticker,price,market_cap,ticker_type,adv_dollars&order=ticker.asc', { headers: uh });
    if (!ur.ok) break;
    var batch = await ur.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    universe = universe.concat(batch);
    if (batch.length < 1000) break;
    off += 1000;
  }
  console.log('Chop universe: ' + universe.length + ' tickers (scan ' + uniScan + ')');

  // Test-scan override: restrict to an explicit ticker list if provided.
  if (deps.tickerOverride && deps.tickerOverride.length) {
    var want = {};
    deps.tickerOverride.forEach(function (t) { want[t.toUpperCase()] = 1; });
    var filtered = universe.filter(function (u) { return want[u.ticker.toUpperCase()]; });
    // Include any override tickers not in the cached universe (fetch minimal stub)
    var have = {}; filtered.forEach(function (u) { have[u.ticker.toUpperCase()] = 1; });
    deps.tickerOverride.forEach(function (t) {
      if (!have[t.toUpperCase()]) filtered.push({ ticker: t.toUpperCase(), price: null, market_cap: null, ticker_type: null });
    });
    universe = filtered;
    console.log('Ticker override active → ' + universe.length + ' tickers: ' + universe.map(function (u) { return u.ticker; }).join(', '));
  }

  if (universe.length === 0) { await reportProgress({ mode: 'chop-screener', ticker: 'ALL', status: 'error', progress_pct: 0, message: 'Universe empty.' }); return; }

  // Date windows are now computed per-resolution inside processTicker (each
  // resolution has its own lookback: intraday 5d, 4h 10d, 1D 20d).

  // ---- Process one ticker: 3 resolutions -> chop_profile row -----------------
  async function processTicker(u) {
    var dbg = { ticker: u.ticker, bars_10s: 0, fetch_status: null, days_sampled: 0, err: null };
    try {
      var profile = {};
      var bestComposite = 0;
      var nDaysSampled = 0;
      var tenSecFailed = false;
      var sameDayClose = null; // current-session close, taken from the 1d bar dated scanDate
      for (var ri = 0; ri < CHOP_RES.length; ri++) {
        var res = CHOP_RES[ri];
        var resMode = res[3] || 'within';
        var resLookback = res[4] || CHOP_LOOKBACK_DAYS;
        // Each resolution fetches its own window (1D needs ~20d, 4h ~10d, the
        // intraday set 5d). The window is sized by the resolution's lookback.
        var rDays = lastTradingDays(resLookback);
        var rStart = rDays[0], rEnd = rDays[rDays.length - 1];
        var fr = await fetchAggs(POLYGON_KEY, u.ticker, res[0], res[1], rStart, rEnd);
        var bars = fr.bars;
        // Retry once for the ranking-critical 10s resolution if the fetch failed
        // outright (transient timeout/429 under concurrency) — don't silently drop.
        if (res[2] === '10s' && fr.status === 'failed') {
          await new Promise(function (r2) { setTimeout(r2, 1200); });
          fr = await fetchAggs(POLYGON_KEY, u.ticker, res[0], res[1], rStart, rEnd);
          bars = fr.bars;
          if (fr.status === 'failed') tenSecFailed = true;
        }
        if (res[2] === '10s') { dbg.bars_10s = bars ? bars.length : 0; dbg.fetch_status = fr.status; }
        // Capture the current-session close from the daily bar dated scanDate. The 1d
        // resolution is already fetched here (for the across-window 1d chop), and its
        // bars easily fit one page (~21 daily bars), so this reaches TODAY unlike the
        // 10s bars (which page-cap to the oldest ~3 days). Post-close this is the final
        // RTH close; if today's daily bar isn't present (e.g. a pre-open run) sameDayClose
        // stays null and we fall back to the universe price below. Zero extra API calls.
        if (res[2] === '1d' && bars && bars.length) {
          for (var bi = bars.length - 1; bi >= 0; bi--) {
            if (etParts(bars[bi].t).date === scanDate) { sameDayClose = bars[bi].c; break; }
          }
        }
        if (!bars || bars.length < 2) { profile[res[2]] = null; continue; }
        var c = (resMode === 'across') ? computeChopAcross(bars) : computeChop(bars, resLookback);
        if (!c) { profile[res[2]] = null; continue; }
        profile[res[2]] = { avg: c.avg, days: c.days };
        if (res[2] === '10s') { bestComposite = c.composite; nDaysSampled = c.avg.nDays; }
      }
      dbg.days_sampled = nDaysSampled;
      // Drop ONLY when the 10s resolution genuinely has no data after a retry.
      if (!profile['10s']) {
        dbg.outcome = tenSecFailed ? 'drop_fetch_failed' : 'drop_no_data';
        debugBuf.push(dbg);
        return { _drop: true, ticker: u.ticker, reason: tenSecFailed ? 'fetch_failed' : 'no_data' };
      }
      dbg.outcome = 'kept';
      debugBuf.push(dbg);
      return {
        ticker: u.ticker,
        scan_date: scanDate,
        price: (sameDayClose != null ? sameDayClose : u.price),
        market_cap: u.market_cap,
        ticker_type: u.ticker_type,
        adv_dollars: u.adv_dollars,
        chop_profile: profile,
        composite_score: bestComposite,
        lookback_days: nDaysSampled,
      };
    } catch (e) {
      dbg.outcome = 'exception'; dbg.err = e.message; debugBuf.push(dbg);
      console.log('  ' + u.ticker + ' error: ' + e.message);
      return { _drop: true, ticker: u.ticker, reason: 'exception' };
    }
  }

  // Diagnostic buffer + flusher — only active when CHOP_DEBUG env is set AND the
  // chop_debug table exists. Off by default (table dropped after debugging).
  var debugBuf = [];
  var debugEnabled = !!process.env.CHOP_DEBUG;
  async function flushDebug(force) {
    if (!debugEnabled) { debugBuf.length = 0; return; }
    if (debugBuf.length === 0) return;
    if (!force && debugBuf.length < 100) return;
    var batch = debugBuf.splice(0, debugBuf.length);
    try {
      await fetch(SB_URL + '/rest/v1/chop_debug', {
        method: 'POST',
        headers: Object.assign({}, sbHeaders(), { 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }),
        body: JSON.stringify(batch),
      });
    } catch (e) { console.log('debug flush failed: ' + e.message); }
  }

  // ---- Concurrency-limited sweep --------------------------------------------
  var results = [];
  var keptTotal = 0;   // cumulative kept rows (results[] is emptied on each flush)
  var dropFetch = 0;   // dropped due to fetch failure (should be ~0 now)
  var dropNoData = 0;  // dropped due to genuinely no bars (correct exclusions)
  var done = 0;
  var idx = 0;
  async function worker() {
    while (idx < universe.length) {
      var my = idx++;
      var row = await processTicker(universe[my]);
      done++;
      if (row && !row._drop) { results.push(row); keptTotal++; }
      else if (row && row._drop) { if (row.reason === 'no_data') dropNoData++; else dropFetch++; }
      if (done % 25 === 0 || done === universe.length) {
        var pct = Math.round((done / universe.length) * 95);
        await reportProgress({ mode: 'chop-screener', ticker: universe[my].ticker, status: 'running', progress_pct: pct, message: 'Scanning ' + done + '/' + universe.length + ' (kept ' + keptTotal + ', no-data ' + dropNoData + ', fetch-fail ' + dropFetch + ')' });
      }
      // periodic flush so a long run persists progressively & frees memory
      if (results.length >= 200) {
        var flush = results.splice(0, results.length);
        await sbUpsert('cached_chop_screener', flush, 'ticker,scan_date');
      }
      await flushDebug(false);
    }
  }
  var workers = [];
  for (var w = 0; w < CHOP_CONCURRENCY; w++) workers.push(worker());
  await Promise.all(workers);

  if (results.length) await sbUpsert('cached_chop_screener', results, 'ticker,scan_date');
  await flushDebug(true);
  console.log('Chop sweep done: kept=' + keptTotal + ' no-data=' + dropNoData + ' fetch-fail=' + dropFetch);

  // ---- Cleanup: keep only the latest 2 scan_dates ---------------------------
  // Find DISTINCT scan_dates. A plain select is capped at 1000 rows by PostgREST,
  // and with thousands of rows sharing one date that window can be entirely the
  // newest date — hiding older dates and silently skipping cleanup. Page through
  // ordered-ascending and collect distinct dates until we've seen them all.
  try {
    var seenDates = [];
    var coff = 0;
    while (true) {
      var ch = sbHeaders(); ch['Range'] = coff + '-' + (coff + 999);
      var cr = await fetch(SB_URL + '/rest/v1/cached_chop_screener?select=scan_date&order=scan_date.asc', { headers: ch });
      if (!cr.ok) break;
      var cbatch = await cr.json();
      if (!Array.isArray(cbatch) || cbatch.length === 0) break;
      for (var z = 0; z < cbatch.length; z++) { if (seenDates.indexOf(cbatch[z].scan_date) < 0) seenDates.push(cbatch[z].scan_date); }
      if (cbatch.length < 1000) break;
      coff += 1000;
    }
    seenDates.sort(); // ascending; oldest first
    if (seenDates.length > 2) {
      // delete everything older than the 2nd-newest date
      var cutoff = seenDates[seenDates.length - 2];
      await fetch(SB_URL + '/rest/v1/cached_chop_screener?scan_date=lt.' + cutoff, { method: 'DELETE', headers: Object.assign({}, sbHeaders(), { Prefer: 'return=minimal' }) });
    }
  } catch (e) { /* best-effort */ }

  await reportProgress({ mode: 'chop-screener', ticker: 'ALL', status: 'complete', progress_pct: 100, message: 'Chop scan complete: ' + scanDate + '. Stored chop profiles.' });
  console.log('Chop screener complete: ' + scanDate);
}

module.exports = { runChopScreener, computeChop, summarize, etParts };
