// Cloudflare Worker: Alpha Quant Public API
// Endpoints:
//   /api/glance              — all tickers
//   /api/glance?list=Default — specific list
//   /api/glance?ticker=NVDA  — single ticker
//   /api/lists               — all list names

var SB_URL = 'https://haeqzegdlwryvaecanrn.supabase.co';
var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhZXF6ZWdkbHdyeXZhZWNhbnJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MTYxODAsImV4cCI6MjA5MDI5MjE4MH0.j3E_EZsiS4VmNjmXA90kKxL_DgPOV0Ku_DKwMDqGjgw';

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY
  };
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=300'
    }
  });
}

export default {
  async fetch(request) {
    var url = new URL(request.url);
    var path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // /api/glance — stocks at a glance data
    if (path === '/api/glance' || path === '/api/glance/') {
      var list = url.searchParams.get('list') || null;
      var ticker = url.searchParams.get('ticker') || null;

      // Single ticker lookup — direct table query
      if (ticker) {
        ticker = ticker.toUpperCase().replace(/[^A-Z0-9.]/g, '');
        var r = await fetch(SB_URL + '/rest/v1/stocks_glance_cache?ticker=eq.' + ticker, {
          headers: sbHeaders()
        });
        var rows = await r.json();
        if (!rows || !rows.length) return jsonResp({ status: 'error', message: 'Ticker not found: ' + ticker }, 404);
        return jsonResp({ status: 'ok', count: 1, ticker: ticker, data: rows[0] });
      }

      // List or all — use RPC function
      var body = {};
      if (list) body.p_list_name = list;
      var r2 = await fetch(SB_URL + '/rest/v1/rpc/api_stocks_glance', {
        method: 'POST',
        headers: sbHeaders(),
        body: JSON.stringify(body)
      });
      var result = await r2.json();
      return jsonResp(result);
    }

    // /api/lists — all list names with ticker counts
    if (path === '/api/lists' || path === '/api/lists/') {
      var r3 = await fetch(SB_URL + '/rest/v1/stock_lists?select=id,name,created_at&order=created_at.asc', {
        headers: sbHeaders()
      });
      var lists = await r3.json();

      // Get ticker counts per list
      var r4 = await fetch(SB_URL + '/rest/v1/stocks_watchlist?select=list_id', {
        headers: sbHeaders()
      });
      var watchlist = await r4.json();
      var counts = {};
      (watchlist || []).forEach(function(w) {
        counts[w.list_id] = (counts[w.list_id] || 0) + 1;
      });

      var enriched = (lists || []).map(function(l) {
        return { id: l.id, name: l.name, ticker_count: counts[l.id] || 0, created_at: l.created_at };
      });

      return jsonResp({ status: 'ok', count: enriched.length, data: enriched });
    }

    // Root — API docs
    if (path === '/' || path === '') {
      return jsonResp({
        name: 'Alpha Quant Analytics API',
        version: '1.0',
        endpoints: {
          '/api/glance': 'All cached stock data (126 tickers)',
          '/api/glance?list=Default List': 'Stocks from a specific watchlist',
          '/api/glance?ticker=NVDA': 'Single ticker lookup',
          '/api/lists': 'All watchlist names with ticker counts'
        },
        example: url.origin + '/api/glance?ticker=NVDA'
      });
    }

    return jsonResp({ status: 'error', message: 'Unknown endpoint. Try /api/glance or /api/lists' }, 404);
  }
};
