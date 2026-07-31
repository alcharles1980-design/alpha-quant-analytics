// Overnight hidden-liquidity level scanner.
//
// Sweeps the BOATS tape, finds prices where many prints landed at ONE EXACT PRICE, ONE SIDE,
// INSIDE THE SPREAD, and registers them. Discovery, not reaction: the burst says a resting
// order exists; the tradeable moment is the revisit, so levels persist after the burst ends.
//
// Runs from pg_cron job 51 every 2 minutes during the overnight session.
//
// DEDUPLICATION IS SERVER-SIDE, IN register_level(). LOOKBACK_S deliberately exceeds the cron
// cadence so no burst falls between sweeps; the cost is that a burst near the boundary is
// detected twice. register_level() merges any burst whose window overlaps an existing visit
// and does NOT increment `visits`. Do not "fix" the overlap by shrinking LOOKBACK_S -- that
// trades duplicate detections for missed ones, which is the worse failure.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SH = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

const LOOKBACK_S = 150;      // deliberate overlap with the 2-minute cadence -- see note above
const MIN_PRINTS = 25;
const MAX_SPAN_S = 120;
const MAX_SYMBOLS = 300;     // bounded so the function finishes well inside its wall clock
const MAX_PAGES = 12;        // was 6, which could silently drop pages on a busy sweep

async function sbGet(path: string, extra: Record<string, string> = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { ...SH, ...extra } });
  if (!r.ok) throw new Error(`supabase ${path}: ${r.status}`);
  return r.json();
}

// The overnight session beginning 20:00 ET is stamped the FOLLOWING calendar date.
// A naive "today in ET" is wrong for half the session and silently returns nothing.
function sessionDate(now: Date): string {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const d = new Date(et);
  if (et.getHours() >= 20) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
function etHour(now: Date): number {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour: "numeric", hour12: false,
  }).format(now));
}

type Trade = { t: string; p: number; s: number };
type Quote = { t: string; bp: number; ap: number };

async function alpaca(url: string, key: string, sec: string) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": sec } });
      if (r.ok) return await r.json();
    } catch (_e) { /* retry */ }
    await new Promise((res) => setTimeout(res, 500 * (a + 1)));
  }
  return null;
}

Deno.serve(async (req) => {
  const started = Date.now();
  const now = new Date();
  const hour = etHour(now);
  const live = hour >= 20 || hour < 4;
  const force = new URL(req.url).searchParams.get("force") === "1";

  if (!live && !force) {
    return new Response(JSON.stringify({ skipped: "outside overnight session", et_hour: hour }),
      { headers: { "Content-Type": "application/json" } });
  }

  try {
    const cfg = await sbGet("app_config?select=key,value&key=in.(alpaca_key,alpaca_secret)");
    const map: Record<string, string> = {};
    for (const row of cfg) map[row.key] = row.value;
    const AK = map["alpaca_key"], AS = map["alpaca_secret"];
    if (!AK || !AS) throw new Error("alpaca keys missing from app_config");

    const sd = sessionDate(now);
    let uni: string[] = (await sbGet(
      `overnight_actives?session_date=eq.${sd}&select=ticker&order=trades.desc`,
      { "Range-Unit": "items", Range: `0-${MAX_SYMBOLS - 1}` })).map((x: any) => x.ticker);
    if (uni.length < 20) {
      uni = (await sbGet(`overnight_actives?select=ticker&order=session_date.desc,trades.desc`,
        { "Range-Unit": "items", Range: `0-${MAX_SYMBOLS - 1}` })).map((x: any) => x.ticker);
      uni = [...new Set(uni)];
    }
    if (!uni.length) throw new Error("empty universe");

    const start = new Date(now.getTime() - LOOKBACK_S * 1000).toISOString().slice(0, 19) + "Z";
    const tape: Record<string, Trade[]> = {};

    // A 200 with a next_page_token still pending is silent truncation -- the #1 failure class
    // here. Count it and report it rather than discovering missing levels weeks later.
    let truncatedChunks = 0;
    for (let i = 0; i < uni.length; i += 400) {
      const ch = uni.slice(i, i + 400).join(",");
      let url: string | null =
        `https://data.alpaca.markets/v2/stocks/trades?feed=boats&limit=10000&start=${start}&symbols=${ch}`;
      let guard = 0;
      let pending = false;
      while (url && guard < MAX_PAGES) {
        const j: any = await alpaca(url, AK, AS);
        if (!j) break;
        for (const [k, v] of Object.entries(j.trades ?? {})) {
          (tape[k] ??= []).push(...(v as Trade[]));
        }
        guard++;
        pending = Boolean(j.next_page_token);
        url = j.next_page_token
          ? `${url.split("&page_token")[0]}&page_token=${encodeURIComponent(j.next_page_token)}`
          : null;
      }
      if (pending && url) truncatedChunks++;   // ran out of page budget with data still unread
    }

    const cands: Record<string, Array<[number, Trade[]]>> = {};
    for (const [sym, rowsRaw] of Object.entries(tape)) {
      const rows = rowsRaw.filter((t) => t.s <= 10).sort((a, b) => a.t < b.t ? -1 : 1);
      const byLvl: Record<string, Trade[]> = {};
      for (const t of rows) (byLvl[String(t.p)] ??= []).push(t);
      for (const [pxs, pr] of Object.entries(byLvl)) {
        if (pr.length < MIN_PRINTS) continue;
        let i = 0;
        while (i < pr.length) {
          let j = i;
          while (j + 1 < pr.length &&
            (Date.parse(pr[j + 1].t) - Date.parse(pr[i].t)) / 1000 <= MAX_SPAN_S) j++;
          if (j - i + 1 >= MIN_PRINTS) (cands[sym] ??= []).push([Number(pxs), pr.slice(i, j + 1)]);
          i = j > i ? j + 1 : i + 1;
        }
      }
    }

    let detected = 0, registered = 0;
    for (const [sym, lst] of Object.entries(cands)) {
      const qj: any = await alpaca(
        `https://data.alpaca.markets/v2/stocks/${sym}/quotes?feed=boats&limit=10000&start=${start}`, AK, AS);
      const q: Quote[] = (qj?.quotes ?? []).sort((a: Quote, b: Quote) => a.t < b.t ? -1 : 1);
      if (!q.length) continue;
      const qt = q.map((x) => Date.parse(x.t));
      for (const [px, win] of lst) {
        detected++;
        const poss: number[] = [], sprs: number[] = [], bids: number[] = [], asks: number[] = [];
        for (const t of win) {
          const tt = Date.parse(t.t);
          let lo = 0, hi = qt.length - 1, k = -1;
          while (lo <= hi) { const m = (lo + hi) >> 1; if (qt[m] <= tt) { k = m; lo = m + 1; } else hi = m - 1; }
          if (k < 0) continue;
          const b = q[k];
          if (!(b.bp > 0 && b.ap > b.bp)) continue;
          if ((tt - qt[k]) / 1000 > 30) continue;              // stale quote: join is meaningless
          poss.push((px - b.bp) / (b.ap - b.bp));
          sprs.push(b.ap - b.bp); bids.push(b.bp); asks.push(b.ap);
        }
        if (poss.length < MIN_PRINTS * 0.8) continue;
        const lo = poss.filter((p) => p < 0.5).length, hi = poss.length - lo;
        if (Math.max(lo, hi) / poss.length < 0.90) continue;   // must be one-sided
        // POSITION IS CHECKED AT EVERY PRINT. Sampling only the last print made a burst look
        // like hidden liquidity when the price was actually the bid for most of it.
        const touch = poss.filter((p) => p <= 0.02 || p >= 0.98).length / poss.length * 100;
        const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
        const mp = med(poss), msp = med(sprs), mb = med(bids), ma = med(asks);
        const states = new Set(q.filter((x) => x.t >= win[0].t && x.t <= win[win.length - 1].t)
          .map((x) => `${x.bp}/${x.ap}`)).size || 1;
        const body = {
          p_date: sd, p_ticker: sym, p_price: px, p_side: mp >= 0.5 ? "ASK" : "BID",
          p_seen: win[win.length - 1].t, p_prints: win.length,
          p_shares: win.reduce((a, x) => a + x.s, 0),
          p_span: (Date.parse(win[win.length - 1].t) - Date.parse(win[0].t)) / 1000,
          p_bid: mb, p_ask: ma, p_pos: mp, p_spread: msp,
          p_edge: mp >= 0.5 ? (px - mb) : (ma - px),
          p_states: states, p_at_touch: touch,
        };
        const rr = await fetch(`${SB}/rest/v1/rpc/register_level`,
          { method: "POST", headers: SH, body: JSON.stringify(body) });
        if (rr.ok && (await rr.json()) !== null) registered++;
      }
    }

    return new Response(JSON.stringify({
      ok: true, session_date: sd, et_hour: hour, symbols: uni.length,
      traded: Object.keys(tape).length,
      prints: Object.values(tape).reduce((a, v) => a + v.length, 0),
      detected, registered,
      truncated_chunks: truncatedChunks,   // MUST be 0; anything else means dropped tape
      ms: Date.now() - started,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e), ms: Date.now() - started }),
      { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
