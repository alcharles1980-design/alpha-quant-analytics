# Alpha Quant Analytics

Quantitative tick-level analysis web app for the Beta Proprietary Trading Algorithm.

**Version:** v222 | **Last Updated:** May 3, 2026

## Features
- Stage 1: Cycles, trends, daily optimal TP%, volume profile (with chart-overlay POC/VAH/VAL labels)
- Stage 2: Adaptive optimization, hourly optimal TP% scanner
- Stage 3: Correlation analysis (255-feature, hourly + daily modes), Build Data Set pipeline
- Stage 4: ML model finder, hourly TP% predictor
- Stage 5: RL & AI agents (overview)
- Stage 6: Oscillation/ATR/swing/regime/cycle screeners (~20 screeners)
- Stage 7: Live analytics (MFE dashboard, true swing analyzer, grid scanner)
- Stage 8: Forecasting (range, vol concentration, cycle density/speed, grid planner, hourly returns, vol stability)
- Stage 9: Dollar Volume Time (calibration, dollar-bar builder, comparison, features, dataset, correlation)
- Stage A: Stock classification (vol × trend regime grid)
- Stage B: Live oscillation (minute-bar optimal TP%)
- 64 routes, ~29 Supabase tables, single-file React 18 app (~21,500 lines), JetBrains Mono dark terminal aesthetic

## Build
```bash
npm install
npm run build
```
Output: `dist/index.html`

## Infrastructure
- **Frontend:** Cloudflare Pages (auto-deploy via GitHub Actions)
- **Database:** Supabase (PostgreSQL)
- **Compute:** Cloudflare Workers (hourly TP% scanner)
- **Data:** Polygon.io (trade ticks)


<!-- deployed -->

Thu Apr  2 06:44:21 UTC 2026
Thu Apr  2 06:52:29 UTC 2026
Thu Apr  2 06:54:37 UTC 2026
<!-- Thu Apr  2 07:49:02 UTC 2026 -->
