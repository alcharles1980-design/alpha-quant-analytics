# Alpha Quant Analytics — Developer Handoff

**Purpose:** cold-start context for a new Claude chat. Read this first, then run the
verification block below before writing any code.

**Status at last update:** v555 · Jul 22 2026

> **This file goes stale. That is expected.** Version numbers, table lists and
> feature descriptions drift within days. Treat every specific number here as a
> *hint*, and the **Verify First** block as the source of truth. The previous
> handoff sat at v261 while the app reached v554 — 290 versions of drift — because
> it asserted facts instead of teaching verification. Don't repeat that.

---

## 1. Verify First (run before touching anything)

```bash
# Repo + true current version (build.js picks the HIGHEST app_vN.jsx)
cd <repo> && ls app_v*.jsx | sort -V | tail -1 && git log --oneline -10
```

```sql
-- Supabase project haeqzegdlwryvaecanrn ("oscillation-analytics")
select pg_size_pretty(pg_database_size(current_database())) as db_size,
       round(100.0*pg_database_size(current_database())/(512*1024*1024),1) as pct_of_cap;
select jobid, schedule, active, jobname from cron.job order by jobid;
```

Also: `list_edge_functions`, and check the menu/route parity (§6) if the change
touches navigation. **The DB is on the FREE plan — 512 MB hard cap. See §8.**

> **Two hard prohibitions, both learned by taking the database down:**
> 1. **Never `pg_sleep` inside a query to wait for async results** (§5.2b) — it holds
>    a pooler connection and starves the small free-plan pool. Poll in a separate
>    call; wait client-side.
> 2. **Never run a bulk write without estimating its size first** (§5.2) — a 436 MB
>    backfill blew the quota and Supabase refused connections.

---

## 2. What this app is

Single-file React 18 quant-analysis platform for oscillation/grid trading research.
Measures how price oscillates so grid configs can be chosen empirically rather than
guessed. Sister project: **mbot** (live grid bot on Alpaca, separate repo/Supabase).

- **Repo:** `github.com/alcharles1980-design/alpha-quant-analytics` — **PRIVATE**
- **Live:** `https://alpha-quant-analytics.alcharles1980.workers.dev/`
- **Scale:** ~34,100 lines / 2.9 MB in one `app_vN.jsx`; 85 nav pages + 2 hidden
  sub-pages (`cheatsheet`, `glanceapi`), 13 stage sections

---

## 3. Stack & deploy

React 18 (no build framework, no JSX runtime — Babel pre-compile) · Supabase
(Postgres + Edge Functions + pg_cron + pg_net) · Cloudflare Workers · GitHub Actions
· Polygon.io · Alpaca (**Algo Trader Plus** — full SIP + OPRA) · SEC EDGAR · TipRanks.

**Deploy = `git push origin main`.** Actions runs `build.js` (highest `app_vN.jsx` →
Babel → HTML shell → `dist/index.html`, with a `new Function` syntax check that fails
the build on error) then `wrangler deploy` for the app + 4 proxy workers:
`tipranks-proxy`, `api-worker`, `alpaca-proxy`, `edgar-proxy`.

**Working method in a Claude session:** clone into the sandbox, edit, build, commit,
push (`git remote set-url origin https://<PAT>@github.com/...`). Actions deploys.
Backend changes go through the **Supabase MCP**, not bash. The container starts with
**no git identity** — set `user.email`/`user.name` or the commit silently no-ops.
Ask for a **fresh short-lived PAT** and tell the user to revoke it after the session.

---

## 4. Version bump ("full sweep") — MANDATORY, never skip

1. `cp app_vN.jsx app_vN+1.jsx` and **delete the old file**
2. **`build.js` hardcodes the version in the `BUILD_TS` banner — bump it too.**
   Miss this and the app deploys as N+1 but *displays* N.
3. `package.json` version
4. `npm install` if `node_modules` is absent (not committed), then `npm run build`
5. Verify routes match menu items (§6); check for duplicate Supabase methods
6. Push with a commit message explaining *why*, not just what

---

## 5. Learnings, mistakes and recurring failure modes

Every entry below cost real debugging time or broke production. They are grouped by
failure *class*, because the specific bug recurs in new forms but the class stays the
same. **The unifying theme: almost every serious bug here was SILENT** — no error, no
exception, correct-looking UI, wrong data underneath. Assume silence is the danger.

### 5.1 Silent data truncation (the #1 recurring class)

- **PostgREST 1,000-row cap.** Default limit is 1,000 and it does *not* error — it
  just returns the first 1,000. `optimal_tp_hourly` had 38,400 rows for one ticker;
  a naive fetch got 1,000, so Correlation Finder ran on **10 data points instead of
  379** and reported correlations of ±1.000 (meaningless at n=10). Fix: explicit
  `&limit=`, and paginate.
- **Batch size must be ≤ 1000 when paginating.** Requesting `limit=10000` silently
  returns 1,000; the loop then sees `1000 < 10000`, concludes "last partial page",
  and stops. You lose everything past row 1,000 *while believing you paginated*.
- **Polygon `next_url` silently drops pre-market trades** on later pages of a
  full-day fetch. Fix: 3 overlapping windows (2–3h overlap), concat, sort by ts,
  dedup on exact nanosecond. Never trust a single-window fetch.
- **Generic API truncation.** Follow `next_page_token`, set `limit=` high enough,
  verify `end=` behaviour client-side. v486 had hourly charts cut off from exactly
  this (`limit=5000` truncation).

### 5.2 Resource limits — think BEFORE building (Jul 22 2026: took the DB down)

A `daily_returns` backfill (3.08M rows, 14,454 tickers × 261 days) grew to **436 MB
= 65% of the 512 MB free-plan cap**, blew the quota, grace period expired, and
**Supabase refused connections**. The app hung on "Waiting for Alpaca API keys…"
because it loads `app_config` at startup. Everything had to be truncated and the
feature dropped entirely.

- **Estimate first, out loud.** rows × bytes/row × 1.5–2 (indexes), checked against
  `pg_database_size()`. State the estimate to the user *before* running it.
- **Sample, measure, extrapolate.** 5–10 days first. Never go straight to a
  full-universe multi-year load.
- **Scope down by default** — restrict universe, shorten window, store only needed
  columns.
- **Watch pace, not just size.** Repeated 12k-row test batches and 40s queries
  against a 3M-row table caused 69–270s checkpoints, a deadlock, and connection-pool
  exhaustion. Don't hammer prod; test against small samples.
- **`TRUNCATE` over `DELETE`** — DELETE leaves dead tuples needing VACUUM FULL,
  which needs *more* temp space exactly when you have none.
- **`net._http_response` accumulates silently** (hit 72 MB) — prune periodically.
- **Generalise:** before ANY task think through storage quotas, API rate limits,
  Actions minutes, Edge Function timeouts (150s), CF Worker limits (300s CPU /
  128 MB), statement timeouts (anon = 3s via PostgREST) — and raise them with the
  user *before* building.

### 5.2b NEVER use `pg_sleep` to wait for async results — took the DB down Jul 23 2026

**The mistake:** `net.http_get`/`net.http_post` are asynchronous — results land in
`net._http_response` later. The obvious-looking way to wait is `select pg_sleep(30);
select ... from net._http_response`. **Do not do this.** `pg_sleep` holds a pooler
connection open doing nothing for its whole duration.

Over one session I ran sleeps of 45s, 40s, 35s, 30s, 25s, 20s, plus six 12s sleeps
inside a `DO` block. On the free plan the connection pool is small and pg_cron jobs
keep firing on schedule (job 24 every 10 min, plus 18/20/21/26). Stacking held
connections against that starved the pool: `canceling statement due to statement
timeout` errors, checkpoints ballooning to 211s and 235s (normal is ~13-20s), then
the database refused connections entirely — MCP queries, *and* scheduled cron work
stopped appearing in the logs.

**Correct pattern:** fire the request, END the statement, then poll in a SEPARATE
call later. Each call is short and returns the connection immediately:
```sql
-- call 1
select net.http_get(url:='...') as req_id;
-- call 2, issued later as its own statement
select status_code, content from net._http_response where id = <req_id>;
```
If real elapsed time is needed between calls, wait OUTSIDE the database (in the
agent/client), never inside a SQL statement.

**Note this is not a storage problem** and has no billing/grace-period component —
unlike the Jul 22 quota incident. DB was at 180 MB / 35% of cap throughout. It is
purely connection availability. Idle connections time out and the pooler recovers on
its own; if it does not, restart the project from the Supabase dashboard
(Settings → General → Restart project), which force-closes every connection.

**Diagnosis note:** my first explanation was wrong — I blamed six concurrent
full-universe scans. The logs disproved it: those six `net.http_post` calls never
dispatched at all (pg_net was already backed up), and the last real outbound request
was a cron job 20 minutes earlier. Read the logs before naming a cause. Also: each
`get_logs` call is itself a connection, so stop probing a saturated pool — every
check makes it marginally worse.

**Generalise:** anything that holds a DB connection while not doing DB work is a
liability on a small pool — `pg_sleep`, long transactions, waiting on external I/O
inside a statement. Do the waiting in the client.

### 5.3 Timezone / DST

- **Never use manual UTC offsets.** Hardcoded UTC-4 assigned trades to the wrong
  hour for months, silently, and corrupted everything downstream. Always
  `Intl.DateTimeFormat` with `America/New_York`.
- **UTC fetch windows must be EST/EDT-aware.** `T13:00Z` is 9 AM EDT but 8 AM EST —
  the 4 AM ET hour vanished entirely during EST months.
- **Test with both EST and EDT dates** (e.g. January *and* June). Summer-only tests
  never catch DST bugs.
- **Centralise timezone logic.** The fix had to be applied in 12 separate
  locations because the offset math was scattered.
- Anchor "Today"/"Yesterday" to the ET *trading* day, not local/UTC midnight (v482).

### 5.4 Silent write failures

- **Supabase writes can fail silently under rapid sequential load.** 11 of 22 days
  saved; days 12–22 vanished. The UI showed all 22 (computed in memory). Fix:
  inter-day delays + **read back after writing** (`verifySaveIntegrity`).
- **PostgREST PATCH returns 200 OK and does nothing** on wide tables (VIX backfill
  wrote NULLs). Use **DELETE + POST**, never PATCH.
- **PostgREST server-side filters are unreliable** for integrity checks — returned
  empty when matching rows existed. Fetch and filter in JS.

### 5.5 JavaScript footguns

- **`var` is function-scoped — single-letter names shadow props.** `var p` inside an
  entropy loop overwrote the component's `p` (props) for the *entire function*.
  Day 1 worked; day 2+ failed because `p.apiKey` was now a number. **Never use
  `p, r, h, d, e, s` inside components** — use `ep`, `r2`, `hh`. v401 was a hotfix
  for exactly this class (`s10d` reused).
- **NaN breaks `Array.sort()` entirely.** A NaN comparator return puts sort into
  undefined behaviour — *nothing* reorders. Guard every comparator; Pearson on a
  constant feature gives 0/0.
- **PostgREST serialises `numeric` as STRINGS** (ints as numbers). Without `Number()`
  coercion, `"9" > "100"` and bar scaling breaks (v539).

### 5.6 Ordering and scoping bugs

- **Filter *then* cap, not cap then filter.** Most Actives fetched Top-100
  server-side then filtered client-side → ~47 visible rows while ~480 qualifying
  names sat below the cutoff, permanently invisible (v540).
- **Feed matching: numerator and denominator must share a tape.** IEX current volume
  ÷ SIP 20-day average inflated RVOL **~30x** (v530). v555 made Most Actives SIP
  end-to-end so the mismatch is now structurally impossible.
- **Stale state on selection change** — clear derived state when the ticker/list
  changes or you render the previous symbol's data (v423, v511).
- **Parity audits find real bugs.** When a feature is extended to a new mode
  (overnight → pre-market), audit *every* branch: v552 found four places where
  overnight-only logic silently missed pre-market.

### 5.7 Server limits → always have a browser fallback

CF Workers: 300s CPU / 128 MB. Supabase Edge Functions: 150s. Heavy stocks (SOXL
254K+ ticks) exceed both, returning 546/500/502/504. **Every server-side computation
needs a browser Web Worker fallback**; browsers have no CPU cap and GBs of memory.
Set a `serverFailed` flag so subsequent days skip the doomed server attempt.

### 5.8 Process lessons

- **Derived data computed at write time goes stale when writes arrive out of order.**
  The session-actives RPCs computed `avg_trades`/`avg_volume`/`rel_*` from
  `session_date < target_date` at insert time. Correct only if no *later* session
  already exists — so any backfill, settle re-run, or async dispatch completing out
  of sequence left every following session frozen against a baseline that excluded
  the new one. Silent: columns populated, just wrong, with only `avg_sessions`
  betraying it. Hit twice in one session (after-market and pre-market backfills).
  **Fixed** by a forward recompute inside `upsert_premarket_actives` /
  `upsert_aftermarket_actives`: after writing, rebuild `avg_*`/`rel_*` for sessions
  strictly *after* `target_date`. Guarded by an `exists` check so the live path
  (always writing the newest session) matches nothing and costs ~0.5ms; the ~150ms
  recompute is paid only during a backfill. Generalise: **any cached aggregate over
  "everything before me" needs a plan for late-arriving earlier rows.**
- **`net.http_post` is asynchronous** — firing a loop of them does NOT execute in
  order. Sessions landed scrambled during backfill. Don't rely on dispatch order for
  correctness; make the target self-correcting. And do NOT space them with
  `pg_sleep` — see §5.2b, that starves the connection pool. Space them from the
  client, or fire them and let the forward-recompute fix the ordering.
- **Build integrity checks BEFORE features.** The DST bug corrupted months of data
  silently; an hourly coverage check would have caught it on the first import.
  Post-fetch (`verifyFetchIntegrity`) and post-save (`verifySaveIntegrity`) checks
  exist because silent corruption is catastrophic for everything downstream.
- **Test APIs before claiming success.** Use `pg_net` (`net.http_get` → read
  `net._http_response`). Measure and show the number.
- **Never skip the version bump**, and remember `build.js` hardcodes the banner —
  miss it and you ship N+1 displaying N.
- **The container has no git identity.** Commits silently no-op; a following `push`
  reports success having sent nothing. Set `user.email`/`user.name` first, then
  verify HEAD moved.
- **Docs that assert facts go stale.** This file's predecessor sat at v261 while the
  app hit v554. Docs must teach verification (§1), and §9/§10 must be updated as
  part of the change, never afterwards.
- **Rate limits:** 200ms between Polygon fetch windows, 500ms between days.
- **Log progress on long operations** so "still loading" is distinguishable from
  "stuck".

### 5.9 Platform quirks worth memorising

- **Alpaca:** SIP 403s on *today's* data via **historical** REST → bound `end=` to
  yesterday. **Snapshots are live and exempt** (this is what let v555 move snapshots
  to SIP). Trade `.c` conditions can be a string → always `Array.isArray` guard.
  Options `/v1beta1/options/trades` requires `start=`, no `end=`, no `feed=`.
  Exchange codes are letters. IEX ≈ 2.5% of volume, stops printing when its book is
  quiet (observed ~4h stale), and can return `ap:0`.
- **SEC EDGAR** 429s aggressively → use the `edgar-proxy` Worker; User-Agent must be
  `Company email` format.
- **CORS preflight**: custom headers trigger it — use query params instead (v500).
- **GitHub Actions:** `checkout@v6`, `setup-node@v6`, Node 24. `node_modules` isn't
  committed — `npm install` before building in a fresh clone.
- **GitHub's scheduled cron is unreliable** in peak UTC windows → dispatch from
  Supabase pg_cron via `workflow_dispatch` instead.


---

## 6. Route/menu parity check

`menuItems` (near the bottom of the JSX) is authoritative. Every non-header,
non-divider key needs a matching `page==='key'` branch. Expected: **85 nav items,
85 matched routes, + 2 intentional orphans** (`cheatsheet`, `glanceapi`).

```bash
grep -o "page===\?'[^']*'" app_vN.jsx | sort -u   # then diff against menuItems keys
```

---

## 7. Core cycle engine — CRITICAL

Level-based position cycling, **not** a grid bot. One level per $0.01. Typed arrays
(`Uint8Array`/`Float64Array`/`Int32Array`).

- Pre-seed: first tick = opening price (observe only). Levels from open to ~open+1%
  start ACTIVE; all others INACTIVE.
- Per tick, **strict order — SELL first (all levels), then BUY (one level)**.
  Reversing it double-counts a cycle and re-buys on the same tick.
- BUY: `level <= tick < level+0.01`. Sub-penny compared directly — $5.6799 does NOT
  buy $5.68. SELL: `tick >= target`.
- Target: `Math.ceil(level*(1+TP%/100)*100)/100` — always ceil to a tradeable penny.

**This logic must stay identical across all 8 locations:** `analyzePriceLevels()`,
`computeHourlyCycles()`, TradeAudit, CSV export, UploadPage audit, Edge Function
`batch-analyze`, CF Worker `hourly-tp-scanner`, browser Web Worker. Change one →
change all eight.

---

## 8. Backend shape (verify, don't trust)

**Supabase `haeqzegdlwryvaecanrn`** — ~193 MB / 38% of cap; ~60 tables; ~35 pg_cron
jobs (4 session-actives scanners, chop scan + price refresh, regime-classify, IV
logger, staggered 3:30–3:41 AM cleanups, Sunday 4 AM vacuums, `db_size_guard` every
6h); ~18 Edge Functions (`batch-analyze`, `chop-price-refresh`, `regime-classify`,
`iv-logger`, `overnight-/premarket-/aftermarket-actives`, `tipranks-sync` + probes).

Convention: `cached_*` tables have **RLS off**, anon-key readable, `SECURITY DEFINER`
RPCs. Advisors will flag ~55 `rls_disabled_in_public` — that is the intended design,
not a bug to "fix".

Several tables show 0 rows but hold disk (dead-tuple bloat, ~40 MB reclaimable via
`VACUUM FULL`). Full Stage 1–4 pipeline tables are empty (only ever NVDA/ONON).

**Session scanner cadences** (all ET; the AI Predictor tab polls every 90s on top):
- overnight `*/5 0-8 UTC` = every 5 min, 8 PM–4 AM · settle 4:05 AM
- pre-market `*/3 8-13 UTC` = every 3 min, 4–10 AM weekdays · settle 9:35 AM
- after-market `*/3 20-23 UTC` = every 3 min, 4–8 PM weekdays · settle 8:05 PM

Overnight was every 10 min with a 4:30 AM settle until v559-era tuning. The settle
moved to 4:05 AM to close a 30-minute window where the overnight leg had stopped
updating at 3:59 but was still flagged `is_partial` while pre-market had already
begun — so the AI Predictor showed a stale, uncommitted overnight leg at ~4:15 AM.
The settle must stay within the same UTC date as the session stamp (its body uses
`(now() at time zone 'UTC')::date`) and at/after 08:00 UTC so the function's
`hUtc < 8` partial test evaluates false and clears the flag.

**Pipeline modes** (`pipeline.js`, via Actions `workflow_dispatch` from Settings
using a PAT in `app_config`): `nightly`, `hourly`, `backfill`, `autotune`,
`screener`, `backfill-mcap`, `mfe`, `regime`.

---

## 9. Recent work

**v555 (current)** — Most Actives RTH/My Lists snapshots IEX → SIP; removed the
`avgFeed` conditional (SIP end-to-end, mismatch now impossible). Verified live:
NVDA SIP 138.7M shares / 2.36M trades vs IEX 5.8M / 57k (24x / 41x), and IEX's
`latestTrade` was ~4h stale in extended hours with `ap:0` quotes observed.

**v529–v554** — Most Actives four-session rebuild. RVOL feed-match fix (v530);
full-universe BOATS overnight scanner replacing RTH-screener filtering; pre-market
scanner (SIP minute bars 4:00–9:30 ET); after-market scanner (v554) completing all
four sessions; GAP %/MOVE %/AVERAGE TRADES/etc. as two-line headers with tooltips;
filter-after-limit fix (Top 100 now means 100 rows that *pass* filters, was ~47);
enrichment 85 → 2 round trips (8–10s → ~2s); shared `prev_rth_closes` cache
(overnight 108s → 24s); `db_size_guard` on pg_cron; repo made private.

**Rolled back** — correlation tool / Uncorrelated Stock Finder (Stage 11) and
`daily_returns`, removed entirely after the storage incident. `corr-price-refresh`
Edge Function survives as an orphan.

---

## 10. Known open items

- **Change B (queued):** High/Low Levels historical bars still `feed=iex`
  (~line 15571). IEX samples ~2.5% of volume so it can miss a session's true
  high/low — material for a *levels* tool. Changes computed values → verify on a
  familiar symbol before shipping.
- Options Chain spot price has a `feed=iex` fallback — **correct as-is**, it only
  fires after an unqualified (SIP) `/trades/latest` call.
- Most Actives has a dead **Market Movers** block (`movers` state is never set).
- Stale comment ~line 13193 claims pre/after-market "not wired up yet" — they are.
- Unused Algo Trader Plus entitlements: **WebSocket stream** (halts/LULD/imbalances
  — needs a persistent process, fights the stateless backend) and **OPRA options
  greeks** (would light up already-built-but-dark greeks/GEX UI).
- `get_app_client_keys()` / `set_app_client_key()` are anon-executable SECURITY
  DEFINER — confirm intended if they touch credentials.
- Stray empty file named `:` in repo root; README pinned at v261.

---

## 11. Working style

Senior developer. Terse, often voice-to-text on mobile. Expects **empirical
verification before claiming a fix works** — test it, show the number. Root-cause
analysis over symptom patches. Push back with reasoning rather than agreeing
reflexively; if something looks wrong, say so and show why.
