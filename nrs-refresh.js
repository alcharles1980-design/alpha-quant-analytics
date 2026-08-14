#!/usr/bin/env node
/**
 * Narrow Range Screener refresh.
 *
 *   node nrs-refresh.js --timeframe H     (30d hourly bars)
 *   node nrs-refresh.js --timeframe D     (400d daily bars)
 *
 * Incremental by design. The bars already live in nrs_bars_hourly / nrs_bars_daily, so this
 * pulls only the last few days and upserts on the primary key; nrs_purge (pg_cron job 52) ages
 * out the tail. Storage is therefore FLAT in steady state, not growing.
 *
 * Measured: hourly ~322 requests / 8.4 MB / ~2.6 min, daily ~62 / 0.8 MB / ~1.1 min.
 * A full re-fetch of the hourly window was 2,079 requests and ~19 minutes -- that is what the
 * bars store buys.
 *
 * TRAPS THIS GUARDS AGAINST
 *  - limit=10000 is NOT honoured. A 40-symbol hourly request returns ~2 symbols before handing
 *    back a page token. Every fetch follows next_page_token to exhaustion; a batch that hits the
 *    page budget is reported, never silently treated as complete.
 *  - Back-to-back requests draw transient 503s (not size-related: batches of 5/10/20/40 all
 *    return 200 when paced). Hence the 350ms pacing and exponential backoff.
 *  - A failed batch is recorded and the run continues. Losing one batch must not discard the
 *    rest, and must not be mistaken for "these tickers have no data".
 */
const TF = (process.argv[process.argv.indexOf('--timeframe') + 1] || 'H').toUpperCase();
const IS_D = TF === 'D';
const TABLE = IS_D ? 'nrs_bars_daily' : 'nrs_bars_hourly';
const TIMEFRAME = IS_D ? '1Day' : '1Hour';
const LOOKBACK_DAYS = Number(process.env.NRS_LOOKBACK_DAYS || 5); // small overlap re-upserts safely
const BATCH = 40;
const PACE_MS = 350;

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
// Alpaca credentials come from app_config, NOT from GitHub secrets. That is the established
// pattern for every other job in this system -- the Edge Functions, the overnight level scanner
// and the BOATS jobs all read alpaca_key / alpaca_secret from the database at runtime.
// SUPABASE_URL / SUPABASE_KEY are the bootstrap boundary: they are needed to REACH the database,
// so they must be env. Everything else should come FROM the database, so there is one place to
// rotate a key rather than two that can drift apart.
let AK = null, AS = null;
for (const [k, v] of Object.entries({ SUPABASE_URL: SB_URL, SUPABASE_KEY: SB_KEY }))
  if (!v) { console.error(`missing env ${k}`); process.exit(1); }

async function loadAlpacaCreds() {
  // Via the get_app_client_keys RPC, NOT a direct table read: app_config has RLS enabled and the
  // anon key is denied (42501). That denial is correct -- these are live trading credentials --
  // and this security-definer RPC is the sanctioned way through, the same one the app itself uses.
  const rows = await sb('rpc/get_app_client_keys', { method: 'POST', body: '{}' });
  for (const r of rows || []) {
    if (r.key === 'alpaca_key') AK = r.value;
    if (r.key === 'alpaca_secret') AS = r.value;
  }
  if (!AK || !AS) throw new Error('alpaca_key / alpaca_secret not returned by get_app_client_keys');
  console.log('alpaca credentials loaded from app_config via get_app_client_keys');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sb(path, opts = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`supabase ${path} -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  // POST/DELETE return 201/204 with an EMPTY body unless Prefer: return=representation.
  // Calling .json() on that throws "Unexpected end of JSON input" and looks like a network fault.
  const body = await r.text();
  return body ? JSON.parse(body) : null;
}

async function alpaca(url) {
  for (let a = 0; a < 6; a++) {
    await sleep(PACE_MS);
    const r = await fetch(url, { headers: { 'APCA-API-KEY-ID': AK, 'APCA-API-SECRET-KEY': AS } });
    if (r.ok) return r.json();
    if (a === 5) throw new Error(`alpaca ${r.status}`);
    await sleep(Math.min(30000, 3000 * (a + 1) ** 2));
  }
}

const etHour = ts => new Date(new Date(ts).getTime() - 4 * 3600e3).getUTCHours();

async function fetchBars(syms, start, end) {
  let token = null, pages = 0;
  const out = {};
  for (;;) {
    const q = new URLSearchParams({ symbols: syms.join(','), timeframe: TIMEFRAME, start, end, limit: '10000', feed: 'sip', adjustment: 'raw' });
    if (token) q.set('page_token', token);
    const d = await alpaca(`https://data.alpaca.markets/v2/stocks/bars?${q}`);
    for (const [s, bl] of Object.entries(d.bars || {})) (out[s] ||= []).push(...bl);
    token = d.next_page_token; pages++;
    if (!token) return { out, complete: true };
    if (pages >= 60) return { out, complete: false };   // budget hit -> NOT complete
  }
}

(async () => {
  const t0 = Date.now();
  await loadAlpacaCreds();
  // Anchor on the LATEST scan_date, never on "today": the runner's clock and the last successful
  // universe scan routinely differ by a day, and eq.<today> then matches nothing.
  const latest = await sb('cached_oscillation_screener?select=scan_date&order=scan_date.desc&limit=1');
  const uniDate = latest?.[0]?.scan_date;
  if (!uniDate) throw new Error('no universe scan_date found');

  // PAGINATE. PostgREST silently caps every response at 1,000 rows and no query parameter lifts
  // it. An earlier version of this read the fallback table with limit=5000, got 1,000 rows, and
  // deduped to a 512-ticker "universe" -- and because the completeness guard below compares
  // against tickers.length, a truncated universe would have made a truncated run look COMPLETE.
  let tickers = [];
  for (let from = 0; ; from += 1000) {
    const page = await sb(`cached_oscillation_screener?select=ticker&scan_date=eq.${uniDate}&order=ticker.asc`,
      { headers: { 'Range-Unit': 'items', Range: `${from}-${from + 999}` } });
    if (!page?.length) break;
    tickers.push(...page.map(r => r.ticker));
    if (page.length < 1000) break;
  }
  tickers = [...new Set(tickers)];
  if (tickers.length < 1000) throw new Error(`universe only ${tickers.length} tickers from ${uniDate} -- refusing to run, this is the truncation signature`);
  console.log(`universe anchored on scan_date ${uniDate}`);
  console.log(`TF=${TF} ${TIMEFRAME}  universe=${tickers.length}  lookback=${LOOKBACK_DAYS}d`);

  const end = new Date(), start = new Date(Date.now() - LOOKBACK_DAYS * 864e5);
  const si = start.toISOString().replace(/\.\d+/, ''), ei = end.toISOString().replace(/\.\d+/, '');

  // RESUME: skip tickers whose bars are already current. Without this the loop always restarts
  // at i=0, re-fetches the same leading tickers, and if the process is cut short it can NEVER
  // reach the tail -- which is exactly how 1,565 of 2,411 tickers ended up stuck on 2026-07-31
  // hourly bars while the first ~1,000 were current. Each run now advances instead of repeating.
  let skipped = 0;
  if (process.env.NRS_RESUME !== '0') {
    // Via an RPC that groups max(ts) per ticker. A bare `ts >= cutoff` table read cannot use the
    // (ticker, ts) primary key -- ts is not the leading column -- so it seq-scans 300k+ rows and
    // times out. The grouped form uses the index and returns ~2,400 rows instead of ~100,000.
    const cutoff = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
    const rows = await sb('rpc/nrs_fresh_tickers', { method: 'POST',
      body: JSON.stringify({ p_timeframe: TF, p_since: cutoff }) });
    const fresh = new Set((rows || []).map(r => r.ticker));
    const before = tickers.length;
    tickers = tickers.filter(t => !fresh.has(t));
    skipped = before - tickers.length;
    console.log(`resume: ${skipped} tickers already current, ${tickers.length} to fetch`);
  }

  let fetched = 0, written = 0, failed = [], truncated = [];
  for (let i = 0; i < tickers.length; i += BATCH) {
    const chunk = tickers.slice(i, i + BATCH);
    let res;
    try { res = await fetchBars(chunk, si, ei); }
    catch (e) { console.log(`  batch failed (${e.message}) at ${chunk[0]}`); failed.push(...chunk); continue; }
    if (!res.complete) truncated.push(...chunk);

    const rows = [];
    for (const [s, bl] of Object.entries(res.out)) for (const b of bl) {
      if (IS_D) rows.push({ ticker: s, d: b.t.slice(0, 10), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
      else if (etHour(b.t) >= 9 && etHour(b.t) <= 15) rows.push({ ticker: s, ts: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    }
    fetched += rows.length;
    // 500-row writes, not 2,000. A 40-symbol hourly batch over a 16-day window is ~4,500 bars,
    // and 2,000-row upserts returned 504 upstream request timeout from the gateway. Smaller
    // writes cost a few more round trips and complete reliably.
    const WRITE = 500;
    for (let j = 0; j < rows.length; j += WRITE) {
      await sb(TABLE, { method: 'POST', body: JSON.stringify(rows.slice(j, j + WRITE)), headers: { Prefer: 'resolution=merge-duplicates' } });
      written += Math.min(WRITE, rows.length - j);
    }
  }
  console.log(`bars: fetched ${fetched}, written ${written}, failed batches ${failed.length}, truncated ${truncated.length}`);
  if (truncated.length) console.log(`*** TRUNCATED (page budget hit): ${truncated.slice(0, 10).join(',')}`);

  // Recompute + write the scan ENTIRELY SERVER-SIDE. The rows never cross the wire, which
  // sidesteps both the PostgREST 1,000-row cap and the statement timeout that shipping 2,410
  // rows out and back in triggered.
  const res = await sb('rpc/nrs_refresh_scan', { method: 'POST', body: JSON.stringify({ p_timeframe: TF }) });
  const scanRows = res?.[0]?.rows_written ?? 0;
  console.log(`scan: ${scanRows} rows written, ${res?.[0]?.enriched ?? 0} enriched`);

  const purge = await sb('rpc/nrs_purge', { method: 'POST', body: '{}' }).catch(() => null);
  if (purge) console.log('purge:', JSON.stringify(purge));

  // A refresh that writes far fewer rows than the universe is a fault, not a quiet Tuesday.
  // A refresh that computes far fewer tickers than the universe is a fault, not a quiet Tuesday.
  if (scanRows < (tickers.length + skipped) * 0.8)
    { console.error(`FAIL: only ${scanRows} of ${tickers.length} tickers computed`); process.exit(1); }
  if (failed.length || truncated.length) { console.error('FAIL: incomplete fetch'); process.exit(1); }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
