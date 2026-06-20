// ============================================================================
// YAHOO ANALYST RATINGS PIPELINE  (mode: 'yahoo-ratings')
// ----------------------------------------------------------------------------
// Pulls analyst ratings from Yahoo Finance's quoteSummary endpoint, which
// requires a cookie+crumb handshake. We get ONE crumb and reuse it across the
// whole batch (re-handshaking only if it expires), with jittered delays and
// 429/401 backoff to avoid the runner IP being rate-limited or blocked.
//
// Nightly: pulls the top N (default 1000) tickers by chop composite_score.
// On-demand: a single ticker via --tickers SYM (used by the page's fetch btn).
//
// Stores into yahoo_ratings: reco_mean/key, target hi/mean/lo, current_price,
// num_analysts, and the strongBuy/buy/hold/sell/strongSell counts.
//
// Exports runYahooRatings(deps). deps: { SB_URL, sbHeaders, sbUpsert,
// reportProgress }.
// ============================================================================

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const YR_DEFAULT_LIMIT = 1000;     // nightly: top N by chop score
const YR_BASE_DELAY = 350;         // ms, base spacing between calls
const YR_JITTER = 450;             // ms, random extra (250-800ms total-ish)
const YR_MAX_BACKOFF = 60000;      // cap a single backoff at 60s

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function jitterDelay() { return YR_BASE_DELAY + Math.floor(Math.random() * YR_JITTER); }

// ---- cookie + crumb handshake ----------------------------------------------
// Returns { cookie, crumb } or throws.
async function getCrumb() {
  // Step 1: session cookie from fc.yahoo.com
  var r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
  var setCookie = r1.headers.get('set-cookie') || '';
  var cookie = setCookie.split(',').map(function (c) { return c.split(';')[0].trim(); }).filter(Boolean).join('; ');
  if (!cookie) throw new Error('no cookie from fc.yahoo.com');
  // Step 2: crumb using that cookie
  var r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, 'Cookie': cookie } });
  if (!r2.ok) throw new Error('getcrumb HTTP ' + r2.status);
  var crumb = (await r2.text()).trim();
  if (!crumb || crumb.length > 40) throw new Error('bad crumb');
  return { cookie: cookie, crumb: crumb };
}

// ---- fetch one ticker's ratings; returns row | null | {_rateLimited:true} ---
async function fetchRating(ticker, sess) {
  var url = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary/' + encodeURIComponent(ticker) +
    '?modules=financialData,recommendationTrend&crumb=' + encodeURIComponent(sess.crumb);
  var r;
  try {
    r = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': sess.cookie } });
  } catch (e) { return { _err: 'fetch ' + e.message }; }
  if (r.status === 429) return { _rateLimited: true };
  if (r.status === 401) return { _crumbExpired: true };
  if (!r.ok) return { _err: 'HTTP ' + r.status };
  var body;
  try { body = await r.json(); } catch (e) { return { _err: 'json' }; }
  var res = body && body.quoteSummary && body.quoteSummary.result && body.quoteSummary.result[0];
  if (!res) return null; // no data for this ticker (delisted/ETF/etc.)
  var fd = res.financialData || {};
  var tr = (res.recommendationTrend && res.recommendationTrend.trend && res.recommendationTrend.trend[0]) || {};
  function raw(x) { return x && typeof x === 'object' ? (x.raw != null ? x.raw : null) : (x != null ? x : null); }
  // require at least a recommendation or a target to count as real data
  var rm = raw(fd.recommendationMean), tm = raw(fd.targetMeanPrice);
  if (rm == null && tm == null && tr.buy == null) return null;
  return {
    ticker: ticker,
    reco_mean: rm,
    reco_key: fd.recommendationKey || null,
    target_mean: tm,
    target_high: raw(fd.targetHighPrice),
    target_low: raw(fd.targetLowPrice),
    current_price: raw(fd.currentPrice),
    num_analysts: raw(fd.numberOfAnalystOpinions),
    strong_buy: tr.strongBuy != null ? tr.strongBuy : null,
    buy: tr.buy != null ? tr.buy : null,
    hold: tr.hold != null ? tr.hold : null,
    sell: tr.sell != null ? tr.sell : null,
    strong_sell: tr.strongSell != null ? tr.strongSell : null,
    fetched_at: new Date().toISOString(),
  };
}

// ============================================================================
// MAIN ENTRY
// ============================================================================
async function runYahooRatings(deps, opts) {
  var SB_URL = deps.SB_URL, sbHeaders = deps.sbHeaders, sbUpsert = deps.sbUpsert,
    reportProgress = deps.reportProgress;
  opts = opts || {};
  var explicitTickers = opts.tickers && opts.tickers.length ? opts.tickers : null;
  var limit = opts.limit || YR_DEFAULT_LIMIT;

  // Concurrent-run guard (updated_at recency, mirror chop pipeline)
  try {
    var lockR = await fetch(SB_URL + '/rest/v1/pipeline_status?mode=eq.yahoo-ratings&status=eq.running&select=updated_at&order=updated_at.desc&limit=3', { headers: sbHeaders() });
    if (lockR.ok) {
      var lk = await lockR.json();
      for (var i = 0; i < lk.length; i++) {
        var age = (Date.now() - new Date(lk[i].updated_at).getTime()) / 1000;
        if (age < 300) { await reportProgress({ mode: 'yahoo-ratings', ticker: 'ALL', status: 'error', progress_pct: 0, message: 'Another ratings run active (' + Math.round(age) + 's ago). Aborting.' }); return; }
      }
    }
  } catch (e) { /* continue */ }

  await reportProgress({ mode: 'yahoo-ratings', ticker: 'ALL', status: 'running', progress_pct: 0, message: 'Building ticker list...' });

  // ---- universe ----
  var tickers = [];
  if (explicitTickers) {
    tickers = explicitTickers.map(function (t) { return t.toUpperCase(); });
  } else {
    // top N by chop composite_score from the latest chop scan
    var sdR = await fetch(SB_URL + '/rest/v1/cached_chop_screener?select=scan_date&order=scan_date.desc&limit=1', { headers: sbHeaders() });
    var sdRows = await sdR.json();
    if (!sdRows.length) { await reportProgress({ mode: 'yahoo-ratings', ticker: 'ALL', status: 'error', progress_pct: 0, message: 'No chop scan found.' }); return; }
    var sd = sdRows[0].scan_date;
    var off = 0;
    while (tickers.length < limit) {
      var h = sbHeaders(); h['Range'] = off + '-' + (off + 999);
      var tr = await fetch(SB_URL + '/rest/v1/cached_chop_screener?scan_date=eq.' + sd + '&select=ticker&order=composite_score.desc.nullslast,ticker.asc', { headers: h });
      if (!tr.ok) break;
      var batch = await tr.json();
      if (!Array.isArray(batch) || batch.length === 0) break;
      for (var b = 0; b < batch.length && tickers.length < limit; b++) tickers.push(batch[b].ticker);
      if (batch.length < 1000) break;
      off += 1000;
    }
  }
  if (tickers.length === 0) { await reportProgress({ mode: 'yahoo-ratings', ticker: 'ALL', status: 'error', progress_pct: 0, message: 'No tickers to fetch.' }); return; }
  console.log('Yahoo ratings: ' + tickers.length + ' tickers');

  // ---- one crumb for the whole batch ----
  var sess;
  try { sess = await getCrumb(); } catch (e) { await reportProgress({ mode: 'yahoo-ratings', ticker: 'ALL', status: 'error', progress_pct: 0, message: 'Crumb handshake failed: ' + e.message }); return; }
  console.log('Got crumb.');

  var buffer = [];
  var ok = 0, noData = 0, failed = 0;
  var consecutiveRateLimits = 0;

  for (var t = 0; t < tickers.length; t++) {
    var tk = tickers[t];
    var row = await fetchRating(tk, sess);

    // crumb expired → re-handshake once and retry this ticker
    if (row && row._crumbExpired) {
      try { sess = await getCrumb(); console.log('Refreshed crumb.'); } catch (e) { /* keep going, will fail */ }
      await sleep(1500);
      row = await fetchRating(tk, sess);
    }
    // rate limited → exponential backoff, then retry this ticker
    if (row && row._rateLimited) {
      consecutiveRateLimits++;
      var backoff = Math.min(YR_MAX_BACKOFF, 3000 * Math.pow(2, consecutiveRateLimits - 1));
      console.log('429 on ' + tk + ' — backing off ' + backoff + 'ms');
      await reportProgress({ mode: 'yahoo-ratings', ticker: tk, status: 'running', progress_pct: Math.round(t / tickers.length * 95), message: 'Rate limited — backing off ' + Math.round(backoff / 1000) + 's (' + ok + ' done)' });
      await sleep(backoff);
      // refresh crumb after a rate-limit pause (often helps)
      try { sess = await getCrumb(); } catch (e) { /* */ }
      row = await fetchRating(tk, sess);
    } else {
      consecutiveRateLimits = 0;
    }

    if (row && row.ticker) { buffer.push(row); ok++; }
    else if (row === null) { noData++; }
    else { failed++; }

    // flush every 100
    if (buffer.length >= 100) {
      var f = buffer.splice(0, buffer.length);
      await sbUpsert('yahoo_ratings', f, 'ticker');
    }
    if (t % 20 === 0 || t === tickers.length - 1) {
      await reportProgress({ mode: 'yahoo-ratings', ticker: tk, status: 'running', progress_pct: Math.round(t / tickers.length * 95), message: 'Fetched ' + (t + 1) + '/' + tickers.length + ' (ok ' + ok + ', no-data ' + noData + ', fail ' + failed + ')' });
    }

    await sleep(jitterDelay());
  }

  if (buffer.length) await sbUpsert('yahoo_ratings', buffer, 'ticker');

  await reportProgress({ mode: 'yahoo-ratings', ticker: 'ALL', status: 'complete', progress_pct: 100, message: 'Ratings done: ok ' + ok + ', no-data ' + noData + ', fail ' + failed + ' of ' + tickers.length });
  console.log('Yahoo ratings complete: ok=' + ok + ' noData=' + noData + ' failed=' + failed);
}

module.exports = { runYahooRatings, getCrumb, fetchRating };
