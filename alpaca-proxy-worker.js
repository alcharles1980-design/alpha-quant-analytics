// Cloudflare Worker: Alpaca API Proxy (handles CORS for browser calls)
export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, APCA-API-KEY-ID, APCA-API-SECRET-KEY, X-Alpaca-Path',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    var alpacaKey = request.headers.get('APCA-API-KEY-ID');
    var alpacaSecret = request.headers.get('APCA-API-SECRET-KEY');
    var alpacaPath = request.headers.get('X-Alpaca-Path');

    if (!alpacaKey || !alpacaSecret || !alpacaPath) {
      return new Response(JSON.stringify({error: 'Missing APCA-API-KEY-ID, APCA-API-SECRET-KEY, or X-Alpaca-Path headers'}), {
        status: 400, headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}
      });
    }

    var base = alpacaKey.startsWith('PK') ? 'https://paper-api.alpaca.markets' : 'https://api.alpaca.markets';
    var url = base + alpacaPath;

    try {
      var resp = await fetch(url, {
        method: request.method,
        headers: {
          'APCA-API-KEY-ID': alpacaKey,
          'APCA-API-SECRET-KEY': alpacaSecret,
          'Content-Type': 'application/json'
        },
        body: request.method !== 'GET' ? await request.text() : undefined
      });

      var body = await resp.text();
      return new Response(body, {
        status: resp.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-cache'
        }
      });
    } catch (e) {
      return new Response(JSON.stringify({error: e.message}), {
        status: 502, headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}
      });
    }
  }
};
