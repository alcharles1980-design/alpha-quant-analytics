// USAGE: npm run build && node scripts/test-glance-tr-queue.js [out.json]   (~5 min, real retry delays)
// v699 behaviour test for Stocks at a Glance: TipRanks queue, retries, 404 marking, status line.
// The NEW build (dist/index.html) is served at the live origin. Every Supabase write, every Polygon
// call and every TipRanks proxy call is intercepted, so nothing real is read from TipRanks or written
// to the database. TipRanks answers are scripted per ticker:
//   AAA BBB CCC DDD -> 200 with one analyst (covered)
//   EEE FFF         -> 404 (no coverage, like an ETF)
//   GGG             -> refused twice (403), then 200 on the 3rd try
//   HHH             -> refused every time (429)
const { chromium } = require('playwright');
const fs = require('fs');
const APP_URL = 'https://alpha-quant-analytics.alcharles1980.workers.dev/';
const DIST = require('path').join(__dirname, '../dist/index.html');   // run npm run build first
const OUT = process.argv[2] || '/tmp/glance-tr-queue.json';
const T0 = Date.now();
const ev = [];
const log = (kind, o) => ev.push(Object.assign({ t: +((Date.now() - T0) / 1000).toFixed(2), kind }, o || {}));
const tries = {};
const OK = { experts: [{ includedInConsensus: true, ratings: [{ date: '2026-10-01', ratingId: 1, priceTarget: 120 }] }],
             tipranksStockScore: { score: 8 }, prices: [{ p: 100 }] };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 160)));

  await page.route(u => u.href === APP_URL, r => r.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(DIST) }));
  await page.route(u => u.hostname === 'api.polygon.io', r => { log('polygon', { path: new URL(r.request().url()).pathname.split('/').slice(0, 6).join('/') }); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  await page.route(u => u.hostname === 'tipranks-proxy.alcharles1980.workers.dev', r => {
    const tk = new URL(r.request().url()).searchParams.get('ticker');
    tries[tk] = (tries[tk] || 0) + 1;
    let status = 200, body = OK;
    if (tk === 'EEE' || tk === 'FFF') { status = 404; body = { error: true, status: 404, message: 'TipRanks returned 404' }; }
    else if (tk === 'GGG' && tries[tk] <= 2) { status = 403; body = { error: true, status: 403, message: 'Non-JSON response (likely blocked)' }; }
    else if (tk === 'HHH') { status = 429; body = { error: true, status: 429, message: 'TipRanks returned 429' }; }
    log('tr_request', { tk, attempt: tries[tk], status });
    return r.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  });
  await page.route(u => /\.supabase\.co$/.test(u.hostname) && u.pathname.startsWith('/rest/v1/'), r => {
    const req = r.request(); const u = new URL(req.url()); const path = u.pathname.replace('/rest/v1/', '');
    let body = null; try { body = req.postDataJSON(); } catch (e) {}
    const j = (s, o) => r.fulfill({ status: s, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(o) });
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' } });
    if (req.method() === 'GET' && path === 'stock_lists') return j(200, [{ id: 9001, name: 'V699 TEST' }]);
    if (req.method() === 'GET') return r.continue();
    if (path === 'rpc/glance_load') return j(200, []);
    if (path === 'rpc/get_app_client_keys') return r.continue();       // read-only: the app's key loader
    if (path === 'stocks_watchlist') { log('insert', { tk: body && body.ticker }); return j(201, [Object.assign({ id: 1 }, body)]); }
    if (path === 'rpc/save_glance_polygon') { log('save_poly', { tk: body && body.p_ticker }); return j(200, null); }
    if (path === 'rpc/save_glance_tipranks') { log('save_tr', { tk: body && body.p_ticker, score: body && body.p_smart_score, buy: body && body.p_buy }); return j(200, null); }
    if (path === 'rpc/mark_glance_tipranks_nocoverage') { log('mark_nocov', { tk: body && body.p_ticker }); return j(200, true); }
    if (path.startsWith('tipranks_cache')) { log('tr_cache', { tk: body && body.ticker }); return j(201, []); }
    log('blocked_write', { method: req.method(), path });
    return j(200, []);
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle', timeout: 90000 });
  await page.fill('input', 'BT');
  await page.click('button');
  await page.waitForTimeout(2500);
  await page.evaluate(() => { window.location.hash = '#stocksatglance'; });
  await page.waitForTimeout(6000);
  const opened = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '+ Bulk Add'); if (!b) return false; b.click(); return true; });
  log('bulk_panel', { opened });
  await page.waitForTimeout(800);
  await page.fill('textarea', 'AAA EEE GGG BBB HHH CCC FFF DDD');
  const clicked = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => x.innerText.trim() === '+ Add All'); if (!b) return false; b.click(); return true; });
  log('add_all', { clicked });

  const samples = [];
  for (let i = 0; i < 80; i++) {          // up to ~6.7 min
    await page.waitForTimeout(5000);
    const st = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="tr-status"]');
      return el ? { text: el.innerText.trim(), color: getComputedStyle(el).color } : null;
    });
    samples.push({ t: +((Date.now() - T0) / 1000).toFixed(1), st });
    if (st && /still refused/.test(st.text) && !/loading|retrying/.test(st.text)) break;
  }
  const bulkMsg = await page.evaluate(() => { const d = [...document.querySelectorAll('div')].find(x => /added/.test(x.innerText) && x.innerText.length < 160 && x.children.length === 0); return d ? d.innerText : null; });
  const tableTickers = await page.evaluate(() => [...document.querySelectorAll('tbody tr')].map(tr => (tr.children[1] || {}).innerText).filter(Boolean).map(s => s.trim().split(/\s/)[0]));
  fs.writeFileSync(OUT, JSON.stringify({ ev, samples, bulkMsg, tableTickers, errors, tries }, null, 1));
  await browser.close();
  console.log('done', samples.length, 'samples');
})().catch(e => { console.error('FAILED', e); process.exit(1); });
