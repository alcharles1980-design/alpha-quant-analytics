// USAGE (from the repo root, ~2 s):
//   STUB_OUT=/tmp/sync.json SUPABASE_URL=https://stub.supabase.co SUPABASE_KEY=stub POLYGON_API_KEY=stub \
//     node -r ./scripts/test-tipranks-sync-stub.js pipeline.js --tipranks-sync --tickers ALL
// Expected delays: [2500,2500,15000,2500,15000,2500,2500,60000,2500]; saves AAA BBB CCC DDD GGG; marks EEE FFF.
// Preloaded with `node -r` before the REAL pipeline.js --tipranks-sync. Replaces fetch so nothing
// leaves the sandbox, scripts TipRanks per ticker, and runs timers 100x faster while recording the
// delay the code ASKED for (that is what the spacing assertions read). Writes a report on exit.
const fs = require('fs');
const OUT = process.env.STUB_OUT;
const ev = []; const tries = {}; const delays = [];
const T0 = Date.now();
const rec = (kind, o) => ev.push(Object.assign({ kind, t: Date.now() - T0 }, o || {}));
const realST = global.setTimeout;
global.setTimeout = function (fn, ms) {
  if (ms >= 1000 && ms !== 10000) delays.push(ms);   // 10000 = reportProgress's abort timer
  return realST(fn, ms >= 1000 && ms !== 10000 ? Math.ceil(ms / 100) : ms);
};
const resp = (status, obj) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
const OK = { experts: [{ includedInConsensus: true, ratings: [{ date: '2026-10-01', ratingId: 1, priceTarget: 120 }] }],
             tipranksStockScore: { score: 8 }, prices: [{ p: 100 }] };
global.fetch = async function (url, opts) {
  url = String(url); const body = opts && opts.body ? JSON.parse(opts.body) : null;
  if (url.includes('tipranks-proxy')) {
    const tk = new URL(url).searchParams.get('ticker'); tries[tk] = (tries[tk] || 0) + 1;
    rec('tr_request', { tk, attempt: tries[tk] });
    if (tk === 'EEE' || tk === 'FFF') return resp(404, { error: true, status: 404, message: 'TipRanks returned 404' });
    if (tk === 'GGG' && tries[tk] === 1) return resp(403, { error: true, status: 403, message: 'Non-JSON response (likely blocked)' });
    if (tk === 'HHH') return resp(429, { error: true, status: 429, message: 'TipRanks returned 429' });
    return resp(200, OK);
  }
  if (url.includes('api.polygon.io')) return resp(200, {});
  if (url.includes('/rest/v1/stocks_watchlist')) return resp(200, ['AAA','EEE','GGG','BBB','HHH','CCC','FFF','DDD'].map(t => ({ ticker: t })));
  if (url.includes('/rest/v1/pipeline_status')) { if (body && body.message) rec('progress', { msg: body.message, status: body.status }); return resp(200, []); }
  if (url.includes('rpc/mark_glance_tipranks_nocoverage')) { rec('mark_nocov', { tk: body.p_ticker }); return resp(200, true); }
  if (url.includes('rpc/save_glance_tipranks')) { rec('save_tr', { tk: body.p_ticker }); return resp(200, null); }
  if (url.includes('rpc/save_glance_polygon')) return resp(200, null);
  if (url.includes('/rest/v1/tipranks_cache')) { rec('tr_cache', { tk: body.ticker }); return resp(201, []); }
  rec('unexpected', { url: url.slice(0, 120) }); return resp(200, []);
};
process.on('exit', () => fs.writeFileSync(OUT, JSON.stringify({ ev, tries, delays }, null, 1)));
