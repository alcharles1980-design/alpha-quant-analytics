// Cloudflare Worker: TipRanks Mobile API Proxy (ES Module format)
// Uses mobile.tipranks.com with iOS-spoofed headers (no auth required)

var MOBILE_UAS = [
  'TipRanksApp/5.3.0 (iPhone; iOS 17.5; Scale/3.00)',
  'TipRanksApp/5.2.1 (iPhone; iOS 17.4.1; Scale/3.00)',
  'TipRanksApp/5.3.0 (iPhone; iOS 18.0; Scale/3.00)',
  'TipRanksApp/5.1.0 (iPhone; iOS 17.3; Scale/2.00)',
  'TipRanksApp/5.3.0 (iPad; iOS 17.5; Scale/2.00)'
];

function randomUA() {
  return MOBILE_UAS[Math.floor(Math.random() * MOBILE_UAS.length)];
}

function sleep(minMs, maxMs) {
  var ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    var url = new URL(request.url);
    var ticker = url.searchParams.get('ticker');
    var endpoint = url.searchParams.get('endpoint') || 'getData';

    if (!ticker) {
      return jsonResp({ error: true, message: 'Missing ?ticker= parameter' }, 400);
    }

    ticker = ticker.toUpperCase().replace(/[^A-Z0-9.]/g, '');
    var ts = Math.floor(Date.now() / 1000);
    var apiUrl;

    // Use mobile.tipranks.com — no auth required, iOS-spoofed headers
    if (endpoint === 'getData') {
      apiUrl = 'https://mobile.tipranks.com/api/stocks/getData/?name=' + ticker + '&benchmark=1&period=3&break=' + ts;
    } else if (endpoint === 'newsSentiments') {
      apiUrl = 'https://mobile.tipranks.com/api/stocks/getNewsSentiments/?ticker=' + ticker;
    } else {
      return jsonResp({ error: true, message: 'Unknown endpoint: ' + endpoint }, 400);
    }

    // Check CF Cache API — serve from cache if available (10 min TTL)
    var cache = caches.default;
    var cacheUrl = new URL(request.url);
    cacheUrl.searchParams.set('_c', ticker + ':' + endpoint);
    var cacheReq = new Request(cacheUrl.toString(), { method: 'GET' });
    var cached = await cache.match(cacheReq);
    if (cached) {
      var resp2 = new Response(cached.body, cached);
      resp2.headers.set('Access-Control-Allow-Origin', '*');
      resp2.headers.set('X-Cache', 'HIT');
      return resp2;
    }

    // Random delay 500-2000ms — humanize timing
    await sleep(500, 2000);

    try {
      var resp = await fetch(apiUrl, {
        headers: {
          'User-Agent': randomUA(),
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br'
        }
      });

      if (!resp.ok) {
        return jsonResp({ error: true, status: resp.status, message: 'TipRanks returned ' + resp.status }, resp.status);
      }

      var contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('json')) {
        return jsonResp({ error: true, status: 403, message: 'Non-JSON response (likely blocked)' }, 403);
      }

      var body = await resp.text();
      var response = new Response(body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=600',
          'X-Cache': 'MISS'
        }
      });

      // Store in CF edge cache for 10 minutes
      ctx.waitUntil(cache.put(cacheReq, response.clone()));

      return response;
    } catch (e) {
      return jsonResp({ error: true, message: 'Proxy error: ' + e.message }, 500);
    }
  }
};
