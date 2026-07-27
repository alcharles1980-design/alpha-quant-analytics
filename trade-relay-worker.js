// Cloudflare Worker + Durable Object: Alpaca trade-count relay.
//
// WHY THIS EXISTS
// Trailing trade counts were derived from 1-minute bars, which are WRONG twice over:
//   - BOATS bars EXCLUDE odd lots, missing a median 37.5% of overnight trades
//     (COIN: 99 on the tape, 0 in its bars).
//   - SIP bars include odd lots but SETTLE SLOWLY — measured against the raw tape they
//     are ~19% low at 2 minutes old, ~9-11% low at 5-20 minutes, and only converge at
//     40-90 minutes. That is precisely the window the columns report on.
// Counting the prints themselves off the stream is exact and has no settling lag.
//
// WHY A RELAY RATHER THAN STREAMING FROM THE BROWSER
// Alpaca allows ONE stream connection per account PER FEED (a second gets
// `406 connection limit exceeded`). Every AlphaQuant browser authenticates with the SAME
// app_config credentials, so a browser-side stream would serve exactly one tab, for one
// user, and 406 everyone else. One relay holds the upstream connection and fans the counts
// out to every client. Measured and relevant: the limit is per FEED, not per account, so
// sip and boats can run side by side; and the TRADING stream is a separate pool entirely,
// so mbot's order feed does not compete with this.
//
// DELIBERATELY DOES NOT PERSIST TO SUPABASE. Per-minute counts for ~1,300 symbols would be
// ~80k rows/hour against a 512 MB free-plan database — the same shape as the Jul 22 quota
// incident. Counts live in memory and are served on request; they are disposable by design.

const KEEP_MINUTES = 20;        // ring depth; the UI needs 15
const STALE_MS     = 90 * 1000; // no message for this long => treat the feed as degraded
const FEEDS = {
  sip:   'wss://stream.data.alpaca.markets/v2/sip',
  boats: 'wss://stream.data.alpaca.markets/v1beta1/boats',   // NOT /v2 — that 404s
};

export class TradeCounter {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.feed = null;
    this.ws = null;
    this.status = 'idle';
    this.lastMsgAt = 0;
    this.connectedAt = 0;
    this.retries = 0;
    // counts: Map<symbol, Map<minuteIndex, count>>
    this.counts = new Map();
    // A minute is only reportable if the stream was connected for ALL of it. Without this a
    // reconnect gap silently undercounts, which is the exact failure the bar-based version had.
    this.covered = new Set();
  }

  nowMin() { return Math.floor(Date.now() / 60000); }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/start')) {
      this.feed = url.searchParams.get('feed') || 'sip';
      await this.ensureConnected();
      return this.json({ ok: true, feed: this.feed, status: this.status });
    }
    if (url.pathname.endsWith('/health')) return this.json(this.health());
    if (url.pathname.endsWith('/counts')) {
      await this.ensureConnected();
      const symsParam = url.searchParams.get('syms') || '';
      const syms = symsParam ? symsParam.split(',').filter(Boolean) : [];
      return this.json(this.snapshot(syms));
    }
    return new Response('not found', { status: 404 });
  }

  health() {
    const age = this.lastMsgAt ? Date.now() - this.lastMsgAt : null;
    return {
      feed: this.feed,
      status: this.status,
      // `degraded` is what the client should read to decide whether to trust the numbers.
      degraded: this.status !== 'open' || age === null || age > STALE_MS,
      lastMessageAgeMs: age,
      connectedForMs: this.connectedAt ? Date.now() - this.connectedAt : 0,
      symbolsSeen: this.counts.size,
      coveredMinutes: this.covered.size,
      retries: this.retries,
    };
  }

  // Trailing windows over COMPLETE minutes only. The in-progress minute is excluded because a
  // partial bucket would make the 1-minute figure ratchet up and reset between polls.
  snapshot(syms) {
    const nm = this.nowMin();
    const want = [];
    for (let ago = 1; ago <= 15; ago++) want.push(nm - ago);
    // Only report windows whose minutes are fully covered; otherwise say so rather than
    // returning a number that is quietly too low.
    const ready1  = this.covered.has(nm - 1);
    const ready5  = want.slice(0, 5).every(m => this.covered.has(m));
    const ready15 = want.every(m => this.covered.has(m));
    const out = {};
    const list = syms.length ? syms : [...this.counts.keys()];
    for (const s of list) {
      const per = this.counts.get(s);
      let t1 = 0, t5 = 0, t15 = 0;
      if (per) {
        for (let ago = 1; ago <= 15; ago++) {
          const n = per.get(nm - ago) || 0;
          if (ago === 1) t1 += n;
          if (ago <= 5) t5 += n;
          t15 += n;
        }
      }
      // A symbol the relay has never seen genuinely traded zero times in the window — the
      // stream is a firehose of every print, so absence is information, not ignorance.
      out[s] = { t1, t5, t15 };
    }
    return {
      asOfMinute: nm,
      ready: { t1: ready1, t5: ready5, t15: ready15 },
      health: this.health(),
      counts: out,
    };
  }

  async ensureConnected() {
    if (this.ws && this.status === 'open') return;
    if (this.status === 'connecting') return;
    await this.connect();
  }

  async connect() {
    const url = FEEDS[this.feed || 'sip'];
    if (!url) { this.status = 'bad-feed'; return; }
    this.status = 'connecting';
    try {
      const resp = await fetch(url, { headers: { Upgrade: 'websocket' } });
      const ws = resp.webSocket;
      if (!ws) { this.status = 'no-socket'; this.scheduleRetry(); return; }
      ws.accept();
      this.ws = ws;

      ws.addEventListener('message', (ev) => this.onMessage(ev));
      ws.addEventListener('close', () => { this.status = 'closed'; this.ws = null; this.scheduleRetry(); });
      ws.addEventListener('error', () => { this.status = 'error'; this.ws = null; this.scheduleRetry(); });

      ws.send(JSON.stringify({
        action: 'auth',
        key: this.env.ALPACA_KEY,
        secret: this.env.ALPACA_SECRET,
      }));
      // Wildcard: the relay counts EVERY print on the tape, so any client can ask about any
      // symbol with no subscription churn as filters and tabs change.
      ws.send(JSON.stringify({ action: 'subscribe', trades: ['*'] }));
      this.status = 'open';
      this.connectedAt = Date.now();
      this.retries = 0;
      // The minute in progress at connect time is NOT fully covered — mark coverage only from
      // the next whole minute onward.
      this.coverFrom = this.nowMin() + 1;
      await this.state.storage.setAlarm(Date.now() + 30000);
    } catch (e) {
      this.status = 'connect-failed';
      this.scheduleRetry();
    }
  }

  scheduleRetry() {
    this.retries++;
    const backoff = Math.min(60000, 1000 * Math.pow(2, Math.min(this.retries, 6)));
    this.state.storage.setAlarm(Date.now() + backoff);
  }

  // Alarm does double duty: reconnect after a drop, and keep the object from being evicted
  // while it should be holding a stream.
  async alarm() {
    const nm = this.nowMin();
    if (this.status === 'open' && this.lastMsgAt && Date.now() - this.lastMsgAt > STALE_MS) {
      try { this.ws && this.ws.close(); } catch (e) {}
      this.ws = null; this.status = 'stale';
    }
    if (this.status !== 'open') await this.connect();
    this.prune(nm);
    await this.state.storage.setAlarm(Date.now() + 30000);
  }

  onMessage(ev) {
    this.lastMsgAt = Date.now();
    let msgs;
    try { msgs = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch (e) { return; }
    if (!Array.isArray(msgs)) return;
    const nm = this.nowMin();
    for (const m of msgs) {
      if (m.T !== 't') continue;                 // trades only
      const sym = m.S;
      if (!sym) continue;
      const ts = Date.parse(m.t);
      const min = isFinite(ts) ? Math.floor(ts / 60000) : nm;
      let per = this.counts.get(sym);
      if (!per) { per = new Map(); this.counts.set(sym, per); }
      per.set(min, (per.get(min) || 0) + 1);
    }
    // Any whole minute that has fully elapsed while connected is now trustworthy.
    if (this.coverFrom != null) {
      for (let m = this.coverFrom; m < nm; m++) this.covered.add(m);
    }
    if (nm % 5 === 0) this.prune(nm);
  }

  prune(nm) {
    const cutoff = nm - KEEP_MINUTES;
    for (const [sym, per] of this.counts) {
      for (const m of per.keys()) if (m < cutoff) per.delete(m);
      if (per.size === 0) this.counts.delete(sym);
    }
    for (const m of this.covered) if (m < cutoff) this.covered.delete(m);
  }

  json(obj) {
    return new Response(JSON.stringify(obj), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    const feed = url.searchParams.get('feed') || 'sip';
    if (!FEEDS[feed]) {
      return new Response(JSON.stringify({ error: 'unknown feed', valid: Object.keys(FEEDS) }), {
        status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }
    // One Durable Object per feed, so sip and boats each hold their own upstream connection —
    // which is exactly what Alpaca's per-feed limit allows.
    const id = env.TRADE_COUNTER.idFromName(feed);
    const stub = env.TRADE_COUNTER.get(id);
    const inner = new URL(request.url);
    inner.searchParams.set('feed', feed);
    return stub.fetch(inner.toString(), request);
  },

  // Cron keeps both relays warm and reconnected outside of client traffic.
  async scheduled(event, env, ctx) {
    for (const feed of Object.keys(FEEDS)) {
      const stub = env.TRADE_COUNTER.get(env.TRADE_COUNTER.idFromName(feed));
      ctx.waitUntil(stub.fetch(`https://relay/start?feed=${feed}`));
    }
  },
};
