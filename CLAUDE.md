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

## 5. Standing rules (hard-won — violating these has broken production)

**Storage budget before ANY bulk write.** Free plan, 512 MB. A `daily_returns`
backfill (3.08M rows / 436 MB) blew the quota, Supabase **refused connections**, and
the app hung on "Waiting for Alpaca API keys…" because it loads `app_config` at
startup. Feature was truncated and dropped. So: estimate rows × bytes × 1.5–2 for
indexes → state the estimate to the user → backfill a 5–10 day sample → measure →
extrapolate → only then decide. Scope down by default. Prefer `TRUNCATE` over
`DELETE`. `net._http_response` accumulates silently — prune it. Generalise this:
raise resource limits (storage, rate limits, Actions minutes, Edge timeouts, the 3s
anon statement timeout) **before** building, not after breaking.

**PostgREST 1,000-row silent cap** — #1 recurring bug. EVERY REST query needs an
explicit `&limit=N`. No error, just silently missing data. Multi-ticker ×
multi-date multiplies fast.

**Silent API truncation** — #2. Set `limit=` high, follow `next_page_token`, verify
`end=` behaviour client-side.

**PostgREST serialises `numeric` as STRINGS** (ints come back as numbers). Coerce
with `Number()` or `"9" > "100"` sorts wrong and bar scaling breaks.

**Timezone:** always `Intl.DateTimeFormat('en-US',{timeZone:'America/New_York'})`.
Never hardcode UTC-4/-5 — it breaks twice a year.

**Alpaca quirks:** SIP 403s on *today's* data via **historical** REST → bound
`end=` to yesterday. **Snapshots are live and NOT subject to that** (this is why
v555 could move snapshots to SIP). Trade `.c` conditions field can be a string —
always `Array.isArray` guard. Options `/v1beta1/options/trades` needs `start=`, no
`end=`, no `feed=`. Exchange codes are letters.

**Feed matching:** RVOL numerator and denominator must come from the SAME tape.
Mixing IEX current volume with a SIP 20-day average inflated RVOL ~30x (v530). As of
v555 Most Actives is SIP end-to-end so the mismatch is structurally impossible there.

**Test APIs before claiming success.** Use `pg_net` (fire `net.http_get`, then read
`net._http_response`). Measure; don't assume.

**GitHub Actions:** `actions/checkout@v6`, `actions/setup-node@v6`, Node 24.

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

**Supabase `haeqzegdlwryvaecanrn`** — ~155 MB / 30% of cap; ~60 tables; ~35 pg_cron
jobs (4 session-actives scanners, chop scan + price refresh, regime-classify, IV
logger, staggered 3:30–3:41 AM cleanups, Sunday 4 AM vacuums, `db_size_guard` every
6h); ~18 Edge Functions (`batch-analyze`, `chop-price-refresh`, `regime-classify`,
`iv-logger`, `overnight-/premarket-/aftermarket-actives`, `tipranks-sync` + probes).

Convention: `cached_*` tables have **RLS off**, anon-key readable, `SECURITY DEFINER`
RPCs. Advisors will flag ~55 `rls_disabled_in_public` — that is the intended design,
not a bug to "fix".

Several tables show 0 rows but hold disk (dead-tuple bloat, ~40 MB reclaimable via
`VACUUM FULL`). Full Stage 1–4 pipeline tables are empty (only ever NVDA/ONON).

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
