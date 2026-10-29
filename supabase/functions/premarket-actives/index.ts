import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// premarket-actives: ranks pre-market (4:00-9:30 AM ET) activity by aggregating SIP MINUTE bars.
//
// Why minute bars rather than a daily bar: unlike BOATS (where one daily bar IS the overnight
// session), pre-market is a sub-window of the regular SIP day — a 1Day SIP bar covers the whole
// session (measured: NVDA 109M shares, not pre-market). Alpaca's most-actives screener has no
// session parameter either (session=pre and feed=boats both return 400), so the ranking has to be
// aggregated here.
//
// Scan universe is deliberately NOT the full 11k market: it's (chop universe UNION traded-overnight)
// with a $0.5B cap floor for stocks, ETFs exempt (an ETF's "market cap" is AUM, so the floor was
// wrongly excluding liquid leveraged ETFs). ~2,700 symbols.
//
// PRIOR CLOSES ARE CACHED. Yesterday's close is static, but this used to refetch all ~2,700 of them
// on every run — half the API calls and roughly half the ~20s runtime, spent re-fetching constants.
// They're now read from prev_rth_closes and only fetched when missing (i.e. the first run of a day).

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json" };

function J(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
}
function utcDate(d: Date): string { return d.toISOString().slice(0, 10); }

async function loadUniverse(): Promise<string[]> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/premarket_scan_universe`, {
    method: "POST", headers: sb, body: "{}",
  });
  if (!r.ok) return [];
  const j = await r.json();
  return Array.isArray(j) ? j.filter((x) => typeof x === "string") : [];
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

    const now = new Date();
    const target = typeof body.session_date === "string" ? body.session_date as string : utcDate(now);
    const pmStart = `${target}T08:00:00Z`;   // 4:00 AM ET
    const pmEnd = `${target}T13:29:59Z`;     // 9:29:59 AM ET

    const prevD = new Date(target + "T00:00:00Z");
    do { prevD.setUTCDate(prevD.getUTCDate() - 1); } while (prevD.getUTCDay() === 0 || prevD.getUTCDay() === 6);
    const prevStr = utcDate(prevD);

    const universe = await loadUniverse();
    if (universe.length === 0) return J({ error: "empty scan universe" }, 500);

    // ── Prior closes: read cache first ──
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

    const BATCH = Number(body.batch_size) > 0 ? Number(body.batch_size) : 200;

    // Only fetch closes for symbols the cache is missing — normally zero after the first run.
    const needClose = universe.filter((s) => prevClose[s] == null);
    let prevCalls = 0, prevFailed = 0, prevStored = 0;
    if (needClose.length > 0) {
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

    // ── Pre-market minute bars ──
    const agg: Record<string, { o: number; h: number; l: number; c: number; v: number; n: number; mins: number; pv: number; firstT: string; lastT: string }> = {};
    let calls = 0, failed = 0;
    let lastErr = "";

    for (let i = 0; i < universe.length; i += BATCH) {
      const chunk = universe.slice(i, i + BATCH);
      const syms = encodeURIComponent(chunk.join(","));
      let pageToken: string | null = null;
      let guard = 0;
      do {
        let url = `https://data.alpaca.markets/v2/stocks/bars?symbols=${syms}&timeframe=1Min` +
          `&start=${pmStart}&end=${pmEnd}&limit=10000&feed=sip`;
        if (pageToken) url += `&page_token=${encodeURIComponent(pageToken)}`;
        const r = await fetch(url, { headers: alp });
        calls++;
        if (!r.ok) {
          failed++;
          if (!lastErr) lastErr = `${r.status}: ${(await r.text()).slice(0, 160)}`;
          pageToken = null;
          break;
        }
        const j = await r.json();
        const bars = j?.bars || {};
        for (const s of Object.keys(bars)) {
          const arr = bars[s];
          if (!Array.isArray(arr)) continue;
          for (const b of arr) {
            const t = String(b?.t || "");
            if (!t) continue;
            const cur = agg[s];
            if (!cur) {
              agg[s] = { o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0, n: b.n || 0, mins: 1,
                         pv: (b.vw || b.c || 0) * (b.v || 0), firstT: t, lastT: t };
            } else {
              if (t < cur.firstT) { cur.firstT = t; cur.o = b.o; }
              if (t > cur.lastT) { cur.lastT = t; cur.c = b.c; }
              if (b.h > cur.h) cur.h = b.h;
              if (b.l < cur.l) cur.l = b.l;
              cur.v += (b.v || 0);
              cur.n += (b.n || 0);
              cur.mins += 1;
              cur.pv += (b.vw || b.c || 0) * (b.v || 0);
            }
          }
        }
        pageToken = j?.next_page_token || null;
      } while (pageToken && ++guard < 30);
    }

    const symbols = Object.keys(agg);
    if (symbols.length === 0) {
      return J({ ok: true, note: "no pre-market activity found", target, window: [pmStart, pmEnd], universe: universe.length, calls, failed, lastErr, ms: Date.now() - t0 });
    }

    const rows = symbols.map((s) => {
      const a = agg[s];
      const rec: Record<string, unknown> = {
        t: s, d: target, o: a.o, h: a.h, l: a.l, c: a.c,
        vw: a.v > 0 ? a.pv / a.v : a.c, v: a.v, n: a.n, mins: a.mins,
      };
      if (prevClose[s] != null) rec.pc = prevClose[s];
      return rec;
    });

    const nowUtcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
    const isPartial = utcDate(now) === target && nowUtcMin < 810;

    const rr = await fetch(`${SB_URL}/rest/v1/rpc/upsert_premarket_actives`, {
      method: "POST", headers: sb,
      body: JSON.stringify({ rows, target_date: target, partial: isPartial }),
    });
    if (!rr.ok) return J({ error: `rpc ${rr.status}`, body: (await rr.text()).slice(0, 300) }, 500);
    const written = await rr.json();

    return J({
      ok: true, target, prev_rth_day: prevStr, window: [pmStart, pmEnd],
      universe: universe.length, calls, failed, lastErr: lastErr || undefined,
      prev_from_cache: cachedCount, prev_fetched_calls: prevCalls, prev_failed: prevFailed, prev_stored: prevStored,
      symbols_with_activity: symbols.length, with_prev_close: rows.filter((r) => r.pc != null).length,
      written, is_partial: isPartial, ms: Date.now() - t0,
    });
  } catch (e) {
    return J({ error: String((e as Error)?.message || e), ms: Date.now() - t0 }, 500);
  }
});
