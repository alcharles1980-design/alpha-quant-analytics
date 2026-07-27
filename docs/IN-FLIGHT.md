# In flight

**Purpose:** what is underway *right now*, so a session that loses context can resume instead of
rediscovering. Committed work is already safe — every version tonight survived context loss intact
because its commit message carried the full diagnosis. **This file covers the gap between "measured"
and "committed".**

**Update it when you start something non-trivial. Clear it when you ship.** If it is stale, trust
`git log` over it and say so.

---

## Status: IDLE

Last cleared: 2026-07-27, after v658 (ON PACE confidence band).

Nothing in flight. Next session: run §1 of `CLAUDE.md`, which includes
`./scripts/handoff-gap-check.sh` and the `integrity_log` query.

---

## Template

```
## Status: ACTIVE — <one line: what and why>

Started: <date/time ET>
Asked for: <the user's actual request, in their words>

MEASURED SO FAR (facts that would be expensive to re-obtain):
- <number, where it came from, what it means>

DECIDED:
- <choice, and the reason, so it is not re-litigated>

NEXT STEP:
- <the single next action>

NOT YET DONE / KNOWN GAPS:
- <what is unverified>
```
