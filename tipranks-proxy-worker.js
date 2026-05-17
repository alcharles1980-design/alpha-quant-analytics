// Cloudflare Worker: TipRanks API Proxy
// Adds random delays, rotates user-agents, caches responses at CF edge
// to minimize requests to TipRanks and avoid bot detection.

addEventListener('fetch', function(event) {
  event.respondWith(handleRequest(event));
});

// Rotate user-agents to avoid fingerprinting
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

// Random delay between min and max ms — looks like human browsing
function sleep(minMs, maxMs) {
  var ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

async function handleRequest(event) {
  var request = event.request;
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

  // Build the TipRanks URL
  var ts = Math.floor(Date.now() / 1000);
  var apiUrl;
  var cacheKey;

  if (endpoint === 'getData') {
    apiUrl = 'https://www.tipranks.com/api/stocks/getData/?name=' + ticker + '&benchmark=1&period=3&break=' + ts;
    cacheKey = 'tr:getData:' + ticker;
  } else if (endpoint === 'newsSentiments') {
    apiUrl = 'https://www.tipranks.com/api/stocks/getNewsSentiments/?ticker=' + ticker;
    cacheKey = 'tr:news:' + ticker;
  } else {
    return jsonResp({ error: true, message: 'Unknown endpoint: ' + endpoint }, 400);
  }

  // Check CF Cache API first — serve from cache if fresh (10 min TTL)
  var cache = caches.default;
  var cacheUrl = new URL(request.url);
  cacheUrl.searchParams.delete('_'); // strip cache busters
  var cacheRequest = new Request(cacheUrl.toString(), { method: 'GET' });
  var cached = await cache.match(cacheRequest);
  if (cached) {
    // Clone and add CORS headers
    var cachedResp = new Response(cached.body, cached);
    cachedResp.headers.set('Access-Control-Allow-Origin', '*');
    cachedResp.headers.set('X-Cache', 'HIT');
    return cachedResp;
  }

  // Random delay 500-2000ms before hitting TipRanks — humanize timing
  await sleep(500, 2000);

  var ua = randomUA();

  try {
    var resp = await fetch(apiUrl, {
      headers: {
        'User-Agent': ua,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
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
      return jsonResp({ error: true, status: 403, message: 'TipRanks returned non-JSON (Cloudflare challenge page)' }, 403);
    }

    var body = await resp.text();

    // Build response with CORS + cache headers
    var response = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=600',
        'X-Cache': 'MISS',
        'X-UA': ua.slice(0, 30)
      }
    });

    // Store in CF edge cache for 10 minutes
    // Clone before caching because Response body can only be read once
    event.waitUntil(cache.put(cacheRequest, response.clone()));

    return response;
  } catch (e) {
    return jsonResp({ error: true, message: 'Proxy error: ' + e.message }, 500);
  }
}

function jsonResp(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    }
  });
}
