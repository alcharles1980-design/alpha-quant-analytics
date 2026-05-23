// Cloudflare Worker: Alpaca API Proxy (handles CORS for browser calls)
// Supports both trading API and market data API via X-Alpaca-Base header
export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, APCA-API-KEY-ID, APCA-API-SECRET-KEY, X-Alpaca-Path, X-Alpaca-Base',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    var alpacaKey = request.headers.get('APCA-API-KEY-ID');
    var alpacaSecret = request.headers.get('APCA-API-SECRET-KEY');
    var alpacaPath = request.headers.get('X-Alpaca-Path');
    var alpacaBase = request.headers.get('X-Alpaca-Base');

    if (!alpacaKey || !alpacaSecret || !alpacaPath) {
      return new Response(JSON.stringify({error: 'Missing required headers'}), {
        status: 400, headers: {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'}
      });
    }

    // Default base: paper-api for PK keys, api for live keys
    // Override with X-Alpaca-Base header (e.g. 'data' for market data)
    var base;
    if (alpacaBase === 'data') {
      base = 'https://data.alpaca.markets';
    } else if (alpacaKey.startsWith('PK')) {
      base = 'https://paper-api.alpaca.markets';
    } else {
      base = 'https://api.alpaca.markets';
    }

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
