# In flight

**Purpose:** what is underway *right now*, so a session that loses context can resume instead of
rediscovering. Committed work is already safe — every version survives in its commit message.
**This file covers the gap between "measured" and "committed".**

**Update it when you start something non-trivial. Clear it when you ship.** If it looks stale,
trust `git log` over it.

---

## Status: IDLE

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
