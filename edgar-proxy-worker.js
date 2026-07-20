// Cloudflare Worker: read-only data proxy (handles CORS for browser calls)
// Proxies SEC EDGAR (needs a descriptive User-Agent) and Alpha Vantage (no CORS of its own).
// Client sends the desired path + host via ?path=...&host=... (or X-SEC-Path / X-SEC-Host):
//   - data.sec.gov / www.sec.gov  — SEC EDGAR XBRL facts + ticker->CIK map
//   - www.alphavantage.co         — Alpha Vantage OVERVIEW / EARNINGS (analyst data)
// Responses are edge-cached briefly to respect upstream rate limits (esp. Alpha Vantage's 25/day).
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
    // Allowlist the read-only hosts we proxy (avoid open-proxy abuse): SEC EDGAR + Alpha Vantage
    var ALLOWED_HOSTS = ['data.sec.gov', 'www.sec.gov', 'www.alphavantage.co'];
    if (ALLOWED_HOSTS.indexOf(secHost) === -1) {
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
