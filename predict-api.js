// Alpha Quant Prediction API - Cloudflare Worker
// GET /predict/:ticker           → latest daily prediction
// GET /predict/:ticker/hourly    → latest hourly prediction
// GET /predict/:ticker/hourly/:hour → specific hour prediction

const SB_URL = 'https://haeqzegdlwryvaecanrn.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhhZXF6ZWdkbHdyeXZhZWNhbnJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDI1NTk4MzQsImV4cCI6MjA1ODEzNTgzNH0.VjOOc9GnvJyrdzAKif0kbT3JGof5z4hSkhCSTpnXKpQ';

function sbHeaders() {
  return { 'Content-Type': 'application/json', 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY };
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET', 'Content-Type': 'application/json' };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    // OPTIONS (CORS)
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

    // GET /predict/:ticker
    if (parts[0] === 'predict' && parts[1]) {
      const ticker = parts[1].toUpperCase();
      const type = parts[2] || 'daily';
      const hour = parts[3] ? parseInt(parts[3]) : null;

      try {
        if (type === 'hourly') {
          let query = `hourly_predictions?ticker=eq.${ticker}&order=created_at.desc&limit=1`;
          if (hour !== null) query = `hourly_predictions?ticker=eq.${ticker}&hour=eq.${hour}&order=created_at.desc&limit=1`;
          const r = await fetch(`${SB_URL}/rest/v1/${query}`, { headers: sbHeaders() });
          const data = await r.json();
          if (!data.length) return new Response(JSON.stringify({ error: 'No prediction found', ticker, type }), { status: 404, headers: corsHeaders() });
          return new Response(JSON.stringify({
            ticker, type: 'hourly',
            trade_date: data[0].trade_date,
            hour: data[0].hour,
            predicted_tp_pct: data[0].predicted_tp_pct,
            features_used: data[0].features_used,
            model_version: data[0].model_version,
            created_at: data[0].created_at
          }), { headers: corsHeaders() });
        } else {
          const r = await fetch(`${SB_URL}/rest/v1/daily_predictions?ticker=eq.${ticker}&order=trade_date.desc&limit=1`, { headers: sbHeaders() });
          const data = await r.json();
          if (!data.length) return new Response(JSON.stringify({ error: 'No prediction found', ticker, type }), { status: 404, headers: corsHeaders() });
          return new Response(JSON.stringify({
            ticker, type: 'daily',
            trade_date: data[0].trade_date,
            predicted_tp_pct: data[0].predicted_tp_pct,
            flat_tp_pct: data[0].flat_tp_pct,
            features_used: data[0].features_used,
            confidence: data[0].confidence,
            model_version: data[0].model_version,
            created_at: data[0].created_at
          }), { headers: corsHeaders() });
        }
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders() });
      }
    }

    // Health check
    if (parts[0] === 'health') return new Response(JSON.stringify({ status: 'ok', time: new Date().toISOString() }), { headers: corsHeaders() });

    return new Response(JSON.stringify({
      endpoints: [
        'GET /predict/:ticker - latest daily prediction',
        'GET /predict/:ticker/hourly - latest hourly prediction',
        'GET /predict/:ticker/hourly/:hour - specific hour prediction',
        'GET /health - health check'
      ]
    }), { headers: corsHeaders() });
  }
};
