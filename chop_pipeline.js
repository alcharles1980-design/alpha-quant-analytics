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
  [10, 'second', '10s'],
  [30, 'second', '30s'],
  [1,  'minute', '60s'],
];
const CHOP_LOOKBACK_DAYS = 5;     // max trading days to sample
const CHOP_CONCURRENCY = 12;      // parallel tickers (no Polygon per-min throttle on Developer plan)
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
function computeChop(bars) {
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
      var u = hi - lo;            // swing in $  (low of this bar -> high of next)
      var p = lo > 0 ? (u / lo) * 100 : 0; // swing in %
      swU.push(u); swP.push(p);
    }
    if (swP.length === 0) continue;
    var st = summarize(swP, swU);
    st.date = dates[di];
    dayStats.push(st);
  }

  if (dayStats.length === 0) return null;

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

// ---- fetch one resolution's 5-day bar range for a ticker --------------------
async function fetchAggs(POLYGON_KEY, ticker, mult, unit, start, end) {
  var url = 'https://api.polygon.io/v2/aggs/ticker/' + encodeURIComponent(ticker) +
    '/range/' + mult + '/' + unit + '/' + start + '/' + end +
    '?adjusted=true&sort=asc&limit=50000&apiKey=' + POLYGON_KEY;
  var all = [];
  var next = url;
  var guard = 0;
  while (next && guard < 6) { // paginate defensively though 5d rarely exceeds 50k
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 30000);
    var r;
    try { r = await fetch(next, { signal: ctrl.signal }); } finally { clearTimeout(timer); }
    if (!r.ok) { if (guard === 0) throw new Error('HTTP ' + r.status); break; }
    var d = await r.json();
    if (Array.isArray(d.results)) all = all.concat(d.results);
    next = d.next_url ? d.next_url + '&apiKey=' + POLYGON_KEY : null;
    guard++;
  }
  return all;
}

// ---- date window helpers (last N trading days, ET) --------------------------
function lastTradingDays(n) {
  var days = [];
  var d = new Date();
  // start from yesterday (Polygon Developer is 15-min delayed; today may be partial
  // but is fine — we still want the most recent session if it has bars). Include today.
  while (days.length < n) {
    var dow = d.getDay();
    if (dow !== 0 && dow !== 6) days.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() - 1);
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

  // Concurrent-run guard (mirror runScreener)
  try {
    var lockR = await fetch(SB_URL + '/rest/v1/pipeline_status?mode=eq.chop-screener&status=eq.running&select=started_at&order=started_at.desc&limit=5', { headers: sbHeaders() });
    if (lockR.ok) {
      var lockRows = await lockR.json();
      for (var li = 0; li < lockRows.length; li++) {
        var ageSec = (Date.now() - new Date(lockRows[li].started_at).getTime()) / 1000;
        if (ageSec < 3600) {
          var msg = 'Another chop scan is running (started ' + Math.round(ageSec) + 's ago). Aborting.';
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
    var ur = await fetch(SB_URL + '/rest/v1/cached_oscillation_screener?scan_date=eq.' + uniScan + '&select=ticker,price,market_cap,ticker_type&order=ticker.asc', { headers: uh });
    if (!ur.ok) break;
    var batch = await ur.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    universe = universe.concat(batch);
    if (batch.length < 1000) break;
    off += 1000;
  }
  console.log('Chop universe: ' + universe.length + ' tickers (scan ' + uniScan + ')');
  if (universe.length === 0) { await reportProgress({ mode: 'chop-screener', ticker: 'ALL', status: 'error', progress_pct: 0, message: 'Universe empty.' }); return; }

  var days = lastTradingDays(CHOP_LOOKBACK_DAYS);
  var startDate = days[0], endDate = days[days.length - 1];

  // ---- Process one ticker: 3 resolutions -> chop_profile row -----------------
  async function processTicker(u) {
    try {
      var profile = {};
      var bestComposite = 0;
      var nDaysSampled = 0;
      for (var ri = 0; ri < CHOP_RES.length; ri++) {
        var res = CHOP_RES[ri];
        var bars;
        try { bars = await fetchAggs(POLYGON_KEY, u.ticker, res[0], res[1], startDate, endDate); }
        catch (e) { bars = []; }
        if (!bars || bars.length < 2) { profile[res[2]] = null; continue; }
        var c = computeChop(bars);
        if (!c) { profile[res[2]] = null; continue; }
        profile[res[2]] = { avg: c.avg, days: c.days };
        if (res[2] === '10s') { bestComposite = c.composite; nDaysSampled = c.avg.nDays; }
      }
      // require the 10s resolution to have produced a result (it drives ranking)
      if (!profile['10s']) return null;
      return {
        ticker: u.ticker,
        scan_date: scanDate,
        price: u.price,
        market_cap: u.market_cap,
        ticker_type: u.ticker_type,
        chop_profile: profile,
        composite_score: bestComposite,
        lookback_days: nDaysSampled,
      };
    } catch (e) {
      console.log('  ' + u.ticker + ' failed: ' + e.message);
      return null;
    }
  }

  // ---- Concurrency-limited sweep --------------------------------------------
  var results = [];
  var done = 0;
  var idx = 0;
  async function worker() {
    while (idx < universe.length) {
      var my = idx++;
      var row = await processTicker(universe[my]);
      done++;
      if (row) results.push(row);
      if (done % 25 === 0 || done === universe.length) {
        var pct = Math.round((done / universe.length) * 95);
        await reportProgress({ mode: 'chop-screener', ticker: universe[my].ticker, status: 'running', progress_pct: pct, message: 'Scanning ' + done + '/' + universe.length + ' (kept ' + results.length + ')' });
      }
      // periodic flush so a long run persists progressively & frees memory
      if (results.length >= 200) {
        var flush = results.splice(0, results.length);
        await sbUpsert('cached_chop_screener', flush);
      }
    }
  }
  var workers = [];
  for (var w = 0; w < CHOP_CONCURRENCY; w++) workers.push(worker());
  await Promise.all(workers);

  if (results.length) await sbUpsert('cached_chop_screener', results);

  // ---- Cleanup: keep only the latest 2 scan_dates ---------------------------
  try {
    var keepR = await fetch(SB_URL + '/rest/v1/cached_chop_screener?select=scan_date&order=scan_date.desc', { headers: sbHeaders() });
    var allDates = await keepR.json();
    var uniqueDates = [];
    for (var z = 0; z < allDates.length; z++) { if (uniqueDates.indexOf(allDates[z].scan_date) < 0) uniqueDates.push(allDates[z].scan_date); }
    if (uniqueDates.length > 2) {
      var cutoff = uniqueDates[2];
      await fetch(SB_URL + '/rest/v1/cached_chop_screener?scan_date=lt.' + cutoff, { method: 'DELETE', headers: Object.assign({}, sbHeaders(), { Prefer: 'return=minimal' }) });
    }
  } catch (e) { /* best-effort */ }

  await reportProgress({ mode: 'chop-screener', ticker: 'ALL', status: 'complete', progress_pct: 100, message: 'Chop scan complete: ' + scanDate + '. Stored chop profiles.' });
  console.log('Chop screener complete: ' + scanDate);
}

module.exports = { runChopScreener, computeChop, summarize, etParts };
