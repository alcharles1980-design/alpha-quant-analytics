// Cloudflare Worker: SEC EDGAR Proxy (handles CORS + required User-Agent for browser calls)
// SEC endpoints do not send CORS headers and reject requests without a descriptive User-Agent.
// Client sends the desired path via X-SEC-Path and (optionally) X-SEC-Host:
//   - data.sec.gov  (default) for /api/xbrl/companyconcept/... facts
//   - www.sec.gov            for /files/company_tickers.json (ticker->CIK map)
// Responses are cached at the edge briefly to stay well under SEC rate limits.
export default {
  async fetch(request) {
    const CORS = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-SEC-Path, X-SEC-Host'
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: Object.assign({ 'Access-Control-Max-Age': '86400' }, CORS) });
    }

    const url0 = new URL(request.url);
    const secPath = request.headers.get('X-SEC-Path') || url0.searchParams.get('path');
    let secHost = request.headers.get('X-SEC-Host') || url0.searchParams.get('host') || 'data.sec.gov';

    if (!secPath || !secPath.startsWith('/')) {
      return new Response(JSON.stringify({ error: 'Missing or invalid X-SEC-Path header' }), {
        status: 400, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
      });
    }
    // Only allow the two SEC hosts we use (avoid open-proxy abuse)
    if (secHost !== 'data.sec.gov' && secHost !== 'www.sec.gov') {
      return new Response(JSON.stringify({ error: 'Host not allowed' }), {
        status: 400, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
      });
    }

    const url = 'https://' + secHost + secPath;

    try {
      // SEC fair-access policy requires UA formatted as "Company Name email@domain".
      // Cloudflare's fetch preserves an explicit User-Agent header; set it verbatim.
      const req = new Request(url, { method: 'GET' });
      req.headers.set('User-Agent', 'Alpha Quant Analytics admin@alphaquant.dev');
      req.headers.set('Accept', 'application/json, text/plain, */*');
      req.headers.set('Accept-Encoding', 'gzip, deflate');
      req.headers.set('Host', secHost);
      const resp = await fetch(req, { cf: { cacheTtl: 3600, cacheEverything: true } });

      const body = await resp.text();
      return new Response(body, {
        status: resp.status,
        headers: Object.assign({
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=1800'
        }, CORS)
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: 502, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS)
      });
    }
  }
};
