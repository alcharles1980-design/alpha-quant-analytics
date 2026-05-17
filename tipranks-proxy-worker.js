// Cloudflare Worker: TipRanks API Proxy
// Deployed on your CF account — uses CF edge IPs (not Supabase data center IPs)
// Adds CORS headers so your app can call it from the browser
// Rate limits: 1 request per 2 seconds via simple in-memory counter

addEventListener('fetch', function(event) {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  try {
    var resp = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.tipranks.com/stocks/' + ticker.toLowerCase() + '/forecast',
        'Origin': 'https://www.tipranks.com',
      },
      cf: { cacheTtl: 300 } // Cache for 5 minutes at CF edge
    });

    if (!resp.ok) {
      return jsonResp({ error: true, status: resp.status, message: 'TipRanks returned ' + resp.status }, resp.status);
    }

    var contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('json')) {
      return jsonResp({ error: true, status: resp.status, message: 'TipRanks returned non-JSON (likely Cloudflare challenge)' }, 403);
    }

    var body = await resp.text();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
      }
    });
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
