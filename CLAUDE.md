# Alpha Quant Analytics — Developer Handoff

**Purpose:** cold-start context for a new Claude chat. Read this first, then run the
verification block below before writing any code.

**Status at last update:** v635 · Jul 26 2026

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

> **Three hard prohibitions, all learned by taking the database down:**
> 1. **Never `pg_sleep` inside a query to wait for async results** (§5.2b) — it holds
>    a pooler connection and starves the small free-plan pool. Poll in a separate
>    call; wait client-side.
> 2. **Never run a bulk write without estimating its size first** (§5.2) — a 436 MB
>    backfill blew the quota and Supabase refused connections.
> 3. **Never fire Edge Functions / bulk writers concurrently** (§5.2a) — one at a
>    time, wait for each to return, verify, then the next. Firing several in one
>    statement, or looping them, saturates the pool (each is a heavy writer). Do NOT
>    generalise a safe concurrency limit from lightweight external-API fetches.

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

### 5.1d A column in ON CONFLICT but missing from the INSERT list writes NULL — silently (Jul 24 2026)

**`excluded.<col>` resolves to NULL for any column not named in the INSERT column list.** An
upsert that computes a value, references it in `on conflict ... do update set col=excluded.col`,
but forgets to list `col` in the `insert into tbl (...)` header, writes NULL on **both** the
insert path *and* the update path. No error. The column just stays blank.

Found in the Most Actives session upserts. `upsert_premarket_actives` and
`upsert_aftermarket_actives` each computed `med_trades`/`med_volume` in their `_avg` CTE and
referenced `excluded.med_trades` in ON CONFLICT — but the four median columns (`med_trades`,
`med_volume`, `rel_trades_med`, `rel_volume_med`) were never in the INSERT list, so all four
wrote NULL and the two `rel_*_med` ratios were never computed at all. `upsert_overnight_actives`
had them wired correctly and was the reference. **2 of 3 had the bug.** In the UI the MED TRADES /
MED VOL / median-relative columns rendered blank.

**Why it hid for weeks:** a one-off backfill on Jul 23 populated the historical rows via a
different code path, so every day *looked* fine — only the current day (written solely by the
live scan) was blank, which reads as "today's data hasn't settled yet" rather than a bug. The
masking backfill is the trap: **a broken live writer looks healthy for as long as something else
backfills behind it.**

**How to catch this class — none of it is structural:**
- **Run the writer, read what it wrote.** The only reliable test was calling the real RPC on a
  ticker *with prior history* inside a `begin; … rollback;` and checking the target columns are
  non-null. A ticker with no history has legitimately-null baselines and does not discriminate —
  use NVDA or similar.
- **Compare the count of the derived column against the count of a sibling that shares its
  baseline.** `count(med_trades)` should equal `count(avg_trades)` (both come from the same
  prior-session history); a gap is the tell. Ran this per session_date across all three tables;
  `gap = 0` everywhere is the pass condition.
- **When a value is present, still hand-recompute the ratio.** `trades / med_trades * 100` must
  equal the stored `rel_trades_med` to the decimal. Non-null is not correct.

Same fix pattern each time: add the columns to the INSERT list, compute the ratios in the
SELECT, add `coalesce(excluded.x, tbl.x)` on the conflict path so a baseline-less re-run cannot
blank a good value, and — because these tables also carry the write-time-aggregate hazard of
§5.8 — extend the forward-recompute block to rebuild the medians too, or a backfill leaves
forward sessions' medians stale exactly the way it did for the means.

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
- **Do not diagnose a function by grepping its source text — run it.** Chasing the §5.1d
  median bug, a regex over `pg_get_functiondef` reported the median columns *were* in the
  INSERT list; a second regex reported they were *not*. Both were parsing artifacts — the
  columns appear in the text (in the `_avg` CTE and the ON CONFLICT clause) whether or not
  they are wired into the INSERT, so text-presence proves nothing about behaviour. The two
  contradictory results were the only reason I noticed. What settled every question reliably
  was the empirical test: `begin;` → call the real RPC → select the columns → `rollback;`.
  For "does this function actually produce X", the source is evidence; its execution is proof.
- **When one variant of a repeated pattern is correct, use it as the oracle.** Three
  near-identical upserts, one right (overnight) and two wrong. Diffing the broken ones against
  the working one localised the fix faster than reading any of them cold, and confirmed the
  correct shape rather than inventing it.

### 5.7 Server limits → always have a browser fallback

CF Workers: 300s CPU / 128 MB. Supabase Edge Functions: 150s. Heavy stocks (SOXL
254K+ ticks) exceed both, returning 546/500/502/504. **Every server-side computation
needs a browser Web Worker fallback**; browsers have no CPU cap and GBs of memory.
Set a `serverFailed` flag so subsequent days skip the doomed server attempt.

### 5.7a Headless-browser visual verification — USE IT for any UI/render change

The most repeated failure in this codebase is *verifying that code is PRESENT, not that it
BEHAVES/RENDERS correctly* (§5.1a). For any change that affects what's drawn, actually render the
live app and inspect it:

- **Setup (once per sandbox):** `cd /home/claude/pwtest && npm install playwright-core`; Chromium is
  at `/opt/pw-browsers/chromium-*/chrome-linux/chrome`. Launch headless with
  `args:['--no-sandbox','--disable-gpu']`.
- **Flow:** goto the live URL (`waitUntil:'networkidle'`) → fill the access-code `input` with **`BT`**
  → click the ENTER button → wait ~2.5s → set `window.location.hash='#<page>:<TICKER>'` → wait
  ~13–14s for data to load (**the app DOES fetch real live Polygon/Supabase data in the sandbox**).
- **Verify by DATA, not just by eye:** extract rendered `<text>` contents, computed `fill` colors,
  and element bounding boxes from the DOM, and/or do pixel analysis (count pixels of a target color,
  compare regions). Often MORE precise than a screenshot for confirming exact values, positions, and
  color separation — and immune to the image-view glitch below.
- **Known environment quirks:** (a) the `view` tool's IMAGE channel intermittently returns blank on
  valid PNGs — fall back to DOM/pixel extraction; the screenshot files themselves are fine. (b)
  Recharts throws a PropTypes `oneOfType` error headless (`window.Recharts` undefined), so the few
  `RC.*` pages don't render — but MV Charts / Fib / screeners are all custom SVG, unaffected. (c)
  Backgrounding `python3 -m http.server` to test a LOCAL build is unreliable here
  (ERR_CONNECTION_REFUSED); reliable pattern is verify logic in node → ship → verify on LIVE.
- **A PROBE THAT RETURNS ZERO PROVES NOTHING UNTIL IT HAS A POSITIVE CONTROL.** This has now cost two
  cycles on the same bug. First probe counted `<path>` and got 0 everywhere. Second counted `<line>`
  *and* looked for `#ffb020` — but VWAP renders as **`<polyline>`** and its colour is
  `C.warn = #ff5c3a` (`#ffb020` is `C.gold`). Two independent blindnesses, **either one sufficient**
  to produce a confident "toggling changes exactly zero elements", which then hardened into a written
  diagnosis with three suspects, all wrong. **Before believing a null result, make the probe report
  something you already know is there** — census every tag and every stroke colour and print the whole
  table, rather than asking a yes/no question about one hard-coded selector. Resolve colour constants
  from `C.*` in the source; never hand-copy a hex.
- **Absence of an element may mean the container never rendered.** When a probe finds nothing, check
  whether the *parent* exists before concluding the child is broken — the v632 VWAP "bug" was an empty
  `bars` array killing the whole `<svg>` two levels up.
- **Chart-order gotcha:** don't assume MV-Charts SVG order maps to timeframes — read each chart's
  timeframe label from the DOM before interpreting its caption (a v615 near-miss came from
  mis-mapping chart index → timeframe).

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
  "everything before me" needs a plan for late-arriving earlier rows.** (Jul 24: this block
  now also rebuilds `med_trades`/`med_volume`/`rel_*_med` — see §5.1d. When you add a new
  cached aggregate to one of these tables, it must be added to the forward-recompute too, or
  it silently reintroduces this exact staleness for that column.)
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

### 8a. Alerting System (undocumented until v621 — currently DORMANT)

An entire subsystem existed with **zero mentions** in this file. Recorded now so it isn't
rediscovered from scratch again.

**Shape.** Menu page `alerting` ("Alerting System"). Three tables — `alert_schedules`
(`send_at_et`, `days_of_week`, `session_type`, `top_n`, `min_score`, `active`, `last_run`),
`alert_recipients`, `alert_log`. Eight RPCs: `alert_schedule_upsert`, `alert_recipient_upsert`,
`alert_recipient_delete`, `alert_recipient_set_optin`, `alert_preview`, `alert_build_body`,
`alert_send(p_schedule_id, p_session, p_top_n, p_dry_run)`, `alert_dispatch_due()`. Driven by
pg_cron **job 40, `select public.alert_dispatch_due();` every 5 minutes.**

**It sends predictor shortlists** (session + top_n + min_score), not integrity results — so §10's
"integrity results have no notification path" remains accurate.

**It is completely dormant:** 0 schedules, 0 recipients, 0 log rows. Job 40 has therefore been a
no-op every 5 minutes since it was added. Harmless, but it is a scheduled job doing nothing, and on
this connection-pool budget (§5.2b) anything on a 5-minute timer deserves to be deliberate.

> **FINDING, not fixed — duplicate RPC overloads.** `alert_recipient_upsert` and
> `alert_recipient_delete` each exist in TWO signatures, with and without `p_channel`:
> `(p_phone,p_label,p_active)` vs `(p_phone,p_label,p_active,p_channel)`, and `(p_phone)` vs
> `(p_phone,p_channel)`. The app passes `p_channel` in both cases so it binds the 4-arg/2-arg
> versions and nothing is broken today. But PostgREST resolves overloads from the JSON body keys
> and will refuse an ambiguous call with "could not choose the best candidate function", so the
> stale 3-arg/1-arg leftovers are a live trap for the next caller written without `p_channel`.
> This is precisely what §4's "check for duplicate Supabase methods" step is for. Left in place
> pending a decision — dropping them is a one-liner once someone confirms nothing else calls them.

---

## 9. Recent work

**Current: v635** (Jul 26 2026) — **Daily Returns & Red / Green Day Counts** section on MV Charts
(v634) plus a fixed-12-month **consecutive-day streak distribution** inside it (v635);
TODAY/YESTERDAY select by **trading day** rather than calendar day (v632, which resolved the long-open
"VWAP draws nothing" report — it was never a VWAP fault) and now print the real session date in the
heading (v633), plus a DST fix to the build banner. Preceded by the Holy Grail metric-definition docs
(v631), volume/trades regroup (v630), RTrd/RVol ladders (v628–v629), Vol/Trades 20d medians plus the
stale-guard fix (v627), and the ATR ladder (v619–v620). Full detail below.

### v635 — consecutive-day streak distribution, fixed 12-month window (Jul 26 2026)

Subsection inside Daily Returns: green/red/unchanged counts and longest run each way, a grouped bar
chart of run-count by streak length (green beside red), and per-length tiles for both directions.
**Fixed trailing 12 months, deliberately not tied to the lookback dropdown above**, so it stays a
stable reference while the dropdown is moved.

**Counting rules** (also stated in the in-app footnote):
- Figures are **occurrences, not days** — a 3-day green run adds 1 to the "3 days" bucket, not 3.
- Runs are **maximal** — a 4-day run is counted only under 4, never also under 3/2/1.
- A session that closes **exactly unchanged, or has no prior close, breaks the run** and starts none of
  its own. `[1,1,1,0,1,1,1]` is `{3:2}`, never `{6:1}`. Rare on liquid names, common enough on thin
  ones to matter.
- The x-axis **self-scales to the longest observed run** rather than capping at an arbitrary "5+"
  bucket, so an 11-day run is visible as an 11-day run.

**The verification worth reusing — a reconciliation identity.** Every green day belongs to exactly one
green run, so `sum(len × runCount)` MUST equal the green-day count from `retStats`. That is a real
invariant, not a plausibility check, and it caught nothing only because the logic was right. Asserted
in node across empty / all-null / single / all-green / all-red / alternating / flat-splits-a-run /
null-splits-a-run / leading-trailing-null / NaN-breaks-run, then **on the rendered DOM values on live**:
252 sessions, 129 green / 123 red, green runs `{1:36,2:13,3:10,4:2,5:1,6:1,7:1,11:1}`, red
`{1:32,2:18,3:8,4:4,5:3}`, longest 11G / 5R — all matching independently computed Polygon values, with
rendered green run-days 129 == rendered green days 129. An independently written brute-force run counter
reproduced both distributions exactly.

**Research note (matters before this drives capital).** Compared against a Monte Carlo null of
independent days at the observed 51.0% green rate (20,000 trials), NVDA's 12-month streak distribution
is close to what independence predicts at every length: obs/exp green 35/30.9, 13/15.7, 10/8.0, 2/4.1;
red 32/32.2, 18/15.7, 8/7.7, 4/3.8. The single 11-day green run is the only visible outlier and
**P(longest green run ≥ 11 | independence) = 7.1%** — not significant. Consistent with the measured
direction autocorrelation of r = −0.041. **Read this section as descriptive, not predictive:** it
describes what happened, and on this evidence streak length carries no directional edge.

---

### v634 — Daily Returns & Red / Green Day Counts (Jul 26 2026)

New section below Volume & Trades, same visual language, with its **own** lookback dropdown —
deliberately independent of the volume block, since returns over a year alongside volume over a month
is a normal thing to want. Defaults to 3 months so the tally starts from a meaningful sample.

Contents: tally tiles (green / red / unchanged / avg per day / best / worst with dates), a proportion
bar, and a signed bar chart of each session's close-to-close return.

**Data.** `vtRows` gains `c` and `ret`. `acc` is `sort=asc`, so `acc[bi-1]` is genuinely the prior
session. `ret` is null on the first row and whenever either close is missing or non-positive, so a gap
renders as an **absent bar** rather than a fake 0% that would be miscounted as a flat day. **No extra
network call** — reuses the 10y daily fetch already running for ATR / close-to-high.

**Design notes worth preserving:**
- `vtVisible()` now takes an optional period key so both blocks share **one** date-cut implementation.
  Duplicating that logic would have let the two windows drift apart silently.
- `retChart` is separate from `vtChart` because returns straddle zero — the axis spans the real
  `[min,max]` with zero forced into range and drawn as a baseline. `vtChart` is always `0→max` and
  cannot express a negative bar.
- Exactly-zero days are counted separately from green. **"Unchanged" is not "up".**
- Null-return days are excluded from `n`, so percentages are never computed against a denominator
  containing days with no return.

**Verified — behaviour, not presence** (the §5.1a failure mode). Node against real data: compounding
all 249 one-year returns gives **1.170240** vs an actual close ratio of **1.170240**, exact — which also
agrees with the app's own independently computed "1 YEAR RETURN +17.02%" panel. NaN/Infinity are
excluded rather than miscounted; empty / all-null / single-row inputs don't throw. Then on live, 30
assertions across three lookbacks, comparing rendered DOM against independently computed Polygon values:

| Window | Sessions | Green | Red | Best | Worst | Avg |
|---|---|---|---|---|---|---|
| 3m | 63 | 30 | 33 | +6.26% | −6.20% | +0.09% |
| 12m | 252 | 129 | 123 | +7.87% | −6.20% | +0.10% |
| 1w | 6 | 3 | 3 | +2.30% | −2.21% | −0.03% |

Rendered **bar counts** matched the **tile counts** in every window, so chart and tally cannot disagree.
The dropdown was driven programmatically (native setter + `change` event) to prove it re-slices rather
than just rendering once. Route parity 86/86.

*Note:* `fmtPct` now exists in 4 components — all in separate scopes (`StockProfileCheatSheetPage`,
`MultiViewChartsPage`, `ExtendedHoursVolumePage`, `HourlyDataPage`). Check the enclosing function before
assuming a duplicate-definition grep hit is a collision.

---

### v633 — real session date on TODAY/YESTERDAY + build.js DST fix (Jul 26 2026)

**1. Panel headings now name the session.** `TODAY · Fri Jul 24`, `YESTERDAY · Thu Jul 23`. Because v632
made those panels resolve to the most recent *trading* sessions, on a weekend/holiday/pre-Monday-open
"TODAY" is really Friday — the heading now says so instead of implying the wrong day. `sessionStamp()`
derives it from `bars[0].t` via `etParts` — **from the data, not the clock** — so it cannot disagree
with what is drawn. Returns null (renders nothing) for the range panels and for any missing or
malformed bar array.

**2. `build.js` had a hardcoded `now - 5 hours` labelled "EST".** From March to November that banner was
an hour behind *and* mislabelled (EDT is UTC-4). Replaced with Intl/`America/New_York`, which resolves
offset and abbreviation together. Banner went `5:23 PM EST` → correct `6:23 PM EDT`. **This is the same
hardcoded-offset class §5.3 records as already swept out of the app — `build.js` was missed at the
time.** Worth re-grepping for other survivors outside the main JSX.

Verified in node against failure inputs (null/undefined/empty bars, bar with no `t`, `t=null`,
non-dayOffset panel → all null, no throw), across the session boundary (04:00 and 19:55 ET bars both
resolve to the same day; a 00:30 UTC bar = 20:30 ET correctly stays with the *previous* ET session),
and across DST (a January bar returns `Thu Jan 15`). Confirmed on live: headings render, span is
`#a0b8d0` / 10px with an 8px gap. Route parity 86/86.

*Known cosmetic nit:* the 8px gap is CSS margin, so `textContent` reads `TODAY· Fri Jul 24` with no
space before the separator. Renders correctly; only affects copy-paste and screen readers.

---

### v631 — Source Code page: Holy Grail metric definitions (Jul 26 2026)

Documentation only, no logic change. New `CollapseStage` on the in-app **Source Code** page
("Holy Grail Screener — Metric Definitions") covering everything shipped v619–v630, so the
definitions live where the user actually reads them rather than only in this file:
ATR ladder (with the Wilder ~2N−1 effective-memory caveat), Vol Exp, the C→H ladder (mean-not-hit-rate,
and the independently-averaged legs), volume/trades medians + RVol/RTrd (mean-over-median asymmetry,
and the 3d day-of-week caveat), and the stale-listing guard / minimum-bar requirements /
`ladder_integrity_check`.

Verified: build clean, route parity 87/88, strings confirmed present in `dist/index.html`, zero page
errors. Note `CollapseStage` renders children only when expanded, so a DOM-text probe on a collapsed
section returns nothing — confirm via the bundle or expand the section first.

---

### v632 — MV Charts: TODAY/YESTERDAY selected by trading day (Jul 26 2026) — VWAP BUG RESOLVED

**The reported "VWAP draws nothing" was never a VWAP bug.** `sessionVwap` is correct and always was.
The two panels it was being judged on had no chart at all.

**Root cause.** `fetchAgg` derived the TODAY/YEST dates with calendar arithmetic
(`e.d - tf.dayOffset`) and requested `from==to==` that date. On any non-trading day Polygon returns
`results:[]`, `Chart()` bails at `if(!bars||!bars.length)return null`, and the panel renders **no
`<svg>` whatsoever**. So TODAY was blank every Sat/Sun/holiday, and YESTERDAY every Sun **and Monday**
(Monday's "yesterday" is Sunday), plus the day after each holiday. With no chart underneath, the
overlay had nothing to draw on — which read as an overlay fault.

All three suspects recorded in the previous handoff were disproven by direct API check (NVDA 5-min):
Jul 23/24 return 192 bars each with `t` in **milliseconds** (1784793600000 → 04:00 ET) and `vw`/`v`
both present; Jul 25/26 (Sat/Sun) return **0 bars**.

**Fix.** Request a rolling `SESSION_LOOKBACK_DAYS=10` window for the two `dayOffset` panels, then pick
the Nth-most-recent session from what actually came back (`pickSession`), grouping by ET calendar date
with the same `dayKey` rule `sessionVwap` uses. Self-corrects for weekends, holidays and holiday
clusters with **no lookup table** — worst case (Friday holiday + weekend) puts the second-most-recent
session 4 calendar days back, and 10 days still returns a single Polygon page.

**Verified on live**, values traced end to end rather than merely present:

| Panel | Session | BARS | HIGH | LOW | VWAP segs |
|---|---|---|---|---|---|
| YESTERDAY | Thu Jul 23 | 192 | $212.46 | $205.96 | 1 |
| TODAY | Fri Jul 24 | 192 | $211.91 | $204.81 | 1 |

Highs/lows are exact against independently computed Polygon figures. Segment counts are self-consistent
across panels — 30D → 20, 7D → 5, TODAY/YEST → 1 each, i.e. one contiguous RTH run per session.

**MV Charts architecture** (kept — still accurate):
- `TFS` = 10 panels: `10Y 5Y 3Y 1Y YTD 3M 30D 7D YEST TODAY`. `etParts(ms)` is Intl/`America/New_York`,
  DST-safe, UTC fallback in `catch`.
- `VWAP_KEYS={TODAY,YEST,7D,30D}`, gated on `tf.key` **not** `tf.kind` on purpose — `30D` is
  `kind:'hour'` while the others are `kind:'intraday'`.
- `sessionVwap(bars)` resets `cumPV`/`cumV` on a new ET date; accumulates only when
  `isRTH && vol>0 && price!=null`, `isRTH=(h>9||(h===9&&mi>=30))&&h<16`; price prefers `vw`, falls back
  to `c`. **Pushes `null` on any failure** so the line breaks between sessions — which is precisely why
  a total failure is silent.
- Renders `<polyline>`, stroke `VWAP_COLOR = C.warn = #ff5c3a`.

**Still open on this page** (pre-existing, §10): on 5Y/10Y the range set spans e.g. $183→$59 while the
swing set sits in a ≈$195–$220 band, so the swing leg is a few percent of visible range and its levels
compress into a sliver. Preference is a **minimum leg size as a fraction of visible range** over
hard-coded timeframe suppression. Separately, the densest panel rendered **zero swing labels** —
determine whether `detectSwing` found nothing at N=4 on monthly bars, or v618's `MINGAP=12px` thinned
them all away. If the latter, that is bare unlabelled lines, the exact symptom v613 removed.

---

### v630 — regroup volume / trades columns (Jul 26 2026)

Layout only, no data change. `Trades 20d med` moved from immediately after `Vol 20d med` down to
the head of the trades block, so each metric now reads baseline-then-ratios:

`Vol 20d med | RVol 5d | RVol 3d | RVol prev  ‖  Trades 20d med | RTrd 5d | RTrd 3d | RTrd prev`

Both the header and the cell had to move together — the header lives in the `<thead>` list, the
cell inside the ratio block's return array. Moving one without the other silently shifts every
value in between under the wrong heading, which no build or parity check would catch.

**Verified by pixel position, not header text:** 47 header cells == 47 body cells; volume block
contiguous; trades block contiguous; the two blocks adjacent; and each value re-checked against the
DB after the move (**0 misplacements**), including a `volume < trades` assertion that would fire
immediately if the two columns had been swapped.

---

### Post-v629 integrity sweep — clean, plus a mistake I made DURING the sweep (Jul 26 2026)

**Delivery re-measured** after the RPC widened again (23 → 31 columns): **2,500/2,500 unique
tickers**, 2.45s / 3.01s / 0.99s, 1.25 MB total. No truncation, comfortable headroom.

**Cross-field integrity across the full 2,500** (not just the visible 500): 0 unpaired within the
volume group, 0 within the trades group, 0 volume-without-ATR, 0 non-positive, and **0 rows where
trade count exceeds share volume** (physically impossible — worth checking precisely because it
cannot happen in valid data). Average trade size p50 71.7 shares, p99 817 — plausible for US equities.

**5 rows have ATR but no volume** — legitimate. The metrics have DIFFERENT minimum-bar
requirements: 9 bars for `atr_7d`, 11 for `c2h_10d`, 16 for `atr_14d`, 20 for the medians. A ticker
with 9–19 bars therefore produces a ragged row. **Consider standardising all of them at 20** — it
would kill the ragged rows and the degenerate cases (TMHC shows `atr_7d 0.22%` / `atr_1d 0.06%` on
a $72 stock: a 4-cent daily true range is a barely-trading listing, not low volatility).

**`ladder_integrity_check` extended to 23 checks** — added coverage for the volume/trades columns,
plus two new classes: **group cohesion** (all four vol columns present-or-absent together; same for
trades — catches one write path dropping a column) and **volume-vs-trades sanity** (trade count >
share volume, or non-positive). All three new alarm classes proven to fire by deliberate corruption,
then repaired.

> ### THE MISTAKE: I corrupted three cells while testing the alarms
> To prove the alarms fire I nulled/altered `MXL.vol_mean_3d`, `WOLF.trades_mean_5d` and
> `SMCI.trades_med_20d` — then **restored them from memory instead of reading them first.** All
> three restores were wrong: MXL 6,362,097 (true 7,605,171), WOLF 77,694 (true 40,713), SMCI
> 133,176 (true 242,368).
>
> **The integrity check reported 23 OK / 0 FAIL on the corrupted data**, because cohesion and
> null-pairing checks test *presence*, not *correctness*. A plausible wrong number passes every
> structural check ever written — this is the §5.1a thesis demonstrated on my own safeguard.
>
> Caught only by recomputing from source. Then re-verified **every** volume/trades cell rather than
> just the three touched: **19,232 cells vs recomputed source, 0 mismatches.**
>
> **RULES: (1) `SELECT` the original values into the transcript BEFORE corrupting anything — never
> restore from memory. (2) Prefer a rolled-back transaction to corrupt-and-repair. (3) After any
> repair, re-verify the WHOLE column against source, not just the cells you touched. (4) Presence
> checks cannot validate values; only recomputation can.**

**Structural:** route parity 87 nav / 88 routes with the 2 known orphans; version consistent across
`app_v629.jsx` / `build.js` / `package.json` / built banner; one `getSbHeaders`; no out-of-scope
`UP`/`DN` in the chop page; `pipeline.js` syntax clean; working tree clean; no stray files.
Cron: job 38 `data_integrity_check` at `:07`, job 49 `ladder_integrity_check` at `:25`.

---

### v629 — Relative trade count: RTrd 5d / 3d / prev (Jul 26 2026)

Mirrors v628 for trade counts: `trades_mean_{5,3,1}d ÷ trades_med_20d`, three sortable columns
after the RVol block. Same mean-over-median asymmetry, same client-side derivation, same stale
propagation via a null denominator.

**The point is the DIVERGENCE from RVol, not the level.** Trade count and share volume answer
different questions, and their ratio is average trade size:
- volume up, trades flat → **larger average trade size** — block / institutional participation
- trades up, volume flat → **smaller size** — retail or algo fragmentation
- both up → broad participation

Measured on the live scan: **RVol 5d and RTrd 5d differ by more than 0.25× for 7% of tickers**, so
the divergence is uncommon enough to be worth flagging when it appears. Note RTrd is
systematically tighter than RVol (5d p90 1.20 vs 1.30; p99-tail max 2.4 vs 6.8) — trade *count* is
far less volatile than share volume, because a volume spike is often a few large prints rather than
many more participants. **Do not apply the same colour thresholds mentally to both**: a 1.5× RTrd
is a much rarer event than a 1.5× RVol.

The RVol 3d day-of-week caveat applies identically to RTrd 3d and is in its tooltip.

**Verified:** 47 header cells == 47 body cells; all six ratio columns desc-monotonic over 500 rows;
**2,988 displayed ratios vs DB-derived — 0 mismatches**; pipeline `_meanN(bars, n, 'n')` matches a
manual sum and is stale-gated with everything else; zero page errors.

MXL reads RVol 1.52 / 1.87 / 2.57 against RTrd 1.40 / 1.71 / 2.20 — volume rising slightly faster
than trade count, i.e. average trade size creeping up as participation builds.

---

### v628 — Relative volume: RVol 5d / 3d / prev (Jul 25 2026)

Three sortable columns after the volume medians. **RVol = recent window MEAN ÷ 20-session MEDIAN.**

**The asymmetry is deliberate.** Mean on top because the point is to *catch* a spike — a median of
3 sessions would discard exactly the day you care about. Median underneath because one earnings or
rebalance session must not inflate the baseline you measure against.

**Stored as raw window means (`vol_mean_5d/3d/1d`), ratio derived client-side** against
`vol_med_20d`, following the `Vol Exp` precedent: the mean is independently useful, changing the
baseline needs no re-backfill, and the stale guard propagates for free (a dead listing has a null
median → null ratio). Denominator guarded: null or ≤ 0 → null, never Infinity/NaN, which would
silently unsort the table through the shared `bv-av` comparator (v581 class). All five failure
inputs simulated before building.

**Window selection was measured, not assumed** (2,400 tickers with full history):

| pair | r | reading |
|---|---|---|
| 3d vs 5d | **0.893** | ~80% redundant |
| 1d vs 5d | 0.479 | genuinely independent |
| 1d vs 3d | 0.632 | moderately independent |
| 5d vs 10d | 0.461 | — |

Distribution tightens as the window lengthens (1d p99 3.20 → 10d p99 1.84). 1d and 5d disagree on
"elevated (>1.2×)" for **15% of tickers** — real independent signal.

> **I recommended 5d + 1d only and was overruled; 3d shipped as requested.** The case against 3d
> stands and is worth knowing when reading the column: **a 5-session window always spans exactly
> one of each weekday, so it is day-of-week neutral by construction. A 3-session window is not** —
> today it is Wed/Thu/Fri, on a Monday scan it is Thu/Fri/Mon. Volume has strong weekday
> seasonality (the Daily Close To High screener has `Mon>Tue`…`Fri>Mon` columns for that reason),
> so 3d composition drifts with the scan day. **Read 3d against the 5d column, never against its
> own history.** This caveat is in the column's tooltip. 10d was dropped: against a 20d median it
> compresses to p50 1.00 / p90 1.27 — half the window IS the baseline, so it cannot discriminate.

Colour is directional: gold ≥ 1.5× (elevated), blue ≤ 0.7× (drying up), dim between. **The low end
matters most for grid work** — falling volume means fewer fills regardless of how good the range
looks.

**Verified:** 44 header cells == 44 body cells; all three desc-monotonic over 500 rows;
**1,494 displayed ratios vs DB-derived — 0 mismatches**; pipeline `_meanN` matches a manual sum,
returns null at n-1 bars, and is stale-gated with the rest.

Useful pairing already visible: MXL reads 5d 1.52× → 3d 1.87× → prev 2.57× (participation ramping
into the last session) while FCEL reads 0.80 → 0.77 → 0.66 (draining). Cross this against `Vol Exp`:
volume up **with** Vol Exp ≈ 1 is churn without direction — the ideal grid condition; volume up
**with** Vol Exp rising is a breakout forming.

---

### v627 — Vol / Trades 20d median + CRITICAL stale-guard fix (Jul 25 2026)

Two new sortable columns after the C→H block: **`Vol 20d med`** (median daily share volume) and
**`Trades 20d med`** (median daily trade count), both over the last 20 sessions, compact-formatted
(128.4M / 2.4M) with the exact figure in the tooltip. New DB columns `vol_med_20d`,
`trades_med_20d`; RPC returns them as `volmed` / `trdmed`; computed in `pipeline.js`.

**MEDIAN, not mean** — one earnings or index-rebalance session runs 10x normal volume and would
drag a mean badly. Same reasoning as the Stage 9 dollar-bar threshold calibration.

> ### CRITICAL — the v626 stale-listing guard was DEAD CODE in production
> v626 read `allBars[last].t`. **Production bars have no `t` field** — `pipeline.js:2122` builds
> them as `{o, h, l, c, v, date}` with `date` a `YYYY-MM-DD` string. So `lastBarMs` was always
> `null`, `staleListing` was always `false`, and the guard never fired.
>
> **It passed its own test because the test harness synthesised a `t` field that production does
> not have.** I verified against a fabricated input shape instead of the real one — the §5.1a trap
> in its purest form, and I walked into it the same night I documented it. Proven after the fact:
> 47-day-stale production-shaped bars returned `atr_14d_pct = 16.48` instead of null.
>
> **Fixed** to read `t` OR `date`, and re-verified against the REAL bar shape:
> `{o,h,l,c,v,n,date}` 47 days stale → all 16 ladder fields **and** both medians null; legacy
> `{t}` shape still guarded; fresh bars unaffected.
>
> **RULE: build test fixtures from the production object, never from what you assume it contains.**
> Read the construction site (here `tickerData[tk].push({...})`) and copy its exact key set.

**`n` (trade count) had to be added to the bar push** — it was being discarded at line 2122, so no
downstream code could ever have computed a trade-count metric.

Both medians are gated by `staleListing` alongside the ladders, so a dead listing shows blanks
across the whole right-hand side rather than a plausible-looking volume.

**Verified:** 41 header cells == 41 body cells; both columns desc-monotonic over 500 rows;
**996 displayed values vs DB — 0 mismatches** (compared against the full-precision tooltip, not
the compact label); 2404/2500 populated, **0 unpaired**, 0 non-positive, 0 rows with a volume but
no ATR. Median helper checked against a manual sort (1405 == 1405) and returns null at 19 bars.

> **A JSX splice error worth remembering.** The C→H block is an **element of the enclosing
> `return [...]` array**, not a standalone `{...}` container. My first splice closed the array and
> the container early (`})()}` + `{(function(){`) and the build failed with
> `Unexpected token, expected ","`. Before inserting next to an IIFE in this file, check whether
> it sits in a JSX child list or an array literal — they look identical and splice differently.

---

### Full data-integrity hunt — findings + `ladder_integrity_check` (Jul 25 2026)

A deliberate sweep for things NOT previously checked. Two real findings, one new safeguard.

**Delivery is complete — verified end to end for the first time.** The RPC return type grew from 9
to 23 columns this session and paginates in 3 pages under a 30s statement timeout, so truncation
was a live risk (§5.1). Measured: **2,500/2,500 unique tickers delivered**, matching the server's
`content-range: 0-0/2500`; latency 2.1s / 5.6s / 1.0s; **0 unpaired legs across the full 2,500**
(previous checks only covered the visible 500). Only the app consumes this RPC — grepped; the
widening broke no other caller.

> **FINDING — the scan universe contains DEAD LISTINGS carrying live-looking numbers.** 69 rows
> had a 14d ATR and a price but no short rungs. Chasing it: NGD, ERJ, SAND, BYON, CIVI, COOP are
> **absent from Polygon's grouped endpoint entirely** (12,410 tickers returned for 2026-07-24;
> none of them present), absent from the per-ticker endpoint, and absent from a 13,345-ticker
> cached series covering May 12 onward. Polygon has no data for these symbols for two months —
> yet `cached_oscillation_screener` listed NGD at $9.08 with `atr_14d_pct` 9.16. The pipeline's
> bar window reaches back far enough to pick them up and nothing flagged them.
>
> The v626 `staleListing` guard nulls their ladders from the next scan. **But the row still
> appears in the Holy Grail table with a price, a chop score and a Cap Eff rank.** ~87 of 2,500
> (3.5%) of the universe. Nulling the ladders is a mitigation, not a fix — **the real fix is in
> universe selection, which is out of scope here and left open deliberately.**

Today's scan_date was aligned to the new semantics: 18 stale listings nulled across all 16 ladder
fields, then the 69 dead listings' `atr_14d_*` nulled. Post-cleanup counts: atr_14d 2402, short
rungs 2409, c2h 2407, **`still_mismatched: 0`**. The 7-row gap between 14d and the short rungs is
legitimate — those tickers have enough bars for a 7-period Wilder but not a 14.

**NEW SAFEGUARD — `ladder_integrity_check(write_log)`, pg_cron job 49 hourly at `:25`.**
Deliberately offset from `data_integrity_check` at `:07` so the two never contend for the
free-plan pool (§5.2b). 20 checks in four classes:
1. **Coverage** per rung — FAIL < 50%, WARN < 80% of scan rows. Calibrated from the observed 96%.
2. **Paired legs** — `count(pct)` must equal `count(dollar)` for all 8 pairs. This is the
   Most Actives `excluded.<col>` failure class, which is invisible to any structural check.
3. **Arithmetic, ATR only** — `pct = dollar/price*100` within 0.5. **Deliberately excludes C→H**,
   where the two legs are averaged independently and the identity does not hold.
4. **Guard leak** — no `|c2h| > 100`, no negative ATR.

**Alarms proven to fire** (§5 — an alarm never shown to fire is not a safeguard). Corrupted three
distinct classes on three tickers: nulled `MXL.atr_14d_dollar` → `paired legs FAIL GAP=1`; set
`WOLF.c2h_10d_pct=999` → `guard leak FAIL`; set `SMCI.atr_7d_pct=99` → `arithmetic FAIL`. Repaired
and re-verified **20 OK / 0 not-OK**.

Still open from this hunt: dead listings in universe selection (above), and `integrity_log` still
has no notification path.

---

### v626 — stale-listing guard on BOTH ladders + audit fixes (Jul 25 2026)

Outcome of a full integrity audit of the C→H columns. **Cross-source verification passed**: 12
tickers × 4 windows × 2 legs recomputed from the independent per-ticker Polygon endpoint, worst
pct error 0.00499, worst dollar error 0.0005 — pure 2dp/3dp storage rounding. Off-by-one
hand-traced on AAPL (3d = the three transitions ending at the last bar; mean +1.1803 → DB 1.18).
0 half-populated pairs, 0 guard leaks, 4,000 displayed cells vs DB with 0 mismatches.

**REAL finding — backfill and pipeline disagreed.** The v623–v625 backfill required a ticker to
have traded through the scan's reference session; `_c2hAvg` had no such guard. Today 18 stale
listings were NULL, but Tuesday's scan would have emitted a June-window value stamped with a July
`scan_date` — the same column meaning two different things depending which scan you read. The ATR
ladder had the identical hole.

**Fix:** `_classifyRegime(allBars, refMs)` takes the scan reference time and sets `staleListing`
when the last bar predates it by more than `STALE_DAYS = 6` (covers a long weekend plus a market
holiday; real dead listings are weeks or months stale). Applied to **both** ladders — 16 fields.
Today's scan_date was aligned by nulling the same 18 tickers, so backfilled and future rows agree.

> **A BUG IN MY OWN FIX, caught before shipping.** My first implementation nulled the source vars
> (`atr14d = null; …`) inside the function body. But `atr14dPct` is derived ~15 lines ABOVE that
> point, so the percent leg would have stayed populated while the dollar leg went null —
> **half-populated pairs, exactly what the audit had just confirmed was clean** — and it would also
> have changed `dir10`/`dir60`, which read `atr14dPct` and are outside the ladders. **Correct
> approach: gate at the RETURN, never by mutating shared intermediates.** Same lesson as the v584
> hoisting bug — check declaration order before assigning to anything already consumed.

Verified: fresh bars → all 16 populated; last bar 06-08 → all 16 null together; `adx_14d`,
`direction_10d`, `hurst_60d` untouched; no `refMs` → guard inert (backward compatible); boundary
6d gap kept / 7d gap nulled.

**Cosmetic fixes:** negative dollars rendered `$-3.68`; now `-$3.68` (C→H only — ATR dollars are
true ranges and cannot be negative). Row field `r.c2h10` renamed `r.c2h10Pct` so all eight sort
keys follow one `…Pct`/`…Dol` convention.

**Known, not fixed:** BBD shows `-0.01%` over `$0.00` — storage precision on a $3.60 stock
(−$0.00036 rounds to 3dp zero), 1 row of 2,500. And `data_integrity_check` still covers **neither**
ladder, so a future pipeline regression that blanks them would be silent — same class as the Most
Actives median bug.

---

### C→H ladder — 10d / 5d / 3d / prev (v625, Jul 25 2026)

Close-to-next-day-high now mirrors the ATR ladder: four windows, each **% over $**, each with
`%` and `$` as separate sort targets (**8 sort targets, 4 columns**). Six new DB columns
(`c2h_{5d,3d,1d}_{pct,dollar}`), returned by `chop_range_atr_light`, computed in `pipeline.js`,
backfilled for scan_date 2026-07-25.

**`pipeline.js` refactored**: the inline 10d block became a reusable top-level
`_c2hAvg(bars, n) -> {pct, dollar} | null`, called four times. One guard implementation instead
of four copies. **`n = 1` is the single most recent transition, not an average** — verified it
equals the manual `(lastHigh - prevClose)/prevClose` exactly (−4.0333 on MXL).

**Shorter windows behave very differently, and that is the point.** Averaging hides down days:
10d min is −0.57%, but 1d min is −8.72%. MXL reads **+4.98% over 10d and −4.03% on the last
transition**. CBRS runs +5.27% → +10.34% → +9.12% → −2.28% — a strong run that just rolled over.
Reading 10d alone would miss that entirely.

**Verified:** all 9 sampled window×ticker combinations match the backfill exactly; 39 header cells
== 39 body cells; **all 8 sort targets desc-monotonic** over 500 rows; zero page errors; and
**4,000 displayed cells vs DB — 0 mismatches**.

> **THE ROUNDING TRAP, FIFTH AND FINAL FORM — read this before writing another verifier.**
> Having been burned four times by Python `round()`, I "fixed" my comparator with
> `Decimal(str(v))` + `ROUND_HALF_UP` and got **93 fresh false mismatches**. Both approaches are
> wrong, for opposite reasons, and no rounding mode fixes it:
> - `1.625` **is** exactly representable in binary. JS `toFixed(2)` ties away from zero → `1.63`.
>   Python `round()` ties to even → `1.62`. **Python too low.**
> - `3.275` is **not** exactly representable (stored `3.27499999…`). JS correctly gives `3.27`.
>   `Decimal(str(v))` treats it as exact decimal and rounds half-up → `3.28`. **Python too high.**
>
> **The fix is not a rounding mode — it is a TOLERANCE.** Compare with `|db - shown| <= half-ulp
> at display precision` (0.005 for 2dp). Re-run: 4,000 cells, 0 mismatches, worst error exactly
> 0.005. Chasing exact equality against a rendered, rounded number is the wrong question.

---

### C→H 10d gains a dollar leg + dual sort (v624, Jul 25 2026)

The column now renders **% over $** like the ATR ladder, with `%` and `$` as separate sort
targets via the same `thATR` helper. New DB column `c2h_10d_dollar`, returned by
`chop_range_atr_light` as `c2h10_dol`, computed in `pipeline.js`, and backfilled for
scan_date 2026-07-25.

> **The two legs are averaged INDEPENDENTLY — do not derive one from the other.** For the ATR
> columns `pct = dollar / lastClose × 100` exactly, so they are a strict ratio. C→H is not:
> each of the 10 transitions divides by a *different* prior close, so
> `mean(pct) ≠ mean(dollar) / lastClose × 100`. Both are summed separately in the same loop and
> the >100% guard voids **both** legs together (verified: injecting a +400% final bar returns
> null for pct and dollar).

Backfilled with the same PostgREST `?on_conflict=ticker,scan_date` upsert path proven in v623 —
no write-RPC created, nothing left behind. 2,407 rows.

**Verified:** pipeline reproduces the backfill on both legs (WOLF 2.34/$0.76, SMCI 4.76/$1.243,
MXL 4.98/$4.042); header reads `C→H 10d %·$` with 15×15px sub-targets; 36 header cells == 36
body cells; **both** sort targets desc-monotonic over 500 rows (% top 10.79, $ top 110.97);
displayed vs DB — pct 500/500 exact, dollar 500/500 exact.

Dollar distribution: min −$1.81, median $0.86, p90 $4.29, max $110.97. The % and $ orderings
differ sharply — sorting by $ surfaces high-priced names (SNDK $42.48 at 3.14%), sorting by %
surfaces cheap movers. That divergence is the point of having both.

> **My comparator was wrong a FOURTH time this session.** Two dollar rows flagged (WPM 1.625,
> ESTC 1.125) — both exact `.X25` boundaries where Python `round()` is half-to-even (1.62/1.12)
> and JS `toFixed()` is half-away-from-zero (1.63/1.13). **Standing rule, now stated four times
> in this file: never verify JS-rendered numbers with Python `round()`. Use explicit
> half-away-from-zero, or compare with a tolerance wider than one display ulp.**

---

### C→H 10d — close-to-next-day-high, 10-session average (v623, Jul 25 2026)

New sortable column on the Holy Grail screener, right of the ATR-derived block.
`c2h_10d_pct` = mean of `(day high − PRIOR close) / prior close × 100` over the **last 10
transitions** (needs 11 bars). Reads as: buy at the close, average % upside to the next
session's peak. Same calculation as the Daily Close To High Screener and the Multi View
Charts `Avg close→high` stat (`closeToHighPct`).

**Guarded, because a MEAN is fragile in a way ATR is not.** INHD stopped trading 2026-06-08
after a genuine 4030% final session; its raw 10-day mean was **405.85%**, which would have
made the column unsortable (delisted junk pinned to the top). Two guards:
- **Backfill:** ticker must have traded through the scan's reference session (2026-07-24).
  20 stale-listing tickers excluded. Distribution went from max 405.85 → **max 11.84**.
- **Pipeline:** any single `|transition| > 100%` voids the metric (null) rather than poisoning
  the mean. Verified by injecting a +400% final bar → returns null.

The ATR ladder deliberately has **no** equivalent guard — Wilder is far less outlier-sensitive,
and INHD's `atr_1d` of 107% is a *true* reading of that session.

**Backfill without leaving anything behind.** No write-RPC this time (see the v620 security
note). Used a PostgREST bulk upsert with `?on_conflict=ticker,scan_date` +
`Prefer: resolution=merge-duplicates`, **tested on a single row first** and confirmed it changed
only `c2h_10d_pct` and nulled nothing. Then 5 sequential chunks of 500. Note a plain
merge-duplicates POST **fails 409** without the explicit `on_conflict` target, since the unique
key is `(ticker, scan_date)` not the PK.

**Verified:** pipeline `_classifyRegime` reproduces the backfill exactly (WOLF 2.34, SMCI 4.76,
MXL 4.98, CRDO 2.80); 36 header cells == 36 body cells; desc monotonic over all 500 rows;
every displayed value checked against full-precision DB — **500/500 exact, worst delta 0.0**.

> **A WRONG DIAGNOSIS I published mid-task, corrected.** On seeing INHD's 4030% day I asserted
> that stitching Polygon *grouped* daily snapshots breaks across splits and that I had therefore
> corrupted the ATR backfill. **That was false.** Re-fetching from the *per-ticker* (properly
> split-adjusted) endpoint returned the SAME values — INHD 7d 15.66/3d 36.01/1d 107.17 vs the
> backfilled 15.63/36.01/107.17; STI and QBTZ matched exactly. Grouped and per-ticker agree, the
> ATR backfill was never corrupt, and the prepared "fix" was discarded as a no-op that would only
> have added rounding noise. **Lesson: I reached for the most alarming explanation before testing
> the cheap one. Check whether the two sources actually disagree before claiming one is broken.**

> **`DN is not defined` — the build passed and the page was dead.** I coloured negatives with
> `DN`, which is scoped to `MultiViewChartsPage`; `ViolentChopScreenerPage` uses the
> `C.red||'#ef4444'` idiom. Babel compiled it, route parity was green, and the whole page
> white-screened to "Something went wrong". Caught only by loading it. **Cross-page identifier
> reuse is invisible to every structural check in this repo — §5.1a again.**

---

### Vol Exp column — volatility expansion ratio (v622, Jul 25 2026)

`Vol Exp = 3d ATR% ÷ 14d ATR%`, sortable, sitting right of the ATR ladder. The ladder answers
"is this name's volatility expanding or settling?" but only by eye, across four columns and 500
rows. This makes that question **screenable**: >1 = short-window vol running hotter than baseline
(range expanding — hostile to a grid), <1 = compressing into a range.

Pure derivation from columns already fetched — **no DB change, no backfill, no pipeline change.**

- Uses the **%** rungs, not $, so it is price-independent and comparable across names.
- Both inputs are Wilder, so this really compares **~5-day against ~27-day effective memory**, not
  3 against 14. Still a valid short-vs-long vol ratio; just don't read the label literally.
- Colour is **directional, not good/bad**: gold ≥ 1.15 (expanding), blue ≤ 0.85 (compressing),
  dim between. The 0.85–1.15 deadband stops ordinary noise being dressed up as signal.
- **Denominator guarded**: null or ≤ 0 yields `null`, never Infinity/NaN. A NaN reaching the shared
  `bv-av` comparator silently unsorts the entire table (the v581 class) — simulated all five failure
  inputs before building.

**Verified:** 35 header cells == 35 body cells; sorted desc monotonic over all 500 rows
(2.01× → 0.94×); and every displayed ratio recomputed against **full-precision** DB values —
**496/496 correct**, 4 legitimately blank.

> **Recording a mistake I made three times this session.** My first pass reported 41 mismatches,
> because I recomputed the ratio from the **1dp displayed** 3d and 14d values while the app divides
> full-precision 2dp numbers — dividing two ±0.05-rounded small numbers propagates to ~3%. The
> residual single "mismatch" against full precision (TMUS 6.18/4 = 1.545) was Python's banker's
> rounding again: 1.54 in Python, 1.55 in JS `Math.round`. **Both traps are the same lesson —
> verify against the precision the code actually uses, and never check JS rounding with Python
> `round()`.** See also the v620 audit note.

---

### v621 — housekeeping: freshness weekday guard, tap targets, stray file (Jul 25 2026)

**1. Integrity freshness check FAILed every weekend (REAL, fixed).** `data_integrity_check` decided
whether a session was live purely from the ET clock hour — no day-of-week test anywhere. The
after-market scanner is `*/3 20-23 * * 1-5` (weekdays), so on a Saturday at 4–8pm ET the check saw
the clock inside the window, called the session LIVE, measured 1,322 minutes since Friday's correct
8:05pm close, and logged FAIL. Same defect on premarket. It fired every Sat and Sun — **the exact
failure §5 warns about: an alarm inside normal behaviour gets tuned out, and the real one goes with
it.**

Fixed by adding a `dow` guard to all three legs. Overnight needed care: the session for trading day
D runs D−1 20:00 → D 04:00 ET, so it is live on Sun–Thu evenings (`dow 0-4`) and Mon–Fri early
hours (`dow 1-5`) — Friday 20:00 onward is closed until Sunday 20:00.

Applied by reading `pg_get_functiondef`, doing three text substitutions, and `execute`-ing the
result, with `raise exception` if any substitution failed to match — so a silent no-op was
impossible and I never had to retype the ~6,400 characters of the function I hadn't read.

Verified both directions, because a guard that only silences is not a fix: the live check now reads
OK / "closed — expected" on all three legs, and simulating the new expressions across a full week
gives Sun 4 overnight-live hours, Mon–Thu 8/6/4, Fri 4/6/4, **Sat 0/0/0**. That is 40 overnight
live-hours/week = Sun 20:00 → Fri 04:00 ET. The `mins > 20 → FAIL` path is untouched, so the alarm
still fires on a genuine weekday stall.

> **RESIDUAL, not fixed:** market holidays still false-FAIL (~9 days/year vs the 104 weekend days
> now covered). Fixing it needs a holiday calendar, which this DB does not have. Deliberately left
> rather than half-solved.

**2. ATR ladder tap targets (v620 regression, fixed).** The `%`/`$` sub-labels were `fontSize: 7`
with `padding: '0 2px'` — about a 6×8px hit area. Usable with a mouse, not on a phone. The entire
`<th>` is now a tap target that sorts by % (the common case) and the sub-labels are `inline-block`
with real padding. Measured after the change: **th = 35×57px, subs = 15×15px** (was ~6×8).
Both paths verified: whole-header click → `7d ATR %▼·$` with % desc monotonic; `$` sub-label click
→ `7d ATR %·$▼` with $ desc monotonic.

**3. The stray `:` file is finally gone.** §12 had claimed it was already removed while it stayed
tracked. Its name literally contains newlines, so `rm -- ':'` matched nothing; removal needed
`find . -maxdepth 1 -name ':*' -print0 | xargs -0 git rm --cached` plus the same for the disk copy.

---

### Fib overlay refinements (v616–v618, Jul 25 2026) — written up from the diffs

These three shipped from a parallel session and sat undocumented for several versions. Reconstructed
from the commits, not from memory — nobody has re-verified the rendered output, so treat the
behavioural claims as read-from-code rather than observed.

- **v616** (`d4d7837`) — **label the 0% and 100% lines.** They were drawn but deliberately left
  unlabelled (v612/v613 reasoning: the anchor caption plus the high/low markers covered them). That
  was wrong for the SWING set: its 0%/100% prices are the *detected pivot* hi/lo, which differ from
  the chart's visible high/low markers, so those two prices appeared on no labelled line at all.
  `isEndpoint`/`labelled` gone; every level gets text.
- **v617** (`3b48406`) — **`drawSet` gains an `xOff` parameter.** When both toggles are on, range
  and swing can share an anchor price and their labels collided at the same y. Swing labels now
  shift right by `swXOff = bothOn ? 96 : 0` px (applied to both the level pills and the caption).
- **v618** (`fc06585`) — two fixes. (a) **Null-bar guard in `detectSwing`**: a bar with null/NaN
  h/l would pass the pivot comparisons (`null <= x` is false, so it never fails a test) and could be
  selected as an anchor carrying a null price. Now skipped, both for the candidate bar and its
  neighbours. (b) **Label de-collision on compressed legs**: a small leg on a long chart (a $16
  swing on a 10Y chart spanning $200) crushed all 7 labels into ~25px. A pre-pass walks levels
  top-to-bottom and keeps a text label only if it clears the last kept one by `MINGAP = 12`px;
  0%/100% are always kept, then key levels (38.2/50/61.8), then 23.6/78.6 are dropped first. Lines
  still draw for every level — only the text is thinned.

Note (b) partially re-introduces the label suppression that v613 removed, but on a different
criterion: v613 dropped labels by *timeframe class*, v618 drops them only on *measured pixel
collision*. That is the right axis — but it does mean a level can again appear as a bare line, the
exact symptom v613 was fixing. If "some prices aren't shown" is reported again on a long chart with
a small swing leg, this is the cause and it is by design.

---

### ATR ladder — 14d / 7d / 3d / previous day (v620, Jul 25 2026)

Three columns added beside the existing 14d, each sortable by **both** % and $ (8 sort targets).

**Method — all four rungs are Wilder, deliberately.** `pipeline.js` computes them with the same
`_atr14(adxBars, period)` on the same 40-bar window, so they are directly comparable.

> **Known, ACCEPTED tradeoff — do not "fix" this in isolation.** Wilder(N) carries an effective
> memory of ~2N−1 bars, so this is really a **27/13/5/1-day memory ladder**, not 14/7/3/1. It
> therefore *understates fresh volatility spikes* relative to a simple trailing mean. Measured:
> SMCI 3d reads **8.9% Wilder vs 12.5% simple** — the Wilder rung hides a near-doubling of
> 3-session vol. This was raised before building and Wilder was chosen to stay consistent with the
> pre-existing 14d column. Changing one rung alone would make the ladder incomparable and is worse
> than either consistent choice.

Only at period 1 do the two methods agree exactly — Wilder degenerates to the last true range,
which is precisely "previous trading day". Verified: `1d == last true range on 400/400` sampled.

**Backfill.** `chop-scan-daily` is `30 1 * * 2-6`; it had already run, so the next native fill was
3 days out. Backfilled scan_date 2026-07-25 from **Polygon grouped daily aggregates** — one call
returns every ticker for a date, so 51 trading days cost 51 calls instead of 2,500. Written via a
`SECURITY DEFINER` RPC (`atr_short_backfill`) taking a jsonb payload in ONE statement (§5.2b: one
writer, never a loop). 2,425 of 2,500 rows updated. **That RPC has since been DROPPED — see the
security note below. It no longer exists; do not look for it.**

> **SECURITY — mistake made and corrected, same session.** `atr_short_backfill` was created
> `SECURITY DEFINER` and, like every function here, EXECUTE defaulted to `anon` **and PUBLIC**. The
> anon key ships inside the public JS bundle, so for the ~40 minutes it existed, anyone who viewed
> source could have called it and overwritten every ATR column for any `scan_date` with arbitrary
> values. Dropped; verified the endpoint now returns 404 while `chop_range_atr_light` still serves
> and the data is intact. **RULE: a one-off migration/backfill RPC must be dropped in the same
> session it is used.** If a write-capable RPC ever needs to persist, `revoke execute ... from
> anon, public` is mandatory — read-only RPCs like `chop_range_atr_light` are the only safe
> things to leave anon-callable.

**Bar-alignment was calibrated, not assumed** (§5.1c). Reproduced the stored `atr_14d_pct` at three
candidate end-dates: end=2026-07-24 gave mean |err| **0.022pp** (pure 2dp rounding); end=07-23 and
07-22 were off by 1.9–4.5pp. That fixed the window before any value was written.

**The pipeline and the backfill provably agree.** Loaded the real `_atr14` out of `pipeline.js` and
ran it against the same bars: WOLF/SMCI/MXL/A matched the DB to **0.0000**, and CRDO's apparent
0.08 gap was my hardcoded test fixture being wrong — the DB holds 10.27/9.93/12.64, exactly what
the pipeline produces. So Tuesday's scan will not silently rewrite the backfilled numbers.

**Post-ship audit (same session) — two false alarms I raised, recorded so they are not re-chased.**
(1) 12 apparent value mismatches were all on `.X5` boundaries: Python's `round(14.25,1)`=14.2
(banker's, half-to-even) vs JS `toFixed(1)`="14.3". The app was right, my comparator was not — do
not verify JS rounding with Python `round()`. (2) An apparent column misalignment on rows lacking
Yahoo ratings: I measured `tr.children.length` (DOM elements) when the Fetch-ratings cell already
carries `colSpan={5}`, so 30 elements == 34 rendered columns. **Row-cell counts are NOT an alignment
test when any cell spans columns — compare `getBoundingClientRect().left` against the header's.**
Also note my first "34/34 ALIGNED" pass was right only by luck: it sampled row 0, which happens to
be a full row.

**Cross-source verification, done properly the second time.** The initial pipeline-vs-backfill check
was internal consistency wearing a cross-source costume — both sides read the SAME grouped-agg
data, so it proved the two code paths agreed, not that the numbers were right. Redone against the
**per-ticker** Polygon endpoint: worst |displayed − independent| = **0.054pp** over 14 tickers × 4
rungs (pure 1dp display rounding), plus a full displayed-vs-DB sweep of 500 rows × 4 rungs × 2
values ≈ 4,000 cells with zero real mismatches.

**Verified behaviourally** (§5.1a): replacing 1 header + 1 cell with 4 each risks column
misalignment that would shift everything to its right. Headless: **34 header cells == 34 body
cells**, ladder at indices 24–27, and all 8 sort targets desc-monotonic over 496–500 rows.
Ladder reads correctly — MXL 16.5→17.0→19.5→31.8 (expanding), FCEL 16.0→14.2→12.3→11.5 (decaying).

**~65 tickers have 14d but no 7/3/1**: Polygon's grouped endpoint omits some thin/OTC names the
per-ticker fetch does return. The next native scan fills them.

**Storage note.** Estimated ~360 KB for the 6 numeric columns; the DB actually grew 231→236 MB.
The estimate covered the payload but not MVCC churn — a full-table UPDATE rewrites every touched
row, and these rows carry ~1 KB jsonb blobs. Autovacuum reclaims it. **Budget for row rewrites,
not just new bytes, on any future backfill.**

---

### Sortable 14d ATR column — Holy Grail screener (v619, Jul 25 2026)

The `14d ATR` column was a plain non-sortable `<th>`. Making it sortable is a two-line change that
walks straight into the **v581 ON PACE trap** (§5.1a) if done naively: `atr14` is a **side map keyed
by ticker** (`atr14[r.ticker]`), while the comparator reads `a[sortKey]` off the **row object**. An
`onClick` alone would render a header with a working ▼ arrow that sorts by `undefined`.

**Fix — follow the `sector` precedent already in the file** (`rows.forEach(r => r.sector = …)`,
which carries the comment "so it's sortable + renderable"):

1. Attach `r.atrPct` / `r.atrDol` from the side map onto each row, immediately before `rows.sort`.
2. Header becomes `{th('atrPct',['14d',<br key="b"/>,'ATR'])}`.
3. **The cell now renders from `r.atrPct` / `r.atrDol`, not from `atr14[r.ticker]`** — one source,
   so the value that sorts is provably the value that displays.

**`null` vs `undefined` matters and is not cosmetic.** Missing tickers must be set to explicit
`null`. The comparator ends `return sortDesc ? bv-av : av-bv`; `bv-null` coerces to `bv-0` (blanks
sink to the bottom on desc, matching every other numeric column) but `bv-undefined` is **NaN**, and
a NaN comparator leaves the array in its original order — a header that shows a sort arrow and does
nothing. Simulated in node before building: with `undefined` the four test rows came back
`A B C D`, i.e. completely unsorted.

**Verified behaviourally, not structurally** (§5.1a): served the local build and drove it headless —
desc is monotonic across all 500 rendered rows (WOLF 20.5% → 3.8%), asc monotonic across 492 with
the 8 blanks floating to the top, arrows flip ▼/▲, and the rendered text (`"20.5% $4.74"`) matches
the value sorted on. `rows.sort()` runs **before** `rows.slice(0, showCount)`, so the sort covers
the whole filtered set (~2,500) and not just the visible 500.

**Values were audited at the same time and are correct.** Cross-checked 8 tickers against
Wilder ATR(14) computed independently from 400 days of Polygon dailies: CBRS −1.8%, MXL +0.6%,
AXTI +0.1%, WOLF +0.2%, SNDK +1.0%, SMCI +5.2%, CRDO +2.7%, RIOT +1.8%. Residuals are small and
mixed-sign — consistent with the stored value being written at the 01:30 UTC scan against the prior
close. A **simple** 14-day mean of TR is the wrong comparison and understates by up to 41% (Wilder
carries ~27-period memory, so it reads high when recent vol has cooled — that's why WOLF and SMCI
diverged most). The 12–20% readings are real; it's a chop screener.

Note the top-ATR names in the table (WOLF 20.5%) are **not** the DB maxima (AXTX 70.6%, AAOX 50.2%,
POEL 49.5%, BEX 48.2%) — those are all `ticker_type='ETF'` leveraged single-stock funds, excluded by
the page's default stocks-only type filter. Expected, pre-existing.

---

### Fibonacci overlays + last-price tag + swing fix (v609–v615, Jul 25 2026)

Two independent toggle buttons on Multi View Charts, next to VWAP, both **off by default**,
display-only (no predictive claim, no backend/data change — pure custom SVG in the MV-Charts
`Chart=function(tf,bars)` closure). State `s9f1`/`s9f2` (`showFibRange`/`showFibSwing`). Levels
`[0,.236,.382,.5,.618,.786,1]`, key levels `{.382,.5,.618}`. Two colors: **range = gold**
(`C.gold`), **swing = cyan `#22d3ee`** (see v615 note — was teal, clashed with the green up-line).

- **Fib (range)** — anchors to the chart's visible high/low (reuses the v602 `hi`/`lo`/`hiIdx`/
  `loIdx` the chart already computes). `buildFibLevels(hi,lo,hiIdx,loIdx)` puts 0% at the MOST
  RECENT extreme via `recentIsHigh = hiIdx>=loIdx`, so an up-leg retraces down from the high and a
  down-leg retraces up from the low. This math was correct throughout; only swing's anchor
  *selection* was ever broken.
- **Fib (swing)** — anchors to the most recent confirmed swing leg via the pivot method.
  `fibSwingN(tf)` sets pivot sensitivity per bar interval (10 intraday / 6 hourly 7D–30D / 5 daily
  3M–1Y / 4 weekly–monthly 5Y–10Y). Draws only when a clean leg is found (else the toggle is a
  silent no-op, by design).

**Rendering (drawSet), evolved across versions — the current v615 behaviour:**
- Each level = a full-width dashed line + a left-aligned label (`% $price`) sitting on a dark
  **background pill** (`rect fill C.bgDeep opacity .72`) so the price reads over candles. Labels are
  on the LEFT gutter (x≈`PADL+2`, textAnchor start), NOT the right edge.
- An **anchor caption** at top-left of each set names the range: `anchor $lo → $hi` (range on
  capRow 0, swing on capRow 1 when both are on, each in its own color with an `R`/`S` prefix). This
  is what makes the cross-timeframe behaviour legible: same high, different low per timeframe ⇒ same
  last price sits at a different Fib %.
- **Only 0%/100% are unlabelled** (their values are in the caption + the high/low markers). ALL
  interior levels label on EVERY timeframe (see v610/v613 history — do NOT re-add the intraday-only
  trim or the near-price-tag suppression; both made levels look like they had "no price").

**Per-version history (so a diff makes sense):**
- **v609** — first build (display-only option chosen after discussing three approaches).
- **v610** — fixed a no-op: v609's `labelled = isKey || n>60` never triggered because intraday
  charts have MORE bars than daily (bar count is inversely related to density). Was changed to a
  `dense=(tf.kind==='intraday')` gate… which v613 then removed entirely.
- **v611** — moved labels to the left edge + skipped 0%/100% + skipped labels within 11px of the
  last-price tag (to stop collisions). The near-tag skip was later found to hide whole levels.
- **v612** — added the anchor caption + the background pills; REMOVED the near-tag suppression (it
  was hiding e.g. CRDO 3M's 61.8% because it sat 7px from the price tag). Only 0%/100% + the
  intraday-key-only rule remained.
- **v613** — removed the intraday-key-only trim too. Root cause of the user's "some prices aren't
  shown": on intraday charts (TODAY/YEST/7D, `kind:'intraday'`) 23.6%/78.6% were drawn as BARE
  LINES with no label, indistinguishable from "the price is missing." Now `labelled = !isEndpoint`
  on all timeframes; pills keep them readable. **This was found only because the user repeated the
  report — I had been verifying the DAILY charts, which were already fine. Look at the exact chart
  the user is looking at.**
- **v614** — **centered the last-price tag.** It was pinned to the right edge (`x = W-PADR-58`),
  covering the newest candles (the most-watched price action). Now centered horizontally on the
  plot: `tcx = (PADL+(W-PADR))/2` (≈x454 of the 160–748 plot), clearing BOTH the recent candles on
  the right AND the Fib labels on the left (which live at x≈165–239). Vertical position unchanged
  (still on the price line at `tagY` — moving it vertically would misstate the price). Only the
  tag's x changed; `tagY` stays vertical-only and nothing else depended on the tag's x.
- **v615** — **fixed the Fib-swing anchor bug + recolored swing.** `detectSwing` was taking the
  most-recent pivot high and most-recent pivot low INDEPENDENTLY and pairing them, so when a pivot
  sat between them the "swing" straddled it and was never a single leg. Proven on live Polygon
  data: NVDA's recent pivots run H@Jun22 $213.99, L@Jun29 **$189.80**, L@Jul17 $197.97 — the old
  code paired $213.99 with $197.97, skipping the real recent bottom $189.80 and anchoring 0% to a
  minor higher-low. It looked fine on TSLA/AAPL/CRDO only because their last high and last low
  happen to be adjacent. **Fix:** collect all pivots in time order, collapse consecutive same-type
  pivots to the extreme (a run of lows keeps the lowest, a run of highs the highest) so the sequence
  strictly alternates H,L,H,L, then take the last two = the most recent COMPLETED adjacent leg.
  A bar flagged as BOTH high and low (flat/degenerate data) is assigned the role with the larger
  one-bar excursion. Verified live: NVDA 3M/YTD/1Y all now read `anchor $189.80 → $213.99`. Also
  recolored swing gold-adjacent teal `#3fb8af` → cyan `#22d3ee` (teal was ~identical to the green
  up-line `C.accent #00e5a0`). `buildFibLevels` was already correct — only anchor selection changed.
  **Open decision:** on 5Y/10Y (weekly/monthly, N=4) the detected leg is now a real leg but can be
  large/old; left visible so the toggle isn't a no-op. Suppressing swing there is a one-line change
  if wanted.

**Verification note for this session:** the app renders live Polygon/Supabase data in a headless
Chromium in the sandbox (see §5.7a), which made real visual verification possible for the first
time. Every Fib fix above was confirmed on the LIVE deploy by extracting the rendered label/caption
text and computed colors from the DOM, and by pixel analysis — not by eyeballing, because the
`view` tool's IMAGE channel returned blank all session (a tool glitch; the PNGs were valid on disk).

---

**v555** — Most Actives RTH/My Lists snapshots IEX → SIP; removed the
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
full four-session chain plus RTH outcomes (**5,672 rows, 887 tickers, 12 sessions** as of Jul 24
2026 — was 6 days; it grows as sessions land). Rebuild with `select rebuild_signal_chains();`.
Source RTH bars live in `signal_rth_bars` (~39k rows, SIP daily, trailing-20-**session**
baselines, not calendar days). Test weight sets with
`test_weights3(am_trd, am_vol, ovn_trd, ovn_vol, pm_trd, pm_vol, gap, hit_rth, top_n, min_avg)`.
Combined ~6 MB.

**IMPORTANT — the chain columns are already normalised, not raw counts.** `rth_trd`, `am_trd`,
`ovn_trd`, `pm_trd` etc. are each expressed as **% of that leg's own trailing-average** (NVDA on
an ordinary day reads ~90–105, not ~2.4M). So the hit target is simply `rth_trd >= 120` — there
is **no baseline to construct**. Building one and dividing is a real trap: doing exactly that
returned 0 hits / 5,672 against an expected ~10% base rate (the absurd result is what exposed the
error — a *plausible* wrong number would have shipped). Measured base rate on the current
12-session universe is **10.5%** (the older 12.2% figure predates the universe expansion; the
early Jul 8–10 days carry only ~233–276 rows vs ~460–630 later, so the mix shifted).

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

## 9a. Research: persistence testing (Jul 26 2026)

**Question:** does a metric measured in one period still hold in the next? A metric that fails this
ranks on noise, however confident the ranking looks. Prior results: volatility r=+0.964, mean
close→next-high +0.848, oscillation efficiency −0.046, direction −0.041.

### METHOD — always use a positive control
Both tests below included a control whose answer was already known. Without one, a broken harness
produces plausible numbers and there is no way to tell. Phase 1's control was volatility
(reproduced Spearman 0.933 vs the known 0.964 — harness sound). Phase 2's control was the stored
`composite_score` itself: window B was chosen to be exactly the window the stored scan covers, so a
correct replication had to reproduce it. It did, **r = 1.00000, median relative error 0.00%**.

### FINDING 1 — the stored chop history is ONE observation, duplicated
`cached_chop_screener` holds scan_dates 2026-07-24 and 2026-07-25. **Both cover the identical five
sessions (Jul 20–24) and carry identical scores** — r = 0.99999 across 2,403 tickers, only 121
differing at all. NVDA is 220.71 in both. A scan that runs when no new session has completed simply
re-derives the same 5-day window.
**This is a landmine:** correlating the two stored scan_dates returns r ≈ 1.0 and looks like proof of
perfect persistence. It is a number correlated with itself. Any future persistence work MUST recompute
from raw bars, or wait for genuine `metric_history` (§10 item 2). It also means the extra scan burns
Polygon calls, Actions minutes and DB writes for zero new information.

### FINDING 2 — runs-z (streak alternation) does NOT persist. Do not build the screen.
Wald–Wolfowitz z on the daily sign sequence, 4,346 liquid tickers, two non-overlapping 134-day windows:

| Metric | Pearson | Spearman |
|---|---|---|
| Volatility (control) | 0.451 | **0.933** |
| Mean abs daily move | 0.865 | 0.946 |
| **Runs z (alternation)** | **0.071** | **0.060** |
| Up-day rate | 0.457 | 0.272 |

Same signature as oscillation efficiency. A cross-sectional ranking would surface the ~5% of names
that clear |z|>1.96 by chance and rank on nothing. **The v635 streak section stays descriptive; it does
not become a screen.** (Pearson≪Spearman on volatility is outlier distortion — prefer Spearman here.)

### FINDING 3 — Chop Score DOES persist. I predicted otherwise and was wrong.
Recomputed from raw 10s bars, two non-overlapping weeks (Jul 13–17 vs Jul 20–24), 220 tickers
stratified across all ten score deciles:

| Component | Pearson | Spearman |
|---|---|---|
| **Chop Score composite** | **0.955** | **0.949** |
| pathPct (total intraday path) | 0.955 | 0.955 |
| avg swing size | 0.963 | 0.975 |
| day range % (plain volatility) | 0.930 | 0.921 |
| coef of variation (erraticness) | 0.850 | 0.834 |

Chop Score is a stable property of a name, not noise. It is safe to rank on. Every component persists,
including the erraticness term.

### FINDING 4 — but the erraticness multiplier is nearly inert
Formula is `pathPct × (1 + sdPct/avgPct)`, intended to "reward RVI-style ERRATIC violence over
metronomic chop." Within the same window:

| Comparison | Pearson | Spearman |
|---|---|---|
| Chop vs **pathPct alone** | 0.987 | **0.996** |
| Chop vs day-range % | 0.770 | 0.848 |
| Chop vs coef of variation | **−0.457** | **−0.321** |

At Spearman 0.996 against pathPct, **dropping the multiplier entirely would produce a near-identical
ranking.** Worse, the correlation with the erraticness term is *negative*: the highest-path names tend
to be more metronomic, not more erratic. The multiplier is not achieving its design intent. Either
weight it far more strongly, or drop it and rank on pathPct honestly. Note also Chop vs day-range
Spearman 0.848 — related to plain volatility but genuinely distinct, so it is not merely repackaged ATR.

### CAVEATS on Finding 3/4
- **Consecutive weeks is the most favourable horizon.** Persistence at 1 month / 3 months is untested
  and will be lower. The horizon that matters is the redeployment frequency.
- **The sample was stratified across deciles**, which widens the x-spread and inflates correlation
  relative to a random draw. The direction of the result is safe; treat 0.95 as an upper bound.
- Polygon **10-second aggregates truncate near ~7,500 bars despite `limit=50000`** and set `next_url`.
  Pagination is mandatory — another instance of §5.1b on an endpoint not previously documented for it.

---

## 10. Known open items

### Resolved Jul 24 2026
- **Most Actives median columns were blank** (MED TRADES / MED VOL / `rel_*_med`). Root cause
  and fix in §5.1d — the median columns were computed but never listed in the INSERT of
  `upsert_premarket_actives` / `upsert_aftermarket_actives`, so `excluded.med_*` wrote NULL.
  Overnight was already correct. Both fixed, ratios computed, forward-recompute extended to
  carry medians, and existing NULL rows backfilled. Verified: `count(med_trades)` now equals
  `count(avg_trades)` on the latest session of all three tables (`gap = 0`), and hand-recomputed
  ratios match stored to the decimal. **No app change was needed** — the fetch already selected
  the columns and the render already mapped them; the entire bug was database-side.
- **v592/v593 shipped** — rolling top-1/3/5 predictor accuracy box (pooled, split by capture
  label), and the noisy per-day reconstructed table was removed. `predictor_rolling` RPC added
  with anon EXECUTE. `predictor_accuracy` and `predictor_scorecard` still exist in the DB but
  nothing calls them.
- **v594–v598 — Volume & Trades Comparison on Multi View Charts** (bottom of MultiViewChartsPage,
  after the timeframe candlestick block). Three daily bar charts for the loaded ticker: trade
  count (Polygon `n`), share volume (`v`), and notional (`vw`×`v`, close-price fallback if `vw`
  missing). **No new fetch** — reuses the 10y daily series the page already pulls for
  atrMap/c2hMap; `vtRows` holds the full series (each row keeps its `t` ms timestamp) and is
  sliced at render. Self-contained SVG bar helper `vtChart` (not the candlestick `Chart()` and
  not Recharts). Progression: v594 built it (30-session view), v595 doubled the height
  (viewBox H 190→380; renders ~2× taller because width:100%/height:auto makes H the aspect
  ratio), v596 fixed mobile pinch-zoom (`touchAction` was `pan-y`, needed `pan-y pinch-zoom` —
  matching the candlestick chart; the bars have no touch-drag so restricting zoom bought
  nothing), v597 added a numbered left value axis (gridlines at 0/25/50/75/100% of peak) and
  enlarged axis text for mobile, v598 added a date-based Lookback dropdown (12m/6m/3m/1m/1w,
  default 1m) via `vtVisible()` which filters the full series by calendar window anchored to
  the most recent bar. **Latent bug fixed in v598** (§5.1a — worked that day, would break
  silently later): `setUTCMonth` overflows on day-31 dates (Mar 31 − 1mo → Mar 3, not Feb 28),
  so on any day the latest bar fell on the 29th–31st, "1 month" would have returned ~3 days;
  clamped with `setUTCDate(0)` to snap to the target month's last valid day. All verified
  against real Polygon timestamps in node — notional matched hand-computed `vw`×`v` to the
  dollar, every lookback returned the correct bar count and date span, bar widths stay
  renderable (12m ≈ 2.8px/bar, ≥1px floor). These are UI-only, backend untouched.

### Predictor live-capture cron — VERIFIED ACTIVE (Jul 24 2026)
Earlier sessions worried the live snapshot might never run, leaving the new accuracy box showing
only reconstructed data forever. **It runs.** Three active `cron.job` entries:
`predictor-snap-0915` (13:15 UTC = 09:15 ET), `predictor-snap-0925` (13:25 UTC), both
`predictor_snapshot_take(..., 20)`; and `predictor-outcomes` (21:30 UTC) `predictor_outcomes_fill()`.
First forward captures landed Jul 24 — `predictor_snapshots` now holds `premarket_0915` (20 rows)
and `premarket_0925` (20 rows) for 2026-07-24 alongside the 200 reconstructed rows.
**Two consequences for the v592 accuracy box:** (1) live labels are `premarket_0915` /
`premarket_0925`, *not* a bare `live` — the box groups by whatever labels exist, so it now renders
three blocks, and the two 09:15/09:25 captures are separate series (a 10-min-apart re-snapshot,
not duplicates). (2) Today's live rows have **no outcome until 21:30 ET tonight**, so their hit
rate reads as unresolved/em-dash until `predictor_outcomes_fill()` runs — expected, not a bug.

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
- **AI Predictor: session-combination research is parked, partially done (Jul 24 2026).**
  The original "fitted in-sample on the same 6 days" problem is now improvable — 12 sessions
  exist, enough for a train/test split (first 8 train, last 4 test). Finding that held up under
  scrutiny: **after-market + pre-market is the pair that carries the signal.** Leave-one-day-out
  over all 12 days (more trustworthy here than the single split): `am+pm` 83.3%, `pm` alone
  76.7%, `am` alone 58.3% — the combination genuinely beats its parts, so the two legs carry
  partly independent information. Overnight adds nothing on top (`am+ovn+pm` < `am+pm`) and gap
  is noise (1.11× univariate lift ≈ base rate). Fewer legs beat more — every 4-leg combo
  underperformed the 2-leg `am+pm`, echoing the plain-sum-beats-weighted result. **Caveat that
  blocks a firm ranking:** the test set is 4 days × 5 picks = 20 observations, and 65 of 98
  tested combos scored ≥90% on it, so "`am+pm` vs everything else" is solid but
  "`am+pm` vs `am+amv+gap+pm`" is not resolvable at this sample size. A random-selection baseline
  on the same test days averaged 10.4% and never exceeded 35% in 2,000 trials, so the signal
  itself is real. **Re-run at ~22 sessions.** Next build step if wanted: wire an `am+pm`
  scoring variant to run in parallel with the live predictor for a genuine forward comparison.
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

- **Fib swing on 5Y/10Y charts (v615, decision pending):** on weekly/monthly bars (N=4) the
  detected swing leg is now a *real* adjacent leg but can be large/old — a "recent swing" on a
  decade of monthly bars isn't actionable. Currently left visible so the toggle isn't a silent
  no-op. Suppressing swing on 5Y/10Y (or requiring a minimum leg magnitude / recency) is a small
  change if the user decides it's noise. Also un-actioned from this session: the Fib **range**
  overlay was never hardened — it's fine; and the Confluence page L26315 12-field extraction RPC
  is still parked (borderline-not-broken, §ordering).
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
fixed in v558. The stray `:` file was NOT actually gone — this line claimed it was while the
file stayed tracked for many versions. Really removed in v621; its name literally contained
newlines, so `rm -- ':'` silently matched nothing and only `find -maxdepth 1 -name ':*' -print0 |
xargs -0` worked.)*

---

## 11. Working style

Senior developer. Terse, often voice-to-text on mobile. Expects **empirical
verification before claiming a fix works** — test it, show the number. Root-cause
analysis over symptom patches. Push back with reasoning rather than agreeing
reflexively; if something looks wrong, say so and show why.

## 12. Sandbox tools & libraries (probed Jul 25 2026 — re-verify, versions drift)

The dev sandbox is a Linux box (`sh`, NOT bash — no `${PIPESTATUS}`, no process substitution;
write node/py scripts to `/tmp/*.js`|`.py` via heredoc). It has full network egress (curl, pip
installs, live Polygon/Alpaca/Supabase all reachable). This section is what's ACTUALLY available so
a fresh chat doesn't have to guess — but treat it as a starting point and re-probe if in doubt.

**Headless browser — render & inspect the live app.** Chromium at
`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; drive it with `playwright-core`
(`cd /home/claude/pwtest && npm install playwright-core`, already present in that dir). Full
launch/flow/verify recipe and the access code **`BT`** are in **§5.7a** — that section is the
canonical reference for UI/visual verification. Key point repeated here because it's the highest-
value tool: **the app loads real live Polygon/Supabase data in the sandbox**, so you can confirm
rendered values/colors/positions on the LIVE deploy, not just that code exists (§5.1a). Verify by
extracting DOM text + computed styles + element rects and by pixel analysis — and note the `view`
tool's IMAGE channel has been returning blank on valid PNGs (fall back to DOM/pixel extraction; the
PNG files on disk are fine).

**Viewing the page / images:** screenshots write fine to disk (`page.screenshot`); inspect them
with Pillow (installed) for pixel-level checks (color counts, region comparison) when the `view`
image channel is glitching. `convert` (ImageMagick) and `ffmpeg` are also on PATH.

**Python 3.12 — preinstalled (no install needed):** `pandas` 3.0, `numpy` 2.4, `scipy` 1.17,
`scikit-learn` 1.8, `matplotlib` 3.10, `seaborn` 0.13, `sympy` 1.14, `networkx` 3.6, `Pillow` 12.1,
`openpyxl` 3.1, `requests` 2.33, `beautifulsoup4` 4.14 + `lxml` 6.0. This covers most numeric/stat/
ML/regression, plotting, HTML-scraping, and xlsx work directly.

**Python — installable ON DEMAND (network is open; use `pip install --break-system-packages <pkg>`;
PEP 668 blocks a bare `pip install`):** confirmed working this session — `TA-Lib` (imports and
runs — the C dep resolves here, which it often doesn't elsewhere), `statsmodels` 0.14, `yfinance`
1.5. So the quant-specific stack (TA-Lib indicators, statsmodels for ARIMA/regime/HMM-adjacent work,
GARCH via `arch`, `pandas-ta`, etc.) is available with one install command — just don't ASSUME
they're preinstalled; they're not, only the core scientific stack above is.

**Node 22 / npm 10:** available. `playwright-core` in `/home/claude/pwtest`. For MV-Charts logic
checks, the reliable pattern is to copy a function out of the source `.jsx` and exercise it in node
against real Polygon data (that's how the v615 swing bug was proven) — see §5.1a / §5.7a.

**CLI present:** `git`, `curl`, `node`, `python3`, `pip`, `convert` (ImageMagick), `ffmpeg`.
**CLI ABSENT (don't reach for these):** `jq` (parse JSON in python/node instead), `sqlite3`, `psql`
(use the Supabase MCP tools for DB work — never a raw psql), `wrangler`, `gh` (deploy via the
GitHub Actions push, not CLI). The file system resets between tasks; treat `/home/claude` as scratch
and re-clone the repo each session.

**Data/APIs reachable from the sandbox** (keys in the bundle / `app_config`, see §3/§8): Polygon
(key `Nhwwc_...` is in the bundle), Alpaca via the `alpaca-proxy` worker, SEC EDGAR via
`edgar-proxy`, TipRanks via `tipranks-proxy`, and Supabase (project `haeqzegdlwryvaecanrn`) both via
REST with the hardcoded anon `SB_KEY` and via the Supabase MCP tools for admin/SQL.
