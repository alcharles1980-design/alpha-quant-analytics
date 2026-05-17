// Cloudflare Worker: TipRanks API Proxy (ES Module format for wrangler deploy)
// Anti-bot: random delays, UA rotation, CF edge caching

var USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
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

    if (endpoint === 'getData') {
      apiUrl = 'https://www.tipranks.com/api/stocks/getData/?name=' + ticker + '&benchmark=1&period=3&break=' + ts;
    } else if (endpoint === 'newsSentiments') {
      apiUrl = 'https://www.tipranks.com/api/stocks/getNewsSentiments/?ticker=' + ticker;
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

    var ua = randomUA();

    try {
      var resp = await fetch(apiUrl, {
        headers: {
          'User-Agent': ua,
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.tipranks.com/stocks/' + ticker.toLowerCase() + '/forecast',
          'Origin': 'https://www.tipranks.com',
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
          'Sec-Ch-Ua': '"Chromium";v="125", "Not=A?Brand";v="24"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"macOS"'
        }
      });

      if (!resp.ok) {
        return jsonResp({ error: true, status: resp.status, message: 'TipRanks returned ' + resp.status }, resp.status);
      }

      var contentType = resp.headers.get('content-type') || '';
      if (!contentType.includes('json')) {
        return jsonResp({ error: true, status: 403, message: 'Non-JSON response (Cloudflare challenge)' }, 403);
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
