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

### 5.1a Structural checks do not catch behavioural bugs

**The build passing means nothing about whether a feature works.** Three bugs shipped in one
session with the identical signature — code present, build clean, route parity green, and the
failure producing a *plausible value* rather than an error:

| Version | What broke | Why it looked fine |
|---|---|---|
| v574 | ~305 tickers' pace values never reached the browser (PostgREST 1,000-row cap) | cells showed an em-dash, indistinguishable from the deliberate suppression rules |
| v581 | ON PACE header was sortable but values lived only in a side map | comparator reads `row[sortKey]`, found nothing, sorted by null |
| v584 | `useEffect` placed 30 lines *above* the `session` declaration | `var` hoists, its value does not → closed over `undefined` → fell through to the wrong default |

**The worst part:** after shipping v583 I ran a full "check everything" pass — fresh clone,
byte-for-byte build match, route parity 86/86, integrity 15/16 OK, cross-source verification
10/10 exact — and reported it all clean. The feature was already broken. Every check passed
because they verify **structure**, not **behaviour**.

**After any UI change, do this instead:**
1. **Trace one value end to end** — computation → fetch `select=` list → row mapping → render.
   Confirm the number that appears is the number expected. Field presence is not evidence.
2. **Check declaration order** for any `useEffect` reading a state variable — the effect must
   appear *after* the variable is assigned. Grep the line numbers.
3. **New sortable column?** Confirm the value is on the **row object**, not only a side lookup.
4. **Named `select=` list?** Confirm new columns were added to it — omitted fields return null
   silently.
5. **Simulate the logic in node with the failure inputs** (`undefined`, `null`, empty), not just
   the happy path.

### 5.1b The three truncation traps — all return HTTP 200

Hit all three in one session. Each produces plausible output with missing data.

| Source | Real cap | Can the client raise it? | How to detect |
|---|---|---|---|
| Alpaca bars | **~2,000 rows** (not the 10,000 `limit` accepts) | no — send fewer symbols | `next_page_token is null` |
| PostgREST **RPC** | **1,000 rows, hard** | **NO** — `?limit=`, `Range:` both ignored | `content-range` total vs delivered |
| PostgREST **REST read** | 1,000 rows | yes — explicit `&limit=N` | row count vs expectation |

The PostgREST **RPC** case is the nasty one: it is the documented 1,000-row rule in the
single form where the documented fix does not work. Verified directly — `?limit=10000`
returned 1000, `Range: 0-4999` returned 1000, and the server replied
`content-range: 0-999/1305`. **Fix inside the function**: filter to rows the caller can
actually use, return zero rows early when a global gate fails (rather than emitting 1,300
nulls), `order by` significance, `limit ~900` for headroom.

Alpaca practical limits at 5-min bars: **~30 tickers per request, ~20 for RTH**. A
60-ticker overnight request succeeds only because BOATS is a thin tape — never generalise
from the easiest case.

**Universal rule: after any bulk fetch, verify DELIVERED == EXPECTED before consuming.** A
count that merely looks reasonable is not evidence.

### 5.1c Prove the comparison before declaring a data fault

My first cross-source audit reported 10/10 mismatches on a healthy pipeline. Three traps:
- **BOATS date stamping** — the daily bar for a session *beginning* 8PM ET is stamped the
  NEXT calendar date at 00:00Z. Off-by-one session ⇒ everything mismatches.
- **Minute bars ≠ daily bars** — summing 1-min bars undercounts vs the daily aggregate
  (−19% observed) because minute bars exclude conditions the daily bar includes.
- **Daily bars don't exist mid-session** — endpoint returns `{"bars":{}}`.

Done right, expect small **positive** diffs: all 10 tickers within 0.1–0.7%, every diff
positive, because the stored snapshot is minutes older than the verification call. That is
latency, not error.

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

### 5.2a CONNECTION-POOL PROTOCOL — read this before invoking anything that writes

The free-plan pool is small. I have saturated it **three times in one session**, each by a
different mechanism but the same root cause: too many things holding connections at once.

| # | What I did | Result |
|---|---|---|
| 1 | `pg_sleep` in SQL waiting for async `pg_net` results | pool starved, DB refused connections |
| 2 | Fired **7 Edge Function calls in one statement** | 7 concurrent full-universe scanners, each bulk-upserting ~1,600 rows → even `select 1` timed out |

**The generalisation I keep getting wrong.** I had earlier fired 20 `net.http_get` chunks
concurrently with no trouble, and concluded "the pool handles 20 concurrent requests". Those were
*lightweight fetches to an external API with no database work at the far end*. An Edge Function
that **writes** is a completely different weight class. This is the same error shape as
generalising Alpaca's row cap from BOATS (a thin tape) to SIP — never infer a limit from the
cheapest case.

**Hard rules:**
- **Edge Functions / bulk writers: ONE AT A TIME.** Fire, wait for the return, verify, then the
  next. Never batch them in a single statement, never loop them.
- **Lightweight `net.http_get` chunks:** batches of ~15–20 are fine — but *only* when the target
  is an external API and nothing writes to Postgres.
- **Never hold a connection while not doing DB work.** No `pg_sleep`, no long transactions, no
  waiting on external I/O inside a statement. Wait client-side.
- **When the pool is saturated: STOP QUERYING.** Every probe is another connection and slows
  recovery. Back off in *minutes*, then test with a single `select 1`.
- **Escalation:** Supabase dashboard → Settings → General → **Restart project** (force-closes all
  connections).

**What is safe to tell the user:** session-table writes are idempotent upserts keyed on
`(session_date, ticker)`, so a killed scan leaves **no partial or corrupt rows** — whatever
completed is correct, whatever did not simply is not there.

**Check storage before blaming quota.** The Jul 22 outage *was* quota (a 436 MB backfill blew the
512 MB cap). These three were pure connection availability at ~45% storage. Different problem,
different fix.

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

**But SECURITY DEFINER *writers* must not be anon-executable.** This includes functions that
write only incidentally — `data_integrity_check(true)` inserts into `integrity_log`, so it was
locked to `service_role` too. The cron job still works because it runs as the job owner, not anon.
 Postgres grants EXECUTE
to PUBLIC by default on every new function, so a writer RPC is reachable with the anon
key — which ships in the client bundle and is public by design — unless it is explicitly
revoked. Found this on `upsert_overnight_actives` / `upsert_premarket_actives` /
`upsert_aftermarket_actives`: an anon POST returned HTTP 200, meaning anyone could
overwrite the session tables (and, since the forward-recompute change, rewrite every
later session's averages too). Fixed by revoking from `anon`, `authenticated` **and
`public`** — revoking from anon alone leaves the PUBLIC grant in place — then granting
to `service_role`, which is what the scanner Edge Functions authenticate with.
Verified after: writes 401, `shortlist_signal` and table reads still 200, and a
scheduled scan wrote successfully post-revoke. **When adding any writer RPC, revoke
from public/anon and grant only to service_role.**

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

**Alpaca's real response cap is ~2,000 rows, NOT the 10,000 the `limit` parameter implies.**
Evidence: a 5-min RTH request returned exactly 2000 bars across 26 tickers with a
`next_page_token`; an after-market request truncated at 58 tickers / 2,555 bars. Both were far
under the assumed 10,000. A 60-ticker overnight request succeeded only because BOATS is a thin
tape — do not generalise from it. Practical limits at 5-min bars: **~30 tickers per request, ~20
for RTH** (longest session). Always verify `next_page_token is null` — every one of these
truncations returned **HTTP 200**.

**Cross-source verification** (`verify_vs_alpaca_fetch` → wait → `verify_vs_alpaca_compare`) is
the only check that tests against Alpaca rather than internal consistency. Three traps, all hit
during the first audit run:
1. **BOATS date stamping** — the daily bar for the session beginning 8PM ET is stamped the NEXT
   calendar date at 00:00Z. Requesting `07-22T00:00Z..23:59Z` returns the bar for **session_date
   07-23**. Getting this wrong made a healthy pipeline show 10/10 mismatches.
2. **Minute bars ≠ daily bars.** Summing 1-min bars gives a systematically lower total than the
   daily aggregate (observed −19% on SNDK) because minute bars exclude trade conditions the daily
   bar includes. Compare like with like: overnight against `1Day`, pre/after-market against `1Min`
   (they are sub-windows of the SIP day, so no daily bar can isolate them).
3. **Daily bars do not exist for a session still in progress** — the endpoint returns
   `{"bars":{}}`. Daily-bar verification only works on **completed** sessions.
Verified result on completed data: all 10 tickers within **0.1–0.7%** of Alpaca, all differences
positive and consistent with our snapshot being ~3 min older than the API call — latency, not error.

**Two integrity-check lessons learned the hard way (Jul 23):**
1. **Coverage checks must exclude live partial sessions.** The check compared a session in
   progress against medians of *completed* ones — pre-market at 04:35 held 1,275 of an eventual
   ~2,100 rows and raised a 61% WARN that would have fired every single morning. Now gated on
   `is_partial` and reported as "session LIVE — still building, not judged". Re-verified the alarm
   still fires on a genuine shortfall (deleted down to 500 rows on a settled session → FAIL 20%).
2. **Temp tables do not survive between MCP calls.** Each call is its own session, so
   `create temp table _bk as select ...` in one call and `insert ... from _bk` in the next fails
   with "relation does not exist" — after the destructive step has already run. Use a permanent
   table for any cross-call backup, or better, re-derive from source. Recovered by re-running the
   scanner for that session date, which is the real lesson: **destructive tests need a restore
   path that does not depend on session state.**

**Median baselines: which source writes them.** The three `upsert_*_actives` scanners compute
mean *and* median in the same `SELECT` over the same `hist` CTE, so both see identical data —
table rows UNION the API payload. For **overnight** that payload carries ~27 sessions of BOATS
history, far more than the ~13 rows retained, so the scanner's median is the better-sourced one.

`rebuild_median_baselines(stype, date)` recomputes from **table rows only** and writes just the
four median columns (verified: it does not touch `avg_trades`, `avg_sessions` or `rel_trades`).
It is the *only* source for pre-market and after-market, whose tables have no API-side history —
so pg_cron jobs 42 and 43 must stay. **Job 41 (overnight) was removed**: it ran ten minutes after
the settle and replaced the scanner's ~27-session median with a ~13-row one. Impact was small
(median sat at 74.1% of mean before, 74.4% after) but it was strictly worse-sourced.

Note that historical `avg_sessions` values are *snapshots of what the API served on the day that
session was scanned* — 07-17 shows 11.4 while the live session shows 26.5. That is normal
accumulation, not corruption; do not "fix" it.

**Data integrity framework** (backend-only). `select * from data_integrity_check();` returns 13
checks across six classes, each targeting a failure that produces **no error** — anything that
already throws needs no check. Logged to `integrity_log` (non-OK rows only) by pg_cron job 38
hourly at :07; job 39 prunes the log at 30 days.

| Class | Catches | Threshold |
|---|---|---|
| Freshness | a scanner stopped writing mid-session | >12 min WARN, >20 FAIL (session-aware: silent when closed) |
| Coverage | a scan returned a fraction of its universe | <70% of median WARN, <50% FAIL |
| Arithmetic | a derived column stopped matching its inputs | any mismatch = FAIL |
| Baseline drift | write-time averages gone stale after out-of-order writes | any mismatch = FAIL |
| Pace curve | truncated/incomplete calibration source | via `pace_curve_health()` |
| Storage | the Jul 22 quota class | >70% WARN, >85% FAIL |

Coverage thresholds are calibrated, not guessed: observed day-over-day row variation is
+10.7%/−17.8%, so an alarm inside that band would fire constantly. **Both detectors were verified
by deliberately corrupting data** — a bad `pct_move` and a bad `avg_sessions` — confirming each
returned FAIL, then repaired and re-verified clean. An untested alarm is worthless.

**Pace-curve integrity guards.** `session_pace_curve` / `session_pace_ratio` (backend-only)
correct the partial-vs-full-session bias in `rel_trades`. Two verification functions exist because
**Alpaca does not error on truncation** — it returns HTTP 200 with fewer symbols and a
`next_page_token`, so checking `status_code` proves nothing:
- `pace_fetch_check(req_id)` — per-response verdict: status, ticker count, bar count, truncation.
- `pace_curve_health()` — curve-level: bucket count, thin buckets, monotonicity, and whether the
  curve actually reaches ~100% (a curve peaking short means incomplete source data).
`rebuild_pace_curve()` now **hard-refuses** to build if any response is truncated or non-200, and
aborts if a resulting curve peaks below 95%. It deletes only the session types being rebuilt, so a
partial recalibration cannot wipe the others. Verified by feeding it the real truncated response
(120 tickers × 96 five-min bars = 11,520 rows vs a 10,000 cap): it raised and the existing 96-row
curve survived intact. **5-min bars: 60 tickers max per request.**

**Weight-tuning dataset** (backend-only): `signal_chains` — one row per ticker-day with the
full four-session chain plus RTH outcomes (3,279 rows, 887 tickers, 6 days). Rebuild with
`select rebuild_signal_chains();`. Source RTH bars live in `signal_rth_bars` (38k rows, SIP
daily, trailing-20-**session** baselines, not calendar days). Test weight sets with
`test_weights3(am_trd, am_vol, ovn_trd, ovn_vol, pm_trd, pm_vol, gap, hit_rth, top_n, min_avg)`.
Combined ~6 MB.

Measured against **RTH trades ≥120% of trailing-20-session average** (base rate 12.2%):
standalone log-log correlations are pm_trd .306 > ovn_trd .274 > am_trd .248 > gap .203, with
am_vol weakest at .150. Cross-session correlations are low (.30–.35) so the legs are
independent, but *within* a session trades and volume are collinear (pm .857, ovn .752,
am .317) — after-market is the only place volume adds much. Best set found was
**PM 45 / OVN 30 / AM 25** (80% top-5, 70% top-10) versus 63%/60% for the AM+OVN-only weights
actually in production. Every one of the 6 days beat its own base rate. The exact split
matters little — variants cluster within a few points — what matters is including pre-market
and requiring corroboration across sessions. **Note the target choice dominates the headline
number**: the same model scores 65% at ≥120%, 50% at ≥150%, 33% at ≥200%. Also note this
optimises for *activity*, not range or tradability — `avg_range_pct` barely moves across
targets, so it is not what the ranking selects for.

**AI Predictor scoring weights** (`shortlist_signal` RPC, backend-only — not in the repo):
after-market 40 (28 trades + 12 volume), overnight 55 (38 trades + 17 volume), gap kicker 5.
Overnight intentionally outweighs after-market: measured standalone discrimination was
27% (AM hot / OVN quiet, n=11) vs 36% (AM quiet / OVN hot, n=14), with 70% when both
fire (n=10). The original split was the reverse (AM 55 / OVN 40) because after-market
has more usable sample — that conflated *measurement confidence* with *predictive
strength*. Each leg is scored on a log scale from a floor (AM 200%, OVN 100%) and
capped, so no single leg can carry the score alone. Sample sizes are small enough
(n=10–14) that the exact split is a judgment call; revisit once more sessions accumulate.

## 10. Known open items

### Raised in the Jul 23 audit — not yet done

- **Cross-source verification is not scheduled.** `verify_vs_alpaca_fetch` →
  `verify_vs_alpaca_compare` is the only check that tests against Alpaca rather than
  internal consistency, but it must be invoked by hand. It needs a *completed*
  session and an async wait, so it does not fit the `data_integrity_check` pattern.
  Best home: a daily job shortly after each settle run, writing to `integrity_log`.
- **Integrity results have no notification path.** They land in `integrity_log` and
  nothing surfaces them. Cheapest fix: show recent non-OK rows on the Settings page.
- **Pace curves rest on 1–2 sessions each.** Guarded and monotonic, but thin. Re-run
  `rebuild_pace_curve()` as sessions accumulate; after-market currently WARNs on a
  46.7-pt spread and its first hour is deliberately muted.
- **Pre-market pace curve NOW CALIBRATED** (was previously ruled out). The original
  refusal rested on a bad measurement: at hourly resolution on 10 tickers it looked like
  77% of pre-market activity landed in the final 30 minutes. Re-measured at 5-min
  resolution on 20 tickers, only ~12% falls after 9:00 — the earlier figure was an
  artifact of a tiny first bucket. Curve health OK: 66 buckets, monotonic, max spread
  29.6 pts (tighter than overnight's 30.5). Note pre-market starts at 25.17% complete at
  4:00 AM, so unlike overnight it clears the 15% floor immediately and projects from the
  first scan. **Lesson: when a measurement rules something out, re-check it at finer
  resolution before treating the conclusion as settled.**
- **AI Predictor tuning is in-sample.** Weights and the plain-sum form were fitted on
  the same 6 days they were measured on. `signal_chains` + `test_weights3` exist to
  re-run it properly once more sessions land.
- **Nothing predicts intraday range** (r .002–.068 across every feature). The model
  selects for *activity*. If it is meant to feed grid deployment, retargeting on
  range is the honest next step.

**Universe asymmetry between the session scanners — measured, and deliberately left alone.**
Overnight scans the full `market_universe_full` (~11,000 names); pre-market and after-market
share `premarket_scan_universe()` (~2,664 = chop screener ∪ last overnight session). So a name
quiet in the chop screener that also did not trade overnight is invisible to both, and nothing
measures how often that matters. Overnight surfaced 195 names on 2026-07-23 that pre-market
could not see, 14 of them with 500+ trades.

Checked whether after-market activity was being lost this way: across all 10 held sessions,
**zero** names with 500+ after-market trades were absent from the pre-market universe, and the
busiest ever excluded did 210 trades. But that result is partly circular — `aftermarket_actives`
is itself built from the same universe function, so a name outside it is never scanned
after-market either and cannot show up as a miss. The zeros prove nothing is *wrongly* excluded
among names we can see; they do not bound what we cannot see.

Fix if ever wanted: widen pre/after-market to the full universe, matching overnight. Cost is
~4x the API calls per scan, and pre-market runs every 3 minutes. **Reviewed Jul 23 2026 and
left as is** — do not re-investigate without a specific reason.

### Older, still open

- **Change B (queued):** High/Low Levels historical bars still `feed=iex`
  (~line 15571). IEX samples ~2.5% of volume so it can miss a session's true
  high/low — material for a *levels* tool. Changes computed values → verify on a
  familiar symbol before shipping.
- Options Chain spot price has a `feed=iex` fallback — **correct as-is**, it only
  fires after an unqualified (SIP) `/trades/latest` call.
- Most Actives has a dead **Market Movers** block (`movers` state is never set) —
  confirmed still present as of v573.
- Unused Algo Trader Plus entitlements: **WebSocket stream** (halts/LULD/imbalances
  — needs a persistent process, fights the stateless backend) and **OPRA options
  greeks** (would light up already-built-but-dark greeks/GEX UI).
- `get_app_client_keys()` / `set_app_client_key()` are anon-executable SECURITY
  DEFINER — confirm intended if they touch credentials.
- README pinned at v261.

*(Resolved since last edit: the stale "pre/after-market not wired up" comment was
fixed in v558; the stray `:` file is gone.)*

---

## 11. Working style

Senior developer. Terse, often voice-to-text on mobile. Expects **empirical
verification before claiming a fix works** — test it, show the number. Root-cause
analysis over symptom patches. Push back with reasoning rather than agreeing
reflexively; if something looks wrong, say so and show why.
