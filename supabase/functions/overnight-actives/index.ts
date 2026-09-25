import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// overnight-actives: scans the FULL universe against the Alpaca BOATS (Blue Ocean ATS) overnight
// feed and ranks by trade count / volume, with relative-volume and relative-trades computed from
// trailing sessions EXCLUDING the current one.
//
// Why this exists: the app's Overnight tab previously took Alpaca's REGULAR-session most-actives
// screener and looked up those names' overnight bars — so names quiet in RTH but busy overnight
// never appeared. Alpaca's screener has no overnight mode (feed=boats returns 400).
//
// Prior regular-session closes are CACHED in prev_rth_closes (shared with the pre-market scanner).
// They're static — yesterday's close never changes — but fetching them for all ~11,000 symbols on
// every run was the dominant cost (a full scan took 108s).
//
// PAYLOAD (v5, Sep 25 2026): only the TARGET session is fetched and sent. Until v4 every 5-minute run
// fetched 25 days of daily bars for the whole universe and posted ~20,000 rows, of which only the
// target session is ever written. The rest existed to feed the baseline — but those sessions are
// already stored in overnight_actives, so they were double-counted (fixed DB-side in
// upsert_overnight_actives v3) and ~99.6% redundant: on Sep 25 they added 82 sessions for 75 of
// 1,434 tickers and nothing for the other 1,359. Target-only payloads also let the RPC's baseline
// cache (actives_baseline) persist for the whole session instead of rebuilding every run.
// body.history_days (<= 25) restores the old history payload for a one-off gap-fill run.
// body.dry_run builds the payload and reports its size without writing.
//
// Requires the Algo Trader Plus subscription for recent BOATS data.

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

function J(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}

function utcDate(d: Date): string { return d.toISOString().slice(0, 10); }

// PostgREST silently caps result sets (~1000 rows) regardless of &limit=, so the universe must be
// paged explicitly with Range headers or we'd scan only a fraction of the market.
async function loadUniverse(): Promise<string[]> {
  const out: string[] = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 40000; offset += PAGE) {
    const r = await fetch(
      `${SB_URL}/rest/v1/market_universe_full?select=ticker&type=in.(CS,ADRC,ETF)&order=ticker`,
      { headers: { ...sb, Range: `${offset}-${offset + PAGE - 1}`, "Range-Unit": "items" } },
    );
    if (!r.ok) break;
    const j = await r.json();
    if (!Array.isArray(j) || j.length === 0) break;
    for (const row of j) if (row?.ticker) out.push(row.ticker);
    if (j.length < PAGE) break;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  const t0 = Date.now();
  try {
    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* no body is fine */ }

    const kr = await fetch(`${SB_URL}/rest/v1/app_config?key=in.(alpaca_key,alpaca_secret)&select=key,value`, { headers: sb });
    if (!kr.ok) return J({ error: `app_config ${kr.status}` }, 500);
    const kj = await kr.json();
    const cfg: Record<string, string> = {};
    if (Array.isArray(kj)) for (const r of kj) cfg[r.key] = r.value;
    const AK = cfg["alpaca_key"], AS = cfg["alpaca_secret"];
    if (!AK || !AS) return J({ error: "alpaca keys missing in app_config" }, 500);
    const alp = { "APCA-API-KEY-ID": AK, "APCA-API-SECRET-KEY": AS };

    // Target session. BOATS bars are stamped 00:00Z for the session that BEGAN at 8PM ET the
    // previous evening, so after 4AM ET (08:00Z) the next session carries tomorrow's stamp.
    // NOTE: the settle cron passes session_date explicitly precisely because this rollover made it
    // target TOMORROW at 08:30Z, silently scanning a session that didn't exist yet.
    const now = new Date();
    let target = typeof body.session_date === "string" ? body.session_date as string : "";
    if (!target) {
      const h = now.getUTCHours();
      const d = new Date(now);
      if (h >= 8) d.setUTCDate(d.getUTCDate() + 1);
      target = utcDate(d);
    }

    // Default 0 = target session only (see PAYLOAD above). Capped at the old 25-day window.
    const HIST_DAYS = Math.min(Math.max(Number(body.history_days) || 0, 0), 25);
    const dryRun = body.dry_run === true;
    // The fetch window opens at least ONE day before the target even when HIST_DAYS = 0: a BOATS 1Day
    // request whose start is exactly the target's 00:00Z stamp returns NO bars (verified Sep 25 2026 —
    // the target-only v5 draft fetched nothing and would have silently written nothing), while a window
    // opening the day before returns the target bar. Rows outside the wanted sessions are dropped below.
    const startD = new Date(target + "T00:00:00Z");
    startD.setUTCDate(startD.getUTCDate() - Math.max(HIST_DAYS, 1));
    const startStr = utcDate(startD);
    const endStr = target;   // bars are stamped 00:00Z on the session date; nothing later exists yet

    // Prior regular session (the weekday before the overnight session's stamp date).
    const prevD = new Date(target + "T00:00:00Z");
    do { prevD.setUTCDate(prevD.getUTCDate() - 1); } while (prevD.getUTCDay() === 0 || prevD.getUTCDay() === 6);
    const prevStr = utcDate(prevD);

    const universe = await loadUniverse();
    if (universe.length === 0) return J({ error: "empty universe" }, 500);

    const BATCH = Number(body.batch_size) > 0 ? Number(body.batch_size) : 800;

    // ── Prior closes: read the shared cache first ──
    const prevClose: Record<string, number> = {};
    let cachedCount = 0;
    try {
      const cr = await fetch(`${SB_URL}/rest/v1/rpc/get_prev_rth_closes`, {
        method: "POST", headers: sb, body: JSON.stringify({ for_date: prevStr }),
      });
      if (cr.ok) {
        const cj = await cr.json();
        if (cj && typeof cj === "object") {
          for (const k of Object.keys(cj)) {
            const v = Number(cj[k]);
            if (isFinite(v) && v > 0) { prevClose[k] = v; cachedCount++; }
          }
        }
      }
    } catch (_e) { /* fall through to fetching */ }

    // Fetch only what the cache is missing, then store it for subsequent runs.
    const needClose = universe.filter((s) => prevClose[s] == null);
    let prevCalls = 0, prevFailed = 0, prevStored = 0;
    if (needClose.length > 0 && !dryRun) {
      const fetched: { t: string; c: number }[] = [];
      for (let i = 0; i < needClose.length; i += BATCH) {
        const chunk = needClose.slice(i, i + BATCH);
        try {
          const pr = await fetch(
            `https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(chunk.join(","))}` +
            `&timeframe=1Day&start=${prevStr}T00:00:00Z&end=${prevStr}T23:59:59Z&limit=10000&feed=sip`,
            { headers: alp },
          );
          prevCalls++;
          if (pr.ok) {
            const pj = await pr.json();
            const pb = pj?.bars || {};
            for (const s of Object.keys(pb)) {
              const arr = pb[s];
              if (Array.isArray(arr) && arr.length) {
                const c = arr[arr.length - 1]?.c;
                if (typeof c === "number" && c > 0) { prevClose[s] = c; fetched.push({ t: s, c }); }
              }
            }
          } else prevFailed++;
        } catch (_e) { prevFailed++; }
      }
      if (fetched.length > 0) {
        try {
          const sr = await fetch(`${SB_URL}/rest/v1/rpc/upsert_prev_rth_closes`, {
            method: "POST", headers: sb, body: JSON.stringify({ rows: fetched, for_date: prevStr }),
          });
          if (sr.ok) prevStored = await sr.json();
        } catch (_e) { /* caching is an optimisation, not a requirement */ }
      }
    }

    // ── BOATS bars ──
    const rows: Record<string, unknown>[] = [];
    let calls = 0, batchesFailed = 0;
    const seenDates = new Set<string>();
    let lastErr = "";

    for (let i = 0; i < universe.length; i += BATCH) {
      const chunk = universe.slice(i, i + BATCH);
      let pageToken: string | null = null;
      let guard = 0;
      do {
        let url = `https://data.alpaca.markets/v2/stocks/bars?symbols=${encodeURIComponent(chunk.join(","))}` +
          `&timeframe=1Day&start=${startStr}T00:00:00Z&end=${endStr}T23:59:59Z&limit=10000&feed=boats`;
        if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;
        const r = await fetch(url, { headers: alp });
        calls++;
        if (!r.ok) {
          batchesFailed++;
          if (!lastErr) lastErr = `${r.status}: ${(await r.text()).slice(0, 160)}`;
          pageToken = null;
          break;
        }
        const j = await r.json();
        const bars = j?.bars || {};
        for (const symbol of Object.keys(bars)) {
          const arr = bars[symbol];
          if (!Array.isArray(arr)) continue;
          for (const b of arr) {
            const d = String(b?.t || "").slice(0, 10);
            if (!d) continue;
            seenDates.add(d);
            const rec: Record<string, unknown> = { t: symbol, d, o: b.o, h: b.h, l: b.l, c: b.c, vw: b.vw, v: b.v, n: b.n };
            if (d === target && prevClose[symbol] != null) rec.pc = prevClose[symbol];
            rows.push(rec);
          }
        }
        pageToken = j?.next_page_token || null;
      } while (pageToken && ++guard < 20);
    }

    const fetchedBars = rows.length;
    // Send the target session only, unless history was explicitly requested.
    if (HIST_DAYS === 0) {
      for (let k = rows.length - 1; k >= 0; k--) if (rows[k].d !== target) rows.splice(k, 1);
    }

    if (rows.length === 0) {
      return J({ ok: true, note: "no BOATS bars returned", target, window: [startStr, endStr], universe: universe.length, calls, batchesFailed, lastErr, ms: Date.now() - t0 });
    }

    const targetRows = rows.filter((r) => r.d === target).length;
    const withPrev = rows.filter((r) => r.d === target && r.pc != null).length;

    // Partial only while inside the live session window (00:00-08:00Z = 8PM-4AM ET) AND scanning
    // that session. An explicit session_date for a past session must never be marked partial.
    const hUtc = now.getUTCHours();
    const isPartial = hUtc < 8 && target === utcDate(now);

    const payload = JSON.stringify({ rows, target_date: target, partial: isPartial });
    const summary = {
      target, prev_rth_day: prevStr, window: [startStr, endStr], history_days: HIST_DAYS, universe: universe.length,
      calls, batchesFailed, lastErr: lastErr || undefined,
      prev_from_cache: cachedCount, prev_fetched_calls: prevCalls, prev_failed: prevFailed, prev_stored: prevStored,
      bars_fetched: fetchedBars, bars_total: rows.length, bars_for_target: targetRows, with_prev_close: withPrev, payload_bytes: payload.length,
      dates_seen: Array.from(seenDates).sort().slice(-6), is_partial: isPartial,
    };
    if (dryRun) return J({ ok: true, dry_run: true, ...summary, ms: Date.now() - t0 });

    const rr = await fetch(`${SB_URL}/rest/v1/rpc/upsert_overnight_actives`, { method: "POST", headers: sb, body: payload });
    if (!rr.ok) return J({ error: `rpc ${rr.status}`, body: (await rr.text()).slice(0, 300) }, 500);
    const written = await rr.json();

    return J({ ok: true, ...summary, written, ms: Date.now() - t0 });
  } catch (e) {
    return J({ error: String((e as Error)?.message || e), ms: Date.now() - t0 }, 500);
  }
});
