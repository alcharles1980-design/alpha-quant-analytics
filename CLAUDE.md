# Alpha Quant Analytics — Developer Handoff

**Purpose:** cold-start context for a new Claude chat. Read this first, then run the
verification block below before writing any code.

**Status at last update:** v652 · Jul 27 2026

> **This file goes stale. That is expected.** Version numbers, table lists and
> feature descriptions drift within days. Treat every specific number here as a
> *hint*, and the **Verify First** block as the source of truth. The previous
> handoff sat at v261 while the app reached v554 — 290 versions of drift — because
> it asserted facts instead of teaching verification. Don't repeat that.

---

## Contents

**Read in this order on a cold start:** §0 (new environment only) → §1 → §4/§4a → the last ~10 entries of §9 → §5.

| § | | Why you need it |
|---|---|---|
| **0** | **Bootstrap a new environment** | Clone → install → checks → build. Verified cold; the build is reproducible. |
| **1** | **Verify First** | Run before touching anything. Reconciles `git log` against §9 and states the three DB prohibitions. |
| 2 | What this app is | One paragraph of orientation. |
| 3 | Stack & deploy | Where things live, how a push reaches production. |
| **4** | **Full sweep — MANDATORY** | The 9-step version bump. Step 8 (write the §9 entry) is the one that has failed; step 9 (promote the lesson to §5) is what keeps this file finite. |
| **4a** | **Verification gate** | The 7 belief-checks. Pass these before saying anything works. |
| 5 | Failure modes | The scar tissue. 5.1 truncation · 5.1a behavioural bugs · 5.2 resource limits · 5.7a headless verification. |
| 6 | Route/menu parity | Stated as an invariant; `npm run preflight` asserts it. |
| 7 | Core cycle engine | **CRITICAL** — do not alter without reading. |
| 8 | Backend shape | Tables, crons, Edge Functions. Free plan, 512 MB hard cap. |
| **9** | **Recent work** | Newest first, v637+. One entry per version — no exceptions, or the gap check goes blind. Older entries: `docs/CHANGELOG-ARCHIVE.md`. |
| 9a | Research: persistence testing | What is forecastable and what is not. Read before any metric drives capital. |
| 10 | Known open items | What is still broken or unfinished. |
| 11 | How the user works | Terse, empirical, root-cause. |
| 9b | **Most Actives — current state** | The page under active development: tabs, feeds, what is exact vs approximate. |
| 11a | Context loss in long sessions | Why `git log` beats recollection. |
| 11b | Tooling — verify, don't assert | A wrong claim about my own capabilities, and the rule it earned. |
| 11c | **Connectors & the deploy path** | What is connected, how code reaches production, why `BUILD_TS` misleads. |
| 11d | **Making context loss harmless** | It will happen. Commit measurements when taken; keep `docs/IN-FLIGHT.md`. |
| 12 | Sandbox capabilities | Tools and libraries available. |

**Two commands do most of the checking:**

```bash
./scripts/handoff-gap-check.sh   # any version shipped without a §9 entry
npm run preflight                # version skew · route parity · duplicate definitions
```

Both have had **every alarm proven by deliberately breaking the file** — see §6. A check
that has only ever printed PASS is unproven, and one that cries wolf gets ignored; this
project has produced both within the same hour.

---

## 0. Bootstrap a brand-new environment (verified cold, Jul 27 2026)

Every step below was run against a fresh `git clone` into an empty directory.

```bash
# 1. Clone. The repo is PUBLIC — no credentials needed.
git clone https://github.com/alcharles1980-design/alpha-quant-analytics.git && cd alpha-quant-analytics

# 2. This works IMMEDIATELY, before any install — it is pure bash:
./scripts/handoff-gap-check.sh          # any version shipped without a §9 entry

# 3. node_modules is NOT committed. Install before anything else:
npm install                              # ~30s
npm run preflight                        # version skew · route parity · duplicate definitions
npm run build                            # writes dist/index.html

# 4. Headless verification, once per sandbox:
mkdir -p ~/pwtest && cd ~/pwtest && npm install playwright-core
#    then use scripts/verify-app.js — it resolves playwright from ~/pwtest automatically
```

**The build is reproducible.** A cold clone produced a `dist/index.html` **byte-identical** to the
committed one once the `BUILD_TS` stamp is normalised. If yours differs by more than the timestamp,
something is genuinely wrong.

**Where credentials live** — none are in the repo:
- **Supabase URL + anon key** are embedded in the app source (`SB_URL` / `SB_KEY`); the anon key is
  public by design and all `cached_*` tables are anon-readable.
- **Alpaca, Polygon, GitHub PAT** live in the Supabase `app_config` table, fetched by the app through
  the `get_app_client_keys` RPC. Read them with the Supabase connector, never commit them.
- **App access code:** `BT`.
- **Cloudflare / GitHub deploy** credentials are GitHub repo secrets (`CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`); deploys run through Actions, never locally. See §11c.

**What does NOT survive a new environment:** the scratch `~/pwtest` directory and every ad-hoc probe
in it. That is deliberate — the probes were throwaway, but their boilerplate was rewritten ~82 times
in one session, so it is committed as `scripts/verify-app.js` with the disciplines from §4a baked in
(`capturePayloads` for drift-free reconciliation, `sampleOverTime` because a periodic defect is
invisible to a spot check, and `clickButton` returning what it actually clicked).

---

## 1. Verify First (run before touching anything)

```bash
# Repo + true current version (build.js picks the HIGHEST app_vN.jsx)
cd <repo> && ls app_v*.jsx | sort -V | tail -1 && git log --oneline -10
```

**Reconcile the log against this document before doing anything else:**

```bash
./scripts/handoff-gap-check.sh          # committed, runnable; expands §9 heading ranges
# -> "no handoff gaps in window", or a list of versions that shipped with no §9 entry
```

The script is in the repo rather than pasted here because the obvious one-liner is
**wrong**: `comm` rejects `sort -n` ordering, and §9 headings use en-dash ranges
(`### v648–v650`) that a naive `grep -oE '^### v[0-9]+'` truncates to the first
version, so it reported 26 gaps where only 2 existed. A check that cries wolf gets
ignored (§5.6), so it was calibrated against real data until it read clean.
**Every version needs its own `### vNNN` heading** for the check to stay honest —
folding one version into another entry's prose makes it invisible.

> **`git log` is the source of truth for what shipped — not recollection, and not
> this file.** Long sessions lose context: three versions were once committed from
> a sandbox whose session had no memory of the work, and the assistant reported
> being unable to account for its own commits (§11a). Two rules follow:
> 1. **A version in the log and absent from §9 is a gap to fill**, using the
>    commit message, before starting new work.
> 2. **Read `docs/IN-FLIGHT.md`** — anything mid-investigation, with the measurements already
>    taken. Trust `git log` over it if they disagree.
> 3. **Before "discovering" a bug, check it is not already fixed.** The highest
>    `app_vN.jsx` and the last few commit messages answer that in seconds. The
>    same defect was once diagnosed twice, an hour apart, for exactly this reason.

```sql
-- Supabase project haeqzegdlwryvaecanrn ("oscillation-analytics")
select pg_size_pretty(pg_database_size(current_database())) as db_size,
       round(100.0*pg_database_size(current_database())/(512*1024*1024),1) as pct_of_cap;
select jobid, schedule, active, jobname from cron.job order by jobid;
```

```sql
-- Unread alarms. data_integrity_check() and ladder_integrity_check() write here
-- hourly and NOTHING notifies — so they only get seen if you look. They were
-- firing unread for days before anyone did (§10).
select check_name, severity, count(*) n, max(checked_at) latest,
       (array_agg(detail order by checked_at desc))[1] as newest
from integrity_log
where checked_at > now() - interval '48 hours' and severity in ('WARN','FAIL')
group by check_name, severity order by severity, n desc;
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
5. **`npm run preflight`** — version consistency (app_vN vs the `build.js` banner
   vs `package.json`), route/menu parity, and scope-aware duplicate definitions.
   All three alarms are proven to fire (§6).
6. **Pass the verification gate in §4a before believing it works.**
7. Push with a commit message explaining *why*, not just what
8. **Write the §9 entry for this version IN THE SAME PASS.** Not "later", not a
   separate docs commit that may never come.
9. **Promote any durable lesson out of §9 and into §5.** If the entry contains
   something that will apply again — a trap, a wrong instrument, an API quirk, a
   verification technique — it belongs in §5 with a one-line pointer left in §9.

> **Step 8 is not paperwork — it is the step that failed.** v644, v645 and v651
> all shipped correctly, were verified, and had **zero mentions** in this document
> because nothing in this list required an entry. Two of them fixed user-reported
> bugs. When the session that wrote them lost context, the commit messages were
> the only surviving record and the entries had to be reconstructed from them
> (§11a). A version that ships without an entry here is a version the next session
> cannot see.
>
> **Step 9 is what keeps this file finite.** §9 entries mix two things: *what
> changed in vN*, which is disposable once superseded, and *lessons*, which are
> not. Because lessons were only ever written into §9 and never promoted, the
> whole log had to be retained in case something valuable was buried in it — and
> §9 grew to **58% of the file**. Promote the lesson and the entry becomes safely
> archivable. **If a lesson is not worth adding to §5, it is not worth a
> cold-start session reading it.**
>
> Two consequences, both worth internalising:
> - **Commit messages must be self-sufficient**, because they are the backstop
>   when everything else is gone. Write them as full write-ups.
> - **A docs commit deferred is a docs commit lost.** If the entry cannot be
>   written yet, the version is not finished.

---

## 4a. Verification gate — pass this before saying it works

Structural checks (it built, routes match, the field is present) say **nothing**
about behaviour. §5.1a exists because that mistake shipped four times. Before
claiming a change works:

1. **Trace one real value end to end** — source → fetch → mapping → rendered
   cell — and confirm the number on screen equals one computed independently.
   Prefer a **different implementation** (a Python recompute, the app's own
   existing function) over re-running your own logic, which only proves it agrees
   with itself.
2. **Give every probe a positive control.** A probe returning zero proves nothing
   until it has reported something you already know is there. Census tags and
   colours and print the table; never ask a yes/no question of one hard-coded
   selector. Resolve colours from `C.*` in source — never hand-copy a hex.
   *(Cost so far: two full cycles on the VWAP bug, then again on the Fib swing.)*
3. **Explain every failing assertion before dismissing it.** A failure is either
   a real defect or a broken probe, and you do not know which until you look.
   *(v638: four "failures" were my own regex — `textContent` concatenates without
   spaces. v652: the "failure" was real and the scan was fine — my instrument was
   wrong.)*
4. **Check you are using the right instrument.** Before declaring a data fault,
   prove the comparison. *(Minute bars exclude odd lots and missed a median 37.5%
   of overnight trades; the scan they appeared to contradict was exactly right.)*
5. **"Populated" is not "legible".** Read the rendered output as a human would.
   *(v646 rendered `315.29×4025s` — price, size 402, age 5s — fully populated,
   updating, and unreadable.)*
6. **Verify under non-default settings.** A defect or a guard can be invisible
   until a filter changes. *(Stale-quote dimming fired 0 times under the default
   filters and 52 times with them cleared.)*
7. **Count every call site before fixing any of them**, and after an anchored
   edit walk back to the enclosing `function ...Page(` to confirm where you
   landed. A duplicate-definition grep hit inside the **same** component is a real
   collision; across different components it is not.

---

## 5. Learnings, mistakes and recurring failure modes

Every entry below cost real debugging time or broke production. They are grouped by
failure *class*, because the specific bug recurs in new forms but the class stays the
same. **The unifying theme: almost every serious bug here was SILENT** — no error, no
exception, correct-looking UI, wrong data underneath. Assume silence is the danger.

### 5.1 Silent data truncation (the #1 recurring class)

- **PostgREST 1,000-row cap.** The cap is 1,000 and it does *not* error — it just
  returns the first 1,000. `optimal_tp_hourly` had 38,400 rows for one ticker; a
  naive fetch got 1,000, so Correlation Finder ran on **10 data points instead of
  379** and reported correlations of ±1.000 (meaningless at n=10).
  **Fix: `Range` headers — NOT `&limit=`. See §5.1b for the evidence.**
- **`limit=10000` breaks naive pagination.** It silently returns 1,000; the loop
  then sees `1000 < 10000`, concludes "last partial page", and stops. You lose
  everything past row 1,000 *while believing you paginated*. Page with `Range`
  windows and continue until a **short page** returns.
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

### 5.1b The truncation traps — all return HTTP 200

Four distinct traps, three of them hit in a single session. Each produces plausible output with missing data.

| Source | Real cap | Does `limit=` raise it? | The actual fix | How to detect |
|---|---|---|---|---|
| PostgREST **REST read** | **1,000 rows** | **NO** | `Range-Unit: items` + `Range: 0-999`, `1000-1999`, … until a short page | `content-range` total vs delivered |
| PostgREST **RPC** | **1,000 rows** | **NO** | must be bounded **inside the function** | `content-range` total vs delivered |
| Alpaca bars | **~2,000 rows** (not the 10,000 `limit` accepts) | no — send fewer symbols | chunk symbols; follow `next_page_token` | `next_page_token is null` |
| Alpaca 10-sec aggs | **~7,500 bars** (despite `limit=50000`) | no | follow `next_url` | `next_url is null` |

> **`&limit=N` DOES NOT RAISE THE POSTGREST CAP — NOT FOR RPC AND NOT FOR PLAIN READS.**
> An earlier version of this section said to add `&limit=N` for REST reads. **That advice
> is wrong and it cost weeks.** Re-verified on live data (Jul 27 2026, `overnight_actives`,
> 1,618 rows):
>
> ```
> &limit=2000   -> 1000 delivered,  content-range: 0-999/1618   (618 silently dropped)
> &limit=10000  -> 1000 delivered
> Range: 0-999  -> 1000    Range: 1000-1999 -> 618              (1,618 complete)
> ```
>
> The server reports the truth only in the `content-range` header. There is no error.

**REST reads:** paginate with `Range` headers in 1,000-row windows until a short page
returns; cap the loop (say 10 pages). **RPC:** nothing lifts it from the client — `?limit=`
and `Range:` are both ignored (`content-range: 0-999/1305` observed) — so the bound must be
enforced *inside* the function: filter to rows the caller can actually use, return zero rows
early when a global gate fails rather than emitting 1,300 nulls, `order by` significance,
`limit ~900` for headroom.

**Cheap escape hatch for one-off reads:** aggregate server-side so the answer is a single
row — `select count(*), string_agg(ticker, ',' order by ticker)` — which sidesteps the cap
entirely and is how the 2,408-name chop universe is pulled for analysis.

Alpaca practical limits at 5-min bars: **~30 tickers per request, ~20 for RTH**. A
60-ticker overnight request succeeds only because BOATS is a thin tape — never generalise
from the easiest case.

**Universal rule: after any bulk fetch, verify DELIVERED == EXPECTED before consuming.** A
count that merely looks reasonable is not evidence.

### 5.1e Alpaca bars: `end` is INCLUSIVE, and bar `n` differs by venue (Jul 27 2026)

**`end` is inclusive on `/v2/stocks/bars`.** Requesting `start=07:52Z&end=08:02Z` returns bars
at 08:00, 08:01 **and 08:02** — three, where a half-open `[start, end)` reading expects two.
Any comparison built on the half-open assumption over-counts by one bar. The live sweep is
unaffected because it passes **`start` only** and filters by minute index client-side; keep it
that way.

**Bar `n` includes odd lots on SIP but NOT on BOATS.** This is a venue difference, measured, and
it dictates which source each session tab must use:

| feed | bar `n` vs raw tape | so counts come from |
|---|---|---|
| SIP (pre-market) | **+0.00% median** across 8 symbols, exact on 5 of 8, worst −0.93% — despite 68–94% odd-lot share | 1-minute **bars** (cheap) |
| BOATS (overnight) | **misses a median 37.5%**, p90 100% (COIN: 99 on the tape, 0 in bars) | the raw **tape** (ring buffer) |

The SIP tape is not a viable alternative anyway — 8 symbols over 15 minutes returned 80,650
trades across 9 pages and 8.2 MB, so a full universe would be gigabytes per sweep.

**Both of these were nearly mis-diagnosed as an app bug.** A first comparison reported SIP bars
running 13% under the tape and then 200% *over* it — impossible for one window, and the cause was
entirely in the instrument: a moving `nowMin` anchor between runs plus the inclusive `end`. Fixed
absolute timestamps and a corrected boundary gave +0.00%. **§5.1c again: prove the comparison
before declaring a data fault.**

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

### 5.3a Trading days are not calendar days — `date - 1` is a bug

**This has now bitten twice, in two different layers**, which is why it lives here and not only in
a changelog entry.

- **v632 (app):** MV Charts' TODAY/YESTERDAY panels selected by calendar date, so on Mondays and
  after holidays they requested a non-session day, Polygon returned empty, and the chart silently
  drew nothing. It was misdiagnosed as a VWAP bug for weeks.
- **Jul 27 2026 (database):** `shortlist_signal()` joined the after-market leg with
  `a.session_date = d.dt - 1`. On a Monday that is Sunday, which has no after-market session, and
  because it fed an **INNER JOIN** the entire result collapsed to **zero rows** — the AI Predictor
  tab was simply empty every Monday and after every holiday, roughly 20% of sessions. The data was
  never missing: after-market had 2,613 rows on the Friday and pre-market had 1,448 that morning.

**The rule:** to step back one session, take the most recent date that **actually exists** in the
session table, strictly before the anchor — never the anchor minus one day.

```sql
-- WRONG: assumes yesterday was a trading day
join aftermarket_actives a on a.session_date = d.dt - 1
-- RIGHT: most recent completed session before the anchor, with a staleness bound
am as (select max(session_date) adt from aftermarket_actives
        where session_date < (select dt from d)
          and session_date >= (select dt from d) - 7)
```

Bound the lookback (7 days above) so a genuinely stale scan cannot be silently paired with fresh
data — without it, a broken upstream job degrades into wrong answers instead of no answers.

**Two things make this class hard to see.** It fails on a *schedule* rather than randomly, so it
looks fine every day you happen to check mid-week. And an inner join turns it into an empty result
rather than a wrong one, which reads as "no data yet" instead of "bug". **Prefer a left join plus an
explicit leg-count when a leg is genuinely optional.**

### 5.1f Alpaca live-data capabilities, measured (Jul 27 2026)

Mapped while investigating trade-count accuracy. Kept because it answers "what can this account
actually do" without re-probing.

| feed | REST | stream | notes |
|---|---|---|---|
| `sip` | real-time | `wss://…/v2/sip` | consolidated tape |
| `boats` | real-time | `wss://…/**v1beta1**/boats` | overnight ATS — **v2 returns 404** |
| `overnight` | real-time | `…/v1beta1/overnight` | |
| `delayed_sip` | 15-min | `…/v2/delayed_sip` | |
| `iex` | real-time | `…/v2/iex` | **quotes come back one-sided (`ap:0`) outside its own hours — unusable for spread** |
| `otc` | **403** | — | "subscription does not permit querying OTC data" |

**Streaming limits — the ones that shape any design:**
- **ONE connection per account PER FEED.** A second on the same feed gets `406 connection limit
  exceeded`. It is *per feed*, verified: `sip`, `iex`, `delayed_sip`, `boats` and `overnight` were
  held open simultaneously.
- **The TRADING stream (`wss://paper-api.alpaca.markets/stream`) is a SEPARATE pool** — held at the
  same time as market-data `sip`, both authorised. mbot's order feed does not compete with market data.
- **The wildcard `trades:['*']` is accepted** — the entire tape, no per-symbol subscription. 1,338
  explicit symbols also subscribe fine.
- Every AlphaQuant browser authenticates with the **same** `app_config` credentials, so a
  browser-side stream would serve exactly one tab, for one user, and 406 everyone else.

**`/v2/stocks/bars` `end` is INCLUSIVE** — `start=07:52Z&end=08:02Z` returns bars at 08:00, 08:01
**and** 08:02. See §5.1e.

**Endpoints worth knowing:** `/v2/stocks/auctions` (opening/closing prints),
`/v1beta1/screener/stocks/movers`, `/v2/stocks/meta/conditions/trade` (official condition-code
definitions — better than hardcoding `I` for odd lot), `/v2/stocks/meta/exchanges`.

### 5.1g DECIDED: SIP-session trade counts stay bar-derived and slightly low

**Known, accepted, do not "fix" without asking.** The TRADES 1m/5m/15m columns on **pre-market and
RTH** come from SIP 1-minute bars, which settle slowly — against the raw tape they run ~19% low at 2
minutes old, ~9–11% at 5–20 minutes, and only converge at 40–90 minutes. The shortfall is **not
uniform**: in one after-market sample NVDA and TSLA were exact while PLTR showed 35 against 90 actual
(−61%), so *ordering* between mid-tier names can be wrong, not just magnitudes.

**Overnight is NOT affected** — it counts the raw tape via the v652 ring buffer and matched an
independent recount 60/60 exactly. Quotes, spread and last trade are real-time on **every** tab
(~1–2s); only the count columns are involved.

Two alternatives were built or costed and **rejected on 27 Jul 2026**:
- Raw SIP tape per sweep — infeasible: 8 symbols over 15 minutes returned 80,650 trades and 8.2 MB,
  so a full universe is gigabytes per sweep.
- A Durable Object stream relay — written and logic-tested (`trade-relay-worker.js`, **parked, never
  deployed**), rejected as not worth an always-on component and a new failure surface for this
  margin of error.

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
non-divider key needs a matching `page==='key'` branch.

**State the invariant, never a count.** This section used to read "expected 85 nav
items"; the real number is now 86 and drifts every time a page is added, so a
stale figure makes a future session think something broke — or worse, "fix" it to
match. The invariant is: **zero nav keys without a route, and orphan routes
exactly `cheatsheet` + `glanceapi`.** `npm run preflight` asserts precisely that.

**The three preflight alarms are proven, not assumed** — each was fired by
deliberately breaking the file, then repaired and re-verified clean (§5.6):
- version skew: banner set to v651 against `app_v652.jsx` → caught
- routing: injected a `ghostpage` menu key with no branch → caught
- duplicates: injected a second `smaSeries` 1,000 lines away in the same
  component → caught at both line numbers; the same name across *different*
  components correctly stays silent

The duplicate check uses **babel scope resolution, not grep**. A grep version
reported 16 collisions of which 0 were real (it cannot see IIFE boundaries), and
a first babel draft using `constantViolations` reported 15 phantoms *and missed a
real duplicate* — found only because the alarm was tested. It now counts
function-valued declarators per resolved scope, `var` against the function parent
and `let`/`const` against the block.

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

**Current: v643** (Jul 27 2026) — **live BOATS bid/ask + sizes on the Most Actives overnight tab**
(v643). Before that, MV Charts gained three stacked distributions — Close → Next High (v641, MFE
warning block removed in v642), Daily True Range (v640), Daily Return (v637) — plus the Moving Average
Structure card (v639), current streak state (v638), Fib swing scaled to visible range (v636), and the
Daily Returns & Red/Green Day Counts block (v634–v635). TODAY/YESTERDAY select by trading day (v632,
which resolved the long-open "VWAP draws nothing" report) and print the real session date (v633).
**See §9a for persistence results.**

> **Cross-reference entries by VERSION, never by position.** "the entry above/below" breaks the moment §9 is reordered or an entry is archived — which is exactly what happened to the v641/v642 pair when this section was sorted into descending order.

### v653–v654 — Most Actives: live columns on the PRE-MARKET tab (Jul 27 2026)

BID / SPREAD / ASK / LAST TRADE / TRADES 1M-5M-15M now render on **pre-market** as well as
overnight, each from the venue that IS that session's book. Verified live at 04:20 ET with
pre-market in session: 79 rows, all 7 columns populated, all requests `feed=sip`, nesting
invariant held on 79/79.

**FEED CHOICE, measured with pre-market live — not assumed:**

| feed | quote age | verdict |
|---|---|---|
| `sip` | **1.8–7.8s** | live, two-sided, no 403 |
| `boats` | 921s | froze at 04:00; residual book is nonsense (AAPL 333.75 / **383.82**) |
| `iex` | 2.5 days | `ap:0` — one-sided, infinite spread |

**Reusing BOATS on pre-market would have rendered a ~15% spread on AAPL.** The standing
"SIP 403s for today's data" rule applies to historical **bar** requests, not to
latest-quote/trade or the intraday tape — both verified serving today's data.

**THE COUNT SOURCE MUST DIFFER BY FEED, and this is the subtle part:**
- **BOATS 1-min bars EXCLUDE odd lots** — missed a median 37.5% of overnight trades
  (COIN: 99 on the tape, 0 in bars), so overnight counts the **raw tape** (§v652).
- **SIP 1-min bars INCLUDE odd lots.** Verified per-minute, like for like: 24/24, 78/78,
  88/88, 77/77, 49/49 — **exact**, on names whose flow was 66–89% odd lots. So pre-market
  counts from **bars**, which is both cheap and exact.
- The SIP tape is infeasible anyway: 8 symbols over 15 minutes returned 80,650 trades across
  9 pages and 8.2 MB.

Full 1,246-name pre-market sweep using bars: **9 requests, ~583 KB**. Window semantics are
identical on both paths (complete minutes only), so the columns mean the same thing on either
tab. The per-minute buffer is dropped on feed change, so overnight counts can never be summed
into a pre-market row.

**NEW API TRAP — `end=` is INCLUSIVE for bars and EXCLUSIVE for trades.** Comparing the two
over the same nominal window makes bars look 16% high, or (with an unsettled newest bar) 6–33%
low. Both are artifacts of the comparison, not the data. Compare **per minute**, never by
summing a range. This is §5.1c again: prove the comparison before declaring a fault.

**v654 — clicking the ALREADY-ACTIVE tab blanked the table.** The handler ran
`setSession(s); setActives(null)` unconditionally, so clicking the current tab cleared the rows
while leaving `session` unchanged — the loader effect's dependency array never fired and nothing
refetched. Measured 79 rows → 0 rows, 0 headers, no error, no recovery. It survived because every
test switched *between* tabs; and Most Actives defaults to whichever session is live, so **the
most likely tab for a user to click is exactly the one that broke.** Now a no-op when already
selected. Verified: 80 rows after clicking.

---

### v663 — Most Traded Now: LAST trade price column (Jul 28 2026)

Final column: the most recent **print** on whichever venue is open, from `trades/latest` on the
tab's current feed.

**Fetched for the whole pool, not the displayed 100.** The column is sortable, and pricing only the
visible rows would silently mean *"highest price among the top 100 by trades"* — the same trap v662
fixed for the window columns. Costs ~3 extra requests per 60s refresh, chunked at 500 like the bars.

**A real print, not the bar close.** The rest of the tab is complete-minutes-only and bar-derived; a
price is the one figure where the last *aggregate* is a poor substitute for the last *trade*. It dims
past `QUOTE_STALE_S`, because on a thin overnight name the last print is often hours old and a bright
price would imply it is current. Uses `fmtQuotePx`, so sub-dollar names keep 4 decimals (v651).

The fetch is wrapped so a price failure cannot lose the ranking — the column blanks, the leaderboard
survives.

---

### v662 — Most Traded Now: every column sortable (Jul 28 2026)

Click any header to sort, click again to reverse; active column marked gold with a direction arrow.

**Sorting runs over the FULL result set, not the displayed 100.** The fetch previously sliced to the
top 100 by 60-minute before storing, so sorting within that slice would have made "top by 1 minute"
actually mean *"top by 1 minute among the top 100 by 60 minutes"* — a different and wrong question
that would have looked entirely plausible on screen. All ~600 active names are now held in state and
the slice happens **after** the sort. That is why this needed more than an `onClick`.

**A window column sorts by whichever quantity is on top.** Each cell shows both, and the rank toggle
decides which leads, so the sort resolves to the same one — clicking 15 MIN while ranking by shares
sorts by shares. Sorting by a number the user cannot see would be indefensible.

**Nulls sort last in both directions** — a missing value is not "smallest", and a name with no session
row should not lead an ascending sort ahead of names that genuinely traded once.

Values live on the row objects (`t60`/`v60`/`sessT`/`sessV`/`avgSize`), so the comparator can read
them — the v581 failure was a header that *looked* sortable while its values sat only in a side map.

---

### v661 — Most Traded Now: session totals + auto-refresh countdown (Jul 28 2026)

**SESSION column** — cumulative trades and shares for **whichever session is currently open**. It
means something different at 02:00 than at 14:00, so the header line names which one is in force
(`session totals: overnight`). **No extra request:** the candidate-pool query already hits the
session's actives table, so it now selects `trades, volume` alongside `ticker`. On RTH there is no
scan table, but the most-actives screener returns `trade_count` and `volume`, so it is not a special
case. Like the window columns, it follows the rank toggle — the selected quantity on top.

**Auto-refresh countdown** beside the toggle, turning gold in the last five seconds and reading
"now" while a fetch is in flight rather than sitting at "0s", which looks stalled.

**`RefreshCountdown` is a separate component on purpose.** Ticking once a second inside
`MostActivesPage` would re-render a 100+ row table every second for the sake of one number; owning
its own interval confines the re-render to the countdown. Same pattern as the existing `LiveClock`.

`nextRefreshAt` is set **both when an interval is scheduled and after each fire**, in all three
pollers, because the cadence differs per tab — 30s RTH, 90s pre/after-market, 180s overnight, 60s
Most Traded Now, 90s AI Predictor. Setting it only at schedule time would leave the countdown
frozen after the first fire.

---

### v660 — Most Traded Now: shares as well as trades (Jul 27 2026)

v659 showed **trade counts** only (bar `n`). Every cell now carries **both** quantities — trades and
**share volume** (bar `v`) — plus an **AVG SIZE** column (shares per trade over 60 minutes) and a
**Rank by: Trades | Shares** toggle.

**No extra request.** `v` was already in every bar payload and was simply being discarded.

**Why both matter rather than one being a proxy for the other:** 400 trades of 10 shares and 40 trades
of 100 shares move identical volume but are completely different flow, and a grid cares which. AVG
SIZE makes the distinction visible without arithmetic. Whichever quantity drives the ranking is
rendered bright and first, with the other beneath it, so the column ordering the list is the one the
eye lands on.

`ltRank` is declared **before** the fetch that reads it and is in that effect's dependency array —
`var` hoists but its value does not, which is exactly what broke v584.

---

### v659 — Most Actives: ⚡ Most Traded Now tab (Jul 27 2026)

A live leaderboard of what is trading heaviest right now, ranked by **trades in the last 60 complete
minutes**, with 30 / 15 / 3 / 1-minute columns beside it.

**The feed follows the CLOCK, not the tab.** BOATS between 20:00–04:00 ET, the consolidated tape
otherwise, because "right now" means whichever venue is actually open. Found the hard way: a first
scan at 23:53 ET returned **zero bars** on `sip` because every SIP session had closed hours earlier.

**Candidate pool** is the live session's own actives table (already activity-screened), pulled with
**Range-header pagination** — `&limit=N` does not lift the PostgREST cap (§5.1b). During RTH there is
no scan table, so Alpaca's most-actives screener is the pool instead.

**`ltSessionDate()` handles the overnight date roll.** The BOATS session beginning 20:00 ET is stamped
the **following** calendar date (§5.1c), so between 20:00 and midnight the correct `session_date` is
tomorrow's. A naive "today in ET" returns an empty pool and the tab silently shows nothing — the same
shape as the `shortlist_signal` `dt-1` bug. Verified across all four session windows.

**Why bar-derived counts are acceptable here, measured rather than assumed.** BOATS bars exclude odd
lots, so thin names undercount — but a *ranking* is driven by the heaviest names, and there bars match
the raw tape exactly. Over the same 15-minute window:

```
rank by BARS : SOXL KORU SOXS DRAM SKHY MU SNDK NVDA
rank by TAPE : SOXL KORU SOXS DRAM SKHY MU SNDK NVDA
13/15 identical positions · 1 pairwise inversion out of 105
SOXL/KORU/SOXS/DRAM/MU all 0% missed; the gaps are COIN (0 vs 77) and AMD (42%), both far down
```

**Cost measured before building** (§5.2): 3,135 symbols over 60 minutes = **7 requests, 506 KB, 0.9s**.
Pagination tokens are followed, and a failed page or a hit pagination guard sets `truncated`, which
renders an explicit warning rather than a quietly short ranking.

**`isPanelTab`** replaces eleven separate `session!=='shortlist'` render gates. A tab that renders its
own panel now flips one flag instead of requiring someone to find all eleven and miss one — the
"fixed two of three call sites" failure in §5.1a.

Complete minutes only, refreshed every 60s while auto-refresh is on.

---

### v658 — Most Actives: ON PACE now shows how much to trust itself (Jul 27 2026)

`data_integrity_check()` had been warning **hourly, unread**, that the after-market pace curve has a
wide cross-ticker spread and its projection is unreliable — while the app rendered ON PACE there
identically to every other tab. Unlike the §5.1g count shortfall, this is a number that can be plainly
**wrong**, not merely low.

**The RPC was already returning the answer and the app was discarding it.** `session_pace_ratio`
returns `curve_spread`, `pct_complete` and `mins_elapsed`; the app read only `pace_ratio` and
`pace_ratio_med`. No new query was needed — just stop throwing the signal away.

**The measure.** ON PACE is `trades / pct_complete`, so its error is driven by how much
`pct_complete` varies **across tickers** at this point in the session — exactly what `curve_spread`
records. The honest statement of that is how wide the projection could be:

```
band = (pct + spread/2) / (pct − spread/2)
```

a ratio rather than an absolute, so it is comparable across session types and needs no per-session
hardcoding. Bands: **≥2.5x low confidence** (greyed, `·?` marker), 1.8–2.5x moderate (dimmed), below
that unmarked. Calibrated from the live curves, not guessed.

**Why a blanket "suppress ON PACE on after-market" rule would have been wrong** — the same tab is
*moderate* at the open and *solid* by the close, and only unreliable in the middle:

| session | min | pct | spread | band | |
|---|---|---|---|---|---|
| after-market | 0 | 11.9 | 10.0 | 2.45x | moderate |
| after-market | 25 | 29.1 | 40.1 | **5.43x** | low confidence |
| after-market | 50 | 41.8 | 46.7 | **3.53x** | low confidence |
| after-market | 120 | 76.9 | 28.1 | 1.45x | solid |
| after-market | 235 | 99.0 | 0.0 | 1.00x | solid |
| RTH | 75 | 33.0 | 16.3 | 1.66x | solid |

After-market peaks around 50 minutes in — roughly 16:50 ET, when earnings reactions dominate. A name
reporting at 16:05 does most of its volume immediately while a quiet name trickles, so dispersion is
structural, **not a calibration fault**. RTH never exceeds 1.66x and is therefore never marked.

Both ON PACE columns render through one shared `paceCell`, so the marking cannot drift between them.
Degenerate inputs (spread ≥ 2×pct, pct ≤ 0) yield `Infinity` and **fail safe to low confidence**.
The tooltip states the elapsed minutes, the assumed % complete, the observed spread and the band.

---

### v657 — Most Actives: live book columns on the AFTER-MARKET tab (Jul 27 2026)

Completes the set — BID / SPREAD / ASK / LAST TRADE / TRADES 1M-5M-15M now render on **all four**
session tabs. One-line change, the plumbing having been generalised in v653:

```js
LIVE_FEED = {overnight:'boats', premarket:'sip', rth:'sip', aftermarket:'sip'}
```

**Held back until it could be measured, not assumed.** After-market was deliberately left off in v653
and v655 because its feed behaviour was an inference until observed during an actual 16:00–20:00 ET
window — this project has been bitten before by generalising a feed from the easiest case (BOATS row
caps, IEX one-sided quotes). Measured live at 18:30 ET:

| feed | age | verdict |
|---|---|---|
| `sip` | **0.9s**, two-sided | correct source |
| `boats` | 52,242s | overnight session long closed — must not be reused |
| `iex` | one-sided (`ap:0`) | unusable for spread, as always |

`aftermarket_actives` held 2,680 rows for the session. Counts take SIP bars via
`countsFromTape = (session==='overnight')`, so the **§5.1g** shortfall applies here exactly as it does
to pre-market and RTH — accepted, not a defect.

---

### v656 — Most Actives: the table reload was wiping the live columns (Jul 27 2026)

**User-reported:** "columns not populating in pre-market, RTH nothing loading". Both real.

**The bug.** The 20s live sweep patches its seven fields onto the row objects. The TABLE RELOAD then
rebuilds `actives` wholesale from the scan (Supabase) or the screener (Alpaca), **neither of which
knows anything about the live book** — so every reload dropped all seven columns until the next sweep
landed. Reload cadences are **RTH 30s · pre/after-market 90s · overnight 180s** against a 20s sweep,
so RTH sat empty for up to two thirds of every cycle.

**Why it survived four separate verification runs.** Overnight reloads at 180s, so it was blank only
~11% of the time and every earlier check happened to sample while populated. It was obvious on RTH
only because the 30s reload makes the blank window the majority of the cycle. **A defect on a FIXED
CADENCE is invisible to spot checks** — one sample tells you nothing about a periodic fault. This is
the same shape as the v584 hoisting bug and belongs with it in §5.1a.

**Verification that actually proves it, and the pattern to reuse:** sample the column every 5s across
several reload boundaries, and log when the reloads fire, so "populated" and "a reload happened" can
be seen together. Post-fix: `bidFilled=64` at every sample from t=51s to t=161s while screener
reloads fired at t=56, 85, 115, 145s. The single blank at t=46s is the initial tab-switch gap before
the first sweep lands (~5s), not the reload bug.

*Residual, accepted:* switching tabs shows the live columns empty for a few seconds until the first
sweep completes. Could be smoothed by carrying prior values across a tab switch; not worth it yet.

---

### v655 — Most Actives: live book columns on the RTH tab (Jul 27 2026)

BID / SPREAD / ASK / LAST TRADE / TRADES 1M-5M-15M now render on Regular Trading Hours as well as
overnight and pre-market. **One-line change**, because v653 had already generalised the plumbing:

```js
LIVE_FEED = {overnight:'boats', premarket:'sip', rth:'sip'}
```

Everything follows from it — the column gate is `!!liveFeed`, and the count source is
`countsFromTape = (session==='overnight')`, so RTH automatically takes SIP bars.

RTH needed no other work: its rows come from Alpaca's most-actives screener rather than Supabase but
carry `.symbol` exactly like the Supabase path, which is all the quote merge needs; it is ~100 names
so the sweep is a single chunk; and although RTH already calls `/v2/stocks/snapshots?feed=sip` for
price it never displayed bid/ask, so there is no collision. Price now additionally refreshes on the
20s live cadence rather than only the 180s reload.

**After-market deliberately left off** — it would also be `'sip'`, but that was an assumption until
measured during an actual 4–8pm ET window, and this project has been bitten before by generalising a
feed's behaviour from the easiest case (BOATS row caps, IEX one-sided quotes).

Verified on live: all seven columns present, 64 rows all with a book, **BID reconciled to the
captured payload 64/64**, all requests `feed=sip`. Note the book shown at the time was after-market's,
because RTH had closed — correct behaviour, and the 5s–20s quote ages confirmed it was live rather
than stale.

*Correction to the v655 commit message:* it states "it is 04:50 ET". That was wrong — the deploy ran
at **17:25 ET**. The verification limit it describes still stands: RTH's own session was closed, so
behaviour during RTH hours remains unobserved.

---

### DB fix — `shortlist_signal()` empty every Monday (Jul 27 2026)

The **AI Predictor** tab on Most Actives showed no data. The RPC returned 0 rows because it joined
the after-market leg on `d.dt - 1`: with the chain date Monday 2026-07-27 it looked for an
after-market session on **Sunday 2026-07-26**, which does not exist, and the inner join collapsed
everything. After-market actually had **2,613 rows on Friday 07-24** and pre-market **1,448** that
morning — no data was missing.

Fixed to take the most recent after-market session strictly before the chain date, bounded to 7
days. **Regression-checked across a full week: Tue–Sat identical, only Sun/Mon changed** (from a
date with 0 rows to Friday's). RPC now returns 52 rows, all three legs present; the tab renders 34
after its own liquidity filters.

Scanned the whole schema for the same pattern — `shortlist_signal` was the only function using
calendar-day arithmetic against the session tables. Lesson promoted to **§5.3a**; it had previously
existed only as a v632 changelog line, which is why it recurred in a second layer.

---

### AUDIT of the Most Actives overnight work, v643–v652 (Jul 27 2026)

**Verified correct** — 418 assertions comparing every rendered cell against the raw payload the page
itself consumed (intercepted, so no timing drift): bid price+size, ask price, spread recomputed from
*raw* prices, last-trade price, and all three trailing counts. **Zero failures.** No truncation
anywhere: 24/24 requests delivered == asked, no `next_page_token` on the latest-quote/trade calls,
`feed=boats` throughout, bars `start` advancing correctly each sweep. Sorting, staleness dimming, and
the auto-refresh toggle all confirmed behaviourally.

### v652 — count trailing trades from the TAPE, not minute bars (Jul 27 2026)

*(Audit finding — full method in the **AUDIT of the Most Actives overnight work** entry.)*

**1-minute bar `n` EXCLUDES ODD LOTS (trade condition `I`), and overnight flow is overwhelmingly
odd-lot.** Across 59 names active in the last 15 minutes, bars missed a **median 37.5%** of trades,
p90 **100%**:

| | tape | bars | missed |
|---|---|---|---|
| COIN | 99 | **0** | 100% |
| AMZN | 131 | 15 | 88.5% |
| BE | 102 | 42 | 58.8% |

COIN rendered `0` while trading 99 times. And the TRADES column beside it counts the raw tape, so two
columns labelled TRADES used different definitions.

**How it surfaced, and the methodology lesson.** A cross-source check of the stored scan against Alpaca
showed summed 1-minute bars running 25–99% BELOW the stored trades/volume — which reads at first like a
scan bug. Going to the raw tape settled it the other way: **the scan matches the tape exactly** on all
four sampled tickers (DIVO 78/593, TTWO 75/604, NIKI 58/629, TSLT 236/50297 — trades *and* volume), and
O/H/L/C matched exactly on 8/8. The scan was right; the bar comparison was the wrong instrument.
Condition histograms made it obvious: `DIVO {'@,I':77, '@':1}`. **This is §5.1c's "minute bars != daily
bars" reappearing as a live product defect rather than a test artifact — the same wrong instrument,
this time wired into the UI.** Before declaring a data fault, prove the comparison first.

**Fix — per-minute ring buffer over the raw tape.** A full 15-minute tape for the universe costs 2.4 MB
vs 172 KB for bars, too heavy at 20s, so per-minute counts are cached and only uncovered minutes are
fetched: ~2.4 MB once, then ~160–300 KB per completed minute. Paginated (a 16-minute full-universe tape
returns 3 pages). A window is marked covered only when **every** chunk succeeded — marking on partial
success would bake a permanent undercount in, since covered minutes are never refetched. Counts render
only when all 15 minutes are covered, so a partial window shows nothing rather than a silent
undercount. The minute index is anchored once at sweep start so requested and summed minutes cannot
straddle a boundary. Buckets past 20 minutes are pruned.

Verified by simulation (first sweep 15 minutes then 1 per sweep; exact steady state; a failed fetch
suppresses rather than undercounts; buffer bounded at 20 keys after 200 sweeps) and on live: **60/60
rows matched an independent tape recount exactly.**

---

### v651 — Most Actives: sub-dollar price precision (Jul 27 2026)

*(Also reconstructed after the fact.)* Found by audit: recomputing SPREAD from the **rendered** bid/ask
disagreed with the displayed percentage on 24 of 100 rows. The spread itself was right — it is computed
from raw prices — but BID and ASK rendered with `toFixed(2)`, which destroys the book on sub-dollar
names:

```
GSUN  raw 0.22   / 0.2235  -> rendered 0.22 / 0.22   (looks LOCKED)
OMH   raw 0.6261 / 0.6275  -> rendered 0.63 / 0.63   (looks LOCKED)
MTNB  raw 0.3757 / 0.3768  -> rendered 0.38 / 0.38   (looks LOCKED)
```

Those carried real spreads of 1.58%, 0.095% and $0.0011, so SPREAD read wide while the two prices
beside it read identical — internally contradictory on screen. **Fix:** `fmtQuotePx` — 4 decimals below
$1, 2 at or above. Principled rather than arbitrary: **Reg NMS Rule 612** permits sub-penny *quoting*
below $1.00 and requires cent increments above it, so that threshold is exactly where the extra digits
are needed and exactly where they stop being meaningful.

### v648–v650 — Most Actives: SPREAD + trailing trade counts (Jul 27 2026)

**v648 — SPREAD column, between BID and ASK** so the cell reads as the book does. Percentage of the
**mid** (the only convention comparable across names — quoting against bid or ask changes the number
depending which side you pick) with the dollar figure beside it. **Precision adapts to magnitude:**
overnight spreads span three orders of magnitude (SPY 0.012% → thin names past 11%), so fixed 2
decimals would collapse every liquid name to "0.01%" and destroy the distinction that matters for grid
sizing. A **crossed book** (ask < bid) shows negative rather than clamped — real on an ATS, flagged
gold; a locked book renders 0.0000% without dividing by zero. Coloured by cost, not size.
Verified live: **all 60 rows' rendered % matched `(ask−bid)/mid` recomputed from the rendered prices.**

**v649–v650 — trailing trade counts, 1m / 5m / 15m,** after LAST TRADE. From 1-minute bars, whose `n`
is that minute's trade count. **Cost measured before building:** full 1,338-name universe = 3 requests,
172 KB, 0.40s, no `next_page_token` — cheap because only ~440 names trade at all in a 20-minute
overnight window. Rides the existing 20s sweep.

- **Complete minutes only.** The in-progress bucket is excluded; including a partial would make the
  1-minute figure ratchet up and reset between 20s refreshes — noise, not signal. Costs ≤60s lag,
  stated in the tooltip. Bucket placement verified at 0/1/2/5/6/15/16/20 minutes ago.
- **Nesting invariant `1m ≤ 5m ≤ 15m`** held on 2000/2000 randomised books and on 60/60 live rows.
- **v650 fixed a zero-vs-unknown conflation shipped in v649.** Counts were set only when a symbol had
  bars, so a name that did not trade in 17 minutes rendered a dash — reading as "unknown" when the
  answer is "zero", and contradicting v649's own stated rule. `pullBars` now records which symbols a
  **successful** request covered: covered-with-no-bars → 0, failed request → dash. Without that split
  a dead name and a dropped request look identical, which is the same conflation that makes silent
  truncation so hard to see. Measured: 8 of 60 rows were affected; after the fix 60/60 populate.

---

### v646–v647 — Most Actives: LAST TRADE column (Jul 27 2026)

Column after ASK on the overnight tab: the most recent **print** on the overnight ATS — an actual
execution, not a quote — with the size that traded and how long ago. Reuses the
`trades/latest?feed=boats` sweep already running on the 20s cadence, so no new request.

**Why it is not a duplicate of PRICE.** PRICE only adopts a print if it is ≤12h old, so a previous
session's last trade cannot overwrite tonight's close. LAST TRADE records the raw print
**unconditionally** with its age. The two agree while a name is trading tonight and **diverge the
moment it stops** — and on a name that has not traded overnight, "last print 9h ago" is exactly the
useful fact. Suppressing it by age would blank the column where it carries the most information.

**Age is shown inline, not only in a tooltip.** Unlike a quote, a trade print can be hours old on a
thin overnight name, and the price is meaningless without knowing when. Compact s/m/h units, dimmed
past `QUOTE_STALE_S` with the age turned warn-coloured.

Payload verified against the live endpoint before building:
`{"c":["@"],"p":209.07,"s":250,"t":"2026-07-27T05:47:27.553Z","x":"B","z":"N"}` — `p` price, `s` size,
`t` timestamp. `c` is an **array** here, consistent with the standing `Array.isArray` rule for Alpaca
trade conditions.

**v647 fixed a readability defect caught by reading the rendered output rather than just checking the
column populated.** A 3px CSS margin between size and age is too subtle a separator between two
adjacent digit strings: the cell rendered as `315.29×4025s` (price 315.29, size 402, age 5s), which
reads as one meaningless number. Same class as the v633 heading nit but materially worse — both parts
are numeric, so it is genuinely ambiguous to a reader, not merely in `textContent`. An explicit middot
now separates them, matching the column's own `PRICE × SIZE · AGE` subhead. **Lesson: "the column is
populated" is not the same check as "the column is legible".**

Verified on live: 60/60 rows populated, 30/60 changed after a single 20s sweep, 21 dimmed for stale
prints, tooltips correct ("Last print 7s ago. Live.").

---

### v644–v645 — Most Actives: blank quote columns on load + quote refresh cadence (Jul 27 2026)

*(Reconstructed into the handoff after the fact — see the context-loss note in §11a. These two shipped
and were verified but were missing from this document.)*

**Two defects behind a "does not load / does not refresh" report on v643.**

1. **Blank on load — a key-availability race.** The quote fetch lived inside `fetchData`, gated on
   `p.alpKey && p.alpSecret`. But overnight sets `needsAlpaca=false`, so `fetchData` runs and the table
   loads **without** keys. If credentials were not yet in state at that moment the table rendered fully
   populated while the quote columns stayed permanently blank, and nothing retried — the only
   retrigger was another full load. A working table with two permanently empty columns is exactly the
   shape of the report.
2. **No meaningful refresh.** Quotes were tied to the 180s table reload (chosen for the Supabase scan
   cadence), so top of book was up to three minutes stale despite a full 1,338-symbol sweep measuring
   0.18s. Instrumenting the live page confirmed quote calls fired once at t=6.9s and not again in the
   following 46s.

**Fix:** quotes get their own effect, deps `[quoteEpoch, session, alpKey, alpSecret, autoRefresh]`.
Keys are dependencies, so it **retries the moment credentials arrive**. `QUOTE_REFRESH_MS = 20000`
while auto-refresh is on, independent of the 180s reload; stops when the toggle is off and skips while
the tab is hidden. The effect WRITES to `actives`, so it reads rows through `activesRef` rather than
depending on its own output. A sweep returning nothing leaves the previous quotes on screen rather
than blanking the columns.

**v645** additionally moved PRICE onto the quote cadence, fetching `trades/latest?feed=boats` alongside
the quotes. Without it PRICE only moved on the 180s reload while the book moved every 20s, measured
putting PRICE **outside [BID, ASK] on 34% of rows** (worst 56 bps: AMAT 551.51 against a 554.60/556.00
book). Only prints ≤12h old are adopted, so a previous session's last trade cannot overwrite tonight's
close, and MOVE %/GAP % are recomputed from the same anchors so the row stays internally consistent.

### v643 — Most Actives: live BOATS top-of-book (Jul 27 2026)

BID and ASK columns (price × displayed size) immediately after PRICE, **overnight tab only**.

**ALPACA FEED BEHAVIOUR — measured with the overnight session live, worth keeping:**

| feed | age | quote | usable |
|---|---|---|---|
| `boats` | **1.2s** | 208.67×178 / 208.90×202 | yes — real-time overnight |
| `sip` | 188,588s | Friday's close | RTH shut |
| `iex` | 202,984s | **ap:0 as:0** | **no — one-sided, spread uncomputable** |

`isBoatsView` is `session==='overnight'` specifically; `isOvernightView` covers all three session tabs
and would wrongly include pre/after-market, which need `feed=sip`.

**THE PROXY 403s ANY NON-BROWSER CLIENT.** `alpaca-proxy...workers.dev` returns **Cloudflare error
1010** without a browser `User-Agent` — including for paths the app already uses successfully. Not a
credential or path fault. **Anything server-side (Edge Function, pg_net) calling this proxy will be
blocked.** With a UA it delivered 1,338/1,338 in 0.18s.

**Batching:** all 1,338 symbols in one call works (154 KB, 0.10s direct, no `next_page_token`), but the
symbol list travels in the **`X-Alpaca-Path` header** — 8.9 KB at 1,338 names — so it is chunked at 500
for headroom against Cloudflare's header ceiling.

**Staleness is the real trap and is guarded.** Quote age across the universe: median 230s, p90 3,649s,
**max 246,288s (2.8 days)** — illiquid names have not quoted overnight at all. Past `QUOTE_STALE_S`
(300s) the cell dims and the tooltip carries the exact age; a zero price is treated as "no resting
order on that side", not a price of zero. **Proven to fire:** under default filters 58 rows / 0 stale,
but with the trade-count filters cleared, **52 of 100 rows dim** with correct ages. This is the
documented pattern where a defect (or a guard) is invisible under default settings.

**Sortability:** values are stamped onto each ROW via `setActives(prev.map(...))`, not a side map —
the comparator reads `row[sortKey]` and v581 shipped a header that looked sortable while sorting by
null. Verified on live: both columns monotonic DESC then ASC, order genuinely changes.

**Overnight spreads are wide** — median **171 bps**, p90 **1,027 bps**. Every tight name is a cash/bond
ETF (BOXX/SHV/SGOV/SPY/BIL at 0.9–1.1 bps). Material for any overnight grid costing.

---

### v642 — remove the MFE warning block from Close → Next High (Jul 26 2026)

Removed at the user's request. The block restated a finding the user produced themselves (§9a), inside
their own single-operator tool — the audience for that warning was the person who ran the research, so
it was clutter rather than a safeguard. Nothing else changed: the technical footnote still carries the
formula, the kept-not-clipped rule for negatives, the zero-boundary note and the ATR-multiple targets,
and the "Never positive" tile still shows the count and share. The interpretation context lives in the
**v641 entry**.

---

### v641 — Close → Next High Distribution (Jul 26 2026)

Third histogram in the card. Returns show net travel, true range shows day size, this shows **reachable
upside** from the prior close.

**Definition reuses the app's existing convention — it does not invent a third.** `(session high −
prior close) / prior close %`, identical to `closeToHighPct`, which already backs the C→H ladder and
the "Avg close→high" panel stat. **Verified by running both implementations on the same 251 sessions:
means agree to 9 decimal places (1.517742826).** Negatives are **kept, not clipped** — they are sessions
whose high never regained the prior close, so a position opened there was never once in profit. On NVDA
that is 49 of 251 sessions, **19.5%**. Clipping would flatter every statistic in the block.

**Shared implementation, not a copy.** `retDist` now takes an optional accessor defaulting to `.ret`,
so existing callers are untouched. Two near-identical binning routines would have drifted, and the
zero-boundary rule is exactly the subtlety that only ever gets fixed in one copy. **Regression
verified: the returns histogram reproduces its v637 baseline with zero drift across all seven
statistics.**

**Interpretation (see the v642 entry; this record stands).** The figures are
**maximum favourable excursions, not achievable returns** — a hit rate says price touched that level at
some point in the session, not that it was exited there, how far it fell first, or where it closed.
§9a measured the average close→high as **highly persistent (r = +0.848)** while the buy-the-close /
sell-next-swing-high strategy built on it **still lost −0.25%/trade, negative in every metric quintile
out of sample**. A persistent metric is not a profitable one. The in-app warning was removed at the
user's request in v642 — it restated a finding the user produced themselves, inside a single-operator
tool, so it was clutter rather than a safeguard. The technical footnote and the "Never positive" tile
remain, and this section of the handoff is now where that context lives.

Verified: bin integrity (bins sum to n, zero on a boundary, no bin mixes signs); edge cases all return
null without throwing (empty, one row, null high, zero prior close). Live DOM verified against
independently computed values: **14 assertions, all pass**, including the presence of the warning block.

---

### v640 — Daily True Range Distribution (Jul 26 2026)

Second distribution, directly below the returns histogram, sharing the lookback dropdown. The returns
histogram shows **direction and net travel**; this shows **size** — how big a day actually is. Tiles
(ATR(14), median, mean, SD, 25th/75th/95th, narrowest/widest), a histogram with a **lognormal** fit and
a dashed marker at the current ATR(14), and a multiples table (how often the range reaches
0.5/1/1.5/2/3× ATR, with a "1 day in N" column).

**Three definition decisions, all stated in the in-app footnote:**
- **True range, not high−low.** Wilder's `max(h−l, |h−prevClose|, |l−prevClose|)`, so **overnight gaps
  count**. A stock that gaps 4% then trades a quiet session genuinely moved, and a grid sitting across
  that gap is skipped straight through it — plain high−low would hide exactly the days that hurt.
  Verified: prevClose 100 with h=110/l=108 gives **TR=10, not 2**.
- **Normalised by each day's OWN prior close** — deliberately different from the ATR ladder, which
  divides by `lastClose` (v204) so its six recent windows compare at today's price. Right there, wrong
  here: over 12 months that would understate any day when the stock traded at a very different price.
  The reference ATR(14) marker is recomputed under **this** convention so marker and distribution share
  units, which means **the ATR figure here can differ slightly from the ladder's**. Intended.
- **Lognormal fit**, not the normal used on the returns histogram — true range is strictly positive and
  right-skewed, so the normal is the wrong family. Fitted on `ln(pct)`, zero-range days excluded.

`vtRows` gains `h` and `l` (was close only). No extra network call.

Verified: gap handling correct (7 / 10 / 10 for normal / gap-up / gap-down); edge cases all return null
without throwing (empty, single row, null high, zero prior close, NaN close); bins sum to n with every
`lo >= 0`. All statistics cross-checked against an **independent Python implementation**, exact match
(NVDA 12m: ATR 3.6998%, median 3.0700%, mean 3.2865%, sd 1.3295%, multiples 224/89/18/2/0). Live DOM
verified against independently computed values: **19 assertions, all pass**.

---

### v639 — Moving Average Structure (Jul 26 2026)

Card at the bottom of the page. **No extra network call** — computed from the 10y daily close series
`vtRows` already holds. Table of 50 / 100 / 200-day SMAs (value, price vs MA %, slope, direction,
consecutive sessions on the current side), stack-alignment and 50/200-cross tiles, and a chart of
percentage distance from each average over the last 252 sessions.

**Design decisions worth preserving:**
- **Slope is a percentage, not an angle.** An angle depends on chart scale and axis range, so it cannot
  be compared across tickers or timeframes. The % change of the average itself is scale-free.
- The slope lookback is **fixed at 20 sessions for all three periods**, not scaled per period, so the
  three are directly comparable and the term structure is readable — "50d falling 0.5%/20d while 200d
  rises 1.2%/20d" is a statement a per-period lookback would hide.
- The distance chart is **deliberately not another price chart with MA overlays** — the panels above
  already draw those. What is not visible anywhere else is how far price stretches and whether it returns.
- The cross day count stops at the start of the 200-day series and renders "at least N" at that limit
  rather than implying a longer run than the data supports.
- Footnote states these are descriptive, not signals (§9a: direction is not forecastable).

**CAUGHT IN THE SWEEP — DUPLICATE DEFINITION.** The first draft added its own `smaSeries`.
`MultiViewChartsPage` **already has one** (with the MA-overlay helpers), so both sat in one function
scope and the later `var` assignment silently won. They differed: the existing returns an **all-null
array** for short input, the new one returned **null**. No live crash, because the overlay guards with
`if(bars.length<d.n)return null;` before calling — but remove that guard or add an unguarded caller and
the chart throws on `.map` of null. Duplicate removed, existing function reused, warning comment left
at the site. **A duplicate-definition grep hit inside the SAME component is a real collision** — unlike
the `fmtPct` case (§v634) where all four were in separate components. Always resolve the enclosing
`function ...Page(` before deciding which it is. Full scan run across all ten helpers added this
session: each exactly 1.

Verified: `smaSeries` on a known series ([1..10] period 3 → [null,null,2,…,9]); `maStats` edge cases
(empty / too-short → ok:false; exactly-period → value with slope null); `crossState` null and partial
inputs handled. All figures cross-checked against an **independent Python implementation** on 2,511
NVDA sessions, exact match. Live DOM verified against independently computed values: **23 assertions,
all pass**.

---

### v638 — current streak state (Jul 26 2026)

Shows the run **in progress** as of the most recent completed session, at the top of the 12-month
streak subsection, so the distribution below reads as "where are we now" rather than only "what
happened". Displays length + direction + date range, the continuation rate (how many 12-month runs
reached this length and how many extended one further), and **the plain up/down-day rate alongside it**.

**Why both percentages appear together.** Under independence, `P(extend | k consecutive)` equals the
plain day rate. Putting the continuation rate NEXT TO the base rate makes that comparison unavoidable,
instead of leaving a bare "3 green days" badge to imply momentum. §9a measured streak structure as
close to what independent days produce (runs-z persistence 0.06; NVDA's run distribution sits inside
Monte Carlo expectation at every length), so the UI must not suggest an edge the data does not support.
The in-app footnote states this.

**Implementation notes:**
- `currentStreak` walks the **full series** (`vtRows`), not the 12-month window, so a run beginning
  before the window start is measured at true length. A window-truncated streak would under-report
  exactly when the streak is most notable.
- A flat day or missing return **ends** the run and starts none, consistent with v635. Verified
  `[1,0,1,1] -> 2`, not 4.
- `continuation()` reads the distribution as a **survival function**: "reached k" = count of runs of
  length >= k.

Verified in node (edge cases return null without throwing; continuation matches an independently
expanded brute-force list exactly at every k including k=11 -> 0% and k=12 -> null), then on live
against independently computed values: 8 assertions, all pass. Real NVDA read 2 RED
(2026-07-23 -> 2026-07-24), continuation 33 reached / 15 extended = 45% against a 49% down-day rate —
no edge, exactly as §9a predicts.

*Probe lesson (again):* the first live run reported 4 failures that were entirely my regex — `textContent`
concatenates without spaces (`Current streak2 RED days2026-07-23`), so a pattern expecting spaces
missed. Traced and fixed rather than dismissed by eye. **A failing assertion must be explained, not
waved through**, the same way a passing one must not be trusted without a positive control (§5.7a).

---

### v637 — Daily Return Probability Distribution (Jul 26 2026)

Third subsection in the Daily Returns card, between the return chart and the streak block. Shares the
lookback dropdown and the same rows the chart plots, so it is the distributional view of exactly the
series shown above it.

Stat tiles (mean, median, SD, skew, excess kurtosis, 5th/95th percentile, worst/best), a histogram with
a fitted-normal reference curve, and a **tail table** giving observed vs normal frequency beyond
1/2/3 sigma with a ratio column flagged above 1.25x.

**Design notes worth preserving:**
- **Bin edges are aligned so zero is always a boundary.** A bin straddling zero would mix up-days and
  down-days into one bar and destroy the green/red split exactly where the shape matters most.
  Asserted in the tests: no bin has `lo<0<hi`.
- Bin width uses a 1/2/2.5/5 × 10ⁿ nice-number rule and **self-scales** — a 3x ETF moving ±10%/day gets
  wider bins than a utility, with no hardcoded volatility assumption.
- The normal curve is a **reference, not a claim** that returns are normal; the footnote says so. The
  tail table is the actionable part for grid sizing — ratio > 1.0 means large moves happen more often
  than normal predicts, and those are the moves that carry price out of a grid.
- `normCdf` via Abramowitz & Stegun 7.1.26, max abs error measured 4.5e-7.

**Verification — cross-implementation, not internal consistency.** All statistics were recomputed in
**Python** and matched to 6 decimal places (NVDA 251 sessions): mean 0.094839, sd 2.257831, median
0.043276, skew 0.113456, excess kurtosis 0.350358, p05 −3.692322, p95 3.887867, tail counts 70/10/1.
Edge cases return null or bin correctly without throwing (empty, single value, all-null, all-identical
with sd=0, NaN/Infinity excluded from n). Live DOM verified against independently computed values for
the 3m default: 14 assertions, all pass.

**Observation worth knowing:** NVDA's excess kurtosis is **−0.35 over 3 months but +0.35 over 12
months** — it flips sign with the window. Kurtosis estimated from a few dozen observations is very
unstable, so do not treat a single window's tail reading as a stable property of a name. The tails
themselves sit close to normal for NVDA (27.9% vs 31.7% at 1σ, 4.0% vs 4.6% at 2σ over 12m), i.e. the
usual fat-tail story is not dramatic for one liquid name over one year.

---


**Older entries (below v637) are in [`docs/CHANGELOG-ARCHIVE.md`](docs/CHANGELOG-ARCHIVE.md).**
They were moved to keep this file readable on a cold start — §9 was 58% of it. Nothing was
deleted. **If an archived entry contains a lesson that still applies, it belongs in §5, not
the archive** — promote it and leave the pointer (see §4 step 8).

<details><summary>22 archived entries (titles only)</summary>

- v636 — Fib swing scales to visible range (Jul 26 2026)
- v635 — consecutive-day streak distribution, fixed 12-month window (Jul 26 2026)
- v634 — Daily Returns & Red / Green Day Counts (Jul 26 2026)
- v633 — real session date on TODAY/YESTERDAY + build.js DST fix (Jul 26 2026)
- v632 — MV Charts: TODAY/YESTERDAY selected by trading day (Jul 26 2026) — VWAP BUG RESOLVED
- v631 — Source Code page: Holy Grail metric definitions (Jul 26 2026)
- v630 — regroup volume / trades columns (Jul 26 2026)
- Post-v629 integrity sweep — clean, plus a mistake I made DURING the sweep (Jul 26 2026)
- v629 — Relative trade count: RTrd 5d / 3d / prev (Jul 26 2026)
- v628 — Relative volume: RVol 5d / 3d / prev (Jul 25 2026)
- v627 — Vol / Trades 20d median + CRITICAL stale-guard fix (Jul 25 2026)
- v626 — stale-listing guard on BOTH ladders + audit fixes (Jul 25 2026)
- C→H ladder — 10d / 5d / 3d / prev (v625, Jul 25 2026)
- C→H 10d gains a dollar leg + dual sort (v624, Jul 25 2026)
- C→H 10d — close-to-next-day-high, 10-session average (v623, Jul 25 2026)
- Vol Exp column — volatility expansion ratio (v622, Jul 25 2026)
- v621 — housekeeping: freshness weekday guard, tap targets, stray file (Jul 25 2026)
- ATR ladder — 14d / 7d / 3d / previous day (v620, Jul 25 2026)
- Sortable 14d ATR column — Holy Grail screener (v619, Jul 25 2026)
- Fib overlay refinements (v616–v618, Jul 25 2026) — written up from the diffs
- Fibonacci overlays + last-price tag + swing fix (v609–v615, Jul 25 2026)
- Full data-integrity hunt — findings + `ladder_integrity_check` (Jul 25 2026)

</details>

---

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

## 9b. Most Actives — current state (Jul 27 2026, v658)

The page under active development. This is the summary; the per-version detail is in §9.

**Four session tabs**, each reading the venue that IS its book:

| tab | rows from | live feed | reload | counts source |
|---|---|---|---|---|
| Overnight | `overnight_actives` | `boats` | 180s | **raw tape** (ring buffer) — exact |
| Pre-Market | `premarket_actives` | `sip` | 90s | SIP bars — see §5.1g |
| RTH | Alpaca most-actives screener | `sip` | 30s | SIP bars — see §5.1g |
| After-Market | `aftermarket_actives` | `sip` | 90s | SIP bars — see §5.1g |
| ★ AI Predictor | `shortlist_signal()` RPC | — | — | — |

**Seven live columns**, inserted after PRICE, refreshed on their own **20s** sweep independent of the
table reload: **BID · SPREAD · ASK · LAST TRADE · TRADES 1M · 5M · 15M**. PRICE also refreshes on that
cadence from `trades/latest`, with MOVE % and GAP % recomputed so the row stays self-consistent.

**Accuracy, stated plainly:**
- **Quotes, spread and last trade are real-time on every tab** (~1–2s).
- **Overnight counts are exact** — verified 60/60 against an independent tape recount.
- **SIP-session counts run ~10–19% low** on recent minutes and the error is *not uniform*, so
  ordering between mid-tier names can be affected. **Known and accepted — see §5.1g, do not "fix"
  unasked.**
- **ON PACE carries a confidence band** (v658) and greys itself when the projection could span >2.5x.

**Invariants worth re-checking after any change here:**
1. `1m ≤ 5m ≤ 15m` on every row — mathematically necessary.
2. Rendered SPREAD equals `(ask−bid)/mid` recomputed from the rendered prices.
3. Live values must survive a table reload — v656 shipped with them being wiped every cycle.
4. Sample **across reload boundaries**, not once. A periodic defect is invisible to spot checks.

---

## 10. Known open items

> **Read `integrity_log` before trusting anything (§1).** As of Jul 27 2026 it held
> **48 WARN and 13 FAIL in 48 hours, entirely unread.** Two distinct issues, both real:
>
> **1. Freshness false-FAILs on WEEKENDS, not just holidays.** 13 FAILs across
> premarket/aftermarket/overnight on Jul 25–26 (Sat/Sun), e.g. *"1144 min since last write
> (session LIVE)"* — the check believes the session is live at the weekend. This item was
> previously recorded as affecting only market holidays (~9 days/yr); it is **weekends too**,
> so roughly 110 days a year, which is why the log is full of noise nobody reads. §5.6 rule 2
> already says freshness must stay silent when a session is legitimately closed — that rule is
> not being honoured for Sat/Sun.
>
> **2. ~~`pace curve: aftermarket` projection unreliable~~ — ADDRESSED in v658.** The warning is
> legitimate and still fires (the dispersion is structural — after-market spread peaks at 46.7 pts
> around minute 50 vs RTH's 16.3), but the app no longer presents the projection as if it were
> equally trustworthy everywhere. ON PACE now carries a confidence band derived from `curve_spread`,
> greying and marking cells when the projection could land in a >2.5x range. See the v658 entry.
> **The WARN in `integrity_log` is expected and is not a defect to chase.**

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
- **Integrity results still have no PUSH notification** — but §1 now queries `integrity_log` at
  session start, so they are no longer invisible. That query is what surfaced 48 WARN and 13 FAIL
  sitting unread for two days. A real alerting path (email/webhook) remains unbuilt.
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

- **~~Fib swing on 5Y/10Y charts~~ — RESOLVED in v636.** The leg now scales to a minimum fraction
  of visible range (`MIN_LEG_FRAC=0.22`), and the diagnosis in the v636 entry corrects the original
  report: the compression was worst on **3Y (8% of range)**, not 5Y/10Y, and the "zero swing labels"
  claim was not reproducible.
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
- ~~README pinned at v261~~ — **fixed Jul 27 2026.** It had claimed v261 / 64 routes / ~21,800 lines
  while the app was at v658 / 86 routes / ~36,917. Rewritten as a signpost into this file with
  specific numbers deliberately omitted, because the README has no staleness check and §9 does.

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

## 11a. Context loss during long sessions — what it looks like and what to do (Jul 27 2026)

**Observed:** three versions (v644, v645, v651) were committed from this sandbox, with the session's git
identity, in windows where the assistant had no record of the work. Investigated rather than assumed.

**Evidence it was the same worker, not a second one.** The sandbox holds test scripts filling exactly
those windows — `diag643.js` 04:48, `triple644.js` 04:56, `check3.js` 04:59, `verify644.js` 05:03,
`audit644.js` 05:08, `toggle644.js` 05:10, `pricelag.js` 05:17, then v645 at 05:21; and
`sortall.js`/`sortdiag.js`/`sortall2.js`/`xsrc.js` 06:36–06:40 before v651 at 06:43. They are byte-for-byte
in the same house style (same playwright boilerplate, same `glob`/`b`/`pg`/`t0`/`errs` names, the `BT`
access code). `triple644.js` is named after the user's phrase "Triple check everything". **Conclusion:
the same session did the work; the intervening turns were dropped from context.**

**What it cost.** The same defect was diagnosed twice — the v643 key-race was found at 04:48–04:53 and
then re-investigated from scratch at 05:28–05:44 — and the assistant reported being unable to account
for its own commits. No code was damaged: **all three fixes verified present in v652** (`quoteEpoch`
effect with key deps, `trades/latest` price with the 12h guard, `fmtQuotePx`). The habit that prevented
damage was mechanical: always `cp app_vN.jsx app_vN+1.jsx` from the **current highest** file and read
the region before editing, so each pass built on whatever was actually there rather than on memory.

**What it did damage: the handoff.** v644, v645 and v651 had **zero** mentions in this document — three
versions, two of them fixing user-reported bugs, absent from the only durable record. Reconstructed
above from their commit messages.

**Rules going forward:**
1. **`git log` is the source of truth for what shipped, not recollection.** At the start of any session,
   and after any gap, run `git log --format='%ad | %s' --date=format:'%H:%M:%S'` and reconcile against
   this document. A version present in the log and absent here is a handoff gap to fill.
2. **Commit messages must be self-sufficient.** They survived when context did not, and were the only
   reason v644/v645/v651 could be reconstructed at all. Keep writing them as full write-ups.
3. **Before "discovering" a problem, check whether it was already fixed.** The highest `app_vN.jsx` and
   the last few commits answer that in seconds and prevent redoing work.
4. **Never assume a version you do not remember is someone else's.** Check the sandbox artifacts first.

---

## 11b. Tooling available to the assistant — verify, do not assert (Jul 27 2026)

**Correction of record.** Commit `c130054` states "I do not have Cloudflare MCP tools available in
this session". **That was wrong.** The Cloudflare Developer Platform tools were present the whole
time — `workers_list`, `workers_get_worker`, `workers_get_worker_code`, KV / R2 / D1 / Hyperdrive
management and `search_cloudflare_documentation`. The claim was asserted from memory, repeated after
the user corrected it, and only settled by actually calling one.

**The rule this earns:** the same one §4a already applies to data — *check, do not assert*. Tool
availability is checkable in one call. Never tell the user a capability is missing without trying it,
and if they say a connector exists, believe them over your recollection.

**Verified deployment inventory (Jul 27 2026):** 11 Workers — `alpha-quant-analytics` (the app),
`alpaca-proxy`, `alpha-quant-api`, `edgar-proxy`, `tipranks-proxy`, `positive-minds-cms`,
`positive-minds-mcp`, `hourly-tp-scanner`, `daily-tp-scanner`, `predict-api`, `countdown`.
**No `trade-relay`**, confirming the parked relay was never deployed.

**`deploy.yml` redeploys five Workers on EVERY push to main**, including docs-only commits — which is
why the app's `BUILD_TS` moves when no code changed. Harmless, but the stamp reflects the last *push*,
not the last code change. Bear that in mind when using it to diagnose whether a fix is live: check the
version number, not the timestamp.

---

## 11c. Connectors and how work actually reaches production (Jul 27 2026)

**Check these, do not assume — §11b exists because that mistake was made.** A connector can be
installed but not authenticated; call one of its tools to find out.

| Connector | Status | What it is for here |
|---|---|---|
| **Supabase** | connected | `execute_sql` for diagnostics, `apply_migration` for DDL/function changes. The `shortlist_signal` fix went through it. |
| **Cloudflare Developer Platform** | connected | `workers_list`, `workers_get_worker_code` to read what is genuinely running, plus KV / R2 / D1 / Hyperdrive. **Not** how deploys happen. |
| Netlify, Elicit, alphaXiv, Microsoft Learn | connected | not used by this project |

### The deploy path — GitHub Actions, never a local `wrangler deploy`

Every Worker reaches production through `.github/workflows/`, using repo secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

- **`deploy.yml`** — fires on **every push to main**, builds the app and deploys **five** Workers:
  `alpha-quant-analytics`, `tipranks-proxy`, `alpha-quant-api`, `alpaca-proxy`, `edgar-proxy`.
- **`deploy-predict.yml`** — path-filtered to `predict-api.js` / `wrangler-predict.toml`.
- Others: `pipeline.yml`, `nightly-pipeline.yml`, `tipranks-pipeline.yml`.

> **`BUILD_TS` REFLECTS THE LAST PUSH, NOT THE LAST CODE CHANGE.** Because `deploy.yml` runs on every
> push including docs-only commits, the banner timestamp moves when nothing shipped. **To judge
> whether a fix is live, read the VERSION NUMBER, not the timestamp.** This cost real time tonight.

**Deployed inventory, verified Jul 27 2026** (11 Workers): `alpha-quant-analytics` (the app),
`alpaca-proxy`, `alpha-quant-api`, `edgar-proxy`, `tipranks-proxy`, `predict-api`,
`hourly-tp-scanner`, `daily-tp-scanner`, `countdown`, `positive-minds-cms`, `positive-minds-mcp`.
**No `trade-relay`** — the parked relay (§5.1g) was never deployed and must not be assumed live.

### Two proxies exist for a reason

- **`alpaca-proxy`** — all browser Alpaca calls. Headers `X-Alpaca-Path` and `X-Alpaca-Base: 'data'`
  (data API) or empty (paper trading API). **It 403s any client without a browser User-Agent**
  (Cloudflare error 1010), so an Edge Function or `pg_net` cannot use it — see §5.1f.
- **`edgar-proxy`** — SEC EDGAR, which rate-limits (429) direct calls.

---

## 11d. Making context loss harmless (Jul 27 2026)

**It cannot be prevented.** Four versions shipped tonight (v644, v645, v651, v656) from windows the
session had no memory of. Assume it will happen again and make it cost nothing.

**What already worked — do not weaken it.** *No work was lost.* All four commits carry 36–47 line
messages holding the full diagnosis and evidence; v651's contains the raw quotes that proved the bug,
written by a session that left no other trace. **Commit messages are the backstop that survives when
context does not.** Keep writing them as complete write-ups, not one-liners.

**What did get lost:** the §9 entries (now mandatory, §4 step 8) and, more dangerously, *findings
between measurement and commit*. Tonight's bar-settling curve, stream connection limits and feed
behaviour sat only in context for long stretches. A drop mid-investigation would have destroyed them.

### The three rules

1. **COMMIT A MEASUREMENT WHEN YOU TAKE IT, not when the task finishes.** An expensive number living
   only in context is one truncation from gone. A `docs:` or `research:` commit costs seconds. Every
   durable finding from tonight — §5.1e, §5.1f, §5.1g — should have been committed hours earlier.
2. **KEEP `docs/IN-FLIGHT.md` CURRENT** for anything non-trivial: what was asked, what is measured,
   what is decided, the next step. Clear it on ship. It bridges "measured" and "committed".
3. **NEVER ASSUME AN UNFAMILIAR VERSION IS SOMEONE ELSE'S WORK.** Check the sandbox first — test
   scripts, file timestamps, git identity. Tonight `pwtest/triple644.js`, named after the user's own
   phrase, proved authorship in seconds after the assistant had reported being unable to account for
   its own commits.

### On resuming

Run §1. It reconciles `git log` against §9 and reads `integrity_log`. Then read
`docs/IN-FLIGHT.md`. **`git log` outranks recollection, and both outrank this file.** Before
"discovering" a bug, check the last few commits — the same defect was diagnosed twice, an hour
apart, for want of that check.

---

## 12. Sandbox tools & libraries (re-verified Jul 27 2026 — re-probe if in doubt)

> **This section is the SANDBOX (what the assistant can run locally). For MCP CONNECTORS —
> Supabase, Cloudflare, Netlify — and for how code actually reaches production, see §11c.**
> Spot-checked Jul 27 2026 and accurate: default shell is `sh` not bash, Chromium is
> `chromium-1194`, pandas 3.0.2 / numpy 2.4.4 / scipy 1.17.1.

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
