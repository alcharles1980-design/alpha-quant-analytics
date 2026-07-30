# In flight

**Purpose:** what is underway *right now*, so a session that loses context can resume instead of
rediscovering. Committed work is already safe — every version survives in its commit message.
**This file covers the gap between "measured" and "committed".**

**Update it when you start something non-trivial. Clear it when you ship.** If it looks stale,
trust `git log` over it.

---

## Status: IDLE

Last cleared: 2026-07-30 04:20 ET, after v681.

**App at v681.** All three checks clean — run them first:

```bash
./scripts/system-check.sh        # LIVE system: deploy, RPCs, cron, edge function
./scripts/handoff-gap-check.sh   # versions shipped without a §9 entry
npm run preflight                # version skew, routes, duplicate definitions
```

See **§11e** for what each catches and is blind to.

### What was built this session

- **v655–v667** Most Actives live columns on all four session tabs; ⚡ Most Traded Now; MV Charts
  true-range-by-hour in 1-hour and 5-minute bins.
- **v668–v674** Compounding Tracker: per-bucket accounting, profiles, data management, chain
  integrity.
- **v675–v676** Most Actives ticker search with cross-session lookup.
- **v677–v681** Hidden Liquidity Levels page + the whole overnight subsystem (**§9c**).

### Running unattended right now

| job | schedule | what |
|---|---|---|
| **pg_cron 51** | `*/2 0-9 * * *` | `overnight-level-scan` Edge Function → fills `hidden_levels` |

Verified firing on its own: two consecutive runs, both 200, ~1s each. **Nothing else from this
session runs without being invoked.**

### Where to pick up

Highest value is **§10 item 1: revisit alerting.** The register already stores everything needed;
what is missing is a notification when a known level is re-hit, which is the actual trading trigger.

Second is **§10 item 4: the size ladder.** One night of 1/5/10/25/100-share probes answers whether
this scales past a curiosity, and it is the cheapest unanswered question in the whole subsystem.

### Read first

**§9c** for the hidden-liquidity subsystem, **§10** for what is open *and* for the four directional
strategies already tested and rejected — do not re-run those without new evidence.
