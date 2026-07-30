# Alpha Quant Analytics

Quantitative tick-level analysis web app for the Beta Proprietary Trading Algorithm.
Single-file React 18, built to a static bundle, deployed on Cloudflare Workers, backed by Supabase.

**Live:** https://alpha-quant-analytics.alcharles1980.workers.dev

---

## → Start with [`CLAUDE.md`](CLAUDE.md), not this file

`CLAUDE.md` is the working handoff and is kept current. **This README is a signpost only.**

The previous version of this file claimed **v261, May 2026, 64 routes, ~21,800 lines** while the app
was at **v658 with 86 routes and ~36,900 lines** — 397 versions of drift. That is exactly why the
detail lives in one maintained document with an automated staleness check, and why specific numbers
are kept out of here.

| If you are… | Read |
|---|---|
| a new session in a **brand-new environment** | `CLAUDE.md` **§0** — clone → install → checks → build, verified cold |
| a new session in an **existing sandbox** | `CLAUDE.md` **§1** — reconcile `git log` against §9, read `integrity_log` |
| about to **ship a change** | **§4** (the 9-step sweep) and **§4a** (the verification gate) |
| debugging something that "should work" | **§5** — the failure modes, all paid for in production |
| picking up **Most Actives** (active area) | **§9b** — current state of all four session tabs |

---

## Quick start

**This repo is PRIVATE** — a bare `git clone` fails with `could not read Username`, not with
anything that says "private". Use a PAT, then strip it from the remote:

```bash
git clone https://x-access-token:<PAT>@github.com/alcharles1980-design/alpha-quant-analytics.git
cd alpha-quant-analytics
git remote set-url origin https://github.com/alcharles1980-design/alpha-quant-analytics.git
./scripts/handoff-gap-check.sh   # works immediately — pure bash, no dependencies
npm install
npm run preflight                # version skew · route parity · duplicate definitions
npm run build                    # → dist/index.html
```

The build is **reproducible**: a cold clone yields a `dist/index.html` byte-identical to the
committed one once the `BUILD_TS` stamp is normalised.

## Repo layout

| Path | What |
|---|---|
| `app_vN.jsx` | The entire app, one file. **Exactly one exists** — the sweep renames it. |
| `build.js` | Babel build → `dist/index.html`. Hardcodes the version banner; §4 step 2. |
| `scripts/preflight.js` | Pre-push checks. Every alarm proven by deliberately breaking the file. |
| `scripts/handoff-gap-check.sh` | Any version shipped without a `CLAUDE.md` §9 entry. |
| `scripts/verify-app.js` | Headless verification harness with the §4a disciplines built in. |
| `*-worker.js` + `wrangler-*.toml` | Cloudflare Workers. Deployed by **GitHub Actions only**. |
| `pipeline.js`, `chop_pipeline.js`, `*-scanner.js` | Data pipelines, run by Actions / pg_cron. |
| `docs/CHANGELOG-ARCHIVE.md` | Version entries below v637, verbatim. |
| `docs/IN-FLIGHT.md` | What is mid-investigation right now. |

## Deploys

Push to `main`. `deploy.yml` builds and deploys five Workers on **every** push, including docs-only
commits — so **`BUILD_TS` reflects the last push, not the last code change**. To tell whether a fix
is live, read the **version number**, not the timestamp. Details in `CLAUDE.md` §11c.

## Credentials

None are in this repo. Supabase URL and anon key are embedded in the app (public by design); Alpaca,
Polygon and the GitHub PAT live in the Supabase `app_config` table; Cloudflare and GitHub deploy
tokens are repo secrets. See `CLAUDE.md` §0.
