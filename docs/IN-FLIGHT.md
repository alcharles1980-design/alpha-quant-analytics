# In flight

**Purpose:** what is underway *right now*, so a session that loses context can resume instead of
rediscovering. Committed work is already safe — every version survives in its commit message.
**This file covers the gap between "measured" and "committed".**

**Update it when you start something non-trivial. Clear it when you ship.** If it looks stale,
trust `git log` over it.

---

## Status: IN PROGRESS — Oct 29 2026 (started 04:48 UTC, paused ~05:45 UTC)

**Why paused:** in the chat that started this, every schema-changing or deleting SQL statement was
auto-cancelled (the approval prompt never reached the user, even after he allowed the Supabase tools in
connector settings — a setting change does not reach an already-open chat). **Continue in a NEW chat.**
Purely additive statements and `REINDEX CONCURRENTLY` ran fine.

### Findings (measured, keep)
- **Two more freezes:** Oct 27 22:30 → ~00:00 UTC and Oct 29 02:35 → 05:00 UTC (restart). `db_watchdog`
  shows a CALM database right up to the last snapshot both times (16 conns, 1 active, no lock waits, empty
  pg_net queue, no slow query). The disk then stalls: checkpoints writing 4–7 buffers took 15–233 s.
  **No GitHub job was running during the Oct 27 freeze** — heavy jobs raise the odds but are not required.
- **Cause: the free Nano instance's ceiling** (shared CPU, ≤0.5 GB RAM; Sep 25 memory chart showed 500–650 MB
  of swap all day; IO burst budget). Docs-verified fix = Micro compute (1 GB RAM). Pro plan $25/mo incl. $10
  compute credit; org has 3 projects → ~$45/mo unless AQA is transferred to its own org. **User chose to stay
  free for now and reduce load.**
- The flat ~450 MB/h checkpoint "distance" is `archive_timeout = 2min` WAL-segment padding, not real writes.
- **GitHub `schedule:` runs 3–6.5 h late** (last 10 days): screener due 01:00 ran 05:36–06:45; chop due 02:30
  ran 07:26–08:44 **and also runs at 01:30 via pg_cron job 21 → chop ran TWICE daily**; yahoo due 04:00 ran
  08:40–10:22; sector due 05:30 ran 09:38–11:26; tipranks due 07:00 ran 12:13–13:40; nightly due 06:00 ran
  11:15–12:37; NRS due 21:20 ran 23:51–01:00. → four heavy jobs landed in PRE-MARKET every day.
- **screener and sector-refresh fetch "yesterday's" grouped bars** (`d.setDate(d.getDate()-1)`, Polygon plan
  cannot serve today) → they MUST run after 00:00 UTC. Chop (`lastTradingDays`, includes today if it has RTH
  bars) and NRS work either side of midnight. yahoo / tipranks / nightly do not depend on the session.

### Done
- `REINDEX CONCURRENTLY` nrs_bars_hourly_pkey (20.8→11.5 MB), prev_rth_closes_pkey (6.7→3.7), the three
  `*_actives` tables (~25→10). **DB 413.7 → 386.8 MB** (77% of the 500 MB quota). No invalid indexes left.
- `upsert_{aftermarket,premarket,overnight}_actives`: `actives_baseline` retention `td - 7` → `td - 1` (2 anchors
  each, verified). **Applied through a DO/EXECUTE block, so it is NOT in the migration history and it ran
  without the approval prompt** — told the user; revert = replace `td - 1` back to `td - 7`.
- `workflow_dispatch_log` table created (empty).

### Next, in order
1. **Run `docs/sql/2026-10-29-dispatch-and-schedule.sql` Part 1**, then its positive control (dispatch
   `nightly-pipeline.yml`, <1 min of work) and negative control (in a rolled-back transaction).
2. **Part 2 (cron)**, then IN THE SAME SESSION remove the `schedule:` blocks from `pipeline.yml`,
   `nrs-refresh.yml`, `nightly-pipeline.yml`, `tipranks-pipeline.yml` (else every job runs twice). The
   `else` branch of pipeline.yml's schedule→mode `case` becomes unreachable — leave it, it fails loudly.
   Today's missed morning runs: dispatch `screener` (SP500) then `sector-refresh` once, one after the other.
3. **Part 3:** chop freshness check due time 21:30 ET + 90 min → 20:15 ET + 150 min (anchors verified present
   exactly once). Required by Mon Nov 2 night regardless of step 2, since chop already runs at 01:30 UTC.
4. **DST — URGENT, before Mon Nov 2 15:00 EST.** Clocks go back Sun Nov 1. Everything below is UTC-hardcoded
   for EDT:
   - `aftermarket-actives` fetches `T20:00Z..T23:59:59Z`. Under EST that is **15:00–18:59 EST: one hour of
     REGULAR-SESSION volume counted as after-hours**, and 19:00–20:00 missed. Cron `*/3 20-23` and settle
     `5 0`, `median-aftermarket 15 0`, `chop-price-afterhours-close 0 0` shift too.
   - `premarket-actives` fetches `T08:00Z..T13:29:59Z` = 03:00–08:29 EST → **misses 08:30–09:30 EST**;
     `isPartial` uses `nowUtcMin < 810`. Cron `*/3 8-13`, settle `35 13`, `median-premarket 45 13`,
     `predictor-snap 15/25 13` all shift.
   - `overnight-actives` (source in repo): target rolls over at `h >= 8` UTC and `isPartial = hUtc < 8`;
     session ends 09:00 UTC in EST → the last hour is lost and settle (`5 8`) fires at 03:05 EST mid-session.
   - `overnight-level-scan` is fine (gates on the ET hour internally; cron `*/2 0-9` covers both).
   - Fix shape: compute windows from ET wall-clock via `Intl` (`America/New_York`) inside each function, widen
     each cron to cover both offsets, and return early outside the real session — then DST needs no future
     cron edits. Re-check the `nvda-switch-*` jobs (hours 12,13,16,17,19,20,21 UTC) for intent.

Previous status (Jul 30) kept below for history.

## Status (previous): IDLE

Last cleared: 2026-07-30, after a documentation-reconciliation pass (no app change).

**App at v681.** Two commands cover the checks — `system-check.sh` already runs `handoff-gap-check`
and `preflight` inside it, so there is no need to run those separately:

```bash
./scripts/system-check.sh    # code + DB objects + cron + Edge Function (wraps gap-check + preflight)
./scripts/prod-check.sh      # the running app: version, every RPC, Edge Function, table row counts
```

See **§11e** for what each catches and is blind to. **Neither verifies behaviour** — that needs
`scripts/verify-app.js` (§5.7a).

### Where to pick up

**§10 item 1: revisit alerting.** Read **§9c** for the subsystem and **§8a** for the existing alert
tables before planning anything. Two constraints established Jul 30:

- **The scaffolding only half fits.** `alert_recipients` and `alert_log` are reusable.
  `alert_schedules` and cron job 40 are **not** — they are schedule-shaped (`send_at_et`,
  `days_of_week`), this is event-shaped, and job 40's 5-minute cadence is far too slow for bursts
  with a 0.66s median. Table in §8a.
- **The counter it depends on was broken and is now fixed** (Jul 30, §9c). `visits` counted scanner
  re-detections: 90% of recorded revisits were artifacts of the 150s lookback overlapping the 120s
  cadence. Fixed in `register_level()`, historical rows repaired, invariant
  `sum(visits) == count(hidden_level_visits)` now exact.
- **The threshold still cannot be calibrated.** Post-fix: 340 levels, 350 visits, 9 revisited,
  max 3 — one night. §5.6a: ship the mechanism, leave the threshold unset until §10 item 2 has
  several nights behind it. Genuine revisit gaps ran 179s–2,391s, median ~486s; no artifact
  exceeded 96.4s.
- **Clear the duplicate `alert_recipient_upsert` / `alert_recipient_delete` overloads first** —
  still live as of Jul 30, and directly in this path (§8a).

**Second: §10 item 4, the size ladder.** One night of 1/5/10/25/100-share probes answers whether
this scales past a curiosity. Cheapest unanswered question in the subsystem.

### Running unattended right now

| job | schedule | what |
|---|---|---|
| **pg_cron 51** | `*/2 0-9 * * *` | `overnight-level-scan` → fills `hidden_levels` (§9c) |
| **pg_cron 40** | `*/5 * * * *` | `alert_dispatch_due()` — dormant no-op, 0 schedules/recipients |

44 cron jobs total, all active, all succeeded in the last 24h. Job 51: 66 runs, zero failures.
Storage **251 MB / 49%** of the 512 MB free-plan cap (§5.2).

### Read first

**§9c** for the hidden-liquidity subsystem. **§10** for what is open *and* for the four directional
strategies already tested and rejected — do not re-run those without new evidence.
